import { SETTLEMENT_REGISTRY } from '../dist/src/composition/registries.js';
import { settleObservedDiscreteStatisticV1 } from '../dist/src/core/index.js';
import {
  BATTER_HITS_MARKET_KEY,
  BATTER_HITS_SETTLEMENT_RULE_VERSION,
} from '../dist/src/features/batter-hits/index.js';
import { M10_CALIBRATION_BUCKETS } from './m10-scheduled-archive-grading-utils.mjs';

export const M10_BATTER_HITS_GRADE_VERSION_V2 =
  'm10-scheduled-saved-archive-final-hits-grading-v2';
export const M10_BATTER_HITS_GRADE_REPORT_TYPE_V2 =
  'scheduled-real-archived-board-official-hits-grade-v2';

const PROBABILITY_TOLERANCE = 1e-12;

export class BatterHitsCaptureEvidenceError extends Error {
  constructor({ code, providerGameId, providerPlayerId, message }) {
    super(message);
    this.name = 'BatterHitsCaptureEvidenceError';
    this.code = code;
    this.providerGameId = providerGameId;
    this.providerPlayerId = providerPlayerId;
    this.providerIdentity = `${providerGameId}:${providerPlayerId}`;
  }
}

function object(value, label) {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new TypeError(`${label} must be an object.`);
  }
  return value;
}

function array(value, label) {
  if (!Array.isArray(value)) throw new TypeError(`${label} must be an array.`);
  return value;
}

