import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

test('today projection artifact uses the versioned input contract', () => {
  const artifact = JSON.parse(readFileSync('artifacts/user-projected-lineups/2026-08-19.json', 'utf8'));
  assert.equal(artifact.version, 1);
  assert.equal(artifact.contract, 'user-projected-lineup-v1');
  assert.equal(artifact.sourceTimeZone, 'America/New_York');
});
