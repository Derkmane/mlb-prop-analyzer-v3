import { createHash } from 'node:crypto';
import { link, mkdir, open, readFile, unlink } from 'node:fs/promises';
import path from 'node:path';

import { normalizeBallDontLieOfficialFinalHitsV1 } from '../dist/src/adapters/providers/balldontlie/index.js';
import { settleObservedDiscreteStatisticV1 } from '../dist/src/core/index.js';

export const M10_REAL_ARCHIVE_GRADING_VERSION =
  'm10-real-saved-archive-final-hits-grading-v1';
export const M10_REAL_ARCHIVE_CAPTURE_KEY =
  '20260805T160217812Z--235bac8c330999cccfe86b6037a1007eb06f8ec23d1aacdbc3131a70d18db353';
export const M10_REAL_ARCHIVE_SHA256 =
  'f817216794f98b3c842170507f10fa0c40526f67f1cdc08084188388e5ca5b26';
export const M10_REAL_ARCHIVE_FILE_SHA256 =
  'a7feb694ee125293aa9e16eadf4bc66085e9d43ea3cc1a9d9721644460c97144';
export const M10_REAL_ARCHIVE_PROJECTION_PATH =
  'fixtures/sanitized/m10/opportunity-miner/20260805T160217812Z--235bac8c-price-projection.json';
export const M10_REAL_ARCHIVE_EXPECTED_PICK_COUNT = 78;

const EXPECTED_COLUMNS = Object.freeze([
  'rank',
  'providerEventId',
  'providerGameId',
  'providerPlayerId',
  'playerName',
  'offerType',
  'selectedSide',
  'postedLine',
  'americanPrice',
  'multiplier',
  'pWin',
  'pLoss',
  'pVoid',
  'pWinGivenGrades',
]);
const OPPORTUNITY_MINER_IDENTITIES = Object.freeze([
  Object.freeze({
    playerName: 'Buddy Kennedy',
    selectedSide: 'higher',
    postedLine: 0.5,
  }),
  Object.freeze({
    playerName: 'Grant McCray',
    selectedSide: 'higher',
    postedLine: 0.5,
  }),
  Object.freeze({
    playerName: 'Yainer Diaz',
    selectedSide: 'lower',
    postedLine: 0.5,
  }),
]);
const SHA256_PATTERN = /^[a-f0-9]{64}$/u;
const EVENT_ID_PATTERN = /^[a-f0-9]{32}$/u;
const PROBABILITY_TOLERANCE = 1e-12;

function object(value, label) {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new TypeError(`${label} must be an object.`);
  }
  return value;
}

function array(value, label) {
  if (!Array.isArray(value)) {
    throw new TypeError(`${label} must be an array.`);
  }
  return value;
}

function nonemptyString(value, label) {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new TypeError(`${label} must be a nonempty string.`);
  }
  return value;
}

function positiveInteger(value, label) {
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new TypeError(`${label} must be a positive safe integer.`);
  }
  return value;
}

function finiteNumber(value, label) {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new TypeError(`${label} must be finite.`);
  }
  return value;
}

function probability(value, label) {
  finiteNumber(value, label);
  if (value < 0 || value > 1) {
    throw new RangeError(`${label} must be in [0, 1].`);
  }
  return value;
}

function timestamp(value, label) {
  nonemptyString(value, label);
  if (!Number.isFinite(Date.parse(value))) {
    throw new TypeError(`${label} must be an ISO timestamp.`);
  }
  return value;
}

function assertSha256(value, label) {
  if (typeof value !== 'string' || !SHA256_PATTERN.test(value)) {
    throw new TypeError(`${label} must be a lowercase SHA-256.`);
  }
  return value;
}

function identityKey(providerGameId, providerPlayerId) {
  return `${providerGameId}:${providerPlayerId}`;
}

export function sha256Bytes(bytes) {
  return createHash('sha256').update(bytes).digest('hex');
}

export function canonicalJsonBytes(value) {
  return Buffer.from(`${JSON.stringify(value, null, 2)}\n`, 'utf8');
}

