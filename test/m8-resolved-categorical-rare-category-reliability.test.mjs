import assert from 'node:assert/strict';
import test from 'node:test';
import {
  buildEqualCountRareCategoryReliabilityBuckets,
  summarizeRareCategoryReliability,
} from '../scripts/m8-resolved-categorical-rare-category-reliability-utils.mjs';

function prediction(index, probability, outcome) {
  return Object.freeze({
    observationId: `obs-${String(index).padStart(5, '0')}`,
    observedDate: '2026-06-22',
    probability,
    outcome,
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
    observed += item.outcome;
    expected += item.probability;
    logLoss +=
      item.outcome === 1
        ? -Math.log(item.probability)
        : -Math.log(1 - item.probability);
    brier += (item.probability - item.outcome) ** 2;
    minimum = Math.min(minimum, item.probability);
    maximum = Math.max(maximum, item.probability);
  }
  return Object.freeze({
    validationObservationCount: predictions.length,
    validationObservedCount: observed,
    validationObservedRate: observed / predictions.length,
    validationExpectedCount: expected,
    meanPredictedProbability: expected / predictions.length,
    calibrationGapObservedMinusPredicted:
      observed / predictions.length - expected / predictions.length,
    oneVsRestLogLoss: logLoss / predictions.length,
    oneVsRestBrier: brier / predictions.length,
    predictedProbabilityMinimum: minimum,
    predictedProbabilityMaximum: maximum,
  });
}

test('builds balanced deterministic rare-category deciles', () => {
  const predictions = Object.freeze(
    Array.from({ length: 23 }, (_, index) =>
      prediction(index, 0.002 + (index % 7) * 0.001, index % 11 === 0 ? 1 : 0),
    ),
  );
  const first = buildEqualCountRareCategoryReliabilityBuckets({
    category: '3B',
    predictions,
  });
  const second = buildEqualCountRareCategoryReliabilityBuckets({
    category: '3B',
    predictions: [...predictions].reverse(),
  });
  assert.equal(first.observationCount, 23);
  assert.equal(first.minimumBucketSize, 2);
  assert.equal(first.maximumBucketSize, 3);
  assert.deepEqual(first, second);
});

test('reproduces source one-vs-rest metrics and conserves events', () => {
  const predictions = Object.freeze(
    Array.from({ length: 100 }, (_, index) =>
      prediction(index, 0.02 + (index % 10) * 0.002, index % 25 === 0 ? 1 : 0),
    ),
  );
  const result = summarizeRareCategoryReliability({
    category: 'HR',
    predictions,
    sourceCategorySummary: sourceSummary(predictions),
  });
  assert.equal(result.sourceEquivalence.maximumDifference, 0);
  assert.equal(result.overall.validationObservationCount, 100);
  assert.equal(result.overall.validationObservedCount, 4);
  assert.equal(result.equalCount.observationCount, 100);
  assert.equal(result.equalCount.observedEventCount, 4);
  assert.equal(result.calibrationDecision.calibrationModelFit, false);
  assert.equal(result.calibrationDecision.calibrationApplied, false);
});

test('reports Wilson uncertainty for zero-event deciles', () => {
  const predictions = Object.freeze(
    Array.from({ length: 100 }, (_, index) =>
      prediction(index, 0.001 + index / 100_000, index === 99 ? 1 : 0),
    ),
  );
  const result = summarizeRareCategoryReliability({
    category: '3B',
    predictions,
    sourceCategorySummary: sourceSummary(predictions),
  });
  const zeroBucket = result.equalCount.buckets.find(
    (bucket) => bucket.observedEventCount === 0,
  );
  assert.ok(zeroBucket);
  assert.equal(zeroBucket.observedEventRateWilson95.lower, 0);
  assert.ok(zeroBucket.observedEventRateWilson95.upper > 0);
});

test('rejects duplicate identities and invalid probabilities', () => {
  assert.throws(
    () =>
      buildEqualCountRareCategoryReliabilityBuckets({
        category: 'HR',
        predictions: [
          prediction(1, 0.03, 0),
          prediction(1, 0.04, 1),
          ...Array.from({ length: 8 }, (_, index) =>
            prediction(index + 2, 0.03, 0),
          ),
        ],
      }),
    /duplicate HR reliability prediction/,
  );
  assert.throws(
    () =>
      buildEqualCountRareCategoryReliabilityBuckets({
        category: 'HR',
        predictions: Array.from({ length: 10 }, (_, index) => ({
          ...prediction(index, 0.03, 0),
          probability: index === 0 ? 0 : 0.03,
        })),
      }),
    /strictly between 0 and 1/,
  );
});

test('rejects undersized deciles', () => {
  assert.throws(
    () =>
      buildEqualCountRareCategoryReliabilityBuckets({
        category: '3B',
        predictions: Array.from({ length: 9 }, (_, index) =>
          prediction(index, 0.003, 0),
        ),
      }),
    /requires at least 10 predictions/,
  );
});

test('rejects drift from verified source category metrics', () => {
  const predictions = Object.freeze(
    Array.from({ length: 20 }, (_, index) =>
      prediction(index, 0.03, index === 0 ? 1 : 0),
    ),
  );
  const source = {
    ...sourceSummary(predictions),
    oneVsRestBrier: sourceSummary(predictions).oneVsRestBrier + 0.001,
  };
  assert.throws(
    () =>
      summarizeRareCategoryReliability({
        category: 'HR',
        predictions,
        sourceCategorySummary: source,
      }),
    /source category summary oneVsRestBrier drifted/,
  );
});

test('allows only floating-point-order noise in large decile mass conservation', () => {
  let state = 1;
  const predictions = Object.freeze(
    Array.from({ length: 14_265 }, (_, index) => {
      state = (1_664_525 * state + 1_013_904_223) >>> 0;
      const probability = 0.0001 + 0.08 * (state / 4_294_967_296);
      return prediction(index, probability, index % 31 === 0 ? 1 : 0);
    }),
  );
  const result = summarizeRareCategoryReliability({
    category: 'HR',
    predictions,
    sourceCategorySummary: sourceSummary(predictions),
  });
  const difference = Math.abs(
    result.equalCount.expectedEventCount -
      result.overall.validationExpectedCount,
  );
  const allowed =
    1e-12 *
    Math.max(
      1,
      Math.abs(result.equalCount.expectedEventCount),
      Math.abs(result.overall.validationExpectedCount),
    );
  assert.ok(difference <= allowed);
  assert.equal(result.equalCount.observationCount, 14_265);
});
