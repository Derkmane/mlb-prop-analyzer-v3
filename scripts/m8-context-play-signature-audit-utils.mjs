import { readFile } from 'node:fs/promises';
import path from 'node:path';

import { sha256 } from './provider-probe-utils.mjs';

const SHA256_PATTERN = /^[a-f0-9]{64}$/;
const INCLUDED_PERIODS = Object.freeze(['fit', 'validation']);
const CONTEXT_REQUIRED_RESULTS = Object.freeze([
  'Caught Stealing 2B',
  'Double Play',
  'Fielders Choice',
  'Fielders Choice Out',
  'Forceout',
  'Strikeout Double Play',
  'Triple Play',
]);
const CONTEXT_REQUIRED_RESULT_SET = new Set(CONTEXT_REQUIRED_RESULTS);
const SEGMENT_START_TYPE = 'Start Batter/Pitcher';
const SEGMENT_END_TYPE = 'End Batter/Pitcher';
const PLAY_RESULT_TYPE = 'Play Result';
const CAUGHT_STEALING_TYPE = 'Caught Stealing';
const MAX_SIGNATURE_EXAMPLES = 3;
const MAX_EXAMPLE_TEXT_LENGTH = 300;

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

function assertNullableString(value, label) {
  if (value !== null && typeof value !== 'string') {
    throw new TypeError(`${label} must be a string or null.`);
  }
  return value;
}

function assertInteger(value, label) {
  if (!Number.isSafeInteger(value)) {
    throw new TypeError(`${label} must be an integer.`);
  }
  return value;
}

function assertNonNegativeInteger(value, label) {
  const integer = assertInteger(value, label);
  if (integer < 0) {
    throw new RangeError(`${label} must be non-negative.`);
  }
  return integer;
}

