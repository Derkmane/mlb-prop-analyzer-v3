import { createHash } from 'node:crypto';

import { SETTLEMENT_REGISTRY } from '../dist/src/composition/registries.js';
import { settleObservedDiscreteStatisticV1 } from '../dist/src/core/index.js';
import {
  BATTER_HHR_MARKET_KEY,
  BATTER_HHR_SETTLEMENT_RULE_VERSION,
} from '../dist/src/features/batter-hhr/index.js';
import {
  buildSelectedSideCalibration,
  buildSelectedSidePerformanceSummary,
  canonicalJsonBytes,
  captureTimestampFromCumulativeCaptureKey,
  cumulativeSelectedSidePropIdentity,
  deduplicateSelectedRecordsByLatestCapture,
  selectOneModelSidePerProp,
  sha256Bytes,
} from './m10-selected-side-grade-metrics-utils.mjs';

export const M10_HHR_ARCHIVE_VERSION = 'm10-hhr-prospective-evidence-v1';
export const M10_HHR_GRADE_VERSION = 'm10-hhr-final-grade-v1';
export const M10_HHR_CUMULATIVE_VERSION = 'm10-hhr-cumulative-selected-side-v1';
export const M10_HHR_MINIMUM_CALIBRATION_BUCKET_COUNT = 30;

const SHA256_PATTERN = /^[a-f0-9]{64}$/u;
const CAPTURE_KEY_PATTERN = /^\d{8}T\d{9}Z--[a-f0-9]{64}$/u;
const PROBABILITY_TOLERANCE = 1e-12;

export class HhrCaptureEvidenceError extends Error {
  constructor({ code, providerGameId, providerPlayerId, message }) {
    super(message);
    this.name = 'HhrCaptureEvidenceError';
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

function finiteNumber(value, label) {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new TypeError(`${label} must be finite.`);
  }
  return value;
}

function nonnegativeInteger(value, label) {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new TypeError(`${label} must be a nonnegative safe integer.`);
  }
  return value;
}

function positiveInteger(value, label) {
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new TypeError(`${label} must be a positive safe integer.`);
  }
  return value;
}

function probability(value, label) {
  finiteNumber(value, label);
  if (value < 0 || value > 1) throw new RangeError(`${label} must be in [0, 1].`);
  return value;
}

function timestamp(value, label) {
  nonemptyString(value, label);
  if (!Number.isFinite(Date.parse(value))) {
    throw new TypeError(`${label} must be an ISO timestamp.`);
  }
  return value;
}

function sha256(value, label) {
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
      throw new TypeError('Stable JSON values may contain only finite numbers.');
    }
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`;
  if (typeof value === 'object') {
    return `{${Object.keys(value)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${stableJson(value[key])}`)
      .join(',')}}`;
  }
  throw new TypeError('Stable JSON values must be JSON-compatible.');
}

function archiveIdentity(archiveWithoutSha) {
  return createHash('sha256').update(stableJson(archiveWithoutSha)).digest('hex');
}

function exactRowIdentity(row) {
  return stableJson([
    row.providerEventId,
    row.providerGameId,
    row.providerPlayerId,
    row.boardSource ?? null,
    row.providerBookmakerKey ?? null,
    row.providerRegion ?? null,
    row.providerMarketKey,
    row.offerType,
    row.selectedSide,
    row.postedLine,
  ]);
}

function hhrSourceAwarePropIdentity(row) {
  return stableJson([
    row.providerEventId,
    row.providerGameId,
    row.providerPlayerId,
    row.boardSource ?? null,
    row.providerBookmakerKey ?? null,
    row.providerRegion ?? null,
    row.providerMarketKey,
    row.offerType,
    row.postedLine,
  ]);
}

function isVerifiedActiveSourceSingleton(row) {
  if (row.boardSource === 'draftkings') {
    return row.providerBookmakerKey === 'draftkings' && row.providerRegion === 'us';
  }
  if (row.boardSource === 'pick6') {
    return row.providerBookmakerKey === 'pick6' && row.providerRegion === 'us_dfs';
  }
  return false;
}

