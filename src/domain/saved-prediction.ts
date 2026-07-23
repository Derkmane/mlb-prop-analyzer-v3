import type { SelectedSide } from './selected-side.js';

export interface FeatureDataEnvelope {
  readonly featureId: string;
  readonly schemaVersion: number;
  readonly values: Readonly<Record<string, unknown>>;
}

export interface SavedPredictionSnapshot {
  readonly snapshotId: string;
  readonly playerName: string;
  readonly marketLabel: string;
  readonly line: number;
  readonly selectedSide: SelectedSide;
  readonly settlementStatistic: string;
  readonly pWin: number;
  readonly pLoss: number;
  readonly pVoid: number;
  readonly pWinGivenGrades: number;
  readonly modelVersion: string;
  readonly settlementRuleVersion: string;
  readonly featureData: FeatureDataEnvelope;
}
