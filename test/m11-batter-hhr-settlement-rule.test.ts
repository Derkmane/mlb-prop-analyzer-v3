import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';

import { SETTLEMENT_REGISTRY } from '../src/composition/registries.js';
import { createProbabilityMassFunction } from '../src/core/index.js';
import type { BatterHhrDirectCompositeDistribution } from '../src/features/batter-hhr/contracts.js';
import {
  BATTER_HHR_DISTRIBUTION_BUILDER_VERSION,
  BATTER_HHR_MATHEMATICAL_FAMILY,
  BATTER_HHR_MAXIMUM_EXACT_POSTED_LINE,
  BATTER_HHR_MODEL_VERSION,
  BATTER_HHR_SETTLEMENT_RULE_VERSION,
  BATTER_HHR_TAIL_COLLAPSE_AT,
} from '../src/features/batter-hhr/contracts.js';
import { settleBatterHhrDistribution } from '../src/features/batter-hhr/distribution.js';
import { BATTER_HHR_MARKET_KEY } from '../src/features/batter-hhr/manifest.js';

const RULE_FIXTURE_PATH = path.resolve(
  'fixtures/sanitized/m11/hhr/settlement/underdog-batter-hhr-settlement-v1.json',
);
const RULE_FIXTURE = JSON.parse(fs.readFileSync(RULE_FIXTURE_PATH, 'utf8')) as {
  settlementRuleVersion: string;
  market: string;
  officialSettlementStatistic: string;
  sourcePublishedAt: string;
  sourcePublicationBoundaryBasis: string;
  governingRuleContext: { rulesInEffectAtEntryGovern: boolean };
  sources: readonly { title: string; url: string }[];
  normalizedRules: {
    startRequirement: string;
    laterSubstituteHandling: string;
    tieHandling: string;
  };
};

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

test('HHR settlement registration is versioned to the sanitized official-rule reference', () => {
  const rule = SETTLEMENT_REGISTRY.rules.find((row) => row.baseMarketKey === BATTER_HHR_MARKET_KEY);
  assert.ok(rule);
  assert.equal(rule.version, BATTER_HHR_SETTLEMENT_RULE_VERSION);
  assert.equal(rule.officialSettlementStatistic, 'hits+runs+rbis');
  assert.equal(rule.ruleSourceReference, path.relative('.', RULE_FIXTURE_PATH));
  assert.ok('sourcePublishedAt' in rule);
  assert.equal(rule.sourcePublishedAt, RULE_FIXTURE.sourcePublishedAt);
  assert.equal('effectiveDate' in rule, false);
  assert.equal(RULE_FIXTURE.settlementRuleVersion, BATTER_HHR_SETTLEMENT_RULE_VERSION);
  assert.equal(RULE_FIXTURE.market, 'batter-hhr');
  assert.equal(RULE_FIXTURE.officialSettlementStatistic, 'hits+runs+rbis');
  assert.equal(RULE_FIXTURE.governingRuleContext.rulesInEffectAtEntryGovern, true);
  assert.match(
    RULE_FIXTURE.sourcePublicationBoundaryBasis,
    /^Verified rule-version publication boundary per CANONICAL_MATH_SPEC\.md §12\.1\(b\): latest publication date among the official Underdog rule sources used by this rule bundle\. This is not an operator-designated effective date\.$/u,
  );
  assert.ok(RULE_FIXTURE.sources.length >= 5);
  for (const source of RULE_FIXTURE.sources) {
    assert.match(source.url, /^https:\/\/(help\.underdogsports\.com|legal\.underdogsports\.com)\//u);
  }
  assert.match(RULE_FIXTURE.normalizedRules.startRequirement, /official starting lineup/u);
  assert.match(RULE_FIXTURE.normalizedRules.laterSubstituteHandling, /void/u);
  assert.match(RULE_FIXTURE.normalizedRules.tieHandling, /void/u);
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