export function selectHhrModelSidesForEvidence(gradedRows) {
  const rows = array(gradedRows, 'gradedRows');
  const byProp = new Map();
  for (const row of rows) {
    const key = hhrSourceAwarePropIdentity(row);
    const group = byProp.get(key) ?? [];
    group.push(row);
    byProp.set(key, group);
  }

  const selectedRows = [];
  for (const [key, group] of [...byProp.entries()].sort(([left], [right]) => left.localeCompare(right))) {
    if (group.length === 1 && isVerifiedActiveSourceSingleton(group[0])) {
      if (group[0].archivedPWinGivenGrades >= 0.5) selectedRows.push(group[0]);
      continue;
    }
    try {
      selectedRows.push(...selectOneModelSidePerProp(group).selectedRows);
    } catch (error) {
      throw new Error(
        `HHR evidence prop ${key} is not a verified active-source singleton or a valid complementary pair: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }
  return Object.freeze({ selectedRows: Object.freeze(selectedRows) });
}

function captureEvidenceError(row, code, message) {
  return new HhrCaptureEvidenceError({
    code,
    providerGameId: row.providerGameId,
    providerPlayerId: row.providerPlayerId,
    message,
  });
}

function registeredHhrSettlementRule() {
  const matches = SETTLEMENT_REGISTRY.rules.filter(
    (rule) =>
      rule.baseMarketKey === BATTER_HHR_MARKET_KEY &&
      rule.version === BATTER_HHR_SETTLEMENT_RULE_VERSION,
  );
  if (matches.length !== 1) {
    throw new Error(
      `Expected exactly one registered ${BATTER_HHR_SETTLEMENT_RULE_VERSION} rule; received ${matches.length}.`,
    );
  }
  const rule = matches[0];
  if (!rule.voidConditions.includes('batter absent from the official starting lineup')) {
    throw new Error('Registered HHR settlement rule no longer voids a batter absent from the official starting lineup.');
  }
  return rule;
}

function validateNonstarterGradingSettlement(row, label) {
  if (row.officialHits !== null || row.officialComponents !== null) {
    throw new Error(`${label} verified nonstarter cannot claim an official HHR stat row.`);
  }
  if (row.outcome !== 'void') {
    throw new Error(`${label} verified nonstarter must be void.`);
  }
  if (row.settlementVersion !== BATTER_HHR_SETTLEMENT_RULE_VERSION) {
    throw new Error(`${label} verified nonstarter must use the registered HHR settlement rule.`);
  }
  if (row.settlementReason !== 'verified-final-nonstarter') {
    throw new Error(`${label} verified nonstarter settlement reason is unsupported.`);
  }
  const settlement = object(row.gradingSettlement, `${label}.gradingSettlement`);
  if (
    settlement.eligibilityProbability !== 0 ||
    settlement.winProbability !== 0 ||
    settlement.lossProbability !== 0 ||
    settlement.voidProbability !== 1 ||
    settlement.winProbabilityGivenGrades !== null ||
    settlement.settlementRuleVersion !== BATTER_HHR_SETTLEMENT_RULE_VERSION
  ) {
    throw new Error(`${label} verified nonstarter grading settlement must be a full registered-rule void.`);
  }
  nonemptyString(settlement.ruleSourceReference, `${label}.gradingSettlement.ruleSourceReference`);
}

function validateEvidenceRow(raw, label, { graded }) {
  const row = object(raw, label);
  nonemptyString(row.providerEventId, `${label}.providerEventId`);
  positiveInteger(row.providerGameId, `${label}.providerGameId`);
  positiveInteger(row.providerPlayerId, `${label}.providerPlayerId`);
  nonemptyString(row.playerName, `${label}.playerName`);
  if (!['batter_hits_runs_rbis', 'batter_hits_runs_rbis_alternate'].includes(row.providerMarketKey)) {
    throw new Error(`${label}.providerMarketKey is unsupported.`);
  }
  if (!['baseline', 'alternate'].includes(row.offerType)) {
    throw new Error(`${label}.offerType is unsupported.`);
  }
  if (!['higher', 'lower'].includes(row.selectedSide)) {
    throw new Error(`${label}.selectedSide is unsupported.`);
  }
  finiteNumber(row.postedLine, `${label}.postedLine`);
  if (row.postedLine < 0 || row.postedLine > 63.5) {
    throw new RangeError(`${label}.postedLine is outside the verified HHR runtime range.`);
  }
  const archivedPWin = probability(row.archivedPWin, `${label}.archivedPWin`);
  const archivedPLoss = probability(row.archivedPLoss, `${label}.archivedPLoss`);
  const archivedPVoid = probability(row.archivedPVoid, `${label}.archivedPVoid`);
  const archivedPWinGivenGrades = probability(
    row.archivedPWinGivenGrades,
    `${label}.archivedPWinGivenGrades`,
  );
  if (Math.abs(archivedPWin + archivedPLoss + archivedPVoid - 1) > PROBABILITY_TOLERANCE) {
    throw new Error(`${label} probability mass does not sum to one.`);
  }
  if (graded) {
    if (row.officialHhr === null) {
      validateNonstarterGradingSettlement(row, label);
    } else {
      nonnegativeInteger(row.officialHhr, `${label}.officialHhr`);
      if (row.officialHits !== row.officialHhr) {
        throw new Error(`${label}.officialHits compatibility alias must equal officialHhr.`);
      }
      if (!['win', 'loss', 'void'].includes(row.outcome)) {
        throw new Error(`${label}.outcome is unsupported.`);
      }
      nonemptyString(row.settlementVersion, `${label}.settlementVersion`);
    }
  }
  return Object.freeze({
    ...row,
    archivedPWin,
    archivedPLoss,
    archivedPVoid,
    archivedPWinGivenGrades,
  });
}

export function createM10HhrCaptureKey({ capturedAt, sourceSetSha256 }) {
  timestamp(capturedAt, 'capturedAt');
  sha256(sourceSetSha256, 'sourceSetSha256');
  return `${new Date(capturedAt).toISOString().replace(/[-:.]/gu, '')}--${sourceSetSha256}`;
}

export function buildM10HhrProspectiveArchive({
  capturedAt,
  sourceSetSha256,
  source,
  games,
  rows,
  exclusions,
  diagnosticsPath,
}) {
  timestamp(capturedAt, 'capturedAt');
  sha256(sourceSetSha256, 'sourceSetSha256');
  nonemptyString(diagnosticsPath, 'diagnosticsPath');
  const safeRows = array(rows, 'rows').map((row, index) =>
    validateEvidenceRow(row, `rows[${index}]`, { graded: false }),
  );
  const identities = new Set(safeRows.map(exactRowIdentity));
  if (identities.size !== safeRows.length) {
    throw new Error('HHR prospective archive contains duplicate exact offer identities.');
  }
  const captureKey = createM10HhrCaptureKey({ capturedAt, sourceSetSha256 });
  const identity = {
    archiveVersion: 1,
    archiveContract: M10_HHR_ARCHIVE_VERSION,
    captureKey,
    capturedAt: new Date(capturedAt).toISOString(),
    captureDateUtc: new Date(capturedAt).toISOString().slice(0, 10),
    sourceSetSha256,
    source: object(source, 'source'),
    games: array(games, 'games'),
    rows: safeRows,
    exclusions: array(exclusions, 'exclusions'),
    diagnosticsPath,
    counts: {
      games: games.length,
      rows: safeRows.length,
      baselineRows: safeRows.filter((row) => row.offerType === 'baseline').length,
      alternateRows: safeRows.filter((row) => row.offerType === 'alternate').length,
      exclusions: exclusions.length,
    },
    safety: {
      productionEnabled: false,
      rankingEnabled: false,
      evidenceOnly: true,
      gradingPerformed: false,
      archiveModified: false,
    },
  };
  return Object.freeze({ ...identity, archiveSha256: archiveIdentity(identity) });
}

export function verifyM10HhrArchiveBytes({ bytes, archivePath, expectedCaptureKey = null }) {
  let parsed;
  try {
    parsed = JSON.parse(Buffer.from(bytes).toString('utf8'));
  } catch (error) {
    throw new Error(`HHR archive is not valid JSON: ${error instanceof Error ? error.message : String(error)}`);
  }
  const archive = object(parsed, 'HHR archive');
  if (archive.archiveContract !== M10_HHR_ARCHIVE_VERSION || archive.archiveVersion !== 1) {
    throw new Error('HHR archive contract is unsupported.');
  }
  if (!CAPTURE_KEY_PATTERN.test(archive.captureKey)) {
    throw new Error('HHR archive capture key is malformed.');
  }
  if (expectedCaptureKey !== null && archive.captureKey !== expectedCaptureKey) {
    throw new Error('HHR archive capture identity drifted.');
  }
  timestamp(archive.capturedAt, 'HHR archive capturedAt');
  sha256(archive.sourceSetSha256, 'HHR archive sourceSetSha256');
  const safety = object(archive.safety, 'HHR archive safety');
  if (
    safety.productionEnabled !== false ||
    safety.rankingEnabled !== false ||
    safety.evidenceOnly !== true ||
    safety.gradingPerformed !== false ||
    safety.archiveModified !== false
  ) {
    throw new Error('HHR archive is not evidence-only and production-disabled.');
  }
  const { archiveSha256: claimedSha, ...identity } = archive;
  sha256(claimedSha, 'HHR archive archiveSha256');
  if (archiveIdentity(identity) !== claimedSha) {
    throw new Error('HHR archive SHA-256 verification failed.');
  }
  const rows = array(archive.rows, 'HHR archive rows').map((row, index) =>
    validateEvidenceRow(row, `HHR archive rows[${index}]`, { graded: false }),
  );
  const identities = new Set(rows.map(exactRowIdentity));
  if (identities.size !== rows.length) {
    throw new Error('HHR archive contains duplicate exact offer identities.');
  }
  return Object.freeze({
    ...archive,
    rows: Object.freeze(rows),
    archivePath,
    archiveFileSha256: sha256Bytes(bytes),
  });
}

export function playersByGameForHhrArchive(archive) {
  const result = new Map();
  for (const row of archive.rows) {
    const players = result.get(row.providerGameId) ?? new Set();
    players.add(row.providerPlayerId);
    result.set(row.providerGameId, players);
  }
  return result;
}

export function classifyHhrArchiveGameStatuses(archive, rawGames) {
  const games = array(rawGames, 'rawGames');
  const requiredIds = [...new Set(archive.rows.map((row) => row.providerGameId))].sort((a, b) => a - b);
  const statusRows = requiredIds.map((gameId) => {
    const matches = games.filter((game) => game?.id === gameId);
    if (matches.length !== 1) {
      return Object.freeze({
        gameId,
        status: 'IDENTITY_COUNT_ERROR',
        matchCount: matches.length,
        homeTeamName: null,
        awayTeamName: null,
      });
    }
    const game = matches[0];
    return Object.freeze({
      gameId,
      status: game?.status ?? 'UNKNOWN',
      matchCount: 1,
      homeTeamName: game?.home_team?.display_name ?? null,
      awayTeamName: game?.away_team?.display_name ?? null,
    });
  });
  const nonFinalGames = statusRows.filter((row) => row.status !== 'STATUS_FINAL');
  return Object.freeze({
    requiredGameIds: Object.freeze(requiredIds),
    games: Object.freeze(statusRows),
    nonFinalGames: Object.freeze(nonFinalGames),
    readyToGrade: requiredIds.length > 0 && nonFinalGames.length === 0,
  });
}

function statusGameForEvidence(status, row) {
  const gameId = row.providerGameId;
  const matches = array(status.games, 'gameStatusEvidence.games').filter((entry) => entry?.gameId === gameId);
  if (matches.length !== 1) {
    throw captureEvidenceError(
      row,
      'FINAL_STATUS_EVIDENCE_COUNT',
      `HHR final evidence for game ${gameId} must contain exactly one game-status row.`,
    );
  }
  const game = matches[0];
  if (game.status !== 'STATUS_FINAL') {
    throw captureEvidenceError(
      row,
      'FINAL_STATUS_NOT_FINAL',
      `HHR final evidence for game ${gameId} is not exactly STATUS_FINAL.`,
    );
  }
  return game;
}

function statsSnapshotForGame(statsSnapshots, row) {
  const gameId = row.providerGameId;
  const snapshots = array(statsSnapshots, 'statsSnapshots');
  const matches = snapshots.filter((snapshot) => snapshot?.gameId === gameId);
  if (matches.length !== 1) {
    throw captureEvidenceError(
      row,
      'STATS_SNAPSHOT_COUNT',
      `HHR stats completeness for game ${gameId} requires exactly one snapshot.`,
    );
  }
  return matches[0];
}

function lineupSnapshotForGame(lineupSnapshots, row) {
  const gameId = row.providerGameId;
  const snapshots = array(lineupSnapshots, 'lineupSnapshots');
  const matches = snapshots.filter((snapshot) => snapshot?.gameId === gameId);
  if (matches.length !== 1) {
    throw captureEvidenceError(
      row,
      'LINEUP_SNAPSHOT_COUNT',
      `HHR lineup evidence for game ${gameId} requires exactly one snapshot.`,
    );
  }
  return matches[0];
}

function statsTeamName(row) {
  const value = row?.team_name;
  return typeof value === 'string' && value.length > 0 ? value : null;
}

function lineupTeamDisplayName(row) {
  const value = row?.team?.display_name;
  return typeof value === 'string' && value.length > 0 ? value : null;
}

function expectedTeamNamesForEvidence(game, row) {
  const gameId = row.providerGameId;
  if (typeof game.awayTeamName !== 'string' || game.awayTeamName.length === 0) {
    throw captureEvidenceError(
      row,
      'GAME_AWAY_TEAM_NAME_MISSING',
      `HHR final game evidence for game ${gameId} is missing awayTeamName.`,
    );
  }
  if (typeof game.homeTeamName !== 'string' || game.homeTeamName.length === 0) {
    throw captureEvidenceError(
      row,
      'GAME_HOME_TEAM_NAME_MISSING',
      `HHR final game evidence for game ${gameId} is missing homeTeamName.`,
    );
  }
  return [game.awayTeamName, game.homeTeamName];
}

function assertCompleteStatsEvidence({ row, status, statsRows, statsSnapshots }) {
  const gameId = row.providerGameId;
  const game = statusGameForEvidence(status, row);
  const expectedTeamNames = expectedTeamNamesForEvidence(game, row);
  const snapshot = statsSnapshotForGame(statsSnapshots, row);
  if (snapshot === null || typeof snapshot !== 'object' || Array.isArray(snapshot)) {
    throw captureEvidenceError(row, 'STATS_SNAPSHOT_INVALID', `HHR stats snapshot ${gameId} must be an object.`);
  }
  const meta = snapshot.meta;
  if (meta === null || typeof meta !== 'object' || Array.isArray(meta)) {
    throw captureEvidenceError(row, 'STATS_META_INVALID', `HHR stats snapshot ${gameId}.meta must be an object.`);
  }
  if (Object.prototype.hasOwnProperty.call(meta, 'next_cursor')) {
    throw captureEvidenceError(
      row,
      'STATS_PAGINATION_INCOMPLETE',
      `HHR stats response for game ${gameId} is incomplete because meta.next_cursor is present.`,
    );
  }
  if (!Number.isSafeInteger(snapshot.rowCount) || snapshot.rowCount < 0) {
    throw captureEvidenceError(
      row,
      'STATS_ROW_COUNT_INVALID',
      `HHR stats snapshot ${gameId}.rowCount must be a nonnegative safe integer.`,
    );
  }
  const gameRows = statsRows.filter((statsRow) => statsRow?.game_id === gameId);
  if (gameRows.length !== snapshot.rowCount) {
    throw captureEvidenceError(
      row,
      'STATS_ROW_COUNT_DRIFT',
      `HHR stats response for game ${gameId} row count drifted from persisted evidence.`,
    );
  }
  if (gameRows.some((statsRow) => !Number.isSafeInteger(statsRow?.player?.id) || statsRow.player.id <= 0)) {
    throw captureEvidenceError(
      row,
      'STATS_PLAYER_ID_INVALID',
      `HHR stats response for game ${gameId} contains a row without a valid player.id.`,
    );
  }
  if (gameRows.some((statsRow) => statsTeamName(statsRow) === null)) {
    throw captureEvidenceError(
      row,
      'STATS_TEAM_NAME_INVALID',
      `HHR stats response for game ${gameId} contains a row without top-level team_name.`,
    );
  }
  const observedTeamNames = new Set(gameRows.map(statsTeamName));
  for (const teamName of expectedTeamNames) {
    if (!observedTeamNames.has(teamName)) {
      throw captureEvidenceError(
        row,
        'STATS_TEAM_MISSING',
        `HHR stats response for game ${gameId} is incomplete because team ${teamName} is absent.`,
      );
    }
  }
}

function assertUsableLineupEvidence({ row, status, lineupRows, lineupSnapshots }) {
  const gameId = row.providerGameId;
  const game = statusGameForEvidence(status, row);
  const snapshot = lineupSnapshotForGame(lineupSnapshots, row);
  if (snapshot === null || typeof snapshot !== 'object' || Array.isArray(snapshot)) {
    throw captureEvidenceError(row, 'LINEUP_SNAPSHOT_INVALID', `HHR lineup snapshot ${gameId} must be an object.`);
  }
  if (!Number.isSafeInteger(snapshot.rowCount) || snapshot.rowCount < 0) {
    throw captureEvidenceError(
      row,
      'LINEUP_ROW_COUNT_INVALID',
      `HHR lineup snapshot ${gameId}.rowCount must be a nonnegative safe integer.`,
    );
  }
  if (snapshot.rowCount === 0) {
    throw captureEvidenceError(
      row,
      'LINEUP_EMPTY',
      `HHR lineup response for game ${gameId} is empty; nonstarter absence cannot be inferred.`,
    );
  }
  if (snapshot.meta !== undefined && snapshot.meta !== null) {
    if (typeof snapshot.meta !== 'object' || Array.isArray(snapshot.meta)) {
      throw captureEvidenceError(row, 'LINEUP_META_INVALID', `HHR lineup snapshot ${gameId}.meta must be an object.`);
    }
    if (Object.prototype.hasOwnProperty.call(snapshot.meta, 'next_cursor')) {
      throw captureEvidenceError(
        row,
        'LINEUP_PAGINATION_INCOMPLETE',
        `HHR lineup response for game ${gameId} is incomplete because meta.next_cursor is present.`,
      );
    }
  }
  const gameRows = lineupRows.filter((lineupRow) => lineupRow?.game_id === gameId);
  if (gameRows.length !== snapshot.rowCount) {
    throw captureEvidenceError(
      row,
      'LINEUP_ROW_COUNT_DRIFT',
      `HHR lineup response for game ${gameId} row count drifted from persisted evidence.`,
    );
  }
  if (gameRows.some((lineupRow) => !Number.isSafeInteger(lineupRow?.player?.id) || lineupRow.player.id <= 0)) {
    throw captureEvidenceError(
      row,
      'LINEUP_PLAYER_ID_INVALID',
      `HHR lineup response for game ${gameId} contains a row without a valid player.id.`,
    );
  }
  if (gameRows.some((lineupRow) => lineupTeamDisplayName(lineupRow) === null)) {
    throw captureEvidenceError(
      row,
      'LINEUP_TEAM_NAME_INVALID',
      `HHR lineup response for game ${gameId} contains a row without team.display_name.`,
    );
  }
  const expectedTeamNames = expectedTeamNamesForEvidence(game, row);
  const observedTeamNames = new Set(gameRows.map(lineupTeamDisplayName));
  for (const teamName of expectedTeamNames) {
    if (!observedTeamNames.has(teamName)) {
      throw captureEvidenceError(
        row,
        'LINEUP_TEAM_MISSING',
        `HHR lineup response for game ${gameId} is incomplete because team ${teamName} is absent.`,
      );
    }
  }
  return gameRows;
}

function buildVerifiedNonstarterRow({ row, index, status, statsRows, statsSnapshots, lineupRows, lineupSnapshots }) {
  assertCompleteStatsEvidence({
    row,
    status,
    statsRows,
    statsSnapshots,
  });
  const gameLineups = assertUsableLineupEvidence({
    row,
    status,
    lineupRows,
    lineupSnapshots,
  });
  const lineupMatches = gameLineups.filter(
    (lineup) => lineup?.player?.id === row.providerPlayerId,
  );
  if (lineupMatches.length > 0) {
    throw captureEvidenceError(
      row,
      'LIVE_LINEUP_CONTRADICTION',
      `Missing official HHR stats for ${row.providerGameId}:${row.providerPlayerId}. Player is present in live final-game lineups; approved sources contradict.`,
    );
  }

  const rule = registeredHhrSettlementRule();
  return validateEvidenceRow(
    {
      ...row,
      officialHhr: null,
      officialHits: null,
      officialComponents: null,
      outcome: 'void',
      settlementVersion: rule.version,
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
    },
    `graded rows[${index}]`,
    { graded: true },
  );
}

export function buildM10HhrFinalGradeReport({
  archive,
  statsRows,
  statsSnapshots,
  lineupRows,
  lineupSnapshots,
  gradedAt,
  gameStatusEvidence,
}) {
  timestamp(gradedAt, 'gradedAt');
  const status = object(gameStatusEvidence, 'gameStatusEvidence');
  if (status.readyToGrade !== true) {
    throw new Error('HHR archive games are not all STATUS_FINAL.');
  }
  const safeStatsRows = array(statsRows, 'statsRows');
  const officialByIdentity = new Map();
  for (const [index, raw] of safeStatsRows.entries()) {
    const gameId = raw?.game_id;
    const playerId = raw?.player?.id;
    if (!Number.isSafeInteger(gameId) || !Number.isSafeInteger(playerId)) continue;
    const relevantRow = archive.rows.find(
      (row) => row.providerGameId === gameId && row.providerPlayerId === playerId,
    );
    if (!relevantRow) continue;
    const hits = raw?.hits;
    const runs = raw?.runs;
    const rbi = raw?.rbi;
    if (![hits, runs, rbi].every((value) => Number.isSafeInteger(value) && value >= 0)) {
      throw captureEvidenceError(
        relevantRow,
        'OFFICIAL_STATS_ROW_MALFORMED',
        `HHR official stats row ${index} is malformed.`,
      );
    }
    const key = `${gameId}:${playerId}`;
    if (officialByIdentity.has(key)) {
      throw captureEvidenceError(
        relevantRow,
        'OFFICIAL_STATS_IDENTITY_DUPLICATE',
        `Duplicate official HHR stat identity ${key}.`,
      );
    }
    officialByIdentity.set(key, Object.freeze({ hits, runs, rbi, officialHhr: hits + runs + rbi }));
  }
  const rows = archive.rows.map((row, index) => {
    const official = officialByIdentity.get(`${row.providerGameId}:${row.providerPlayerId}`);
    if (!official) {
      return buildVerifiedNonstarterRow({
        row,
        index,
        status,
        statsRows: safeStatsRows,
        statsSnapshots,
        lineupRows: array(lineupRows, 'lineupRows'),
        lineupSnapshots,
      });
    }
    const settlement = settleObservedDiscreteStatisticV1({
      observedStatistic: official.officialHhr,
      line: row.postedLine,
      selectedSide: row.selectedSide,
    });
    return validateEvidenceRow(
      {
        ...row,
        officialHhr: official.officialHhr,
        officialHits: official.officialHhr,
        officialComponents: official,
        outcome: settlement.outcome,
        settlementVersion: settlement.version,
      },
      `graded rows[${index}]`,
      { graded: true },
    );
  });
  return Object.freeze({
    reportVersion: 1,
    reportType: M10_HHR_GRADE_VERSION,
    gradedAt: new Date(gradedAt).toISOString(),
    source: Object.freeze({
      captureKey: archive.captureKey,
      archiveSha256: archive.archiveSha256,
      archiveFileSha256: archive.archiveFileSha256,
      archivePath: archive.archivePath,
      archiveModified: false,
    }),
    gameStatusEvidence: status,
    rows: Object.freeze(rows),
    summary: buildSelectedSidePerformanceSummary(
      selectHhrModelSidesForEvidence(rows).selectedRows,
    ),
    safety: Object.freeze({
      productionEnabled: false,
      rankingEnabled: false,
      evidenceOnly: true,
      archiveModified: false,
      finalOnly: true,
    }),
  });
}

export function verifyM10HhrGradeReport(report) {
  const value = object(report, 'HHR grade report');
  if (value.reportType !== M10_HHR_GRADE_VERSION || value.reportVersion !== 1) {
    throw new Error('HHR grade report contract is unsupported.');
  }
  timestamp(value.gradedAt, 'HHR grade report gradedAt');
  const source = object(value.source, 'HHR grade report source');
  nonemptyString(source.captureKey, 'HHR grade report source.captureKey');
  sha256(source.archiveSha256, 'HHR grade report source.archiveSha256');
  sha256(source.archiveFileSha256, 'HHR grade report source.archiveFileSha256');
  if (source.archiveModified !== false) throw new Error('HHR grade report claims archive mutation.');
  const safety = object(value.safety, 'HHR grade report safety');
  if (
    safety.productionEnabled !== false ||
    safety.rankingEnabled !== false ||
    safety.evidenceOnly !== true ||
    safety.archiveModified !== false ||
    safety.finalOnly !== true
  ) {
    throw new Error('HHR grade report safety boundary drifted.');
  }
  const rows = array(value.rows, 'HHR grade report rows').map((row, index) =>
    validateEvidenceRow(row, `HHR grade report rows[${index}]`, { graded: true }),
  );
  return Object.freeze({ ...value, rows: Object.freeze(rows) });
}

function lineCohort(row) {
  if (row.postedLine === 0.5) return '0.5';
  if (row.postedLine === 1.5) return '1.5';
  if (row.postedLine >= 2.5) return '2.5+';
  throw new Error(`Unsupported HHR calibration line ${row.postedLine}.`);
}

function calibrationEligibleRows(rows) {
  return rows.filter((row) => row.outcome !== 'void');
}

function withEvidenceStatus(calibration) {
  return calibration.map((bucket) =>
    Object.freeze({
      ...bucket,
      evidenceStatus:
        bucket.picksGraded >= M10_HHR_MINIMUM_CALIBRATION_BUCKET_COUNT
          ? 'sufficient'
          : 'insufficient',
    }),
  );
}

const HHR_CUMULATIVE_DEDUPLICATION_VERSION = 'hhr-latest-capture-per-prop-v1';

function buildHhrCumulativeCaptureInputs({ step3Archive, gradeReports }) {
  const sources = [];
  const seenCaptureKeys = new Set();
  const captureInputs = [];

  const seed = object(step3Archive, 'step3Archive');
  const seedSafety = object(seed.safety, 'step3Archive.safety');
  if (seedSafety.productionEnabled !== false || seedSafety.rankingEnabled !== false) {
    throw new Error('Step 3 HHR seed is not production-disabled.');
  }
  nonemptyString(seed.captureKey, 'step3Archive.captureKey');
  const seedCaptureTimestamp = captureTimestampFromCumulativeCaptureKey(
    seed.captureKey,
    'step3Archive.captureKey',
  );
  seenCaptureKeys.add(seed.captureKey);
  const seedRows = array(seed.rows, 'step3Archive.rows').map((row, index) =>
    validateEvidenceRow(row, `step3Archive.rows[${index}]`, { graded: true }),
  );
  captureInputs.push(Object.freeze({
    captureKey: seed.captureKey,
    captureTimestamp: seedCaptureTimestamp,
    sourceType: 'm11-step3-seed',
    rows: Object.freeze(seedRows),
  }));
  sources.push(Object.freeze({
    captureKey: seed.captureKey,
    captureTimestamp: seedCaptureTimestamp,
    sourceType: 'm11-step3-seed',
    rowCount: seedRows.length,
  }));

  for (const rawReport of array(gradeReports, 'gradeReports')) {
    const report = verifyM10HhrGradeReport(rawReport);
    if (seenCaptureKeys.has(report.source.captureKey)) {
      throw new Error(`Duplicate cumulative capture ${report.source.captureKey}.`);
    }
    seenCaptureKeys.add(report.source.captureKey);
    const captureTimestamp = captureTimestampFromCumulativeCaptureKey(
      report.source.captureKey,
      'HHR grade report source.captureKey',
    );
    captureInputs.push(Object.freeze({
      captureKey: report.source.captureKey,
      captureTimestamp,
      sourceType: 'm10-daily-hhr-grade',
      rows: report.rows,
    }));
    sources.push(Object.freeze({
      captureKey: report.source.captureKey,
      captureTimestamp,
      sourceType: 'm10-daily-hhr-grade',
      archiveSha256: report.source.archiveSha256,
      archiveFileSha256: report.source.archiveFileSha256,
      rowCount: report.rows.length,
    }));
  }

  captureInputs.sort((left, right) =>
    left.captureTimestamp.localeCompare(right.captureTimestamp) ||
    left.captureKey.localeCompare(right.captureKey),
  );
  sources.sort((left, right) => left.captureKey.localeCompare(right.captureKey));
  return Object.freeze({
    captureInputs: Object.freeze(captureInputs),
    sources: Object.freeze(sources),
  });
}

function captureAwareSelectedRecords(captureInputs) {
  const records = [];
  for (const capture of captureInputs) {
    const exactRows = new Set(capture.rows.map(exactRowIdentity));
    if (exactRows.size !== capture.rows.length) {
      throw new Error(
        `HHR cumulative capture ${capture.captureKey} contains duplicate exact offer identities.`,
      );
    }
    const selectedRows = selectHhrModelSidesForEvidence(capture.rows).selectedRows;
    for (const row of selectedRows) {
      records.push(Object.freeze({
        captureKey: capture.captureKey,
        captureTimestamp: capture.captureTimestamp,
        sourceType: capture.sourceType,
        calibrationIdentity: cumulativeSelectedSidePropIdentity(row),
        row,
      }));
    }
  }
  return Object.freeze(records);
}

function buildHhrCumulativeSelectedEvidence({ step3Archive, gradeReports }) {
  const inputs = buildHhrCumulativeCaptureInputs({ step3Archive, gradeReports });
  const selectedRecords = captureAwareSelectedRecords(inputs.captureInputs);
  const deduplicated = deduplicateSelectedRecordsByLatestCapture(selectedRecords, {
    ambiguityLabel: 'HHR cumulative calibration identity',
  });
  return Object.freeze({
    ...inputs,
    selectedRecords,
    ...deduplicated,
  });
}

export function buildM10HhrCumulativeSelectedSideReport({
  step3Archive,
  gradeReports,
  generatedAt,
}) {
  timestamp(generatedAt, 'generatedAt');
  const evidence = buildHhrCumulativeSelectedEvidence({ step3Archive, gradeReports });
  const selectedRowsBeforeDedup = evidence.evidenceRows;
  const selectedRows = evidence.retainedRows;
  const selectedCalibrationRowsBeforeDedup = calibrationEligibleRows(selectedRowsBeforeDedup);
  const selectedCalibrationRows = calibrationEligibleRows(selectedRows);
  const perLine = {};
  for (const cohort of ['0.5', '1.5', '2.5+']) {
    const beforeRows = selectedRowsBeforeDedup.filter((row) => lineCohort(row) === cohort);
    const rows = selectedRows.filter((row) => lineCohort(row) === cohort);
    const beforeCalibrationRows = calibrationEligibleRows(beforeRows);
    const calibrationRows = calibrationEligibleRows(rows);
    const gatePassed = calibrationRows.length >= M10_HHR_MINIMUM_CALIBRATION_BUCKET_COUNT;
    perLine[cohort] = Object.freeze({
      lineCohort: cohort,
      selectedSideRowsBeforeDedup: beforeRows.length,
      supersededSelectedSideRows: beforeRows.filter(
        (row) => row.calibrationDedupStatus === 'superseded',
      ).length,
      calibrationEligiblePicksBeforeDedup: beforeCalibrationRows.length,
      summary: buildSelectedSidePerformanceSummary(rows),
      calibrationEligiblePicks: calibrationRows.length,
      calibration: Object.freeze(withEvidenceStatus(buildSelectedSideCalibration(calibrationRows))),
      evidenceStatus: gatePassed ? 'sufficient' : 'insufficient',
      minimumCountGatePassed: gatePassed,
      ownerDecisionRequired: true,
      productionEnabled: false,
      rankingEnabled: false,
    });
  }
  const sourceSetSha256 = sha256Bytes(Buffer.from(stableJson(evidence.sources), 'utf8'));
  return Object.freeze({
    reportVersion: 1,
    reportType: M10_HHR_CUMULATIVE_VERSION,
    generatedAt: new Date(generatedAt).toISOString(),
    sourceSetSha256,
    archivesIncluded: evidence.sources.length,
    sources: evidence.sources,
    selectedSide: Object.freeze({
      deduplicationVersion: HHR_CUMULATIVE_DEDUPLICATION_VERSION,
      deduplicationIdentity: Object.freeze([
        'providerGameId',
        'providerPlayerId',
        'providerMarketKey',
        'offerType',
        'postedLine',
      ]),
      deduplicationWinnerRule: 'most-recent-capture-timestamp-only',
      selectedSideRowsBeforeDedup: selectedRowsBeforeDedup.length,
      retainedSelectedSideRows: selectedRows.length,
      supersededSelectedSideRows: evidence.supersededRows.length,
      calibrationEligiblePicksBeforeDedup: selectedCalibrationRowsBeforeDedup.length,
      evidenceRows: evidence.evidenceRows,
      summary: buildSelectedSidePerformanceSummary(selectedRows),
      calibrationEligiblePicks: selectedCalibrationRows.length,
      calibration: Object.freeze(withEvidenceStatus(buildSelectedSideCalibration(selectedCalibrationRows))),
      perLine: Object.freeze(perLine),
    }),
    safety: Object.freeze({
      productionEnabled: false,
      rankingEnabled: false,
      evidenceOnly: true,
      ownerDecisionRequired: true,
      archivesModified: false,
      deepLineCohort: '2.5+',
      minimumCalibrationBucketCount: M10_HHR_MINIMUM_CALIBRATION_BUCKET_COUNT,
    }),
  });
}

export function hhrCumulativeInputDiagnostics({ step3Archive, gradeReports }) {
  const evidence = buildHhrCumulativeSelectedEvidence({ step3Archive, gradeReports });
  const beforeCalibrationRows = calibrationEligibleRows(evidence.evidenceRows);
  const calibrationRows = calibrationEligibleRows(evidence.retainedRows);
  const lineCountsBeforeDedup = { '0.5': 0, '1.5': 0, '2.5+': 0 };
  const lineCounts = { '0.5': 0, '1.5': 0, '2.5+': 0 };
  for (const row of beforeCalibrationRows) lineCountsBeforeDedup[lineCohort(row)] += 1;
  for (const row of calibrationRows) lineCounts[lineCohort(row)] += 1;
  const calibration = buildSelectedSideCalibration(calibrationRows).map((bucket) => ({
    label: bucket.label,
    picksGraded: bucket.picksGraded,
  }));
  return Object.freeze({
    diagnosticVersion: 1,
    diagnosticType: 'm10-hhr-cumulative-input-counts-before-thresholds',
    archiveCount: evidence.captureInputs.length,
    selectedSideRowsBeforeDedup: evidence.evidenceRows.length,
    selectedSideRows: evidence.retainedRows.length,
    supersededSelectedSideRows: evidence.supersededRows.length,
    calibrationEligibleRowsBeforeDedup: beforeCalibrationRows.length,
    calibrationEligibleRows: calibrationRows.length,
    voidSelectedSideRows: evidence.retainedRows.length - calibrationRows.length,
    lineCountsBeforeDedup,
    lineCounts,
    calibration,
    thresholdsEvaluated: false,
  });
}
