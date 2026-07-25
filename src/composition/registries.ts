import type { ProductionRegistrySnapshot } from '../application/market-registry-gate.js';
import type { FeatureRegistration } from '../domain/feature-status.js';
import type { ImplementedMarketRegistration, PlannedMarketDefinition } from '../domain/market.js';
import type { SettlementRegistry } from '../domain/settlement-rule.js';
import {
  BATTER_HITS_FEATURE_ID,
  BATTER_HITS_MARKET_KEY,
} from '../features/batter-hits/manifest.js';
import { PLANNED_MARKET_CATALOG } from './planned-market-catalog.js';

export const SETTLEMENT_REGISTRY_VERSION = 'settlement-registry-v1';

export const IMPLEMENTED_MARKET_REGISTRY: readonly ImplementedMarketRegistration[] =
  Object.freeze([
    Object.freeze({
      baseMarketKey: BATTER_HITS_MARKET_KEY,
      providerMarketKeys: Object.freeze([]),
      featureId: BATTER_HITS_FEATURE_ID,
      officialSettlementStatistic: 'hits',
      mathematicalFamily: 'self-contained-hitter-pa',
      requiredNormalizedInputs: Object.freeze([]),
      requiredSharedScenarioFields: Object.freeze(['GameScenarioSet']),
      distributionBuilderVersion: 'batter-hits-synthetic-v1',
      distributionBuilderValidated: false,
      settlementRuleVersion: 'batter-hits-settlement-not-production-validated',
      status: 'model-under-development',
      blocker:
        'Batter Hits is synthetic-test-only; no provider contract, production distribution fit, validated settlement rule, or production prediction authorization exists.',
    }),
  ]);

export const FEATURE_REGISTRY: readonly FeatureRegistration[] = Object.freeze([
  Object.freeze({
    featureId: BATTER_HITS_FEATURE_ID,
    enabled: false,
    status: 'model-under-development',
  }),
]);

export const SETTLEMENT_REGISTRY: SettlementRegistry = Object.freeze({
  version: SETTLEMENT_REGISTRY_VERSION,
  rules: Object.freeze([]),
});

export const PRODUCTION_REGISTRIES: ProductionRegistrySnapshot = Object.freeze({
  implementedMarkets: IMPLEMENTED_MARKET_REGISTRY,
  features: FEATURE_REGISTRY,
  settlementRegistry: SETTLEMENT_REGISTRY,
});

export interface MarketKeyOwnership {
  readonly baseMarketKey: string;
  readonly ownerType: 'planned-market-catalog' | 'feature-manifest';
  readonly ownerId: string;
}

export class DuplicateMarketKeyOwnershipError extends Error {
  readonly baseMarketKey: string;

  constructor(baseMarketKey: string) {
    super(`Market key ${baseMarketKey} has more than one canonical owner.`);
    this.name = 'DuplicateMarketKeyOwnershipError';
    this.baseMarketKey = baseMarketKey;
  }
}

export function assertSingleSourceMarketKeyOwnership(
  plannedMarkets: readonly PlannedMarketDefinition[],
  implementedMarkets: readonly ImplementedMarketRegistration[],
): readonly MarketKeyOwnership[] {
  const ownership = new Map<string, MarketKeyOwnership>();

  for (const market of plannedMarkets) {
    if (ownership.has(market.baseMarketKey)) {
      throw new DuplicateMarketKeyOwnershipError(market.baseMarketKey);
    }

    ownership.set(
      market.baseMarketKey,
      Object.freeze({
        baseMarketKey: market.baseMarketKey,
        ownerType: 'planned-market-catalog',
        ownerId: 'planned-market-catalog',
      }),
    );
  }

  for (const market of implementedMarkets) {
    if (ownership.has(market.baseMarketKey)) {
      throw new DuplicateMarketKeyOwnershipError(market.baseMarketKey);
    }

    ownership.set(
      market.baseMarketKey,
      Object.freeze({
        baseMarketKey: market.baseMarketKey,
        ownerType: 'feature-manifest',
        ownerId: market.featureId,
      }),
    );
  }

  return Object.freeze([...ownership.values()]);
}

export const MARKET_KEY_OWNERSHIP = assertSingleSourceMarketKeyOwnership(
  PLANNED_MARKET_CATALOG,
  IMPLEMENTED_MARKET_REGISTRY,
);
