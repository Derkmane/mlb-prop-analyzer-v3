import type {
  SavedRunCategoryId,
  SavedRunPickSnapshotV1,
  SavedRunSnapshotV1,
} from '../domain/saved-run.js';
import type { SelectedSide } from '../domain/selected-side.js';

export interface HistoricalSavedRunPickViewV1 {
  readonly status: 'historical';
  readonly snapshotId: string;
  readonly categoryId: SavedRunCategoryId;
  readonly categoryRank: number;
  readonly providerEventId: string;
  readonly providerGameId: number;
  readonly providerPlayerId: number;
  readonly playerName: string;
  readonly marketLabel: string;
  readonly offerType: 'baseline' | 'alternate';
  readonly line: number;
  readonly selectedSide: SelectedSide;
  readonly settlementStatistic: string;
  readonly marketTimestamp: string;
  readonly generatedAt: string;
  readonly pWin: number;
  readonly pLoss: number;
  readonly pVoid: number;
  readonly pWinGivenGrades: number | null;
  readonly pBaseWinGivenGrades: number | null;
  readonly contextProbabilityDelta: number;
  readonly americanPrice: number;
  readonly multiplier: number;
  readonly postedImpliedProbability: number;
  readonly priceEdgeLabel: 'DIAGNOSTIC ONLY';
  readonly priceEdge: number;
  readonly featureId: string;
  readonly featureSchemaVersion: number;
  readonly modelVersion: string;
  readonly distributionBuilderVersion: string;
  readonly settlementRuleVersion: string;
}

export interface HistoricalSavedRunCategoryViewV1 {
  readonly categoryId: SavedRunCategoryId;
  readonly picks: readonly HistoricalSavedRunPickViewV1[];
}

export interface HistoricalSavedRunViewV1 {
  readonly status: 'historical';
  readonly schemaVersion: 1;
  readonly runId: string;
  readonly savedAt: string;
  readonly generatedAt: string;
  readonly slateDate: string;
  readonly projectRulesVersion: string;
  readonly mathSpecVersion: string;
  readonly normalizedDataVersion: string;
  readonly configurationVersion: string;
  readonly settlementRegistryVersion: string;
  readonly productionEnabled: false;
  readonly rankingEnabled: false;
  readonly categories: readonly HistoricalSavedRunCategoryViewV1[];
}

function renderPick(
  pick: SavedRunPickSnapshotV1,
): HistoricalSavedRunPickViewV1 {
  return Object.freeze({
    status: 'historical',
    snapshotId: pick.snapshotId,
    categoryId: pick.categoryId,
    categoryRank: pick.categoryRank,
    providerEventId: pick.providerEventId,
    providerGameId: pick.providerGameId,
    providerPlayerId: pick.providerPlayerId,
    playerName: pick.playerName,
    marketLabel: pick.marketLabel,
    offerType: pick.offerType,
    line: pick.line,
    selectedSide: pick.selectedSide,
    settlementStatistic: pick.settlementStatistic,
    marketTimestamp: pick.marketTimestamp,
    generatedAt: pick.generatedAt,
    pWin: pick.pWin,
    pLoss: pick.pLoss,
    pVoid: pick.pVoid,
    pWinGivenGrades: pick.pWinGivenGrades,
    pBaseWinGivenGrades: pick.baseProbabilities.pWinGivenGrades,
    contextProbabilityDelta: pick.context.probabilityDelta,
    americanPrice: pick.priceDiagnostics.americanPrice,
    multiplier: pick.priceDiagnostics.multiplier,
    postedImpliedProbability:
      pick.priceDiagnostics.postedImpliedProbability,
    priceEdgeLabel: pick.priceDiagnostics.label,
    priceEdge: pick.priceDiagnostics.priceEdge,
    featureId: pick.featureData.featureId,
    featureSchemaVersion: pick.featureData.schemaVersion,
    modelVersion: pick.modelVersion,
    distributionBuilderVersion: pick.distributionBuilderVersion,
    settlementRuleVersion: pick.settlementRuleVersion,
  });
}

/**
 * Renders only the immutable saved-run schema. Feature-specific values remain
 * opaque historical evidence and no active feature implementation is loaded.
 */
export function renderHistoricalSavedRunV1(
  run: SavedRunSnapshotV1,
): HistoricalSavedRunViewV1 {
  return Object.freeze({
    status: 'historical',
    schemaVersion: run.schemaVersion,
    runId: run.runId,
    savedAt: run.savedAt,
    generatedAt: run.generatedAt,
    slateDate: run.slateDate,
    projectRulesVersion: run.projectRulesVersion,
    mathSpecVersion: run.mathSpecVersion,
    normalizedDataVersion: run.normalizedDataVersion,
    configurationVersion: run.configurationVersion,
    settlementRegistryVersion: run.settlementRegistryVersion,
    productionEnabled: false,
    rankingEnabled: false,
    categories: Object.freeze(
      run.categories.map((category) =>
        Object.freeze({
          categoryId: category.categoryId,
          picks: Object.freeze(category.picks.map(renderPick)),
        }),
      ),
    ),
  });
}
