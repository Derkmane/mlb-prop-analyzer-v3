import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

import {
  CONTINUATION_PREDICTOR_ORDER,
  CONTINUATION_THRESHOLDS,
  REQUIRED_SETTLEMENT_THRESHOLDS,
  TAU_TAIL,
  TAU_ZERO,
  fitAndDiagnoseContinuationRatio,
} from '../scripts/m11-hhr-continuation-ratio-fit-utils.mjs';

const FIXTURE_PATH = new URL(
  '../fixtures/sanitized/m11/hhr/respecified-v2/balldontlie-hhr-design-matrix-v2.json',
  import.meta.url,
);
const DIAGNOSTICS_PATH = new URL(
  '../model-artifacts/m11-batter-hhr-direct-composite-diagnostics-v2.json',
  import.meta.url,
);

function adaptFrozenDiagnostics(diagnostics) {
  assert.ok(diagnostics?.predictorSummaries, 'frozen predictor summaries are required');
  assert.ok(diagnostics?.predictorStandardDeviations, 'frozen predictor standard deviations are required');
  const predictorTransforms = Object.fromEntries(
    CONTINUATION_PREDICTOR_ORDER.slice(1).map((name) => {
      const summary = diagnostics.predictorSummaries[name];
      const standardDeviation = diagnostics.predictorStandardDeviations[name];
      assert.equal(typeof summary?.mean, 'number', `${name} frozen mean must be numeric`);
      assert.ok(Number.isFinite(summary.mean), `${name} frozen mean must be finite`);
      assert.equal(typeof standardDeviation, 'number', `${name} frozen standard deviation must be numeric`);
      assert.ok(Number.isFinite(standardDeviation) && standardDeviation > 0, `${name} frozen standard deviation must be positive`);
      return [name, Object.freeze({ mean: summary.mean, standardDeviation })];
    }),
  );
  return Object.freeze({ ...diagnostics, predictorTransforms: Object.freeze(predictorTransforms) });
}

function printReport(report) {
  console.log('HHR CONTINUATION-RATIO CONTRACT:', JSON.stringify(report.contract));
  console.log('HHR CONTINUATION-RATIO PARAMETERS:', JSON.stringify(report.fit.namedParameters));
  console.log('HHR CONTINUATION-RATIO ITERATIONS:', report.fit.iterations);
  console.log('HHR CONTINUATION-RATIO LOG LIKELIHOOD:', report.fit.logLikelihood);
  console.log('HHR CONTINUATION-RATIO MAX ABS SCORE:', report.fit.maxAbsScore);
  for (const bin of report.diagnostic.bins) {
    console.log(`HHR CONTINUATION-RATIO BIN ${bin.binIndex}:`, JSON.stringify({
      rowCount: bin.rowCount,
      fittedMeanRange: bin.fittedMeanRange,
      meanFittedMu: bin.meanFittedMu,
      observedMeanT: bin.observedMeanT,
      impliedAlpha: bin.impliedAlpha,
      impliedAlphaStatus: bin.impliedAlphaStatus,
      zeroMass: bin.zeroMass,
      tails: bin.tails,
      numericalMonotonicity: bin.numericalMonotonicity,
    }));
  }
  console.log('HHR CONTINUATION-RATIO SUMMARY:', JSON.stringify(report.diagnostic.summary));
}

