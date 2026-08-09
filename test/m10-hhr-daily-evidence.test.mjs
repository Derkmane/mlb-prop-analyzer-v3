import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import test from 'node:test';

import { createBdlAdaptiveRateLimiter } from '../scripts/bdl-adaptive-rate-limit-utils.mjs';
import { classifyHhrUnderdogBookmakerAvailability } from '../scripts/m10-hhr-board-availability-utils.mjs';
import {
  buildM10HhrCumulativeSelectedSideReport,
  buildM10HhrFinalGradeReport,
  buildM10HhrProspectiveArchive,
  classifyHhrArchiveGameStatuses,
  createM10HhrCaptureKey,
  hhrCumulativeInputDiagnostics,
  verifyM10HhrArchiveBytes,
} from '../scripts/m10-hhr-evidence-utils.mjs';

const SHA_A = 'a'.repeat(64);
const SHA_B = 'b'.repeat(64);
const CAPTURED_AT = '2026-08-07T21:15:00.000Z';

function hhrCaptureWithBookmakers(bookmakers) {
  return Object.freeze({
    captureVersion: 1,
    capturedAt: CAPTURED_AT,
    captureMode: 'prospective-m10-daily-evidence',
    request: Object.freeze({
      provider: 'The Odds API',
      bookmaker: 'underdog',
      region: 'us_dfs',
      marketKeys: Object.freeze([
        'batter_hits_runs_rbis',
        'batter_hits_runs_rbis_alternate',
      ]),
      dateFormat: 'iso',
      oddsFormat: 'american',
      includeMultipliers: true,
      includeSids: true,
    }),
    sourceSnapshotSha256: SHA_A,
    response: Object.freeze({
      id: 'event-a',
      commence_time: CAPTURED_AT,
      home_team: 'Home Team',
      away_team: 'Away Team',
      bookmakers,
    }),
  });
}

