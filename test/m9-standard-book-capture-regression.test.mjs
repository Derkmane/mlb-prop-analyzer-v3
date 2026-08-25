import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { captureM9BatterHitsEventOdds } from '../scripts/archive-m9-batter-hits-board.mjs';
import { createM9ArchiveFunnel } from '../scripts/m9-board-archive-funnel-utils.mjs';
import { captureFirstBoardSnapshot } from '../scripts/m9-board-snapshot-preload.mjs';

const CAPTURED_AT = '2026-08-21T18:30:00.000Z';
const EVENT = Object.freeze({
  eventId: 'event-regression-1',
  commenceTimeUtc: '2026-08-21T20:11:00.000Z',
  homeTeamName: 'Home Team',
  awayTeamName: 'Away Team',
});

function sourceSnapshot(source) {
  const isPick6 = source === 'pick6';
  return Object.freeze({
    capturedAt: CAPTURED_AT,
    rawBody: Object.freeze({
      sha256: (isPick6 ? 'a' : 'b').repeat(64),
    }),
    parsedBody: Object.freeze({
      id: EVENT.eventId,
      commence_time: EVENT.commenceTimeUtc,
      home_team: EVENT.homeTeamName,
      away_team: EVENT.awayTeamName,
      bookmakers: isPick6
        ? Object.freeze([])
        : Object.freeze([
            Object.freeze({
              key: 'draftkings',
              markets: Object.freeze([
                Object.freeze({
                  key: 'batter_hits',
                  outcomes: Object.freeze([
                    Object.freeze({
                      description: 'Regression Player',
                      name: 'Over',
                      point: 0.5,
                    }),
                    Object.freeze({
                      description: 'Regression Player',
                      name: 'Under',
                      point: 0.5,
                    }),
                  ]),
                }),
              ]),
            }),
          ]),
    }),
  });
}

function response(body = { ok: true }) {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  });
}

function scheduleFixture() {
  const scheduleUrl = new URL(
    'https://api.the-odds-api.com/v4/sports/baseball_mlb/events',
  );
  scheduleUrl.searchParams.set('apiKey', 'snapshot-secret');
  scheduleUrl.searchParams.set('dateFormat', 'iso');
  const scheduleBytes = Buffer.from('[]', 'utf8');
  const scheduleResponse = new Response(scheduleBytes, {
    status: 200,
    headers: { 'content-type': 'application/json' },
  });
  return { scheduleUrl, scheduleBytes, scheduleResponse };
}

test('active Hits capture preserves Pick6 absence and DraftKings offers without fallback', async () => {
  const providerSnapshots = [];
  const funnel = createM9ArchiveFunnel({
    captureTimestamp: CAPTURED_AT,
    dryRun: false,
  });
  const calls = [];
  const result = await captureM9BatterHitsEventOdds({
    eventId: EVENT.eventId,
    oddsApiKey: 'test-secret',
    providerSnapshots,
    funnel,
    fetchOdds: async (request) => {
      calls.push(request.url);
      const bookmaker = request.url.searchParams.get('bookmakers');
      if (bookmaker === 'pick6') return sourceSnapshot('pick6');
      if (bookmaker === 'draftkings') return sourceSnapshot('draftkings');
      throw new Error(`unexpected bookmaker ${String(bookmaker)}`);
    },
  });

  assert.equal(result.status, 'ready');
  assert.equal(result.exclusion, null);
  assert.equal(result.rawOffers.count, 2);
  assert.equal(result.sources.length, 2);
  assert.deepEqual(
    result.sources.map((entry) => [entry.boardSource, entry.rawOffers.count]),
    [
      ['pick6', 0],
      ['draftkings', 2],
    ],
  );
  assert.equal(providerSnapshots.length, 2);
  assert.equal(calls.length, 2);

  const pick6Url = calls.find(
    (url) => url.searchParams.get('bookmakers') === 'pick6',
  );
  const draftkingsUrl = calls.find(
    (url) => url.searchParams.get('bookmakers') === 'draftkings',
  );
  assert.ok(pick6Url);
  assert.ok(draftkingsUrl);
  assert.equal(pick6Url.searchParams.get('regions'), 'us_dfs');
  assert.equal(draftkingsUrl.searchParams.get('regions'), 'us');
  for (const url of calls) {
    assert.equal(
      url.searchParams.get('markets'),
      'batter_hits,batter_hits_alternate',
    );
    assert.equal(url.searchParams.get('includeMultipliers'), 'true');
    assert.equal(url.searchParams.get('includeSids'), 'true');
    assert.notEqual(url.searchParams.get('bookmakers'), 'underdog');
  }

  const rawOffers = funnel
    .snapshot()
    .stages.find((stage) => stage.key === 'rawOffers');
  assert.equal(rawOffers.entered, 2);
  assert.equal(rawOffers.survived, 2);
  assert.equal(rawOffers.dropped, 0);
});

