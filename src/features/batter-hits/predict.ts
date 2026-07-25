import { settleDiscreteStatistic } from '../../core/index.js';
import {
  createSavedPredictionSnapshot,
  type JsonObject,
  type SavedPredictionSnapshot,
} from '../../domain/saved-prediction.js';
import {
  assertSharedScenarioReference,
  createSharedScenarioReference,
} from '../../game/index.js';
import type {
  SyntheticBatterHitsCandidate,
  SyntheticBatterHitsDistribution,
  SyntheticBatterHitsFeatureDetails,
  SyntheticBatterHitsFeatureValues,
  SyntheticBatterHitsModelConfiguration,
  SyntheticBatterHitsOffer,
  SyntheticBatterHitsPredictionInput,
  SyntheticBatterHitsPredictionResult,
  SyntheticBatterHitsSavedPredictionInput,
  SyntheticBatterHitsSavedPredictionResult,
} from './contracts.js';
import { SYNTHETIC_BATTER_HITS_SOURCE_KIND } from './contracts.js';
import { buildSyntheticBatterHitsDistribution } from './distribution.js';
import {
  BATTER_HITS_FEATURE_DATA_FIELD,
  BATTER_HITS_FEATURE_ID,
  BATTER_HITS_MARKET_KEY,
} from './manifest.js';

function assertNonEmpty(value: string, label: string): void {
  if (value.trim().length === 0) {
    throw new RangeError(`${label} must not be empty`);
  }
}

function assertSyntheticSourceKind(value: unknown): void {
  if (value !== SYNTHETIC_BATTER_HITS_SOURCE_KIND) {
    throw new RangeError(
      'Batter Hits M7 input must be explicitly marked synthetic-test-only',
    );
  }
}

function validateModelVersions(
  model: SyntheticBatterHitsModelConfiguration,
): void {
  assertSyntheticSourceKind(model.sourceKind);
  assertNonEmpty(model.modelVersion, 'synthetic modelVersion');
  assertNonEmpty(
    model.distributionBuilderVersion,
    'synthetic distributionBuilderVersion',
  );
  assertNonEmpty(model.configurationVersion, 'synthetic configurationVersion');
  assertNonEmpty(model.mathSpecVersion, 'synthetic mathSpecVersion');
  assertNonEmpty(model.projectRulesVersion, 'synthetic projectRulesVersion');
  assertNonEmpty(model.normalizedDataVersion, 'synthetic normalizedDataVersion');
  assertNonEmpty(
    model.settlementRegistryVersion,
    'synthetic settlementRegistryVersion',
  );
  assertNonEmpty(
    model.settlementRuleVersion,
    'synthetic settlementRuleVersion',
  );
}

function assertOfferMatchesDistribution(
  offer: SyntheticBatterHitsOffer,
  distribution: SyntheticBatterHitsDistribution,
): void {
  assertSyntheticSourceKind(offer.sourceKind);
  assertNonEmpty(offer.syntheticOfferId, 'synthetic offerId');
  assertNonEmpty(offer.eventId, 'synthetic eventId');
  assertNonEmpty(offer.gameId, 'synthetic gameId');
  assertNonEmpty(offer.teamId, 'synthetic teamId');
  assertNonEmpty(offer.playerId, 'synthetic playerId');
  assertNonEmpty(offer.playerName, 'synthetic playerName');

  if (offer.baseMarketKey !== BATTER_HITS_MARKET_KEY) {
    throw new RangeError('synthetic offer must use the Batter Hits base market');
  }
  if (
    offer.gameId !== distribution.sharedScenarioReference.gameId ||
    offer.teamId !== distribution.teamId ||
    offer.playerId !== distribution.playerId
  ) {
    throw new RangeError(
      'synthetic offer identity must match the shared Batter Hits distribution',
    );
  }
  if (
    offer.sharedScenarioReference.scenarioSetId !==
      distribution.sharedScenarioReference.scenarioSetId ||
    offer.sharedScenarioReference.scenarioSetVersion !==
      distribution.sharedScenarioReference.scenarioSetVersion ||
    offer.sharedScenarioReference.gameId !==
      distribution.sharedScenarioReference.gameId
  ) {
    throw new RangeError(
      'synthetic offer must reference the exact shared Batter Hits scenario set',
    );
  }
}

