import assert from 'node:assert/strict';
import test from 'node:test';

import {
  rankPredictionCandidates,
  type ProductionRegistrySnapshot,
} from '../src/application/index.js';
import { PRODUCTION_REGISTRIES } from '../src/composition/index.js';
import type { FeatureRegistration } from '../src/domain/feature-status.js';
import type { ImplementedMarketRegistration } from '../src/domain/market.js';
import type { PredictionCandidate } from '../src/domain/prediction-candidate.js';
import type { SettlementRuleRegistration } from '../src/domain/settlement-rule.js';
import { BATTER_HITS_FEATURE_ID, BATTER_HITS_MARKET_KEY } from '../src/features/batter-hits/index.js';

const DISTRIBUTION_BUILDER_VERSION = 'm8-5-final-distribution-test-v1';
const SETTLEMENT_RULE_VERSION = 'batter-hits-ranking-test-rule-v1';

const authorizedMarket: ImplementedMarketRegistration = Object.freeze({
  baseMarketKey: BATTER_HITS_MARKET_KEY,
  providerMarketKeys: Object.freeze(['batter_hits', 'batter_hits_alternate']),
  featureId: BATTER_HITS_FEATURE_ID,
  officialSettlementStatistic: 'hits',
  mathematicalFamily: 'self-contained-hitter-pa',
  requiredNormalizedInputs: Object.freeze(['normalized-batter-hits-offer']),
  requiredSharedScenarioFields: Object.freeze(['GameScenarioSet']),
  distributionBuilderVersion: DISTRIBUTION_BUILDER_VERSION,
  distributionBuilderValidated: true,
  settlementRuleVersion: SETTLEMENT_RULE_VERSION,
  status: 'production-enabled',
  blocker: null,
});

const authorizedFeature: FeatureRegistration = Object.freeze({
  featureId: BATTER_HITS_FEATURE_ID,
  enabled: true,
  status: 'production-enabled',
});

const authorizedSettlementRule: SettlementRuleRegistration = Object.freeze({
  version: SETTLEMENT_RULE_VERSION,
  boardSource: 'draftkings',
  baseMarketKey: BATTER_HITS_MARKET_KEY,
  officialSettlementStatistic: 'hits',
  startRequirement: 'synthetic focused-test start requirement',
  minimumParticipation: 'synthetic focused-test participation requirement',
  reliefAppearanceHandling: 'not applicable',
  intentionalWalkHandling: 'not applicable',
  tieHandling: 'integer ties void',
  postponementHandling: 'synthetic focused-test postponement handling',
  suspensionHandling: 'synthetic focused-test suspension handling',
  voidConditions: Object.freeze(['synthetic focused-test void condition']),
  effectiveDate: '2026-01-01',
  ruleSourceReference: 'synthetic-m9-ranking-focused-test',
});

function registries(
  market: ImplementedMarketRegistration = authorizedMarket,
  feature: FeatureRegistration = authorizedFeature,
): ProductionRegistrySnapshot {
  return Object.freeze({
    implementedMarkets: Object.freeze([market]),
    features: Object.freeze([feature]),
    settlementRegistry: Object.freeze({
      version: 'm9-ranking-focused-test-registry-v1',
      rules: Object.freeze([authorizedSettlementRule]),
    }),
  });
}

interface CandidateDiagnostics {
  readonly pBase: number;
  readonly contextProbabilityDelta: number;
  readonly price: number;
  readonly multiplier: number;
  readonly discoveryLabel: string;
}

type TestCandidate = PredictionCandidate<Readonly<{ identity: string }>>;

function candidate(
  identity: string,
  pFinal: number | null,
  pVoid: number,
  diagnostics: CandidateDiagnostics,
  overrides: Partial<TestCandidate> = {},
): TestCandidate {
  const gradeMass = 1 - pVoid;
  const pWin = pFinal === null ? 0 : pFinal * gradeMass;
  const pLoss = pFinal === null ? 0 : (1 - pFinal) * gradeMass;

  return Object.freeze({
    eventId: `event-${identity}`,
    gameId: `game-${identity}`,
    playerId: `player-${identity}`,
    playerName: `Player ${identity}`,
    baseMarketKey: BATTER_HITS_MARKET_KEY,
    marketLabel: 'Batter Hits',
    line: 0.5,
    selectedSide: 'higher',
    settlementStatistic: 'hits',
    eligibilityProbability: gradeMass,
    statisticDistribution: Object.freeze({
      probabilities: Object.freeze([0.4, 0.6]),
    }),
    pWin,
    pLoss,
    pVoid,
    pWinGivenGrades: pFinal,
    modelVersion: 'm8-5-batter-hits-successor-freeze-v1',
    distributionBuilderVersion: DISTRIBUTION_BUILDER_VERSION,
    settlementRuleVersion: SETTLEMENT_RULE_VERSION,
    sharedScenarioReference: Object.freeze({ identity }),
    featureData: Object.freeze({
      featureId: BATTER_HITS_FEATURE_ID,
      schemaVersion: 2,
      values: Object.freeze({
        diagnostics: Object.freeze({ ...diagnostics }),
      }),
    }),
    ...overrides,
  });
}

const neutralDiagnostics: CandidateDiagnostics = Object.freeze({
  pBase: 0.5,
  contextProbabilityDelta: 0,
  price: 1,
  multiplier: 1,
  discoveryLabel: 'audit-only',
});

