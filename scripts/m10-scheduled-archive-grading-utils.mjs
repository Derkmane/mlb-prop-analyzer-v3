import { createHash } from 'node:crypto';

import { normalizeBallDontLieOfficialFinalHitsV1 } from '../dist/src/adapters/providers/balldontlie/index.js';
import { settleObservedDiscreteStatisticV1 } from '../dist/src/core/index.js';

export const M10_SCHEDULED_ARCHIVE_GRADING_VERSION =
  'm10-scheduled-saved-archive-final-hits-grading-v1';
export const M9_SCHEDULED_ARCHIVE_CONTRACT =
  'm9-batter-hits-prospective-capture-snapshot-v2';
export const M9_SCHEDULED_ARCHIVE_VERSION = 2;

export const M10_CALIBRATION_BUCKETS = Object.freeze([
  Object.freeze({ label: 'Below 50%', lowerInclusive: 0, upperExclusive: 0.5 }),
  Object.freeze({ label: '50-55%', lowerInclusive: 0.5, upperExclusive: 0.55 }),
  Object.freeze({ label: '55-60%', lowerInclusive: 0.55, upperExclusive: 0.6 }),
  Object.freeze({ label: '60-65%', lowerInclusive: 0.6, upperExclusive: 0.65 }),
  Object.freeze({ label: '65-70%', lowerInclusive: 0.65, upperExclusive: 0.7 }),
  Object.freeze({ label: '70-75%', lowerInclusive: 0.7, upperExclusive: 0.75 }),
  Object.freeze({ label: '75-80%', lowerInclusive: 0.75, upperExclusive: 0.8 }),
  Object.freeze({ label: '80%+', lowerInclusive: 0.8, upperExclusive: null }),
]);

const CAPTURE_KEY_PATTERN = /^\d{8}T\d{9}Z--[a-f0-9]{64}$/u;
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
  if (typeof value !== 'string' || value.length === 0) {
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

function sha256Value(value, label) {
  if (typeof value !== 'string' || !SHA256_PATTERN.test(value)) {
    throw new TypeError(`${label} must be a lowercase SHA-256.`);
  }
  return value;
}

function stableJson(value) {
  if (
    value === null ||
    typeof value === 'boolean' ||
    typeof value === 'string' ||
    typeof value === 'number'
  ) {
    if (typeof value === 'number' && !Number.isFinite(value)) {
      throw new TypeError('Stable JSON values must contain only finite numbers.');
    }
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map((entry) => stableJson(entry)).join(',')}]`;
  }
  if (typeof value === 'object') {
    return `{${Object.keys(value)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${stableJson(value[key])}`)
      .join(',')}}`;
  }
  throw new TypeError('Stable JSON values must be JSON-compatible.');
}

export function sha256Bytes(value) {
  return createHash('sha256').update(value).digest('hex');
}

function identityKey(providerGameId, providerPlayerId) {
  return `${providerGameId}:${providerPlayerId}`;
}

function projectedRow(rawRow, index) {
  const row = object(rawRow, `rankedRows[${index}]`);
  const rank = positiveInteger(row.rank, `rankedRows[${index}].rank`);
  if (rank !== index + 1) {
    throw new Error('Archive ranks must be contiguous and preserve array order.');
  }
  const offer = object(
    row.normalizedOffer,
    `rankedRows[${index}].normalizedOffer`,
  );
  const probabilities = object(
    row.probabilities,
    `rankedRows[${index}].probabilities`,
  );
  const candidate = object(row.candidate, `rankedRows[${index}].candidate`);
  const providerEventId = nonemptyString(
    offer.providerEventId,
    `rankedRows[${index}].providerEventId`,
  );
  if (!EVENT_ID_PATTERN.test(providerEventId)) {
    throw new TypeError(`rankedRows[${index}].providerEventId is malformed.`);
  }
  const providerGameId = positiveInteger(
    offer.providerGameId,
    `rankedRows[${index}].providerGameId`,
  );
  const providerPlayerId = positiveInteger(
    offer.providerPlayerId,
    `rankedRows[${index}].providerPlayerId`,
  );
  const playerName = nonemptyString(
    offer.playerName,
    `rankedRows[${index}].playerName`,
  );
  const offerType = nonemptyString(
    offer.offerType,
    `rankedRows[${index}].offerType`,
  );
  if (offerType !== 'baseline' && offerType !== 'alternate') {
    throw new Error(`rankedRows[${index}].offerType is unsupported.`);
  }
  const selectedSide = nonemptyString(
    offer.selectedSide,
    `rankedRows[${index}].selectedSide`,
  );
  if (selectedSide !== 'higher' && selectedSide !== 'lower') {
    throw new Error(`rankedRows[${index}].selectedSide is unsupported.`);
  }
  const postedLine = finiteNumber(
    offer.postedLine,
    `rankedRows[${index}].postedLine`,
  );
  if (postedLine < 0) {
    throw new RangeError(`rankedRows[${index}].postedLine must be non-negative.`);
  }
  const pWin = probability(
    probabilities.pWin,
    `rankedRows[${index}].pWin`,
  );
  const pLoss = probability(
    probabilities.pLoss,
    `rankedRows[${index}].pLoss`,
  );
  const pVoid = probability(
    probabilities.pVoid,
    `rankedRows[${index}].pVoid`,
  );
  const pWinGivenGrades = probability(
    probabilities.pWinGivenGrades,
    `rankedRows[${index}].pWinGivenGrades`,
  );
  if (Math.abs(pWin + pLoss + pVoid - 1) > PROBABILITY_TOLERANCE) {
    throw new Error(`rankedRows[${index}] probability mass does not sum to one.`);
  }
  const gradedMass = pWin + pLoss;
  if (
    gradedMass > 0 &&
    Math.abs(pWin / gradedMass - pWinGivenGrades) > PROBABILITY_TOLERANCE
  ) {
    throw new Error(`rankedRows[${index}] P(Win | grades) drifted.`);
  }
  if (
    candidate.eventId !== providerEventId ||
    Number(candidate.gameId) !== providerGameId ||
    Number(candidate.playerId) !== providerPlayerId ||
    candidate.selectedSide !== selectedSide ||
    candidate.line !== postedLine ||
    candidate.pWin !== pWin ||
    candidate.pLoss !== pLoss ||
    candidate.pVoid !== pVoid ||
    candidate.pWinGivenGrades !== pWinGivenGrades
  ) {
    throw new Error(`rankedRows[${index}] candidate identity or probability drifted.`);
  }
  if (candidate.baseMarketKey !== 'batter-hits') {
    throw new Error(`rankedRows[${index}] is not a Batter Hits candidate.`);
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
    pWin,
    pLoss,
    pVoid,
    pWinGivenGrades,
  });
}

