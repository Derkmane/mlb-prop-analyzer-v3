import assert from 'node:assert/strict';
import test from 'node:test';

import {
  computeM8CategoricalPoolingNondominatedCandidateIds,
  selectM8CategoricalPoolingStableCandidate,
} from '../scripts/m8-categorical-pooling-walk-forward-utils.mjs';

function result(candidateId, leagueEquivalentPa, logLoss, brier) {
  return {
    candidate: {
      candidateId,
      leagueEquivalentPa,
    },
    validationLogLoss: logLoss,
    validationBrierScore: brier,
  };
}

test('computes joint proper-score nondominated sets', () => {
  const results = [
    result('league-pa-25', 25, 1.01, 0.50),
    result('league-pa-50', 50, 1.00, 0.51),
    result('league-pa-100', 100, 1.02, 0.52),
  ];

  assert.deepEqual(
    computeM8CategoricalPoolingNondominatedCandidateIds(results),
    ['league-pa-25', 'league-pa-50'],
  );
});

test('selects the strongest pooling candidate in the stable intersection', () => {
  const fixedResults = [
    result('league-pa-25', 25, 1.01, 0.50),
    result('league-pa-50', 50, 1.00, 0.51),
    result('league-pa-100', 100, 1.02, 0.52),
  ];
  const walkForwardResults = [
    result('league-pa-25', 25, 1.01, 0.51),
    result('league-pa-50', 50, 1.02, 0.50),
    result('league-pa-100', 100, 1.03, 0.53),
  ];

  const selection = selectM8CategoricalPoolingStableCandidate({
    fixedResults,
    walkForwardResults,
  });

  assert.deepEqual(selection.stableCandidateIds, [
    'league-pa-25',
    'league-pa-50',
  ]);
  assert.equal(selection.selectedCandidateId, 'league-pa-50');
  assert.equal(selection.stableSelection, true);
});

test('treats the league-only limit as the strongest pooling candidate', () => {
  const finite = result('league-pa-4096', 4096, 1.00, 0.50);
  const league = result('league-only-limit', null, 1.01, 0.49);

  const selection = selectM8CategoricalPoolingStableCandidate({
    fixedResults: [finite, league],
    walkForwardResults: [finite, league],
  });

  assert.equal(selection.selectedCandidateId, 'league-only-limit');
});

test('fails closed when fixed and walk-forward have no common nondominated candidate', () => {
  const fixedResults = [
    result('league-pa-25', 25, 1.00, 0.50),
    result('league-pa-50', 50, 1.01, 0.51),
  ];
  const walkForwardResults = [
    result('league-pa-25', 25, 1.01, 0.51),
    result('league-pa-50', 50, 1.00, 0.50),
  ];

  const selection = selectM8CategoricalPoolingStableCandidate({
    fixedResults,
    walkForwardResults,
  });

  assert.equal(selection.stableSelection, false);
  assert.equal(selection.selectedCandidateId, null);
  assert.equal(selection.selectionReason, 'EMPTY_STABLE_INTERSECTION');
});

test('rejects different fixed and walk-forward candidate families', () => {
  assert.throws(
    () =>
      selectM8CategoricalPoolingStableCandidate({
        fixedResults: [
          result('league-pa-25', 25, 1.00, 0.50),
          result('league-pa-50', 50, 1.01, 0.51),
        ],
        walkForwardResults: [
          result('league-pa-25', 25, 1.00, 0.50),
          result('league-pa-100', 100, 1.01, 0.51),
        ],
      }),
    /candidate sets differ/,
  );
});
