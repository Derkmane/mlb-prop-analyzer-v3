import assert from 'node:assert/strict';
import test from 'node:test';

import {
  buildEqualCountHitReliabilityBuckets,
  buildFixedWidthHitReliabilityBuckets,
  summarizeHitReliabilityPredictions,
} from '../scripts/m8-resolved-categorical-hit-reliability-utils.mjs';

function prediction(index, probability, hit) {
  return Object.freeze({
    observationId: `obs-${String(index).padStart(3, '0')}`,
    observedDate: '2026-06-22',
    hitProbability: probability,
    hit,
  });
}

function sourceSummary(predictions) {
  let observed = 0;
  let expected = 0;
  let logLoss = 0;
  let brier = 0;
  let minimum = 1;
  let maximum = 0;
  for (const item of predictions) {
    observed += item.hit;
    expected += item.hitProbability;
    logLoss +=
      item.hit === 1
        ? -Math.log(item.hitProbability)
        : -Math.log(1 - item.hitProbability);
    brier += (item.hitProbability - item.hit) ** 2;
    minimum = Math.min(minimum, item.hitProbability);
    maximum = Math.max(maximum, item.hitProbability);
  }
  return Object.freeze({
    validationObservationCount: predictions.length,
    validationObservedCount: observed,
    validationObservedRate: observed / predictions.length,
    validationExpectedCount: expected,
    meanPredictedProbability: expected / predictions.length,
    calibrationGapObservedMinusPredicted:
      observed / predictions.length - expected / predictions.length,
    binaryLogLoss: logLoss / predictions.length,
    binaryBrier: brier / predictions.length,
    predictedProbabilityMinimum: minimum,
    predictedProbabilityMaximum: maximum,
  });
}

function calibratedTwenty() {
  const predictions = [];
  for (let index = 0; index < 10; index += 1) {
    predictions.push(prediction(index, 0.2, index < 2 ? 1 : 0));
  }
  for (let index = 10; index < 20; index += 1) {
    predictions.push(prediction(index, 0.8, index < 18 ? 1 : 0));
  }
  return Object.freeze(predictions);
}

test('assigns an exact 5% probability to the next fixed-width bucket and conserves rows', () => {
  const predictions = Object.freeze([
    prediction(1, 0.049, 0),
    prediction(2, 0.05, 0),
    ...Array.from({ length: 8 }, (_, index) =>
      prediction(index + 3, 0.2 + index / 1000, index % 2),
    ),
  ]);
  const result = buildFixedWidthHitReliabilityBuckets(predictions);
  assert.equal(result.observationCount, 10);
  assert.equal(result.buckets[0].observationCount, 1);
  assert.equal(result.buckets[1].observationCount, 1);
  assert.equal(result.buckets[0].predictedProbabilityMaximum, 0.049);
  assert.equal(result.buckets[1].predictedProbabilityMinimum, 0.05);
  assert.equal(
    result.buckets.reduce((sum, bucket) => sum + bucket.observationCount, 0),
    10,
  );
});

test('builds balanced deterministic equal-count deciles', () => {
  const predictions = Object.freeze(
    Array.from({ length: 23 }, (_, index) =>
      prediction(index, 0.1 + (index % 7) * 0.03, index % 4 === 0 ? 1 : 0),
    ),
  );
  const first = buildEqualCountHitReliabilityBuckets(predictions);
  const second = buildEqualCountHitReliabilityBuckets([...predictions].reverse());
  assert.equal(first.bucketCount, 10);
  assert.equal(first.observationCount, 23);
  assert.equal(first.minimumBucketSize, 2);
  assert.equal(first.maximumBucketSize, 3);
  assert.deepEqual(first, second);
});

test('conserves probability and outcome mass while reproducing source Hit metrics', () => {
  const predictions = calibratedTwenty();
  const result = summarizeHitReliabilityPredictions({
    predictions,
    sourceHitSummary: sourceSummary(predictions),
  });
  assert.equal(result.sourceEquivalence.maximumDifference, 0);
  assert.equal(result.overall.validationObservationCount, 20);
  assert.equal(result.overall.validationObservedCount, 10);
  assert.ok(Math.abs(result.overall.validationExpectedCount - 10) <= 1e-12);
  assert.ok(result.fixedWidth.expectedCalibrationError <= 1e-12);
  assert.ok(result.fixedWidth.maximumCalibrationError <= 1e-12);
  assert.equal(result.fixedWidth.observationCount, 20);
  assert.equal(result.equalCount.observationCount, 20);
  assert.equal(result.calibrationDecision.calibrationModelFit, false);
  assert.equal(result.calibrationDecision.calibrationApplied, false);
});

