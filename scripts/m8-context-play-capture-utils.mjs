import { access, mkdtemp, readFile, rename, rm } from 'node:fs/promises';
import path from 'node:path';

import {
  sha256,
  writeJsonAtomic,
  writeTextAtomic,
} from './provider-probe-utils.mjs';

const SHA256_PATTERN = /^[a-f0-9]{64}$/;
const INCLUDED_PERIODS = Object.freeze(['fit', 'validation']);
const DEFAULT_PER_PAGE = 100;

function assertPlainObject(value, label) {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new TypeError(`${label} must be an object.`);
  }
  return value;
}

function assertArray(value, label) {
  if (!Array.isArray(value)) {
    throw new TypeError(`${label} must be an array.`);
  }
  return value;
}

function assertNonEmptyString(value, label) {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new TypeError(`${label} must be a non-empty string.`);
  }
  return value.trim();
}

function assertInteger(value, label) {
  if (!Number.isSafeInteger(value)) {
    throw new TypeError(`${label} must be an integer.`);
  }
  return value;
}

function assertPositiveInteger(value, label) {
  const integer = assertInteger(value, label);
  if (integer <= 0) {
    throw new RangeError(`${label} must be positive.`);
  }
  return integer;
}

function assertNonNegativeInteger(value, label) {
  const integer = assertInteger(value, label);
  if (integer < 0) {
    throw new RangeError(`${label} must be non-negative.`);
  }
  return integer;
}

function assertSha256(value, label) {
  if (typeof value !== 'string' || !SHA256_PATTERN.test(value)) {
    throw new TypeError(`${label} must be a lowercase SHA-256 digest.`);
  }
  return value;
}

function parseJson(text, label) {
  try {
    return JSON.parse(text);
  } catch {
    throw new Error(`${label} is not valid JSON.`);
  }
}

function datasetIdentity(dataset) {
  return {
    activeSeason: dataset.activeSeason,
    sourcePartitionSha256: dataset.sourcePartitionSha256,
    sourceEvidenceSetSha256: dataset.sourceEvidenceSetSha256,
    periods: dataset.periods,
    untouchedTestReservation: dataset.untouchedTestReservation,
  };
}

function incrementCount(counts, value) {
  counts[value] = (counts[value] ?? 0) + 1;
}

function validateSourceDataset(rawDataset, sourceText) {
  const dataset = assertPlainObject(rawDataset, 'M8 recency dataset');
  if (dataset.datasetVersion !== 2) {
    throw new RangeError('source datasetVersion must equal 2.');
  }
  const activeSeason = assertPositiveInteger(dataset.activeSeason, 'activeSeason');
  assertSha256(dataset.sourcePartitionSha256, 'sourcePartitionSha256');
  assertSha256(dataset.sourceEvidenceSetSha256, 'sourceEvidenceSetSha256');
  const internalSha256 = assertSha256(dataset.datasetSha256, 'datasetSha256');
  if (internalSha256 !== sha256(JSON.stringify(datasetIdentity(dataset)))) {
    throw new Error('source dataset internal SHA-256 does not match its identity.');
  }

  const untouched = assertPlainObject(
    dataset.untouchedTestReservation,
    'untouchedTestReservation',
  );
  if (untouched.rowsIncluded !== false || Object.hasOwn(untouched, 'rows')) {
    throw new Error('untouched test rows must remain absent from context-play planning.');
  }

  const periods = assertPlainObject(dataset.periods, 'periods');
  const contextRows = [];
  for (const periodId of INCLUDED_PERIODS) {
    const period = assertPlainObject(periods[periodId], `periods.${periodId}`);
    const rows = assertArray(period.rows, `periods.${periodId}.rows`);
    if (
      rows.length !==
      assertNonNegativeInteger(period.rowCount, `periods.${periodId}.rowCount`)
    ) {
      throw new Error(`${periodId} rowCount does not match rows.`);
    }
    for (const [index, rawRow] of rows.entries()) {
      const row = assertPlainObject(rawRow, `periods.${periodId}.rows[${index}]`);
      if (
        row.mappingStatus !== 'unresolved' ||
        row.unresolvedReason !== 'context-required'
      ) {
        continue;
      }
      contextRows.push(
        Object.freeze({
          periodId,
          rowId: assertNonEmptyString(row.rowId, `${periodId} context rowId`),
          observedDate: assertNonEmptyString(
            row.observedDate,
            `${periodId} context observedDate`,
          ),
          providerGameId: assertPositiveInteger(
            row.providerGameId,
            `${periodId} context providerGameId`,
          ),
          providerPaNumber: assertPositiveInteger(
            row.providerPaNumber,
            `${periodId} context providerPaNumber`,
          ),
          providerBatterId: assertPositiveInteger(
            row.providerBatterId,
            `${periodId} context providerBatterId`,
          ),
          providerPitcherId: assertPositiveInteger(
            row.providerPitcherId,
            `${periodId} context providerPitcherId`,
          ),
          inning: assertPositiveInteger(row.inning, `${periodId} context inning`),
          halfInning: assertNonEmptyString(
            row.halfInning,
            `${periodId} context halfInning`,
          ),
          rawResult: assertNonEmptyString(
            row.rawResult,
            `${periodId} context rawResult`,
          ),
        }),
      );
    }
  }

  return Object.freeze({
    activeSeason,
    sourceDatasetSha256: internalSha256,
    sourceDatasetFileSha256: sha256(sourceText),
    contextRows: Object.freeze(contextRows),
    untouchedTestReservation: Object.freeze({
      startDate: assertNonEmptyString(untouched.startDate, 'untouched startDate'),
      endDate: assertNonEmptyString(untouched.endDate, 'untouched endDate'),
      plateAppearanceCount: assertNonNegativeInteger(
        untouched.plateAppearanceCount,
        'untouched plateAppearanceCount',
      ),
      rowsIncluded: false,
    }),
  });
}