function rankedIds(candidates: readonly TestCandidate[]): readonly string[] {
  return rankPredictionCandidates({
    candidates,
    registries: registries(),
  }).rankedCandidates.map((entry) => entry.playerId);
}

test('order depends only on final P(Win | grades), then P(Void)', () => {
  const lowerFinal = candidate('lower-final', 0.61, 0.01, neutralDiagnostics);
  const higherFinal = candidate('higher-final', 0.64, 0.2, neutralDiagnostics);
  assert.deepEqual(rankedIds([lowerFinal, higherFinal]), ['player-higher-final', 'player-lower-final']);
});

test('a candidate with higher p_base but lower p_final ranks below', () => {
  const highBase = candidate('high-base', 0.62, 0.02, {
    ...neutralDiagnostics,
    pBase: 0.9,
    contextProbabilityDelta: -0.28,
  });
  const highFinal = candidate('high-final', 0.66, 0.02, {
    ...neutralDiagnostics,
    pBase: 0.4,
    contextProbabilityDelta: 0.26,
  });
  assert.deepEqual(rankedIds([highBase, highFinal]), ['player-high-final', 'player-high-base']);
});

test('a higher multiplier or better price cannot improve rank', () => {
  const expensiveLowerFinal = candidate('economics', 0.6, 0.01, {
    ...neutralDiagnostics,
    price: 100,
    multiplier: 10,
  });
  const plainHigherFinal = candidate('probability', 0.65, 0.01, {
    ...neutralDiagnostics,
    price: 0.1,
    multiplier: 0.1,
  });
  assert.deepEqual(rankedIds([expensiveLowerFinal, plainHigherFinal]), ['player-probability', 'player-economics']);
});

test('identical p_final ties break only on P(Void)', () => {
  const moreVoid = candidate('more-void', 0.63, 0.08, {
    ...neutralDiagnostics,
    pBase: 0.99,
    multiplier: 20,
  });
  const lessVoid = candidate('less-void', 0.63, 0.03, {
    ...neutralDiagnostics,
    pBase: 0.01,
    multiplier: 0.1,
  });
  assert.deepEqual(rankedIds([moreVoid, lessVoid]), ['player-less-void', 'player-more-void']);
});

test('a candidate with no validated distribution cannot enter ranking', () => {
  const result = rankPredictionCandidates({
    candidates: [candidate('unvalidated', 0.7, 0.01, neutralDiagnostics)],
    registries: registries(Object.freeze({ ...authorizedMarket, distributionBuilderValidated: false })),
  });
  assert.deepEqual(result.rankedCandidates, []);
  assert.equal(result.excludedCandidates.length, 1);
  assert.equal(result.excludedCandidates[0]?.reason, 'MARKET_NOT_AUTHORIZED');
  assert.equal(result.excludedCandidates[0]?.authorizationCode, 'DISTRIBUTION_BUILDER_NOT_VALIDATED');
});

test('a disabled or not-yet-production-enabled market cannot rank', () => {
  const currentProductionResult = rankPredictionCandidates({
    candidates: [candidate('real-disabled', 0.7, 0.01, neutralDiagnostics)],
    registries: PRODUCTION_REGISTRIES,
  });
  const validationMarketResult = rankPredictionCandidates({
    candidates: [candidate('validation', 0.7, 0.01, neutralDiagnostics)],
    registries: registries(Object.freeze({ ...authorizedMarket, status: 'validation' })),
  });
  assert.deepEqual(currentProductionResult.rankedCandidates, []);
  assert.equal(currentProductionResult.excludedCandidates[0]?.authorizationCode, 'MARKET_NOT_PRODUCTION_ENABLED');
  assert.deepEqual(validationMarketResult.rankedCandidates, []);
  assert.equal(validationMarketResult.excludedCandidates[0]?.authorizationCode, 'MARKET_NOT_PRODUCTION_ENABLED');
});

test('a null pWinGivenGrades is excluded before sorting', () => {
  const fullyVoid = candidate('fully-void', null, 1, neutralDiagnostics);
  const rankable = candidate('rankable', 0.55, 0.02, neutralDiagnostics);
  const result = rankPredictionCandidates({
    candidates: [fullyVoid, rankable],
    registries: registries(),
  });
  assert.deepEqual(result.rankedCandidates.map((entry) => entry.playerId), ['player-rankable']);
  assert.equal(result.excludedCandidates[0]?.reason, 'WIN_PROBABILITY_GIVEN_GRADES_UNAVAILABLE');
});

test('identical inputs produce deterministic stable order for exact ties', () => {
  const first = candidate('first', 0.63, 0.04, neutralDiagnostics);
  const second = candidate('second', 0.63, 0.04, {
    ...neutralDiagnostics,
    pBase: 0.95,
    contextProbabilityDelta: -0.32,
    price: 50,
    multiplier: 9,
    discoveryLabel: 'ignored',
  });
  const input = Object.freeze([second, first]);
  const firstRun = rankPredictionCandidates({ candidates: input, registries: registries() });
  const secondRun = rankPredictionCandidates({ candidates: input, registries: registries() });
  assert.deepEqual(firstRun.rankedCandidates.map((entry) => entry.playerId), ['player-second', 'player-first']);
  assert.deepEqual(firstRun, secondRun);
  assert.ok(Object.isFrozen(firstRun.rankedCandidates));
  assert.ok(Object.isFrozen(firstRun.excludedCandidates));
});
