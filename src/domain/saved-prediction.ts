import type { ProbabilityMassFunction } from './probability.js';
import type { SelectedSide } from './selected-side.js';

export type JsonPrimitive = string | number | boolean | null;

export interface JsonArray extends ReadonlyArray<JsonValue> {}

export interface JsonObject {
  readonly [key: string]: JsonValue;
}

export type JsonValue = JsonPrimitive | JsonArray | JsonObject;

export interface FeatureDataEnvelope {
  readonly featureId: string;
  readonly schemaVersion: number;
  readonly values: JsonObject;
}

export interface ProviderSnapshotReference {
  readonly provider: string;
  readonly snapshotId: string;
  readonly sha256: string;
}

export interface ScenarioWeightSnapshot {
  readonly scenarioId: string;
  readonly weight: number;
}

export interface SavedPredictionSnapshot {
  readonly snapshotId: string;
  readonly savedAt: string;
  readonly eventId: string;
  readonly gameId: string;
  readonly playerId: string;
  readonly playerName: string;
  readonly baseMarketKey: string;
  readonly marketLabel: string;
  readonly line: number;
  readonly selectedSide: SelectedSide;
  readonly settlementStatistic: string;
  readonly eligibilityProbability: number;
  readonly pWin: number;
  readonly pLoss: number;
  readonly pVoid: number;
  readonly pWinGivenGrades: number | null;
  readonly modelVersion: string;
  readonly mathSpecVersion: string;
  readonly projectRulesVersion: string;
  readonly normalizedDataVersion: string;
  readonly configurationVersion: string;
  readonly settlementRegistryVersion: string;
  readonly settlementRuleVersion: string;
  readonly modelArtifactVersions: Readonly<Record<string, string>>;
  readonly providerSnapshots: readonly ProviderSnapshotReference[];
  readonly scenarioWeights: readonly ScenarioWeightSnapshot[];
  readonly opportunityDistribution: ProbabilityMassFunction;
  readonly statisticDistribution: ProbabilityMassFunction;
  readonly featureData: FeatureDataEnvelope;
}

function cloneJsonValue(value: JsonValue): JsonValue {
  if (Array.isArray(value)) {
    return Object.freeze(value.map((item) => cloneJsonValue(item)));
  }

  if (value !== null && typeof value === 'object') {
    const clone: Record<string, JsonValue> = {};
    for (const [key, item] of Object.entries(value)) {
      clone[key] = cloneJsonValue(item);
    }
    return Object.freeze(clone);
  }

  if (typeof value === 'number' && !Number.isFinite(value)) {
    throw new RangeError('saved prediction JSON values must contain only finite numbers');
  }

  return value;
}

function cloneDistribution(
  distribution: ProbabilityMassFunction,
): ProbabilityMassFunction {
  return Object.freeze({
    probabilities: Object.freeze([...distribution.probabilities]),
  });
}

export function createSavedPredictionSnapshot(
  input: SavedPredictionSnapshot,
): SavedPredictionSnapshot {
  return Object.freeze({
    ...input,
    modelArtifactVersions: Object.freeze({ ...input.modelArtifactVersions }),
    providerSnapshots: Object.freeze(
      input.providerSnapshots.map((reference) => Object.freeze({ ...reference })),
    ),
    scenarioWeights: Object.freeze(
      input.scenarioWeights.map((scenario) => Object.freeze({ ...scenario })),
    ),
    opportunityDistribution: cloneDistribution(input.opportunityDistribution),
    statisticDistribution: cloneDistribution(input.statisticDistribution),
    featureData: Object.freeze({
      featureId: input.featureData.featureId,
      schemaVersion: input.featureData.schemaVersion,
      values: cloneJsonValue(input.featureData.values) as JsonObject,
    }),
  });
}
