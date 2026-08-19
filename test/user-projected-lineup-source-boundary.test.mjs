import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

test('today screenshot artifact contains lineup rows only and no prohibited screenshot model inputs', () => {
  const artifact = JSON.parse(
    readFileSync('artifacts/user-projected-lineups/2026-08-19.json', 'utf8'),
  );
  const text = JSON.stringify(artifact);
  for (const prohibited of [
    'startingPitcher',
    'era',
    'weather',
    'precipitation',
    'americanPrice',
    'multiplier',
    'probability',
    'homeRunOdds',
    'bettingLine',
  ]) {
    assert.equal(Object.hasOwn(artifact, prohibited), false);
    assert.doesNotMatch(text, new RegExp(`\\"${prohibited}\\"`, 'u'));
  }
});
