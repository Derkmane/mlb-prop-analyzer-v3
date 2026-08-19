import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

test('screenshot confirmed/expected labels stay source metadata rather than active lineup status', () => {
  const artifact = JSON.parse(
    readFileSync('artifacts/user-projected-lineups/2026-08-19.json', 'utf8'),
  );
  const statuses = new Set(
    artifact.games.flatMap((game) => game.teams.map((team) => team.sourceStatus)),
  );
  assert.deepEqual([...statuses].sort(), ['confirmed', 'expected']);
  assert.equal(JSON.stringify(artifact).includes('"lineupStatus":"confirmed"'), false);
});
