import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

test('projection input artifact schema stays limited to lineup evidence', () => {
  const artifact = JSON.parse(readFileSync('artifacts/user-projected-lineups/2026-08-19.json', 'utf8'));
  for (const game of artifact.games) {
    for (const team of game.teams) {
      for (const player of team.players) {
        assert.deepEqual(Object.keys(player).sort(), ['lineupSlot', 'sourcePlayerLabel']);
      }
    }
  }
});
