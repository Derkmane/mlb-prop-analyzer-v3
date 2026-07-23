export type Probability = number;

export type EligibilityProbability = Probability;

/**
 * A probability mass function for a non-negative integer-valued statistic.
 * Array index is the statistic value and array value is its probability mass.
 */
export interface ProbabilityMassFunction {
  readonly probabilities: readonly Probability[];
}

export interface WeightedProbabilityMassFunction {
  readonly weight: Probability;
  readonly distribution: ProbabilityMassFunction;
}
