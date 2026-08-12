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
  HhrCaptureEvidenceError,
  hhrCumulativeInputDiagnostics,
  M10_HHR_GRADE_VERSION,
  verifyM10HhrArchiveBytes,
} from '../scripts/m10-hhr-evidence-utils.mjs';

const NONSTARTER_GAME_ID = 5059565;
const NONSTARTER_PLAYER_ID = 974;
const NONSTARTER_TEAM = 'Miami Marlins';
const NONSTARTER_OPPONENT = 'Pittsburgh Pirates';
const GRADED_AT = '2026-08-12T09:00:00.000Z';

// Sanitized projections of the credentialed BALLDONTLIE responses captured
// 2026-08-12 for game 5059565. Only fields consumed by this grading path are
// retained. Structural paths are copied from the live response; values that
// are irrelevant to the assertion are sanitized rather than invented as new
// provider fields.
const CREDENTIALED_GAME_RESPONSE = Object.freeze({
  data: Object.freeze({
    id: NONSTARTER_GAME_ID,
    status: 'STATUS_FINAL',
    home_team: Object.freeze({ display_name: NONSTARTER_TEAM }),
    away_team: Object.freeze({ display_name: NONSTARTER_OPPONENT }),
  }),
});

const CREDENTIALED_STATS_RESPONSE = Object.freeze({
  data: Object.freeze([
    Object.freeze({
      player: Object.freeze({ id: 810 }),
      game_id: NONSTARTER_GAME_ID,
      team_name: NONSTARTER_OPPONENT,
      runs: 0,
      hits: 0,
      rbi: 0,
    }),
    Object.freeze({
      player: Object.freeze({ id: 900001 }),
      game_id: NONSTARTER_GAME_ID,
      team_name: NONSTARTER_TEAM,
      runs: 0,
      hits: 0,
      rbi: 0,
    }),
  ]),
  meta: Object.freeze({ per_page: 100 }),
});

const CREDENTIALED_LINEUPS_RESPONSE = Object.freeze({
  data: Object.freeze([
    Object.freeze({
      game_id: NONSTARTER_GAME_ID,
      player: Object.freeze({ id: 502 }),
      team: Object.freeze({ display_name: NONSTARTER_TEAM }),
      batting_order: 1,
    }),
    Object.freeze({
      game_id: NONSTARTER_GAME_ID,
      player: Object.freeze({ id: 900002 }),
      team: Object.freeze({ display_name: NONSTARTER_OPPONENT }),
      batting_order: 1,
    }),
  ]),
  meta: Object.freeze({ per_page: 100 }),
});

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

function capturedGameResponse({ gameId, awayTeamName, homeTeamName }) {
  return {
    data: {
      ...CREDENTIALED_GAME_RESPONSE.data,
      id: gameId,
      away_team: { ...CREDENTIALED_GAME_RESPONSE.data.away_team, display_name: awayTeamName },
      home_team: { ...CREDENTIALED_GAME_RESPONSE.data.home_team, display_name: homeTeamName },
    },
  };
}

function capturedStatsResponse({ gameId, rows, meta = CREDENTIALED_STATS_RESPONSE.meta }) {
  return {
    data: rows.map(({ playerId, teamName, hits, runs, rbi }) => ({
      ...CREDENTIALED_STATS_RESPONSE.data[0],
      player: { ...CREDENTIALED_STATS_RESPONSE.data[0].player, id: playerId },
      game_id: gameId,
      team_name: teamName,
      hits,
      runs,
      rbi,
    })),
    meta: { ...meta },
  };
}

function capturedLineupsResponse({ gameId, rows, meta = CREDENTIALED_LINEUPS_RESPONSE.meta }) {
  return {
    data: rows.map(({ playerId, teamName, battingOrder }) => ({
      ...CREDENTIALED_LINEUPS_RESPONSE.data[0],
      game_id: gameId,
      player: { ...CREDENTIALED_LINEUPS_RESPONSE.data[0].player, id: playerId },
      team: { ...CREDENTIALED_LINEUPS_RESPONSE.data[0].team, display_name: teamName },
      batting_order: battingOrder,
    })),
    meta: { ...meta },
  };
}

