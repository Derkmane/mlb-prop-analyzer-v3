import assert from 'node:assert/strict';
import test from 'node:test';

import {
  buildFitObservationWeights,
  calculateRecencyWeight,
  countPlateAppearances,
  enumerateCurrentSeasonDates,
  selectFinalGamesForDate,
  selectRecencyCandidateFromValidation,
  validateChronologicalWindows,
} from '../scripts/m8-recency-weighting-utils.mjs';

const activeSeason = 2026;
const windows = Object.freeze({
  fitStartDate: '2026-03-25',
  fitEndDate: '2026-06-30',
  validationStartDate: '2026-07-01',
  validationEndDate: '2026-07-15',
  testStartDate: '2026-07-16',
  testEndDate: '2026-07-25',
});

test('enumerates an explicit active-season date range without prior-season leakage', () => {
  assert.deepEqual(
    enumerateCurrentSeasonDates({
      startDate: '2026-04-01',
      endDate: '2026-04-03',
      activeSeason,
    }),
    ['2026-04-01', '2026-04-02', '2026-04-03'],
  );

  assert.throws(
    () =>
      enumerateCurrentSeasonDates({
        startDate: '2025-09-28',
        endDate: '2026-04-01',
        activeSeason,
      }),
    /active season 2026/,
  );
  assert.throws(
    () =>
      enumerateCurrentSeasonDates({
        startDate: '2026-04-03',
        endDate: '2026-04-01',
        activeSeason,
      }),
    /must not be after/,
  );
});

test('requires strictly chronological fit, validation, and untouched test periods', () => {
  assert.deepEqual(
    validateChronologicalWindows({ activeSeason, ...windows }),
    { activeSeason, ...windows },
  );

  assert.throws(
    () =>
      validateChronologicalWindows({
        activeSeason,
        ...windows,
        validationStartDate: windows.fitEndDate,
      }),
    /fit period must end before validation begins/,
  );
  assert.throws(
    () =>
      validateChronologicalWindows({
        activeSeason,
        ...windows,
        testStartDate: windows.validationEndDate,
      }),
    /validation period must end before untouched test begins/,
  );
});

test('computes exact uniform and exponential half-life weights', () => {
  assert.equal(
    calculateRecencyWeight({
      observedDate: '2026-06-01',
      asOfDate: '2026-06-11',
      activeSeason,
      candidate: { candidateId: 'uniform', kind: 'uniform' },
    }),
    1,
  );
  assert.equal(
    calculateRecencyWeight({
      observedDate: '2026-06-01',
      asOfDate: '2026-06-11',
      activeSeason,
      candidate: {
        candidateId: 'half-life-candidate',
        kind: 'exponential-half-life',
        halfLifeDays: 10,
      },
    }),
    0.5,
  );

  const recent = calculateRecencyWeight({
    observedDate: '2026-06-10',
    asOfDate: '2026-06-11',
    activeSeason,
    candidate: {
      candidateId: 'candidate',
      kind: 'exponential-half-life',
      halfLifeDays: 10,
    },
  });
  const older = calculateRecencyWeight({
    observedDate: '2026-05-10',
    asOfDate: '2026-06-11',
    activeSeason,
    candidate: {
      candidateId: 'candidate',
      kind: 'exponential-half-life',
      halfLifeDays: 10,
    },
  });
  assert.ok(recent > older);
  assert.throws(
    () =>
      calculateRecencyWeight({
        observedDate: '2026-06-12',
        asOfDate: '2026-06-11',
        activeSeason,
        candidate: { candidateId: 'uniform', kind: 'uniform' },
      }),
    /cannot be after/,
  );
});

