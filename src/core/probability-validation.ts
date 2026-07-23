import type {
  Probability,
  ProbabilityMassFunction,
} from '../domain/probability.js';

export const PROBABILITY_TOLERANCE = 1e-12;

export function validateProbability(
  value: number,
  label = 'probability',
): Probability {
  if (!Number.isFinite(value)) {
    throw new RangeError(`${label} must be finite`);
  }

  if (value < 0 || value > 1) {
    throw new RangeError(`${label} must be between 0 and 1 inclusive`);
  }

  return value;
}

export function validateUnitIntervalVector(
  values: readonly number[],
  label = 'probability vector',
): readonly Probability[] {
  const validated = values.map((value, index) =>
    validateProbability(value, `${label}[${index}]`),
  );

  return Object.freeze(validated);
}

export function validateProbabilityVector(
  values: readonly number[],
  label = 'probability vector',
): readonly Probability[] {
  if (values.length === 0) {
    throw new RangeError(`${label} must not be empty`);
  }

  const validated = validateUnitIntervalVector(values, label);
  const total = validated.reduce((sum, value) => sum + value, 0);

  if (Math.abs(total - 1) > PROBABILITY_TOLERANCE) {
    throw new RangeError(`${label} must sum to 1; received ${total}`);
  }

  return validated;
}

export function createProbabilityMassFunction(
  probabilities: readonly number[],
  label = 'probability mass function',
): ProbabilityMassFunction {
  return Object.freeze({
    probabilities: validateProbabilityVector(probabilities, label),
  });
}

export function validateProbabilityMassFunction(
  distribution: ProbabilityMassFunction,
  label = 'probability mass function',
): ProbabilityMassFunction {
  return createProbabilityMassFunction(distribution.probabilities, label);
}
