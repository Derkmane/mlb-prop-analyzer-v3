import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import {
  captureFirstBoardSnapshot,
  CLAIMED_EVENT_IDS_ENV,
  publishClaimedEventScope,
} from '../scripts/m9-board-snapshot-preload.mjs';
import {
  decideBoardRun,
  decideClaimedGameCoverage,
} from '../scripts/m9-capture-controller.mjs';
import {
  selectM9PregameEventsForCapture,
} from '../scripts/m9-board-archive-funnel-utils.mjs';

const RUN = '2026-08-17T16:00:00.000Z';

function normalizedEvent(eventId, minutes) {
  return Object.freeze({
    eventId,
    commenceTimeUtc: new Date(
      Date.parse(RUN) + minutes * 60_000,
    ).toISOString(),
    homeTeamName: `Home ${eventId}`,
    awayTeamName: `Away ${eventId}`,
  });
}

function rawEvent(event) {
  return Object.freeze({
    id: event.eventId,
    sport_key: 'baseball_mlb',
    commence_time: event.commenceTimeUtc,
    home_team: event.homeTeamName,
    away_team: event.awayTeamName,
  });
}

function claimed(event, classification = 'NORMAL') {
  return Object.freeze({
    ...event,
    gameIdentity: `${event.eventId}@${event.commenceTimeUtc}`,
    minutesToFirstPitch:
      (Date.parse(event.commenceTimeUtc) - Date.parse(RUN)) / 60_000,
    classification,
  });
}

test('first snapshot and Hits event selection are restricted to controller-claimed games', async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'm9-claimed-scope-'));
  t.after(() => rm(root, { recursive: true, force: true }));

  const gameA = normalizedEvent('game-a', 80);
  const gameB = normalizedEvent('game-b', 180);
  const gameC = normalizedEvent('game-c', 300);
  const events = [gameA, gameB, gameC];
  const scheduleBytes = Buffer.from(JSON.stringify(events.map(rawEvent)), 'utf8');
  const requestedUrls = [];
  const fakeFetch = async (input) => {
    const url = new URL(input);
    const match = url.pathname.match(/\/events\/([^/]+)\/odds$/u);
    assert.ok(match, `unexpected snapshot fetch ${url}`);
    requestedUrls.push(url);
    return new Response(JSON.stringify({ id: match[1], bookmakers: [] }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    });
  };
  const stamps = [
    '2026-08-17T16:00:01.000Z',
    '2026-08-17T16:00:02.000Z',
    '2026-08-17T16:00:03.000Z',
    '2026-08-17T16:00:04.000Z',
    '2026-08-17T16:00:05.000Z',
  ];
  const snapshot = await captureFirstBoardSnapshot({
    fetchImpl: fakeFetch,
    archiveRoot: root,
    runStartedAt: RUN,
    snapshotStartedAt: RUN,
    scheduleUrl: new URL(
      'https://api.the-odds-api.com/v4/sports/baseball_mlb/events?apiKey=redacted&dateFormat=iso',
    ),
    scheduleResponse: new Response(scheduleBytes, {
      status: 200,
      headers: { 'content-type': 'application/json' },
    }),
    scheduleBytes,
    scheduleCapturedAt: RUN,
    events,
    claimedGames: [claimed(gameA)],
    now: () => stamps.shift() ?? '2026-08-17T16:00:05.000Z',
  });

  assert.deepEqual(
    requestedUrls.map((url) => url.pathname.match(/\/events\/([^/]+)\/odds$/u)[1]),
    ['game-a', 'game-a', 'game-a', 'game-a', 'game-a', 'game-a'],
  );
  assert.deepEqual(
    requestedUrls.map((url) => [
      url.searchParams.get('bookmakers'),
      url.searchParams.get('regions'),
      url.searchParams.get('markets'),
    ]),
    [
      ['pick6', 'us_dfs', 'batter_hits,batter_hits_alternate'],
      ['draftkings', 'us', 'batter_hits,batter_hits_alternate'],
      ['pick6', 'us_dfs', 'batter_hits_runs_rbis,batter_hits_runs_rbis_alternate'],
      ['draftkings', 'us', 'batter_hits_runs_rbis,batter_hits_runs_rbis_alternate'],
      ['pick6', 'us_dfs', 'batter_total_bases,batter_total_bases_alternate'],
      ['draftkings', 'us', 'batter_total_bases,batter_total_bases_alternate'],
    ],
  );
  assert.ok(
    requestedUrls.every((url) => url.searchParams.get('bookmakers') !== 'underdog'),
  );
  assert.deepEqual(
    snapshot.manifest.requests.map((entry) => entry.requestKey),
    [
      'events',
      'hits:pick6:game-a',
      'hits:draftkings:game-a',
      'hhr:pick6:game-a',
      'hhr:draftkings:game-a',
      'total-bases:pick6:game-a',
      'total-bases:draftkings:game-a',
    ],
  );
  assert.deepEqual(
    snapshot.manifest.pregameEvents.map((event) => event.eventId),
    ['game-a'],
  );
  assert.deepEqual(
    snapshot.manifest.claimedGames.map((event) => event.eventId),
    ['game-a'],
  );

  const previous = process.env[CLAIMED_EVENT_IDS_ENV];
  t.after(() => {
    if (previous === undefined) delete process.env[CLAIMED_EVENT_IDS_ENV];
    else process.env[CLAIMED_EVENT_IDS_ENV] = previous;
  });
  publishClaimedEventScope(snapshot.manifest);
  const selection = selectM9PregameEventsForCapture({
    rawEvents: events.map(rawEvent),
    capturedAt: snapshot.manifest.boardSnapshotCompletedAt,
  });
  assert.deepEqual(selection.events.map((event) => event.eventId), ['game-a']);
  assert.deepEqual(
    selection.drops
      .filter((drop) => drop.reason === 'outside controller claim')
      .map((drop) => drop.eventId)
      .sort(),
    ['game-b', 'game-c'],
  );
});

