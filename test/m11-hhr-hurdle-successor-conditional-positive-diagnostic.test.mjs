import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';

import { normalizeUnderdogBatterHhrCapture } from '../dist/src/features/batter-hhr/index.js';
import { evaluateHhrHurdleSuccessor } from '../scripts/m11-hhr-hurdle-successor-fit-utils.mjs';

const FIXTURE_PATH = path.resolve('fixtures/sanitized/m11/hhr/respecified-v2/balldontlie-hhr-design-matrix-v2.json');
const OLD_MODEL_PATH = path.resolve('model-artifacts/m11-batter-hhr-direct-composite-v2.json');
const BOARD_PATH = path.resolve('fixtures/sanitized/m11/hhr/respecified-v2/the-odds-api-underdog-hhr-board-v2.json');

function thresholdFromHalfPointLine(line) {
  assert.equal(typeof line, 'number');
  assert.ok(Number.isFinite(line));
  return Math.floor(line) + 1;
}

test('diagnostic: isolate HHR successor positive-count residuals after conditioning on T>=1', async () => {
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

  const report = evaluateHhrHurdleSuccessor({
    fixture,
    fixtureText,
    oldModel,
    liveRequiredSettlementThresholds,
  });
  assert.equal(report.untouchedEvidenceRead, false);
  assert.equal(report.successorAcceptance.passed, false);

  const summaries = [];
  for (const bin of report.shapeGate.bins) {
    const observedPositiveMass = bin.tails['1'].upper.observed;
    const predictedPositiveMass = bin.tails['1'].upper.predicted;
    assert.ok(observedPositiveMass > 0 && predictedPositiveMass > 0);

    const conditional = {};
    for (const threshold of [2, 3]) {
      const tail = bin.tails[String(threshold)].upper;
      const observed = tail.observed / observedPositiveMass;
      const predicted = tail.predicted / predictedPositiveMass;
      conditional[threshold] = {
        observed,
        predicted,
        observedMinusPredicted: observed - predicted,
        absoluteGap: Math.abs(observed - predicted),
      };
    }

    const observedP1 = 1 - conditional[2].observed;
    const predictedP1 = 1 - conditional[2].predicted;
    const observedP2 = conditional[2].observed - conditional[3].observed;
    const predictedP2 = conditional[2].predicted - conditional[3].predicted;
    const summary = {
      binIndex: bin.binIndex,
      rowCount: bin.rowCount,
      meanFittedMu: bin.meanFittedMu,
      zeroGap: bin.zeroMass.observedMinusPredicted,
      conditionalTail2: conditional[2],
      conditionalTail3: conditional[3],
      conditionalP1: {
        observed: observedP1,
        predicted: predictedP1,
        observedMinusPredicted: observedP1 - predictedP1,
      },
      conditionalP2: {
        observed: observedP2,
        predicted: predictedP2,
        observedMinusPredicted: observedP2 - predictedP2,
      },
    };
    summaries.push(summary);
    console.log('HHR CONDITIONAL POSITIVE BIN:', JSON.stringify(summary));
  }

  const maxConditionalTail2Gap = Math.max(...summaries.map((entry) => entry.conditionalTail2.absoluteGap));
  const maxConditionalTail3Gap = Math.max(...summaries.map((entry) => entry.conditionalTail3.absoluteGap));
  console.log('HHR CONDITIONAL POSITIVE MAX T>=2 GAP:', maxConditionalTail2Gap);
  console.log('HHR CONDITIONAL POSITIVE MAX T>=3 GAP:', maxConditionalTail3Gap);
  console.log('HHR CONDITIONAL POSITIVE TAU REFERENCE:', 0.010);
});
