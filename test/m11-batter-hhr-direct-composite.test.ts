import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';

import {
  buildBatterHhrDirectCompositeDistribution,
  normalizeUnderdogBatterHhrCapture,
  settleBatterHhrDistribution,
  settleBatterHhrOffers,
  validateBatterHhrDirectCompositeArtifact,
  type BatterHhrDirectCompositeArtifact,
  type BatterHhrDistributionInput,
} from '../src/features/batter-hhr/index.js';

const MODEL_PATH = path.resolve('model-artifacts/m11-batter-hhr-direct-composite-v2.json');
const DIAGNOSTICS_PATH = path.resolve('model-artifacts/m11-batter-hhr-direct-composite-diagnostics-v2.json');
const FIXTURE_PATH = path.resolve('fixtures/sanitized/m11/hhr/respecified-v2/balldontlie-hhr-design-matrix-v2.json');
const BOARD_PATH = path.resolve('fixtures/sanitized/m11/hhr/respecified-v2/the-odds-api-underdog-hhr-board-v2.json');
const REQUIRED_INPUTS = [
  'context-adjusted-terminal-outcome-vector','expected-plate-appearances','lineup-slot','platoon-split-cell',
  'opposing-starter-pooling','team-implied-run-total','preceding-lineup-slots-on-base-quality',
];

async function evidence() {
  const [model, diagnostics, fixture, board] = await Promise.all([
    readFile(MODEL_PATH, 'utf8').then(JSON.parse),
    readFile(DIAGNOSTICS_PATH, 'utf8').then(JSON.parse),
    readFile(FIXTURE_PATH, 'utf8').then(JSON.parse),
    readFile(BOARD_PATH, 'utf8').then(JSON.parse),
  ]);
  const row = fixture.rows[0];
  const input: BatterHhrDistributionInput = {
    contextAdjustedTerminalOutcomeVector: row.conditioningInputs.contextAdjustedTerminalOutcomeVector,
    terminalOutcomeCategories: Object.keys(row.conditioningInputs.contextAdjustedTerminalOutcomeVector),
    expectedPlateAppearances: row.conditioningInputs.expectedPlateAppearances,
    lineupSlot: row.conditioningInputs.lineupSlot,
    platoonSplitCell: row.conditioningInputs.platoonSplitCell,
    opposingStarterPooling: row.conditioningInputs.opposingStarterPooling,
    teamImpliedRunTotal: row.conditioningInputs.teamImpliedRunTotal,
    precedingLineupSlotsOnBaseQuality: row.conditioningInputs.precedingLineupSlotsOnBaseQuality,
  };
  return { model: model as BatterHhrDirectCompositeArtifact, diagnostics, fixture, board, input };
}

function total(probabilities: readonly number[]) {
  return probabilities.reduce((sum, value) => sum + value, 0);
}

test('HHR artifact is one direct Family B offset fit using all seven inputs with production closed', async () => {
  const { model } = await evidence();
  const validated = validateBatterHhrDirectCompositeArtifact(model);
  assert.equal(validated.mathematicalFamily, 'directly-fitted-composite');
  assert.equal(validated.fittingDetails.expectedPlateAppearancesRole, 'offset');
  assert.equal(validated.fittingDetails.expectedPlateAppearancesCoefficient, 1);
  assert.equal(validated.fittingDetails.coefficientScale, 'standardized-per-sample-standard-deviation');
  assert.deepEqual(validated.usedConditioningInputs, REQUIRED_INPUTS);
  assert.deepEqual(validated.excludedConditioningInputs, []);
  assert.equal(validated.fittingDetails.independentMarginalConvolution, false);
  assert.equal(validated.fittingDetails.tripleJointFormed, false);
  assert.equal(validated.productionEnabled, false);
  assert.equal(validated.calibrationStatus, 'step-3-required');
  assert.equal(validated.boxScoreVerificationStatus, 'step-3-required');
});

