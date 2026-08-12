import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import test from 'node:test';

import {
  evaluateFamilyBDistributionShapeGate,
  FAMILY_B_CANONICAL_MINIMUM_ROWS_PER_BIN,
  FAMILY_B_CANONICAL_TOLERANCE_CEILINGS,
  FAMILY_B_EQUAL_COUNT_BINNING_RULE,
} from '../scripts/m11-hhr-distribution-shape-diagnostic-utils.mjs';

const UTIL_PATH = path.resolve('scripts/m11-hhr-distribution-shape-diagnostic-utils.mjs');
const RUNNER_PATH = path.resolve('scripts/run-m11-hhr-v2-distribution-shape-diagnostic.mjs');
const BASE_CONFIGURATION = Object.freeze({
  binningRule: FAMILY_B_EQUAL_COUNT_BINNING_RULE,
  binCount: 5,
  minimumRowsPerBin: FAMILY_B_CANONICAL_MINIMUM_ROWS_PER_BIN,
  settlementThresholds: Object.freeze([1, 2, 3]),
  liveRequiredSettlementThresholds: Object.freeze([1, 2, 3]),
  tolerances: FAMILY_B_CANONICAL_TOLERANCE_CEILINGS,
});

function repeatedRows({ predictedProbabilities, observedCounts, fittedMean = 1.3, bins = 5 }) {
  const rows = [];
  for (let binIndex = 0; binIndex < bins; binIndex += 1) {
    for (let count = 0; count < observedCounts.length; count += 1) {
      for (let index = 0; index < observedCounts[count]; index += 1) {
        rows.push({ fittedMean, observedT: count, predictedProbabilities });
      }
    }
  }
  return rows;
}

function alphaOnlyRows() {
  const predicted = Object.freeze([0.3, 0.3, 0.2, 0.2, 0, 0, 0, 0, 0, 0, 0]);
  const rows = [];
  for (let binIndex = 0; binIndex < 5; binIndex += 1) {
    const counts = binIndex === 4
      ? new Map([[0, 150], [1, 150], [2, 100], [10, 100]])
      : new Map([[0, 150], [1, 150], [2, 100], [3, 100]]);
    for (const [count, rowCount] of counts) {
      for (let index = 0; index < rowCount; index += 1) rows.push({ fittedMean: 1.3, observedT: count, predictedProbabilities: predicted });
    }
  }
  return rows;
}

function poissonPmf(mu, maximumCount = 30) {
  const probabilities = [Math.exp(-mu)];
  for (let count = 1; count < maximumCount; count += 1) {
    probabilities.push(probabilities[count - 1] * mu / count);
  }
  const residual = 1 - probabilities.reduce((sum, value) => sum + value, 0);
  probabilities.push(Math.max(0, residual));
  const total = probabilities.reduce((sum, value) => sum + value, 0);
  return Object.freeze(probabilities.map((value) => value / total));
}

function fixedSeedRandom(seed = 0x5eed1234) {
  let state = seed >>> 0;
  return () => {
    state = (Math.imul(1664525, state) + 1013904223) >>> 0;
    return state / 0x100000000;
  };
}

function inverseCdf(probabilities, uniform) {
  let cumulative = 0;
  for (let count = 0; count < probabilities.length; count += 1) {
    cumulative += probabilities[count];
    if (uniform < cumulative || count === probabilities.length - 1) return count;
  }
  throw new Error('Synthetic inverse-CDF sampling failed.');
}

function selfGeneratedPassingRows() {
  const random = fixedSeedRandom();
  const rows = [];
  const rowsPerBin = 5000;
  for (const mu of [0.8, 1.1, 1.4, 1.7, 2.0]) {
    const probabilities = poissonPmf(mu);
    for (let index = 0; index < rowsPerBin; index += 1) {
      const uniform = (index + random()) / rowsPerBin;
      rows.push({ fittedMean: mu, observedT: inverseCdf(probabilities, uniform), predictedProbabilities: probabilities });
    }
  }
  return rows;
}

