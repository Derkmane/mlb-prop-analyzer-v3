import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { captureFirstBoardSnapshot } from '../scripts/m9-board-snapshot-preload.mjs';

const SOURCE_CONTRACTS = Object.freeze([
  Object.freeze({ boardSource: 'pick6', bookmaker: 'pick6', region: 'us_dfs' }),
  Object.freeze({ boardSource: 'draftkings', bookmaker: 'draftkings', region: 'us' }),
]);
const MARKET_CONTRACTS = Object.freeze([
  Object.freeze({
    consumer: 'hits',
    markets: 'batter_hits,batter_hits_alternate',
  }),
  Object.freeze({
    consumer: 'hhr',
    markets: 'batter_hits_runs_rbis,batter_hits_runs_rbis_alternate',
  }),
  Object.freeze({
    consumer: 'total-bases',
    markets: 'batter_total_bases,batter_total_bases_alternate',
  }),
]);

test('first immutable snapshot captures all six canonical ladder markets from Pick6 and DraftKings', async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'm9-complete-ladders-'));
  t.after(() => rm(root, { recursive: true, force: true }));

  const event = Object.freeze({
    eventId: 'event-complete-ladders',
    commenceTimeUtc: '2026-08-25T23:00:00.000Z',
    homeTeamName: 'Home Club',
    awayTeamName: 'Away Club',
  });
  const scheduleBytes = Buffer.from(JSON.stringify([{
    id: event.eventId,
    commence_time: event.commenceTimeUtc,
    home_team: event.homeTeamName,
    away_team: event.awayTeamName,
  }]));
  const scheduleUrl = new URL(
    'https://api.the-odds-api.com/v4/sports/baseball_mlb/events?apiKey=secret&dateFormat=iso',
  );
  const requestedUrls = [];
  const fakeFetch = async (input) => {
    const url = new URL(input);
    requestedUrls.push(url);
    return new Response('{"bookmakers":[]}', {
      status: 200,
      headers: { 'content-type': 'application/json' },
    });
  };
  let tick = 0;
  const now = () => {
    tick += 1;
    return new Date(Date.parse('2026-08-25T20:00:00.000Z') + tick * 1000).toISOString();
  };

  const snapshot = await captureFirstBoardSnapshot({
    fetchImpl: fakeFetch,
    archiveRoot: root,
    runStartedAt: '2026-08-25T20:00:00.000Z',
    snapshotStartedAt: '2026-08-25T20:00:00.000Z',
    scheduleUrl,
    scheduleResponse: new Response(scheduleBytes, {
      status: 200,
      headers: { 'content-type': 'application/json' },
    }),
    scheduleBytes,
    scheduleCapturedAt: '2026-08-25T20:00:00.500Z',
    events: [event],
    claimedGames: [{
      ...event,
      gameIdentity: `${event.eventId}@${event.commenceTimeUtc}`,
      classification: 'NORMAL',
    }],
    now,
  });

  assert.equal(snapshot.manifest.contract, 'm9-first-board-snapshot-v4');
  assert.equal(snapshot.manifest.version, 3);
  assert.equal(snapshot.manifest.requests.length, 7);
  assert.equal(requestedUrls.length, 6);

  const expectedKeys = ['events'];
  for (const market of MARKET_CONTRACTS) {
    for (const source of SOURCE_CONTRACTS) {
      expectedKeys.push(`${market.consumer}:${source.boardSource}:${event.eventId}`);
    }
  }
  assert.deepEqual(
    snapshot.manifest.requests.map((entry) => entry.requestKey).sort(),
    expectedKeys.sort(),
  );

  for (const market of MARKET_CONTRACTS) {
    for (const source of SOURCE_CONTRACTS) {
      const requestKey = `${market.consumer}:${source.boardSource}:${event.eventId}`;
      const entry = snapshot.manifest.requests.find((row) => row.requestKey === requestKey);
      assert.ok(entry, `missing ${requestKey}`);
      assert.equal(entry.consumer, market.consumer);
      assert.deepEqual(entry.request.query, {
        regions: source.region,
        bookmakers: source.bookmaker,
        markets: market.markets,
        dateFormat: 'iso',
        oddsFormat: 'american',
        includeMultipliers: 'true',
        includeSids: 'true',
      });
    }
  }

  assert.equal(
    snapshot.manifest.requests.some((entry) => entry.request.query?.bookmakers === 'underdog'),
    false,
  );
});
