import assert from 'node:assert/strict';
import test from 'node:test';

import {
  createSavedPredictionSnapshot,
  type JsonValue,
  type ProviderSnapshotReference,
  type ScenarioWeightSnapshot,
} from '../src/domain/saved-prediction.js';
import { renderHistoricalPrediction } from '../src/historical/index.js';

test('an immutable saved prediction renders after its feature implementation is absent', () => {
  const modelArtifactVersions: Record<string, string> = {
    syntheticModel: 'synthetic-artifact-v1',
  };
  const providerSnapshots: ProviderSnapshotReference[] = [
    {
      provider: 'synthetic-provider',
      snapshotId: 'synthetic-provider-snapshot-1',
      sha256: 'a'.repeat(64),
    },
  ];
  const scenarioWeights: ScenarioWeightSnapshot[] = [
    { scenarioId: 'synthetic-scenario-1', weight: 1 },
  ];
  const opportunityProbabilities = [0, 1];
  const statisticProbabilities = [0.36, 0.64];
  const featureValues: Record<string, JsonValue> = {
    deletedFeatureOnlyValue: 'still preserved',
    nested: { value: 7 },
  };

  const snapshot = createSavedPredictionSnapshot({
    snapshotId: 'synthetic-snapshot-1',
    savedAt: '2026-07-23T00:00:00.000Z',
    eventId: 'synthetic-event-1',
    gameId: 'synthetic-game-1',
    playerId: 'synthetic-player-1',
    playerName: 'Synthetic Player',
    baseMarketKey: 'removed-synthetic-market',
    marketLabel: 'Removed Synthetic Market',
    line: 0.5,
    selectedSide: 'higher',
    settlementStatistic: 'synthetic_statistic',
    eligibilityProbability: 0.97,
    pWin: 0.61,
    pLoss: 0.36,
    pVoid: 0.03,
    pWinGivenGrades: 0.6288659793814433,
    modelVersion: 'synthetic-model-v1',
    mathSpecVersion: '1.4',
    projectRulesVersion: '2.0',
    normalizedDataVersion: 'synthetic-normalized-v1',
    configurationVersion: 'synthetic-config-v1',
    settlementRegistryVersion: 'synthetic-settlement-registry-v1',
    settlementRuleVersion: 'synthetic-rule-v1',
    modelArtifactVersions,
    providerSnapshots,
    scenarioWeights,
    opportunityDistribution: { probabilities: opportunityProbabilities },
    statisticDistribution: { probabilities: statisticProbabilities },
    featureData: {
      featureId: 'removed-synthetic-feature',
      schemaVersion: 7,
      values: featureValues,
    },
  });

  modelArtifactVersions.syntheticModel = 'mutated';
  providerSnapshots[0]!.snapshotId = 'mutated';
  scenarioWeights[0]!.weight = 0;
  opportunityProbabilities[0] = 1;
  statisticProbabilities[0] = 1;
  featureValues.deletedFeatureOnlyValue = 'mutated';

  assert.equal(snapshot.modelArtifactVersions.syntheticModel, 'synthetic-artifact-v1');
  assert.equal(snapshot.providerSnapshots[0]!.snapshotId, 'synthetic-provider-snapshot-1');
  assert.equal(snapshot.scenarioWeights[0]!.weight, 1);
  assert.deepEqual(snapshot.opportunityDistribution.probabilities, [0, 1]);
  assert.deepEqual(snapshot.statisticDistribution.probabilities, [0.36, 0.64]);
  assert.equal(snapshot.featureData.values.deletedFeatureOnlyValue, 'still preserved');
  assert.ok(Object.isFrozen(snapshot));
  assert.ok(Object.isFrozen(snapshot.providerSnapshots));
  assert.ok(Object.isFrozen(snapshot.providerSnapshots[0]));
  assert.ok(Object.isFrozen(snapshot.featureData));
  assert.ok(Object.isFrozen(snapshot.featureData.values));

  const view = renderHistoricalPrediction(snapshot);

  assert.deepEqual(view, {
    status: 'historical',
    snapshotId: 'synthetic-snapshot-1',
    savedAt: '2026-07-23T00:00:00.000Z',
    featureId: 'removed-synthetic-feature',
    featureSchemaVersion: 7,
    playerName: 'Synthetic Player',
    baseMarketKey: 'removed-synthetic-market',
    marketLabel: 'Removed Synthetic Market',
    line: 0.5,
    selectedSide: 'higher',
    settlementStatistic: 'synthetic_statistic',
    pWin: 0.61,
    pLoss: 0.36,
    pVoid: 0.03,
    pWinGivenGrades: 0.6288659793814433,
    modelVersion: 'synthetic-model-v1',
    mathSpecVersion: '1.4',
    projectRulesVersion: '2.0',
    settlementRegistryVersion: 'synthetic-settlement-registry-v1',
    settlementRuleVersion: 'synthetic-rule-v1',
  });
});