test('first immutable board snapshot prefetches exact Pick6 and DraftKings Hits and HHR requests', async () => {
  const archiveRoot = await mkdtemp(
    path.join(tmpdir(), 'm9-active-source-snapshot-'),
  );
  try {
    const { scheduleUrl, scheduleBytes, scheduleResponse } = scheduleFixture();
    const calls = [];
    const { manifest } = await captureFirstBoardSnapshot({
      fetchImpl: async (input) => {
        const url = input instanceof URL ? input : new URL(String(input));
        calls.push(url);
        return response();
      },
      archiveRoot,
      runStartedAt: '2026-08-21T18:29:50.000Z',
      snapshotStartedAt: '2026-08-21T18:29:55.000Z',
      scheduleUrl,
      scheduleResponse,
      scheduleBytes,
      scheduleCapturedAt: '2026-08-21T18:29:56.000Z',
      events: [EVENT],
      claimedGames: [EVENT],
      now: () => CAPTURED_AT,
    });

    assert.deepEqual(
      manifest.requests.map((entry) => entry.requestKey).sort(),
      [
        'events',
        `hits:pick6:${EVENT.eventId}`,
        `hits:draftkings:${EVENT.eventId}`,
        `hhr:pick6:${EVENT.eventId}`,
        `hhr:draftkings:${EVENT.eventId}`,
      ].sort(),
    );
    assert.equal(manifest.auxiliaryFailures.length, 0);
    assert.equal(calls.length, 4);

    const expected = new Map([
      ['hits:pick6', { regions: 'us_dfs', bookmakers: 'pick6', markets: 'batter_hits,batter_hits_alternate' }],
      ['hits:draftkings', { regions: 'us', bookmakers: 'draftkings', markets: 'batter_hits,batter_hits_alternate' }],
      ['hhr:pick6', { regions: 'us_dfs', bookmakers: 'pick6', markets: 'batter_hits_runs_rbis,batter_hits_runs_rbis_alternate' }],
      ['hhr:draftkings', { regions: 'us', bookmakers: 'draftkings', markets: 'batter_hits_runs_rbis,batter_hits_runs_rbis_alternate' }],
    ]);
    for (const [key, contract] of expected) {
      const [consumer, source] = key.split(':');
      const entry = manifest.requests.find(
        (row) => row.requestKey === `${consumer}:${source}:${EVENT.eventId}`,
      );
      assert.ok(entry);
      assert.equal(entry.request.query.regions, contract.regions);
      assert.equal(entry.request.query.bookmakers, contract.bookmakers);
      assert.equal(entry.request.query.markets, contract.markets);
      assert.equal(entry.request.query.includeMultipliers, 'true');
      assert.equal(entry.request.query.includeSids, 'true');
    }
  } finally {
    await rm(archiveRoot, { recursive: true, force: true });
  }
});

test('active source transport failure aborts the first snapshot instead of substituting another source', async () => {
  const archiveRoot = await mkdtemp(
    path.join(tmpdir(), 'm9-active-source-failure-'),
  );
  try {
    const { scheduleUrl, scheduleBytes, scheduleResponse } = scheduleFixture();
    await assert.rejects(
      captureFirstBoardSnapshot({
        fetchImpl: async (input) => {
          const url = input instanceof URL ? input : new URL(String(input));
          if (url.searchParams.get('bookmakers') === 'pick6') {
            throw new Error('simulated Pick6 transport failure');
          }
          return response();
        },
        archiveRoot,
        runStartedAt: '2026-08-21T18:29:50.000Z',
        snapshotStartedAt: '2026-08-21T18:29:55.000Z',
        scheduleUrl,
        scheduleResponse,
        scheduleBytes,
        scheduleCapturedAt: '2026-08-21T18:29:56.000Z',
        events: [EVENT],
        claimedGames: [EVENT],
        now: () => CAPTURED_AT,
      }),
      /simulated Pick6 transport failure/u,
    );
  } finally {
    await rm(archiveRoot, { recursive: true, force: true });
  }
});
