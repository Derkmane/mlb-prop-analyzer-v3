import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

test('user projection utility uses one optional dated artifact path', () => {
  const source = readFileSync('scripts/user-projected-lineup-utils.mjs', 'utf8');
  assert.match(source, /artifacts\/user-projected-lineups/u);
  assert.match(source, /`\$\{targetDate\}\.json`/u);
});
