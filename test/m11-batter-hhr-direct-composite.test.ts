import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';

import {
  FEATURE_REGISTRY,
  IMPLEMENTED_MARKET_REGISTRY,
  MARKET_KEY_OWNERSHIP,
  PLANNED_MARKET_CATALOG,
} from '../src/composition/index.js';
import {
  BATTER_HHR_ALTERNATE_PROVIDER_MARKET_KEY,
  BATTER_HHR_BASELINE_PROVIDER_MARKET_KEY,
  BATTER_HHR_FEATURE_ID,
  BATTER_HHR_MARKET_KEY,
  buildBatterHhrDirectCompositeDistribution,
  normalizeUnderdogBatterHhrCapture,
  settleBatterHhrDistribution,
  settleBatterHhrOffers,
  validateBatterHhrDirectCompositeArtifact,
  type BatterHhrDirectCompositeArtifact,
  type BatterHhrDistributionInput,
} from '../src/features/batter-hhr/index.js';

const ARTIFACT_PATH = path.resolve(
  'model-artifacts/m11-batter-hhr-direct-composite-v1.json',
);
const BOARD_FIXTURE_PATH = path.resolve(
  'fixtures/sanitized/m11/hhr/2026-08-05/the-odds-api-underdog-hhr-v1.json',
);

const categories = Object.freeze([
  'K',
  'UBB',
  'IBB',
  'HBP',
  '1B',
  '2B',
  '3B',
  'HR',
  'ROE',
  'FC',
  'SF',
  'SH',
  'BIP_OUT',
  'CATCHER_INTERFERENCE',
]);
const vector = Object.freeze({
  K: 0.2,
  UBB: 0.08,
  IBB: 0.01,
  HBP: 0.02,
  '1B': 0.14,
  '2B': 0.05,
  '3B': 0.01,
  HR: 0.04,
  ROE: 0.02,
  FC: 0.03,
  SF: 0.03,
  SH: 0.01,
  BIP_OUT: 0.36,
  CATCHER_INTERFERENCE: 0,
});

async function loadArtifact(): Promise<BatterHhrDirectCompositeArtifact> {
  return JSON.parse(await readFile(ARTIFACT_PATH, 'utf8')) as BatterHhrDirectCompositeArtifact;
}

async function loadOffers() {
  return normalizeUnderdogBatterHhrCapture(
    JSON.parse(await readFile(BOARD_FIXTURE_PATH, 'utf8')),
  );
}

function exampleInput(): BatterHhrDistributionInput {
  return {
    contextAdjustedTerminalOutcomeVector: vector,
    terminalOutcomeCategories: categories,
    expectedPlateAppearances: 4.4,
    lineupSlot: 2,
  };
}

test('HHR artifact is one direct Family B fit with production and step-3 gates closed', async () => {
  const artifact = validateBatterHhrDirectCompositeArtifact(await loadArtifact());
  assert.equal(artifact.mathematicalFamily, 'directly-fitted-composite');
  assert.equal(artifact.officialSettlementStatistic, 'hits+runs+rbis');
  assert.equal(artifact.productionEnabled, false);
  assert.equal(artifact.validationStatus, 'not-production-validated');
  assert.equal(artifact.calibrationStatus, 'step-3-required');
  assert.equal(artifact.boxScoreVerificationStatus, 'step-3-required');
  const details = (artifact as unknown as { fittingDetails: Record<string, unknown> }).fittingDetails;
  assert.equal(details.independentMarginalConvolution, false);
  assert.equal(details.tripleJointFormed, false);
  assert.equal(details.monteCarloRuntime, false);
  assert.deepEqual(artifact.usedConditioningInputs, [
    'context-adjusted-terminal-outcome-vector',
    'expected-plate-appearances',
    'lineup-slot',
  ]);
});

test('HHR direct analytic distribution conserves mass and is side independent', async () => {
  const artifact = await loadArtifact();
  const input = exampleInput();
  const higherTagged = buildBatterHhrDirectCompositeDistribution(
    artifact,
    { ...input, selectedSide: 'higher' } as BatterHhrDistributionInput,
  );
  const lowerTagged = buildBatterHhrDirectCompositeDistribution(
    artifact,
    { ...input, selectedSide: 'lower' } as BatterHhrDistributionInput,
  );
  assert.deepEqual(higherTagged, lowerTagged);
  assert.equal(higherTagged.productionEnabled, false);
  assert.equal(higherTagged.statisticDistribution.probabilities.length, 65);
  assert.ok(
    Math.abs(
      higherTagged.statisticDistribution.probabilities.reduce(
        (sum, mass) => sum + mass,
        0,
      ) - 1,
    ) <= 1e-12,
  );
});

