import assert from 'node:assert/strict';
import test from 'node:test';

import { poolCategoricalCountsOnce } from '../scripts/m8-categorical-pooling-utils.mjs';
import {
  DEFAULT_M8_PLATOON_CANDIDATES,
} from '../scripts/m8-resolved-categorical-platoon-utils.mjs';
import {
  M8_EXACT_RAW_LEAGUE_PLATOON_PRIOR_ID,
  M8_EXACT_RAW_LEAGUE_PLATOON_SENTINEL_PA,
  M8_EXTENDED_LEAGUE_PLATOON_EQUIVALENT_PA,
  M8_EXTENDED_PLATOON_BOUNDARY_CANDIDATES,
  buildM8ExtendedPlatoonBoundaryCandidates,
  interpretM8PlatoonBoundaryEvaluation,
} from '../scripts/m8-resolved-categorical-platoon-boundary-utils.mjs';

function finiteLeagueValues(candidates) {
  return [
    ...new Set(
      candidates
        .filter(
          (candidate) =>
            candidate.leaguePlatoonPriorId !==
            M8_EXACT_RAW_LEAGUE_PLATOON_PRIOR_ID,
        )
        .map((candidate) => candidate.leaguePlatoonEquivalentPa)
        .filter((value) => value !== null),
    ),
  ].sort((left, right) => left - right);
}

function supportEvaluation({ zeroSupport = false } = {}) {
  return {
    selection: {
      selectedCandidate: {
        candidateId: `${M8_EXACT_RAW_LEAGUE_PLATOON_PRIOR_ID}-split-pa-1024-coefficient-0.75`,
        leaguePlatoonPriorId: M8_EXACT_RAW_LEAGUE_PLATOON_PRIOR_ID,
      },
    },
    selectedBoundaryFlags: {
      leaguePriorAtFiniteBoundary: true,
    },
    cohorts: {
      matchupCounts: {
        'L-vs-R': {
          categoryCounts: {
            K: 5,
            '1B': zeroSupport ? 0 : 3,
          },
        },
      },
    },
  };
}

test('extends the lower league-platoon prior boundary across several orders of magnitude', () => {
  assert.deepEqual(finiteLeagueValues(M8_EXTENDED_PLATOON_BOUNDARY_CANDIDATES), [
    ...M8_EXTENDED_LEAGUE_PLATOON_EQUIVALENT_PA,
  ]);
  assert.equal(M8_EXTENDED_LEAGUE_PLATOON_EQUIVALENT_PA[0], 0.001);
  assert.equal(M8_EXTENDED_LEAGUE_PLATOON_EQUIVALENT_PA.at(-1), 4096);
  assert.ok(M8_EXTENDED_LEAGUE_PLATOON_EQUIVALENT_PA.includes(4));
});

test('preserves every original candidate and adds one exact raw-cell limit grid', () => {
  const extendedIds = new Set(
    M8_EXTENDED_PLATOON_BOUNDARY_CANDIDATES.map(
      (candidate) => candidate.candidateId,
    ),
  );
  for (const candidate of DEFAULT_M8_PLATOON_CANDIDATES) {
    assert.equal(extendedIds.has(candidate.candidateId), true);
  }
  assert.equal(M8_EXTENDED_PLATOON_BOUNDARY_CANDIDATES.length, 631);
  assert.equal(extendedIds.size, 631);
  assert.equal(
    M8_EXTENDED_PLATOON_BOUNDARY_CANDIDATES.filter(
      (candidate) =>
        candidate.leaguePlatoonPriorId ===
        M8_EXACT_RAW_LEAGUE_PLATOON_PRIOR_ID,
    ).length,
    42,
  );
});

test('gives every league prior the identical split-coefficient grid', () => {
  const counts = new Map();
  for (const candidate of M8_EXTENDED_PLATOON_BOUNDARY_CANDIDATES) {
    if (candidate.candidateId === 'no-platoon') continue;
    const key = candidate.leaguePlatoonExactTarget
      ? 'league-only-target'
      : candidate.leaguePlatoonPriorId;
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  assert.equal(counts.size, 15);
  assert.ok([...counts.values()].every((count) => count === 42));
});

test('the raw-cell sentinel is computationally identical to zero pooling for positive counts', () => {
  assert.equal(M8_EXACT_RAW_LEAGUE_PLATOON_SENTINEL_PA, Number.MIN_VALUE);
  assert.ok(M8_EXACT_RAW_LEAGUE_PLATOON_SENTINEL_PA > 0);
  const categories = ['K', '1B'];
  const pooled = poolCategoricalCountsOnce({
    categories,
    source: {
      kind: 'raw-current-season-categorical-counts',
      counts: { K: 5, '1B': 3 },
    },
    leagueTarget: { K: 0.6, '1B': 0.4 },
    leagueEquivalentPa: M8_EXACT_RAW_LEAGUE_PLATOON_SENTINEL_PA,
  });
  assert.deepEqual(pooled.probabilities, { K: 5 / 8, '1B': 3 / 8 });
});

test('accepts the raw-cell limit only when every matchup category has positive support', () => {
  const interpretation = interpretM8PlatoonBoundaryEvaluation(
    supportEvaluation(),
  );
  assert.equal(interpretation.exactRawLeagueCellSelected, true);
  assert.equal(interpretation.exactRawLeagueCellSupportValid, true);
  assert.equal(interpretation.leaguePriorRequiresFurtherExtension, false);
  assert.deepEqual(interpretation.zeroSupportCells, []);

  assert.throws(
    () => interpretM8PlatoonBoundaryEvaluation(supportEvaluation({ zeroSupport: true })),
    /cannot be selected when a matchup cell has zero category support/,
  );
});

test('is deterministic and does not mutate the verified default candidate grid', () => {
  const defaultSnapshot = JSON.stringify(DEFAULT_M8_PLATOON_CANDIDATES);
  const first = buildM8ExtendedPlatoonBoundaryCandidates();
  const second = buildM8ExtendedPlatoonBoundaryCandidates();
  assert.deepEqual(first, second);
  assert.equal(JSON.stringify(DEFAULT_M8_PLATOON_CANDIDATES), defaultSnapshot);
  assert.deepEqual(first, M8_EXTENDED_PLATOON_BOUNDARY_CANDIDATES);
});