function createFeatureValues(
  offer: SyntheticBatterHitsOffer,
  model: SyntheticBatterHitsModelConfiguration,
  distribution: SyntheticBatterHitsDistribution,
): SyntheticBatterHitsFeatureValues {
  const details: SyntheticBatterHitsFeatureDetails = Object.freeze({
    sourceKind: SYNTHETIC_BATTER_HITS_SOURCE_KIND,
    syntheticOfferId: offer.syntheticOfferId,
    offerType: offer.offerType,
    teamId: offer.teamId,
    configurationVersion: model.configurationVersion,
    scenarioSetId: distribution.sharedScenarioReference.scenarioSetId,
    scenarioWeights: Object.freeze(
      distribution.scenarios.map(
        (scenario) =>
          Object.freeze({
            scenarioId: scenario.scenarioId,
            weight: scenario.weight,
          }) satisfies JsonObject,
      ),
    ),
    scenarioHitProbabilities: Object.freeze(
      distribution.scenarios.map(
        (scenario) =>
          Object.freeze({
            scenarioId: scenario.scenarioId,
            offensiveEnvironmentId: scenario.offensiveEnvironmentId,
            probabilities: Object.freeze([
              ...scenario.perOpportunityHitProbabilities,
            ]),
          }) satisfies JsonObject,
      ),
    ),
  });

  return Object.freeze({
    [BATTER_HITS_FEATURE_DATA_FIELD]: details,
  }) as SyntheticBatterHitsFeatureValues;
}

export function createSyntheticBatterHitsCandidate(
  offer: SyntheticBatterHitsOffer,
  model: SyntheticBatterHitsModelConfiguration,
  distribution: SyntheticBatterHitsDistribution,
): SyntheticBatterHitsCandidate {
  validateModelVersions(model);
  assertOfferMatchesDistribution(offer, distribution);

  const settlement = settleDiscreteStatistic({
    statisticDistribution: distribution.statisticDistribution,
    eligibilityProbability: model.eligibilityProbability,
    line: offer.line,
    selectedSide: offer.selectedSide,
  });
  const featureValues = createFeatureValues(offer, model, distribution);

  return Object.freeze({
    eventId: offer.eventId,
    gameId: offer.gameId,
    playerId: offer.playerId,
    playerName: offer.playerName,
    baseMarketKey: offer.baseMarketKey,
    marketLabel: 'Batter Hits',
    line: settlement.line,
    selectedSide: settlement.selectedSide,
    settlementStatistic: 'hits',
    eligibilityProbability: settlement.eligibilityProbability,
    statisticDistribution: distribution.statisticDistribution,
    pWin: settlement.winProbability,
    pLoss: settlement.lossProbability,
    pVoid: settlement.voidProbability,
    pWinGivenGrades: settlement.winProbabilityGivenGrades,
    modelVersion: model.modelVersion,
    distributionBuilderVersion: model.distributionBuilderVersion,
    settlementRuleVersion: model.settlementRuleVersion,
    sharedScenarioReference: distribution.sharedScenarioReference,
    featureData: Object.freeze({
      featureId: BATTER_HITS_FEATURE_ID,
      schemaVersion: 1,
      values: featureValues,
    }),
  });
}

