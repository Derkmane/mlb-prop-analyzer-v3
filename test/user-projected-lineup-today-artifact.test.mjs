import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import {
  readUserProjectedLineupForGame,
  USER_PROJECTED_LINEUP_CONTRACT,
} from '../scripts/user-projected-lineup-utils.mjs';

const artifactPath = 'artifacts/user-projected-lineups/2026-08-25.json';

function findTeam(artifact, teamName) {
  for (const game of artifact.games) {
    const team = game.teams.find((entry) => entry.teamName === teamName);
    if (team) return team;
  }
  return null;
}

test('today user-supplied RotoWire transcription is a valid full projected-lineup artifact', () => {
  const raw = JSON.parse(readFileSync(artifactPath, 'utf8'));
  assert.equal(raw.contract, USER_PROJECTED_LINEUP_CONTRACT);
  assert.equal(raw.slateDate, '2026-08-25');
  assert.equal(raw.games.length, 15);
  assert.equal(raw.sourceEvidenceIds.length, 3);

  const rawTeams = raw.games.flatMap((game) => game.teams);
  assert.equal(rawTeams.length, 30);
  assert.equal(
    rawTeams.reduce((count, team) => count + team.players.length, 0),
    270,
  );
  for (const team of rawTeams) {
    assert.equal(team.sourceStatus, 'expected');
    assert.equal(team.players.length, 9);
    assert.deepEqual(
      team.players.map((player) => player.lineupSlot),
      [1, 2, 3, 4, 5, 6, 7, 8, 9],
    );
  }

  const resolved = readUserProjectedLineupForGame({
    date: '2026-08-25T23:05:00.000Z',
    away_team_name: 'Houston Astros',
    home_team_name: 'New York Yankees',
  });
  assert.ok(resolved);
  assert.equal(resolved.games.length, 15);

  const miami = findTeam(resolved, 'Miami Marlins');
  assert.ok(miami);
  assert.deepEqual(
    miami.players.find((player) => player.sourcePlayerLabel === 'Jakob Marsee'),
    { sourcePlayerLabel: 'Jakob Marsee', lineupSlot: 6 },
  );

  const angels = findTeam(resolved, 'Los Angeles Angels');
  assert.ok(angels);
  assert.deepEqual(
    angels.players.find((player) => player.sourcePlayerLabel === 'Josh Lowe'),
    { sourcePlayerLabel: 'Josh Lowe', lineupSlot: 5 },
  );

  const giants = findTeam(resolved, 'San Francisco Giants');
  assert.ok(giants);
  assert.deepEqual(
    giants.players.find((player) => player.sourcePlayerLabel === 'C. Koss'),
    { sourcePlayerLabel: 'C. Koss', lineupSlot: 9 },
  );
});
