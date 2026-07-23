export const MARKET_STATUSES = [
  'planned',
  'data-under-investigation',
  'model-under-development',
  'validation',
  'production-enabled',
] as const;

export type MarketStatus = (typeof MARKET_STATUSES)[number];

export const MATHEMATICAL_FAMILIES = [
  'self-contained-hitter-pa',
  'tagged-player-base-out',
  'joint-pitcher-workload-outcome',
] as const;

export type MathematicalFamily = (typeof MATHEMATICAL_FAMILIES)[number];

export interface PlannedMarketDefinition {
  readonly baseMarketKey: string;
  readonly displayName: string;
  readonly mathematicalFamily: MathematicalFamily;
  readonly status: Exclude<MarketStatus, 'production-enabled'>;
  readonly blocker: string;
}

export interface ImplementedMarketRegistration {
  readonly baseMarketKey: string;
  readonly providerMarketKeys: readonly string[];
  readonly featureId: string;
  readonly officialSettlementStatistic: string;
  readonly mathematicalFamily: MathematicalFamily;
  readonly requiredNormalizedInputs: readonly string[];
  readonly requiredSharedScenarioFields: readonly string[];
  readonly distributionBuilderVersion: string;
  readonly distributionBuilderValidated: boolean;
  readonly settlementRuleVersion: string;
  readonly status: MarketStatus;
  readonly blocker: string | null;
}
