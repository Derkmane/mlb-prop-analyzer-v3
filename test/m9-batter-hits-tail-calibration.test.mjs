import assert from 'node:assert/strict';
import test from 'node:test';

import {
  calibrateHitsDistribution,
  evaluateCalibratedHitsPredictions,
  fitSharedTailLogitIntercept,
  hitsTailProbabilities,
  lineBriersNoWorse,
  nondominatedCandidateIds,
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

test('zero calibration is identity and reconstructed mass is conserved', () => {
  const raw = Object.freeze([0.35, 0.4, 0.2, 0.05]);
  const calibrated = calibrateHitsDistribution(raw, 0);

  assert.deepEqual(calibrated, raw);
  assertValidPmf(calibrated);
});

test('calibration moves every Higher tail directionally and preserves ordering', () => {
  const raw = Object.freeze([0.35, 0.4, 0.2, 0.05]);
  const rawTails = hitsTailProbabilities(raw);
  const downward = calibrateHitsDistribution(raw, -0.4);
  const upward = calibrateHitsDistribution(raw, 0.4);
  const downwardTails = hitsTailProbabilities(downward);
  const upwardTails = hitsTailProbabilities(upward);

  assertValidPmf(downward);
  assertValidPmf(upward);

  for (const [index, rawTail] of rawTails.entries()) {
    assert.ok((downwardTails[index] ?? Number.NaN) < rawTail);
    assert.ok((upwardTails[index] ?? Number.NaN) > rawTail);
  }

  for (const tails of [downwardTails, upwardTails]) {
    for (let index = 1; index < tails.length; index += 1) {
      assert.ok((tails[index - 1] ?? 0) >= (tails[index] ?? 1));
    }
  }
});

test('shared logit-intercept fitting learns a downward correction from overprediction', () => {
  const predictions = Object.freeze([
    Object.freeze({ observationId: 'a', pmf: [0.2, 0.5, 0.25, 0.05], actualHits: 0 }),
    Object.freeze({ observationId: 'b', pmf: [0.2, 0.5, 0.25, 0.05], actualHits: 0 }),
    Object.freeze({ observationId: 'c', pmf: [0.2, 0.5, 0.25, 0.05], actualHits: 1 }),
    Object.freeze({ observationId: 'd', pmf: [0.2, 0.5, 0.25, 0.05], actualHits: 0 }),
  ]);

  const fit = fitSharedTailLogitIntercept(predictions);
  const raw = evaluateCalibratedHitsPredictions(predictions, 0).metrics;
  const calibrated = evaluateCalibratedHitsPredictions(predictions, fit.delta).metrics;

  assert.ok(fit.delta < 0);
  assert.ok(calibrated.predictedMeanHits < raw.predictedMeanHits);
  assert.ok(calibrated.higher05Brier < raw.higher05Brier);
});

test('proper-score nondominance and line gates remain deterministic', () => {
  const nondominated = nondominatedCandidateIds([
    {
      candidateId: 'a',
      metrics: { logLoss: 1, multiclassBrier: 0.6 },
    },
    {
      candidateId: 'b',
      metrics: { logLoss: 0.9, multiclassBrier: 0.59 },
    },
    {
      candidateId: 'c',
      metrics: { logLoss: 0.8, multiclassBrier: 0.7 },
    },
  ]);

  assert.deepEqual(nondominated, ['b', 'c']);
  assert.deepEqual(
    lineBriersNoWorse(
      { higher05Brier: 0.2, higher15Brier: 0.1, higher25Brier: 0.05 },
      { higher05Brier: 0.2, higher15Brier: 0.11, higher25Brier: 0.05 },
    ),
    { higher05: true, higher15: true, higher25: true },
  );
});