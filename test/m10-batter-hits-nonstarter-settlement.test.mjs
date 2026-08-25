import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import test from 'node:test';

import {
  IMPLEMENTED_MARKET_REGISTRY,
  SETTLEMENT_REGISTRY,
} from '../dist/src/composition/registries.js';
import {
  BATTER_HITS_DRAFTKINGS_SETTLEMENT_RULE_SOURCE_REFERENCE,
  BATTER_HITS_DRAFTKINGS_SETTLEMENT_RULE_VERSION,
  BATTER_HITS_MARKET_KEY,
  BATTER_HITS_PICK6_SETTLEMENT_RULE_SOURCE_REFERENCE,
  BATTER_HITS_PICK6_SETTLEMENT_RULE_VERSION,
  BATTER_HITS_SETTLEMENT_RULE_SOURCE_REFERENCE,
  BATTER_HITS_SETTLEMENT_RULE_VERSION,
} from '../dist/src/features/batter-hits/index.js';
import {
  BatterHitsCaptureEvidenceError,
  buildBatterHitsFinalGradeReportV2,
  M10_BATTER_HITS_GRADE_VERSION_V2,
} from '../scripts/m10-batter-hits-final-grade-v2-utils.mjs';
import { verifyBatterHitsFinalGradeReportV2 } from '../scripts/m10-batter-hits-grade-v2-verifier.mjs';

const GAME_ID = 5001;
const HOME = 'Home Club';
const AWAY = 'Away Club';
const STARTER_ID = 1001;
const NONSTARTER_ID = 1002;
const TIE_STARTER_ID = 1003;
const AWAY_ID = 2001;

function row({ rank, playerId, selectedSide, line, pWin }) {
  return Object.freeze({
    rank,
    providerEventId: rank.toString(16).padStart(32, '0'),
    providerGameId: GAME_ID,
    providerPlayerId: playerId,
    playerName: `Player ${playerId}`,
    offerType: line === 1 ? 'alternate' : 'baseline',
    selectedSide,
    postedLine: line,
    pWin,
    pLoss: 1 - pWin,
    pVoid: 0,
    pWinGivenGrades: pWin,
  });
}

function projection() {
  return Object.freeze({
    sourceCaptureKey: `20260818T150000000Z--${'a'.repeat(64)}`,
    sourceArchiveSha256: 'b'.repeat(64),
    sourceFileSha256: 'c'.repeat(64),
    sourceArchivePath: 'artifacts/board-archives/batter-hits/captures/test.json',
    capturedAt: '2026-08-18T15:00:00.000Z',
    rows: Object.freeze([
      row({ rank: 1, playerId: STARTER_ID, selectedSide: 'higher', line: 0.5, pWin: 0.63 }),
      row({ rank: 2, playerId: STARTER_ID, selectedSide: 'lower', line: 0.5, pWin: 0.37 }),
      row({ rank: 3, playerId: NONSTARTER_ID, selectedSide: 'higher', line: 0.5, pWin: 0.58 }),
      row({ rank: 4, playerId: NONSTARTER_ID, selectedSide: 'lower', line: 0.5, pWin: 0.42 }),
      row({ rank: 5, playerId: TIE_STARTER_ID, selectedSide: 'higher', line: 1, pWin: 0.41 }),
      row({ rank: 6, playerId: TIE_STARTER_ID, selectedSide: 'lower', line: 1, pWin: 0.46 }),
    ]),
  });
}

function gameSnapshot() {
  return Object.freeze({
    snapshotId: 'games-final',
    sha256: 'd'.repeat(64),
    capturedAt: '2026-08-19T09:00:00.000Z',
    response: Object.freeze({
      data: Object.freeze([Object.freeze({
        id: GAME_ID,
        status: 'STATUS_FINAL',
        date: '2026-08-18T23:10:00.000Z',
        home_team: Object.freeze({ id: 1, display_name: HOME }),
        away_team: Object.freeze({ id: 2, display_name: AWAY }),
      })]),
      meta: Object.freeze({ per_page: 1 }),
    }),
  });
}

