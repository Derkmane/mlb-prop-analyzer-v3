import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';

import { SETTLEMENT_REGISTRY } from '../src/composition/registries.js';
import { createProbabilityMassFunction } from '../src/core/index.js';
import type { BatterHhrDirectCompositeDistribution } from '../src/features/batter-hhr/contracts.js';
import {
  BATTER_HHR_DISTRIBUTION_BUILDER_VERSION,
  BATTER_HHR_DRAFTKINGS_SETTLEMENT_RULE_SOURCE_REFERENCE,
  BATTER_HHR_DRAFTKINGS_SETTLEMENT_RULE_VERSION,
  BATTER_HHR_MATHEMATICAL_FAMILY,
  BATTER_HHR_MAXIMUM_EXACT_POSTED_LINE,
  BATTER_HHR_MODEL_VERSION,
  BATTER_HHR_SETTLEMENT_RULE_VERSION,
  BATTER_HHR_TAIL_COLLAPSE_AT,
} from '../src/features/batter-hhr/contracts.js';
import { settleBatterHhrDistribution } from '../src/features/batter-hhr/distribution.js';
import { BATTER_HHR_MARKET_KEY } from '../src/features/batter-hhr/manifest.js';

const DRAFTKINGS_RULE_REFERENCE_PATH = path.resolve(
  BATTER_HHR_DRAFTKINGS_SETTLEMENT_RULE_SOURCE_REFERENCE,
);
const DRAFTKINGS_RULE_REFERENCE = fs.readFileSync(DRAFTKINGS_RULE_REFERENCE_PATH, 'utf8');

const TEST_DISTRIBUTION: BatterHhrDirectCompositeDistribution = Object.freeze({
  modelVersion: BATTER_HHR_MODEL_VERSION,
  distributionBuilderVersion: BATTER_HHR_DISTRIBUTION_BUILDER_VERSION,
  mathematicalFamily: BATTER_HHR_MATHEMATICAL_FAMILY,
  officialSettlementStatistic: 'hits+runs+rbis',
  mean: 1,
  dispersionAlpha: 1,
  statisticDistribution: createProbabilityMassFunction([0.25, 0.5, 0.25], 'HHR settlement-rule test PMF'),
  tailCollapsedAt: BATTER_HHR_TAIL_COLLAPSE_AT,
  maximumExactPostedLine: BATTER_HHR_MAXIMUM_EXACT_POSTED_LINE,
  productionEnabled: false,
});

test('HHR active settlement registration is DraftKings-bound while historical Underdog remains isolated', () => {
  const activeRule = SETTLEMENT_REGISTRY.rules.find(
    (row) => row.baseMarketKey === BATTER_HHR_MARKET_KEY && row.boardSource === 'draftkings',
  );
  assert.ok(activeRule);
  assert.equal(activeRule.version, BATTER_HHR_DRAFTKINGS_SETTLEMENT_RULE_VERSION);
  assert.equal(activeRule.officialSettlementStatistic, 'hits+runs+rbis');
  assert.equal(activeRule.ruleSourceReference, BATTER_HHR_DRAFTKINGS_SETTLEMENT_RULE_SOURCE_REFERENCE);
  assert.ok('sourcePublishedAt' in activeRule);
  assert.equal(activeRule.sourcePublishedAt, '2025-08-26');
  assert.equal('effectiveDate' in activeRule, false);
  assert.match(DRAFTKINGS_RULE_REFERENCE, /As of August 26, 2025/u);
  assert.match(
    DRAFTKINGS_RULE_REFERENCE,
    /https:\/\/sportsbook\.draftkings\.com\/help\/sport-rules\/baseball/u,
  );

  const historicalRule = SETTLEMENT_REGISTRY.rules.find(
    (row) => row.baseMarketKey === BATTER_HHR_MARKET_KEY && row.boardSource === null,
  );
  assert.ok(historicalRule);
  assert.equal(historicalRule.version, BATTER_HHR_SETTLEMENT_RULE_VERSION);
  assert.equal(historicalRule.officialSettlementStatistic, 'hits+runs+rbis');
  assert.match(historicalRule.ruleSourceReference, /underdog-batter-hhr-settlement-v1\.json$/u);
});

test('HHR nonstarter eligibility is a full void and cannot become a Higher or Lower win', () => {
  for (const selectedSide of ['higher', 'lower'] as const) {
    const settlement = settleBatterHhrDistribution(TEST_DISTRIBUTION, selectedSide, 0.5, 0);
    assert.equal(settlement.eligibilityProbability, 0);
    assert.equal(settlement.winProbability, 0);
    assert.equal(settlement.lossProbability, 0);
    assert.equal(settlement.voidProbability, 1);
    assert.equal(settlement.winProbabilityGivenGrades, null);
  }
});

test('HHR eligible starter settlement is side-symmetric at the same half-point line', () => {
  const higher = settleBatterHhrDistribution(TEST_DISTRIBUTION, 'higher', 0.5, 1);
  const lower = settleBatterHhrDistribution(TEST_DISTRIBUTION, 'lower', 0.5, 1);
  assert.equal(higher.winProbability, 0.75);
  assert.equal(higher.lossProbability, 0.25);
  assert.equal(higher.voidProbability, 0);
  assert.equal(higher.winProbabilityGivenGrades, 0.75);
  assert.equal(lower.winProbability, 0.25);
  assert.equal(lower.lossProbability, 0.75);
  assert.equal(lower.voidProbability, 0);
  assert.equal(lower.winProbabilityGivenGrades, 0.25);
  assert.equal(higher.winProbability, lower.lossProbability);
  assert.equal(higher.lossProbability, lower.winProbability);
});

test('HHR exact-line ties void identically for Higher and Lower', () => {
  const higher = settleBatterHhrDistribution(TEST_DISTRIBUTION, 'higher', 1, 1);
  const lower = settleBatterHhrDistribution(TEST_DISTRIBUTION, 'lower', 1, 1);
  assert.equal(higher.voidProbability, 0.5);
  assert.equal(lower.voidProbability, 0.5);
  assert.equal(higher.winProbability, 0.25);
  assert.equal(higher.lossProbability, 0.25);
  assert.equal(lower.winProbability, 0.25);
  assert.equal(lower.lossProbability, 0.25);
  assert.equal(higher.winProbabilityGivenGrades, 0.5);
  assert.equal(lower.winProbabilityGivenGrades, 0.5);
});
