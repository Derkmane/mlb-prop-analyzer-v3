import assert from 'node:assert/strict';
import test from 'node:test';

import { FeatureUnavailableError } from '../src/application/feature-gate.js';
import {
  authorizeMarketForPrediction,
  MarketRegistryUnavailableError,
  type ProductionRegistrySnapshot,
} from '../src/application/market-registry-gate.js';
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
import {
  BATTER_HHR_DRAFTKINGS_SETTLEMENT_RULE_SOURCE_REFERENCE,
  BATTER_HHR_DRAFTKINGS_SETTLEMENT_RULE_VERSION,
} from '../src/features/batter-hhr/contracts.js';
import { BATTER_HHR_FEATURE_ID, BATTER_HHR_MARKET_KEY } from '../src/features/batter-hhr/manifest.js';
import {
  BATTER_HITS_FEATURE_ID,
  BATTER_HITS_MARKET_KEY,
} from '../src/features/batter-hits/manifest.js';
import {
  BATTER_HITS_DRAFTKINGS_SETTLEMENT_RULE_SOURCE_REFERENCE,
  BATTER_HITS_DRAFTKINGS_SETTLEMENT_RULE_VERSION,
} from '../src/features/batter-hits/settlement.js';

type SettlementRuleWithoutTemporal = Omit<
  SettlementRuleRegistration,
  'effectiveDate' | 'sourcePublishedAt'
>;
type IsAssignable<Source, Target> = Source extends Target ? true : false;
type Not<Value extends boolean> = Value extends true ? false : true;
type AssertTrue<Value extends true> = Value;
type SettlementTemporalUnionAssertions = {
  effectiveDateOnlyAccepted: AssertTrue<
    IsAssignable<
      SettlementRuleWithoutTemporal & { readonly effectiveDate: string },
      SettlementRuleRegistration
    >
  >;
  sourcePublishedAtOnlyAccepted: AssertTrue<
    IsAssignable<
      SettlementRuleWithoutTemporal & { readonly sourcePublishedAt: string },
      SettlementRuleRegistration
    >
  >;
  bothRejected: AssertTrue<
    Not<
      IsAssignable<
        SettlementRuleWithoutTemporal & {
          readonly effectiveDate: string;
          readonly sourcePublishedAt: string;
        },
        SettlementRuleRegistration
      >
    >
  >;
  neitherRejected: AssertTrue<
    Not<IsAssignable<SettlementRuleWithoutTemporal, SettlementRuleRegistration>>
  >;
};
const SETTLEMENT_TEMPORAL_UNION_ASSERTIONS: SettlementTemporalUnionAssertions = Object.freeze({
  effectiveDateOnlyAccepted: true,
  sourcePublishedAtOnlyAccepted: true,
  bothRejected: true,
  neitherRejected: true,
});

const validMarket: ImplementedMarketRegistration = Object.freeze({
  baseMarketKey: 'synthetic-market', providerMarketKeys: Object.freeze(['synthetic-provider-market']),
  featureId: 'synthetic-feature', officialSettlementStatistic: 'synthetic-statistic',
  mathematicalFamily: 'self-contained-hitter-pa', requiredNormalizedInputs: Object.freeze(['synthetic-input']),
  requiredSharedScenarioFields: Object.freeze(['synthetic-scenario']), distributionBuilderVersion: 'synthetic-builder-v1',
  distributionBuilderValidated: true, settlementRuleVersion: 'synthetic-rule-v1', status: 'production-enabled', blocker: null,
});
const validFeature: FeatureRegistration = Object.freeze({ featureId: 'synthetic-feature', enabled: true, status: 'production-enabled' });
const validSettlementRule: SettlementRuleRegistration = Object.freeze({
  version: 'synthetic-rule-v1', boardSource: 'draftkings', baseMarketKey: 'synthetic-market', officialSettlementStatistic: 'synthetic-statistic',
  startRequirement: 'synthetic verified start rule', minimumParticipation: 'synthetic verified participation rule',
  reliefAppearanceHandling: 'not applicable to synthetic hitter market', intentionalWalkHandling: 'not applicable to synthetic market',
  tieHandling: 'integer ties void', postponementHandling: 'synthetic verified postponement rule',
  suspensionHandling: 'synthetic verified suspension rule', voidConditions: Object.freeze(['synthetic void condition']),
  effectiveDate: '2026-01-01', ruleSourceReference: 'synthetic-test-rule-source',
});
function snapshot(
  market: ImplementedMarketRegistration = validMarket,
  feature: FeatureRegistration = validFeature,
  rules: readonly SettlementRuleRegistration[] = [validSettlementRule],
): ProductionRegistrySnapshot {
  return Object.freeze({ implementedMarkets: Object.freeze([market]), features: Object.freeze([feature]),
    settlementRegistry: Object.freeze({ version: 'synthetic-settlement-registry-v1', rules: Object.freeze([...rules]) }) });
}
function captureMarketError(action: () => unknown): MarketRegistryUnavailableError {
  try { action(); } catch (error) { assert.ok(error instanceof MarketRegistryUnavailableError); return error; }
  assert.fail('expected registry admission to fail closed');
}

