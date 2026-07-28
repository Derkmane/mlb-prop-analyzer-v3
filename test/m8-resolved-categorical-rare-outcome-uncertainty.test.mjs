import assert from 'node:assert/strict';
import test from 'node:test';

import {
  evaluateFrozenPlatoonCandidateCohort,
} from '../scripts/m8-resolved-categorical-platoon-walk-forward-utils.mjs';
import {
  predictFrozenPlatoonCandidateCohort,
  summarizeCategoricalPredictions,
  wilsonScoreInterval95,
} from '../scripts/m8-resolved-categorical-rare-outcome-uncertainty-utils.mjs';

const CATEGORIES = Object.freeze(['K', '1B']);
const CANONICAL_CATEGORIES = Object.freeze(['K', '1B', 'OTHER_PA']);
const HIT_CATEGORIES = Object.freeze(['1B']);
const BASE_PARAMETERS = Object.freeze({
  batterPooling: 4,
  pitcherPooling: 4,
  batterCoefficient: 1,
  pitcherAllowedCoefficient: 0.75,
});
const RAW_CELL_CANDIDATE = Object.freeze({
  candidateId: 'league-raw-cell-limit-split-pa-4-coefficient-0.75',
  leaguePlatoonPriorId: 'league-raw-cell-limit',
  leaguePlatoonEquivalentPa: Number.MIN_VALUE,
  leaguePlatoonExactTarget: false,
  playerSplitPriorId: 'split-pa-4',
  playerSplitEquivalentPa: 4,
  playerSplitExactTarget: false,
  platoonCoefficient: 0.75,
});

const MATCHUPS = Object.freeze([
  Object.freeze({ key: 'L-vs-L', batterSide: 'L', pitcherHand: 'L' }),
  Object.freeze({ key: 'L-vs-R', batterSide: 'L', pitcherHand: 'R' }),
  Object.freeze({ key: 'R-vs-L', batterSide: 'R', pitcherHand: 'L' }),
  Object.freeze({ key: 'R-vs-R', batterSide: 'R', pitcherHand: 'R' }),
]);

function observation({
  id,
  date,
  batterId,
  pitcherId,
  terminalCategory,
  batterSide,
  pitcherHand,
}) {
  return Object.freeze({
    observationId: id,
    observedDate: date,
    providerBatterId: batterId,
    providerPitcherId: pitcherId,
    terminalCategory,
    platoonEligible: true,
    normalizedBatterSide: batterSide,
    normalizedPitcherHand: pitcherHand,
    matchupKey: `${batterSide}-vs-${pitcherHand}`,
  });
}

function makeCohorts({ validationCategories = ['K', '1B', 'K', '1B'] } = {}) {
  const training = [];
  const validation = [];
  for (const [index, matchup] of MATCHUPS.entries()) {
    const batterId = 100 + index;
    const pitcherId = 200 + index;
    training.push(
      observation({
        id: `fit-${matchup.key}-K`,
        date: '2026-06-01',
        batterId,
        pitcherId,
        terminalCategory: 'K',
        batterSide: matchup.batterSide,
        pitcherHand: matchup.pitcherHand,
      }),
      observation({
        id: `fit-${matchup.key}-1B`,
        date: '2026-06-02',
        batterId,
        pitcherId,
        terminalCategory: '1B',
        batterSide: matchup.batterSide,
        pitcherHand: matchup.pitcherHand,
      }),
    );
    validation.push(
      observation({
        id: `validation-${matchup.key}`,
        date: '2026-06-22',
        batterId,
        pitcherId,
        terminalCategory: validationCategories[index],
        batterSide: matchup.batterSide,
        pitcherHand: matchup.pitcherHand,
      }),
    );
  }
  return Object.freeze({
    trainingOverall: Object.freeze([...training]),
    trainingPlatoon: Object.freeze([...training]),
    validationPlatoon: Object.freeze(validation),
  });
}

function predict(cohorts = makeCohorts()) {
  return predictFrozenPlatoonCandidateCohort({
    categories: CATEGORIES,
    hitCategories: HIT_CATEGORIES,
    ...cohorts,
    baseParameters: BASE_PARAMETERS,
    candidate: RAW_CELL_CANDIDATE,
  });
}

function summaryFromPredicted(predicted, cohorts = makeCohorts()) {
  return summarizeCategoricalPredictions({
    canonicalCategories: CANONICAL_CATEGORIES,
    modeledCategories: CATEGORIES,
    hitCategories: HIT_CATEGORIES,
    focusCategories: ['1B', 'OTHER_PA'],
    fitOverall: cohorts.trainingOverall,
    fitPlatoon: cohorts.trainingPlatoon,
    predictions: predicted.predictions,
  });
}

