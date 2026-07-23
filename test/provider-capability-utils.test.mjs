import assert from 'node:assert/strict';
import test from 'node:test';

import {
  activeUtcSeason,
  extractBookmakerMarketKeys,
  observedTargetMarkets,
  parseNonNegativeInteger,
  parseOptionalPositiveInteger,
  previousUtcDate,
  selectPregameEvents,
  summarizeBdlGames,
} from '../scripts/provider-capability-utils.mjs';

test('selectPregameEvents keeps valid future events and sorts by commence time', () => {
  const events = [
    { id: 'later', commence_time: '2026-07-23T18:00:00Z' },
    { id: 'started', commence_time: '2026-07-23T13:00:00Z' },
    { id: 'earlier', commence_time: '2026-07-23T16:00:00Z' },
    { id: '', commence_time: '2026-07-23T17:00:00Z' },
    { id: 'invalid', commence_time: 'not-a-date' },
  ];

  assert.deepEqual(
    selectPregameEvents(events, '2026-07-23T14:40:00Z').map(
      (event) => event.id,
    ),
    ['earlier', 'later'],
  );
});

test('extractBookmakerMarketKeys reads only the requested bookmaker', () => {
  const body = {
    bookmakers: [
      {
        key: 'fanduel',
        markets: [{ key: 'batter_hits' }],
      },
      {
        key: 'underdog',
        markets: [
          { key: 'batter_hits_alternate' },
          { key: 'batter_hits' },
          { key: 'batter_hits' },
          { other: 'ignored' },
        ],
      },
    ],
  };

  assert.deepEqual(extractBookmakerMarketKeys(body, 'underdog'), [
    'batter_hits',
    'batter_hits_alternate',
  ]);
  assert.deepEqual(observedTargetMarkets(['batter_hits_alternate']), [
    'batter_hits_alternate',
  ]);
});

test('summarizeBdlGames preserves raw status and identity fields without inference', () => {
  const body = {
    data: [
      {
        id: 123,
        status: 'Final',
        date: '2026-07-22',
        datetime: '2026-07-22T23:10:00Z',
        home_team_name: 'Home Club',
        away_team_name: 'Away Club',
      },
      {
        id: 'not-an-integer',
        status: null,
      },
    ],
  };

  assert.deepEqual(summarizeBdlGames(body), [
    {
      id: 123,
      status: 'Final',
      date: '2026-07-22',
      datetime: '2026-07-22T23:10:00Z',
      homeTeamName: 'Home Club',
      awayTeamName: 'Away Club',
    },
    {
      id: null,
      status: null,
      date: null,
      datetime: null,
      homeTeamName: null,
      awayTeamName: null,
    },
  ]);
});

test('date and integer helpers are deterministic and reject malformed values', () => {
  assert.equal(previousUtcDate('2026-01-01T00:00:00Z'), '2025-12-31');
  assert.equal(activeUtcSeason('2026-07-23T14:40:00Z'), 2026);
  assert.equal(parseOptionalPositiveInteger('208', 'BDL_PLAYER_ID'), 208);
  assert.equal(parseOptionalPositiveInteger('', 'BDL_GAME_ID'), null);
  assert.equal(parseNonNegativeInteger(undefined, 'DELAY', 13_000), 13_000);
  assert.equal(parseNonNegativeInteger('0', 'DELAY', 13_000), 0);

  assert.throws(
    () => parseOptionalPositiveInteger('208x', 'BDL_PLAYER_ID'),
    /positive integer/,
  );
  assert.throws(
    () => parseNonNegativeInteger('-1', 'DELAY', 13_000),
    /non-negative integer/,
  );
});