export async function buildM8ContextPlayCapturePlan({ datasetPath }) {
  const inputPath = assertNonEmptyString(datasetPath, 'datasetPath');
  const sourceText = await readFile(inputPath, 'utf8');
  const dataset = validateSourceDataset(
    parseJson(sourceText, 'M8 recency dataset'),
    sourceText,
  );

  const grouped = new Map();
  for (const row of dataset.contextRows) {
    let game = grouped.get(row.providerGameId);
    if (!game) {
      game = {
        gameId: row.providerGameId,
        dates: new Set(),
        periods: new Set(),
        contextRowCount: 0,
        resultCounts: {},
        rowIds: [],
      };
      grouped.set(row.providerGameId, game);
    }
    game.dates.add(row.observedDate);
    game.periods.add(row.periodId);
    game.contextRowCount += 1;
    incrementCount(game.resultCounts, row.rawResult);
    game.rowIds.push(row.rowId);
  }

  const games = Object.freeze(
    [...grouped.values()]
      .sort((left, right) => left.gameId - right.gameId)
      .map((game) => {
        const dates = [...game.dates].sort();
        if (dates.length !== 1) {
          throw new Error(
            `context game ${game.gameId} appears on multiple observed dates.`,
          );
        }
        return Object.freeze({
          gameId: game.gameId,
          observedDate: dates[0],
          periods: Object.freeze([...game.periods].sort()),
          contextRowCount: game.contextRowCount,
          resultCounts: Object.freeze(
            Object.fromEntries(
              Object.entries(game.resultCounts).sort(([left], [right]) =>
                left.localeCompare(right),
              ),
            ),
          ),
          rowIdsSha256: sha256(JSON.stringify([...game.rowIds].sort())),
        });
      }),
  );

  const resultCounts = {};
  for (const row of dataset.contextRows) {
    incrementCount(resultCounts, row.rawResult);
  }
  const identity = {
    activeSeason: dataset.activeSeason,
    sourceDatasetSha256: dataset.sourceDatasetSha256,
    sourceDatasetFileSha256: dataset.sourceDatasetFileSha256,
    includedPeriods: INCLUDED_PERIODS,
    contextRowCount: dataset.contextRows.length,
    gameCount: games.length,
    resultCounts: Object.freeze(
      Object.fromEntries(
        Object.entries(resultCounts).sort(([left], [right]) =>
          left.localeCompare(right),
        ),
      ),
    ),
    games,
    untouchedTestReservation: dataset.untouchedTestReservation,
  };

  return Object.freeze({
    planVersion: 1,
    purpose:
      'Capture complete BALLDONTLIE play evidence only for fit-validation games containing unresolved context-required plate appearances.',
    ...identity,
    planSha256: sha256(JSON.stringify(identity)),
  });
}

