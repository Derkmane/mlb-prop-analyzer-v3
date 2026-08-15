import assert from 'node:assert/strict';
import test from 'node:test';

import {
  fetchMlbStatsProjectedLineup,
  MLB_STATS_PROJECTED_LINEUP_SOURCE_VERSION,
} from '../src/adapters/index.js';

const scheduleFixture = {
  dates: [
    {
      games: [
        {
          gamePk: 822941,
          gameDate: '2026-08-15T22:10:00Z',
          teams: {
            away: { team: { name: 'Baltimore Orioles' } },
            home: { team: { name: 'Tampa Bay Rays' } },
          },
          lineups: {
            awayPlayers: [
              { id: 101, fullName: 'Away One' },
              { id: 102, fullName: 'Away Two' },
            ],
            homePlayers: [
              { id: 201, fullName: 'Home One' },
              { id: 202, fullName: 'Home Two' },
              { id: 203, fullName: 'Home Three' },
            ],
          },
        },
      ],
    },
  ],
};

function jsonResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  });
}

test('fetches schedule lineup hydration and preserves array order as batting slots', async () => {
  let requestedUrl = '';
  const result = await fetchMlbStatsProjectedLineup({
    gameDateUtc: '2026-08-15T22:10:00.000Z',
    homeTeamName: 'Tampa Bay Rays',
    awayTeamName: 'Baltimore Orioles',
    maximumStartDifferenceMilliseconds: 60_000,
    now: () => new Date('2026-08-15T18:00:00.000Z'),
    fetchImpl: async (input) => {
      requestedUrl = String(input);
      return jsonResponse(scheduleFixture);
    },
  });

  assert.equal(result.status, 'available');
  if (result.status !== 'available') return;
  assert.equal(result.sourceVersion, MLB_STATS_PROJECTED_LINEUP_SOURCE_VERSION);
  assert.equal(result.providerGamePk, 822941);
  assert.deepEqual(
    result.players.map((player) => [player.playerName, player.teamName, player.lineupSlot]),
    [
      ['Away One', 'Baltimore Orioles', 1],
      ['Away Two', 'Baltimore Orioles', 2],
      ['Home One', 'Tampa Bay Rays', 1],
      ['Home Two', 'Tampa Bay Rays', 2],
      ['Home Three', 'Tampa Bay Rays', 3],
    ],
  );
  const url = new URL(requestedUrl);
  assert.equal(url.origin, 'https://statsapi.mlb.com');
  assert.equal(url.pathname, '/api/v1/schedule');
  assert.equal(url.searchParams.get('sportId'), '1');
  assert.equal(url.searchParams.get('date'), '2026-08-15');
  assert.equal(url.searchParams.get('hydrate'), 'lineups');
});

test('returns unavailable when the matched game has no lineup hydration yet', async () => {
  const body = structuredClone(scheduleFixture);
  delete (body.dates[0].games[0] as { lineups?: unknown }).lineups;
  const result = await fetchMlbStatsProjectedLineup({
    gameDateUtc: '2026-08-15T22:10:00.000Z',
    homeTeamName: 'Tampa Bay Rays',
    awayTeamName: 'Baltimore Orioles',
    maximumStartDifferenceMilliseconds: 60_000,
    now: () => new Date('2026-08-15T18:00:00.000Z'),
    fetchImpl: async () => jsonResponse(body),
  });
  assert.equal(result.status, 'unavailable');
});

test('returns no-match rather than selecting the wrong game', async () => {
  const result = await fetchMlbStatsProjectedLineup({
    gameDateUtc: '2026-08-15T22:10:00.000Z',
    homeTeamName: 'New York Yankees',
    awayTeamName: 'Boston Red Sox',
    maximumStartDifferenceMilliseconds: 60_000,
    now: () => new Date('2026-08-15T18:00:00.000Z'),
    fetchImpl: async () => jsonResponse(scheduleFixture),
  });
  assert.equal(result.status, 'no-match');
});

test('fails closed when two distinct gamePk values match the same teams and tolerance', async () => {
  const body = structuredClone(scheduleFixture);
  body.dates[0].games.push({
    ...structuredClone(body.dates[0].games[0]),
    gamePk: 822942,
    gameDate: '2026-08-15T22:10:30Z',
  });
  await assert.rejects(
    fetchMlbStatsProjectedLineup({
      gameDateUtc: '2026-08-15T22:10:00.000Z',
      homeTeamName: 'Tampa Bay Rays',
      awayTeamName: 'Baltimore Orioles',
      maximumStartDifferenceMilliseconds: 60_000,
      now: () => new Date('2026-08-15T18:00:00.000Z'),
      fetchImpl: async () => jsonResponse(body),
    }),
    /ambiguous across gamePk/u,
  );
});
