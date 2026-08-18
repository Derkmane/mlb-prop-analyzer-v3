import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import test from 'node:test';

import { normalizeUnderdogBatterHhrCapture } from '../dist/src/features/batter-hhr/index.js';
import {
  evaluateHhrHurdleSuccessor,
  HHR_SUCCESSOR_MODEL_VERSION,
} from '../scripts/m11-hhr-hurdle-successor-fit-utils.mjs';

const FIXTURE_PATH = path.resolve('fixtures/sanitized/m11/hhr/respecified-v2/balldontlie-hhr-design-matrix-v2.json');
const OLD_MODEL_PATH = path.resolve('model-artifacts/m11-batter-hhr-direct-composite-v2.json');
const BOARD_PATH = path.resolve('fixtures/sanitized/m11/hhr/respecified-v2/the-odds-api-underdog-hhr-board-v2.json');
const UTILITY_PATH = path.resolve('scripts/m11-hhr-hurdle-successor-fit-utils.mjs');
const RUNNER_PATH = path.resolve('scripts/run-m11-hhr-hurdle-successor-fit.mjs');

function thresholdFromHalfPointLine(line) {
  assert.equal(typeof line, 'number');
  assert.ok(Number.isFinite(line));
  return Math.floor(line) + 1;
}

function runNodeCheck(filePath) {
  const result = spawnSync(process.execPath, ['--check', filePath], { encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr || result.stdout);
}

test('HHR conditioned-hurdle successor fits positive rows deterministically and passes the pre-freeze zero/tail gate', async () => {
  runNodeCheck(UTILITY_PATH);
  runNodeCheck(RUNNER_PATH);

  const directory = await mkdtemp(path.join(tmpdir(), 'm11-hhr-hurdle-successor-'));
  const outputPath = path.join(directory, 'fit.json');
  try {
    const runner = spawnSync(process.execPath, [RUNNER_PATH, '--output', outputPath], {
      cwd: process.cwd(),
      encoding: 'utf8',
      maxBuffer: 8 * 1024 * 1024,
    });
    assert.equal(runner.status, 0, `${runner.stdout}\n${runner.stderr}`);

    const report = JSON.parse(await readFile(outputPath, 'utf8'));
    assert.equal(report.modelVersion, HHR_SUCCESSOR_MODEL_VERSION);
    assert.deepEqual(report.cohort, {
      fullRowCount: 5964,
      zeroRowCount: 1977,
      positiveRowCount: 3987,
    });
    assert.equal(report.positiveFit.rowCount, 3987);
    assert.equal(report.positiveFit.fittingMethod, 'zero-truncated-negative-binomial-2-log-link-damped-newton-v1');
    assert.equal(report.positiveFit.optimization.convergence, 'damped-newton-analytic-gradient-numerical-hessian-v1');
    assert.ok(report.positiveFit.optimization.maxAbsoluteGradient <= 2e-6);
    assert.equal(report.positiveFit.expectedPlateAppearancesCoefficient, 1);
    assert.equal(report.productionEnabled, false);
    assert.equal(report.rankingEnabled, false);
    assert.equal(report.untouchedEvidenceRead, false);
    assert.equal(report.successorAcceptance.alphaImpliedInformationalOnly, true);
    assert.equal(report.successorAcceptance.structuralPassed, true);
    assert.equal(report.successorAcceptance.zeroMassPassed, true);
    assert.equal(report.successorAcceptance.settlementTailsPassed, true);
    assert.equal(report.successorAcceptance.passed, true);
    assert.ok(report.shapeGate.summary.maxZeroGap <= 0.010);
    for (const threshold of Object.values(report.shapeGate.summary.maxTailGapByThreshold)) {
      assert.ok(threshold.maximum <= 0.010, `tail threshold ${threshold.threshold} gap ${threshold.maximum} exceeds 0.010`);
    }

    const [fixtureText, oldModelText, boardText] = await Promise.all([
      readFile(FIXTURE_PATH, 'utf8'),
      readFile(OLD_MODEL_PATH, 'utf8'),
      readFile(BOARD_PATH, 'utf8'),
    ]);
    const fixture = JSON.parse(fixtureText);
    const oldModel = JSON.parse(oldModelText);
    const offers = normalizeUnderdogBatterHhrCapture(JSON.parse(boardText));
    const liveRequiredSettlementThresholds = [...new Set(
      offers.map((offer) => thresholdFromHalfPointLine(offer.line)),
    )].sort((left, right) => left - right);
    const rerun = evaluateHhrHurdleSuccessor({
      fixture,
      fixtureText,
      oldModel,
      liveRequiredSettlementThresholds,
    });

    assert.deepEqual(rerun.positiveFit, report.positiveFit, 'positive-count refit must be deterministic');
    assert.deepEqual(rerun.shapeGate, report.shapeGate, 'shape-gate evidence must be deterministic');
    assert.deepEqual(rerun.successorAcceptance, report.successorAcceptance, 'successor verdict must be deterministic');

    console.log('HHR SUCCESSOR POSITIVE COEFFICIENTS:', JSON.stringify(report.positiveFit.coefficients));
    console.log('HHR SUCCESSOR DISPERSION ALPHA:', report.positiveFit.dispersionAlpha);
    console.log('HHR SUCCESSOR OPTIMIZER ITERATIONS:', report.positiveFit.optimization.iterations);
    console.log('HHR SUCCESSOR OPTIMIZER MAX ABS GRADIENT:', report.positiveFit.optimization.maxAbsoluteGradient);
    console.log('HHR SUCCESSOR ALPHA RANGE [INFORMATIONAL]:', report.shapeGate.summary.alphaRange);
    console.log('HHR SUCCESSOR MAX ZERO GAP:', report.shapeGate.summary.maxZeroGap);
    console.log('HHR SUCCESSOR MAX TAIL GAPS:', JSON.stringify(report.shapeGate.summary.maxTailGapByThreshold));
    console.log('HHR SUCCESSOR ACCEPTANCE:', report.successorAcceptance.passed);
    console.log('HHR SUCCESSOR REPORT SHA-256:', report.reportSha256);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});