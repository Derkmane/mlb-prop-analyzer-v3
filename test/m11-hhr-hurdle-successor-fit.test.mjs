import assert from 'node:assert/strict';
import test from 'node:test';

import {
  conditionedHurdleZeroProbability,
  evaluateHhrHurdleSuccessorGate,
  fitZeroTruncatedNb2DesignRows,
  HHR_CONDITIONED_HURDLE_ZERO_COMPONENT,
  HHR_SUCCESSOR_GATE,
  nb2Pmf,
  zeroTruncatedNb2Pmf,
} from '../scripts/m11-hhr-hurdle-successor-fit-utils.mjs';

test('NB2 and zero-truncated NB2 conserve probability mass', () => {
  const mean = 1.8;
  const alpha = 0.6;
  let nbMass = 0;
  let truncatedMass = 0;
  for (let count = 0; count <= 200; count += 1) nbMass += nb2Pmf(count, mean, alpha);
  for (let count = 1; count <= 200; count += 1) truncatedMass += zeroTruncatedNb2Pmf(count, mean, alpha);
  assert.ok(Math.abs(nbMass - 1) < 1e-12, `NB2 mass=${nbMass}`);
  assert.ok(Math.abs(truncatedMass - 1) < 1e-12, `truncated mass=${truncatedMass}`);
});

test('conditioned hurdle zero component is frozen to the accepted three-input fit', () => {
  assert.deepEqual(HHR_CONDITIONED_HURDLE_ZERO_COMPONENT.rawCoefficients, {
    intercept: -0.3156807637150578,
    expectedPlateAppearances: -0.4421437691851488,
    lineupSlot: 0.010153949897632894,
    contextHitQualityLogit: -1.0649822595037404,
  });
  const probability = conditionedHurdleZeroProbability({
    expectedPlateAppearances: 4.077730248976061,
    lineupSlot: 4.998993963782696,
    contextHitQualityLogit: -1.2749139632697288,
  });
  assert.ok(probability > 0 && probability < 1);
});

test('zero-truncated NB2 positive fit is deterministic and improves likelihood', () => {
  const counts = [1, 1, 2, 1, 3, 2, 1, 4, 2, 3, 1, 2, 5, 3, 2, 1, 4, 2, 3, 2, 1, 2, 3, 4, 2, 1, 5, 3, 2, 4];
  const rows = counts.map((y, index) => ({
    x: [1, (index - 14.5) / 10],
    offset: Math.log(3.8 + (index % 3) * 0.15),
    y,
  }));
  const initial = { beta: [-1.1, 0], alpha: 0.58 };
  const first = fitZeroTruncatedNb2DesignRows(rows, initial);
  const second = fitZeroTruncatedNb2DesignRows(rows, initial);
  assert.ok(first.finalAverageNegativeLogLikelihood < first.initialAverageNegativeLogLikelihood);
  assert.deepEqual(first.beta, second.beta);
  assert.equal(first.alpha, second.alpha);
  assert.equal(first.finalAverageNegativeLogLikelihood, second.finalAverageNegativeLogLikelihood);
});

test('successor gate ignores implied-alpha range and gates only zero mass and required tails', () => {
  const rows = [];
  const observedCycle = [0, 0, 0, 1, 1, 1, 2, 2, 3, 3];
  for (let bin = 0; bin < 5; bin += 1) {
    for (let index = 0; index < 200; index += 1) {
      rows.push({
        fittedMean: 0.7 + bin * 0.8 + index * 1e-8,
        observedT: observedCycle[index % observedCycle.length],
        predictedZero: 0.3,
        predictedUpperTails: { 1: 0.7, 2: 0.4, 3: 0.2 },
      });
    }
  }
  const gate = evaluateHhrHurdleSuccessorGate(rows, HHR_SUCCESSOR_GATE);
  assert.equal(gate.verdict, 'PASS');
  assert.equal(gate.summary.substantiveChecks.zeroMass.passed, true);
  assert.equal(gate.summary.substantiveChecks.tails.passed, true);
  assert.equal(gate.summary.alphaImpliedStatus, 'INFORMATIONAL');
  assert.ok(gate.summary.alphaImpliedRange > 0.15);
  assert.deepEqual(gate.failureReasons, []);
});
