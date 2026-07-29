import { readFile } from 'node:fs/promises';
import path from 'node:path';

import { sha256 } from './provider-probe-utils.mjs';
import { auditM8ContextRowsAgainstSegments } from './m8-context-play-signature-audit-utils.mjs';

const SHA256_PATTERN = /^[a-f0-9]{64}$/;
const INCLUDED_PERIODS = Object.freeze(['fit', 'validation']);
const SEGMENT_START_TYPE = 'Start Batter/Pitcher';
const SEGMENT_END_TYPE = 'End Batter/Pitcher';
const PLAY_RESULT_TYPE = 'Play Result';
const INNING_BOUNDARY_TYPES = new Set(['Start Inning', 'End Inning', 'End Game']);

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
  if (integer <= 0) throw new RangeError(`${label} must be positive.`);
  return integer;
}

function assertNonNegativeInteger(value, label) {
  const integer = assertInteger(value, label);
  if (integer < 0) throw new RangeError(`${label} must be non-negative.`);
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

function normalizePlayInningType(value, label) {
  return assertNonEmptyString(value, label).toLowerCase();
}

function requireBatterHalf(value, label) {
  const normalized = normalizePlayInningType(value, label);
  if (normalized !== 'top' && normalized !== 'bottom') {
    throw new Error(`${label} must be top or bottom inside a batter segment.`);
  }
  return normalized;
}

function validatePlay(rawPlay, gameId, label) {
  const play = assertPlainObject(rawPlay, label);
  if (assertInteger(play.game_id, `${label}.game_id`) !== gameId) {
    throw new Error(`${label} belongs to another game.`);
  }
  const batterId = play.batter_id;
  const pitcherId = play.pitcher_id;
  if (batterId !== null) assertInteger(batterId, `${label}.batter_id`);
  if (pitcherId !== null) assertInteger(pitcherId, `${label}.pitcher_id`);
  if (play.text !== null && typeof play.text !== 'string') {
    throw new TypeError(`${label}.text must be a string or null.`);
  }
  return Object.freeze({
    gameId,
    order: assertInteger(play.order, `${label}.order`),
    type: assertNonEmptyString(play.type, `${label}.type`),
    text: play.text,
    inning: assertPositiveInteger(play.inning, `${label}.inning`),
    inningType: normalizePlayInningType(play.inning_type, `${label}.inning_type`),
    outs: assertNonNegativeInteger(play.outs, `${label}.outs`),
    batterId,
    pitcherId,
  });
}

function finalizeSegment(active, endBoundary) {
  const lastPlay = active.plays.at(-1);
  if (lastPlay === undefined) {
    throw new Error(`game ${active.gameId} batter segment contains no plays.`);
  }
  return Object.freeze({
    gameId: active.gameId,
    inning: active.inning,
    halfInning: active.halfInning,
    batterId: active.batterId,
    pitcherId: active.pitcherId,
    startOrder: active.startOrder,
    endOrder: lastPlay.order,
    endBoundary,
    plays: Object.freeze(
      active.plays.map((value) =>
        Object.freeze({
          ...value,
          halfInning: value.inningType,
        }),
      ),
    ),
  });
}

function isExplicitInningBoundary(play) {
  return INNING_BOUNDARY_TYPES.has(play.type);
}

function isForeignContextPlay(play, active) {
  if (
    play.inningType !== 'top' &&
    play.inningType !== 'bottom'
  ) {
    return true;
  }

  return (
    play.inning !== active.inning ||
    play.inningType !== active.halfInning
  );
}

export function segmentVerifiedM8ContextPlaySequence({ gameId, plays }) {
  const providerGameId = assertPositiveInteger(gameId, 'gameId');
  const rows = assertArray(plays, 'plays').map((play, index) =>
    validatePlay(play, providerGameId, `plays[${index}]`),
  );
  let priorOrder = null;
  const seenOrders = new Set();
  for (const play of rows) {
    if (seenOrders.has(play.order)) {
      throw new Error(`game ${providerGameId} duplicate play order ${play.order}.`);
    }
    if (priorOrder !== null && play.order <= priorOrder) {
      throw new Error(`game ${providerGameId} play order is not strictly increasing.`);
    }
    seenOrders.add(play.order);
    priorOrder = play.order;
  }

  const segments = [];
  let active = null;
  for (const play of rows) {
    if (play.type === SEGMENT_START_TYPE) {
      if (active !== null) {
        segments.push(finalizeSegment(active, 'next-start'));
      }
      if (play.batterId === null || play.pitcherId === null) {
        throw new Error(
          `game ${providerGameId} batter segment start lacks batter or pitcher identity.`,
        );
      }
      active = {
        gameId: providerGameId,
        inning: play.inning,
        halfInning: requireBatterHalf(
          play.inningType,
          `game ${providerGameId} segment start inning type`,
        ),
        batterId: play.batterId,
        pitcherId: play.pitcherId,
        startOrder: play.order,
        plays: [play],
      };
      continue;
    }

    if (active === null) continue;

    if (isExplicitInningBoundary(play)) {
      const hasBatterMatchedResult =
        active.plays.some(
          (activePlay) =>
            activePlay.type === PLAY_RESULT_TYPE &&
            activePlay.batterId === active.batterId,
        );

      const hasExplicitEnd =
        active.plays.some(
          (activePlay) =>
            activePlay.type === SEGMENT_END_TYPE &&
            activePlay.batterId === active.batterId,
        );

      if (
        hasBatterMatchedResult ||
        hasExplicitEnd
      ) {
        segments.push(finalizeSegment(active, 'inning-boundary'));
        active = null;
      }

      continue;
    }

    if (isForeignContextPlay(play, active)) {
      continue;
    }

    active.plays.push(play);
  }

  if (active !== null) {
    segments.push(finalizeSegment(active, 'capture-end'));
  }
  return Object.freeze(segments);
}


export function buildM8PlayOpportunitySequence({
  gameId,
  plays,
}) {
  const providerGameId =
    assertPositiveInteger(gameId, 'gameId');

  const segments =
    segmentVerifiedM8ContextPlaySequence({
      gameId: providerGameId,
      plays,
    });

  const opportunityCountByHalf = {
    top: 0,
    bottom: 0,
  };

  const opportunities = segments.map(
    (segment, segmentIndex) => {
      const hasExplicitEnd =
        segment.plays.some(
          (play) =>
            play.type === SEGMENT_END_TYPE,
        );

      const batterMatchedResults =
        segment.plays.filter(
          (play) =>
            play.type === PLAY_RESULT_TYPE &&
            play.batterId === segment.batterId,
        );

      if (
        !hasExplicitEnd ||
        batterMatchedResults.length === 0
      ) {
        throw new Error(
          `game ${providerGameId} segment ` +
            `${segmentIndex} at order ` +
            `${segment.startOrder} lacks ` +
            'batter-matched terminal evidence.',
        );
      }

      const sideOpportunityIndex =
        opportunityCountByHalf[
          segment.halfInning
        ] + 1;

      opportunityCountByHalf[
        segment.halfInning
      ] = sideOpportunityIndex;

      return Object.freeze({
        gameId: providerGameId,
        inning: segment.inning,
        halfInning: segment.halfInning,
        batterId: segment.batterId,
        pitcherId: segment.pitcherId,
        startOrder: segment.startOrder,
        endOrder: segment.endOrder,
        sideOpportunityIndex,
        lineupSlot:
          ((sideOpportunityIndex - 1) % 9) + 1,
        lineupTurn:
          Math.floor(
            (sideOpportunityIndex - 1) / 9,
          ) + 1,
        batterResultTexts: Object.freeze(
          batterMatchedResults.map(
            (play) => play.text,
          ),
        ),
        playTypes: Object.freeze(
          segment.plays.map(
            (play) => play.type,
          ),
        ),
      });
    },
  );

  return Object.freeze({
    gameId: providerGameId,
    opportunityCount:
      opportunities.length,
    opportunityCountByHalf:
      Object.freeze({
        top: opportunityCountByHalf.top,
        bottom:
          opportunityCountByHalf.bottom,
      }),
    opportunities:
      Object.freeze(opportunities),
  });
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
  if (datasetSha256 !== sha256(JSON.stringify(datasetIdentity(dataset)))) {
    throw new Error('recency dataset internal SHA-256 does not match its identity.');
  }
  const periods = assertPlainObject(dataset.periods, 'periods');
  const contextRows = [];
  for (const periodId of INCLUDED_PERIODS) {
    const period = assertPlainObject(periods[periodId], `periods.${periodId}`);
    const rows = assertArray(period.rows, `periods.${periodId}.rows`);
    if (rows.length !== assertNonNegativeInteger(period.rowCount, `${periodId}.rowCount`)) {
      throw new Error(`${periodId} rowCount does not match rows.`);
    }
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
  if (
    untouchedTestReservation.rowsIncluded !== false ||
    Object.hasOwn(untouchedTestReservation, 'rows')
  ) {
    throw new Error('untouched-test rows must remain excluded from the signature audit.');
  }
  return Object.freeze({
    dataset,
    datasetSha256,
    contextRows: Object.freeze(contextRows),
    untouchedTestReservation,
  });
}

function validateSharedTestReservation(datasetReservation, captureReservation) {
  const dataset = assertPlainObject(datasetReservation, 'dataset test reservation');
  const capture = assertPlainObject(captureReservation, 'capture test reservation');
  const shared = {
    startDate: assertNonEmptyString(dataset.startDate, 'dataset test startDate'),
    endDate: assertNonEmptyString(dataset.endDate, 'dataset test endDate'),
    plateAppearanceCount: assertNonNegativeInteger(
      dataset.plateAppearanceCount,
      'dataset test plateAppearanceCount',
    ),
    rowsIncluded: dataset.rowsIncluded,
  };
  if (shared.rowsIncluded !== false || capture.rowsIncluded !== false) {
    throw new Error('untouched-test rows must remain excluded from dataset and capture.');
  }
  if (
    capture.startDate !== shared.startDate ||
    capture.endDate !== shared.endDate ||
    capture.plateAppearanceCount !== shared.plateAppearanceCount
  ) {
    throw new Error('capture and dataset untouched-test boundaries differ.');
  }
  return Object.freeze(shared);
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
  if (
    pages.length !== assertPositiveInteger(gameSummary.pageCount, 'game pageCount') ||
    pages.length !== assertPositiveInteger(manifest.pageCount, 'manifest pageCount')
  ) {
    throw new Error(`game ${gameId} page count drifted.`);
  }

  const plays = [];
  let priorOrder = null;
  let expectedCursor = null;
  for (const [index, rawPage] of pages.entries()) {
    const page = assertPlainObject(rawPage, `game ${gameId} pages[${index}]`);
    if (page.pageNumber !== index + 1 || page.requestCursor !== expectedCursor) {
      throw new Error(`game ${gameId} page sequence drifted.`);
    }
    const relativePath = assertNonEmptyString(page.filePath, 'page.filePath');
    const resolvedRoot = path.resolve(gameDirectory);
    const pagePath = path.resolve(resolvedRoot, relativePath);
    if (!pagePath.startsWith(`${resolvedRoot}${path.sep}`)) {
      throw new Error(`game ${gameId} page path escapes its capture directory.`);
    }
    const pageText = await readFile(pagePath, 'utf8');
    if (sha256(pageText) !== assertSha256(page.savedBodySha256, 'savedBodySha256')) {
      throw new Error(`game ${gameId} page ${index + 1} hash mismatch.`);
    }
    const data = assertArray(
      assertPlainObject(
        parseJson(pageText, `game ${gameId} page ${index + 1}`),
        `game ${gameId} page ${index + 1}`,
      ).data,
      `game ${gameId} page ${index + 1} data`,
    );
    if (data.length !== assertNonNegativeInteger(page.recordCount, 'page recordCount')) {
      throw new Error(`game ${gameId} page ${index + 1} record count drifted.`);
    }
    for (const rawPlay of data) {
      const play = assertPlainObject(rawPlay, `game ${gameId} raw play`);
      const order = assertInteger(play.order, `game ${gameId} play order`);
      if (priorOrder !== null && order <= priorOrder) {
        throw new Error(`game ${gameId} play order is not strictly increasing.`);
      }
      priorOrder = order;
      plays.push(play);
    }
    expectedCursor = page.nextCursor;
  }
  if (expectedCursor !== null) {
    throw new Error(`game ${gameId} capture ended before pagination completed.`);
  }
  if (
    plays.length !== assertNonNegativeInteger(gameSummary.recordCount, 'game recordCount') ||
    plays.length !== assertNonNegativeInteger(manifest.recordCount, 'manifest recordCount')
  ) {
    throw new Error(`game ${gameId} total play count drifted.`);
  }
  return Object.freeze(plays);
}

export async function runM8ContextPlaySignatureAudit({ datasetPath, captureRoot }) {
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
  if (
    assertNonNegativeInteger(captureManifest.contextRowCount, 'capture contextRowCount') !==
    validatedDataset.contextRows.length
  ) {
    throw new Error('context play capture row count drifted from the recency dataset.');
  }
  const sharedTestReservation = validateSharedTestReservation(
    validatedDataset.untouchedTestReservation,
    captureManifest.untouchedTestReservation,
  );
  if (
    captureManifest.captureSha256 !==
    sha256(JSON.stringify(captureIdentityFromManifest(captureManifest)))
  ) {
    throw new Error('context play capture identity hash is invalid.');
  }

  const gameSummaries = assertArray(captureManifest.games, 'capture games');
  if (
    gameSummaries.length !==
    assertPositiveInteger(captureManifest.gameCount, 'capture gameCount')
  ) {
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
    segmentsByGameId.set(
      gameId,
      segmentVerifiedM8ContextPlaySequence({ gameId, plays }),
    );
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
    untouchedTestReservation: sharedTestReservation,
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
