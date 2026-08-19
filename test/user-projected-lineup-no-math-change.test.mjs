import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

test('user projected lineup implementation does not introduce probability or ranking logic', () => {
  const utility = readFileSync('scripts/user-projected-lineup-utils.mjs', 'utf8');
  assert.doesNotMatch(utility, /P\(Win|probability|multiplier|price|settlement|rankPredictionCandidates/u);
  const resolver = readFileSync('scripts/archive-m9-batter-hits-board.mjs', 'utf8');
  const importCount = (resolver.match(/userProjectedLineupEvidenceForIdentity/gu) ?? []).length;
  assert.equal(importCount, 2);
});
