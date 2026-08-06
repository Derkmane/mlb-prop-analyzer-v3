import type { PerPaOutcomeVector } from '../../domain/per-pa-outcome.js';
import type { ProbabilityMassFunction } from '../../domain/probability.js';
import type { SelectedSide } from '../../domain/selected-side.js';
import type { SettlementResult } from '../../domain/settlement.js';

export const BATTER_HHR_MODEL_VERSION = 'm11-batter-hhr-direct-composite-v1' as const;
export const BATTER_HHR_DISTRIBUTION_BUILDER_VERSION = 'm11-batter-hhr-negative-binomial-v1' as const;
export const BATTER_HHR_SETTLEMENT_RULE_VERSION = 'underdog-batter-hhr-settlement-v1' as const;
export const BATTER_HHR_MATHEMATICAL_FAMILY = 'directly-fitted-composite' as const;
export const BATTER_HHR_TAIL_COLLAPSE_AT = 64 as const;
export const BATTER_HHR_MAXIMUM_EXACT_POSTED_LINE = 63.5 as const;
export const BATTER_HHR_HIT_CATEGORIES = Object.freeze(['1B','2B','3B','HR'] as const);

export const BATTER_HHR_PREDICTOR_ORDER = Object.freeze([
  'contextHitQualityLogit',
  'centeredLineupSlot',
  'platoonSplitCell',
  'opposingStarterPooling',
  'teamImpliedRunTotal',
  'precedingLineupSlotsOnBaseQuality',
] as const);
export type BatterHhrPredictorName = (typeof BATTER_HHR_PREDICTOR_ORDER)[number];
export interface BatterHhrPredictorTransform { readonly mean: number; readonly standardDeviation: number; }

export interface BatterHhrDirectCompositeArtifact {
  readonly artifactVersion: 1;
  readonly modelVersion: typeof BATTER_HHR_MODEL_VERSION;
  readonly distributionBuilderVersion: typeof BATTER_HHR_DISTRIBUTION_BUILDER_VERSION;
  readonly mathematicalFamily: typeof BATTER_HHR_MATHEMATICAL_FAMILY;
  readonly officialSettlementStatistic: 'hits+runs+rbis';
  readonly activeSeason: 2026;
  readonly productionEnabled: false;
  readonly validationStatus: 'not-production-validated';
  readonly fittingMethod: 'negative-binomial-log-link-irls-offset-v1';
  readonly fittingDetails: {
    readonly response: 'T=hits+runs+rbi';
    readonly link: 'log';
    readonly variance: 'mu+alpha*mu^2';
    readonly expectedPlateAppearancesRole: 'offset';
    readonly expectedPlateAppearancesCoefficient: 1;
    readonly predictorOrder: readonly string[];
    readonly numericalRidge: number;
    readonly independentMarginalConvolution: false;
    readonly tripleJointFormed: false;
    readonly monteCarloRuntime: false;
  };
  readonly usedConditioningInputs: readonly [
    'context-adjusted-terminal-outcome-vector',
    'expected-plate-appearances',
    'lineup-slot',
    'platoon-split-cell',
    'opposing-starter-pooling',
    'team-implied-run-total',
    'preceding-lineup-slots-on-base-quality',
  ];
  readonly excludedConditioningInputs: readonly [];
  readonly predictorTransforms: Readonly<Record<BatterHhrPredictorName, BatterHhrPredictorTransform>>;
  readonly coefficients: Readonly<Record<'intercept' | BatterHhrPredictorName, number>>;
  readonly dispersionAlpha: number;
  readonly fitEvidence: {
    readonly provider: 'BALLDONTLIE MLB API';
    readonly activeSeason: 2026;
    readonly seasonType: 'regular';
    readonly warmupStartDate: string;
    readonly warmupEndDate: string;
    readonly startDate: string;
    readonly endDate: string;
    readonly chronology: string;
    readonly sourceFixtureSha256: string;
    readonly gameCount: number;
    readonly rowCount: number;
    readonly excludedRowCount: number;
    readonly diagnosticsSha256: string;
  };
  readonly providerBoardEvidence: {
    readonly provider: 'The Odds API';
    readonly bookmaker: 'underdog';
    readonly region: 'us_dfs';
    readonly baselineMarketKey: 'batter_hits_runs_rbis';
    readonly alternateMarketKey: 'batter_hits_runs_rbis_alternate';
    readonly sourceFixtureSha256: string;
  };
  readonly tailCollapseAt: typeof BATTER_HHR_TAIL_COLLAPSE_AT;
  readonly maximumExactPostedLine: typeof BATTER_HHR_MAXIMUM_EXACT_POSTED_LINE;
  readonly calibrationStatus: 'step-3-required';
  readonly boxScoreVerificationStatus: 'step-3-required';
  readonly blocker: string;
  readonly artifactSha256: string;
}

export interface BatterHhrDistributionInput {
  readonly contextAdjustedTerminalOutcomeVector: PerPaOutcomeVector<string>;
  readonly terminalOutcomeCategories: readonly string[];
  readonly expectedPlateAppearances: number;
  readonly lineupSlot: number;
  readonly platoonSplitCell: number;
  readonly opposingStarterPooling: number;
  readonly teamImpliedRunTotal: number;
  readonly precedingLineupSlotsOnBaseQuality: number;
}

export interface BatterHhrDirectCompositeDistribution {
  readonly modelVersion: typeof BATTER_HHR_MODEL_VERSION;
  readonly distributionBuilderVersion: typeof BATTER_HHR_DISTRIBUTION_BUILDER_VERSION;
  readonly mathematicalFamily: typeof BATTER_HHR_MATHEMATICAL_FAMILY;
  readonly officialSettlementStatistic: 'hits+runs+rbis';
  readonly mean: number;
  readonly dispersionAlpha: number;
  readonly statisticDistribution: ProbabilityMassFunction;
  readonly tailCollapsedAt: typeof BATTER_HHR_TAIL_COLLAPSE_AT;
  readonly maximumExactPostedLine: typeof BATTER_HHR_MAXIMUM_EXACT_POSTED_LINE;
  readonly productionEnabled: false;
}

export interface NormalizedBatterHhrOffer {
  readonly source: 'the-odds-api'; readonly bookmaker: 'underdog'; readonly region: 'us_dfs';
  readonly eventId: string; readonly commenceTime: string; readonly homeTeam: string; readonly awayTeam: string;
  readonly playerName: string;
  readonly providerMarketKey: 'batter_hits_runs_rbis' | 'batter_hits_runs_rbis_alternate';
  readonly baseMarketKey: 'batter-hits-runs-rbis'; readonly offerType: 'baseline' | 'alternate';
  readonly selectedSide: SelectedSide; readonly line: number; readonly price: number | null;
  readonly multiplier: number | null; readonly providerSid: string | null;
  readonly marketLastUpdate: string; readonly sourceSnapshotSha256: string;
}
export interface SettledBatterHhrOffer {
  readonly offer: NormalizedBatterHhrOffer;
  readonly distribution: BatterHhrDirectCompositeDistribution;
  readonly settlement: SettlementResult;
}