test('settlement temporal applicability type enforces exactly one self-describing date field', () => {
  assert.deepEqual(SETTLEMENT_TEMPORAL_UNION_ASSERTIONS, {
    effectiveDateOnlyAccepted: true,
    sourcePublishedAtOnlyAccepted: true,
    bothRejected: true,
    neitherRejected: true,
  });
});

test('production registries are explicit, frozen, DraftKings-bound, and keep Batter Hits and HHR disabled', () => {
  assert.equal(IMPLEMENTED_MARKET_REGISTRY.length, 2);
  assert.deepEqual(IMPLEMENTED_MARKET_REGISTRY.map((row) => row.baseMarketKey), [BATTER_HITS_MARKET_KEY, BATTER_HHR_MARKET_KEY]);
  for (const registration of IMPLEMENTED_MARKET_REGISTRY) {
    assert.equal(registration.status, 'model-under-development');
    assert.equal(registration.distributionBuilderValidated, false);
    assert.notEqual(registration.blocker, null);
  }
  assert.deepEqual(FEATURE_REGISTRY, [
    { featureId: BATTER_HITS_FEATURE_ID, enabled: false, status: 'model-under-development' },
    { featureId: BATTER_HHR_FEATURE_ID, enabled: false, status: 'model-under-development' },
  ]);
  assert.equal(SETTLEMENT_REGISTRY.version, 'settlement-registry-v4');
  assert.equal(SETTLEMENT_REGISTRY.rules.length, 2);
  const batterHitsRule = SETTLEMENT_REGISTRY.rules.find((row) => row.baseMarketKey === BATTER_HITS_MARKET_KEY);
  const hhrRule = SETTLEMENT_REGISTRY.rules.find((row) => row.baseMarketKey === BATTER_HHR_MARKET_KEY);
  assert.ok(batterHitsRule);
  assert.equal(batterHitsRule.boardSource, 'draftkings');
  assert.equal(batterHitsRule.version, BATTER_HITS_DRAFTKINGS_SETTLEMENT_RULE_VERSION);
  assert.equal(batterHitsRule.officialSettlementStatistic, 'hits');
  assert.equal(batterHitsRule.ruleSourceReference, BATTER_HITS_DRAFTKINGS_SETTLEMENT_RULE_SOURCE_REFERENCE);
  assert.ok(hhrRule);
  assert.equal(hhrRule.boardSource, 'draftkings');
  assert.equal(hhrRule.version, BATTER_HHR_DRAFTKINGS_SETTLEMENT_RULE_VERSION);
  assert.equal(hhrRule.officialSettlementStatistic, 'hits+runs+rbis');
  assert.equal(hhrRule.ruleSourceReference, BATTER_HHR_DRAFTKINGS_SETTLEMENT_RULE_SOURCE_REFERENCE);
  assert.ok(Object.isFrozen(SETTLEMENT_REGISTRY.rules));
  assert.ok(Object.isFrozen(SETTLEMENT_REGISTRY.rules[0]));
  assert.ok(Object.isFrozen(SETTLEMENT_REGISTRY.rules[1]));
  assert.ok(Object.isFrozen(IMPLEMENTED_MARKET_REGISTRY));
  assert.ok(Object.isFrozen(FEATURE_REGISTRY));
  assert.ok(Object.isFrozen(SETTLEMENT_REGISTRY));
  assert.ok(Object.isFrozen(PRODUCTION_REGISTRIES));
});

