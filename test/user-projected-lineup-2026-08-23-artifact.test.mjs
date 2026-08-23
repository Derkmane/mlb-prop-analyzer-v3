import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import {
  readUserProjectedLineupForGame,
  USER_PROJECTED_LINEUP_CONTRACT,
} from '../scripts/user-projected-lineup-utils.mjs';

const artifactPath = 'artifacts/user-projected-lineups/2026-08-23.json';

test('2026-08-23 user-supplied RotoWire transcription is a valid full-slate projected-lineup artifact', () => {
  const raw = JSON.parse(readFileSync(artifactPath, 'utf8'));
  assert.equal(raw.contract, USER_PROJECTED_LINEUP_CONTRACT);
  assert.equal(raw.slateDate, '2026-08-23');
  assert.equal(raw.games.length, 15);
  assert.equal(raw.sourceEvidenceIds.length, 3);

  const teams = raw.games.flatMap((game) => game.teams);
  assert.equal(teams.length, 30);
  assert.equal(teams.every((team) => team.players.length === 9), true);
  assert.equal(teams.flatMap((team) => team.players).length, 270);
  assert.equal(teams.filter((team) => team.sourceStatus === 'confirmed').length, 2);

  const resolved = readUserProjectedLineupForGame({
    date: '2026-08-23T17:35:00.000Z',
    away_team_name: 'Tampa Bay Rays',
    home_team_name: 'Baltimore Orioles',
  });
  assert.ok(resolved);

  const orioles = resolved.games[0].teams.find(
    (team) => team.teamName === 'Baltimore Orioles',
  );
  assert.ok(orioles);
  assert.equal(orioles.sourceStatus, 'confirmed');
  assert.deepEqual(orioles.players[6], {
    sourcePlayerLabel: 'C. Encarnacion-Strand',
    lineupSlot: 7,
  });

  const metsGame = resolved.games.find(
    (game) => game.awayTeamName === 'New York Mets',
  );
  assert.ok(metsGame);
  const mets = metsGame.teams.find((team) => team.teamName === 'New York Mets');
  assert.ok(mets);
  assert.deepEqual(mets.players[6], {
    sourcePlayerLabel: 'M. Semien',
    lineupSlot: 7,
  });

  const philliesGame = resolved.games.find(
    (game) => game.homeTeamName === 'Philadelphia Phillies',
  );
  assert.ok(philliesGame);
  const phillies = philliesGame.teams.find(
    (team) => team.teamName === 'Philadelphia Phillies',
  );
  assert.ok(phillies);
  assert.equal(phillies.sourceStatus, 'confirmed');
  assert.deepEqual(phillies.players[8], {
    sourcePlayerLabel: 'B. De La Cruz',
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