test('HHR retained diagnostics pass VIF, lineup magnitude, quality-spread, and exclusion conservation gates', async () => {
  const { diagnostics, fixture } = await evidence();
  assert.equal(diagnostics.acceptanceGates.vif.passed, true);
  assert.ok(Object.values(diagnostics.varianceInflationFactors).every((value) => typeof value === 'number' && value <= 5));
  assert.equal(diagnostics.acceptanceGates.lineupSlotMagnitude.passed, true);
  assert.ok(Math.abs(diagnostics.coefficientInference.centeredLineupSlot.estimate) < 0.15);
  assert.equal(diagnostics.coefficientScale, 'standardized-per-sample-standard-deviation');
  assert.deepEqual(diagnostics.predictorStandardDeviations, Object.fromEntries(Object.entries(diagnostics.predictorSummaries).slice(0, 6).map(([name, value]: [string, any]) => [name, value.standardDeviation])));
  assert.equal(typeof diagnostics.confidenceIntervalsExcludingZero.count, 'number');
  assert.equal(diagnostics.acceptanceGates.batterQualitySpread.passed, true);
  assert.ok(diagnostics.qualitySpreadBySlot.every((row: { readonly ratio: number }) => row.ratio >= 1.10));
  assert.equal(diagnostics.nineCellPredictionTable.length, 9);
  assert.equal(Object.values(fixture.exclusionCounts).reduce((sum: number, value) => sum + Number(value), 0), fixture.excludedRowCount);
  assert.equal(fixture.exclusionCountSum, fixture.excludedRowCount);
  assert.equal(fixture.expectedPaRole, 'log offset with fixed coefficient 1');
  assert.equal(fixture.rows.some((row: { readonly derivedPredictors: Readonly<Record<string, unknown>> }) => 'terminalHitProbability' in row.derivedPredictors), false);
});

test('HHR direct analytic distribution conserves mass and remains side independent', async () => {
  const { model, input } = await evidence();
  const distribution = buildBatterHhrDirectCompositeDistribution(model, input);
  assert.ok(Math.abs(total(distribution.statisticDistribution.probabilities) - 1) < 1e-12);
  assert.ok(distribution.mean > 0);
  assert.equal(distribution.productionEnabled, false);
  const higher = settleBatterHhrDistribution(distribution, 'higher', 1.5);
  const lower = settleBatterHhrDistribution(distribution, 'lower', 1.5);
  assert.ok(Math.abs(higher.winProbability - lower.lossProbability) < 1e-12);
  assert.ok(Math.abs(higher.lossProbability - lower.winProbability) < 1e-12);
  assert.ok(Math.abs(higher.voidProbability - lower.voidProbability) < 1e-12);
});

test('HHR Higher falls and Lower rises across the 0.5 through 3.5 ladder', async () => {
  const { model, input } = await evidence();
  const distribution = buildBatterHhrDirectCompositeDistribution(model, input);
  const lines = [0.5,1.5,2.5,3.5];
  const higher = lines.map((line) => settleBatterHhrDistribution(distribution, 'higher', line).winProbability);
  const lower = lines.map((line) => settleBatterHhrDistribution(distribution, 'lower', line).winProbability);
  for (let index = 1; index < lines.length; index += 1) {
    assert.ok(higher[index]! <= higher[index - 1]!);
    assert.ok(lower[index]! >= lower[index - 1]!);
  }
});

test('every captured baseline and alternate offer preserves its line and settles from one distribution', async () => {
  const { model, input, board } = await evidence();
  const offers = normalizeUnderdogBatterHhrCapture(board);
  assert.ok(offers.some((offer) => offer.offerType === 'baseline'));
  assert.ok(offers.some((offer) => offer.offerType === 'alternate'));
  const distribution = buildBatterHhrDirectCompositeDistribution(model, input);
  const settled = settleBatterHhrOffers(distribution, offers);
  assert.equal(settled.length, offers.length);
  settled.forEach((row, index) => {
    assert.strictEqual(row.distribution, distribution);
    assert.equal(row.offer.line, offers[index]?.line);
    assert.equal(row.offer.selectedSide, offers[index]?.selectedSide);
  });
});

test('HHR fails closed on missing canonical inputs, malformed vectors, unsupported lines, and side-bearing artifacts', async () => {
  const { model, input } = await evidence();
  assert.throws(() => buildBatterHhrDirectCompositeDistribution(model, { ...input, expectedPlateAppearances: 0 }), /positive/u);
  assert.throws(() => buildBatterHhrDirectCompositeDistribution(model, { ...input, platoonSplitCell: Number.NaN }), /finite/u);
  const malformed = { ...input.contextAdjustedTerminalOutcomeVector, HR: Number.NaN };
  assert.throws(() => buildBatterHhrDirectCompositeDistribution(model, { ...input, contextAdjustedTerminalOutcomeVector: malformed }), /finite|probability/u);
  const distribution = buildBatterHhrDirectCompositeDistribution(model, input);
  assert.throws(() => settleBatterHhrDistribution(distribution, 'higher', 64.5), /between/u);
  assert.throws(() => validateBatterHhrDirectCompositeArtifact({ ...model, selectedSide: 'higher' } as unknown as BatterHhrDirectCompositeArtifact), /prohibited/u);
});
