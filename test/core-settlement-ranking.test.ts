import assert from 'node:assert/strict';
import test from 'node:test';

import {
  buildBernoulliCountProbabilityMassFunction,
  compareSettlementResultsForRanking,
  createProbabilityMassFunction,
  settleDiscreteStatistic,
} from '../src/core/index.js';
import type { SettlementResult } from '../src/domain/settlement.js';

function assertClose(
  actual: number,
  expected: number,
  tolerance = 1e-12,
): void {
  assert.ok(
    Math.abs(actual - expected) <= tolerance,
    `expected ${actual} to be within ${tolerance} of ${expected}`,
  );
}

function assertSettlementInvariant(result: SettlementResult): void {
  assertClose(
    result.winProbability +
      result.lossProbability +
      result.voidProbability,
    1,
  );
}

test('Higher and Lower exchange win/loss mass while preserving tie and void mass', () => {
  const distribution = createProbabilityMassFunction([0.2, 0.3, 0.5]);
  const higher = settleDiscreteStatistic({
    statisticDistribution: distribution,
    eligibilityProbability: 0.8,
    line: 1,
    selectedSide: 'higher',
  });
  const lower = settleDiscreteStatistic({
    statisticDistribution: distribution,
    eligibilityProbability: 0.8,
    line: 1,
    selectedSide: 'lower',
  });

  assertClose(higher.winProbability, 0.4);
  assertClose(higher.lossProbability, 0.16);
  assertClose(higher.voidProbability, 0.44);
  assertClose(lower.winProbability, higher.lossProbability);
  assertClose(lower.lossProbability, higher.winProbability);
  assertClose(lower.voidProbability, higher.voidProbability);
  assertSettlementInvariant(higher);
  assertSettlementInvariant(lower);
});

test('half-point lines have no tie mass for integer-valued statistics', () => {
  const higher = settleDiscreteStatistic({
    statisticDistribution: createProbabilityMassFunction([0.2, 0.3, 0.5]),
    eligibilityProbability: 0.8,
    line: 0.5,
    selectedSide: 'higher',
  });

  assertClose(higher.winProbability, 0.64);
  assertClose(higher.lossProbability, 0.16);
  assertClose(higher.voidProbability, 0.2);
  assertClose(higher.winProbabilityGivenGrades ?? Number.NaN, 0.8);
  assertSettlementInvariant(higher);
});

test('fully void outcomes remain unrankable instead of producing NaN', () => {
  const ineligible = settleDiscreteStatistic({
    statisticDistribution: createProbabilityMassFunction([0.4, 0.6]),
    eligibilityProbability: 0,
    line: 0.5,
    selectedSide: 'higher',
  });
  const allTie = settleDiscreteStatistic({
    statisticDistribution: createProbabilityMassFunction([0, 1]),
    eligibilityProbability: 1,
    line: 1,
    selectedSide: 'higher',
  });

  assert.deepEqual(
    [
      ineligible.winProbability,
      ineligible.lossProbability,
      ineligible.voidProbability,
      ineligible.winProbabilityGivenGrades,
    ],
    [0, 0, 1, null],
  );
  assert.deepEqual(
    [
      allTie.winProbability,
      allTie.lossProbability,
      allTie.voidProbability,
      allTie.winProbabilityGivenGrades,
    ],
    [0, 0, 1, null],
  );
  assert.throws(
    () => compareSettlementResultsForRanking(ineligible, allTie),
    /not rankable/,
  );
});

test('the canonical worked example produces the verified settlement values', () => {
  const hitDistribution = buildBernoulliCountProbabilityMassFunction(
    [0.99, 0.97, 0.9, 0.7, 0.25],
    [0.22, 0.24, 0.26, 0.25, 0.25],
  );
  const result = settleDiscreteStatistic({
    statisticDistribution: hitDistribution,
    eligibilityProbability: 0.97,
    line: 0.5,
    selectedSide: 'higher',
  });

  assertClose(result.winProbability, 0.6163666635);
  assertClose(result.lossProbability, 0.3536333365);
  assertClose(result.voidProbability, 0.03);
  assertClose(result.winProbabilityGivenGrades ?? Number.NaN, 0.63542955);
  assertSettlementInvariant(result);
});