export function verifyAndProjectM9ArchiveBytes({
  bytes,
  archivePath,
  expectedCaptureKey = null,
}) {
  if (!Buffer.isBuffer(bytes) && !(bytes instanceof Uint8Array)) {
    throw new TypeError('archive bytes must be a Buffer or Uint8Array.');
  }
  nonemptyString(archivePath, 'archivePath');
  const buffer = Buffer.from(bytes);
  const text = buffer.toString('utf8');
  if (!Buffer.from(text, 'utf8').equals(buffer)) {
    throw new Error('Archive bytes must be valid UTF-8.');
  }
  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch (error) {
    throw new Error(
      `Archive is not valid JSON: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
  const archive = object(parsed, 'archive');
  if (archive.archiveVersion !== M9_SCHEDULED_ARCHIVE_VERSION) {
    throw new Error(`Archive version must equal ${M9_SCHEDULED_ARCHIVE_VERSION}.`);
  }
  if (archive.archiveContract !== M9_SCHEDULED_ARCHIVE_CONTRACT) {
    throw new Error('Archive contract is unsupported.');
  }
  if (
    archive.productionEnabled !== false ||
    archive.productionRankingEnabled !== false ||
    archive.gradingPerformed !== false
  ) {
    throw new Error(
      'Archive must remain production-disabled, ranking-disabled, and unmodified by grading.',
    );
  }
  const identity = object(archive.captureIdentity, 'archive.captureIdentity');
  const capturedAt = new Date(
    timestamp(archive.capturedAt, 'archive.capturedAt'),
  ).toISOString();
  if (identity.capturedAt !== capturedAt) {
    throw new Error('Archive capture timestamp identity drifted.');
  }
  const rawProviderSnapshotSha256 = sha256Value(
    identity.rawProviderSnapshotSha256,
    'archive.captureIdentity.rawProviderSnapshotSha256',
  );
  const captureKey = nonemptyString(
    identity.captureKey,
    'archive.captureIdentity.captureKey',
  );
  const reconstructedCaptureKey = `${capturedAt.replace(/[-:.]/gu, '')}--${rawProviderSnapshotSha256}`;
  if (
    !CAPTURE_KEY_PATTERN.test(captureKey) ||
    captureKey !== reconstructedCaptureKey
  ) {
    throw new Error('Archive capture key identity drifted.');
  }
  if (expectedCaptureKey !== null && captureKey !== expectedCaptureKey) {
    throw new Error(
      `Archive capture key mismatch: expected ${expectedCaptureKey}, received ${captureKey}.`,
    );
  }
  const archiveSha256 = sha256Value(
    archive.archiveSha256,
    'archive.archiveSha256',
  );
  const { archiveSha256: ignoredArchiveSha256, ...archiveIdentity } = archive;
  void ignoredArchiveSha256;
  if (sha256Bytes(stableJson(archiveIdentity)) !== archiveSha256) {
    throw new Error('Archive internal SHA-256 verification failed.');
  }
  const rankedRows = array(archive.rankedRows, 'archive.rankedRows');
  if (rankedRows.length === 0) {
    throw new Error('Archive must contain at least one ranked row.');
  }
  const counts = object(archive.counts, 'archive.counts');
  if (
    counts.rankedCandidateCount !== rankedRows.length ||
    counts.composedCandidateCount !== rankedRows.length ||
    counts.normalizedOfferCount !== array(
      archive.normalizedOffers,
      'archive.normalizedOffers',
    ).length ||
    counts.providerSnapshotCount !== array(
      archive.providerSnapshots,
      'archive.providerSnapshots',
    ).length ||
    counts.exclusionCount !== array(archive.exclusions, 'archive.exclusions').length
  ) {
    throw new Error('Archive count metadata drifted.');
  }
  const rows = Object.freeze(rankedRows.map(projectedRow));
  return Object.freeze({
    sourceCaptureKey: captureKey,
    sourceArchiveSha256: archiveSha256,
    sourceFileSha256: sha256Bytes(buffer),
    sourceArchivePath: archivePath,
    capturedAt,
    rows,
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
  const byGame = new Map();
  for (const identity of expectedFinalHitsIdentities(projection)) {
    const players = byGame.get(identity.providerGameId) ?? [];
    players.push(identity.providerPlayerId);
    byGame.set(identity.providerGameId, players);
  }
  return new Map(
    [...byGame.entries()]
      .sort(([left], [right]) => left - right)
      .map(([gameId, playerIds]) => [
        gameId,
        Object.freeze([...playerIds].sort((left, right) => left - right)),
      ]),
  );
}

export function classifyArchiveGameStatuses(projection, rawGames) {
  const expectedGameIds = [...playersByGame(projection).keys()];
  const games = array(rawGames, 'games');
  const byId = new Map();
  for (const rawGame of games) {
    const game = object(rawGame, 'game');
    const id = positiveInteger(game.id, 'game.id');
    nonemptyString(game.status, 'game.status');
    timestamp(game.date, 'game.date');
    if (byId.has(id)) {
      throw new Error(`Duplicate game status row ${id}.`);
    }
    byId.set(id, game);
  }
  const unexpected = [...byId.keys()].filter(
    (gameId) => !expectedGameIds.includes(gameId),
  );
  if (unexpected.length > 0) {
    throw new Error(`Unexpected game status identities: ${unexpected.join(', ')}.`);
  }
  const ordered = expectedGameIds.map((gameId) => {
    const game = byId.get(gameId);
    if (game === undefined) {
      throw new Error(`Missing game status row ${gameId}.`);
    }
    return Object.freeze({
      providerGameId: gameId,
      status: game.status,
      date: game.date,
    });
  });
  const nonFinalGames = ordered.filter((game) => game.status !== 'STATUS_FINAL');
  return Object.freeze({
    readyToGrade: nonFinalGames.length === 0,
    games: Object.freeze(ordered),
    nonFinalGames: Object.freeze(nonFinalGames),
  });
}

function assertNoUnexpectedStatsRows(statsResponse, expectedIdentities) {
  const response = object(statsResponse, 'stats response');
  const rows = array(response.data, 'stats response.data');
  const expected = new Set(
    expectedIdentities.map((identity) =>
      identityKey(identity.providerGameId, identity.providerPlayerId),
    ),
  );
  for (const rawRow of rows) {
    const row = object(rawRow, 'stats row');
    const player = object(row.player, 'stats row.player');
    const key = identityKey(row.game_id, player.id);
    if (!expected.has(key)) {
      throw new Error(`Unexpected BALLDONTLIE stats identity ${key}.`);
    }
  }
}

function snapshotMetadata(snapshot, label) {
  const value = object(snapshot, `${label} snapshot`);
  nonemptyString(value.snapshotId, `${label}.snapshotId`);
  sha256Value(value.sha256, `${label}.sha256`);
  timestamp(value.capturedAt, `${label}.capturedAt`);
  return Object.freeze({
    snapshotId: value.snapshotId,
    sha256: value.sha256,
    capturedAt: value.capturedAt,
  });
}

export function buildCalibrationBreakdown(gradedRows) {
  const rows = array(gradedRows, 'gradedRows');
  const buckets = M10_CALIBRATION_BUCKETS.map((definition) => {
    const bucketRows = rows.filter((row) => {
      const probabilityValue = probability(
        row.archivedPWinGivenGrades,
        'graded row archivedPWinGivenGrades',
      );
      return (
        probabilityValue >= definition.lowerInclusive &&
        (definition.upperExclusive === null ||
          probabilityValue < definition.upperExclusive)
      );
    });
    const decided = bucketRows.filter((row) => row.outcome !== 'void');
    const wins = decided.filter((row) => row.outcome === 'win').length;
    const losses = decided.filter((row) => row.outcome === 'loss').length;
    const voids = bucketRows.filter((row) => row.outcome === 'void').length;
    const predictedMeanProbability =
      decided.length === 0
        ? null
        : decided.reduce(
            (total, row) => total + row.archivedPWinGivenGrades,
            0,
          ) / decided.length;
    const observedWinRate = decided.length === 0 ? null : wins / decided.length;
    return Object.freeze({
      label: definition.label,
      lowerInclusive: definition.lowerInclusive,
      upperExclusive: definition.upperExclusive,
      totalPicks: bucketRows.length,
      decidedPicks: decided.length,
      wins,
      losses,
      voids,
      predictedMeanProbability,
      observedWinRate,
      observedMinusPredicted:
        observedWinRate === null || predictedMeanProbability === null
          ? null
          : observedWinRate - predictedMeanProbability,
    });
  });
  const conservedCount = buckets.reduce(
    (total, bucket) => total + bucket.totalPicks,
    0,
  );
  if (conservedCount !== rows.length) {
    throw new Error(
      `Calibration buckets must conserve every graded row; expected ${rows.length}, received ${conservedCount}.`,
    );
  }
  return Object.freeze(buckets);
}

export function buildScheduledArchiveGradeReportV1({
  projection,
  gradedAt,
  gameSnapshot,
  statsSnapshot,
}) {
  timestamp(gradedAt, 'gradedAt');
  const status = classifyArchiveGameStatuses(
    projection,
    object(gameSnapshot.response, 'gameSnapshot.response').data,
  );
  if (!status.readyToGrade) {
    const detail = status.nonFinalGames
      .map((game) => `${game.providerGameId}:${game.status}`)
      .join(', ');
    throw new Error(`Archive games are not all STATUS_FINAL: ${detail}.`);
  }
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
      ...row,
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
  return Object.freeze({
    reportVersion: M10_SCHEDULED_ARCHIVE_GRADING_VERSION,
    reportType: 'scheduled-real-archived-board-official-hits-grade',
    gradedAt,
    source: Object.freeze({
      captureKey: projection.sourceCaptureKey,
      archiveSha256: projection.sourceArchiveSha256,
      archiveFileSha256: projection.sourceFileSha256,
      archivePath: projection.sourceArchivePath,
      archivedCandidateCount: projection.rows.length,
      archiveModified: false,
    }),
    providerEvidence: Object.freeze({
      provider: 'balldontlie-mlb',
      requiredGameStatus: 'STATUS_FINAL',
      join: 'exact providerGameId + providerPlayerId',
      officialStatistic: 'hits',
      games: snapshotMetadata(gameSnapshot, 'games'),
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
    calibration: buildCalibrationBreakdown(gradedRows),
    rows: Object.freeze(gradedRows),
    safety: Object.freeze({
      productionEnabled: false,
      rankingEnabled: false,
      archiveModified: false,
      activeFeatureImports: 0,
    }),
  });
}

export function buildScheduledArchiveStatusReportV1({
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
  const status = classifyArchiveGameStatuses(projection, games);
  return Object.freeze({
    reportVersion: M10_SCHEDULED_ARCHIVE_GRADING_VERSION,
    reportType: 'scheduled-real-archived-board-grading-attempt',
    attemptId,
    checkedAt,
    source: Object.freeze({
      captureKey: projection.sourceCaptureKey,
      archiveSha256: projection.sourceArchiveSha256,
      archiveFileSha256: projection.sourceFileSha256,
      archivePath: projection.sourceArchivePath,
      archivedCandidateCount: projection.rows.length,
      archiveModified: false,
    }),
    requiredGameStatus: 'STATUS_FINAL',
    games: status.games,
    outcome,
    detail,
    safety: Object.freeze({
      productionEnabled: false,
      rankingEnabled: false,
      archiveModified: false,
    }),
  });
}