test('builds weights from fit-period observations only', () => {
  const weights = buildFitObservationWeights({
    activeSeason,
    windows,
    candidate: {
      candidateId: 'candidate-20',
      kind: 'exponential-half-life',
      halfLifeDays: 20,
    },
    observations: [
      { observationId: 'pa-1', observedDate: '2026-06-10' },
      { observationId: 'pa-2', observedDate: '2026-06-30' },
    ],
  });

  assert.equal(weights.length, 2);
  assert.equal(weights[1].weight, 1);
  assert.ok(weights[0].weight < weights[1].weight);
  assert.ok(Object.isFrozen(weights));

  assert.throws(
    () =>
      buildFitObservationWeights({
        activeSeason,
        windows,
        candidate: { candidateId: 'uniform', kind: 'uniform' },
        observations: [
          { observationId: 'validation-pa', observedDate: '2026-07-01' },
        ],
      }),
    /outside the fit period/,
  );
});

test('selects recency only from later validation log loss and retains uniform when better', () => {
  const weighted = selectRecencyCandidateFromValidation([
    {
      candidate: { candidateId: 'uniform', kind: 'uniform' },
      validationObservationCount: 500,
      validationLogLoss: 0.61,
    },
    {
      candidate: {
        candidateId: 'half-life-20',
        kind: 'exponential-half-life',
        halfLifeDays: 20,
      },
      validationObservationCount: 500,
      validationLogLoss: 0.59,
    },
  ]);
  assert.equal(weighted.status, 'validated-recency-selected');
  assert.equal(weighted.selectedCandidate.candidateId, 'half-life-20');

  const uniform = selectRecencyCandidateFromValidation([
    {
      candidate: { candidateId: 'uniform', kind: 'uniform' },
      validationObservationCount: 500,
      validationLogLoss: 0.58,
    },
    {
      candidate: {
        candidateId: 'half-life-20',
        kind: 'exponential-half-life',
        halfLifeDays: 20,
      },
      validationObservationCount: 500,
      validationLogLoss: 0.59,
    },
  ]);
  assert.equal(uniform.status, 'uniform-baseline-retained');
  assert.equal(uniform.selectedCandidate.candidateId, 'uniform');

  assert.throws(
    () =>
      selectRecencyCandidateFromValidation([
        {
          candidate: { candidateId: 'uniform', kind: 'uniform' },
          validationObservationCount: 500,
          validationLogLoss: 0.58,
          testLogLoss: 0.57,
        },
        {
          candidate: {
            candidateId: 'half-life-20',
            kind: 'exponential-half-life',
            halfLifeDays: 20,
          },
          validationObservationCount: 500,
          validationLogLoss: 0.59,
        },
      ]),
    /test-period metrics cannot participate/,
  );

  assert.throws(
    () =>
      selectRecencyCandidateFromValidation([
        {
          candidate: { candidateId: 'uniform', kind: 'uniform' },
          validationObservationCount: 500,
          validationLogLoss: 0.58,
        },
        {
          candidate: {
            candidateId: 'half-life-20',
            kind: 'exponential-half-life',
            halfLifeDays: 20,
          },
          validationObservationCount: 500,
          validationLogLoss: 0.58,
        },
      ]),
    /ambiguous/,
  );
});

test('selects only exact observed final games for the requested active-season date', () => {
  const selected = selectFinalGamesForDate(
    {
      data: [
        { id: 101, date: '2026-07-01', status: 'STATUS_FINAL' },
        { id: 102, date: '2026-07-01', status: 'STATUS_SCHEDULED' },
      ],
    },
    '2026-07-01',
    activeSeason,
  );

  assert.deepEqual(selected, [
    { id: 101, date: '2026-07-01', status: 'STATUS_FINAL' },
  ]);
  assert.throws(
    () =>
      selectFinalGamesForDate(
        { data: [{ id: 101, date: '2026-07-02', status: 'STATUS_FINAL' }] },
        '2026-07-01',
        activeSeason,
      ),
    /does not match requested date/,
  );
});

test('counts only an explicit plate-appearance data array', () => {
  assert.equal(countPlateAppearances({ data: [{}, {}, {}] }), 3);
  assert.throws(
    () => countPlateAppearances({ data: null }),
    /data must be an array/,
  );
});
