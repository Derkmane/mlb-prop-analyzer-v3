import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import {
  readUserProjectedLineupForGame,
  USER_PROJECTED_LINEUP_CONTRACT,
} from '../scripts/user-projected-lineup-utils.mjs';

const artifactPath = 'artifacts/user-projected-lineups/2026-08-24.json';

test('2026-08-24 user-supplied RotoWire transcription is a valid projected-lineup artifact', () => {
  const raw = JSON.parse(readFileSync(artifactPath, 'utf8'));
  assert.equal(raw.contract, USER_PROJECTED_LINEUP_CONTRACT);
  assert.equal(raw.slateDate, '2026-08-24');
  assert.equal(raw.games.length, 10);
  assert.equal(raw.sourceEvidenceIds.length, 2);

  const teams = raw.games.flatMap((game) => game.teams);
  assert.equal(teams.length, 20);
  assert.equal(teams.every((team) => team.sourceStatus === 'expected'), true);
  assert.equal(teams.every((team) => team.players.length === 9), true);
  assert.equal(teams.flatMap((team) => team.players).length, 180);

  const raysTigers = readUserProjectedLineupForGame({
    date: '2026-08-24T22:40:00.000Z',
    away_team_name: 'Tampa Bay Rays',
    home_team_name: 'Detroit Tigers',
  });
  assert.ok(raysTigers);

  const raysGame = raysTigers.games.find(
    (game) =>
      game.awayTeamName === 'Tampa Bay Rays' &&
      game.homeTeamName === 'Detroit Tigers',
  );
  assert.ok(raysGame);
  const rays = raysGame.teams.find((team) => team.teamName === 'Tampa Bay Rays');
  assert.ok(rays);
  assert.deepEqual(rays.players[3], {
    sourcePlayerLabel: 'Ryan Vilade',
    lineupSlot: 4,
  });

  const guardiansGame = raysTigers.games.find(
    (game) => game.awayTeamName === 'Cleveland Guardians',
  );
  assert.ok(guardiansGame);
  const angels = guardiansGame.teams.find(
    (team) => team.teamName === 'Los Angeles Angels',
  );
  assert.ok(angels);
  assert.deepEqual(angels.players[8], {
    sourcePlayerLabel: "T. d'Arnaud",
    lineupSlot: 9,
  });

  const twinsGame = raysTigers.games.find(
    (game) => game.awayTeamName === 'Minnesota Twins',
  );
  assert.ok(twinsGame);
  const athletics = twinsGame.teams.find((team) => team.teamName === 'Athletics');
  assert.ok(athletics);
  assert.deepEqual(athletics.players[6], {
    sourcePlayerLabel: 'Jonah Heim',
    lineupSlot: 7,
  });

  const giantsGame = raysTigers.games.find(
    (game) => game.homeTeamName === 'San Francisco Giants',
  );
  assert.ok(giantsGame);
  const giants = giantsGame.teams.find(
    (team) => team.teamName === 'San Francisco Giants',
  );
  assert.ok(giants);
  assert.deepEqual(giants.players[8], {
    sourcePlayerLabel: 'C. Koss',
    lineupSlot: 9,
  });
});
