import assert from 'node:assert/strict';
import test from 'node:test';

import {
  buildPhase2DisplayEnrichment,
  capturePhase2DisplayEnrichment,
  phase2EnrichmentEnabled,
} from '../scripts/phase2-display-enrichment-utils.mjs';

const game = (id, date, status = 'STATUS_FINAL') => ({
  id, date: `${date}T19:00:00.000Z`, status,
  home_team_name: 'Boston Red Sox', away_team_name: 'New York Yankees',
  home_team: { abbreviation: 'BOS' }, away_team: { abbreviation: 'NYY' },
});
const batting = (gameId, pa, overrides = {}) => ({
  player: { id: 7 }, game_id: gameId, team_name: 'Boston Red Sox', plate_appearances: pa,
  at_bats: pa, hits: 1, runs: 1, rbi: 1, total_bases: 2, ...overrides,
});
const pitching = (gameId, started, overrides = {}) => ({
  player: { id: 99 }, game_id: gameId, games_started: started,
  pitching_outs: 18, er: 2, p_k: 7, p_hits: 4, p_bb: 2, pitching_ip: '999.2', ...overrides,
});
const player = {
  providerGameId: 100, providerPlayerId: 7, opposingStarterPitcherId: 99,
  opposingStarterName: 'Starter Person', opposingStarterHand: 'R',
};
function build(statsRows, games, seasonStatsRows = []) {
  return buildPhase2DisplayEnrichment({ captureDateUtc: '2026-08-10', players: [player], games, statsRows, seasonStatsRows });
}
const entry = (result) => result.byGamePlayerKey['100:7'];

test('last five uses only games the player appeared in, preserves gaps, and counts one PA', () => {
  const games = [game(1, '2026-08-01'), game(2, '2026-08-02'), game(3, '2026-08-03'), game(4, '2026-08-04')];
  const result = build([batting(1, 4), batting(2, 0), batting(3, 1)], games);
  assert.deepEqual(entry(result).lastFiveGames.games.map((row) => row.gameDate), ['2026-08-01', '2026-08-03']);
  assert.equal(entry(result).lastFiveGames.count, 2);
  assert.equal(entry(result).lastFiveGames.games[1].plateAppearances, 1);
});

test('capture-date games are excluded and latest five are ordered oldest to newest without padding', () => {
  const games = Array.from({ length: 8 }, (_, index) => game(index + 1, `2026-08-${String(index + 3).padStart(2, '0')}`));
  const result = build(games.map((_, index) => batting(index + 1, 4)), games);
  assert.deepEqual(entry(result).lastFiveGames.games.map((row) => row.gameDate), [
    '2026-08-05', '2026-08-06', '2026-08-07', '2026-08-08', '2026-08-09',
  ]);
  assert.equal(entry(result).lastFiveGames.games.some((row) => row.gameDate === '2026-08-10'), false);
});

test('team name mismatch fails the player log closed and counts the reason', () => {
  const result = build([batting(1, 4, { team_name: 'Red Sox' })], [game(1, '2026-08-01')]);
  assert.deepEqual(entry(result).lastFiveGames.games, []);
  assert.equal(entry(result).lastFiveGames.failureReason, 'TEAM_NAME_MISMATCH');
  assert.equal(result.diagnostics.failureReasons.TEAM_NAME_MISMATCH, 1);
});

test('starter last-10 excludes relief and aggregates outs rather than decimal innings strings', () => {
  const games = [game(1, '2026-08-01'), game(2, '2026-08-02'), game(3, '2026-08-03')];
  const result = build([
    pitching(1, 1, { pitching_outs: 19, pitching_ip: '6.1', p_hits: 5, p_bb: 1 }),
    pitching(2, 0, { pitching_outs: 3, er: 9, p_k: 9 }),
    pitching(3, 1, { pitching_outs: 19, pitching_ip: '6.1', p_hits: 4, p_bb: 2 }),
  ], games);
  assert.deepEqual(entry(result).opposingStarter.last10, {
    starts: 2, inningsPitched: '12.2', earnedRuns: 4, strikeouts: 14, whip: 36 / 38,
  });
});

test('starter season block and ERA come from season_stats', () => {
  const result = build([], [], [{
    player: { id: 99 }, pitching_ip: '123.1', pitching_er: 40, pitching_k: 130,
    pitching_whip: 1.08, pitching_era: 2.92,
  }]);
  assert.equal(entry(result).opposingStarter.era, 2.92);
  assert.deepEqual(entry(result).opposingStarter.season, {
    inningsPitched: '123.1', earnedRuns: 40, strikeouts: 130, whip: 1.08,
  });
});