function statsSnapshot({ omitStarter = false } = {}) {
  const rows = [
    ...(!omitStarter ? [{ game_id: GAME_ID, player: { id: STARTER_ID }, team_name: HOME, hits: 1 }] : []),
    { game_id: GAME_ID, player: { id: TIE_STARTER_ID }, team_name: HOME, hits: 1 },
    { game_id: GAME_ID, player: { id: AWAY_ID }, team_name: AWAY, hits: 0 },
  ];
  return Object.freeze({
    snapshotId: 'stats-final',
    sha256: 'e'.repeat(64),
    capturedAt: '2026-08-19T09:01:00.000Z',
    response: Object.freeze({ data: Object.freeze(rows), meta: Object.freeze({ per_page: 100 }) }),
    gameCoverage: Object.freeze([Object.freeze({
      gameId: GAME_ID,
      rowCount: rows.length,
      pageCount: 1,
      paginationComplete: true,
    })]),
  });
}

function lineupSnapshot({ paginationComplete = true } = {}) {
  const rows = Object.freeze([
    Object.freeze({ game_id: GAME_ID, player: Object.freeze({ id: STARTER_ID }), team: Object.freeze({ display_name: HOME }) }),
    Object.freeze({ game_id: GAME_ID, player: Object.freeze({ id: TIE_STARTER_ID }), team: Object.freeze({ display_name: HOME }) }),
    Object.freeze({ game_id: GAME_ID, player: Object.freeze({ id: AWAY_ID }), team: Object.freeze({ display_name: AWAY }) }),
  ]);
  return Object.freeze({
    snapshotId: 'lineups-final',
    sha256: 'f'.repeat(64),
    capturedAt: '2026-08-19T09:02:00.000Z',
    response: Object.freeze({ data: rows, meta: Object.freeze({ per_page: 100 }) }),
    gameCoverage: Object.freeze([Object.freeze({
      gameId: GAME_ID,
      rowCount: rows.length,
      pageCount: 1,
      paginationComplete,
    })]),
  });
}

function buildReport(overrides = {}) {
  return buildBatterHitsFinalGradeReportV2({
    projection: projection(),
    gradedAt: '2026-08-19T09:03:00.000Z',
    gameSnapshot: gameSnapshot(),
    statsSnapshot: statsSnapshot(),
    lineupSnapshot: lineupSnapshot(),
    ...overrides,
  });
}

test('Batter Hits keeps DraftKings, Pick6, and historical Underdog settlement rules separate while production remains disabled', () => {
  const rules = SETTLEMENT_REGISTRY.rules.filter((rule) => rule.baseMarketKey === BATTER_HITS_MARKET_KEY);
  assert.equal(rules.length, 3);

  const draftKingsRule = rules.find((rule) => rule.boardSource === 'draftkings');
  assert.ok(draftKingsRule);
  assert.equal(draftKingsRule.version, BATTER_HITS_DRAFTKINGS_SETTLEMENT_RULE_VERSION);
  assert.equal(draftKingsRule.officialSettlementStatistic, 'hits');
  assert.equal(draftKingsRule.ruleSourceReference, BATTER_HITS_DRAFTKINGS_SETTLEMENT_RULE_SOURCE_REFERENCE);

  const pick6Rule = rules.find((rule) => rule.boardSource === 'pick6');
  assert.ok(pick6Rule);
  assert.equal(pick6Rule.version, BATTER_HITS_PICK6_SETTLEMENT_RULE_VERSION);
  assert.equal(pick6Rule.officialSettlementStatistic, 'hits');
  assert.equal(pick6Rule.ruleSourceReference, BATTER_HITS_PICK6_SETTLEMENT_RULE_SOURCE_REFERENCE);

  const historicalRule = rules.find((rule) => rule.boardSource === null);
  assert.ok(historicalRule);
  assert.equal(historicalRule.version, BATTER_HITS_SETTLEMENT_RULE_VERSION);
  assert.equal(historicalRule.officialSettlementStatistic, 'hits');
  assert.equal(historicalRule.ruleSourceReference, BATTER_HITS_SETTLEMENT_RULE_SOURCE_REFERENCE);
  assert.ok(historicalRule.voidConditions.includes('batter absent from the official starting lineup'));
  assert.match(historicalRule.tieHandling, /ties.*void|ties its posted projection is void/iu);

  const market = IMPLEMENTED_MARKET_REGISTRY.find((entry) => entry.baseMarketKey === BATTER_HITS_MARKET_KEY);
  assert.ok(market);
  assert.equal(market.settlementRuleVersion, BATTER_HITS_DRAFTKINGS_SETTLEMENT_RULE_VERSION);
  assert.equal(market.distributionBuilderValidated, false);
  assert.equal(market.status, 'model-under-development');
  assert.notEqual(market.blocker, null);
});

