import assert from 'node:assert/strict';
import test from 'node:test';

import {
  DEFAULT_M8_PLATOON_CANDIDATES,
} from '../scripts/m8-resolved-categorical-platoon-utils.mjs';
import {
  M8_EXTENDED_LEAGUE_PLATOON_EQUIVALENT_PA,
  M8_EXTENDED_PLATOON_BOUNDARY_CANDIDATES,
  buildM8ExtendedPlatoonBoundaryCandidates,
} from '../scripts/m8-resolved-categorical-platoon-boundary-utils.mjs';

function finiteLeagueValues(candidates) {
  return [
    ...new Set(
      candidates
        .map((candidate) => candidate.leaguePlatoonEquivalentPa)
        .filter((value) => value !== null),
    ),
  ].sort((left, right) => left - right);
}

test('extends the lower league-platoon prior boundary across several orders of magnitude', () => {
  assert.deepEqual(finiteLeagueValues(M8_EXTENDED_PLATOON_BOUNDARY_CANDIDATES), [
    ...M8_EXTENDED_LEAGUE_PLATOON_EQUIVALENT_PA,
  ]);
  assert.equal(M8_EXTENDED_LEAGUE_PLATOON_EQUIVALENT_PA[0], 0.001);
  assert.equal(M8_EXTENDED_LEAGUE_PLATOON_EQUIVALENT_PA.at(-1), 4096);
  assert.ok(M8_EXTENDED_LEAGUE_PLATOON_EQUIVALENT_PA.includes(4));
});

test('preserves every original candidate while adding only lower-prior hypotheses', () => {
  const extendedIds = new Set(
    M8_EXTENDED_PLATOON_BOUNDARY_CANDIDATES.map(
      (candidate) => candidate.candidateId,
    ),
  );
  for (const candidate of DEFAULT_M8_PLATOON_CANDIDATES) {
    assert.equal(extendedIds.has(candidate.candidateId), true);
  }
  assert.equal(M8_EXTENDED_PLATOON_BOUNDARY_CANDIDATES.length, 589);
  assert.equal(extendedIds.size, 589);
  assert.equal(
    M8_EXTENDED_PLATOON_BOUNDARY_CANDIDATES.filter(
      (candidate) => candidate.candidateId === 'no-platoon',
    ).length,
    1,
  );
});

test('gives every finite and exact league prior the identical split-coefficient grid', () => {
  const counts = new Map();
  for (const candidate of M8_EXTENDED_PLATOON_BOUNDARY_CANDIDATES) {
    if (candidate.candidateId === 'no-platoon') continue;
    const key = candidate.leaguePlatoonExactTarget
      ? 'league-only-target'
      : `league-pa-${candidate.leaguePlatoonEquivalentPa}`;
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  assert.equal(counts.size, 14);
  assert.ok([...counts.values()].every((count) => count === 42));
});

test('is deterministic and does not mutate the verified default candidate grid', () => {
  const defaultSnapshot = JSON.stringify(DEFAULT_M8_PLATOON_CANDIDATES);
  const first = buildM8ExtendedPlatoonBoundaryCandidates();
  const second = buildM8ExtendedPlatoonBoundaryCandidates();
  assert.deepEqual(first, second);
  assert.equal(JSON.stringify(DEFAULT_M8_PLATOON_CANDIDATES), defaultSnapshot);
  assert.deepEqual(first, M8_EXTENDED_PLATOON_BOUNDARY_CANDIDATES);
});