test('HHR continuation-ratio v1.14 candidate fits deterministically and reports the canonical shape gate', async () => {
  const fixture = JSON.parse(await readFile(FIXTURE_PATH, 'utf8'));
  const diagnostics = adaptFrozenDiagnostics(JSON.parse(await readFile(DIAGNOSTICS_PATH, 'utf8')));

  assert.equal(fixture.schemaVersion, 3);
  assert.equal(fixture.rows.length, 5964);
  assert.deepEqual(CONTINUATION_THRESHOLDS, [0, 1, 2, 3, 4, 5, 6, 7]);
  assert.deepEqual(REQUIRED_SETTLEMENT_THRESHOLDS, [1, 2, 3]);
  assert.equal(TAU_ZERO, 0.01);
  assert.equal(TAU_TAIL, 0.01);
  assert.deepEqual(CONTINUATION_PREDICTOR_ORDER, [
    'logExpectedPlateAppearances',
    'contextHitQualityLogit',
    'centeredLineupSlot',
    'platoonSplitCell',
    'opposingStarterPooling',
    'teamImpliedRunTotal',
    'precedingLineupSlotsOnBaseQuality',
  ]);

  const first = fitAndDiagnoseContinuationRatio(fixture, diagnostics);
  const second = fitAndDiagnoseContinuationRatio(fixture, diagnostics);

  assert.deepEqual(second, first, 'identical frozen inputs must produce an exactly identical continuation-ratio fit and report');
  assert.equal(first.contract.fittingRows, 5964);
  assert.equal(first.contract.untouchedEvidenceRead, false);
  assert.equal(first.contract.candidateFrozen, false);
  assert.equal(first.contract.productionEnabled, false);
  assert.equal(first.contract.rankingEnabled, false);
  assert.equal(first.fit.parameters.length, 15);
  assert.ok(first.fit.parameters.every(Number.isFinite), 'all 15 fitted parameters must be finite');
  assert.ok(first.fit.maxAbsScore <= first.fit.scoreTolerance, 'fit must satisfy its deterministic score convergence tolerance');
  assert.equal(first.diagnostic.bins.length, 5);

  for (const bin of first.diagnostic.bins) {
    assert.ok(bin.rowCount >= 200, `bin ${bin.binIndex} must contain at least 200 rows`);
    assert.equal(bin.impliedAlphaStatus, 'INFORMATIONAL_ONLY_FOR_HHR_CONTINUATION_RATIO_V1_14');
    assert.ok(Number.isFinite(bin.impliedAlpha), `bin ${bin.binIndex} implied alpha must be finite`);
    assert.equal(bin.numericalMonotonicity.passed, true, `bin ${bin.binIndex} survival/lower tails must be strictly monotone`);
    assert.equal(bin.numericalMonotonicity.meanSurvival.length, 9);
    for (let threshold = 0; threshold < 8; threshold += 1) {
      assert.ok(
        bin.numericalMonotonicity.meanSurvival[threshold + 1] < bin.numericalMonotonicity.meanSurvival[threshold],
        `bin ${bin.binIndex} survival must strictly decrease from threshold ${threshold} to ${threshold + 1}`,
      );
      assert.ok(
        bin.numericalMonotonicity.meanComplementaryLower[threshold + 1]
          > bin.numericalMonotonicity.meanComplementaryLower[threshold],
        `bin ${bin.binIndex} lower tail must strictly increase from threshold ${threshold} to ${threshold + 1}`,
      );
    }
    for (const threshold of REQUIRED_SETTLEMENT_THRESHOLDS) {
      assert.ok(bin.tails[threshold], `bin ${bin.binIndex} must report threshold ${threshold}`);
      const upper = bin.tails[threshold].upper;
      const lower = bin.tails[threshold].lower;
      assert.ok(Number.isFinite(upper.observedMinusPredicted));
      assert.ok(Number.isFinite(lower.observedMinusPredicted));
      assert.ok(Math.abs((upper.observed + lower.observed) - 1) <= 1e-12);
      assert.ok(Math.abs((upper.predicted + lower.predicted) - 1) <= 1e-12);
    }
  }

  const expectedVerdict = first.diagnostic.summary.zeroPassed
    && first.diagnostic.summary.tailsPassed
    && first.diagnostic.summary.monotonicityPassed;
  assert.equal(first.diagnostic.summary.passed, expectedVerdict);
  assert.equal(first.diagnostic.summary.verdict, expectedVerdict ? 'PASS' : 'FAIL');
  assert.equal(first.diagnostic.summary.alphaImpliedAcceptanceRole, 'INFORMATIONAL_ONLY');

  printReport(first);
});
