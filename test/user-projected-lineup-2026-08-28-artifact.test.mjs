import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import {
  readUserProjectedLineupForGame,
  USER_PROJECTED_LINEUP_CONTRACT,
} from '../scripts/user-projected-lineup-utils.mjs';

const artifactPath = 'artifacts/user-projected-lineups/2026-08-28.json';

test('2026-08-28 user-supplied RotoWire transcription is a valid projected-lineup artifact', () => {
  const raw = JSON.parse(readFileSync(artifactPath, 'utf8'));
  assert.equal(raw.contract, USER_PROJECTED_LINEUP_CONTRACT);
  assert.equal(raw.slateDate, '2026-08-28');
  assert.equal(raw.games.length, 15);
  assert.equal(raw.sourceEvidenceIds.length, 3);

  const teams = raw.games.flatMap((game) => game.teams);
  assert.equal(teams.length, 30);
  assert.equal(teams.filter((team) => team.sourceStatus === 'confirmed').length, 2);
  assert.equal(teams.filter((team) => team.sourceStatus === 'expected').length, 28);
  assert.equal(teams.every((team) => team.players.length === 9), true);
  assert.equal(teams.flatMap((team) => team.players).length, 270);

  const redsCubs = readUserProjectedLineupForGame({
    date: '2026-08-28T18:20:00.000Z',
    away_team_name: 'Cincinnati Reds',
    home_team_name: 'Chicago Cubs',
  });
  assert.ok(redsCubs);

  const redsGame = redsCubs.games.find(
    (game) =>
      game.awayTeamName === 'Cincinnati Reds' &&
      game.homeTeamName === 'Chicago Cubs',
  );
  assert.ok(redsGame);
  const reds = redsGame.teams.find((team) => team.teamName === 'Cincinnati Reds');
  assert.ok(reds);
  assert.deepEqual(reds.players[0], {
    sourcePlayerLabel: 'Dane Myers',
    lineupSlot: 1,
  });

  const cubs = redsGame.teams.find((team) => team.teamName === 'Chicago Cubs');
  assert.ok(cubs);
  assert.deepEqual(cubs.players[6], {
    sourcePlayerLabel: 'P. Ramirez',
    lineupSlot: 7,
  });

  const metsGame = redsCubs.games.find(
    (game) => game.homeTeamName === 'New York Mets',
  );
  assert.ok(metsGame);
  const mets = metsGame.teams.find((team) => team.teamName === 'New York Mets');
  assert.ok(mets);
  assert.deepEqual(mets.players[3], {
    sourcePlayerLabel: 'Carson Benge',
    lineupSlot: 4,
  });

  const giantsGame = redsCubs.games.find(
    (game) => game.homeTeamName === 'San Francisco Giants',
  );
  assert.ok(giantsGame);
  const giants = giantsGame.teams.find((team) => team.teamName === 'San Francisco Giants');
  assert.ok(giants);
  assert.deepEqual(giants.players[5], {
    sourcePlayerLabel: 'D. Cavanaugh',
    lineupSlot: 6,
  });
});