test('coverage is per game and a game with unresolved evidence is claimed again', () => {
  const gameA = claimed(normalizedEvent('game-a', 80));
  const gameB = claimed(normalizedEvent('game-b', 100));
  const hitsArchive = {
    pregameEvents: [
      { eventId: gameA.eventId },
      { eventId: gameB.eventId },
    ],
    rankedRows: [
      { normalizedOffer: { providerEventId: gameA.eventId } },
      { normalizedOffer: { providerEventId: gameB.eventId } },
    ],
    exclusions: [
      {
        providerEventId: gameB.eventId,
        reason: 'no-current-or-projected-lineup-slot',
      },
    ],
  };
  const hhrArchive = {
    games: [
      { providerEventId: gameA.eventId, gameId: 7001 },
      { providerEventId: gameB.eventId, gameId: 7002 },
    ],
    rows: [
      { providerEventId: gameA.eventId, providerGameId: 7001 },
      { providerEventId: gameB.eventId, providerGameId: 7002 },
    ],
    exclusions: [
      {
        gameId: 7002,
        reason: 'missing-starter-or-handedness-conditioning-input',
      },
    ],
  };

  const coverage = decideClaimedGameCoverage({
    claimedGames: [gameA, gameB],
    hitsArchive,
    hhrArchive,
  });
  assert.deepEqual(coverage.coveredEventIds, ['game-a']);
  assert.equal(coverage.deferredGames.length, 1);
  assert.equal(coverage.deferredGames[0].eventId, 'game-b');
  assert.ok(
    coverage.deferredGames[0].reasons.includes('hits-has-unresolved-exclusion'),
  );
  assert.ok(
    coverage.deferredGames[0].reasons.includes('hhr-has-unresolved-exclusion'),
  );

  const nextRun = new Date(Date.parse(RUN) + 30 * 60_000).toISOString();
  const rerun = decideBoardRun({
    events: [
      normalizedEvent('game-a', 80),
      normalizedEvent('game-b', 100),
    ],
    coveredGameIdentities: [gameA.gameIdentity],
    runStartedAt: nextRun,
  });
  assert.equal(rerun.decision, 'CAPTURE');
  assert.deepEqual(
    rerun.claimedGames.map((game) => game.eventId),
    ['game-b'],
  );
  assert.equal(rerun.claimedGames[0].classification, 'NORMAL');
});
