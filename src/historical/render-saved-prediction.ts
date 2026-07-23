import type { SavedPredictionSnapshot } from '../domain/saved-prediction.js';

export interface HistoricalPredictionView {
  readonly status: 'historical';
  readonly snapshotId: string;
  readonly featureId: string;
  readonly playerName: string;
  readonly marketLabel: string;
  readonly line: number;
  readonly selectedSide: SavedPredictionSnapshot['selectedSide'];
  readonly settlementStatistic: string;
  readonly pWin: number;
  readonly pLoss: number;
  readonly pVoid: number;
  readonly pWinGivenGrades: number;
  readonly modelVersion: string;
  readonly settlementRuleVersion: string;
}

export function renderHistoricalPrediction(
  snapshot: SavedPredictionSnapshot,
): HistoricalPredictionView {
  return Object.freeze({
    status: 'historical',
    snapshotId: snapshot.snapshotId,
    featureId: snapshot.featureData.featureId,
    playerName: snapshot.playerName,
    marketLabel: snapshot.marketLabel,
    line: snapshot.line,
    selectedSide: snapshot.selectedSide,
    settlementStatistic: snapshot.settlementStatistic,
    pWin: snapshot.pWin,
    pLoss: snapshot.pLoss,
    pVoid: snapshot.pVoid,
    pWinGivenGrades: snapshot.pWinGivenGrades,
    modelVersion: snapshot.modelVersion,
    settlementRuleVersion: snapshot.settlementRuleVersion,
  });
}