export function parseM10RealArchiveProjection(bytes) {
  if (!Buffer.isBuffer(bytes) && !(bytes instanceof Uint8Array)) {
    throw new TypeError('projection bytes must be a Buffer or Uint8Array.');
  }
  let parsed;
  try {
    parsed = JSON.parse(Buffer.from(bytes).toString('utf8'));
  } catch (error) {
    throw new Error(
      `Archive projection is not valid JSON: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
  const root = object(parsed, 'archive projection');
  if (root.fixtureVersion !== 1) {
    throw new Error('Archive projection fixtureVersion must equal 1.');
  }
  if (root.evidenceType !== 'real-live-board-archive-price-projection') {
    throw new Error('Archive projection evidenceType is not approved.');
  }
  if (root.synthetic !== false) {
    throw new Error('Archive projection must be real evidence, not synthetic.');
  }
  if (root.sourceCaptureKey !== M10_REAL_ARCHIVE_CAPTURE_KEY) {
    throw new Error('Archive projection capture identity drifted.');
  }
  if (root.sourceArchiveSha256 !== M10_REAL_ARCHIVE_SHA256) {
    throw new Error('Archive projection source archive SHA-256 drifted.');
  }
  if (root.sourceFileSha256 !== M10_REAL_ARCHIVE_FILE_SHA256) {
    throw new Error('Archive projection source file SHA-256 drifted.');
  }
  const columns = array(root.columns, 'archive projection columns');
  if (
    columns.length !== EXPECTED_COLUMNS.length ||
    columns.some((column, index) => column !== EXPECTED_COLUMNS[index])
  ) {
    throw new Error('Archive projection columns drifted.');
  }
  const rawRows = array(root.rows, 'archive projection rows');
  if (rawRows.length !== M10_REAL_ARCHIVE_EXPECTED_PICK_COUNT) {
    throw new Error(
      `Archive projection must contain exactly ${M10_REAL_ARCHIVE_EXPECTED_PICK_COUNT} ranked candidates; received ${rawRows.length}.`,
    );
  }
  const ranks = new Set();
  const rows = rawRows.map((rawRow, rowIndex) => {
    const row = array(rawRow, `archive projection row ${rowIndex + 1}`);
    if (row.length !== EXPECTED_COLUMNS.length) {
      throw new Error(`Archive projection row ${rowIndex + 1} has wrong width.`);
    }
    const [
      rank,
      providerEventId,
      providerGameId,
      providerPlayerId,
      playerName,
      offerType,
      selectedSide,
      postedLine,
      americanPrice,
      multiplier,
      pWin,
      pLoss,
      pVoid,
      pWinGivenGrades,
    ] = row;
    positiveInteger(rank, `row ${rowIndex + 1} rank`);
    if (rank !== rowIndex + 1 || ranks.has(rank)) {
      throw new Error('Archive projection ranks must be unique and contiguous.');
    }
    ranks.add(rank);
    if (
      typeof providerEventId !== 'string' ||
      !EVENT_ID_PATTERN.test(providerEventId)
    ) {
      throw new TypeError(`row ${rank} providerEventId is malformed.`);
    }
    positiveInteger(providerGameId, `row ${rank} providerGameId`);
    positiveInteger(providerPlayerId, `row ${rank} providerPlayerId`);
    nonemptyString(playerName, `row ${rank} playerName`);
    if (offerType !== 'baseline' && offerType !== 'alternate') {
      throw new Error(`row ${rank} offerType is unsupported.`);
    }
    if (selectedSide !== 'higher' && selectedSide !== 'lower') {
      throw new Error(`row ${rank} selectedSide is unsupported.`);
    }
    finiteNumber(postedLine, `row ${rank} postedLine`);
    if (postedLine < 0) {
      throw new RangeError(`row ${rank} postedLine must be non-negative.`);
    }
    if (!Number.isSafeInteger(americanPrice) || americanPrice === 0) {
      throw new TypeError(`row ${rank} americanPrice is malformed.`);
    }
    finiteNumber(multiplier, `row ${rank} multiplier`);
    if (multiplier <= 0) {
      throw new RangeError(`row ${rank} multiplier must be positive.`);
    }
    probability(pWin, `row ${rank} pWin`);
    probability(pLoss, `row ${rank} pLoss`);
    probability(pVoid, `row ${rank} pVoid`);
    probability(pWinGivenGrades, `row ${rank} pWinGivenGrades`);
    if (Math.abs(pWin + pLoss + pVoid - 1) > PROBABILITY_TOLERANCE) {
      throw new Error(`row ${rank} probability mass does not sum to one.`);
    }
    const gradedMass = pWin + pLoss;
    if (
      gradedMass > 0 &&
      Math.abs(pWin / gradedMass - pWinGivenGrades) > PROBABILITY_TOLERANCE
    ) {
      throw new Error(`row ${rank} P(Win | grades) drifted.`);
    }
    return Object.freeze({
      rank,
      providerEventId,
      providerGameId,
      providerPlayerId,
      playerName,
      offerType,
      selectedSide,
      postedLine,
      americanPrice,
      multiplier,
      pWin,
      pLoss,
      pVoid,
      pWinGivenGrades,
    });
  });
  const projectionSha256 = sha256Bytes(bytes);
  return Object.freeze({
    fixtureVersion: 1,
    evidenceType: root.evidenceType,
    synthetic: false,
    sourceCaptureKey: M10_REAL_ARCHIVE_CAPTURE_KEY,
    sourceArchiveSha256: M10_REAL_ARCHIVE_SHA256,
    sourceFileSha256: M10_REAL_ARCHIVE_FILE_SHA256,
    projectionSha256,
    rows: Object.freeze(rows),
  });
}

export function expectedFinalHitsIdentities(projection) {
  const byKey = new Map();
  for (const row of projection.rows) {
    const key = identityKey(row.providerGameId, row.providerPlayerId);
    if (!byKey.has(key)) {
      byKey.set(
        key,
        Object.freeze({
          providerGameId: row.providerGameId,
          providerPlayerId: row.providerPlayerId,
        }),
      );
    }
  }
  return Object.freeze(
    [...byKey.values()].sort(
      (left, right) =>
        left.providerGameId - right.providerGameId ||
        left.providerPlayerId - right.providerPlayerId,
    ),
  );
}

export function playersByGame(projection) {
  const map = new Map();
  for (const identity of expectedFinalHitsIdentities(projection)) {
    const players = map.get(identity.providerGameId) ?? [];
    players.push(identity.providerPlayerId);
    map.set(identity.providerGameId, players);
  }
  return new Map(
    [...map.entries()]
      .sort(([left], [right]) => left - right)
      .map(([gameId, playerIds]) => [
        gameId,
        Object.freeze([...playerIds].sort((left, right) => left - right)),
      ]),
  );
}

function assertNoUnexpectedStatsRows(statsResponse, expectedIdentities) {
  const response = object(statsResponse, 'stats response');
  const rows = array(response.data, 'stats response data');
  const expected = new Set(
    expectedIdentities.map((identity) =>
      identityKey(identity.providerGameId, identity.providerPlayerId),
    ),
  );
  for (const rawRow of rows) {
    const row = object(rawRow, 'stats row');
    const player = object(row.player, 'stats row player');
    const key = identityKey(row.game_id, player.id);
    if (!expected.has(key)) {
      throw new Error(`Unexpected BALLDONTLIE stats identity ${key}.`);
    }
  }
}

function snapshotMetadata(snapshot, label) {
  const value = object(snapshot, `${label} snapshot`);
  nonemptyString(value.snapshotId, `${label} snapshotId`);
  assertSha256(value.sha256, `${label} snapshot SHA-256`);
  timestamp(value.capturedAt, `${label} capturedAt`);
  return Object.freeze({
    snapshotId: value.snapshotId,
    sha256: value.sha256,
    capturedAt: value.capturedAt,
  });
}

export function buildM10RealArchiveGradeReportV1({
  projection,
  projectionPath = M10_REAL_ARCHIVE_PROJECTION_PATH,
  gradedAt,
  gameSnapshot,
  statsSnapshot,
}) {
  timestamp(gradedAt, 'gradedAt');
  const expectedIdentities = expectedFinalHitsIdentities(projection);
  assertNoUnexpectedStatsRows(statsSnapshot.response, expectedIdentities);
  const evidence = normalizeBallDontLieOfficialFinalHitsV1({
    gameSnapshot,
    statsSnapshot,
    expectedIdentities,
  });
  const evidenceByKey = new Map(
    evidence.map((item) => [
      identityKey(item.providerGameId, item.providerPlayerId),
      item,
    ]),
  );
  const gradedRows = projection.rows.map((row) => {
    const item = evidenceByKey.get(
      identityKey(row.providerGameId, row.providerPlayerId),
    );
    if (item === undefined) {
      throw new Error(`Missing normalized Hits evidence for rank ${row.rank}.`);
    }
    const settlement = settleObservedDiscreteStatisticV1({
      observedStatistic: item.officialHits,
      line: row.postedLine,
      selectedSide: row.selectedSide,
    });
    return Object.freeze({
      rank: row.rank,
      providerEventId: row.providerEventId,
      providerGameId: row.providerGameId,
      providerPlayerId: row.providerPlayerId,
      playerName: row.playerName,
      offerType: row.offerType,
      selectedSide: row.selectedSide,
      postedLine: row.postedLine,
      archivedPWin: row.pWin,
      archivedPLoss: row.pLoss,
      archivedPVoid: row.pVoid,
      archivedPWinGivenGrades: row.pWinGivenGrades,
      officialHits: item.officialHits,
      outcome: settlement.outcome,
      settlementVersion: settlement.version,
    });
  });
  const wins = gradedRows.filter((row) => row.outcome === 'win').length;
  const losses = gradedRows.filter((row) => row.outcome === 'loss').length;
  const voids = gradedRows.filter((row) => row.outcome === 'void').length;
  const decidedRows = gradedRows.filter((row) => row.outcome !== 'void');
  const observedWinRate =
    decidedRows.length === 0 ? null : wins / decidedRows.length;
  const predictedMeanWinProbability =
    decidedRows.length === 0
      ? null
      : decidedRows.reduce(
          (total, row) => total + row.archivedPWinGivenGrades,
          0,
        ) / decidedRows.length;
  const expectedWins = decidedRows.reduce(
    (total, row) => total + row.archivedPWinGivenGrades,
    0,
  );
  const binaryBrier =
    decidedRows.length === 0
      ? null
      : decidedRows.reduce((total, row) => {
          const observed = row.outcome === 'win' ? 1 : 0;
          return total + (row.archivedPWinGivenGrades - observed) ** 2;
        }, 0) / decidedRows.length;
  const opportunityMinerPicks = OPPORTUNITY_MINER_IDENTITIES.map(
    (identity) => {
      const matches = gradedRows.filter(
        (row) =>
          row.playerName === identity.playerName &&
          row.selectedSide === identity.selectedSide &&
          row.postedLine === identity.postedLine,
      );
      if (matches.length !== 1) {
        throw new Error(
          `Expected exactly one Opportunity Miner grade for ${identity.playerName}; received ${matches.length}.`,
        );
      }
      return matches[0];
    },
  );
  return Object.freeze({
    reportVersion: M10_REAL_ARCHIVE_GRADING_VERSION,
    reportType: 'real-archived-board-official-hits-grade',
    gradedAt,
    source: Object.freeze({
      captureKey: projection.sourceCaptureKey,
      archiveSha256: projection.sourceArchiveSha256,
      archiveFileSha256: projection.sourceFileSha256,
      projectionPath,
      projectionSha256: projection.projectionSha256,
      archivedCandidateCount: projection.rows.length,
      archiveModified: false,
    }),
    providerEvidence: Object.freeze({
      provider: 'balldontlie-mlb',
      requiredGameStatus: 'STATUS_FINAL',
      join: 'exact providerGameId + providerPlayerId',
      officialStatistic: 'hits',
      games: snapshotMetadata(gameSnapshot, 'game'),
      stats: snapshotMetadata(statsSnapshot, 'stats'),
    }),
    summary: Object.freeze({
      picksGraded: gradedRows.length,
      wins,
      losses,
      voids,
      decidedPicks: decidedRows.length,
      observedWinRate,
      predictedMeanWinProbability,
      observedMinusPredicted:
        observedWinRate === null || predictedMeanWinProbability === null
          ? null
          : observedWinRate - predictedMeanWinProbability,
      expectedWins,
      actualMinusExpectedWins: wins - expectedWins,
      binaryBrier,
    }),
    opportunityMinerPicks: Object.freeze(opportunityMinerPicks),
    rows: Object.freeze(gradedRows),
    safety: Object.freeze({
      productionEnabled: false,
      rankingEnabled: false,
      archiveModified: false,
      activeFeatureImports: 0,
    }),
  });
}

export function buildM10RealArchiveStatusReportV1({
  projection,
  checkedAt,
  attemptId,
  games,
  outcome,
  detail,
}) {
  timestamp(checkedAt, 'checkedAt');
  nonemptyString(attemptId, 'attemptId');
  nonemptyString(outcome, 'outcome');
  nonemptyString(detail, 'detail');
  const statuses = array(games, 'games').map((rawGame) => {
    const game = object(rawGame, 'game');
    positiveInteger(game.id, 'game id');
    nonemptyString(game.status, 'game status');
    timestamp(game.date, 'game date');
    return Object.freeze({
      providerGameId: game.id,
      status: game.status,
      date: game.date,
    });
  });
  return Object.freeze({
    reportVersion: M10_REAL_ARCHIVE_GRADING_VERSION,
    reportType: 'real-archived-board-grading-attempt',
    attemptId,
    checkedAt,
    source: Object.freeze({
      captureKey: projection.sourceCaptureKey,
      archiveSha256: projection.sourceArchiveSha256,
      archiveFileSha256: projection.sourceFileSha256,
      projectionSha256: projection.projectionSha256,
      archivedCandidateCount: projection.rows.length,
      archiveModified: false,
    }),
    requiredGameStatus: 'STATUS_FINAL',
    games: Object.freeze(statuses),
    outcome,
    detail,
    safety: Object.freeze({
      productionEnabled: false,
      rankingEnabled: false,
      archiveModified: false,
    }),
  });
}

export async function persistImmutableJson(filePath, value) {
  const bytes = canonicalJsonBytes(value);
  const directory = path.dirname(filePath);
  await mkdir(directory, { recursive: true });
  const temporaryPath = `${filePath}.tmp-${process.pid}-${Date.now()}`;
  let handle;
  try {
    handle = await open(temporaryPath, 'wx', 0o600);
    await handle.writeFile(bytes);
    await handle.sync();
    await handle.close();
    handle = undefined;
    try {
      await link(temporaryPath, filePath);
    } catch (error) {
      if (error && typeof error === 'object' && error.code === 'EEXIST') {
        throw new Error(`Immutable report already exists: ${filePath}`);
      }
      throw error;
    }
    const directoryHandle = await open(directory, 'r');
    try {
      await directoryHandle.sync();
    } finally {
      await directoryHandle.close();
    }
    const readBack = await readFile(filePath);
    if (!readBack.equals(bytes)) {
      throw new Error(`Immutable report read-back mismatch: ${filePath}`);
    }
    return Object.freeze({
      filePath,
      byteLength: bytes.length,
      sha256: sha256Bytes(bytes),
    });
  } finally {
    if (handle !== undefined) {
      await handle.close().catch(() => undefined);
    }
    await unlink(temporaryPath).catch((error) => {
      if (!error || typeof error !== 'object' || error.code !== 'ENOENT') {
        throw error;
      }
    });
  }
}