function exactPassingRows(rowsPerBin = 200) {
  const probabilities = Object.freeze([0.25, 0.25, 0.25, 0.25]);
  const counts = [
    Math.ceil(rowsPerBin / 4),
    Math.ceil((rowsPerBin - Math.ceil(rowsPerBin / 4)) / 3),
    Math.ceil((rowsPerBin - Math.ceil(rowsPerBin / 4) - Math.ceil((rowsPerBin - Math.ceil(rowsPerBin / 4)) / 3)) / 2),
  ];
  counts.push(rowsPerBin - counts.reduce((sum, value) => sum + value, 0));
  return repeatedRows({ predictedProbabilities: probabilities, observedCounts: counts, fittedMean: 1.5 });
}

function failureCodes(result) {
  return result.failureReasons.map((reason) => reason.code);
}

test('Step 3 diagnostic scripts pass Node syntax checking', () => {
  for (const scriptPath of [UTIL_PATH, RUNNER_PATH]) {
    const result = spawnSync(process.execPath, ['--check', scriptPath], { encoding: 'utf8' });
    assert.equal(result.status, 0, result.stderr || result.stdout);
  }
});

test('synthetic zero-mass misspecification is rejected and named explicitly', () => {
  const result = evaluateFamilyBDistributionShapeGate(repeatedRows({
    predictedProbabilities: Object.freeze([0.3, 0.3, 0.2, 0.2]),
    observedCounts: [160, 140, 100, 100],
  }), BASE_CONFIGURATION);
  assert.equal(result.verdict, 'FAIL');
  assert.ok(failureCodes(result).includes('ZERO_MASS_GAP_EXCEEDED'));
  assert.equal(result.summary.substantiveChecks.zeroMass.passed, false);
  assert.equal(result.summary.substantiveChecks.alphaRange.passed, true);
  // P(T>=1) is the exact complement of P(T=0), so a zero-mass breach must
  // also appear at threshold 1. The explicit zero reason proves attribution.
  assert.equal(result.summary.substantiveChecks.tails.byThreshold['1'], false);
});

test('synthetic tail-only misspecification is rejected at the correct threshold', () => {
  const result = evaluateFamilyBDistributionShapeGate(repeatedRows({
    predictedProbabilities: Object.freeze([0.3, 0.3, 0.2, 0.2]),
    observedCounts: [150, 140, 110, 100],
  }), BASE_CONFIGURATION);
  assert.equal(result.verdict, 'FAIL');
  assert.equal(result.summary.substantiveChecks.zeroMass.passed, true);
  assert.equal(result.summary.substantiveChecks.alphaRange.passed, true);
  assert.equal(result.summary.substantiveChecks.tails.byThreshold['1'], true);
  assert.equal(result.summary.substantiveChecks.tails.byThreshold['2'], false);
  assert.equal(result.summary.substantiveChecks.tails.byThreshold['3'], true);
  const tailReasons = result.failureReasons.filter((reason) => reason.code === 'TAIL_GAP_EXCEEDED');
  assert.deepEqual(tailReasons.map((reason) => reason.threshold), [2]);
});

test('synthetic alpha-drift misspecification is rejected without zero or required-tail drift', () => {
  const result = evaluateFamilyBDistributionShapeGate(alphaOnlyRows(), BASE_CONFIGURATION);
  assert.equal(result.verdict, 'FAIL');
  assert.equal(result.summary.substantiveChecks.zeroMass.passed, true);
  assert.equal(result.summary.substantiveChecks.tails.passed, true);
  assert.equal(result.summary.substantiveChecks.alphaRange.passed, false);
  assert.deepEqual(failureCodes(result), ['ALPHA_RANGE_EXCEEDED']);
});