test('a still-planned market cannot produce or rank a prediction', () => {
  assert.equal(captureMarketError(() => authorizeMarketForPrediction(PRODUCTION_REGISTRIES, PLANNED_MARKET_KEYS.BATTER_TOTAL_BASES)).code, 'MARKET_NOT_IMPLEMENTED');
});
test('implemented but disabled Batter Hits cannot produce or rank a prediction', () => {
  assert.equal(captureMarketError(() => authorizeMarketForPrediction(PRODUCTION_REGISTRIES, BATTER_HITS_MARKET_KEY)).code, 'MARKET_NOT_PRODUCTION_ENABLED');
});
test('implemented but disabled HHR cannot produce or rank a prediction', () => {
  assert.equal(captureMarketError(() => authorizeMarketForPrediction(PRODUCTION_REGISTRIES, BATTER_HHR_MARKET_KEY)).code, 'MARKET_NOT_PRODUCTION_ENABLED');
});
test('an unknown market receives no fallback registration', () => {
  assert.equal(captureMarketError(() => authorizeMarketForPrediction(snapshot(), 'unknown-market')).code, 'MARKET_NOT_IMPLEMENTED');
});
test('a not-yet-production-enabled market cannot reach ranking', () => {
  assert.equal(captureMarketError(() => authorizeMarketForPrediction(snapshot(Object.freeze({ ...validMarket, status: 'validation' })), validMarket.baseMarketKey)).code, 'MARKET_NOT_PRODUCTION_ENABLED');
});
test('an unvalidated distribution builder cannot reach ranking', () => {
  assert.equal(captureMarketError(() => authorizeMarketForPrediction(snapshot(Object.freeze({ ...validMarket, distributionBuilderValidated: false })), validMarket.baseMarketKey)).code, 'DISTRIBUTION_BUILDER_NOT_VALIDATED');
});
test('a disabled registered feature cannot produce a prediction', () => {
  assert.throws(() => authorizeMarketForPrediction(snapshot(validMarket, Object.freeze({ ...validFeature, enabled: false })), validMarket.baseMarketKey),
    (error: unknown) => error instanceof FeatureUnavailableError && error.code === 'FEATURE_DISABLED');
});
test('a missing settlement rule cannot produce a prediction', () => {
  assert.equal(captureMarketError(() => authorizeMarketForPrediction(snapshot(validMarket, validFeature, []), validMarket.baseMarketKey)).code, 'SETTLEMENT_RULE_NOT_REGISTERED');
});
test('a settlement rule for the wrong official statistic cannot authorize a prediction', () => {
  const rule = Object.freeze({ ...validSettlementRule, officialSettlementStatistic: 'different-synthetic-statistic' });
  assert.equal(captureMarketError(() => authorizeMarketForPrediction(snapshot(validMarket, validFeature, [rule]), validMarket.baseMarketKey)).code, 'SETTLEMENT_STATISTIC_MISMATCH');
});
test('a fully validated synthetic market receives an immutable authorization', () => {
  const authorization = authorizeMarketForPrediction(snapshot(), validMarket.baseMarketKey);
  assert.deepEqual(authorization, {
    baseMarketKey: 'synthetic-market', featureId: 'synthetic-feature', distributionBuilderVersion: 'synthetic-builder-v1',
    settlementRegistryVersion: 'synthetic-settlement-registry-v1', settlementRuleVersion: 'synthetic-rule-v1', settlementRule: validSettlementRule,
  });
  assert.ok(Object.isFrozen(authorization));
});
