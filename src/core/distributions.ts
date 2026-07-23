import type {
  ProbabilityMassFunction,
  WeightedProbabilityMassFunction,
} from '../domain/probability.js';
import {
  createProbabilityMassFunction,
  validateProbabilityMassFunction,
  validateProbabilityVector,
  validateUnitIntervalVector,
} from './probability-validation.js';

export function convolveProbabilityMassFunctions(
  left: ProbabilityMassFunction,
  right: ProbabilityMassFunction,
): ProbabilityMassFunction {
  const validatedLeft = validateProbabilityMassFunction(left, 'left distribution');
  const validatedRight = validateProbabilityMassFunction(
    right,
    'right distribution',
  );
  const result = Array<number>(
    validatedLeft.probabilities.length +
      validatedRight.probabilities.length -
      1,
  ).fill(0);

  for (const [leftValue, leftMass] of validatedLeft.probabilities.entries()) {
    for (const [rightValue, rightMass] of validatedRight.probabilities.entries()) {
      const resultValue = leftValue + rightValue;
      result[resultValue] =
        (result[resultValue] ?? 0) + leftMass * rightMass;
    }
  }

  return createProbabilityMassFunction(result, 'convolved distribution');
}

export function poissonBinomialProbabilityMassFunction(
  successProbabilities: readonly number[],
): ProbabilityMassFunction {
  const probabilities = validateUnitIntervalVector(
    successProbabilities,
    'Bernoulli success probabilities',
  );
  let distribution = [1];

  for (const successProbability of probabilities) {
    const next = Array<number>(distribution.length + 1).fill(0);

    for (const [successes, mass] of distribution.entries()) {
      next[successes] =
        (next[successes] ?? 0) + mass * (1 - successProbability);
      next[successes + 1] =
        (next[successes + 1] ?? 0) + mass * successProbability;
    }

    distribution = next;
  }

  return createProbabilityMassFunction(
    distribution,
    'Poisson-binomial distribution',
  );
}

export function hitterSurvivalToCountProbabilityMassFunction(
  survivalProbabilities: readonly number[],
): ProbabilityMassFunction {
  const survival = validateUnitIntervalVector(
    survivalProbabilities,
    'hitter survival probabilities',
  );

  if (survival.length === 0) {
    return createProbabilityMassFunction([1], 'hitter opportunity count');
  }

  for (let index = 0; index < survival.length - 1; index += 1) {
    const current = survival[index];
    const next = survival[index + 1];

    if (current === undefined || next === undefined) {
      throw new Error('internal survival-vector indexing failure');
    }

    if (current < next) {
      throw new RangeError(
        'hitter survival probabilities must be monotone non-increasing',
      );
    }
  }

  const first = survival[0];
  if (first === undefined) {
    throw new Error('internal survival-vector indexing failure');
  }

  const countProbabilities = [1 - first];

  for (let count = 1; count < survival.length; count += 1) {
    const current = survival[count - 1];
    const next = survival[count];

    if (current === undefined || next === undefined) {
      throw new Error('internal survival-vector indexing failure');
    }

    countProbabilities.push(current - next);
  }

  const finalSurvival = survival.at(-1);
  if (finalSurvival === undefined) {
    throw new Error('internal survival-vector indexing failure');
  }
  countProbabilities.push(finalSurvival);

  return createProbabilityMassFunction(
    countProbabilities,
    'hitter opportunity count',
  );
}

export function mixBernoulliOutcomesOverCountDistribution(
  opportunityCountDistribution: ProbabilityMassFunction,
  opportunitySuccessProbabilities: readonly number[],
): ProbabilityMassFunction {
  const countDistribution = validateProbabilityMassFunction(
    opportunityCountDistribution,
    'opportunity count distribution',
  );
  const successProbabilities = validateUnitIntervalVector(
    opportunitySuccessProbabilities,
    'opportunity success probabilities',
  );
  const maximumOpportunityCount = countDistribution.probabilities.length - 1;

  if (successProbabilities.length < maximumOpportunityCount) {
    throw new RangeError(
      'one success probability is required for every possible opportunity',
    );
  }

  const mixed = Array<number>(maximumOpportunityCount + 1).fill(0);

  for (const [opportunityCount, countMass] of countDistribution.probabilities.entries()) {
    const conditional = poissonBinomialProbabilityMassFunction(
      successProbabilities.slice(0, opportunityCount),
    );

    for (const [successCount, conditionalMass] of conditional.probabilities.entries()) {
      mixed[successCount] =
        (mixed[successCount] ?? 0) + countMass * conditionalMass;
    }
  }

  return createProbabilityMassFunction(
    mixed,
    'count-mixture Bernoulli distribution',
  );
}

export function buildBernoulliCountProbabilityMassFunction(
  survivalProbabilities: readonly number[],
  opportunitySuccessProbabilities: readonly number[],
): ProbabilityMassFunction {
  return mixBernoulliOutcomesOverCountDistribution(
    hitterSurvivalToCountProbabilityMassFunction(survivalProbabilities),
    opportunitySuccessProbabilities,
  );
}

export function mixProbabilityMassFunctions(
  scenarios: readonly WeightedProbabilityMassFunction[],
): ProbabilityMassFunction {
  if (scenarios.length === 0) {
    throw new RangeError('at least one scenario is required');
  }

  const weights = validateProbabilityVector(
    scenarios.map((scenario) => scenario.weight),
    'scenario weights',
  );
  const distributions = scenarios.map((scenario, index) =>
    validateProbabilityMassFunction(
      scenario.distribution,
      `scenario distribution[${index}]`,
    ),
  );
  const resultLength = Math.max(
    ...distributions.map((distribution) => distribution.probabilities.length),
  );
  const mixed = Array<number>(resultLength).fill(0);

  for (const [scenarioIndex, distribution] of distributions.entries()) {
    const weight = weights[scenarioIndex];
    if (weight === undefined) {
      throw new Error('internal scenario-weight indexing failure');
    }

    for (const [value, mass] of distribution.probabilities.entries()) {
      mixed[value] = (mixed[value] ?? 0) + weight * mass;
    }
  }

  return createProbabilityMassFunction(mixed, 'scenario mixture');
}
