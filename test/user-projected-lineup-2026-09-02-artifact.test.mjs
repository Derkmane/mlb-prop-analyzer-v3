import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import {
  readUserProjectedLineupForGame,
  USER_PROJECTED_LINEUP_CONTRACT,
} from '../scripts/user-projected-lineup-utils.mjs';

const artifactPath = 'artifacts/user-projected-lineups/2026-09-02.json';

test('2026-09-02 user-supplied RotoWire transcription is a valid expected-lineup fallback artifact', () => {
  const raw = JSON.parse(readFileSync(artifactPath, 'utf8'));
  assert.equal(raw.contract, USER_PROJECTED_LINEUP_CONTRACT);
  assert.equal(raw.slateDate, '2026-09-02');
  assert.equal(raw.games.length, 9);
  assert.equal(raw.sourceEvidenceIds.length, 3);

  const teams = raw.games.flatMap((game) => game.teams);
  assert.equal(teams.length, 18);
  assert.equal(teams.every((team) => team.sourceStatus === 'expected'), true);
  assert.equal(teams.every((team) => team.players.length === 9), true);
  assert.equal(teams.flatMap((team) => team.players).length, 162);

  const matchupKeys = new Set(
    raw.games.map((game) => `${game.awayTeamName}|${game.homeTeamName}`),
  );
  assert.equal(matchupKeys.has('San Diego Padres|Cincinnati Reds'), false);
  assert.equal(matchupKeys.has('Atlanta Braves|Washington Nationals'), false);
  assert.equal(matchupKeys.has('Athletics|Texas Rangers'), false);
  assert.equal(matchupKeys.has('Baltimore Orioles|Colorado Rockies'), false);
  assert.equal(matchupKeys.has('Philadelphia Phillies|Arizona Diamondbacks'), false);
  assert.equal(matchupKeys.has('Seattle Mariners|Boston Red Sox'), false);

  const metsRays = readUserProjectedLineupForGame({
    date: '2026-09-02T22:40:00.000Z',
    away_team_name: 'New York Mets',
    home_team_name: 'Tampa Bay Rays',
  });
  assert.ok(metsRays);

  const metsGame = metsRays.games.find(
    (game) =>
      game.awayTeamName === 'New York Mets' &&
      game.homeTeamName === 'Tampa Bay Rays',
  );
  assert.ok(metsGame);
  const mets = metsGame.teams.find((team) => team.teamName === 'New York Mets');
  assert.ok(mets);
  assert.deepEqual(mets.players[0], {
    sourcePlayerLabel: 'F. Lindor',
    lineupSlot: 1,
  });
  assert.deepEqual(mets.players[8], {
    sourcePlayerLabel: 'F. Alvarez',
    lineupSlot: 9,
  });

  const cubsGame = metsRays.games.find(
    (game) => game.homeTeamName === 'Chicago Cubs',
  );
  assert.ok(cubsGame);
  const cubs = cubsGame.teams.find((team) => team.teamName === 'Chicago Cubs');
  assert.ok(cubs);
  assert.deepEqual(cubs.players[0], {
    sourcePlayerLabel: 'P. Crow-Armstrong',
    lineupSlot: 1,
  });

  const dodgersGame = metsRays.games.find(
    (game) => game.homeTeamName === 'Los Angeles Dodgers',
  );
  assert.ok(dodgersGame);
  const dodgers = dodgersGame.teams.find(
    (team) => team.teamName === 'Los Angeles Dodgers',
  );
  assert.ok(dodgers);
  assert.deepEqual(dodgers.players[7], {
    sourcePlayerLabel: 'Kyle Tucker',
    lineupSlot: 8,
  });
});
