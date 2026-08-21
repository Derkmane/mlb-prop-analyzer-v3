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

function underdogSnapshot() {
  return Object.freeze({
    capturedAt: CAPTURED_AT,
    rawBody: Object.freeze({ sha256: 'a'.repeat(64) }),
    parsedBody: Object.freeze({
      id: EVENT.eventId,
      bookmakers: Object.freeze([
        Object.freeze({
          key: 'underdog',
          markets: Object.freeze([
            Object.freeze({
              key: 'batter_hits',
              outcomes: Object.freeze([
                Object.freeze({
                  description: 'Regression Player',
                  name: 'Higher',
                  point: 0.5,
                }),
                Object.freeze({
                  description: 'Regression Player',
                  name: 'Lower',
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

test('missing standard-book replay keeps Underdog raw offers and does not exclude the event', async () => {
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
      if (request.url.searchParams.get('bookmakers') === 'underdog') {
        return underdogSnapshot();
      }
      throw new Error(
        `First snapshot has no hits replay entry for hits-standard:${EVENT.eventId}.`,
      );
    },
  });

  assert.equal(result.status, 'ready');
  assert.equal(result.exclusion, null);
  assert.equal(result.rawOffers.count, 2);
  assert.equal(result.baselineEvidence.baselineReason, 'STANDARD_BOOK_UNAVAILABLE');
  assert.equal(result.standardBookBaselineLinesByPlayer, undefined);
  assert.equal(providerSnapshots.length, 1);
  assert.equal(calls.length, 2);

  const standardUrl = calls[1];
  assert.equal(standardUrl.searchParams.get('regions'), 'us');
  assert.equal(standardUrl.searchParams.get('markets'), 'batter_hits');
  assert.equal(standardUrl.searchParams.has('bookmakers'), false);

  const rawOffers = funnel
    .snapshot()
    .stages.find((stage) => stage.key === 'rawOffers');
  assert.equal(rawOffers.entered, 2);
  assert.equal(rawOffers.survived, 2);
  assert.equal(rawOffers.dropped, 0);
});

test('first immutable board snapshot prefetches the exact standard-book Batter Hits request', async () => {
  const archiveRoot = await mkdtemp(
    path.join(tmpdir(), 'm9-standard-book-snapshot-'),
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

    const standardEntry = manifest.requests.find(
      (entry) => entry.requestKey === `hits-standard:${EVENT.eventId}`,
    );
    assert.ok(standardEntry);
    assert.deepEqual(standardEntry.request.query, {
      regions: 'us',
      markets: 'batter_hits',
      dateFormat: 'iso',
      oddsFormat: 'american',
    });
    assert.equal(manifest.auxiliaryFailures.length, 0);
    assert.equal(calls.length, 3);
  } finally {
    await rm(archiveRoot, { recursive: true, force: true });
  }
});

test('transport failure of the standard-book prefetch is frozen as auxiliary absence without aborting the snapshot', async () => {
  const archiveRoot = await mkdtemp(
    path.join(tmpdir(), 'm9-standard-book-absence-'),
  );
  try {
    const { scheduleUrl, scheduleBytes, scheduleResponse } = scheduleFixture();
    const { manifest } = await captureFirstBoardSnapshot({
      fetchImpl: async (input) => {
        const url = input instanceof URL ? input : new URL(String(input));
        if (url.searchParams.get('regions') === 'us') {
          throw new Error('simulated standard-book transport failure');
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
    });

    assert.equal(
      manifest.requests.some(
        (entry) => entry.requestKey === `hits:${EVENT.eventId}`,
      ),
      true,
    );
    assert.equal(
      manifest.requests.some(
        (entry) => entry.requestKey === `hhr:${EVENT.eventId}`,
      ),
      true,
    );
    assert.equal(
      manifest.requests.some(
        (entry) => entry.requestKey === `hits-standard:${EVENT.eventId}`,
      ),
      false,
    );
    assert.equal(manifest.auxiliaryFailures.length, 1);
    assert.equal(
      manifest.auxiliaryFailures[0].requestKey,
      `hits-standard:${EVENT.eventId}`,
    );
    assert.match(
      manifest.auxiliaryFailures[0].reason,
      /simulated standard-book transport failure/u,
    );
  } finally {
    await rm(archiveRoot, { recursive: true, force: true });
  }
});