function nonemptyString(value, label) {
  if (typeof value !== 'string' || value.length === 0) {
    throw new TypeError(`${label} must be a nonempty string.`);
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

function probability(value, label) {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0 || value > 1) {
    throw new TypeError(`${label} must be a probability in [0, 1].`);
  }
  return value;
}

function captureEvidenceError(row, code, message) {
  return new BatterHitsCaptureEvidenceError({
    code,
    providerGameId: row.providerGameId,
    providerPlayerId: row.providerPlayerId,
    message,
  });
}

function registeredBatterHitsSettlementRule() {
  const matches = SETTLEMENT_REGISTRY.rules.filter(
    (rule) =>
      rule.baseMarketKey === BATTER_HITS_MARKET_KEY &&
      rule.version === BATTER_HITS_SETTLEMENT_RULE_VERSION,
  );
  if (matches.length !== 1) {
    throw new Error(
      `Expected exactly one registered ${BATTER_HITS_SETTLEMENT_RULE_VERSION} rule; received ${matches.length}.`,
    );
  }
  const rule = matches[0];
  if (rule.officialSettlementStatistic !== 'hits') {
    throw new Error('Registered Batter Hits settlement statistic drifted.');
  }
  if (!rule.voidConditions.includes('batter absent from the official starting lineup')) {
    throw new Error(
      'Registered Batter Hits settlement rule no longer voids a batter absent from the official starting lineup.',
    );
  }
  return rule;
}

function requiredGameIds(projection) {
  return [...new Set(projection.rows.map((row) => row.providerGameId))].sort((a, b) => a - b);
}

function gameForRow(gameSnapshot, row) {
  const games = array(object(gameSnapshot.response, 'gameSnapshot.response').data, 'gameSnapshot.response.data');
  const matches = games.filter((game) => game?.id === row.providerGameId);
  if (matches.length !== 1) {
    throw captureEvidenceError(
      row,
      'FINAL_GAME_IDENTITY_COUNT',
      `Batter Hits final evidence for game ${row.providerGameId} requires exactly one game row.`,
    );
  }
  const game = matches[0];
  if (game?.status !== 'STATUS_FINAL') {
    throw captureEvidenceError(
      row,
      'FINAL_GAME_NOT_FINAL',
      `Batter Hits final evidence for game ${row.providerGameId} is not exactly STATUS_FINAL.`,
    );
  }
  const homeTeamName = game?.home_team?.display_name;
  const awayTeamName = game?.away_team?.display_name;
  if (typeof homeTeamName !== 'string' || homeTeamName.length === 0) {
    throw captureEvidenceError(row, 'FINAL_HOME_TEAM_MISSING', `Game ${row.providerGameId} is missing home_team.display_name.`);
  }
  if (typeof awayTeamName !== 'string' || awayTeamName.length === 0) {
    throw captureEvidenceError(row, 'FINAL_AWAY_TEAM_MISSING', `Game ${row.providerGameId} is missing away_team.display_name.`);
  }
  return Object.freeze({ game, homeTeamName, awayTeamName });
}

function coverageForGame(snapshot, row, label) {
  const coverage = array(snapshot.gameCoverage, `${label}.gameCoverage`);
  const matches = coverage.filter((entry) => entry?.gameId === row.providerGameId);
  if (matches.length !== 1) {
    throw captureEvidenceError(
      row,
      `${label.toUpperCase()}_COVERAGE_COUNT`,
      `${label} evidence for game ${row.providerGameId} requires exactly one coverage row.`,
    );
  }
  const entry = matches[0];
  if (entry?.paginationComplete !== true) {
    throw captureEvidenceError(
      row,
      `${label.toUpperCase()}_PAGINATION_INCOMPLETE`,
      `${label} evidence for game ${row.providerGameId} is not pagination-complete.`,
    );
  }
  if (!Number.isSafeInteger(entry.rowCount) || entry.rowCount < 0) {
    throw captureEvidenceError(
      row,
      `${label.toUpperCase()}_ROW_COUNT_INVALID`,
      `${label} evidence for game ${row.providerGameId} has an invalid row count.`,
    );
  }
  return entry;
}

function fullGameStatsRows(statsSnapshot, game, row) {
  const response = object(statsSnapshot.response, 'statsSnapshot.response');
  const rows = array(response.data, 'statsSnapshot.response.data').filter(
    (entry) => entry?.game_id === row.providerGameId,
  );
  const coverage = coverageForGame(statsSnapshot, row, 'stats');
  if (rows.length !== coverage.rowCount) {
    throw captureEvidenceError(
      row,
      'STATS_ROW_COUNT_DRIFT',
      `Batter Hits stats response for game ${row.providerGameId} drifted from persisted coverage.`,
    );
  }
  if (rows.length === 0) {
    throw captureEvidenceError(row, 'STATS_EMPTY', `Batter Hits stats response for game ${row.providerGameId} is empty.`);
  }
  const seenPlayers = new Set();
  for (const statsRow of rows) {
    const playerId = statsRow?.player?.id;
    if (!Number.isSafeInteger(playerId) || playerId <= 0) {
      throw captureEvidenceError(row, 'STATS_PLAYER_ID_INVALID', `Game ${row.providerGameId} contains a stats row without a valid player.id.`);
    }
    if (seenPlayers.has(playerId)) {
      throw captureEvidenceError(row, 'STATS_PLAYER_DUPLICATE', `Game ${row.providerGameId} contains duplicate stats player ${playerId}.`);
    }
    seenPlayers.add(playerId);
    if (typeof statsRow?.team_name !== 'string' || statsRow.team_name.length === 0) {
      throw captureEvidenceError(row, 'STATS_TEAM_NAME_INVALID', `Game ${row.providerGameId} contains a stats row without team_name.`);
    }
  }
  const teamNames = new Set(rows.map((entry) => entry.team_name));
  for (const expected of [game.awayTeamName, game.homeTeamName]) {
    if (!teamNames.has(expected)) {
      throw captureEvidenceError(
        row,
        'STATS_TEAM_MISSING',
        `Batter Hits stats response for game ${row.providerGameId} is incomplete because team ${expected} is absent.`,
      );
    }
  }
  return rows;
}

function fullGameLineupRows(lineupSnapshot, game, row) {
  const response = object(lineupSnapshot.response, 'lineupSnapshot.response');
  const rows = array(response.data, 'lineupSnapshot.response.data').filter(
    (entry) => entry?.game_id === row.providerGameId,
  );
  const coverage = coverageForGame(lineupSnapshot, row, 'lineup');
  if (rows.length !== coverage.rowCount) {
    throw captureEvidenceError(
      row,
      'LINEUP_ROW_COUNT_DRIFT',
      `Batter Hits lineup response for game ${row.providerGameId} drifted from persisted coverage.`,
    );
  }
  if (rows.length === 0) {
    throw captureEvidenceError(
      row,
      'LINEUP_EMPTY',
      `Batter Hits lineup response for game ${row.providerGameId} is empty; nonstarter absence cannot be inferred.`,
    );
  }
  const seenPlayers = new Set();
  for (const lineupRow of rows) {
    const playerId = lineupRow?.player?.id;
    if (!Number.isSafeInteger(playerId) || playerId <= 0) {
      throw captureEvidenceError(row, 'LINEUP_PLAYER_ID_INVALID', `Game ${row.providerGameId} contains a lineup row without a valid player.id.`);
    }
    if (seenPlayers.has(playerId)) {
      throw captureEvidenceError(row, 'LINEUP_PLAYER_DUPLICATE', `Game ${row.providerGameId} contains duplicate lineup player ${playerId}.`);
    }
    seenPlayers.add(playerId);
    const teamName = lineupRow?.team?.display_name;
    if (typeof teamName !== 'string' || teamName.length === 0) {
      throw captureEvidenceError(row, 'LINEUP_TEAM_NAME_INVALID', `Game ${row.providerGameId} contains a lineup row without team.display_name.`);
    }
  }
  const teamNames = new Set(rows.map((entry) => entry.team.display_name));
  for (const expected of [game.awayTeamName, game.homeTeamName]) {
    if (!teamNames.has(expected)) {
      throw captureEvidenceError(
        row,
        'LINEUP_TEAM_MISSING',
        `Batter Hits lineup response for game ${row.providerGameId} is incomplete because team ${expected} is absent.`,
      );
    }
  }
  return rows;
}

function gradeRow({ row, index, gameSnapshot, statsSnapshot, lineupSnapshot, rule }) {
  const game = gameForRow(gameSnapshot, row);
  const statsRows = fullGameStatsRows(statsSnapshot, game, row);
  const officialMatches = statsRows.filter(
    (entry) => entry?.player?.id === row.providerPlayerId,
  );
  if (officialMatches.length > 1) {
    throw captureEvidenceError(
      row,
      'OFFICIAL_STATS_IDENTITY_DUPLICATE',
      `Duplicate official Batter Hits stat identity ${row.providerGameId}:${row.providerPlayerId}.`,
    );
  }
  if (officialMatches.length === 1) {
    const officialHits = officialMatches[0]?.hits;
    if (!Number.isSafeInteger(officialHits) || officialHits < 0) {
      throw captureEvidenceError(
        row,
        'OFFICIAL_HITS_MALFORMED',
        `Official Hits for ${row.providerGameId}:${row.providerPlayerId} is malformed.`,
      );
    }
    const settlement = settleObservedDiscreteStatisticV1({
      observedStatistic: officialHits,
      line: row.postedLine,
      selectedSide: row.selectedSide,
    });
    return Object.freeze({
      ...row,
      archivedPWin: row.pWin,
      archivedPLoss: row.pLoss,
      archivedPVoid: row.pVoid,
      archivedPWinGivenGrades: row.pWinGivenGrades,
      officialHits,
      outcome: settlement.outcome,
      settlementVersion: rule.version,
      coreSettlementVersion: settlement.version,
      settlementReason: 'official-final-hits',
    });
  }

  const lineupRows = fullGameLineupRows(lineupSnapshot, game, row);
  const lineupMatches = lineupRows.filter(
    (entry) => entry?.player?.id === row.providerPlayerId,
  );
  if (lineupMatches.length > 0) {
    throw captureEvidenceError(
      row,
      'LIVE_LINEUP_CONTRADICTION',
      `Missing official Batter Hits stats for ${row.providerGameId}:${row.providerPlayerId}, but the player is present in the complete final-game lineup evidence.`,
    );
  }
  return Object.freeze({
    ...row,
    archivedPWin: row.pWin,
    archivedPLoss: row.pLoss,
    archivedPVoid: row.pVoid,
    archivedPWinGivenGrades: row.pWinGivenGrades,
    officialHits: null,
    outcome: 'void',
    settlementVersion: rule.version,
    coreSettlementVersion: null,
    settlementReason: 'verified-final-nonstarter',
    gradingSettlement: Object.freeze({
      eligibilityProbability: 0,
      winProbability: 0,
      lossProbability: 0,
      voidProbability: 1,
      winProbabilityGivenGrades: null,
      settlementRuleVersion: rule.version,
      ruleSourceReference: rule.ruleSourceReference,
    }),
  });
}

function performanceSummary(rows) {
  const wins = rows.filter((row) => row.outcome === 'win').length;
  const losses = rows.filter((row) => row.outcome === 'loss').length;
  const voids = rows.filter((row) => row.outcome === 'void').length;
  const decided = rows.filter((row) => row.outcome !== 'void');
  const expectedWins = decided.reduce(
    (total, row) => total + row.archivedPWinGivenGrades,
    0,
  );
  const observedWinRate = decided.length === 0 ? null : wins / decided.length;
  const predictedMeanWinProbability = decided.length === 0 ? null : expectedWins / decided.length;
  const binaryBrier = decided.length === 0
    ? null
    : decided.reduce((total, row) => {
        const observed = row.outcome === 'win' ? 1 : 0;
        return total + (row.archivedPWinGivenGrades - observed) ** 2;
      }, 0) / decided.length;
  return Object.freeze({
    picksGraded: rows.length,
    wins,
    losses,
    voids,
    decidedPicks: decided.length,
    observedWinRate,
    predictedMeanWinProbability,
    observedMinusPredicted:
      observedWinRate === null || predictedMeanWinProbability === null
        ? null
        : observedWinRate - predictedMeanWinProbability,
    expectedWins,
    actualMinusExpectedWins: wins - expectedWins,
    binaryBrier,
  });
}

function calibration(decidedRows) {
  const rows = decidedRows.filter((row) => row.outcome !== 'void');
  return Object.freeze(M10_CALIBRATION_BUCKETS.map((definition) => {
    const bucketRows = rows.filter((row) =>
      row.archivedPWinGivenGrades >= definition.lowerInclusive &&
      (definition.upperExclusive === null || row.archivedPWinGivenGrades < definition.upperExclusive),
    );
    const wins = bucketRows.filter((row) => row.outcome === 'win').length;
    const predictedMeanProbability = bucketRows.length === 0
      ? null
      : bucketRows.reduce((total, row) => total + row.archivedPWinGivenGrades, 0) / bucketRows.length;
    const observedWinRate = bucketRows.length === 0 ? null : wins / bucketRows.length;
    return Object.freeze({
      label: definition.label,
      lowerInclusive: definition.lowerInclusive,
      upperExclusive: definition.upperExclusive,
      calibrationEligiblePicks: bucketRows.length,
      wins,
      losses: bucketRows.length - wins,
      predictedMeanProbability,
      observedWinRate,
      observedMinusPredicted:
        observedWinRate === null || predictedMeanProbability === null
          ? null
          : observedWinRate - predictedMeanProbability,
    });
  }));
}

function validateProjectionProbabilities(projection) {
  for (const [index, row] of projection.rows.entries()) {
    for (const [name, value] of [
      ['pWin', row.pWin],
      ['pLoss', row.pLoss],
      ['pVoid', row.pVoid],
      ['pWinGivenGrades', row.pWinGivenGrades],
    ]) probability(value, `projection.rows[${index}].${name}`);
    if (Math.abs(row.pWin + row.pLoss + row.pVoid - 1) > PROBABILITY_TOLERANCE) {
      throw new Error(`projection.rows[${index}] probability mass drifted.`);
    }
  }
}

export function buildBatterHitsFinalGradeReportV2({
  projection,
  gradedAt,
  gameSnapshot,
  statsSnapshot,
  lineupSnapshot,
}) {
  timestamp(gradedAt, 'gradedAt');
  validateProjectionProbabilities(projection);
  const rule = registeredBatterHitsSettlementRule();
  const requiredIds = requiredGameIds(projection);
  if (requiredIds.length === 0) throw new Error('Batter Hits grade requires at least one game.');
  for (const gameId of requiredIds) {
    const gameMatches = array(object(gameSnapshot.response, 'gameSnapshot.response').data, 'gameSnapshot.response.data')
      .filter((game) => game?.id === gameId);
    if (gameMatches.length !== 1 || gameMatches[0]?.status !== 'STATUS_FINAL') {
      throw new Error(`Batter Hits archive game ${gameId} is not exactly one STATUS_FINAL row.`);
    }
  }
  const rows = Object.freeze(projection.rows.map((row, index) => gradeRow({
    row,
    index,
    gameSnapshot,
    statsSnapshot,
    lineupSnapshot,
    rule,
  })));
  const voids = rows.filter((row) => row.outcome === 'void').length;
  return Object.freeze({
    reportVersion: M10_BATTER_HITS_GRADE_VERSION_V2,
    reportType: M10_BATTER_HITS_GRADE_REPORT_TYPE_V2,
    gradedAt: new Date(gradedAt).toISOString(),
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
      gameSnapshotId: gameSnapshot.snapshotId,
      statsSnapshotId: statsSnapshot.snapshotId,
      lineupSnapshotId: lineupSnapshot.snapshotId,
    }),
    settlementEvidence: Object.freeze({
      settlementRegistryVersion: SETTLEMENT_REGISTRY.version,
      settlementRuleVersion: rule.version,
      ruleSourceReference: rule.ruleSourceReference,
    }),
    summary: performanceSummary(rows),
    calibrationEligiblePicks: rows.length - voids,
    calibrationExcludedVoids: voids,
    calibration: calibration(rows),
    rows,
    safety: Object.freeze({
      productionEnabled: false,
      rankingEnabled: false,
      archiveModified: false,
      evidenceOnly: true,
      finalOnly: true,
    }),
  });
}
