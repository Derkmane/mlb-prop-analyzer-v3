import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';

import {
  createSavedPredictionSnapshot,
  type SavedPredictionSnapshot,
} from '../src/domain/saved-prediction.js';
import { renderHistoricalPrediction } from '../src/historical/index.js';

export const SYNTHETIC_BATTER_HITS_REMOVAL_PROOF_JSON = JSON.stringify({
  snapshotId: 'synthetic-batter-hits-removal-proof-v1',
  savedAt: '2026-07-25T12:00:00.000Z',
  eventId: 'synthetic-event-removal-proof',
  gameId: 'synthetic-game-removal-proof',
  playerId: 'synthetic-player-removal-proof',
  playerName: 'Synthetic Historical Hitter',
  baseMarketKey: 'batter-hits',
  marketLabel: 'Batter Hits',
  line: 0.5,
  selectedSide: 'higher',
  settlementStatistic: 'hits',
  eligibilityProbability: 0.97,
  pWin: 0.582,
  pLoss: 0.388,
  pVoid: 0.03,
  pWinGivenGrades: 0.6,
  modelVersion: 'synthetic-batter-hits-model-v1',
  mathSpecVersion: 'canonical-math-spec-v1.4',
  projectRulesVersion: 'project-rules-v2.0',
  normalizedDataVersion: 'synthetic-test-only-no-normalized-board-offer-v1',
  configurationVersion: 'synthetic-batter-hits-config-v1',
  settlementRegistryVersion: 'synthetic-settlement-registry-v1',
  settlementRuleVersion: 'synthetic-batter-hits-settlement-v1',
  modelArtifactVersions: {
    syntheticBatterHitsModel: 'synthetic-batter-hits-model-v1',
    syntheticBatterHitsDistribution: 'batter-hits-synthetic-v1',
  },
  providerSnapshots: [],
  scenarioWeights: [
    { scenarioId: 'low-offense', weight: 0.4 },
    { scenarioId: 'high-offense', weight: 0.6 },
  ],
  opportunityDistribution: {
    probabilities: [0, 0, 0, 0, 0.5, 0.5],
  },
  statisticDistribution: {
    probabilities: [0.4, 0.4, 0.2],
  },
  featureData: {
    featureId: 'batter-hits-feature',
    schemaVersion: 1,
    values: {
      batterHits: {
        sourceKind: 'synthetic-test-only',
        syntheticOfferId: 'synthetic-removal-proof-offer',
        offerType: 'baseline',
        teamId: 'synthetic-team-removal-proof',
        configurationVersion: 'synthetic-batter-hits-config-v1',
        scenarioSetId: 'synthetic-batter-hits-scenarios-v1',
        scenarioWeights: [
          { scenarioId: 'low-offense', weight: 0.4 },
          { scenarioId: 'high-offense', weight: 0.6 },
        ],
        scenarioHitProbabilities: [
          {
            scenarioId: 'low-offense',
            offensiveEnvironmentId: 'home-low-offense',
            probabilities: [0.1, 0.2, 0.3, 0.4, 0.5],
          },
          {
            scenarioId: 'high-offense',
            offensiveEnvironmentId: 'home-high-offense',
            probabilities: [0.2, 0.3, 0.4, 0.5, 0.6],
          },
        ],
      },
    },
  },
} satisfies SavedPredictionSnapshot);

function loadRemovalProofSnapshot(): SavedPredictionSnapshot {
  return createSavedPredictionSnapshot(
    JSON.parse(SYNTHETIC_BATTER_HITS_REMOVAL_PROOF_JSON) as SavedPredictionSnapshot,
  );
}

test('historical Batter Hits snapshot renders without importing the active feature', () => {
  const rendererSource = readFileSync(
    join(process.cwd(), 'src/historical/render-saved-prediction.ts'),
    'utf8',
  );
  assert.doesNotMatch(rendererSource, /src\/features|features\/batter-hits|batter-hits-feature/);

  const snapshot = loadRemovalProofSnapshot();
  const view = renderHistoricalPrediction(snapshot);

  assert.deepEqual(view, {
    status: 'historical',
    snapshotId: 'synthetic-batter-hits-removal-proof-v1',
    savedAt: '2026-07-25T12:00:00.000Z',
    featureId: 'batter-hits-feature',
    featureSchemaVersion: 1,
    playerName: 'Synthetic Historical Hitter',
    baseMarketKey: 'batter-hits',
    marketLabel: 'Batter Hits',
    line: 0.5,
    selectedSide: 'higher',
    settlementStatistic: 'hits',
    pWin: 0.582,
    pLoss: 0.388,
    pVoid: 0.03,
    pWinGivenGrades: 0.6,
    modelVersion: 'synthetic-batter-hits-model-v1',
    mathSpecVersion: 'canonical-math-spec-v1.4',
    projectRulesVersion: 'project-rules-v2.0',
    settlementRegistryVersion: 'synthetic-settlement-registry-v1',
    settlementRuleVersion: 'synthetic-batter-hits-settlement-v1',
  });
  assert.ok(Object.isFrozen(snapshot));
  assert.ok(Object.isFrozen(snapshot.featureData.values));
});