test('fixed-seed data generated from its own PMF passes all three shape checks', () => {
  const result = evaluateFamilyBDistributionShapeGate(selfGeneratedPassingRows(), BASE_CONFIGURATION);
  assert.equal(result.verdict, 'PASS', JSON.stringify(result.failureReasons));
  assert.equal(result.summary.structuralFailure, false);
  assert.equal(result.summary.substantiveChecks.zeroMass.passed, true);
  assert.equal(result.summary.substantiveChecks.tails.passed, true);
  assert.equal(result.summary.substantiveChecks.alphaRange.passed, true);
});

test('fewer than five fitted-mu bins fails closed', () => {
  const result = evaluateFamilyBDistributionShapeGate(exactPassingRows(250), { ...BASE_CONFIGURATION, binCount: 4 });
  assert.equal(result.verdict, 'FAIL');
  assert.ok(failureCodes(result).includes('BIN_COUNT_BELOW_MINIMUM'));
});

test('any required fitted-mu bin under 200 rows fails closed', () => {
  const result = evaluateFamilyBDistributionShapeGate(exactPassingRows(199), BASE_CONFIGURATION);
  assert.equal(result.verdict, 'FAIL');
  assert.ok(failureCodes(result).includes('BIN_ROW_COUNT_BELOW_MINIMUM'));
});

test('a missing required settlement threshold fails closed', () => {
  const result = evaluateFamilyBDistributionShapeGate(exactPassingRows(), { ...BASE_CONFIGURATION, settlementThresholds: [1, 2] });
  assert.equal(result.verdict, 'FAIL');
  assert.ok(result.failureReasons.some((reason) => reason.code === 'MISSING_REQUIRED_THRESHOLD' && reason.threshold === 3));
});

test('an undeclared tolerance fails closed', () => {
  const result = evaluateFamilyBDistributionShapeGate(exactPassingRows(), {
    ...BASE_CONFIGURATION,
    tolerances: { tauZero: undefined, tauTail: 0.010, tauAlpha: 0.150 },
  });
  assert.equal(result.verdict, 'FAIL');
  assert.ok(result.failureReasons.some((reason) => reason.code === 'UNDECLARED_TOLERANCE' && reason.tolerance === 'tauZero'));
});

test('a tolerance looser than the canonical ceiling fails on that basis alone', () => {
  const result = evaluateFamilyBDistributionShapeGate(exactPassingRows(), {
    ...BASE_CONFIGURATION,
    tolerances: { tauZero: 0.011, tauTail: 0.010, tauAlpha: 0.150 },
  });
  assert.equal(result.verdict, 'FAIL');
  assert.deepEqual(failureCodes(result), ['TOLERANCE_ABOVE_CANONICAL_CEILING']);
  assert.equal(result.failureReasons[0].tolerance, 'tauZero');
});

test('real frozen v2 runner exits nonzero only after cleanly breaching zero, tail, and alpha gates', async () => {
  const directory = await mkdtemp(path.join(tmpdir(), 'm11-hhr-v2-shape-'));
  const outputPath = path.join(directory, 'diagnostic.json');
  try {
    const result = spawnSync(process.execPath, [RUNNER_PATH, '--output', outputPath], { encoding: 'utf8' });
    assert.equal(result.status, 1, `${result.stdout}\n${result.stderr}`);
    assert.match(result.stderr, /EXPECTED PROTECTIVE FAILURE/u);
    const report = JSON.parse(await readFile(outputPath, 'utf8'));
    assert.equal(report.gate.verdict, 'FAIL');
    assert.equal(report.gate.summary.structuralFailure, false);
    assert.equal(report.gate.summary.substantiveChecks.zeroMass.passed, false);
    assert.equal(report.gate.summary.substantiveChecks.tails.passed, false);
    assert.equal(report.gate.summary.substantiveChecks.alphaRange.passed, false);
    assert.ok(failureCodes(report.gate).includes('ZERO_MASS_GAP_EXCEEDED'));
    assert.ok(failureCodes(report.gate).includes('TAIL_GAP_EXCEEDED'));
    assert.ok(failureCodes(report.gate).includes('ALPHA_RANGE_EXCEEDED'));
    console.log(result.stdout.trim());
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
