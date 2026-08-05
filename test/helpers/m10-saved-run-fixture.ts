import {
  createSavedRunSnapshotV1,
  SAVED_RUN_CATEGORY_IDS,
  SAVED_RUN_SCHEMA_VERSION,
  type SavedRunCategoryId,
  type SavedRunPickSnapshotV1,
  type SavedRunSnapshotV1,
} from '../../src/domain/saved-run.js';

interface FixtureOptions {
  readonly runId?: string;
  readonly featureId?: string;
  readonly featureSchemaVersion?: number;
}

function statisticDistribution(
  selectedSide: 'higher' | 'lower',
  pFinal: number,
): { readonly probabilities: readonly number[] } {
  if (selectedSide === 'higher') {
    return Object.freeze({
      probabilities: Object.freeze([1 - pFinal, pFinal]),
    });
  }
  return Object.freeze({
    probabilities: Object.freeze([0.2, pFinal - 0.2, 1 - pFinal]),
  });
}

function pick(
  categoryId: SavedRunCategoryId,
  categoryRank: number,
  identity: number,
  options: Required<FixtureOptions>,
): SavedRunPickSnapshotV1 {
  const selectedSide = identity % 2 === 0 ? 'lower' : 'higher';
  const line = selectedSide === 'higher' ? 0.5 : 1.5;
  const baseFinal = 0.55 + identity * 0.01;
  const final = baseFinal + 0.01;
  const providerPlayerId = identity === 2 ? 2002 : 2001;

  return Object.freeze({
    snapshotId: `${options.runId}-${categoryId}-${categoryRank}`,
    categoryId,
    categoryRank,
    eventId: `event-${identity}`,
    gameId: String(5059400 + identity),
    providerEventId: `provider-event-${identity}`,
    providerGameId: 5059400 + identity,
    playerId: String(providerPlayerId),
    providerPlayerId,
    playerName: identity === 2 ? 'Historical Lower' : 'Historical Higher',
    baseMarketKey: 'batter-hits',
    marketLabel: 'Batter Hits',
    offerType:
      categoryId === 'high-probability-baseline-props'
        ? 'baseline'
        : 'alternate',
    line,
    selectedSide,
    settlementStatistic: 'hits',
    marketTimestamp: '2026-08-05T16:00:00.000Z',
    generatedAt: '2026-08-05T16:02:17.812Z',
    eligibilityProbability: 1,
    pWin: final,
    pLoss: 1 - final,
    pVoid: 0,
    pWinGivenGrades: final,
    modelVersion: 'historical-model-v1',
    distributionBuilderVersion: 'historical-distribution-v1',
    settlementRuleVersion: 'batter-hits-settlement-v1',
    modelArtifactVersions: Object.freeze({
      batterHitsBase: 'base-artifact-v1',
      gameContext: 'context-artifact-v1',
    }),
    providerSnapshotIds: Object.freeze([
      'odds-snapshot-20260805',
      'bdl-input-snapshot-20260805',
    ]),
    scenarioWeights: Object.freeze([
      Object.freeze({ scenarioId: 'scenario-1', weight: 1 }),
    ]),
    opportunityDistribution: Object.freeze({
      probabilities: Object.freeze([0, 0, 0, 1]),
    }),
    baseStatisticDistribution: statisticDistribution(
      selectedSide,
      baseFinal,
    ),
    baseProbabilities: Object.freeze({
      pWin: baseFinal,
      pLoss: 1 - baseFinal,
      pVoid: 0,
      pWinGivenGrades: baseFinal,
    }),
    discovery: null,
    finalStatisticDistribution: statisticDistribution(selectedSide, final),
    context: Object.freeze({
      modelVersion: 'historical-context-v1',
      factorArtifactVersions: Object.freeze({
        park: 'park-artifact-v1',
        bullpen: 'bullpen-artifact-v1',
      }),
      probabilityDelta: 0.01,
    }),
    priceDiagnostics: Object.freeze({
      label: 'DIAGNOSTIC ONLY',
      americanPrice: -110,
      multiplier: 1,
      postedImpliedProbability: 110 / 210,
      priceEdge: final - 110 / 210,
    }),
    featureData: Object.freeze({
      featureId: options.featureId,
      schemaVersion: options.featureSchemaVersion,
      values: Object.freeze({
        onlyRemovedFeatureUnderstoodThis: Object.freeze({
          code: 'opaque-history-value',
          version: 99,
        }),
      }),
    }),
  });
}

export function createM10SavedRunFixture(
  input: FixtureOptions = {},
): SavedRunSnapshotV1 {
  const options: Required<FixtureOptions> = {
    runId: input.runId ?? 'm10-historical-run-20260805',
    featureId: input.featureId ?? 'removed-batter-hits-feature-v99',
    featureSchemaVersion: input.featureSchemaVersion ?? 99,
  };
  const run: SavedRunSnapshotV1 = {
    schemaVersion: SAVED_RUN_SCHEMA_VERSION,
    runId: options.runId,
    savedAt: '2026-08-05T16:02:18.000Z',
    generatedAt: '2026-08-05T16:02:17.812Z',
    slateDate: '2026-08-05',
    projectRulesVersion: '2.9',
    mathSpecVersion: '1.7',
    normalizedDataVersion: 'm9-normalized-board-v1',
    configurationVersion: 'm10-category-configuration-v1',
    settlementRegistryVersion: 'settlement-registry-v1',
    productionEnabled: false,
    rankingEnabled: false,
    providerSnapshots: Object.freeze([
      Object.freeze({
        provider: 'the-odds-api',
        snapshotId: 'odds-snapshot-20260805',
        sha256: 'a'.repeat(64),
      }),
      Object.freeze({
        provider: 'balldontlie-mlb',
        snapshotId: 'bdl-input-snapshot-20260805',
        sha256: 'b'.repeat(64),
      }),
    ]),
    categories: Object.freeze(
      SAVED_RUN_CATEGORY_IDS.map((categoryId, index) =>
        Object.freeze({
          categoryId,
          picks: Object.freeze([
            pick(categoryId, 1, index === 2 ? 2 : 1, options),
          ]),
        }),
      ),
    ),
  };
  return createSavedRunSnapshotV1(run);
}