function finalStatus(value, {
  gameId = NONSTARTER_GAME_ID,
  awayTeamName = NONSTARTER_OPPONENT,
  homeTeamName = NONSTARTER_TEAM,
} = {}) {
  return classifyHhrArchiveGameStatuses(value, [
    capturedGameResponse({ gameId, awayTeamName, homeTeamName }).data,
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
  return capturedStatsResponse({
    gameId: NONSTARTER_GAME_ID,
    rows: [
      { playerId: 810, teamName: NONSTARTER_OPPONENT, hits: 0, runs: 0, rbi: 0 },
      { playerId: 900001, teamName: NONSTARTER_TEAM, hits: 0, runs: 0, rbi: 0 },
    ],
  }).data;
}

function completeNonstarterLineups({ includeNonstarter = false } = {}) {
  const rows = [
    { playerId: 502, teamName: NONSTARTER_TEAM, battingOrder: 1 },
    { playerId: 900002, teamName: NONSTARTER_OPPONENT, battingOrder: 1 },
  ];
  if (includeNonstarter) {
    rows.push({ playerId: NONSTARTER_PLAYER_ID, teamName: NONSTARTER_TEAM, battingOrder: 9 });
  }
  return capturedLineupsResponse({ gameId: NONSTARTER_GAME_ID, rows }).data;
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

function assertCaptureEvidenceError(run, { code, providerIdentity, message }) {
  assert.throws(run, (error) => {
    assert.equal(error instanceof HhrCaptureEvidenceError, true);
    assert.equal(error.code, code);
    assert.equal(error.providerIdentity, providerIdentity);
    assert.match(error.message, message);
    return true;
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

function runtimeProviderFixtures(mode) {
  const games = new Map([
    [7001, capturedGameResponse({ gameId: 7001, awayTeamName: 'Away 7001', homeTeamName: 'Home 7001' })],
    [7002, capturedGameResponse({ gameId: 7002, awayTeamName: 'Away 7002', homeTeamName: 'Home 7002' })],
  ]);

  const blockedStatsRows = mode === 'stats-incomplete'
    ? [
        { playerId: 1101, teamName: 'Home 7001', hits: 1, runs: 0, rbi: 0 },
      ]
    : [
        { playerId: 1101, teamName: 'Home 7001', hits: 1, runs: 0, rbi: 0 },
        { playerId: 1199, teamName: 'Away 7001', hits: 0, runs: 0, rbi: 0 },
      ];

  const stats = new Map([
    [7001, capturedStatsResponse({ gameId: 7001, rows: blockedStatsRows })],
    [7002, capturedStatsResponse({
      gameId: 7002,
      rows: [
        { playerId: 1201, teamName: 'Home 7002', hits: 1, runs: 1, rbi: 0 },
        { playerId: 1299, teamName: 'Away 7002', hits: 0, runs: 0, rbi: 0 },
      ],
    })],
  ]);

  const blockedLineupRows = mode === 'case-a'
    ? [
        { playerId: 1101, teamName: 'Home 7001', battingOrder: 1 },
        { playerId: 1102, teamName: 'Home 7001', battingOrder: 2 },
        { playerId: 1199, teamName: 'Away 7001', battingOrder: 1 },
      ]
    : [
        { playerId: 1101, teamName: 'Home 7001', battingOrder: 1 },
        { playerId: 1199, teamName: 'Away 7001', battingOrder: 1 },
      ];

  const lineups = new Map([
    [7001, capturedLineupsResponse({ gameId: 7001, rows: blockedLineupRows })],
    [7002, capturedLineupsResponse({
      gameId: 7002,
      rows: [
        { playerId: 1201, teamName: 'Home 7002', battingOrder: 1 },
        { playerId: 1299, teamName: 'Away 7002', battingOrder: 1 },
      ],
    })],
  ]);

  return { games, stats, lineups };
}

async function setupRuntimeScenario(mode) {
  const root = await mkdtemp(path.join(os.tmpdir(), 'm10-hhr-capture-isolation-'));
  const attemptId = `capture-isolation-${mode}`;
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

  const provider = runtimeProviderFixtures(mode);
  const preloadPath = path.join(root, 'mock-bdl-fetch.mjs');
  const fixtureJson = JSON.stringify({
    games: [...provider.games.entries()],
    stats: [...provider.stats.entries()],
    lineups: [...provider.lineups.entries()],
  });
  await writeFile(
    preloadPath,
    `const fixtures = ${fixtureJson};\n` +
      `const games = new Map(fixtures.games);\n` +
      `const stats = new Map(fixtures.stats);\n` +
      `const lineups = new Map(fixtures.lineups);\n` +
      `const mode = ${JSON.stringify(mode)};\n` +
      `globalThis.fetch = async (input) => {\n` +
      `  const url = input instanceof URL ? input : new URL(typeof input === 'string' ? input : input.url);\n` +
      `  const gameMatch = /^\\/mlb\\/v1\\/games\\/(\\d+)$/u.exec(url.pathname);\n` +
      `  if (gameMatch) {\n` +
      `    const gameId = Number(gameMatch[1]);\n` +
      `    if (mode === 'network' && gameId === 7001) return new Response(JSON.stringify({ error: 'provider unavailable' }), { status: 503 });\n` +
      `    return new Response(JSON.stringify(games.get(gameId)), { status: 200 });\n` +
      `  }\n` +
      `  if (url.pathname === '/mlb/v1/stats') {\n` +
      `    const gameId = Number(url.searchParams.get('game_ids[]'));\n` +
      `    return new Response(JSON.stringify(stats.get(gameId)), { status: 200 });\n` +
      `  }\n` +
      `  if (url.pathname === '/mlb/v1/lineups') {\n` +
      `    const gameId = Number(url.searchParams.get('game_ids[]'));\n` +
      `    return new Response(JSON.stringify(lineups.get(gameId)), { status: 200 });\n` +
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

  return {
    root,
    attemptId,
    blockedArchive,
    goodArchive,
    result,
    output: `${result.stdout}\n${result.stderr}`,
  };
}

test('credentialed HHR provider fixture shapes stay locked to the live BALLDONTLIE response', () => {
  assert.equal(CREDENTIALED_GAME_RESPONSE.data.status, 'STATUS_FINAL');
  assert.equal(CREDENTIALED_GAME_RESPONSE.data.home_team.display_name, NONSTARTER_TEAM);
  assert.equal(CREDENTIALED_GAME_RESPONSE.data.away_team.display_name, NONSTARTER_OPPONENT);

  for (const statsRow of CREDENTIALED_STATS_RESPONSE.data) {
    assert.equal(Object.prototype.hasOwnProperty.call(statsRow, 'team_name'), true);
    assert.equal(typeof statsRow.team_name, 'string');
    assert.equal(Object.prototype.hasOwnProperty.call(statsRow, 'team'), false);
    assert.equal(Number.isSafeInteger(statsRow.game_id), true);
    assert.equal(Number.isSafeInteger(statsRow.player.id), true);
  }

  for (const lineupRow of CREDENTIALED_LINEUPS_RESPONSE.data) {
    assert.equal(Object.prototype.hasOwnProperty.call(lineupRow, 'team_name'), false);
    assert.equal(typeof lineupRow.team.display_name, 'string');
    assert.equal(Number.isSafeInteger(lineupRow.game_id), true);
    assert.equal(Number.isSafeInteger(lineupRow.player.id), true);
  }
});

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

test('Case A and incomplete provider evidence throw explicit capture-local evidence errors', () => {
  const contradictionLineups = completeNonstarterLineups({ includeNonstarter: true });
  assertCaptureEvidenceError(
    () => buildNonstarterReport({ lineupRows: contradictionLineups }),
    {
      code: 'LIVE_LINEUP_CONTRADICTION',
      providerIdentity: '5059565:974',
      message: /Missing official HHR stats for 5059565:974\. Player is present in live final-game lineups; approved sources contradict\./u,
    },
  );

  assertCaptureEvidenceError(
    () => buildNonstarterReport({ statsMeta: { per_page: 100, next_cursor: 123456 } }),
    {
      code: 'STATS_PAGINATION_INCOMPLETE',
      providerIdentity: '5059565:974',
      message: /stats response for game 5059565 is incomplete because meta\.next_cursor is present/u,
    },
  );

  const oneTeamStats = completeNonstarterStats().filter(
    (entry) => entry.team_name === NONSTARTER_TEAM,
  );
  assertCaptureEvidenceError(
    () => buildNonstarterReport({ statsRows: oneTeamStats }),
    {
      code: 'STATS_TEAM_MISSING',
      providerIdentity: '5059565:974',
      message: /stats response for game 5059565 is incomplete because team Pittsburgh Pirates is absent/u,
    },
  );

  assertCaptureEvidenceError(
    () => buildNonstarterReport({ lineupRows: [] }),
    {
      code: 'LINEUP_EMPTY',
      providerIdentity: '5059565:974',
      message: /lineup response for game 5059565 is empty; nonstarter absence cannot be inferred/u,
    },
  );
});

test('nonstarter voids stay in summaries, stay out of calibration, and per-line gates remain independent', () => {
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
  assert.equal(cumulative.selectedSide.perLine['1.5'].calibrationEligiblePicks, 0);
  assert.equal(cumulative.selectedSide.perLine['1.5'].evidenceStatus, 'insufficient');
  assert.equal(cumulative.selectedSide.perLine['2.5+'].calibrationEligiblePicks, 0);
  assert.equal(cumulative.selectedSide.perLine['2.5+'].evidenceStatus, 'insufficient');
});

test('Case A blocks only its capture, later captures grade, and the run exits non-zero', async () => {
  const scenario = await setupRuntimeScenario('case-a');
  try {
    assert.equal(scenario.result.status, 1, scenario.output);
    assert.match(
      scenario.output,
      /BLOCKED\t[^\n]+\t7001:1102\tMissing official HHR stats for 7001:1102\. Player is present in live final-game lineups; approved sources contradict\./u,
    );
    assert.ok(scenario.output.includes(`GRADED\t${scenario.goodArchive.captureKey}\t`), scenario.output);
    assert.match(scenario.output, /BLOCKED NOW\t1/u);
    assert.match(scenario.output, /CREATED CUMULATIVE\t/u);

    await assert.rejects(
      readFile(
        path.join(
          scenario.root,
          scenario.blockedArchive.captureKey,
          'grades',
          `${M10_HHR_GRADE_VERSION}.json`,
        ),
        'utf8',
      ),
      (error) => error && typeof error === 'object' && error.code === 'ENOENT',
    );

    const blockedStatus = JSON.parse(
      await readFile(
        path.join(
          scenario.root,
          scenario.blockedArchive.captureKey,
          'blocked-status',
          `${scenario.attemptId}.json`,
        ),
        'utf8',
      ),
    );
    assert.equal(blockedStatus.blockedStatusType, 'm10-hhr-capture-blocked-evidence');
    assert.equal(blockedStatus.evidenceCode, 'LIVE_LINEUP_CONTRADICTION');
    assert.equal(blockedStatus.providerGameId, 7001);
    assert.equal(blockedStatus.providerPlayerId, 1102);
    assert.equal(blockedStatus.providerIdentity, '7001:1102');
    assert.equal(blockedStatus.gradeReportWritten, false);
    assert.equal(blockedStatus.cumulativeEvidenceIncluded, false);

    const goodGrade = JSON.parse(
      await readFile(
        path.join(
          scenario.root,
          scenario.goodArchive.captureKey,
          'grades',
          `${M10_HHR_GRADE_VERSION}.json`,
        ),
        'utf8',
      ),
    );
    assert.equal(goodGrade.source.captureKey, scenario.goodArchive.captureKey);

    const cumulativeEntries = await readdir(path.join(scenario.root, 'cumulative'));
    assert.equal(cumulativeEntries.length, 1);
    const cumulative = JSON.parse(
      await readFile(path.join(scenario.root, 'cumulative', cumulativeEntries[0]), 'utf8'),
    );
    assert.ok(cumulative.sources.some((source) => source.captureKey === scenario.goodArchive.captureKey));
    assert.ok(cumulative.sources.every((source) => source.captureKey !== scenario.blockedArchive.captureKey));
  } finally {
    await rm(scenario.root, { recursive: true, force: true });
  }
});

test('stats completeness failure blocks only its capture, later captures grade, and the run exits non-zero', async () => {
  const scenario = await setupRuntimeScenario('stats-incomplete');
  try {
    assert.equal(scenario.result.status, 1, scenario.output);
    assert.match(
      scenario.output,
      /BLOCKED\t[^\n]+\t7001:1102\tHHR stats response for game 7001 is incomplete because team Away 7001 is absent\./u,
    );
    assert.ok(scenario.output.includes(`GRADED\t${scenario.goodArchive.captureKey}\t`), scenario.output);
    assert.match(scenario.output, /BLOCKED NOW\t1/u);

    const blockedStatus = JSON.parse(
      await readFile(
        path.join(
          scenario.root,
          scenario.blockedArchive.captureKey,
          'blocked-status',
          `${scenario.attemptId}.json`,
        ),
        'utf8',
      ),
    );
    assert.equal(blockedStatus.evidenceCode, 'STATS_TEAM_MISSING');
    assert.equal(blockedStatus.providerIdentity, '7001:1102');

    const goodGrade = JSON.parse(
      await readFile(
        path.join(
          scenario.root,
          scenario.goodArchive.captureKey,
          'grades',
          `${M10_HHR_GRADE_VERSION}.json`,
        ),
        'utf8',
      ),
    );
    assert.equal(goodGrade.source.captureKey, scenario.goodArchive.captureKey);
  } finally {
    await rm(scenario.root, { recursive: true, force: true });
  }
});

test('provider HTTP failure remains globally fatal and is never converted into a blocked capture', async () => {
  const scenario = await setupRuntimeScenario('network');
  try {
    assert.equal(scenario.result.status, 1, scenario.output);
    assert.match(scenario.output, /BDL HHR game status 7001 returned HTTP 503/u);
    assert.doesNotMatch(scenario.output, /BLOCKED STATUS WRITTEN/u);
    assert.doesNotMatch(scenario.output, new RegExp(`GRADED\\t${scenario.goodArchive.captureKey}`, 'u'));
    await assert.rejects(
      readdir(path.join(scenario.root, scenario.blockedArchive.captureKey, 'blocked-status')),
      (error) => error && typeof error === 'object' && error.code === 'ENOENT',
    );
  } finally {
    await rm(scenario.root, { recursive: true, force: true });
  }
});

test('grading runtime fetches live lineups, persists provider meta, and uses typed capture isolation without regex matching', async () => {
  const source = await readFile('scripts/grade-m10-hhr-pending-archives.mjs', 'utf8');
  assert.match(source, /https:\/\/api\.balldontlie\.io\/mlb\/v1\/lineups/u);
  assert.match(source, /url\.searchParams\.append\('game_ids\[\]', String\(gameId\)\)/u);
  assert.match(source, /statsGameSnapshots: stats\.snapshots/u);
  assert.match(source, /statsRowCount: stats\.rows\.length/u);
  assert.match(source, /lineupGameSnapshots: lineups\.snapshots/u);
  assert.match(source, /lineupRowCount: lineups\.rows\.length/u);
  assert.match(source, /lineupRows: lineups\.rows/u);
  assert.match(source, /error instanceof HhrCaptureEvidenceError/u);
  assert.doesNotMatch(source, /MISSING_OFFICIAL_STATS_PATTERN/u);
  assert.doesNotMatch(source, /lineupStatus/u);
});
