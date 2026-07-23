import assert from 'node:assert/strict';
import test from 'node:test';

import type { SavedPredictionSnapshot } from '../src/domain/saved-prediction.js';
import { renderHistoricalPrediction } from '../src/historical/render-saved-prediction.js';

test('a saved prediction renders after its feature implementation is absent', () => {
  const snapshot: SavedPredictionSnapshot = Object.freeze({
    snapshotId: 'synthetic-snapshot-1',
    playerName: 'Synthetic Player',
    marketLabel: 'Removed Synthetic Market',
    line: 0.5,
    selectedSide: 'higher',
    settlementStatistic: 'synthetic_statistic',
    pWin: 0.61,
    pLoss: 0.36,
    pVoid: 0.03,
    pWinGivenGrades: 0.6288659793814433,
    modelVersion: 'synthetic-model-v1',
    settlementRuleVersion: 'synthetic-rule-v1',
    featureData: Object.freeze({
      featureId: 'removed-synthetic-feature',
      schemaVersion: 7,
      values: Object.freeze({ deletedFeatureOnlyValue: 'still preserved' }),
    }),
  });

  const view = renderHistoricalPrediction(snapshot);

  assert.deepEqual(view, {
    status: 'historical',
    snapshotId: 'synthetic-snapshot-1',
    featureId: 'removed-synthetic-feature',
    playerName: 'Synthetic Player',
    marketLabel: 'Removed Synthetic Market',
    line: 0.5,
    selectedSide: 'higher',
    settlementStatistic: 'synthetic_statistic',
    pWin: 0.61,
    pLoss: 0.36,
    pVoid: 0.03,
    pWinGivenGrades: 0.6288659793814433,
    modelVersion: 'synthetic-model-v1',
    settlementRuleVersion: 'synthetic-rule-v1',
  });
});