export function predictSyntheticBatterHits(
  input: SyntheticBatterHitsPredictionInput,
): SyntheticBatterHitsPredictionResult {
  validateModelVersions(input.model);
  assertSyntheticSourceKind(input.offer.sourceKind);
  assertSharedScenarioReference(
    input.scenarioSet,
    input.offer.sharedScenarioReference,
  );
  if (input.offer.gameId !== input.scenarioSet.gameId) {
    throw new RangeError('synthetic offer gameId must match GameScenarioSet');
  }

  const distribution = buildSyntheticBatterHitsDistribution({
    sourceKind: SYNTHETIC_BATTER_HITS_SOURCE_KIND,
    scenarioSet: input.scenarioSet,
    sharedScenarioReference: input.offer.sharedScenarioReference,
    teamId: input.offer.teamId,
    playerId: input.offer.playerId,
    scenarioAssumptions: input.model.scenarioAssumptions,
  });
  const candidate = createSyntheticBatterHitsCandidate(
    input.offer,
    input.model,
    distribution,
  );

  return Object.freeze({ distribution, candidate });
}

export function createSyntheticBatterHitsSavedPrediction(
  input: SyntheticBatterHitsSavedPredictionInput,
): SyntheticBatterHitsSavedPredictionResult {
  assertNonEmpty(input.snapshotId, 'synthetic snapshotId');
  assertNonEmpty(input.savedAt, 'synthetic savedAt');
  const prediction = predictSyntheticBatterHits(input);
  const sharedScenarioReference = createSharedScenarioReference(
    input.scenarioSet,
  );
  const savedPrediction: SavedPredictionSnapshot =
    createSavedPredictionSnapshot({
      snapshotId: input.snapshotId,
      savedAt: input.savedAt,
      eventId: prediction.candidate.eventId,
      gameId: prediction.candidate.gameId,
      playerId: prediction.candidate.playerId,
      playerName: prediction.candidate.playerName,
      baseMarketKey: prediction.candidate.baseMarketKey,
      marketLabel: prediction.candidate.marketLabel,
      line: prediction.candidate.line,
      selectedSide: prediction.candidate.selectedSide,
      settlementStatistic: prediction.candidate.settlementStatistic,
      eligibilityProbability: prediction.candidate.eligibilityProbability,
      pWin: prediction.candidate.pWin,
      pLoss: prediction.candidate.pLoss,
      pVoid: prediction.candidate.pVoid,
      pWinGivenGrades: prediction.candidate.pWinGivenGrades,
      modelVersion: prediction.candidate.modelVersion,
      mathSpecVersion: input.model.mathSpecVersion,
      projectRulesVersion: input.model.projectRulesVersion,
      normalizedDataVersion: input.model.normalizedDataVersion,
      configurationVersion: input.model.configurationVersion,
      settlementRegistryVersion: input.model.settlementRegistryVersion,
      settlementRuleVersion: prediction.candidate.settlementRuleVersion,
      modelArtifactVersions: Object.freeze({
        syntheticBatterHitsModel: input.model.modelVersion,
        syntheticBatterHitsDistribution:
          input.model.distributionBuilderVersion,
      }),
      providerSnapshots: Object.freeze([]),
      scenarioWeights: Object.freeze(
        prediction.distribution.scenarios.map((scenario) =>
          Object.freeze({
            scenarioId: scenario.scenarioId,
            weight: scenario.weight,
          }),
        ),
      ),
      opportunityDistribution:
        prediction.distribution.opportunityDistribution,
      statisticDistribution: prediction.distribution.statisticDistribution,
      featureData: prediction.candidate.featureData,
    });

  if (
    sharedScenarioReference.scenarioSetId !==
      prediction.candidate.sharedScenarioReference.scenarioSetId ||
    sharedScenarioReference.scenarioSetVersion !==
      prediction.candidate.sharedScenarioReference.scenarioSetVersion ||
    sharedScenarioReference.gameId !==
      prediction.candidate.sharedScenarioReference.gameId
  ) {
    throw new RangeError(
      'saved prediction must preserve the exact shared scenario reference',
    );
  }

  return Object.freeze({
    distribution: prediction.distribution,
    candidate: prediction.candidate,
    savedPrediction,
  });
}
