import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

import {
  buildM10HhrCumulativeSelectedSideReport,
  buildM10HhrFinalGradeReport,
  buildM10HhrProspectiveArchive,
  classifyHhrArchiveGameStatuses,
  hhrCumulativeInputDiagnostics,
  verifyM10HhrArchiveBytes,
} from '../scripts/m10-hhr-evidence-utils.mjs';

const SHA_A = 'a'.repeat(64);
const SHA_B = 'b'.repeat(64);
const CAPTURED_AT = '2026-08-12T02:00:00.000Z';
const GRADED_AT = '2026-08-12T09:00:00.000Z';
const GAME_ID = 5059565;
const AWAY_TEAM = 'Pittsburgh Pirates';
const HOME_TEAM = 'Miami Marlins';
const NONSTARTER_ID = 974;
const STARTER_ID = 810;

function row({ eventId, gameId, playerId, line = 0.5, side, probability }) {
  return Object.freeze({
    providerEventId: eventId,
    providerGameId: gameId,
    providerPlayerId: playerId,
    providerMarketKey: 'batter_hits_runs_rbis_alternate',
    offerType: 'alternate',
    playerName: playerId === NONSTARTER_ID ? 'Leo Jimenez' : `Player ${playerId}`,
    selectedSide: side,
    postedLine: line,
    americanPrice: null,
    multiplier: null,
    archivedPWin: probability,
    archivedPLoss: 1 - probability,
    archivedPVoid: 0,
    archivedPWinGivenGrades: probability,
    distributionIdentity: {
      mean: 1.5,
      dispersionAlpha: 0.5,
      modelVersion: 'm11-batter-hhr-direct-composite-v2',
      distributionBuilderVersion: 'm11-batter-hhr-negative-binomial-v1',
    },
    inputLineage: { fixture: true },
  });
}

function pair({ eventId, gameId, playerId, line = 0.5, higherProbability = 0.64 }) {
  return [
    row({ eventId, gameId, playerId, line, side: 'higher', probability: higherProbability }),
    row({ eventId, gameId, playerId, line, side: 'lower', probability: 1 - higherProbability }),
  ];
}

function verifiedArchive() {
  const archive = buildM10HhrProspectiveArchive({
    capturedAt: CAPTURED_AT,
    sourceSetSha256: SHA_A,
    source: {
      theOddsApi: { provider: 'The Odds API', boardBookmaker: 'underdog', boardRegion: 'us_dfs' },
      balldontlie: { provider: 'BALLDONTLIE MLB API' },
    },
    games: [{ gameId: GAME_ID }],
    rows: [
      ...pair({ eventId: 'event-nonstarter', gameId: GAME_ID, playerId: NONSTARTER_ID, higherProbability: 0.68 }),
      ...pair({ eventId: 'event-starter', gameId: GAME_ID, playerId: STARTER_ID, higherProbability: 0.61 }),
    ],
    exclusions: [],
    diagnosticsPath: 'diagnostics/nonstarter.json',
  });
  const bytes = Buffer.from(`${JSON.stringify(archive, null, 2)}\n`, 'utf8');
  return verifyM10HhrArchiveBytes({
    bytes,
    archivePath: `captures/${archive.captureKey}.json`,
    expectedCaptureKey: archive.captureKey,
  });
}

function finalStatus(archive) {
  return classifyHhrArchiveGameStatuses(archive, [
    {
      id: GAME_ID,
      status: 'STATUS_FINAL',
      away_team: { display_name: AWAY_TEAM },
      home_team: { display_name: HOME_TEAM },
    },
  ]);
}

function completeStatsRows() {
  return [
    {
      game_id: GAME_ID,
      player: { id: STARTER_ID },
      team: { display_name: HOME_TEAM },
      hits: 1,
      runs: 0,
      rbi: 0,
    },
    {
      game_id: GAME_ID,
      player: { id: 999001 },
      team: { display_name: AWAY_TEAM },
      hits: 0,
      runs: 0,
      rbi: 0,
    },
  ];
}

