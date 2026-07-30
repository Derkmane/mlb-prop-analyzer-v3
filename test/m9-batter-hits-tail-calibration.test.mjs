import assert from 'node:assert/strict';
import test from 'node:test';

import {
  IDENTITY_MONOTONE_TAIL_CALIBRATION,
  calibrateHitsDistribution,
  calibrateTailProbability,
  evaluateCalibratedHitsPredictions,
  fitMonotoneTailLogitAffine,
  hitsTailProbabilities,
  nondominatedCandidateIds,
  shrinkMonotoneTailCalibration,
  stableNondominatedCandidateIds,
} from '../scripts/m9-batter-hits-tail-calibration-utils.mjs';

function assertClose(actual, expected, tolerance = 1e-12) {
  assert.ok(
    Math.abs(actual - expected) <= tolerance,
    `expected ${actual} to be within ${tolerance} of ${expected}`,
  );
}

function assertValidPmf(pmf) {
  assert.ok(pmf.every((mass) => Number.isFinite(mass) && mass >= 0));
  assertClose(pmf.reduce((sum, mass) => sum + mass, 0), 1);
}

const FIT_PREDICTIONS = Object.freeze([
  Object.freeze({
    observationId: 'a',
    pmf: Object.freeze([0.2, 0.5, 0.25, 0.05]),
    actualHits: 0,
  }),
  Object.freeze({
    observationId: 'b',
    pmf: Object.freeze([0.2, 0.5, 0.25, 0.05]),
    actualHits: 0,
  }),
  Object.freeze({
    observationId: 'c',
    pmf: Object.freeze([0.2, 0.5, 0.25, 0.05]),
    actualHits: 1,
  }),
  Object.freeze({
    observationId: 'd',
    pmf: Object.freeze([0.2, 0.5, 0.25, 0.05]),
    actualHits: 0,
  }),
  Object.freeze({
    observationId: 'e',
    pmf: Object.freeze([0.55, 0.3, 0.12, 0.03]),
    actualHits: 1,
  }),
  Object.freeze({
    observationId: 'f',
    pmf: Object.freeze([0.55, 0.3, 0.12, 0.03]),
    actualHits: 0,
  }),
]);

test('identity monotone calibration is byte-exact and conserves mass', () => {
  const raw = Object.freeze([0.35, 0.4, 0.2, 0.05]);
  const calibrated = calibrateHitsDistribution(
    raw,
    IDENTITY_MONOTONE_TAIL_CALIBRATION,
  );

  assert.deepEqual(calibrated, raw);
  assertValidPmf(calibrated);
  assert.equal(
    calibrateTailProbability(0, { slope: 2, intercept: 1 }),
    0,
  );
  assert.equal(
    calibrateTailProbability(1, { slope: 2, intercept: -1 }),
    1,
  );
});

test('one nonlinear increasing map preserves every Hits-tail ordering and coherent PMF', () => {
  const raw = Object.freeze([0.35, 0.4, 0.2, 0.05]);
  const rawTails = hitsTailProbabilities(raw);
  const calibration = Object.freeze({ slope: 1.4, intercept: -0.2 });
  const calibrated = calibrateHitsDistribution(raw, calibration);
  const calibratedTails = hitsTailProbabilities(calibrated);

  assertValidPmf(calibrated);
  assert.equal(calibratedTails.length, rawTails.length);
  for (let index = 1; index < calibratedTails.length; index += 1) {
    assert.ok(calibratedTails[index - 1] >= calibratedTails[index]);
  }
  for (const [index, rawTail] of rawTails.entries()) {
    assertClose(
      calibratedTails[index],
      calibrateTailProbability(rawTail, calibration),
    );
  }
});

test('deterministic logit-affine fitting improves its threshold objective', () => {
  const first = fitMonotoneTailLogitAffine(FIT_PREDICTIONS);
  const second = fitMonotoneTailLogitAffine(FIT_PREDICTIONS);

  assert.deepEqual(second, first);
  assert.ok(first.slope > 0);
  assert.ok(first.objective < first.identityObjective);

  const raw = evaluateCalibratedHitsPredictions(
    FIT_PREDICTIONS,
    IDENTITY_MONOTONE_TAIL_CALIBRATION,
  ).metrics;
  const calibrated = evaluateCalibratedHitsPredictions(
    FIT_PREDICTIONS,
    { slope: first.slope, intercept: first.intercept },
  ).metrics;

  assert.ok(calibrated.logLoss < raw.logLoss);
  assert.ok(calibrated.multiclassBrier < raw.multiclassBrier);
});

test('shrinkage endpoints are exact identity and exact fitted calibration', () => {
  const fit = fitMonotoneTailLogitAffine(FIT_PREDICTIONS);

  assert.deepEqual(
    shrinkMonotoneTailCalibration(fit, 0),
    IDENTITY_MONOTONE_TAIL_CALIBRATION,
  );
  assert.deepEqual(shrinkMonotoneTailCalibration(fit, 1), {
    slope: fit.slope,
    intercept: fit.intercept,
  });

  const halfway = shrinkMonotoneTailCalibration(fit, 0.5);
  assertClose(halfway.slope, 1 + 0.5 * (fit.slope - 1));
  assertClose(halfway.intercept, 0.5 * fit.intercept);
});

test('canonical nondominated intersection selects the stable nonidentity candidate', () => {
  const fixedNondominated = nondominatedCandidateIds([
    {
      candidateId: 'identity',
      metrics: { logLoss: 1, multiclassBrier: 0.7 },
    },
    {
      candidateId: 'lambda-050',
      metrics: { logLoss: 0.9, multiclassBrier: 0.65 },
    },
    {
      candidateId: 'lambda-075',
      metrics: { logLoss: 0.88, multiclassBrier: 0.66 },
    },
  ]);
  const walkNondominated = Object.freeze([
    'identity',
    'lambda-050',
    'lambda-100',
  ]);

  assert.deepEqual(fixedNondominated, ['lambda-050', 'lambda-075']);
  assert.deepEqual(
    stableNondominatedCandidateIds(
      fixedNondominated,
      walkNondominated,
      ['identity'],
    ),
    ['lambda-050'],
  );
});
