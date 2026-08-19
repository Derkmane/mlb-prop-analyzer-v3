import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

test('user projection root remains optional and defaults to the dated artifact directory', () => {
  const source = readFileSync('scripts/user-projected-lineup-utils.mjs', 'utf8');
  assert.match(source, /USER_PROJECTED_LINEUP_ROOT\?\.trim\(\) \|\|/u);
  assert.match(source, /artifacts\/user-projected-lineups/u);
});