test('computes deterministic bounded Wilson 95% intervals including zero successes', () => {
  const zero = wilsonScoreInterval95(0, 20);
  const middle = wilsonScoreInterval95(10, 20);
  assert.equal(zero.lower, 0);
  assert.ok(zero.upper > 0 && zero.upper < 1);
  assert.ok(middle.lower > 0 && middle.upper < 1);
  assert.ok(middle.lower < 0.5 && middle.upper > 0.5);
  assert.deepEqual(wilsonScoreInterval95(10, 20), middle);
  assert.equal(wilsonScoreInterval95(0, 0), null);
});

test('per-observation predictions exactly reproduce the verified aggregate scorer', () => {
  const cohorts = makeCohorts();
  const predicted = predict(cohorts);
  const verified = evaluateFrozenPlatoonCandidateCohort({
    categories: CATEGORIES,
    hitCategories: HIT_CATEGORIES,
    ...cohorts,
    baseParameters: BASE_PARAMETERS,
    candidate: RAW_CELL_CANDIDATE,
  });
  assert.equal(predicted.predictions.length, 4);
  assert.equal(
    predicted.metrics.validationObservationIdsSha256,
    verified.validationObservationIdsSha256,
  );
  for (const field of [
    'validationCategoricalLogLoss',
    'validationCategoricalBrierScore',
    'validationHitLogLoss',
    'validationHitBrierScore',
    'actualProbabilityMinimum',
    'actualProbabilityMaximum',
    'hitProbabilityMinimum',
    'hitProbabilityMaximum',
  ]) {
    assert.ok(Math.abs(predicted.metrics[field] - verified[field]) <= 1e-12);
  }
});

test('conserves observed counts and expected probability mass across canonical categories', () => {
  const cohorts = makeCohorts();
  const summary = summaryFromPredicted(predict(cohorts), cohorts);
  assert.equal(summary.conservation.observedCountTotal, 4);
  assert.ok(Math.abs(summary.conservation.expectedCountTotal - 4) <= 1e-12);
  assert.ok(Math.abs(summary.conservation.expectedMinusObserved) <= 1e-12);
  assert.equal(summary.categoryReports.OTHER_PA.modeled, false);
  assert.equal(summary.categoryReports.OTHER_PA.validationExpectedCount, 0);
  assert.equal(summary.categoryReports.OTHER_PA.validationObservedCount, 0);
  assert.equal(
    summary.categoryReports.OTHER_PA.evidenceStatus,
    'structural-zero-unobserved-not-production-validated',
  );
});

test('flags zero-validation evidence without inventing a hard sample threshold', () => {
  const cohorts = makeCohorts({ validationCategories: ['K', 'K', 'K', 'K'] });
  const summary = summaryFromPredicted(predict(cohorts), cohorts);
  const single = summary.categoryReports['1B'];
  assert.equal(single.fitOverallCount, 4);
  assert.equal(single.validationObservedCount, 0);
  assert.equal(single.automaticInsufficientEvidence, true);
  assert.equal(single.evidenceStatus, 'insufficient-zero-validation-events');
  assert.equal(summary.evidenceDecision.hardSampleThresholdApplied, false);
  assert.equal(summary.evidenceDecision.priorSeasonRowsUsed, false);
  assert.ok(
    summary.evidenceDecision.automaticInsufficientCategories.includes('1B'),
  );
});

test('rejects structural-zero observations and nonconserved probability vectors', () => {
  const cohorts = makeCohorts();
  const predicted = predict(cohorts);
  const structuralObservation = {
    ...predicted.predictions[0],
    terminalCategory: 'OTHER_PA',
  };
  assert.throws(
    () =>
      summarizeCategoricalPredictions({
        canonicalCategories: CANONICAL_CATEGORIES,
        modeledCategories: CATEGORIES,
        hitCategories: HIT_CATEGORIES,
        focusCategories: ['OTHER_PA'],
        fitOverall: cohorts.trainingOverall,
        fitPlatoon: cohorts.trainingPlatoon,
        predictions: [structuralObservation],
      }),
    /actual category OTHER_PA is not modeled/,
  );

  const badVector = {
    ...predicted.predictions[0],
    probabilities: { K: 0.8, '1B': 0.3 },
  };
  assert.throws(
    () =>
      summarizeCategoricalPredictions({
        canonicalCategories: CANONICAL_CATEGORIES,
        modeledCategories: CATEGORIES,
        hitCategories: HIT_CATEGORIES,
        focusCategories: ['1B'],
        fitOverall: cohorts.trainingOverall,
        fitPlatoon: cohorts.trainingPlatoon,
        predictions: [badVector],
      }),
    /probabilities do not sum to 1/,
  );
});

test('is deterministic for identical current-season prediction inputs', () => {
  const cohorts = makeCohorts();
  const firstPredicted = predict(cohorts);
  const secondPredicted = predict(cohorts);
  assert.deepEqual(firstPredicted, secondPredicted);
  const firstSummary = summaryFromPredicted(firstPredicted, cohorts);
  const secondSummary = summaryFromPredicted(secondPredicted, cohorts);
  assert.deepEqual(firstSummary, secondSummary);
});
