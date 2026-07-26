import type {
  FeatureDataEnvelope,
  JsonObject,
} from './saved-prediction.js';
import type {
  EligibilityProbability,
  Probability,
  ProbabilityMassFunction,
} from './probability.js';
import type { SelectedSide } from './selected-side.js';

/**
 * Generic, side-aware candidate produced after a market feature builds the
 * official-statistic distribution and core settlement maps the posted offer.
 * The shared-scenario reference remains generic so the domain layer does not
 * depend on the game implementation layer.
 */
export interface PredictionCandidate<
  TSharedScenarioReference,
  TFeatureValues extends JsonObject = JsonObject,
> {
  readonly eventId: string;
  readonly gameId: string;
  readonly playerId: string;
  readonly playerName: string;
  readonly baseMarketKey: string;
  readonly marketLabel: string;
  readonly line: number;
  readonly selectedSide: SelectedSide;
  readonly settlementStatistic: string;
  readonly eligibilityProbability: EligibilityProbability;
  readonly statisticDistribution: ProbabilityMassFunction;
  readonly pWin: Probability;
  readonly pLoss: Probability;
  readonly pVoid: Probability;
  readonly pWinGivenGrades: Probability | null;
  readonly modelVersion: string;
  readonly distributionBuilderVersion: string;
  readonly settlementRuleVersion: string;
  readonly sharedScenarioReference: TSharedScenarioReference;
  readonly featureData: FeatureDataEnvelope & {
    readonly values: TFeatureValues;
  };
}