function validatePlayPageBody({ body: rawBody, gameId, perPage, pageNumber }) {
  const body = assertPlainObject(rawBody, `game ${gameId} page ${pageNumber}`);
  const data = assertArray(body.data, `game ${gameId} page ${pageNumber}.data`);
  const meta = assertPlainObject(body.meta, `game ${gameId} page ${pageNumber}.meta`);
  if (
    assertPositiveInteger(
      meta.per_page,
      `game ${gameId} page ${pageNumber}.meta.per_page`,
    ) !== perPage
  ) {
    throw new Error(`game ${gameId} page ${pageNumber} per_page drifted.`);
  }
  const nextCursor =
    meta.next_cursor === undefined
      ? null
      : assertPositiveInteger(
          meta.next_cursor,
          `game ${gameId} page ${pageNumber}.meta.next_cursor`,
        );

  const plays = data.map((rawPlay, index) => {
    const play = assertPlainObject(
      rawPlay,
      `game ${gameId} page ${pageNumber}.data[${index}]`,
    );
    if (
      assertPositiveInteger(
        play.game_id,
        `game ${gameId} page ${pageNumber}.data[${index}].game_id`,
      ) !== gameId
    ) {
      throw new Error(`game ${gameId} page ${pageNumber} contains another game.`);
    }
    return Object.freeze({
      order: assertPositiveInteger(
        play.order,
        `game ${gameId} page ${pageNumber}.data[${index}].order`,
      ),
      raw: play,
    });
  });

  return Object.freeze({ body, plays: Object.freeze(plays), nextCursor });
}

export async function collectCompleteM8PlayPages({
  gameId,
  fetchPage,
  perPage = DEFAULT_PER_PAGE,
}) {
  const providerGameId = assertPositiveInteger(gameId, 'gameId');
  if (typeof fetchPage !== 'function') {
    throw new TypeError('fetchPage must be a function.');
  }
  const pageSize = assertPositiveInteger(perPage, 'perPage');
  const pages = [];
  const seenRequestCursors = new Set();
  const seenOrders = new Set();
  let requestCursor = null;
  let lastOrder = null;

  for (let pageNumber = 1; ; pageNumber += 1) {
    const cursorKey = requestCursor === null ? 'FIRST' : String(requestCursor);
    if (seenRequestCursors.has(cursorKey)) {
      throw new Error(`game ${providerGameId} pagination cursor loop detected.`);
    }
    seenRequestCursors.add(cursorKey);

    const fetched = assertPlainObject(
      await fetchPage({
        gameId: providerGameId,
        sortOrder: 'asc',
        perPage: pageSize,
        cursor: requestCursor,
        pageNumber,
      }),
      `game ${providerGameId} fetched page ${pageNumber}`,
    );
    const validated = validatePlayPageBody({
      body: fetched.body,
      gameId: providerGameId,
      perPage: pageSize,
      pageNumber,
    });

    for (const play of validated.plays) {
      if (seenOrders.has(play.order)) {
        throw new Error(
          `game ${providerGameId} duplicate play order ${play.order}.`,
        );
      }
      if (lastOrder !== null && play.order <= lastOrder) {
        throw new Error(
          `game ${providerGameId} play order is not strictly increasing.`,
        );
      }
      seenOrders.add(play.order);
      lastOrder = play.order;
    }

    pages.push(
      Object.freeze({
        pageNumber,
        requestCursor,
        nextCursor: validated.nextCursor,
        recordCount: validated.plays.length,
        firstOrder: validated.plays[0]?.order ?? null,
        lastOrder: validated.plays.at(-1)?.order ?? null,
        body: validated.body,
        snapshot: fetched.snapshot ?? null,
      }),
    );

    if (validated.nextCursor === null) {
      break;
    }
    if (validated.nextCursor === requestCursor) {
      throw new Error(`game ${providerGameId} pagination did not advance.`);
    }
    requestCursor = validated.nextCursor;
  }

  return Object.freeze({
    gameId: providerGameId,
    perPage: pageSize,
    pageCount: pages.length,
    recordCount: pages.reduce((sum, page) => sum + page.recordCount, 0),
    firstOrder: pages.find((page) => page.firstOrder !== null)?.firstOrder ?? null,
    lastOrder:
      [...pages].reverse().find((page) => page.lastOrder !== null)?.lastOrder ?? null,
    pages: Object.freeze(pages),
  });
}

