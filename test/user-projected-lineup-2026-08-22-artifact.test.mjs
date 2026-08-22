import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import {
  readUserProjectedLineupForGame,
  USER_PROJECTED_LINEUP_CONTRACT,
} from '../scripts/user-projected-lineup-utils.mjs';

const artifactPath = 'artifacts/user-projected-lineups/2026-08-22.json';

test('2026-08-22 user-supplied RotoWire transcription is a valid full-slate projected-lineup artifact', () => {
  const raw = JSON.parse(readFileSync(artifactPath, 'utf8'));
  assert.equal(raw.contract, USER_PROJECTED_LINEUP_CONTRACT);
  assert.equal(raw.slateDate, '2026-08-22');
  assert.equal(raw.games.length, 15);
  assert.equal(raw.sourceEvidenceIds.length, 5);

  const teams = raw.games.flatMap((game) => game.teams);
  assert.equal(teams.length, 30);
  assert.equal(teams.every((team) => team.players.length === 9), true);
  assert.equal(teams.filter((team) => team.sourceStatus === 'confirmed').length, 3);

  const resolved = readUserProjectedLineupForGame({
    date: '2026-08-22T17:35:00.000Z',
    away_team_name: 'Toronto Blue Jays',
    home_team_name: 'New York Yankees',
  });
  assert.ok(resolved);

  const yankees = resolved.games[0].teams.find(
    (team) => team.teamName === 'New York Yankees',
  );
  assert.ok(yankees);
  assert.equal(yankees.sourceStatus, 'confirmed');
  assert.equal(yankees.players.length, 9);
  assert.deepEqual(yankees.players[6], {
    sourcePlayerLabel: 'J. Chisholm',
    lineupSlot: 7,
  });

  const metsGame = resolved.games.find(
    (game) => game.awayTeamName === 'New York Mets',
  );
  assert.ok(metsGame);
  const mets = metsGame.teams.find((team) => team.teamName === 'New York Mets');
  assert.ok(mets);
  assert.deepEqual(mets.players[8], {
    sourcePlayerLabel: 'M. Semien',
    lineupSlot: 9,
  });

  const padresGame = resolved.games.find(
    (game) => game.homeTeamName === 'San Diego Padres',
  );
  assert.ok(padresGame);
  const padres = padresGame.teams.find((team) => team.teamName === 'San Diego Padres');
  assert.ok(padres);
  assert.deepEqual(padres.players[8], {
    sourcePlayerLabel: 'Luis Rengifo',
    lineupSlot: 9,
  });
});