test('HHR Higher falls and Lower rises across the 0.5 through 3.5 ladder', async () => {
  const distribution = buildBatterHhrDirectCompositeDistribution(
    await loadArtifact(),
    exampleInput(),
  );
  const lines = [0.5, 1.5, 2.5, 3.5];
  const higher = lines.map((line) =>
    settleBatterHhrDistribution(distribution, 'higher', line, 1),
  );
  const lower = lines.map((line) =>
    settleBatterHhrDistribution(distribution, 'lower', line, 1),
  );
  for (let index = 1; index < lines.length; index += 1) {
    assert.ok(
      higher[index]!.winProbability < higher[index - 1]!.winProbability,
    );
    assert.ok(
      lower[index]!.winProbability > lower[index - 1]!.winProbability,
    );
  }
  for (let index = 0; index < lines.length; index += 1) {
    assert.equal(higher[index]!.voidProbability, 0);
    assert.equal(lower[index]!.voidProbability, 0);
    assert.equal(higher[index]!.winProbability, lower[index]!.lossProbability);
    assert.equal(higher[index]!.lossProbability, lower[index]!.winProbability);
  }
});

test('every live fixture offer preserves its own line and settles from one distribution', async () => {
  const offers = await loadOffers();
  const distribution = buildBatterHhrDirectCompositeDistribution(
    await loadArtifact(),
    exampleInput(),
  );
  const settled = settleBatterHhrOffers(distribution, offers, 1);
  assert.equal(settled.length, offers.length);
  assert.ok(offers.some((offer) => offer.offerType === 'baseline'));
  assert.ok(offers.some((offer) => offer.offerType === 'alternate'));
  assert.deepEqual(
    [...new Set(offers.map((offer) => offer.line))].sort((left, right) => left - right),
    [0.5, 1.5, 2.5],
  );
  for (const [index, result] of settled.entries()) {
    assert.strictEqual(result.distribution, distribution);
    assert.equal(result.settlement.line, offers[index]!.line);
    assert.equal(result.settlement.selectedSide, offers[index]!.selectedSide);
  }
});

test('HHR provider capture is exact Underdog us_dfs baseline plus alternate evidence', async () => {
  const offers = await loadOffers();
  assert.ok(offers.length > 0);
  assert.ok(
    offers.every(
      (offer) => offer.bookmaker === 'underdog' && offer.region === 'us_dfs',
    ),
  );
  assert.deepEqual(
    [...new Set(offers.map((offer) => offer.providerMarketKey))].sort(),
    [
      BATTER_HHR_BASELINE_PROVIDER_MARKET_KEY,
      BATTER_HHR_ALTERNATE_PROVIDER_MARKET_KEY,
    ].sort(),
  );
});

test('HHR registry ownership transfers from planned catalog and remains disabled', () => {
  assert.equal(
    PLANNED_MARKET_CATALOG.some(
      (market) => market.baseMarketKey === BATTER_HHR_MARKET_KEY,
    ),
    false,
  );
  const market = IMPLEMENTED_MARKET_REGISTRY.find(
    (entry) => entry.baseMarketKey === BATTER_HHR_MARKET_KEY,
  );
  assert.ok(market);
  assert.equal(market.mathematicalFamily, 'directly-fitted-composite');
  assert.equal(market.distributionBuilderValidated, false);
  assert.equal(market.status, 'model-under-development');
  assert.deepEqual(market.providerMarketKeys, [
    BATTER_HHR_BASELINE_PROVIDER_MARKET_KEY,
    BATTER_HHR_ALTERNATE_PROVIDER_MARKET_KEY,
  ]);
  assert.deepEqual(
    FEATURE_REGISTRY.find((entry) => entry.featureId === BATTER_HHR_FEATURE_ID),
    {
      featureId: BATTER_HHR_FEATURE_ID,
      enabled: false,
      status: 'model-under-development',
    },
  );
  assert.deepEqual(
    MARKET_KEY_OWNERSHIP.find(
      (entry) => entry.baseMarketKey === BATTER_HHR_MARKET_KEY,
    ),
    {
      baseMarketKey: BATTER_HHR_MARKET_KEY,
      ownerType: 'feature-manifest',
      ownerId: BATTER_HHR_FEATURE_ID,
    },
  );
});

test('HHR fails closed on malformed vectors, unsupported lines, and side-bearing artifacts', async () => {
  const artifact = await loadArtifact();
  assert.throws(
    () =>
      buildBatterHhrDirectCompositeDistribution(artifact, {
        ...exampleInput(),
        contextAdjustedTerminalOutcomeVector: {
          ...vector,
          HR: undefined,
        } as unknown as typeof vector,
      }),
    /every and only modeled category|probability/u,
  );
  const distribution = buildBatterHhrDirectCompositeDistribution(
    artifact,
    exampleInput(),
  );
  assert.throws(
    () => settleBatterHhrDistribution(distribution, 'higher', 64.5, 1),
    /between 0 and 63\.5/u,
  );
  assert.throws(
    () =>
      validateBatterHhrDirectCompositeArtifact({
        ...artifact,
        selectedSide: 'higher',
      } as unknown as BatterHhrDirectCompositeArtifact),
    /selectedSide is prohibited/u,
  );
});