function resolveRelative(root, relativePath, label) {
  const value = assertNonEmptyString(relativePath, label);
  if (path.isAbsolute(value)) {
    throw new Error(`${label} must be relative.`);
  }
  const resolvedRoot = path.resolve(root);
  const resolved = path.resolve(resolvedRoot, value);
  if (!resolved.startsWith(`${resolvedRoot}${path.sep}`)) {
    throw new Error(`${label} escapes its capture directory.`);
  }
  return resolved;
}

export async function verifyM8ContextPlayGameCapture({
  gameDirectory,
  expectedGameId,
  secret = null,
}) {
  const directory = assertNonEmptyString(gameDirectory, 'gameDirectory');
  const gameId = assertPositiveInteger(expectedGameId, 'expectedGameId');
  const manifestPath = path.join(directory, 'game-manifest.json');
  const manifestText = await readFile(manifestPath, 'utf8');
  if (secret && manifestText.includes(secret)) {
    throw new Error(`game ${gameId} manifest contains the provider secret.`);
  }
  const manifest = assertPlainObject(
    parseJson(manifestText, `game ${gameId} manifest`),
    `game ${gameId} manifest`,
  );
  if (manifest.captureVersion !== 1 || manifest.gameId !== gameId) {
    throw new Error(`game ${gameId} manifest identity is invalid.`);
  }
  if (manifest.status !== 'complete' || manifest.error !== null) {
    throw new Error(`game ${gameId} capture is not complete.`);
  }
  const perPage = assertPositiveInteger(manifest.perPage, `game ${gameId} perPage`);
  const pages = assertArray(manifest.pages, `game ${gameId} pages`);
  if (
    pages.length !==
    assertPositiveInteger(manifest.pageCount, `game ${gameId} pageCount`)
  ) {
    throw new Error(`game ${gameId} pageCount does not match pages.`);
  }

  let totalRecords = 0;
  let lastOrder = null;
  let expectedRequestCursor = null;
  const seenOrders = new Set();
  for (const [index, rawPage] of pages.entries()) {
    const pageNumber = index + 1;
    const page = assertPlainObject(rawPage, `game ${gameId} pages[${index}]`);
    if (page.pageNumber !== pageNumber) {
      throw new Error(`game ${gameId} page numbering is not contiguous.`);
    }
    if (page.requestCursor !== expectedRequestCursor) {
      throw new Error(`game ${gameId} page ${pageNumber} request cursor drifted.`);
    }
    const savedBodySha256 = assertSha256(
      page.savedBodySha256,
      `game ${gameId} page ${pageNumber} savedBodySha256`,
    );
    const pagePath = resolveRelative(
      directory,
      page.filePath,
      `game ${gameId} page ${pageNumber} filePath`,
    );
    const text = await readFile(pagePath, 'utf8');
    if (secret && text.includes(secret)) {
      throw new Error(`game ${gameId} page ${pageNumber} contains the provider secret.`);
    }
    if (sha256(text) !== savedBodySha256) {
      throw new Error(`game ${gameId} page ${pageNumber} hash mismatch.`);
    }
    const validated = validatePlayPageBody({
      body: parseJson(text, `game ${gameId} page ${pageNumber}`),
      gameId,
      perPage,
      pageNumber,
    });
    if (validated.nextCursor !== page.nextCursor) {
      throw new Error(`game ${gameId} page ${pageNumber} next cursor drifted.`);
    }
    if (validated.plays.length !== page.recordCount) {
      throw new Error(`game ${gameId} page ${pageNumber} recordCount drifted.`);
    }
    for (const play of validated.plays) {
      if (seenOrders.has(play.order)) {
        throw new Error(`game ${gameId} duplicate verified play order ${play.order}.`);
      }
      if (lastOrder !== null && play.order <= lastOrder) {
        throw new Error(`game ${gameId} verified play order is not increasing.`);
      }
      seenOrders.add(play.order);
      lastOrder = play.order;
    }
    totalRecords += validated.plays.length;
    expectedRequestCursor = validated.nextCursor;
  }
  if (expectedRequestCursor !== null) {
    throw new Error(`game ${gameId} capture ended before pagination completed.`);
  }
  if (
    totalRecords !==
    assertNonNegativeInteger(manifest.recordCount, `game ${gameId} recordCount`)
  ) {
    throw new Error(`game ${gameId} total recordCount drifted.`);
  }

  return Object.freeze({
    status: 'verified',
    gameId,
    pageCount: pages.length,
    recordCount: totalRecords,
    gameManifestSha256: sha256(manifestText),
  });
}

