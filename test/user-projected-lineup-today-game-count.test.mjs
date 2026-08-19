import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

test('today projection input preserves the twelve supplied matchup identities', () => {
  const artifact = JSON.parse(
    readFileSync('artifacts/user-projected-lineups/2026-08-19.json', 'utf8'),
  );
  const matchups = artifact.games.map(
    (game) => `${game.awayTeamName} @ ${game.homeTeamName}`,
  );
  assert.deepEqual(matchups, [
    'Chicago White Sox @ Chicago Cubs',
    'Arizona Diamondbacks @ Boston Red Sox',
    'Miami Marlins @ Philadelphia Phillies',
    'New York Yankees @ Baltimore Orioles',
    'San Francisco Giants @ Cleveland Guardians',
    'St. Louis Cardinals @ Cincinnati Reds',
    'Toronto Blue Jays @ Tampa Bay Rays',
    'Athletics @ Kansas City Royals',
    'Seattle Mariners @ Milwaukee Brewers',
    'Washington Nationals @ Texas Rangers',
    'Los Angeles Angels @ Houston Astros',
    'Los Angeles Dodgers @ Colorado Rockies',
  ]);
});