test('Phase 2 kill switch skips lookups and records empty enrichment reasons', async () => {
  const previous = process.env.PHASE2_ENRICHMENT;
  process.env.PHASE2_ENRICHMENT = 'off';
  try {
    const result = await capturePhase2DisplayEnrichment({
      captureDateUtc: '2026-08-10', players: [player],
      fetchPage: () => assert.fail('disabled enrichment must not fetch'),
    });
    assert.deepEqual(entry(result).lastFiveGames, {
      count: 0, games: [], failureReason: 'disabled-by-flag',
    });
    assert.deepEqual(entry(result).opposingStarter, { failureReason: 'disabled-by-flag' });
    assert.deepEqual(result.diagnostics.failureReasons, { 'disabled-by-flag': 1 });
  } finally {
    if (previous === undefined) delete process.env.PHASE2_ENRICHMENT;
    else process.env.PHASE2_ENRICHMENT = previous;
  }
});

test('Phase 2 flag defaults on and rejects unsupported values', () => {
  assert.equal(phase2EnrichmentEnabled(undefined), true);
  assert.equal(phase2EnrichmentEnabled('on'), true);
  assert.equal(phase2EnrichmentEnabled('off'), false);
  assert.throws(() => phase2EnrichmentEnabled('yes'), /must be "on" or "off"/u);
});

test('capture batches stats with game_ids[] and player_ids[] and follows pagination', async () => {
  const previous = process.env.PHASE2_ENRICHMENT;
  process.env.PHASE2_ENRICHMENT = 'on';
  const statsUrls = [];
  try {
    const result = await capturePhase2DisplayEnrichment({
      captureDateUtc: '2026-08-10', players: [player], timeoutMs: 1_000,
      fetchPage: async (url) => {
        if (url.pathname.endsWith('/games')) {
          return url.searchParams.get('cursor') === null && url.searchParams.getAll('dates[]').includes('2026-08-01')
            ? { data: [game(1, '2026-08-01')], meta: {} }
            : { data: [], meta: {} };
        }
        if (url.pathname.endsWith('/stats')) {
          statsUrls.push(url);
          return url.searchParams.get('cursor') === null
            ? { data: [], meta: { next_cursor: 2 } }
            : { data: [batting(1, 4)], meta: {} };
        }
        return { data: [], meta: {} };
      },
    });
    assert.equal(statsUrls.length, 2);
    assert.deepEqual(statsUrls[0].searchParams.getAll('game_ids[]'), ['1']);
    assert.deepEqual(statsUrls[0].searchParams.getAll('player_ids[]').sort(), ['7', '99']);
    assert.equal(statsUrls[1].searchParams.get('cursor'), '2');
    assert.equal(entry(result).lastFiveGames.count, 1);
  } finally {
    if (previous === undefined) delete process.env.PHASE2_ENRICHMENT;
    else process.env.PHASE2_ENRICHMENT = previous;
  }
});

test('repeated stats pagination cursor fails soft without emitting partial logs', async () => {
  const previous = process.env.PHASE2_ENRICHMENT;
  process.env.PHASE2_ENRICHMENT = 'on';
  try {
    const result = await capturePhase2DisplayEnrichment({
      captureDateUtc: '2026-08-10', players: [player], timeoutMs: 1_000,
      fetchPage: async (url) => {
        if (url.pathname.endsWith('/games')) {
          return url.searchParams.getAll('dates[]').includes('2026-08-01')
            ? { data: [game(1, '2026-08-01')], meta: {} }
            : { data: [], meta: {} };
        }
        if (url.pathname.endsWith('/stats')) {
          return { data: [batting(1, 4)], meta: { next_cursor: 2 } };
        }
        return { data: [], meta: {} };
      },
    });
    assert.deepEqual(entry(result).lastFiveGames.games, []);
    assert.equal(entry(result).lastFiveGames.failureReason, 'stats-page-truncated');
    assert.deepEqual(result.diagnostics.failureReasons, { 'stats-page-truncated': 1 });
  } finally {
    if (previous === undefined) delete process.env.PHASE2_ENRICHMENT;
    else process.env.PHASE2_ENRICHMENT = previous;
  }
});

test('whole enrichment timeout fails soft and reports a counted reason', async () => {
  const previous = process.env.PHASE2_ENRICHMENT;
  process.env.PHASE2_ENRICHMENT = 'on';
  try {
    const result = await capturePhase2DisplayEnrichment({
      captureDateUtc: '2026-08-10', players: [player], timeoutMs: 10,
      fetchPage: (_url, _label, { signal }) => new Promise((_resolve, reject) => {
        signal.addEventListener('abort', () => reject(signal.reason), { once: true });
      }),
    });
    assert.equal(entry(result).lastFiveGames.failureReason, 'enrichment-timeout');
    assert.deepEqual(result.diagnostics.failureReasons, { 'enrichment-timeout': 1 });
  } finally {
    if (previous === undefined) delete process.env.PHASE2_ENRICHMENT;
    else process.env.PHASE2_ENRICHMENT = previous;
  }
});
