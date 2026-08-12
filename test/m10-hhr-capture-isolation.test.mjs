import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import {
  buildM10HhrCumulativeSelectedSideReport,
  buildM10HhrFinalGradeReport,
  buildM10HhrProspectiveArchive,
  classifyHhrArchiveGameStatuses,
  hhrCumulativeInputDiagnostics,
  M10_HHR_GRADE_VERSION,
  verifyM10HhrArchiveBytes,
} from '../scripts/m10-hhr-evidence-utils.mjs';

const NONSTARTER_GAME_ID = 5059565;
const NONSTARTER_PLAYER_ID = 974;
const NONSTARTER_TEAM = 'Miami Marlins';
const NONSTARTER_OPPONENT = 'Pittsburgh Pirates';
const GRADED_AT = '2026-08-12T09:00:00.000Z';

function row({ eventId, gameId, playerId, side, probability }) {
  return Object.freeze({
    providerEventId: eventId,
    providerGameId: gameId,
    providerPlayerId: playerId,
    providerMarketKey: 'batter_hits_runs_rbis_alternate',
    offerType: 'alternate',
    playerName: playerId === NONSTARTER_PLAYER_ID ? 'Leo Jimenez' : `Player ${playerId}`,
    selectedSide: side,
    postedLine: 0.5,
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

function pair({ eventId, gameId, playerId, higherProbability }) {
  return [
    row({ eventId, gameId, playerId, side: 'higher', probability: higherProbability }),
    row({ eventId, gameId, playerId, side: 'lower', probability: 1 - higherProbability }),
  ];
}

function archive({ capturedAt, sourceSetSha256, eventId, gameId, playerIds }) {
  const rows = playerIds.flatMap((playerId, index) =>
    pair({
      eventId,
      gameId,
      playerId,
      higherProbability: index % 2 === 0 ? 0.62 : 0.41,
    }),
  );
  return buildM10HhrProspectiveArchive({
    capturedAt,
    sourceSetSha256,
    source: {
      theOddsApi: {
        provider: 'The Odds API',
        boardBookmaker: 'underdog',
        boardRegion: 'us_dfs',
      },
      balldontlie: { provider: 'BALLDONTLIE MLB API' },
    },
    games: [{ gameId }],
    rows,
    exclusions: [],
    diagnosticsPath: 'diagnostics/test.json',
  });
}

function verifiedArchive(value) {
  const bytes = Buffer.from(`${JSON.stringify(value, null, 2)}\n`, 'utf8');
  return verifyM10HhrArchiveBytes({
    bytes,
    archivePath: `captures/${value.captureKey}.json`,
    expectedCaptureKey: value.captureKey,
  });
}

function finalStatus(value, {
  gameId = NONSTARTER_GAME_ID,
  awayTeamName = NONSTARTER_OPPONENT,
  homeTeamName = NONSTARTER_TEAM,
} = {}) {
  return classifyHhrArchiveGameStatuses(value, [
    {
      id: gameId,
      status: 'STATUS_FINAL',
      away_team: { display_name: awayTeamName },
      home_team: { display_name: homeTeamName },
    },
  ]);
}

function nonstarterArchive() {
  return verifiedArchive(archive({
    capturedAt: '2026-08-11T15:56:54.406Z',
    sourceSetSha256: 'c'.repeat(64),
    eventId: 'nonstarter-event',
    gameId: NONSTARTER_GAME_ID,
    playerIds: [NONSTARTER_PLAYER_ID, 810],
  }));
}

function completeNonstarterStats() {
  return [
    {
      game_id: NONSTARTER_GAME_ID,
      player: { id: 810 },
      team: { display_name: NONSTARTER_TEAM },
      hits: 1,
      runs: 0,
      rbi: 0,
    },
    {
      game_id: NONSTARTER_GAME_ID,
      player: { id: 9901 },
      team: { display_name: NONSTARTER_OPPONENT },
      hits: 0,
      runs: 0,
      rbi: 0,
    },
  ];
}

function completeNonstarterLineups({ includeNonstarter = false } = {}) {
  const rows = [
    {
      game_id: NONSTARTER_GAME_ID,
      player: { id: 810 },
      team: { display_name: NONSTARTER_TEAM },
      batting_order: 1,
    },
    {
      game_id: NONSTARTER_GAME_ID,
      player: { id: 9901 },
      team: { display_name: NONSTARTER_OPPONENT },
      batting_order: 1,
    },
  ];
  if (includeNonstarter) {
    rows.push({
      game_id: NONSTARTER_GAME_ID,
      player: { id: NONSTARTER_PLAYER_ID },
      team: { display_name: NONSTARTER_TEAM },
      batting_order: 9,
    });
  }
  return rows;
}

function buildNonstarterReport({
  statsRows = completeNonstarterStats(),
  statsMeta = { per_page: 100 },
  lineupRows = completeNonstarterLineups(),
} = {}) {
  const value = nonstarterArchive();
  return buildM10HhrFinalGradeReport({
    archive: value,
    statsRows,
    statsSnapshots: [{
      gameId: NONSTARTER_GAME_ID,
      capturedAt: GRADED_AT,
      rowCount: statsRows.length,
      meta: statsMeta,
    }],
    lineupRows,
    lineupSnapshots: [{
      gameId: NONSTARTER_GAME_ID,
      capturedAt: GRADED_AT,
      rowCount: lineupRows.length,
      meta: { per_page: 100 },
    }],
    gradedAt: GRADED_AT,
    gameStatusEvidence: finalStatus(value),
  });
}

function gradedSeedPair() {
  return pair({
    eventId: 'seed-event',
    gameId: 6001,
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

test('Case B: final complete stats plus live lineup absence grades the player as a registered-rule void', () => {
  const report = buildNonstarterReport();
  const nonstarterRows = report.rows.filter((entry) => entry.providerPlayerId === NONSTARTER_PLAYER_ID);
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
  assert.equal(report.summary.picksGraded, 2);
  assert.equal(report.summary.voids, 1);
  assert.equal(report.summary.decidedPicks, 1);
});

test('Case A and incomplete provider evidence remain fail-closed', () => {
  const contradictionLineups = completeNonstarterLineups({ includeNonstarter: true });
  assert.throws(
    () => buildNonstarterReport({ lineupRows: contradictionLineups }),
    /Missing official HHR stats for 5059565:974\. Player is present in live final-game lineups; approved sources contradict\./u,
  );

  assert.throws(
    () => buildNonstarterReport({ statsMeta: { per_page: 100, next_cursor: 123456 } }),
    /stats response for game 5059565 is incomplete because meta\.next_cursor is present/u,
  );

  const oneTeamStats = completeNonstarterStats().filter(
    (entry) => entry.team.display_name === NONSTARTER_TEAM,
  );
  assert.throws(
    () => buildNonstarterReport({ statsRows: oneTeamStats }),
    /stats response for game 5059565 is incomplete because team Pittsburgh Pirates is absent/u,
  );

  assert.throws(
    () => buildNonstarterReport({ lineupRows: [] }),
    /lineup response for game 5059565 is empty; nonstarter absence cannot be inferred/u,
  );
});

test('nonstarter voids stay in grade summaries but never enter selected-side calibration counts', () => {
  const daily = buildNonstarterReport();
  const step3Archive = {
    captureKey: `20260806T004000000Z--${'d'.repeat(64)}`,
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

test('blocked Case A capture writes no grade, later captures continue, and the run exits non-zero', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'm10-hhr-capture-isolation-'));
  const attemptId = 'capture-isolation-test';
  try {
    const capturesDirectory = path.join(root, 'captures');
    await mkdir(capturesDirectory, { recursive: true });

    const blockedArchive = archive({
      capturedAt: '2026-08-09T21:54:25.735Z',
      sourceSetSha256: 'a'.repeat(64),
      eventId: 'blocked-event',
      gameId: 7001,
      playerIds: [1101, 1102],
    });
    const goodArchive = archive({
      capturedAt: '2026-08-10T21:54:25.735Z',
      sourceSetSha256: 'b'.repeat(64),
      eventId: 'good-event',
      gameId: 7002,
      playerIds: [1201],
    });

    for (const value of [blockedArchive, goodArchive]) {
      await writeFile(
        path.join(capturesDirectory, `${value.captureKey}.json`),
        `${JSON.stringify(value, null, 2)}\n`,
        'utf8',
      );
    }

    const preloadPath = path.join(root, 'mock-bdl-fetch.mjs');
    await writeFile(
      preloadPath,
      `const teamsByGame = new Map([\n` +
        `  [7001, { away: 'Away 7001', home: 'Home 7001' }],\n` +
        `  [7002, { away: 'Away 7002', home: 'Home 7002' }],\n` +
        `]);\n` +
        `const statsByGame = new Map([\n` +
        `  [7001, [\n` +
        `    { game_id: 7001, player: { id: 1101 }, team: { display_name: 'Home 7001' }, hits: 1, runs: 0, rbi: 0 },\n` +
        `    { game_id: 7001, player: { id: 1199 }, team: { display_name: 'Away 7001' }, hits: 0, runs: 0, rbi: 0 },\n` +
        `  ]],\n` +
        `  [7002, [\n` +
        `    { game_id: 7002, player: { id: 1201 }, team: { display_name: 'Home 7002' }, hits: 1, runs: 1, rbi: 0 },\n` +
        `    { game_id: 7002, player: { id: 1299 }, team: { display_name: 'Away 7002' }, hits: 0, runs: 0, rbi: 0 },\n` +
        `  ]],\n` +
        `]);\n` +
        `const lineupsByGame = new Map([\n` +
        `  [7001, [\n` +
        `    { game_id: 7001, player: { id: 1101 }, team: { display_name: 'Home 7001' }, batting_order: 1 },\n` +
        `    { game_id: 7001, player: { id: 1102 }, team: { display_name: 'Home 7001' }, batting_order: 2 },\n` +
        `    { game_id: 7001, player: { id: 1199 }, team: { display_name: 'Away 7001' }, batting_order: 1 },\n` +
        `  ]],\n` +
        `  [7002, [\n` +
        `    { game_id: 7002, player: { id: 1201 }, team: { display_name: 'Home 7002' }, batting_order: 1 },\n` +
        `    { game_id: 7002, player: { id: 1299 }, team: { display_name: 'Away 7002' }, batting_order: 1 },\n` +
        `  ]],\n` +
        `]);\n` +
        `globalThis.fetch = async (input) => {\n` +
        `  const url = input instanceof URL ? input : new URL(typeof input === 'string' ? input : input.url);\n` +
        `  const gameMatch = /^\\/mlb\\/v1\\/games\\/(\\d+)$/u.exec(url.pathname);\n` +
        `  if (gameMatch) {\n` +
        `    const gameId = Number(gameMatch[1]);\n` +
        `    const teams = teamsByGame.get(gameId);\n` +
        `    return new Response(JSON.stringify({ data: { id: gameId, status: 'STATUS_FINAL', away_team: { display_name: teams.away }, home_team: { display_name: teams.home } } }), { status: 200 });\n` +
        `  }\n` +
        `  if (url.pathname === '/mlb/v1/stats') {\n` +
        `    const gameId = Number(url.searchParams.get('game_ids[]'));\n` +
        `    return new Response(JSON.stringify({ data: statsByGame.get(gameId) ?? [], meta: { per_page: 100 } }), { status: 200 });\n` +
        `  }\n` +
        `  if (url.pathname === '/mlb/v1/lineups') {\n` +
        `    const gameId = Number(url.searchParams.get('game_ids[]'));\n` +
        `    return new Response(JSON.stringify({ data: lineupsByGame.get(gameId) ?? [], meta: { per_page: 100 } }), { status: 200 });\n` +
        `  }\n` +
        `  return new Response(JSON.stringify({ error: 'unexpected test URL' }), { status: 500 });\n` +
        `};\n`,
      'utf8',
    );

    const result = spawnSync(
      process.execPath,
      ['--import', preloadPath, 'scripts/grade-m10-hhr-pending-archives.mjs'],
      {
        cwd: process.cwd(),
        env: {
          ...process.env,
          BALLDONTLIE_API_KEY: 'test-only-key',
          M10_HHR_ARCHIVE_ROOT: root,
          M10_GRADE_ATTEMPT_ID: attemptId,
          M10_BDL_MIN_REQUEST_INTERVAL_MS: '0',
        },
        encoding: 'utf8',
        timeout: 30_000,
      },
    );

    const output = `${result.stdout}\n${result.stderr}`;
    assert.equal(result.status, 1, output);
    assert.match(
      output,
      /BLOCKED\t[^\n]+\t7001:1102\tMissing official HHR stats for 7001:1102\. Player is present in live final-game lineups; approved sources contradict\./u,
    );
    assert.ok(output.includes(`GRADED\t${goodArchive.captureKey}\t`), output);
    assert.match(output, /BLOCKED NOW\t1/u);
    assert.match(output, /CREATED CUMULATIVE\t/u);

    const blockedGradePath = path.join(
      root,
      blockedArchive.captureKey,
      'grades',
      `${M10_HHR_GRADE_VERSION}.json`,
    );
    await assert.rejects(
      readFile(blockedGradePath, 'utf8'),
      (error) => error && typeof error === 'object' && error.code === 'ENOENT',
    );

    const blockedStatus = JSON.parse(
      await readFile(
        path.join(root, blockedArchive.captureKey, 'blocked-status', `${attemptId}.json`),
        'utf8',
      ),
    );
    assert.equal(blockedStatus.providerGameId, 7001);
    assert.equal(blockedStatus.providerPlayerId, 1102);
    assert.equal(blockedStatus.providerIdentity, '7001:1102');
    assert.equal(
      blockedStatus.error,
      'Missing official HHR stats for 7001:1102. Player is present in live final-game lineups; approved sources contradict.',
    );
    assert.equal(blockedStatus.gradeReportWritten, false);
    assert.equal(blockedStatus.cumulativeEvidenceIncluded, false);

    const providerEvidence = JSON.parse(
      await readFile(
        path.join(root, blockedArchive.captureKey, 'provider-evidence', `${attemptId}--stats-input.json`),
        'utf8',
      ),
    );
    assert.equal(providerEvidence.providerEvidenceVersion, 2);
    assert.equal(providerEvidence.statsGameSnapshots[0].rowCount, 2);
    assert.deepEqual(providerEvidence.statsGameSnapshots[0].meta, { per_page: 100 });
    assert.equal(providerEvidence.lineupGameSnapshots[0].rowCount, 3);
    assert.deepEqual(providerEvidence.lineupGameSnapshots[0].meta, { per_page: 100 });

    const goodGrade = JSON.parse(
      await readFile(
        path.join(root, goodArchive.captureKey, 'grades', `${M10_HHR_GRADE_VERSION}.json`),
        'utf8',
      ),
    );
    assert.equal(goodGrade.source.captureKey, goodArchive.captureKey);
    assert.equal(goodGrade.rows.length, goodArchive.rows.length);

    const cumulativeEntries = await readdir(path.join(root, 'cumulative'));
    assert.equal(cumulativeEntries.length, 1);
    const cumulative = JSON.parse(
      await readFile(path.join(root, 'cumulative', cumulativeEntries[0]), 'utf8'),
    );
    assert.ok(cumulative.sources.some((source) => source.captureKey === goodArchive.captureKey));
    assert.ok(cumulative.sources.every((source) => source.captureKey !== blockedArchive.captureKey));
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('grading runtime fetches live lineups and persists stats/lineup meta without reading archived lineupStatus', async () => {
  const source = await readFile('scripts/grade-m10-hhr-pending-archives.mjs', 'utf8');
  assert.match(source, /https:\/\/api\.balldontlie\.io\/mlb\/v1\/lineups/u);
  assert.match(source, /url\.searchParams\.append\('game_ids\[\]', String\(gameId\)\)/u);
  assert.match(source, /statsGameSnapshots: stats\.snapshots/u);
  assert.match(source, /statsRowCount: stats\.rows\.length/u);
  assert.match(source, /lineupGameSnapshots: lineups\.snapshots/u);
  assert.match(source, /lineupRowCount: lineups\.rows\.length/u);
  assert.match(source, /lineupRows: lineups\.rows/u);
  assert.doesNotMatch(source, /lineupStatus/u);
});