test('Batter Hits v2 grades official starters symmetrically, exact ties void, and verified nonstarters void', () => {
  const report = buildReport();
  assert.equal(report.reportVersion, M10_BATTER_HITS_GRADE_VERSION_V2);
  assert.equal(report.rows.length, 6);

  assert.equal(report.rows[0].officialHits, 1);
  assert.equal(report.rows[0].outcome, 'win');
  assert.equal(report.rows[1].officialHits, 1);
  assert.equal(report.rows[1].outcome, 'loss');

  for (const index of [2, 3]) {
    const graded = report.rows[index];
    assert.equal(graded.officialHits, null);
    assert.equal(graded.outcome, 'void');
    assert.equal(graded.settlementVersion, BATTER_HITS_SETTLEMENT_RULE_VERSION);
    assert.equal(graded.settlementReason, 'verified-final-nonstarter');
    assert.deepEqual(graded.gradingSettlement, {
      eligibilityProbability: 0,
      winProbability: 0,
      lossProbability: 0,
      voidProbability: 1,
      winProbabilityGivenGrades: null,
      settlementRuleVersion: BATTER_HITS_SETTLEMENT_RULE_VERSION,
      ruleSourceReference: BATTER_HITS_SETTLEMENT_RULE_SOURCE_REFERENCE,
    });
  }

  assert.equal(report.rows[4].officialHits, 1);
  assert.equal(report.rows[4].postedLine, 1);
  assert.equal(report.rows[4].outcome, 'void');
  assert.equal(report.rows[5].outcome, 'void');
  assert.equal(report.summary.wins, 1);
  assert.equal(report.summary.losses, 1);
  assert.equal(report.summary.voids, 4);
  assert.equal(report.summary.decidedPicks, 2);
  assert.equal(report.calibrationEligiblePicks, 2);
  assert.equal(report.calibrationExcludedVoids, 4);
  assert.equal(
    report.calibration.reduce((total, bucket) => total + bucket.calibrationEligiblePicks, 0),
    2,
  );
  assert.equal(report.safety.productionEnabled, false);
  assert.equal(report.safety.rankingEnabled, false);
});

test('Batter Hits v2 verifier preserves archived probabilities and registered settlement outcomes literally', () => {
  const sourceProjection = projection();
  const report = buildReport({ projection: sourceProjection });
  const verified = verifyBatterHitsFinalGradeReportV2({
    reportBytes: Buffer.from(`${JSON.stringify(report, null, 2)}\n`, 'utf8'),
    projection: sourceProjection,
  });
  assert.equal(verified.rows[0].archivedPWinGivenGrades, 0.63);
  assert.equal(verified.rows[0].outcome, 'win');
  assert.equal(verified.rows[2].officialHits, null);
  assert.equal(verified.rows[2].outcome, 'void');
  assert.equal(verified.rows[2].settlementVersion, BATTER_HITS_SETTLEMENT_RULE_VERSION);
});

test('missing official stats for a player present in complete final lineup evidence fails closed', () => {
  assert.throws(
    () => buildReport({ statsSnapshot: statsSnapshot({ omitStarter: true }) }),
    (error) =>
      error instanceof BatterHitsCaptureEvidenceError &&
      error.code === 'LIVE_LINEUP_CONTRADICTION' &&
      error.providerIdentity === `${GAME_ID}:${STARTER_ID}`,
  );
});

test('nonstarter absence cannot be inferred from incomplete lineup evidence', () => {
  assert.throws(
    () => buildReport({ lineupSnapshot: lineupSnapshot({ paginationComplete: false }) }),
    (error) =>
      error instanceof BatterHitsCaptureEvidenceError &&
      error.code === 'LINEUP_PAGINATION_INCOMPLETE' &&
      error.providerIdentity === `${GAME_ID}:${NONSTARTER_ID}`,
  );
});

test('Batter Hits v2 grading scripts and active scheduled entrypoint pass Node syntax checking', () => {
  for (const scriptPath of [
    'scripts/m10-batter-hits-final-grade-v2-utils.mjs',
    'scripts/m10-batter-hits-grade-v2-verifier.mjs',
    'scripts/grade-m10-batter-hits-pending-archives-v2.mjs',
    'scripts/grade-m10-pending-archives.mjs',
  ]) {
    const result = spawnSync(process.execPath, ['--check', scriptPath], { encoding: 'utf8' });
    assert.equal(result.status, 0, `${scriptPath}\n${result.stderr}`);
  }
});
