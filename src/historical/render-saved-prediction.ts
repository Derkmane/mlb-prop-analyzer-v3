import type { SavedPredictionSnapshot } from '../domain/saved-prediction.js';

export interface HistoricalPredictionView {
  readonly status: 'historical';
  readonly snapshotId: string;
  readonly savedAt: string;
  readonly featureId: string;
  readonly featureSchemaVersion: number;
  readonly playerName: string;
  readonly baseMarketKey: string;
  readonly marketLabel: string;
  readonly line: number;
  readonly selectedSide: SavedPredictionSnapshot['selectedSide'];
  readonly settlementStatistic: string;
  readonly pWin: number;
  readonly pLoss: number;
  readonly pVoid: number;
  readonly pWinGivenGrades: number | null;
  readonly modelVersion: string;
  readonly mathSpecVersion: string;
  readonly projectRulesVersion: string;
  readonly settlementRegistryVersion: string;
  readonly settlementRuleVersion: string;
}

export function renderHistoricalPrediction(
  snapshot: SavedPredictionSnapshot,
): HistoricalPredictionView {
  return Object.freeze({
    status: 'historical',
    snapshotId: snapshot.snapshotId,
    savedAt: snapshot.savedAt,
    featureId: snapshot.featureData.featureId,
    featureSchemaVersion: snapshot.featureData.schemaVersion,
    playerName: snapshot.playerName,
    baseMarketKey: snapshot.baseMarketKey,
    marketLabel: snapshot.marketLabel,
    line: snapshot.line,
    selectedSide: snapshot.selectedSide,
    settlementStatistic: snapshot.settlementStatistic,
    pWin: snapshot.pWin,
    pLoss: snapshot.pLoss,
    pVoid: snapshot.pVoid,
    pWinGivenGrades: snapshot.pWinGivenGrades,
    modelVersion: snapshot.modelVersion,
    mathSpecVersion: snapshot.mathSpecVersion,
    projectRulesVersion: snapshot.projectRulesVersion,
    settlementRegistryVersion: snapshot.settlementRegistryVersion,
    settlementRuleVersion: snapshot.settlementRuleVersion,
  });
}
