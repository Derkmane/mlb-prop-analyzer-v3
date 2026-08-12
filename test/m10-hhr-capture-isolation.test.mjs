import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import {
  buildM10HhrProspectiveArchive,
  M10_HHR_GRADE_VERSION,
} from '../scripts/m10-hhr-evidence-utils.mjs';

function row({ eventId, gameId, playerId, side, probability }) {
  return Object.freeze({
    providerEventId: eventId,
    providerGameId: gameId,
    providerPlayerId: playerId,
    providerMarketKey: 'batter_hits_runs_rbis_alternate',
    offerType: 'alternate',
    playerName: `Player ${playerId}`,
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

test('blocked HHR capture writes no grade or cumulative evidence, later captures continue, and the run exits non-zero', async () => {
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
      `const statsByGame = new Map([\n` +
        `  [7001, [{ game_id: 7001, player: { id: 1101 }, hits: 1, runs: 0, rbi: 0 }]],\n` +
        `  [7002, [{ game_id: 7002, player: { id: 1201 }, hits: 1, runs: 1, rbi: 0 }]],\n` +
        `]);\n` +
        `globalThis.fetch = async (input) => {\n` +
        `  const url = input instanceof URL ? input : new URL(typeof input === 'string' ? input : input.url);\n` +
        `  const gameMatch = /^\\/mlb\\/v1\\/games\\/(\\d+)$/u.exec(url.pathname);\n` +
        `  if (gameMatch) {\n` +
        `    const gameId = Number(gameMatch[1]);\n` +
        `    return new Response(JSON.stringify({ data: { id: gameId, status: 'STATUS_FINAL' } }), { status: 200 });\n` +
        `  }\n` +
        `  if (url.pathname === '/mlb/v1/stats') {\n` +
        `    const gameId = Number(url.searchParams.get('game_ids[]'));\n` +
        `    return new Response(JSON.stringify({ data: statsByGame.get(gameId) ?? [] }), { status: 200 });\n` +
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
      /BLOCKED\t[^\n]+\t7001:1102\tMissing official HHR stats for 7001:1102\./u,
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
    assert.equal(blockedStatus.error, 'Missing official HHR stats for 7001:1102.');
    assert.equal(blockedStatus.gradeReportWritten, false);
    assert.equal(blockedStatus.cumulativeEvidenceIncluded, false);

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
