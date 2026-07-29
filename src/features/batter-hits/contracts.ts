import type { PredictionCandidate } from '../../domain/prediction-candidate.js';
import type {
  EligibilityProbability,
  ProbabilityMassFunction,
} from '../../domain/probability.js';
import type {
  JsonObject,
  SavedPredictionSnapshot,
} from '../../domain/saved-prediction.js';
import type { SelectedSide } from '../../domain/selected-side.js';
import type {
  GameScenarioSet,
  SharedScenarioReference,
  StarterRetentionState,
} from '../../game/index.js';
import {
  BATTER_HITS_FEATURE_DATA_FIELD,
  BATTER_HITS_MARKET_KEY,
} from './manifest.js';

export const SYNTHETIC_BATTER_HITS_SOURCE_KIND =
  'synthetic-test-only' as const;

export type SyntheticBatterHitsOfferType = 'baseline' | 'alternate';

export interface SyntheticBatterHitsOffer {
  readonly sourceKind: typeof SYNTHETIC_BATTER_HITS_SOURCE_KIND;
  readonly syntheticOfferId: string;
  readonly eventId: string;
  readonly gameId: string;
  readonly teamId: string;
  readonly playerId: string;
  readonly playerName: string;
  readonly baseMarketKey: typeof BATTER_HITS_MARKET_KEY;
  readonly line: number;
  readonly selectedSide: SelectedSide;
  readonly offerType: SyntheticBatterHitsOfferType;
  readonly sharedScenarioReference: SharedScenarioReference;
}

export interface SyntheticBatterHitsScenarioAssumption {
  readonly scenarioId: string;
  readonly offensiveEnvironmentId: string;
  /**
   * Optional only for the explicitly synthetic M7 path. When omitted, the
   * synthetic builder creates a test-only all-ones retention curve so existing
   * architecture fixtures keep their original behavior. A real model may not
   * omit starter retention.
   */
  readonly starterRetention?: StarterRetentionState;
  readonly perOpportunityHitProbabilities: readonly number[];
}

export interface SyntheticBatterHitsModelConfiguration {
  readonly sourceKind: typeof SYNTHETIC_BATTER_HITS_SOURCE_KIND;
  readonly modelVersion: string;
  readonly distributionBuilderVersion: string;
  readonly configurationVersion: string;
  readonly mathSpecVersion: string;
  readonly projectRulesVersion: string;
  readonly normalizedDataVersion: string;
  readonly settlementRegistryVersion: string;
  readonly settlementRuleVersion: string;
  readonly eligibilityProbability: EligibilityProbability;
  readonly scenarioAssumptions: readonly SyntheticBatterHitsScenarioAssumption[];
}

export interface SyntheticBatterHitsDistributionInput {
  readonly sourceKind: typeof SYNTHETIC_BATTER_HITS_SOURCE_KIND;
  readonly scenarioSet: GameScenarioSet;
  readonly sharedScenarioReference: SharedScenarioReference;
  readonly teamId: string;
  readonly playerId: string;
  readonly scenarioAssumptions: readonly SyntheticBatterHitsScenarioAssumption[];
}

export interface SyntheticBatterHitsScenarioDistribution {
  readonly scenarioId: string;
  readonly weight: number;
  readonly offensiveEnvironmentId: string;
  readonly starterRetentionVersion: string;
  readonly slotOpportunityCountDistribution: ProbabilityMassFunction;
  readonly opportunityCountDistribution: ProbabilityMassFunction;
  readonly perOpportunityHitProbabilities: readonly number[];
  readonly hitDistribution: ProbabilityMassFunction;
}

export interface SyntheticBatterHitsDistribution {
  readonly sourceKind: typeof SYNTHETIC_BATTER_HITS_SOURCE_KIND;
  readonly sharedScenarioReference: SharedScenarioReference;
  readonly teamId: string;
  readonly playerId: string;
  readonly opportunityDistribution: ProbabilityMassFunction;
  readonly statisticDistribution: ProbabilityMassFunction;
  readonly scenarios: readonly SyntheticBatterHitsScenarioDistribution[];
}

export interface SyntheticBatterHitsFeatureDetails extends JsonObject {
  readonly sourceKind: typeof SYNTHETIC_BATTER_HITS_SOURCE_KIND;
  readonly syntheticOfferId: string;
  readonly offerType: SyntheticBatterHitsOfferType;
  readonly teamId: string;
  readonly configurationVersion: string;
  readonly scenarioSetId: string;
  readonly scenarioWeights: readonly JsonObject[];
  readonly scenarioHitProbabilities: readonly JsonObject[];
}

export interface SyntheticBatterHitsFeatureValues extends JsonObject {
  readonly [BATTER_HITS_FEATURE_DATA_FIELD]: SyntheticBatterHitsFeatureDetails;
}

export type SyntheticBatterHitsCandidate = PredictionCandidate<
  SharedScenarioReference,
  SyntheticBatterHitsFeatureValues
>;

export interface SyntheticBatterHitsPredictionInput {
  readonly offer: SyntheticBatterHitsOffer;
  readonly scenarioSet: GameScenarioSet;
  readonly model: SyntheticBatterHitsModelConfiguration;
}

export interface SyntheticBatterHitsPredictionResult {
  readonly distribution: SyntheticBatterHitsDistribution;
  readonly candidate: SyntheticBatterHitsCandidate;
}

export interface SyntheticBatterHitsSavedPredictionInput
  extends SyntheticBatterHitsPredictionInput {
  readonly snapshotId: string;
  readonly savedAt: string;
}

export interface SyntheticBatterHitsSavedPredictionResult
  extends SyntheticBatterHitsPredictionResult {
  readonly savedPrediction: SavedPredictionSnapshot;
}