function row({
  eventId,
  gameId,
  playerId,
  line,
  side,
  probability,
  offerType = 'alternate',
}) {
  return Object.freeze({
    providerEventId: eventId,
    providerGameId: gameId,
    providerPlayerId: playerId,
    providerMarketKey:
      offerType === 'baseline'
        ? 'batter_hits_runs_rbis'
        : 'batter_hits_runs_rbis_alternate',
    offerType,
    playerName: `Player ${playerId}`,
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

function pair({ eventId, gameId, playerId, line, higherProbability }) {
  return [
    row({ eventId, gameId, playerId, line, side: 'higher', probability: higherProbability }),
    row({ eventId, gameId, playerId, line, side: 'lower', probability: 1 - higherProbability }),
  ];
}

function archiveFixture() {
  const rows = [
    ...pair({ eventId: 'event-a', gameId: 5001, playerId: 1001, line: 0.5, higherProbability: 0.61 }),
    ...pair({ eventId: 'event-a', gameId: 5001, playerId: 1002, line: 1.5, higherProbability: 0.42 }),
    ...pair({ eventId: 'event-a', gameId: 5001, playerId: 1003, line: 2.5, higherProbability: 0.68 }),
    ...pair({ eventId: 'event-a', gameId: 5001, playerId: 1004, line: 3.5, higherProbability: 0.31 }),
  ];
  return buildM10HhrProspectiveArchive({
    capturedAt: CAPTURED_AT,
    sourceSetSha256: SHA_A,
    source: {
      theOddsApi: {
        provider: 'The Odds API',
        boardBookmaker: 'underdog',
        boardRegion: 'us_dfs',
      },
      balldontlie: { provider: 'BALLDONTLIE MLB API' },
    },
    games: [{ gameId: 5001 }],
    rows,
    exclusions: [],
    diagnosticsPath: 'diagnostics/pre-gate.json',
  });
}

function officialStats() {
  return [
    { game_id: 5001, player: { id: 1001 }, hits: 1, runs: 0, rbi: 0 },
    { game_id: 5001, player: { id: 1002 }, hits: 1, runs: 1, rbi: 0 },
    { game_id: 5001, player: { id: 1003 }, hits: 1, runs: 1, rbi: 1 },
    { game_id: 5001, player: { id: 1004 }, hits: 1, runs: 1, rbi: 2 },
  ];
}

function gradedRowsFromPair({ eventId, gameId, playerId, line, higherProbability, officialHhr }) {
  return pair({ eventId, gameId, playerId, line, higherProbability }).map((entry) => ({
    ...entry,
    officialHhr,
    officialHits: officialHhr,
    officialComponents: { hits: officialHhr, runs: 0, rbi: 0, officialHhr },
    outcome:
      entry.selectedSide === 'higher'
        ? officialHhr > line
          ? 'win'
          : officialHhr < line
            ? 'loss'
            : 'void'
        : officialHhr < line
          ? 'win'
          : officialHhr > line
            ? 'loss'
            : 'void',
    settlementVersion: 'observed-discrete-statistic-settlement-v1',
  }));
}

test('HHR prospective archive is immutable, authenticated, complete across baseline/alternate rows, and production-disabled', () => {
  const archive = archiveFixture();
  assert.equal(
    archive.captureKey,
    createM10HhrCaptureKey({ capturedAt: CAPTURED_AT, sourceSetSha256: SHA_A }),
  );
  assert.equal(archive.counts.rows, 8);
  assert.equal(archive.counts.alternateRows, 8);
  assert.equal(archive.safety.productionEnabled, false);
  assert.equal(archive.safety.rankingEnabled, false);
  const bytes = Buffer.from(`${JSON.stringify(archive, null, 2)}\n`, 'utf8');
  const verified = verifyM10HhrArchiveBytes({
    bytes,
    archivePath: `captures/${archive.captureKey}.json`,
    expectedCaptureKey: archive.captureKey,
  });
  assert.equal(verified.rows.length, 8);

  const tampered = JSON.parse(bytes.toString('utf8'));
  tampered.rows[0].archivedPWin = 0.62;
  assert.throws(
    () =>
      verifyM10HhrArchiveBytes({
        bytes: Buffer.from(`${JSON.stringify(tampered, null, 2)}\n`, 'utf8'),
        archivePath: `captures/${archive.captureKey}.json`,
        expectedCaptureKey: archive.captureKey,
      }),
    /SHA-256 verification failed/u,
  );
});

test('HHR archiver uses the shared adaptive limiter and real Headers resolve the provider limit', async () => {
  const limiter = createBdlAdaptiveRateLimiter({
    fallbackDelayMs: 13_000,
    utilization: 0.9,
  });
  const state = limiter.afterResponse({
    status: 200,
    headers: new Headers({
      'x-ratelimit-limit': '600',
      'x-ratelimit-remaining': '599',
      'x-ratelimit-reset': '2000000000',
    }),
  });
  assert.equal(state.source, 'x-ratelimit-limit');
  assert.equal(state.limitPerMinute, 600);
  assert.equal(state.intervalMs, 112);
  assert.equal(state.fallbackDelayMs, 13_000);
  assert.equal(state.utilization, 0.9);

  const captureScript = await readFile('scripts/archive-m10-batter-hhr-board.mjs', 'utf8');
  assert.match(captureScript, /createBdlAdaptiveRateLimiter/u);
  assert.match(captureScript, /fallbackDelayMs:\s*13_000/u);
  assert.match(captureScript, /utilization:\s*0\.9/u);
  assert.match(captureScript, /await bdlRateLimiter\.beforeRequest\(\)/u);
  assert.match(captureScript, /bdlRateLimiter\.afterResponse\(\{/u);
  assert.match(captureScript, /headers:\s*response\.headers/u);
  assert.doesNotMatch(captureScript, /fetchSnapshot\.lastBdlAt/u);
  assert.doesNotMatch(captureScript, /elapsed < 13_000/u);
  assert.match(captureScript, /BDL RATE LIMIT PER MINUTE/u);
  assert.match(captureScript, /BDL INTERVAL MS/u);
});

test('HHR zero-bookmaker events exclude and continue while duplicate Underdog bookmakers remain fatal', async () => {
  const zeroBookmaker = hhrCaptureWithBookmakers([]);
  assert.deepEqual(
    classifyHhrUnderdogBookmakerAvailability(zeroBookmaker),
    { status: 'exclude', reason: 'no-underdog-hhr-offers' },
  );

  const duplicateUnderdog = hhrCaptureWithBookmakers([
    { key: 'underdog' },
    { key: 'underdog' },
  ]);
  assert.deepEqual(
    classifyHhrUnderdogBookmakerAvailability(duplicateUnderdog),
    { status: 'normalize' },
  );

  const malformedBookmaker = hhrCaptureWithBookmakers([null]);
  assert.deepEqual(
    classifyHhrUnderdogBookmakerAvailability(malformedBookmaker),
    { status: 'normalize' },
  );

  const captureScript = await readFile('scripts/archive-m10-batter-hhr-board.mjs', 'utf8');
  const classifyIndex = captureScript.indexOf(
    'const bookmakerAvailability = classifyHhrUnderdogBookmakerAvailability(capture);',
  );
  const normalizeIndex = captureScript.indexOf(
    'const offers = normalizeUnderdogBatterHhrCapture(capture);',
  );
  assert.ok(classifyIndex >= 0 && normalizeIndex > classifyIndex);
  assert.match(
    captureScript,
    /if \(bookmakerAvailability\.status === 'exclude'\) \{[\s\S]*reason: bookmakerAvailability\.reason,[\s\S]*continue;[\s\S]*const offers = normalizeUnderdogBatterHhrCapture\(capture\);/u,
  );
  assert.match(
    captureScript,
    /throw new Error\('HHR capture contained no normalized offers\.'\);/u,
  );
});

test('HHR final grading requires exact STATUS_FINAL games and settles archived probabilities without changing them', () => {
  const archive = archiveFixture();
  const bytes = Buffer.from(`${JSON.stringify(archive, null, 2)}\n`, 'utf8');
  const verified = verifyM10HhrArchiveBytes({
    bytes,
    archivePath: `captures/${archive.captureKey}.json`,
    expectedCaptureKey: archive.captureKey,
  });
  const finalStatus = classifyHhrArchiveGameStatuses(verified, [
    { id: 5001, status: 'STATUS_FINAL' },
  ]);
  assert.equal(finalStatus.readyToGrade, true);
  assert.equal(
    classifyHhrArchiveGameStatuses(verified, [{ id: 5001, status: 'STATUS_IN_PROGRESS' }]).readyToGrade,
    false,
  );
  const report = buildM10HhrFinalGradeReport({
    archive: verified,
    statsRows: officialStats(),
    gradedAt: '2026-08-08T09:00:00.000Z',
    gameStatusEvidence: finalStatus,
  });
  assert.equal(report.rows.length, verified.rows.length);
  assert.deepEqual(
    report.rows.map((entry) => entry.archivedPWinGivenGrades),
    verified.rows.map((entry) => entry.archivedPWinGivenGrades),
  );
  assert.ok(report.rows.every((entry) => entry.officialHits === entry.officialHhr));
  assert.equal(report.safety.productionEnabled, false);
  assert.equal(report.safety.rankingEnabled, false);
});

test('HHR cumulative evidence includes the Step 3 seed, fails duplicate capture identities closed, and separates the 2.5+ line cohort', () => {
  const seedRows = [
    ...gradedRowsFromPair({ eventId: 'seed', gameId: 6001, playerId: 2001, line: 0.5, higherProbability: 0.63, officialHhr: 1 }),
    ...gradedRowsFromPair({ eventId: 'seed', gameId: 6001, playerId: 2002, line: 1.5, higherProbability: 0.44, officialHhr: 1 }),
  ];
  const step3Archive = {
    captureKey: `20260806T004000000Z--${SHA_B}`,
    rows: seedRows,
    safety: { productionEnabled: false, rankingEnabled: false },
  };
  const archive = archiveFixture();
  const bytes = Buffer.from(`${JSON.stringify(archive, null, 2)}\n`, 'utf8');
  const verified = verifyM10HhrArchiveBytes({
    bytes,
    archivePath: `captures/${archive.captureKey}.json`,
    expectedCaptureKey: archive.captureKey,
  });
  const status = classifyHhrArchiveGameStatuses(verified, [{ id: 5001, status: 'STATUS_FINAL' }]);
  const daily = buildM10HhrFinalGradeReport({
    archive: verified,
    statsRows: officialStats(),
    gradedAt: '2026-08-08T09:00:00.000Z',
    gameStatusEvidence: status,
  });
  const diagnostics = hhrCumulativeInputDiagnostics({ step3Archive, gradeReports: [daily] });
  assert.equal(diagnostics.thresholdsEvaluated, false);
  assert.deepEqual(diagnostics.lineCounts, { '0.5': 2, '1.5': 2, '2.5+': 2 });

  const cumulative = buildM10HhrCumulativeSelectedSideReport({
    step3Archive,
    gradeReports: [daily],
    generatedAt: '2026-08-08T09:05:00.000Z',
  });
  assert.equal(cumulative.selectedSide.perLine['0.5'].summary.picksGraded, 2);
  assert.equal(cumulative.selectedSide.perLine['1.5'].summary.picksGraded, 2);
  assert.equal(cumulative.selectedSide.perLine['2.5+'].summary.picksGraded, 2);
  assert.ok(
    cumulative.selectedSide.perLine['2.5+'].calibration.every(
      (bucket) => bucket.evidenceStatus === 'insufficient',
    ),
  );
  assert.equal(cumulative.safety.productionEnabled, false);
  assert.equal(cumulative.safety.rankingEnabled, false);

  assert.throws(
    () =>
      buildM10HhrCumulativeSelectedSideReport({
        step3Archive: { ...step3Archive, captureKey: daily.source.captureKey },
        gradeReports: [daily],
        generatedAt: '2026-08-08T09:05:00.000Z',
      }),
    /Duplicate cumulative capture/u,
  );
});

test('existing daily workflows carry the sibling HHR ledger, guard every piped command with pipefail, and always upload evidence', async () => {
  const captureWorkflow = await readFile('.github/workflows/m9-board-archive.yml', 'utf8');
  assert.match(captureWorkflow, /cron:\s*'15 21 \* \* \*'/u);
  assert.match(captureWorkflow, /archive-m10-batter-hhr-board\.mjs/u);
  assert.match(captureWorkflow, /artifacts\/board-archives\/batter-hhr/u);
  assert.match(captureWorkflow, /m10-hhr-board-archive-ledger-/u);
  assert.match(
    captureWorkflow,
    /set -euo pipefail[\s\S]*archive-m10-batter-hhr-board\.mjs 2>&1 \| tee/u,
  );
  assert.ok((captureWorkflow.match(/if:\s*always\(\)/gu) ?? []).length >= 4);

  const gradeWorkflow = await readFile('.github/workflows/m10-grade-pending-archives.yml', 'utf8');
  assert.match(gradeWorkflow, /cron:\s*'0 9 \* \* \*'/u);
  assert.match(gradeWorkflow, /grade-m10-hhr-pending-archives\.mjs/u);
  assert.match(gradeWorkflow, /artifacts\/board-archives\/batter-hhr/u);
  assert.match(gradeWorkflow, /m10-hhr-board-archive-ledger-/u);
  assert.match(
    gradeWorkflow,
    /set -euo pipefail[\s\S]*grade-m10-hhr-pending-archives\.mjs 2>&1 \| tee/u,
  );
  assert.ok((gradeWorkflow.match(/if:\s*always\(\)/gu) ?? []).length >= 4);
  assert.doesNotMatch(`${captureWorkflow}\n${gradeWorkflow}`, /productionEnabled:\s*true/u);
  assert.doesNotMatch(`${captureWorkflow}\n${gradeWorkflow}`, /rankingEnabled:\s*true/u);
});

test('HHR diagnostics are persisted before status and cumulative thresholds are evaluated', async () => {
  const captureScript = await readFile('scripts/archive-m10-batter-hhr-board.mjs', 'utf8');
  assert.ok(
    captureScript.indexOf('writeFile(preGateDiagnosticPath') <
      captureScript.indexOf('const archive = buildM10HhrProspectiveArchive'),
  );
  assert.ok(captureScript.indexOf('writeFile(\n  resolutionDiagnosticPath') < captureScript.indexOf('const rows = []'));

  const gradeScript = await readFile('scripts/grade-m10-hhr-pending-archives.mjs', 'utf8');
  assert.ok(gradeScript.indexOf('persistImmutableJson(statusPath') < gradeScript.indexOf('if (!statusEvidence.readyToGrade)'));
  assert.ok(
    gradeScript.indexOf('persistImmutableJson(cumulativeDiagnosticPath') <
      gradeScript.indexOf('const cumulative = buildM10HhrCumulativeSelectedSideReport'),
  );
});

test('HHR daily evidence scripts pass Node syntax checking', () => {
  for (const scriptPath of [
    'scripts/m10-hhr-evidence-utils.mjs',
    'scripts/m10-hhr-board-availability-utils.mjs',
    'scripts/archive-m10-batter-hhr-board.mjs',
    'scripts/grade-m10-hhr-pending-archives.mjs',
  ]) {
    const result = spawnSync(process.execPath, ['--check', scriptPath], { encoding: 'utf8' });
    assert.equal(result.status, 0, `${scriptPath}\n${result.stderr}`);
  }
});

test('the committed Step 3 HHR archive bytes remain unchanged by daily evidence code', async () => {
  const archivePath = 'artifacts/m11/hhr/step3/archives/20260806T004000Z--2c2e9c408a2226dfea2bcc42b009203d26bc2a307e08caed05f3b31e361aabdf.json';
  const bytes = await readFile(archivePath);
  const gitBlobSha = createHash('sha1')
    .update(Buffer.concat([Buffer.from(`blob ${bytes.length}\0`, 'utf8'), bytes]))
    .digest('hex');
  assert.equal(gitBlobSha, 'ec72f03a8036a6a01ea15526b6fc77a14588540b');
});
