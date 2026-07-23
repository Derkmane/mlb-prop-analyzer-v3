import assert from 'node:assert/strict';
import test from 'node:test';

import {
  authorizeMarketForPrediction,
  MarketRegistryUnavailableError,
  type ProductionRegistrySnapshot,
} from '../src/application/market-registry-gate.js';
import { FeatureUnavailableError } from '../src/application/feature-gate.js';
import {
  FEATURE_REGISTRY,
  IMPLEMENTED_MARKET_REGISTRY,
  PRODUCTION_REGISTRIES,
  SETTLEMENT_REGISTRY,
} from '../src/composition/registries.js';
import { PLANNED_MARKET_KEYS } from '../src/composition/planned-market-catalog.js';
import type { FeatureRegistration } from '../src/domain/feature-status.js';
import type { ImplementedMarketRegistration } from '../src/domain/market.js';
import type { SettlementRuleRegistration } from '../src/domain/settlement-rule.js';

const validMarket: ImplementedMarketRegistration = Object.freeze({
  baseMarketKey: 'synthetic-market',
  providerMarketKeys: Object.freeze(['synthetic-provider-market']),
  featureId: 'synthetic-feature',
  officialSettlementStatistic: 'synthetic-statistic',
  mathematicalFamily: 'self-contained-hitter-pa',
  requiredNormalizedInputs: Object.freeze(['synthetic-input']),
  requiredSharedScenarioFields: Object.freeze(['synthetic-scenario']),
  distributionBuilderVersion: 'synthetic-builder-v1',
  distributionBuilderValidated: true,
  settlementRuleVersion: 'synthetic-rule-v1',
  status: 'production-enabled',
  blocker: null,
});

const validFeature: FeatureRegistration = Object.freeze({
  featureId: 'synthetic-feature',
  enabled: true,
  status: 'production-enabled',
});

const validSettlementRule: SettlementRuleRegistration = Object.freeze({
  version: 'synthetic-rule-v1',
  baseMarketKey: 'synthetic-market',
  officialSettlementStatistic: 'synthetic-statistic',
  startRequirement: 'synthetic verified start rule',
  minimumParticipation: 'synthetic verified participation rule',
  reliefAppearanceHandling: 'not applicable to synthetic hitter market',
  intentionalWalkHandling: 'not applicable to synthetic market',
  tieHandling: 'integer ties void',
  postponementHandling: 'synthetic verified postponement rule',
  suspensionHandling: 'synthetic verified suspension rule',
  voidConditions: Object.freeze(['synthetic void condition']),
  effectiveDate: '2026-01-01',
  ruleSourceReference: 'synthetic-test-rule-source',
});

function snapshot(
  market: ImplementedMarketRegistration = validMarket,
  feature: FeatureRegistration = validFeature,
  rules: readonly SettlementRuleRegistration[] = [validSettlementRule],
): ProductionRegistrySnapshot {
  return Object.freeze({
    implementedMarkets: Object.freeze([market]),
    features: Object.freeze([feature]),
    settlementRegistry: Object.freeze({
      version: 'synthetic-settlement-registry-v1',
      rules: Object.freeze([...rules]),
    }),
  });
}

function captureMarketError(action: () => unknown): MarketRegistryUnavailableError {
  try {
    action();
  } catch (error) {
    assert.ok(error instanceof MarketRegistryUnavailableError);
    return error;
  }
  assert.fail('expected registry admission to fail closed');
}

test('production registries are explicit, frozen, and empty before a feature exists', () => {
  assert.deepEqual(IMPLEMENTED_MARKET_REGISTRY, []);
  assert.deepEqual(FEATURE_REGISTRY, []);
  assert.deepEqual(SETTLEMENT_REGISTRY.rules, []);
  assert.ok(Object.isFrozen(IMPLEMENTED_MARKET_REGISTRY));
  assert.ok(Object.isFrozen(FEATURE_REGISTRY));
  assert.ok(Object.isFrozen(SETTLEMENT_REGISTRY));
  assert.ok(Object.isFrozen(PRODUCTION_REGISTRIES));
});

test('a planned market cannot produce or rank a prediction', () => {
  const error = captureMarketError(() =>
    authorizeMarketForPrediction(
      PRODUCTION_REGISTRIES,
      PLANNED_MARKET_KEYS.BATTER_HITS,
    ),
  );
  assert.equal(error.code, 'MARKET_NOT_IMPLEMENTED');
});

test('an unknown market receives no fallback registration', () => {
  const error = captureMarketError(() =>
    authorizeMarketForPrediction(snapshot(), 'unknown-market'),
  );
  assert.equal(error.code, 'MARKET_NOT_IMPLEMENTED');
});

test('a not-yet-production-enabled market cannot reach ranking', () => {
  const error = captureMarketError(() =>
    authorizeMarketForPrediction(
      snapshot(Object.freeze({ ...validMarket, status: 'validation' })),
      validMarket.baseMarketKey,
    ),
  );
  assert.equal(error.code, 'MARKET_NOT_PRODUCTION_ENABLED');
});

test('an unvalidated distribution builder cannot reach ranking', () => {
  const error = captureMarketError(() =>
    authorizeMarketForPrediction(
      snapshot(Object.freeze({ ...validMarket, distributionBuilderValidated: false })),
      validMarket.baseMarketKey,
    ),
  );
  assert.equal(error.code, 'DISTRIBUTION_BUILDER_NOT_VALIDATED');
});

test('a disabled registered feature cannot produce a prediction', () => {
  assert.throws(
    () =>
      authorizeMarketForPrediction(
        snapshot(validMarket, Object.freeze({ ...validFeature, enabled: false })),
        validMarket.baseMarketKey,
      ),
    (error: unknown) =>
      error instanceof FeatureUnavailableError && error.code === 'FEATURE_DISABLED',
  );
});

test('a missing settlement rule cannot produce a prediction', () => {
  const error = captureMarketError(() =>
    authorizeMarketForPrediction(snapshot(validMarket, validFeature, []), validMarket.baseMarketKey),
  );
  assert.equal(error.code, 'SETTLEMENT_RULE_NOT_REGISTERED');
});

test('a fully validated synthetic market receives an immutable authorization', () => {
  const authorization = authorizeMarketForPrediction(
    snapshot(),
    validMarket.baseMarketKey,
  );

  assert.deepEqual(authorization, {
    baseMarketKey: 'synthetic-market',
    featureId: 'synthetic-feature',
    distributionBuilderVersion: 'synthetic-builder-v1',
    settlementRegistryVersion: 'synthetic-settlement-registry-v1',
    settlementRuleVersion: 'synthetic-rule-v1',
    settlementRule: validSettlementRule,
  });
  assert.ok(Object.isFrozen(authorization));
});
