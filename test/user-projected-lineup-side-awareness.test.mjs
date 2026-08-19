import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

test('user projected lineup input contains no selected-side field', () => {
  const artifact = JSON.parse(
    readFileSync('artifacts/user-projected-lineups/2026-08-19.json', 'utf8'),
  );
  assert.doesNotMatch(JSON.stringify(artifact), /selectedSide|Higher|Lower/u);
});
