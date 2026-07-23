import type {
  EligibilityProbability,
  Probability,
  ProbabilityMassFunction,
} from './probability.js';
import type { SelectedSide } from './selected-side.js';

export interface WinLossVoid {
  readonly winProbability: Probability;
  readonly lossProbability: Probability;
  readonly voidProbability: Probability;
}

export interface SettlementInput {
  readonly statisticDistribution: ProbabilityMassFunction;
  readonly eligibilityProbability: EligibilityProbability;
  readonly line: number;
  readonly selectedSide: SelectedSide;
}

export interface SettlementResult extends WinLossVoid {
  readonly eligibilityProbability: EligibilityProbability;
  readonly line: number;
  readonly selectedSide: SelectedSide;
  readonly winProbabilityGivenGrades: Probability | null;
}