function statsSnapshots(meta = { per_page: 100 }, rowCount = 2) {
  return [{ gameId: GAME_ID, capturedAt: GRADED_AT, rowCount, meta }];
}

function completeLineupRows({ includeNonstarter = false } = {}) {
  const rows = [
    {
      game_id: GAME_ID,
      player: { id: STARTER_ID },
      team: { display_name: HOME_TEAM },
      batting_order: 1,
    },
    {
      game_id: GAME_ID,
      player: { id: 999001 },
      team: { display_name: AWAY_TEAM },
      batting_order: 1,
    },
  ];
  if (includeNonstarter) {
    rows.push({
      game_id: GAME_ID,
      player: { id: NONSTARTER_ID },
      team: { display_name: HOME_TEAM },
      batting_order: 9,
    });
  }
  return rows;
}

function lineupSnapshots(rows) {
  return [{ gameId: GAME_ID, capturedAt: GRADED_AT, rowCount: rows.length, meta: { per_page: 100 } }];
}

function buildDaily({
  statsRows = completeStatsRows(),
  statsSnapshotRows = statsSnapshots(),
  lineupRows = completeLineupRows(),
  lineupSnapshotRows = lineupSnapshots(lineupRows),
} = {}) {
  const archive = verifiedArchive();
  return buildM10HhrFinalGradeReport({
    archive,
    statsRows,
    statsSnapshots: statsSnapshotRows,
    lineupRows,
    lineupSnapshots: lineupSnapshotRows,
    gradedAt: GRADED_AT,
    gameStatusEvidence: finalStatus(archive),
  });
}

function gradedSeedPair() {
  return pair({
    eventId: 'seed-event',
    gameId: 5000001,
    playerId: 7001,
    higherProbability: 0.63,
  }).map((entry) => ({
    ...entry,
    officialHhr: 1,
    officialHits: 1,
    officialComponents: { hits: 1, runs: 0, rbi: 0, officialHhr: 1 },
    outcome: entry.selectedSide === 'higher' ? 'win' : 'loss',
    settlementVersion: 'observed-discrete-statistic-settlement-v1',
  }));
}

test('Case B: exact-final complete stats plus live lineup absence grades the nonstarter as a registered-rule full void', () => {
  const report = buildDaily();
  const nonstarterRows = report.rows.filter((entry) => entry.providerPlayerId === NONSTARTER_ID);
  assert.equal(nonstarterRows.length, 2);
  for (const entry of nonstarterRows) {
    assert.equal(entry.playerName, 'Leo Jimenez');
    assert.equal(entry.officialHhr, null);
    assert.equal(entry.officialHits, null);
    assert.equal(entry.officialComponents, null);
    assert.equal(entry.outcome, 'void');
    assert.equal(entry.settlementVersion, 'underdog-batter-hhr-settlement-v1');
    assert.equal(entry.settlementReason, 'verified-final-nonstarter');
    assert.deepEqual(entry.gradingSettlement, {
      eligibilityProbability: 0,
      winProbability: 0,
      lossProbability: 0,
      voidProbability: 1,
      winProbabilityGivenGrades: null,
      settlementRuleVersion: 'underdog-batter-hhr-settlement-v1',
      ruleSourceReference: 'fixtures/sanitized/m11/hhr/settlement/underdog-batter-hhr-settlement-v1.json',
    });
  }
  assert.deepEqual(
    nonstarterRows.map((entry) => entry.archivedPWinGivenGrades),
    [0.68, 0.31999999999999995],
  );
  assert.equal(report.summary.picksGraded, 2);
  assert.equal(report.summary.voids, 1);
  assert.equal(report.summary.decidedPicks, 1);
});

