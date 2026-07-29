import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import test from 'node:test';

import {
  evaluateM8PaSurvivalWalkForward,
} from '../scripts/m8-pa-survival-walk-forward-utils.mjs';

const DIGEST = 'a'.repeat(64);
const CANDIDATES = Object.freeze([
  Object.freeze({
    candidateId: 'candidate-a',
    grouping: 'slot',
    leagueEquivalentObservations: 25,
  }),
  Object.freeze({
    candidateId: 'candidate-b',
    grouping: 'slot-home-away',
    leagueEquivalentObservations: 50,
  }),
]);

function row({ id, date, periodId, side, slot, pa }) {
  return {
    rowId: `${periodId}:${date}:${id}`,
    observedDate: date,
    periodId,
    homeAway: side,
    side,
    lineupSlot: slot,
    plateAppearances: pa,
    sourceField: 'stats.plate_appearances',
  };
}

function dataset() {
  const fitRows = [
    row({ id: '01', date: '2026-06-01', periodId: 'fit', side: 'away', slot: 1, pa: 4 }),
    row({ id: '02', date: '2026-06-02', periodId: 'fit', side: 'home', slot: 2, pa: 4 }),
  ];
  const validationRows = [
    row({ id: '03', date: '2026-06-03', periodId: 'validation', side: 'away', slot: 1, pa: 5 }),
    row({ id: '04', date: '2026-06-03', periodId: 'validation', side: 'home', slot: 2, pa: 4 }),
    row({ id: '05', date: '2026-06-04', periodId: 'validation', side: 'away', slot: 1, pa: 4 }),
    row({ id: '06', date: '2026-06-04', periodId: 'validation', side: 'home', slot: 2, pa: 3 }),
  ];
  return {
    datasetVersion: 1,
    provider: 'BALLDONTLIE MLB API',
    activeSeason: 2026,
    datasetSha256: DIGEST,
    sourceCaptureManifestSha256: DIGEST,
    sourceCapturePlanSha256: DIGEST,
    sourceResolvedDatasetSha256: DIGEST,
    includedPeriods: ['fit', 'validation'],
    untouchedTestReservation: {
      startDate: '2026-07-06',
      endDate: '2026-07-25',
      rowsIncluded: false,
    },
    exclusionPolicy: {
      componentArithmeticFallback: 'prohibited',
      componentArithmeticMismatch:
        'retain-direct-stats.plate_appearances-and-preserve-audit-flag',
    },
    periods: {
      fit: { rowCount: fitRows.length, rows: fitRows },
      validation: { rowCount: validationRows.length, rows: validationRows },
    },
  };
}

function score(candidateId, validationRows) {
  if (candidateId === 'candidate-b') {
    return 0.25;
  }
  const total = validationRows.reduce(
    (sum, observation) =>
      sum + (observation.observedDate === '2026-06-03' ? 0.1 : 0.5),
    0,
  );
  return total / validationRows.length;
}

function evaluator({ rawDataset, candidates }) {
  const validationRows = rawDataset.periods.validation.rows;
  const candidateSummaries = candidates
    .map((candidate) => {
      const logLoss = score(candidate.candidateId, validationRows);
      return {
        candidateId: candidate.candidateId,
        grouping: candidate.grouping,
        leagueEquivalentObservations: candidate.leagueEquivalentObservations,
        validationObservationCount: validationRows.length,
        logLoss,
        multiclassBrier: logLoss + 0.01,
        actualProbabilityMinimum: 0.01,
        actualProbabilityMaximum: 0.99,
      };
    })
    .sort(
      (left, right) =>
        left.logLoss - right.logLoss ||
        left.multiclassBrier - right.multiclassBrier ||
        left.candidateId.localeCompare(right.candidateId),
    );
  const identity = JSON.stringify(candidateSummaries);
  return {
    validationObservationCount: validationRows.length,
    candidateSummaries,
    selectedCandidateId: candidateSummaries[0].candidateId,
    evaluationSha256: createHash('sha256').update(identity).digest('hex'),
  };
}

test('builds expanding daily folds and aggregates identical cohorts', () => {
  const result = evaluateM8PaSurvivalWalkForward({
    rawDataset: dataset(),
    datasetFileSha256: DIGEST,
    candidates: CANDIDATES,
    evaluateCandidates: evaluator,
  });

  assert.equal(result.foldCount, 2);
  assert.equal(result.aggregateValidationObservationCount, 4);
  assert.equal(result.folds[0].trainingObservationCount, 2);
  assert.equal(result.folds[0].trainingEndDate, '2026-06-02');
  assert.equal(result.folds[1].trainingObservationCount, 4);
  assert.equal(result.folds[1].trainingEndDate, '2026-06-03');
  assert.equal(result.selectedCandidateId, 'candidate-b');
  assert.deepEqual(result.selectedCandidateCounts, {
    'candidate-a': 1,
    'candidate-b': 1,
  });
  assert.equal(result.aggregateResults[0].validationObservationCount, 4);
  assert.equal(result.monotoneProjectionApplied, false);
});

test('produces deterministic identity for identical inputs', () => {
  const first = evaluateM8PaSurvivalWalkForward({
    rawDataset: dataset(),
    datasetFileSha256: DIGEST,
    candidates: CANDIDATES,
    evaluateCandidates: evaluator,
  });
  const second = evaluateM8PaSurvivalWalkForward({
    rawDataset: dataset(),
    datasetFileSha256: DIGEST,
    candidates: CANDIDATES,
    evaluateCandidates: evaluator,
  });
  assert.equal(first.walkForwardSha256, second.walkForwardSha256);
  assert.deepEqual(first, second);
});

test('rejects exposed untouched-test rows', () => {
  const source = dataset();
  source.untouchedTestReservation = {
    ...source.untouchedTestReservation,
    rowsIncluded: true,
    rows: [],
  };
  assert.throws(
    () =>
      evaluateM8PaSurvivalWalkForward({
        rawDataset: source,
        datasetFileSha256: DIGEST,
        candidates: CANDIDATES,
        evaluateCandidates: evaluator,
      }),
    /untouched-test rows must remain excluded/,
  );
});

test('rejects non-chronological fit and validation periods', () => {
  const source = dataset();
  source.periods.fit.rows[1] = {
    ...source.periods.fit.rows[1],
    rowId: 'fit:2026-06-03:02',
    observedDate: '2026-06-03',
  };
  assert.throws(
    () =>
      evaluateM8PaSurvivalWalkForward({
        rawDataset: source,
        datasetFileSha256: DIGEST,
        candidates: CANDIDATES,
        evaluateCandidates: evaluator,
      }),
    /fit and validation periods must be strictly chronological/,
  );
});