function assertPositiveInteger(value, label) {
  const integer = assertInteger(value, label);
  if (integer <= 0) {
    throw new RangeError(`${label} must be positive.`);
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

function normalizeHalfInning(value, label) {
  const normalized = assertNonEmptyString(value, label).toLowerCase();
  if (normalized !== 'top' && normalized !== 'bottom') {
    throw new Error(`${label} must be top or bottom.`);
  }
  return normalized;
}

function truncateText(value) {
  if (value === null) return null;
  return value.length <= MAX_EXAMPLE_TEXT_LENGTH
    ? value
    : `${value.slice(0, MAX_EXAMPLE_TEXT_LENGTH - 1)}…`;
}

function freezePlay(rawPlay, gameId, label) {
  const play = assertPlainObject(rawPlay, label);
  if (assertInteger(play.game_id, `${label}.game_id`) !== gameId) {
    throw new Error(`${label} belongs to another game.`);
  }
  const batterId = play.batter_id;
  const pitcherId = play.pitcher_id;
  if (batterId !== null) assertInteger(batterId, `${label}.batter_id`);
  if (pitcherId !== null) assertInteger(pitcherId, `${label}.pitcher_id`);
  return Object.freeze({
    gameId,
    order: assertInteger(play.order, `${label}.order`),
    type: assertNonEmptyString(play.type, `${label}.type`),
    text: assertNullableString(play.text, `${label}.text`),
    inning: assertPositiveInteger(play.inning, `${label}.inning`),
    halfInning: normalizeHalfInning(play.inning_type, `${label}.inning_type`),
    outs: assertNonNegativeInteger(play.outs, `${label}.outs`),
    batterId,
    pitcherId,
  });
}

export function segmentM8ContextPlaySequence({ gameId, plays }) {
  const providerGameId = assertPositiveInteger(gameId, 'gameId');
  const rows = assertArray(plays, 'plays').map((play, index) =>
    freezePlay(play, providerGameId, `plays[${index}]`),
  );
  let previousOrder = null;
  const seenOrders = new Set();
  for (const play of rows) {
    if (seenOrders.has(play.order)) {
      throw new Error(`game ${providerGameId} duplicate play order ${play.order}.`);
    }
    if (previousOrder !== null && play.order <= previousOrder) {
      throw new Error(`game ${providerGameId} play order is not strictly increasing.`);
    }
    seenOrders.add(play.order);
    previousOrder = play.order;
  }

  const segments = [];
  let active = null;
  for (const play of rows) {
    if (play.type === SEGMENT_START_TYPE) {
      if (active !== null) {
        throw new Error(
          `game ${providerGameId} started a batter segment before the prior segment ended.`,
        );
      }
      if (play.batterId === null || play.pitcherId === null) {
        throw new Error(
          `game ${providerGameId} batter segment start is missing batter or pitcher identity.`,
        );
      }
      active = {
        gameId: providerGameId,
        inning: play.inning,
        halfInning: play.halfInning,
        batterId: play.batterId,
        pitcherId: play.pitcherId,
        startOrder: play.order,
        plays: [play],
      };
      continue;
    }

    if (active === null) {
      if (play.type === SEGMENT_END_TYPE) {
        throw new Error(`game ${providerGameId} ended a batter segment without a start.`);
      }
      continue;
    }

    active.plays.push(play);
    if (play.type !== SEGMENT_END_TYPE) continue;

    if (
      play.batterId !== null &&
      play.batterId !== active.batterId
    ) {
      throw new Error(`game ${providerGameId} batter segment end identity drifted.`);
    }
    if (
      play.pitcherId !== null &&
      play.pitcherId !== active.pitcherId
    ) {
      throw new Error(`game ${providerGameId} pitcher segment end identity drifted.`);
    }
    if (play.inning !== active.inning || play.halfInning !== active.halfInning) {
      throw new Error(`game ${providerGameId} batter segment crossed an inning boundary.`);
    }

    segments.push(
      Object.freeze({
        gameId: active.gameId,
        inning: active.inning,
        halfInning: active.halfInning,
        batterId: active.batterId,
        pitcherId: active.pitcherId,
        startOrder: active.startOrder,
        endOrder: play.order,
        plays: Object.freeze(active.plays),
      }),
    );
    active = null;
  }

  if (active !== null) {
    throw new Error(`game ${providerGameId} capture ended inside a batter segment.`);
  }

  return Object.freeze(segments);
}

function validateContextRow(rawRow, label) {
  const row = assertPlainObject(rawRow, label);
  if (row.mappingStatus !== 'unresolved' || row.unresolvedReason !== 'context-required') {
    throw new Error(`${label} must be an unresolved context-required row.`);
  }
  const rawResult = assertNonEmptyString(row.rawResult, `${label}.rawResult`);
  if (!CONTEXT_REQUIRED_RESULT_SET.has(rawResult)) {
    throw new Error(`${label} has an unsupported context-required result: ${rawResult}.`);
  }
  return Object.freeze({
    rowId: assertNonEmptyString(row.rowId, `${label}.rowId`),
    observedDate: assertNonEmptyString(row.observedDate, `${label}.observedDate`),
    providerGameId: assertPositiveInteger(
      row.providerGameId,
      `${label}.providerGameId`,
    ),
    providerPaNumber: assertPositiveInteger(
      row.providerPaNumber,
      `${label}.providerPaNumber`,
    ),
    providerBatterId: assertPositiveInteger(
      row.providerBatterId,
      `${label}.providerBatterId`,
    ),
    providerPitcherId: assertPositiveInteger(
      row.providerPitcherId,
      `${label}.providerPitcherId`,
    ),
    inning: assertPositiveInteger(row.inning, `${label}.inning`),
    halfInning: normalizeHalfInning(row.halfInning, `${label}.halfInning`),
    rawResult,
  });
}

function uniqueSorted(values) {
  return [...new Set(values)].sort();
}

function firstPlayResultIndex(plays) {
  return plays.findIndex((play) => play.type === PLAY_RESULT_TYPE);
}

function summarizeUniqueSegment(segment) {
  const playResultIndex = firstPlayResultIndex(segment.plays);
  const priorPlay =
    playResultIndex > 0 ? segment.plays[playResultIndex - 1] : null;
  const batterOwned = segment.plays.filter(
    (play) => play.batterId === segment.batterId,
  );
  const nullBatter = segment.plays.filter((play) => play.batterId === null);
  const playResults = segment.plays.filter(
    (play) => play.type === PLAY_RESULT_TYPE,
  );

  return Object.freeze({
    startOrder: segment.startOrder,
    endOrder: segment.endOrder,
    playCount: segment.plays.length,
    firstPlayResultPriorType: priorPlay?.type ?? null,
    playResultCount: playResults.length,
    batterOwnedTypes: Object.freeze(uniqueSorted(batterOwned.map((play) => play.type))),
    nullBatterTypes: Object.freeze(uniqueSorted(nullBatter.map((play) => play.type))),
    hasNullBatterCaughtStealing: nullBatter.some(
      (play) => play.type === CAUGHT_STEALING_TYPE,
    ),
    playResultTexts: Object.freeze(
      playResults.map((play) => truncateText(play.text)),
    ),
  });
}

function signatureKey(result) {
  if (result.matchStatus !== 'unique') {
    return JSON.stringify({
      rawResult: result.rawResult,
      matchStatus: result.matchStatus,
      candidateSegmentCount: result.candidateSegmentCount,
    });
  }
  return JSON.stringify({
    rawResult: result.rawResult,
    matchStatus: result.matchStatus,
    firstPlayResultPriorType: result.segment.firstPlayResultPriorType,
    playResultCount: result.segment.playResultCount,
    batterOwnedTypes: result.segment.batterOwnedTypes,
    nullBatterTypes: result.segment.nullBatterTypes,
    hasNullBatterCaughtStealing: result.segment.hasNullBatterCaughtStealing,
  });
}

export function auditM8ContextRowsAgainstSegments({ contextRows, segmentsByGameId }) {
  const rows = assertArray(contextRows, 'contextRows').map((row, index) =>
    validateContextRow(row, `contextRows[${index}]`),
  );
  if (!(segmentsByGameId instanceof Map)) {
    throw new TypeError('segmentsByGameId must be a Map.');
  }

  const seenRowIds = new Set();
  const rowResults = [];
  const signatureMap = new Map();
  const resultCounts = Object.fromEntries(
    CONTEXT_REQUIRED_RESULTS.map((result) => [result, 0]),
  );
  const matchStatusCounts = { zero: 0, unique: 0, multiple: 0 };

  for (const row of rows) {
    if (seenRowIds.has(row.rowId)) {
      throw new Error(`duplicate context row identity: ${row.rowId}.`);
    }
    seenRowIds.add(row.rowId);
    resultCounts[row.rawResult] += 1;

    const segments = segmentsByGameId.get(row.providerGameId) ?? [];
    const candidates = segments.filter(
      (segment) =>
        segment.inning === row.inning &&
        segment.halfInning === row.halfInning &&
        segment.batterId === row.providerBatterId &&
        segment.pitcherId === row.providerPitcherId,
    );
    const matchStatus =
      candidates.length === 0 ? 'zero' : candidates.length === 1 ? 'unique' : 'multiple';
    matchStatusCounts[matchStatus] += 1;

    const rowResult = Object.freeze({
      rowId: row.rowId,
      observedDate: row.observedDate,
      providerGameId: row.providerGameId,
      providerPaNumber: row.providerPaNumber,
      providerBatterId: row.providerBatterId,
      providerPitcherId: row.providerPitcherId,
      inning: row.inning,
      halfInning: row.halfInning,
      rawResult: row.rawResult,
      matchStatus,
      candidateSegmentCount: candidates.length,
      segment: candidates.length === 1 ? summarizeUniqueSegment(candidates[0]) : null,
      candidateOrders: Object.freeze(
        candidates.map((segment) => ({
          startOrder: segment.startOrder,
          endOrder: segment.endOrder,
        })),
      ),
      inferredBatterDisposition: null,
      inferredTerminalCategory: null,
    });
    rowResults.push(rowResult);

    const key = signatureKey(rowResult);
    const current = signatureMap.get(key) ?? {
      signature: parseJson(key, 'signature key'),
      rowCount: 0,
      examples: [],
    };
    current.rowCount += 1;
    if (current.examples.length < MAX_SIGNATURE_EXAMPLES) {
      current.examples.push({
        rowId: rowResult.rowId,
        observedDate: rowResult.observedDate,
        providerGameId: rowResult.providerGameId,
        providerPaNumber: rowResult.providerPaNumber,
        candidateOrders: rowResult.candidateOrders,
        playResultTexts: rowResult.segment?.playResultTexts ?? [],
      });
    }
    signatureMap.set(key, current);
  }

  const signatures = [...signatureMap.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([, value]) =>
      Object.freeze({
        signature: Object.freeze(value.signature),
        rowCount: value.rowCount,
        examples: Object.freeze(value.examples),
      }),
    );

  if (
    Object.values(resultCounts).reduce((sum, count) => sum + count, 0) !== rows.length ||
    Object.values(matchStatusCounts).reduce((sum, count) => sum + count, 0) !== rows.length ||
    signatures.reduce((sum, signature) => sum + signature.rowCount, 0) !== rows.length
  ) {
    throw new Error('context signature audit accounting does not conserve rows.');
  }

  return Object.freeze({
    contextRowCount: rows.length,
    resultCounts: Object.freeze(resultCounts),
    matchStatusCounts: Object.freeze(matchStatusCounts),
    signatureCount: signatures.length,
    signatures: Object.freeze(signatures),
    rows: Object.freeze(rowResults),
  });
}

function captureIdentityFromManifest(manifest) {
  return {
    activeSeason: manifest.activeSeason,
    sourceDatasetSha256: manifest.sourceDatasetSha256,
    sourceDatasetFileSha256: manifest.sourceDatasetFileSha256,
    sourcePlanSha256: manifest.sourcePlanSha256,
    sourcePlanFileSha256: manifest.sourcePlanFileSha256,
    contextRowCount: manifest.contextRowCount,
    gameCount: manifest.gameCount,
    resultCounts: manifest.resultCounts,
    games: manifest.games,
    totalPageCount: manifest.totalPageCount,
    totalPlayRecordCount: manifest.totalPlayRecordCount,
    untouchedTestReservation: manifest.untouchedTestReservation,
  };
}

function validateDataset(rawDataset) {
  const dataset = assertPlainObject(rawDataset, 'recency dataset');
  if (dataset.datasetVersion !== 2) {
    throw new Error('recency dataset must have datasetVersion 2.');
  }
  const datasetSha256 = assertSha256(dataset.datasetSha256, 'datasetSha256');
  const periods = assertPlainObject(dataset.periods, 'periods');
  const contextRows = [];
  for (const periodId of INCLUDED_PERIODS) {
    const period = assertPlainObject(periods[periodId], `periods.${periodId}`);
    const rows = assertArray(period.rows, `periods.${periodId}.rows`);
    for (const row of rows) {
      if (row?.mappingStatus === 'unresolved' && row?.unresolvedReason === 'context-required') {
        contextRows.push(row);
      }
    }
  }
  const totals = assertPlainObject(dataset.totals, 'totals');
  if (
    assertNonNegativeInteger(totals.contextRequiredCount, 'totals.contextRequiredCount') !==
    contextRows.length
  ) {
    throw new Error('dataset context-required count does not match its rows.');
  }
  const untouchedTestReservation = assertPlainObject(
    dataset.untouchedTestReservation,
    'untouchedTestReservation',
  );
  if (untouchedTestReservation.rowsIncluded !== false) {
    throw new Error('untouched-test rows must remain excluded from the signature audit.');
  }
  return Object.freeze({
    dataset,
    datasetSha256,
    contextRows: Object.freeze(contextRows),
    untouchedTestReservation,
  });
}

async function readVerifiedGamePlays({ captureRoot, gameSummary }) {
  const gameId = assertPositiveInteger(gameSummary.gameId, 'capture gameId');
  const gameDirectory = path.join(captureRoot, 'games', String(gameId));
  const gameManifestPath = path.join(gameDirectory, 'game-manifest.json');
  const gameManifestText = await readFile(gameManifestPath, 'utf8');
  if (
    sha256(gameManifestText) !==
    assertSha256(gameSummary.gameManifestSha256, `game ${gameId} manifest SHA`)
  ) {
    throw new Error(`game ${gameId} manifest hash drifted from complete capture.`);
  }
  const manifest = assertPlainObject(
    parseJson(gameManifestText, `game ${gameId} manifest`),
    `game ${gameId} manifest`,
  );
  if (
    manifest.captureVersion !== 1 ||
    manifest.status !== 'complete' ||
    manifest.error !== null ||
    manifest.gameId !== gameId
  ) {
    throw new Error(`game ${gameId} manifest identity is invalid.`);
  }
  const pages = assertArray(manifest.pages, `game ${gameId} pages`);
  if (pages.length !== gameSummary.pageCount || pages.length !== manifest.pageCount) {
    throw new Error(`game ${gameId} page count drifted.`);
  }

  const plays = [];
  let previousOrder = null;
  let expectedCursor = null;
  for (const [index, rawPage] of pages.entries()) {
    const page = assertPlainObject(rawPage, `game ${gameId} pages[${index}]`);
    if (page.pageNumber !== index + 1 || page.requestCursor !== expectedCursor) {
      throw new Error(`game ${gameId} page sequence drifted.`);
    }
    const relativePath = assertNonEmptyString(
      page.filePath,
      `game ${gameId} page filePath`,
    );
    const resolvedRoot = path.resolve(gameDirectory);
    const pagePath = path.resolve(resolvedRoot, relativePath);
    if (!pagePath.startsWith(`${resolvedRoot}${path.sep}`)) {
      throw new Error(`game ${gameId} page path escapes its capture directory.`);
    }
    const text = await readFile(pagePath, 'utf8');
    if (sha256(text) !== assertSha256(page.savedBodySha256, 'savedBodySha256')) {
      throw new Error(`game ${gameId} page ${index + 1} hash mismatch.`);
    }
    const body = assertPlainObject(
      parseJson(text, `game ${gameId} page ${index + 1}`),
      `game ${gameId} page ${index + 1}`,
    );
    const data = assertArray(body.data, `game ${gameId} page ${index + 1} data`);
    if (data.length !== page.recordCount) {
      throw new Error(`game ${gameId} page ${index + 1} record count drifted.`);
    }
    for (const rawPlay of data) {
      const play = assertPlainObject(rawPlay, `game ${gameId} raw play`);
      const order = assertInteger(play.order, `game ${gameId} play order`);
      if (previousOrder !== null && order <= previousOrder) {
        throw new Error(`game ${gameId} play order is not strictly increasing.`);
      }
      previousOrder = order;
      plays.push(play);
    }
    expectedCursor = page.nextCursor;
  }
  if (expectedCursor !== null) {
    throw new Error(`game ${gameId} capture ended before pagination completed.`);
  }
  if (plays.length !== gameSummary.recordCount || plays.length !== manifest.recordCount) {
    throw new Error(`game ${gameId} total play count drifted.`);
  }
  return Object.freeze(plays);
}

export async function auditM8ContextPlaySignatures({ datasetPath, captureRoot }) {
  const sourceDatasetPath = assertNonEmptyString(datasetPath, 'datasetPath');
  const sourceCaptureRoot = assertNonEmptyString(captureRoot, 'captureRoot');
  const datasetText = await readFile(sourceDatasetPath, 'utf8');
  const validatedDataset = validateDataset(parseJson(datasetText, 'recency dataset'));

  const captureManifestPath = path.join(sourceCaptureRoot, 'capture-manifest.json');
  const captureManifestText = await readFile(captureManifestPath, 'utf8');
  const captureManifest = assertPlainObject(
    parseJson(captureManifestText, 'context play capture manifest'),
    'context play capture manifest',
  );
  if (
    captureManifest.captureVersion !== 1 ||
    captureManifest.status !== 'complete' ||
    captureManifest.error !== null
  ) {
    throw new Error('context play capture manifest is not complete.');
  }
  if (captureManifest.sourceDatasetSha256 !== validatedDataset.datasetSha256) {
    throw new Error('context play capture belongs to another recency dataset.');
  }
  if (captureManifest.contextRowCount !== validatedDataset.contextRows.length) {
    throw new Error('context play capture row count drifted from the recency dataset.');
  }
  if (captureManifest.untouchedTestReservation?.rowsIncluded !== false) {
    throw new Error('context play capture exposes untouched-test rows.');
  }
  if (
    JSON.stringify(captureManifest.untouchedTestReservation) !==
    JSON.stringify(validatedDataset.untouchedTestReservation)
  ) {
    throw new Error('capture and dataset untouched-test reservations differ.');
  }
  const expectedCaptureSha = sha256(
    JSON.stringify(captureIdentityFromManifest(captureManifest)),
  );
  if (captureManifest.captureSha256 !== expectedCaptureSha) {
    throw new Error('context play capture identity hash is invalid.');
  }

  const gameSummaries = assertArray(captureManifest.games, 'capture games');
  if (gameSummaries.length !== captureManifest.gameCount) {
    throw new Error('context play capture game count drifted.');
  }
  const segmentsByGameId = new Map();
  let verifiedPageCount = 0;
  let verifiedPlayCount = 0;
  for (const rawGameSummary of gameSummaries) {
    const gameSummary = assertPlainObject(rawGameSummary, 'capture game summary');
    const gameId = assertPositiveInteger(gameSummary.gameId, 'capture gameId');
    if (segmentsByGameId.has(gameId)) {
      throw new Error(`duplicate capture game identity: ${gameId}.`);
    }
    const plays = await readVerifiedGamePlays({
      captureRoot: sourceCaptureRoot,
      gameSummary,
    });
    const segments = segmentM8ContextPlaySequence({ gameId, plays });
    segmentsByGameId.set(gameId, segments);
    verifiedPageCount += gameSummary.pageCount;
    verifiedPlayCount += plays.length;
  }
  if (
    verifiedPageCount !== captureManifest.totalPageCount ||
    verifiedPlayCount !== captureManifest.totalPlayRecordCount
  ) {
    throw new Error('verified play evidence totals drifted from the capture manifest.');
  }

  const audit = auditM8ContextRowsAgainstSegments({
    contextRows: validatedDataset.contextRows,
    segmentsByGameId,
  });
  const auditIdentity = {
    activeSeason: validatedDataset.dataset.activeSeason,
    sourceDatasetSha256: validatedDataset.datasetSha256,
    sourceDatasetFileSha256: sha256(datasetText),
    sourceCaptureSha256: captureManifest.captureSha256,
    sourceCaptureManifestFileSha256: sha256(captureManifestText),
    verifiedGameCount: gameSummaries.length,
    verifiedPageCount,
    verifiedPlayCount,
    contextRowCount: audit.contextRowCount,
    resultCounts: audit.resultCounts,
    matchStatusCounts: audit.matchStatusCounts,
    signatureCount: audit.signatureCount,
    signatures: audit.signatures,
    rows: audit.rows,
    untouchedTestReservation: validatedDataset.untouchedTestReservation,
    untouchedTestRowsRead: false,
    mappingApplied: false,
  };
  return Object.freeze({
    auditVersion: 1,
    purpose:
      'Audit exact fit-validation plate-appearance-to-play segment signatures before approving any contextual terminal-category resolver.',
    ...auditIdentity,
    auditSha256: sha256(JSON.stringify(auditIdentity)),
  });
}