test('reports Wilson uncertainty and is deterministic for identical predictions', () => {
  const predictions = calibratedTwenty();
  const source = sourceSummary(predictions);
  const first = summarizeHitReliabilityPredictions({
    predictions,
    sourceHitSummary: source,
  });
  const second = summarizeHitReliabilityPredictions({
    predictions,
    sourceHitSummary: source,
  });
  const lowBucket = first.fixedWidth.buckets.find(
    (bucket) => bucket.observationCount === 10 && bucket.meanPredictedProbability < 0.5,
  );
  assert.ok(lowBucket);
  assert.equal(lowBucket.observedHitCount, 2);
  assert.ok(lowBucket.observedHitRateWilson95.lower >= 0);
  assert.ok(lowBucket.observedHitRateWilson95.upper <= 1);
  assert.ok(
    lowBucket.observedHitRateWilson95.lower <
      lowBucket.observedHitRateWilson95.upper,
  );
  assert.deepEqual(first, second);
});

test('rejects duplicate identities, invalid probabilities, and undersized deciles', () => {
  const duplicate = [prediction(1, 0.2, 0), prediction(1, 0.3, 1)];
  assert.throws(
    () => buildFixedWidthHitReliabilityBuckets(duplicate),
    /duplicate Hit reliability prediction/,
  );
  assert.throws(
    () =>
      buildFixedWidthHitReliabilityBuckets([
        { ...prediction(1, 0.2, 0), hitProbability: 1 },
      ]),
    /strictly between 0 and 1/,
  );
  assert.throws(
    () =>
      buildEqualCountHitReliabilityBuckets(
        Array.from({ length: 9 }, (_, index) =>
          prediction(index, 0.1 + index / 100, index % 2),
        ),
      ),
    /requires at least 10 predictions/,
  );
});

test('rejects drift from the verified source Hit summary', () => {
  const predictions = calibratedTwenty();
  const source = {
    ...sourceSummary(predictions),
    binaryBrier: sourceSummary(predictions).binaryBrier + 0.001,
  };
  assert.throws(
    () =>
      summarizeHitReliabilityPredictions({
        predictions,
        sourceHitSummary: source,
      }),
    /source Hit summary binaryBrier drifted/,
  );
});


test('allows only floating-point-order noise in large bucket mass conservation', () => {
  let state = 1;
  const predictions = Object.freeze(
    Array.from({ length: 14_265 }, (_, index) => {
      state = (1_664_525 * state + 1_013_904_223) >>> 0;
      const probability =
        0.001 + 0.998 * (state / 4_294_967_296);

      return prediction(
        index,
        probability,
        index % 5 === 0 ? 1 : 0,
      );
    }),
  );

  const result = summarizeHitReliabilityPredictions({
    predictions,
    sourceHitSummary: sourceSummary(predictions),
  });

  const fixedDifference = Math.abs(
    result.fixedWidth.expectedHitCount -
      result.overall.validationExpectedCount,
  );
  const equalCountDifference = Math.abs(
    result.equalCount.expectedHitCount -
      result.overall.validationExpectedCount,
  );
  const allowedDifference =
    1e-12 *
    Math.max(
      1,
      Math.abs(result.overall.validationExpectedCount),
      Math.abs(result.fixedWidth.expectedHitCount),
      Math.abs(result.equalCount.expectedHitCount),
    );

  assert.equal(
    result.overall.validationObservationCount,
    14_265,
  );
  assert.ok(fixedDifference > 1e-12);
  assert.ok(equalCountDifference > 1e-12);
  assert.ok(fixedDifference <= allowedDifference);
  assert.ok(equalCountDifference <= allowedDifference);
  assert.equal(
    result.fixedWidth.observedHitCount,
    result.overall.validationObservedCount,
  );
  assert.equal(
    result.equalCount.observedHitCount,
    result.overall.validationObservedCount,
  );
});
