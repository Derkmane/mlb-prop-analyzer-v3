import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import {
  readUserProjectedLineupForGame,
  USER_PROJECTED_LINEUP_CONTRACT,
} from '../scripts/user-projected-lineup-utils.mjs';

const artifactPath = 'artifacts/user-projected-lineups/2026-08-19.json';

test('today user-supplied RotoWire transcription is a valid partial projected-lineup artifact', () => {
  const raw = JSON.parse(readFileSync(artifactPath, 'utf8'));
  assert.equal(raw.contract, USER_PROJECTED_LINEUP_CONTRACT);
  assert.equal(raw.slateDate, '2026-08-19');
  assert.equal(raw.games.length, 12);
  assert.equal(raw.sourceEvidenceIds.length, 4);

  const resolved = readUserProjectedLineupForGame({
    date: '2026-08-19T18:20:00.000Z',
    away_team_name: 'Chicago White Sox',
    home_team_name: 'Chicago Cubs',
  });
  assert.ok(resolved);
  const whiteSox = resolved.games[0].teams.find(
    (team) => team.teamName === 'Chicago White Sox',
  );
  assert.ok(whiteSox);
  assert.equal(whiteSox.sourceStatus, 'confirmed');
  assert.equal(whiteSox.players.length, 9);

  const baltimore = resolved.games
    .find((game) => game.homeTeamName === 'Baltimore Orioles')
    .teams.find((team) => team.teamName === 'Baltimore Orioles');
  assert.equal(baltimore.players.length, 8);
  assert.equal(baltimore.players.some((player) => player.lineupSlot === 6), false);
});