test('Case A and incomplete evidence fail closed instead of converting a missing stats row to a void', () => {
  const contradictionLineups = completeLineupRows({ includeNonstarter: true });
  assert.throws(
    () => buildDaily({
      lineupRows: contradictionLineups,
      lineupSnapshotRows: lineupSnapshots(contradictionLineups),
    }),
    /Missing official HHR stats for 5059565:974\. Player is present in live final-game lineups; approved sources contradict\./u,
  );

  assert.throws(
    () => buildDaily({
      statsSnapshotRows: statsSnapshots({ per_page: 100, next_cursor: 123456 }),
    }),
    /stats response for game 5059565 is incomplete because meta\.next_cursor is present/u,
  );

  const oneTeamStats = completeStatsRows().filter((entry) => entry.team.display_name === HOME_TEAM);
  assert.throws(
    () => buildDaily({
      statsRows: oneTeamStats,
      statsSnapshotRows: statsSnapshots({ per_page: 100 }, oneTeamStats.length),
    }),
    /stats response for game 5059565 is incomplete because team Pittsburgh Pirates is absent/u,
  );

  assert.throws(
    () => buildDaily({
      lineupRows: [],
      lineupSnapshotRows: [{ gameId: GAME_ID, capturedAt: GRADED_AT, rowCount: 0, meta: { per_page: 100 } }],
    }),
    /lineup response for game 5059565 is empty; nonstarter absence cannot be inferred/u,
  );
});

test('HHR cumulative calibration excludes nonstarter voids while preserving them in selected-side grade summaries', () => {
  const daily = buildDaily();
  const step3Archive = {
    captureKey: `20260806T004000000Z--${SHA_B}`,
    gradedAt: '2026-08-06T09:00:00.000Z',
    rows: gradedSeedPair(),
    safety: { productionEnabled: false, rankingEnabled: false },
  };

  const diagnostics = hhrCumulativeInputDiagnostics({ step3Archive, gradeReports: [daily] });
  assert.equal(diagnostics.selectedSideRows, 3);
  assert.equal(diagnostics.calibrationEligibleRows, 2);
  assert.equal(diagnostics.voidSelectedSideRows, 1);
  assert.deepEqual(diagnostics.lineCounts, { '0.5': 2, '1.5': 0, '2.5+': 0 });
  assert.equal(
    diagnostics.calibration.reduce((total, bucket) => total + bucket.picksGraded, 0),
    2,
  );

  const cumulative = buildM10HhrCumulativeSelectedSideReport({
    step3Archive,
    gradeReports: [daily],
    generatedAt: GRADED_AT,
  });
  assert.equal(cumulative.selectedSide.summary.picksGraded, 3);
  assert.equal(cumulative.selectedSide.summary.voids, 1);
  assert.equal(cumulative.selectedSide.calibrationEligiblePicks, 2);
  assert.equal(
    cumulative.selectedSide.calibration.reduce((total, bucket) => total + bucket.picksGraded, 0),
    2,
  );
  assert.equal(cumulative.selectedSide.perLine['0.5'].summary.picksGraded, 3);
  assert.equal(cumulative.selectedSide.perLine['0.5'].summary.voids, 1);
  assert.equal(cumulative.selectedSide.perLine['0.5'].calibrationEligiblePicks, 2);
  assert.equal(cumulative.selectedSide.perLine['0.5'].evidenceStatus, 'insufficient');
});

test('grading runtime fetches live final-game lineups and persists auditable stats/lineup meta without archived lineupStatus', async () => {
  const source = await readFile('scripts/grade-m10-hhr-pending-archives.mjs', 'utf8');
  assert.match(source, /https:\/\/api\.balldontlie\.io\/mlb\/v1\/lineups/u);
  assert.match(source, /url\.searchParams\.append\('game_ids\[\]', String\(gameId\)\)/u);
  assert.match(source, /url\.searchParams\.set\('per_page', '100'\)/u);
  assert.match(source, /statsGameSnapshots: stats\.snapshots/u);
  assert.match(source, /statsRowCount: stats\.rows\.length/u);
  assert.match(source, /lineupGameSnapshots: lineups\.snapshots/u);
  assert.match(source, /lineupRowCount: lineups\.rows\.length/u);
  assert.match(source, /meta,/u);
  assert.match(source, /lineupRows: lineups\.rows/u);
  assert.doesNotMatch(source, /lineupStatus/u);
});