test('Higher decreases and Lower increases as the line rises', () => {
  const distribution = buildBernoulliCountProbabilityMassFunction(
    [0.99, 0.97, 0.9, 0.7, 0.25],
    [0.22, 0.24, 0.26, 0.25, 0.25],
  );
  const higher = [0.5, 1.5, 2.5].map((line) =>
    settleDiscreteStatistic({
      statisticDistribution: distribution,
      eligibilityProbability: 1,
      line,
      selectedSide: 'higher',
    }),
  );
  const lower = [0.5, 1.5, 2.5].map((line) =>
    settleDiscreteStatistic({
      statisticDistribution: distribution,
      eligibilityProbability: 1,
      line,
      selectedSide: 'lower',
    }),
  );

  assert.ok(higher[0] !== undefined && higher[1] !== undefined);
  assert.ok(higher[1] !== undefined && higher[2] !== undefined);
  assert.ok(lower[0] !== undefined && lower[1] !== undefined);
  assert.ok(lower[1] !== undefined && lower[2] !== undefined);
  assert.ok(higher[0].winProbability > higher[1].winProbability);
  assert.ok(higher[1].winProbability > higher[2].winProbability);
  assert.ok(lower[0].winProbability < lower[1].winProbability);
  assert.ok(lower[1].winProbability < lower[2].winProbability);
});

test('an upward distribution shift helps Higher and hurts Lower', () => {
  const downwardDistribution = createProbabilityMassFunction([0.6, 0.3, 0.1]);
  const upwardDistribution = createProbabilityMassFunction([0.1, 0.3, 0.6]);
  const settle = (
    distribution: ReturnType<typeof createProbabilityMassFunction>,
    selectedSide: 'higher' | 'lower',
  ) =>
    settleDiscreteStatistic({
      statisticDistribution: distribution,
      eligibilityProbability: 1,
      line: 0.5,
      selectedSide,
    });

  const higherDown = settle(downwardDistribution, 'higher');
  const higherUp = settle(upwardDistribution, 'higher');
  const lowerDown = settle(downwardDistribution, 'lower');
  const lowerUp = settle(upwardDistribution, 'lower');

  assert.ok(higherUp.winProbability > higherDown.winProbability);
  assert.ok(lowerUp.winProbability < lowerDown.winProbability);
});

test('ranking uses only P(Win | grades), then P(Void)', () => {
  const strongerConditional = settleDiscreteStatistic({
    statisticDistribution: createProbabilityMassFunction([0.2, 0.8]),
    eligibilityProbability: 0.8,
    line: 0.5,
    selectedSide: 'higher',
  });
  const weakerConditional = settleDiscreteStatistic({
    statisticDistribution: createProbabilityMassFunction([0.4, 0.6]),
    eligibilityProbability: 1,
    line: 0.5,
    selectedSide: 'higher',
  });
  const equalConditionalHigherVoid = settleDiscreteStatistic({
    statisticDistribution: createProbabilityMassFunction([0.25, 0.75]),
    eligibilityProbability: 0.8,
    line: 0.5,
    selectedSide: 'higher',
  });
  const equalConditionalLowerVoid = settleDiscreteStatistic({
    statisticDistribution: createProbabilityMassFunction([0.25, 0.75]),
    eligibilityProbability: 0.9,
    line: 0.5,
    selectedSide: 'higher',
  });

  assert.equal(
    compareSettlementResultsForRanking(
      strongerConditional,
      weakerConditional,
    ),
    -1,
  );
  assert.equal(
    compareSettlementResultsForRanking(
      equalConditionalLowerVoid,
      equalConditionalHigherVoid,
    ),
    -1,
  );
  assert.equal(
    compareSettlementResultsForRanking(
      equalConditionalLowerVoid,
      equalConditionalLowerVoid,
    ),
    0,
  );
});

test('invalid settlement inputs fail closed', () => {
  const distribution = createProbabilityMassFunction([0.5, 0.5]);

  assert.throws(
    () =>
      settleDiscreteStatistic({
        statisticDistribution: distribution,
        eligibilityProbability: 1.01,
        line: 0.5,
        selectedSide: 'higher',
      }),
    /eligibility probability must be between 0 and 1/,
  );
  assert.throws(
    () =>
      settleDiscreteStatistic({
        statisticDistribution: distribution,
        eligibilityProbability: 1,
        line: Number.NaN,
        selectedSide: 'higher',
      }),
    /line must be finite/,
  );
  assert.throws(
    () =>
      settleDiscreteStatistic({
        statisticDistribution: distribution,
        eligibilityProbability: 1,
        line: 0.5,
        selectedSide: 'over' as never,
      }),
    /selected side must be higher or lower/,
  );
});

test('identical settlement inputs produce identical deterministic results', () => {
  const input = Object.freeze({
    statisticDistribution: createProbabilityMassFunction([0.3, 0.7]),
    eligibilityProbability: 0.92,
    line: 0.5,
    selectedSide: 'lower' as const,
  });

  const first = settleDiscreteStatistic(input);
  const second = settleDiscreteStatistic(input);

  assert.deepEqual(first, second);
});
