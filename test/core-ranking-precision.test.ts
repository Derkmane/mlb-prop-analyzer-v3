import assert from 'node:assert/strict';
import test from 'node:test';

import {
  compareSettlementResultsForRanking,
  createProbabilityMassFunction,
  settleDiscreteStatistic,
} from '../src/core/index.js';
import type { SettlementResult } from '../src/domain/settlement.js';

test('P(Win | grades) is exactly invariant to eligibility probability', () => {
  const statisticDistribution = createProbabilityMassFunction([0.25, 0.75]);
  const lowerEligibility = settleDiscreteStatistic({
    statisticDistribution,
    eligibilityProbability: 0.8,
    line: 0.5,
    selectedSide: 'higher',
  });
  const higherEligibility = settleDiscreteStatistic({
    statisticDistribution,
    eligibilityProbability: 0.9,
    line: 0.5,
    selectedSide: 'higher',
  });

  assert.equal(lowerEligibility.winProbabilityGivenGrades, 0.75);
  assert.equal(higherEligibility.winProbabilityGivenGrades, 0.75);
  assert.equal(
    lowerEligibility.winProbabilityGivenGrades,
    higherEligibility.winProbabilityGivenGrades,
  );
});

test('ranking preserves genuine probability differences smaller than 1e-12', () => {
  const lowerProbability: SettlementResult = Object.freeze({
    eligibilityProbability: 1,
    line: 0.5,
    selectedSide: 'higher',
    winProbability: 0.5,
    lossProbability: 0.5,
    voidProbability: 0,
    winProbabilityGivenGrades: 0.5,
  });
  const higherProbability: SettlementResult = Object.freeze({
    eligibilityProbability: 1,
    line: 0.5,
    selectedSide: 'higher',
    winProbability: 0.5000000000005,
    lossProbability: 0.4999999999995,
    voidProbability: 0,
    winProbabilityGivenGrades: 0.5000000000005,
  });

  assert.ok(
    (higherProbability.winProbabilityGivenGrades ?? 0) -
      (lowerProbability.winProbabilityGivenGrades ?? 0) <
      1e-12,
  );
  assert.equal(
    compareSettlementResultsForRanking(higherProbability, lowerProbability),
    -1,
  );
  assert.equal(
    compareSettlementResultsForRanking(lowerProbability, higherProbability),
    1,
  );
});
