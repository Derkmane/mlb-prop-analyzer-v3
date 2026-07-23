import assert from 'node:assert/strict';
import test from 'node:test';

import {
  buildBernoulliCountProbabilityMassFunction,
  convolveProbabilityMassFunctions,
  createProbabilityMassFunction,
  hitterSurvivalToCountProbabilityMassFunction,
  mixBernoulliOutcomesOverCountDistribution,
  mixProbabilityMassFunctions,
  poissonBinomialProbabilityMassFunction,
  validateProbabilityVector,
  validateUnitIntervalVector,
} from '../src/core/index.js';

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

function assertVectorClose(
  actual: readonly number[],
  expected: readonly number[],
  tolerance = 1e-12,
): void {
  assert.equal(actual.length, expected.length);
  for (const [index, expectedValue] of expected.entries()) {
    const actualValue = actual[index];
    assert.notEqual(actualValue, undefined);
    assertClose(actualValue ?? Number.NaN, expectedValue, tolerance);
  }
}

function bruteForcePoissonBinomial(
  probabilities: readonly number[],
): readonly number[] {
  const result = Array<number>(probabilities.length + 1).fill(0);
  const combinations = 2 ** probabilities.length;

  for (let mask = 0; mask < combinations; mask += 1) {
    let successes = 0;
    let mass = 1;

    for (const [index, probability] of probabilities.entries()) {
      const succeeded = (mask & (1 << index)) !== 0;
      if (succeeded) {
        successes += 1;
        mass *= probability;
      } else {
        mass *= 1 - probability;
      }
    }

    result[successes] = (result[successes] ?? 0) + mass;
  }

  return result;
}

test('probability validation rejects malformed mass and preserves valid vectors', () => {
  const valid = validateProbabilityVector([0.25, 0.75]);

  assert.deepEqual(valid, [0.25, 0.75]);
  assert.equal(Object.isFrozen(valid), true);
  assert.deepEqual(validateUnitIntervalVector([]), []);

  assert.throws(() => validateProbabilityVector([]), /must not be empty/);
  assert.throws(
    () => validateProbabilityVector([0.25, 0.5]),
    /must sum to 1/,
  );
  assert.throws(
    () => validateProbabilityVector([-0.1, 1.1]),
    /between 0 and 1/,
  );
  assert.throws(
    () => validateProbabilityVector([Number.NaN, Number.NaN]),
    /must be finite/,
  );
});

test('hitter survival converts to an exact opportunity-count distribution', () => {
  const survival = [0.99, 0.97, 0.9, 0.7, 0.25];
  const countDistribution =
    hitterSurvivalToCountProbabilityMassFunction(survival);

  assertVectorClose(countDistribution.probabilities, [
    0.01,
    0.02,
    0.07,
    0.2,
    0.45,
    0.25,
  ]);
  assertClose(
    countDistribution.probabilities.reduce((sum, mass) => sum + mass, 0),
    1,
  );
  assert.deepEqual(
    hitterSurvivalToCountProbabilityMassFunction([]).probabilities,
    [1],
  );
  assert.throws(
    () => hitterSurvivalToCountProbabilityMassFunction([0.8, 0.81]),
    /monotone non-increasing/,
  );
});

test('deterministic convolution conserves probability mass', () => {
  const result = convolveProbabilityMassFunctions(
    createProbabilityMassFunction([0.5, 0.5]),
    createProbabilityMassFunction([0.75, 0.25]),
  );

  assertVectorClose(result.probabilities, [0.375, 0.5, 0.125]);
});

test('Poisson-binomial dynamic programming matches brute-force enumeration', () => {
  const probabilities = [0.1, 0.25, 0.7, 0.9];
  const dynamicProgramming =
    poissonBinomialProbabilityMassFunction(probabilities);
  const bruteForce = bruteForcePoissonBinomial(probabilities);

  assertVectorClose(dynamicProgramming.probabilities, bruteForce, 1e-15);
  assert.deepEqual(
    poissonBinomialProbabilityMassFunction([]).probabilities,
    [1],
  );
  assertVectorClose(
    poissonBinomialProbabilityMassFunction([0, 1]).probabilities,
    [0, 1, 0],
  );
});

test('one guaranteed opportunity produces one exact Bernoulli distribution', () => {
  const result = buildBernoulliCountProbabilityMassFunction([1], [0.4]);

  assertVectorClose(result.probabilities, [0.6, 0.4]);
});

test('count mixing reproduces the canonical Batter Hits worked example', () => {
  const survival = [0.99, 0.97, 0.9, 0.7, 0.25];
  const hitProbabilities = [0.22, 0.24, 0.26, 0.25, 0.25];
  const hitDistribution = buildBernoulliCountProbabilityMassFunction(
    survival,
    hitProbabilities,
  );

  assertVectorClose(hitDistribution.probabilities, [
    0.36457045,
    0.4020445,
    0.1854103,
    0.0428786,
    0.00488165,
    0.0002145,
  ]);

  assertClose(1 - (hitDistribution.probabilities[0] ?? Number.NaN), 0.63542955);
  assertClose(
    hitDistribution.probabilities.slice(2).reduce((sum, mass) => sum + mass, 0),
    0.23338505,
  );
  assertClose(
    hitDistribution.probabilities.slice(3).reduce((sum, mass) => sum + mass, 0),
    0.04797475,
  );
});

test('count mixing requires one probability for every possible opportunity', () => {
  const countDistribution = createProbabilityMassFunction([0.1, 0.2, 0.7]);

  assert.throws(
    () =>
      mixBernoulliOutcomesOverCountDistribution(countDistribution, [0.25]),
    /one success probability is required/,
  );
});

test('scenario mixing matches manual weighted calculations and validates weights', () => {
  const mixed = mixProbabilityMassFunctions([
    {
      weight: 0.25,
      distribution: createProbabilityMassFunction([0.5, 0.5]),
    },
    {
      weight: 0.75,
      distribution: createProbabilityMassFunction([0.2, 0.3, 0.5]),
    },
  ]);
  const singleScenario = mixProbabilityMassFunctions([
    {
      weight: 1,
      distribution: createProbabilityMassFunction([0.4, 0.6]),
    },
  ]);

  assertVectorClose(mixed.probabilities, [0.275, 0.35, 0.375]);
  assert.deepEqual(singleScenario.probabilities, [0.4, 0.6]);
  assert.throws(
    () =>
      mixProbabilityMassFunctions([
        {
          weight: 0.4,
          distribution: createProbabilityMassFunction([1]),
        },
        {
          weight: 0.5,
          distribution: createProbabilityMassFunction([1]),
        },
      ]),
    /scenario weights must sum to 1/,
  );
  assert.throws(() => mixProbabilityMassFunctions([]), /at least one scenario/);
});

test('identical inputs produce byte-for-byte identical deterministic distributions', () => {
  const survival = Object.freeze([0.95, 0.8, 0.5]);
  const outcomes = Object.freeze([0.2, 0.3, 0.4]);
  const first = buildBernoulliCountProbabilityMassFunction(survival, outcomes);
  const second = buildBernoulliCountProbabilityMassFunction(survival, outcomes);

  assert.deepEqual(first, second);
  assert.deepEqual(survival, [0.95, 0.8, 0.5]);
  assert.deepEqual(outcomes, [0.2, 0.3, 0.4]);
});
