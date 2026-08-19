import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

test('user projection source is passed only as projectedGameEvidence', () => {
  const source = readFileSync('scripts/archive-m9-batter-hits-board.mjs', 'utf8');
  const fallback = source.slice(source.indexOf('const projectedGameEvidence ='), source.indexOf('if (!resolution.resolved)'));
  assert.match(fallback, /userProjectedLineupEvidenceForIdentity/u);
  assert.match(fallback, /projectedGameEvidence,/u);
  assert.doesNotMatch(fallback, /winProbability|voidProbability|ranking|multiplier|price/u);
});
