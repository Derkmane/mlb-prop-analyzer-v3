import assert from 'node:assert/strict';
import { once } from 'node:events';
import type { AddressInfo } from 'node:net';
import test from 'node:test';

import type {
  HhrDisplayArchive,
  HhrDisplayArchiveRepository,
} from '../src/application/index.js';
import {
  createHhrDisplayBoardServer,
  resolveHhrDisplayServerPort,
} from '../src/composition/index.js';

function fixtureArchive(): HhrDisplayArchive {
  return Object.freeze({
    captureKey: '20260811T170000000Z--aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
    capturedAt: '2026-08-11T17:00:00.000Z',
    modelVersion: 'hhr-model-v1',
    distributionBuilderVersion: 'hhr-distribution-v1',
    rows: Object.freeze([
      Object.freeze({
        rank: 1,
        providerEventId: 'event-1',
        providerGameId: 101,
        providerPlayerId: 202,
        providerTeamId: 303,
        playerName: 'Test Batter',
        teamName: 'Home Club',
        homeTeamName: 'Home Club',
        awayTeamName: 'Away Club',
        eventCommenceTime: '2026-08-12T00:10:00.000Z',
        baseMarketKey: 'batter_hits_runs_rbis',
        providerMarketKey: 'batter_hits_runs_rbis_alternate',
        marketLabel: 'Batter Hits + Runs + RBIs',
        offerType: 'alternate',
        settlementStatistic: 'hits+runs+rbi',
        selectedSide: 'lower',
        postedLine: 2.5,
        americanPrice: -125,
        multiplier: 0.85,
        pWin: 0.716,
        pLoss: 0.264,
        pVoid: 0.02,
        pWinGivenGrades: 0.7306122448979592,
        lineupStatus: 'projected',
      }),
    ]),
    enrichmentByGamePlayerKey: Object.freeze({
      '101:202': Object.freeze({
        providerGameId: 101,
        providerPlayerId: 202,
        lastFiveGames: Object.freeze({
          count: 1,
          games: Object.freeze([
            Object.freeze({
              gameDate: '2026-08-10',
              opponentTeamName: 'Previous Opponent',
              opponentAbbreviation: 'PRE',
              homeOrAway: 'away',
              hits: 1,
              runs: 1,
              rbi: 0,
              hrr: 2,
              atBats: 4,
              plateAppearances: 4,
              totalBases: 1,
            }),
          ]),
          failureReason: null,
        }),
        opposingStarter: Object.freeze({
          name: 'Test Starter',
          throwingHand: 'R',
          era: 3.21,
          last10: Object.freeze({
            starts: 10,
            inningsPitched: '61.1',
            earnedRuns: 22,
            strikeouts: 67,
            whip: 1.14,
          }),
          season: Object.freeze({
            inningsPitched: 132.2,
            earnedRuns: 49,
            strikeouts: 141,
            whip: 1.19,
          }),
        }),
      }),
    }),
  });
}

async function withServer(
  repository: HhrDisplayArchiveRepository,
  check: (origin: string) => Promise<void>,
): Promise<void> {
  const server = createHhrDisplayBoardServer(repository);
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const address = server.address();
  assert.ok(address !== null && typeof address === 'object');
  const origin = `http://127.0.0.1:${(address as AddressInfo).port}`;
  try {
    await check(origin);
  } finally {
    server.close();
    await once(server, 'close');
  }
}

test('GET /api/hhr-display-board returns exact persisted display evidence without caching', async () => {
  let reads = 0;
  const repository: HhrDisplayArchiveRepository = Object.freeze({
    async readLatest() {
      reads += 1;
      return fixtureArchive();
    },
  });

  await withServer(repository, async (origin) => {
    const response = await fetch(`${origin}/api/hhr-display-board`);
    assert.equal(response.status, 200);
    assert.equal(response.headers.get('cache-control'), 'no-store');
    assert.equal(response.headers.get('content-type'), 'application/json; charset=utf-8');
    const body = await response.json() as Record<string, unknown>;
    assert.equal(body['captureKey'], fixtureArchive().captureKey);
    assert.equal(body['capturedAt'], fixtureArchive().capturedAt);
    const picks = body['hhr25LowerAlternates'] as Array<Record<string, unknown>>;
    assert.equal(picks.length, 1);
    assert.equal(picks[0]?.['player'], 'Test Batter');
    assert.equal(picks[0]?.['postedLine'], 2.5);
    assert.equal(picks[0]?.['selectedSide'], 'lower');
    assert.equal(picks[0]?.['pWinGivenGrades'], 0.7306122448979592);
    assert.equal(picks[0]?.['pVoid'], 0.02);
    assert.equal(picks[0]?.['multiplier'], 0.85);
    assert.equal(picks[0]?.['lineupStatus'], 'projected');
  });
  assert.equal(reads, 1);
});

test('unsupported paths and methods fail without reading the archive', async () => {
  let reads = 0;
  const repository: HhrDisplayArchiveRepository = Object.freeze({
    async readLatest() {
      reads += 1;
      return fixtureArchive();
    },
  });

  await withServer(repository, async (origin) => {
    const missing = await fetch(`${origin}/not-the-board`);
    assert.equal(missing.status, 404);
    const wrongMethod = await fetch(`${origin}/api/hhr-display-board`, { method: 'POST' });
    assert.equal(wrongMethod.status, 405);
    assert.equal(wrongMethod.headers.get('allow'), 'GET');
  });
  assert.equal(reads, 0);
});

test('archive failure returns a generic fail-closed response with no fallback or detail leak', async () => {
  const repository: HhrDisplayArchiveRepository = Object.freeze({
    async readLatest() {
      throw new Error('sensitive archive failure detail');
    },
  });

  await withServer(repository, async (origin) => {
    const response = await fetch(`${origin}/api/hhr-display-board`);
    assert.equal(response.status, 500);
    assert.equal(response.headers.get('cache-control'), 'no-store');
    const body = await response.text();
    assert.equal(body, '{"error":"hhr-display-board-unavailable"}');
    assert.equal(body.includes('sensitive'), false);
  });
});

test('server port resolution fails closed on malformed or out-of-range values', () => {
  assert.equal(resolveHhrDisplayServerPort(undefined), 3000);
  assert.equal(resolveHhrDisplayServerPort('8080'), 8080);
  assert.throws(() => resolveHhrDisplayServerPort('abc'));
  assert.throws(() => resolveHhrDisplayServerPort('0'));
  assert.throws(() => resolveHhrDisplayServerPort('65536'));
});
