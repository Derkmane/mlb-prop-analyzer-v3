import type { FeatureRegistration } from '../domain/feature-status.js';
import type { ImplementedMarketRegistration } from '../domain/market.js';
import type { SettlementRegistry, SettlementRuleRegistration } from '../domain/settlement-rule.js';
import { assertFeatureCanProducePrediction } from './feature-gate.js';

export interface ProductionRegistrySnapshot {
  readonly implementedMarkets: readonly ImplementedMarketRegistration[];
  readonly features: readonly FeatureRegistration[];
  readonly settlementRegistry: SettlementRegistry;
}

export type MarketRegistryUnavailableCode =
  | 'MARKET_NOT_IMPLEMENTED'
  | 'MARKET_NOT_PRODUCTION_ENABLED'
  | 'DISTRIBUTION_BUILDER_NOT_VALIDATED'
  | 'MARKET_BLOCKED'
  | 'PROVIDER_MARKET_KEYS_UNVERIFIED'
  | 'FEATURE_NOT_REGISTERED'
  | 'SETTLEMENT_REGISTRY_UNVERSIONED'
  | 'SETTLEMENT_RULE_NOT_REGISTERED'
  | 'SETTLEMENT_RULE_MARKET_MISMATCH';

export class MarketRegistryUnavailableError extends Error {
  readonly code: MarketRegistryUnavailableCode;
  readonly baseMarketKey: string;

  constructor(baseMarketKey: string, code: MarketRegistryUnavailableCode, message: string) {
    super(message);
    this.name = 'MarketRegistryUnavailableError';
    this.baseMarketKey = baseMarketKey;
    this.code = code;
  }
}

export interface ProductionMarketAuthorization {
  readonly baseMarketKey: string;
  readonly featureId: string;
  readonly distributionBuilderVersion: string;
  readonly settlementRegistryVersion: string;
  readonly settlementRuleVersion: string;
  readonly settlementRule: SettlementRuleRegistration;
}

function unavailable(
  baseMarketKey: string,
  code: MarketRegistryUnavailableCode,
  message: string,
): never {
  throw new MarketRegistryUnavailableError(baseMarketKey, code, message);
}

export function authorizeMarketForPrediction(
  registries: ProductionRegistrySnapshot,
  baseMarketKey: string,
): ProductionMarketAuthorization {
  const market = registries.implementedMarkets.find(
    (entry) => entry.baseMarketKey === baseMarketKey,
  );

  if (market === undefined) {
    return unavailable(
      baseMarketKey,
      'MARKET_NOT_IMPLEMENTED',
      `Market ${baseMarketKey} is not implemented and cannot produce or rank predictions.`,
    );
  }

  if (market.status !== 'production-enabled') {
    return unavailable(
      baseMarketKey,
      'MARKET_NOT_PRODUCTION_ENABLED',
      `Market ${baseMarketKey} is ${market.status} and cannot produce or rank predictions.`,
    );
  }

  if (
    !market.distributionBuilderValidated ||
    market.distributionBuilderVersion.trim().length === 0
  ) {
    return unavailable(
      baseMarketKey,
      'DISTRIBUTION_BUILDER_NOT_VALIDATED',
      `Market ${baseMarketKey} has no validated versioned distribution builder.`,
    );
  }

  if (market.blocker !== null) {
    return unavailable(
      baseMarketKey,
      'MARKET_BLOCKED',
      `Market ${baseMarketKey} remains blocked: ${market.blocker}`,
    );
  }

  if (market.providerMarketKeys.length === 0) {
    return unavailable(
      baseMarketKey,
      'PROVIDER_MARKET_KEYS_UNVERIFIED',
      `Market ${baseMarketKey} has no verified provider market keys.`,
    );
  }

  const feature = registries.features.find(
    (entry) => entry.featureId === market.featureId,
  );

  if (feature === undefined) {
    return unavailable(
      baseMarketKey,
      'FEATURE_NOT_REGISTERED',
      `Feature ${market.featureId} is not registered for market ${baseMarketKey}.`,
    );
  }

  assertFeatureCanProducePrediction(feature);

  if (registries.settlementRegistry.version.trim().length === 0) {
    return unavailable(
      baseMarketKey,
      'SETTLEMENT_REGISTRY_UNVERSIONED',
      'The settlement registry is not versioned.',
    );
  }

  const settlementRule = registries.settlementRegistry.rules.find(
    (entry) => entry.version === market.settlementRuleVersion,
  );

  if (settlementRule === undefined) {
    return unavailable(
      baseMarketKey,
      'SETTLEMENT_RULE_NOT_REGISTERED',
      `Settlement rule ${market.settlementRuleVersion} is not registered.`,
    );
  }

  if (settlementRule.baseMarketKey !== baseMarketKey) {
    return unavailable(
      baseMarketKey,
      'SETTLEMENT_RULE_MARKET_MISMATCH',
      `Settlement rule ${settlementRule.version} belongs to ${settlementRule.baseMarketKey}, not ${baseMarketKey}.`,
    );
  }

  return Object.freeze({
    baseMarketKey,
    featureId: feature.featureId,
    distributionBuilderVersion: market.distributionBuilderVersion,
    settlementRegistryVersion: registries.settlementRegistry.version,
    settlementRuleVersion: settlementRule.version,
    settlementRule,
  });
}
