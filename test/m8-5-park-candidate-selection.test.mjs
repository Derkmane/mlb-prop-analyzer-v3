import assert from 'node:assert/strict';
import test from 'node:test';

import {
  M8_5_PARK_CANDIDATE_SET_VERSION,
  parkCandidateDominates,
  selectCanonicalM8_5ParkCandidate,
} from '../scripts/m8-5-park-candidate-selection-utils.mjs';

function scores(logLoss, brier, hitLogLoss = 0.5, hitBrier = 0.2) {
  return Object.freeze({
    categoricalLogLoss: logLoss,
    categoricalBrier: brier,
    hitLogLoss,
    hitBrier,
  });
}

function result(candidateId, equivalentPa, fixed, walkForward) {
  return Object.freeze({
    candidate: Object.freeze({ candidateId, equivalentPa }),
    fixedMetrics: fixed,
    walkForwardMetrics: walkForward,
  });
}

test('categorical proper-score dominance requires no-worse log loss and Brier with one strict improvement', () => {
  const left = {
    fixedMetrics: scores(1, 0.3),
    walkForwardMetrics: scores(1, 0.3),
  };
  const right = {
    fixedMetrics: scores(1.1, 0.3),
    walkForwardMetrics: scores(0.9, 0.4),
  };
  assert.equal(parkCandidateDominates(left, right, 'fixed'), true);
  assert.equal(parkCandidateDominates(left, right, 'walkForward'), false);
  assert.equal(parkCandidateDominates(left, left, 'fixed'), false);
});

test('proper-score sign disagreement keeps both candidates nondominated', () => {
  const selection = selectCanonicalM8_5ParkCandidate({
    identityFixedMetrics: scores(1, 0.3),
    identityWalkForwardMetrics: scores(1, 0.3),
    candidateResults: [
      result(
        'venue-hand-pool-100',
        100,
        scores(0.9, 0.31),
        scores(0.9, 0.31),
      ),
    ],
  });
  assert.deepEqual(selection.fixedNondominatedCandidateIds, [
    'identity',
    'venue-hand-pool-100',
  ]);
  assert.deepEqual(selection.walkForwardNondominatedCandidateIds, [
    'identity',
    'venue-hand-pool-100',
  ]);
  assert.equal(selection.selectedCandidateId, 'identity');
});

test('fails closed when fixed and walk-forward nondominated sets have no common candidate', () => {
  const selection = selectCanonicalM8_5ParkCandidate({
    identityFixedMetrics: scores(2, 0.5),
    identityWalkForwardMetrics: scores(2, 0.5),
    candidateResults: [
      result(
        'venue-hand-pool-100',
        100,
        scores(1, 0.2),
        scores(3, 0.7),
      ),
      result(
        'venue-hand-pool-500',
        500,
        scores(3, 0.7),
        scores(1, 0.2),
      ),
    ],
  });
  assert.deepEqual(selection.fixedNondominatedCandidateIds, [
    'venue-hand-pool-100',
  ]);
  assert.deepEqual(selection.walkForwardNondominatedCandidateIds, [
    'venue-hand-pool-500',
  ]);
  assert.deepEqual(selection.stableCandidateIds, []);
  assert.equal(selection.decision, 'NO_STABLE_PARK_CANDIDATE');
  assert.equal(selection.selectedCandidateId, null);
});

test('selects the strongest finite pooling candidate in the stable intersection', () => {
  const selection = selectCanonicalM8_5ParkCandidate({
    identityFixedMetrics: scores(2, 0.5),
    identityWalkForwardMetrics: scores(2, 0.5),
    candidateResults: [
      result(
        'venue-hand-pool-100',
        100,
        scores(1, 0.2),
        scores(1, 0.2),
      ),
      result(
        'venue-hand-pool-500',
        500,
        scores(1, 0.2),
        scores(1, 0.2),
      ),
    ],
  });
  assert.equal(
    selection.candidateSetVersion,
    M8_5_PARK_CANDIDATE_SET_VERSION,
  );
  assert.deepEqual(selection.stableCandidateIds, [
    'venue-hand-pool-100',
    'venue-hand-pool-500',
  ]);
  assert.equal(selection.selectedCandidateId, 'venue-hand-pool-500');
  assert.equal(selection.decision, 'VALIDATED_PARK_SIGNAL');
});

test('treats identity as the infinite-pooling limit and selects it when stable', () => {
  const selection = selectCanonicalM8_5ParkCandidate({
    identityFixedMetrics: scores(1, 0.2),
    identityWalkForwardMetrics: scores(1, 0.2),
    candidateResults: [
      result(
        'venue-hand-pool-2500',
        2500,
        scores(1, 0.2),
        scores(1, 0.2),
      ),
    ],
  });
  assert.equal(selection.selectedCandidateId, 'identity');
  assert.equal(
    selection.decision,
    'IDENTITY_RETAINED_NO_VALIDATED_PARK_SIGNAL',
  );
});

test('Hit diagnostic changes cannot alter canonical candidate selection', () => {
  const common = {
    identityFixedMetrics: scores(2, 0.5, 0.1, 0.01),
    identityWalkForwardMetrics: scores(2, 0.5, 0.1, 0.01),
  };
  const first = selectCanonicalM8_5ParkCandidate({
    ...common,
    candidateResults: [
      result(
        'venue-hand-pool-100',
        100,
        scores(1, 0.2, 10, 10),
        scores(1, 0.2, 10, 10),
      ),
    ],
  });
  const second = selectCanonicalM8_5ParkCandidate({
    ...common,
    candidateResults: [
      result(
        'venue-hand-pool-100',
        100,
        scores(1, 0.2, 0, 0),
        scores(1, 0.2, 0, 0),
      ),
    ],
  });
  assert.equal(first.selectedCandidateId, 'venue-hand-pool-100');
  assert.equal(second.selectedCandidateId, first.selectedCandidateId);
});