export async function promoteM8ContextPlayGameCapture({
  outputRoot,
  gameId,
  collected,
  snapshotWriter = writeTextAtomic,
}) {
  const root = assertNonEmptyString(outputRoot, 'outputRoot');
  const providerGameId = assertPositiveInteger(gameId, 'gameId');
  const capture = assertPlainObject(collected, 'collected');
  if (capture.gameId !== providerGameId) {
    throw new Error('collected game identity drifted.');
  }
  const gamesRoot = path.join(root, 'games');
  const finalDirectory = path.join(gamesRoot, String(providerGameId));
  try {
    await access(finalDirectory);
    throw new Error(`game ${providerGameId} capture already exists.`);
  } catch (error) {
    if (error?.code !== 'ENOENT') throw error;
  }

  const temporaryDirectory = await mkdtemp(
    path.join(gamesRoot, `.capture-${providerGameId}-`),
  );
  try {
    const pageRecords = [];
    for (const page of capture.pages) {
      const fileName = `page-${String(page.pageNumber).padStart(4, '0')}.json`;
      const relativePath = path.join('pages', fileName);
      const filePath = path.join(temporaryDirectory, relativePath);
      const text = `${JSON.stringify(page.body, null, 2)}\n`;
      await snapshotWriter(filePath, text);
      const snapshot = assertPlainObject(
        page.snapshot,
        `game ${providerGameId} page ${page.pageNumber} snapshot`,
      );
      pageRecords.push(
        Object.freeze({
          pageNumber: page.pageNumber,
          requestCursor: page.requestCursor,
          nextCursor: page.nextCursor,
          filePath: relativePath,
          rawBodySha256: assertSha256(
            snapshot.rawBodySha256,
            `game ${providerGameId} page ${page.pageNumber} rawBodySha256`,
          ),
          savedBodySha256: sha256(text),
          responseStatus: snapshot.responseStatus,
          request: snapshot.request,
          recordCount: page.recordCount,
          firstOrder: page.firstOrder,
          lastOrder: page.lastOrder,
        }),
      );
    }
    const manifest = {
      captureVersion: 1,
      provider: 'BALLDONTLIE MLB API',
      purpose:
        'Preserve complete paginated play evidence for one fit-validation game containing context-required terminal PA rows.',
      gameId: providerGameId,
      perPage: capture.perPage,
      status: 'complete',
      error: null,
      pageCount: capture.pageCount,
      recordCount: capture.recordCount,
      firstOrder: capture.firstOrder,
      lastOrder: capture.lastOrder,
      pages: pageRecords,
    };
    await writeJsonAtomic(
      path.join(temporaryDirectory, 'game-manifest.json'),
      manifest,
    );
    await rename(temporaryDirectory, finalDirectory);
    return Object.freeze({
      gameId: providerGameId,
      finalDirectory,
      manifest,
    });
  } catch (error) {
    await rm(temporaryDirectory, { recursive: true, force: true });
    throw error;
  }
}
