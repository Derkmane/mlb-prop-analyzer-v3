import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import test from 'node:test';

import {
  buildM8PaSurvivalBaselineArtifact,
  verifyM8PaSurvivalBaselineArtifact,
} from '../scripts/m8-pa-survival-baseline-artifact-utils.mjs';

function sha256(value) {
  return createHash('sha256').update(value).digest('hex');
}

const digest = (character) => character.repeat(64);

function makeDataset() {
  const identity = {
    datasetVersion: 1,
    provider: 'BALLDONTLIE MLB API',
    activeSeason: 2026,
    sourceCaptureManifestSha256: digest('a'),
    sourceCapturePlanSha256: digest('b'),
    sourceResolvedDatasetSha256: digest('c'),
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
    totals: {
      includedObservationCount: 36,
    },
    periods: {
      fit: { rowCount: 36, rows: [] },
      validation: { rowCount: 0, rows: [] },
    },
    incompleteLineupGames: [],
    excludedStarterObservations: [],
  };
  return {
    ...identity,
    datasetSha256: sha256(JSON.stringify(identity)),
  };
}

function groups() {
  return ['away', 'home'].flatMap((side) =>
    Array.from({ length: 9 }, (_, index) => ({
      groupKey: `${side}:slot:${index + 1}`,
      fitObservationCount: 2,
      countVector: [1, 1],
      rawPmf: [0.5, 0.5],
      rawSurvival: [0.5],
      fittedPmf: [0.5, 0.5],
      fittedSurvival: [0.5],
    })),
  );
}

function makeSources() {
  const dataset = makeDataset();
  const datasetText = JSON.stringify(dataset);
  const evaluation = {
    evaluationVersion: 1,
    activeSeason: 2026,
    sourceDatasetSha256: dataset.datasetSha256,
    sourceDatasetFileSha256: sha256(datasetText),
    fitWindow: { startDate: '2026-03-27', endDate: '2026-06-21' },
    validationWindow: { startDate: '2026-06-22', endDate: '2026-07-05' },
    validationObservationCount: 20,
    countSupport: { minimum: 0, maximum: 1 },
    selectedCandidateId: 'slot-home-away-pool-50',
    candidateSummaries: [
      {
        candidateId: 'slot-home-away-pool-50',
        logLoss: 1.1,
        multiclassBrier: 0.59,
      },
    ],
    selectedModel: {
      candidateId: 'slot-home-away-pool-50',
      grouping: 'slot-home-away',
      leagueEquivalentObservations: 50,
      groups: groups(),
      rawCurvesMonotoneByConstruction: true,
      fittedCurvesMonotoneByConstruction: true,
      monotoneProjectionApplied: false,
    },
    untouchedTestReservation: dataset.untouchedTestReservation,
    evaluationSha256: digest('d'),
  };
  const walkForward = {
    walkForwardVersion: 1,
    activeSeason: 2026,
    sourceDatasetSha256: dataset.datasetSha256,
    sourceDatasetFileSha256: sha256(datasetText),
    sourceHoldoutEvaluationSha256: evaluation.evaluationSha256,
    sourceHoldoutSelectedCandidateId: 'slot-home-away-pool-50',
    selectedCandidateId: 'slot-home-away-pool-50',
    foldCount: 14,
    aggregateValidationObservationCount: 20,
    aggregateResults: [
      {
        candidateId: 'slot-home-away-pool-50',
        logLoss: 1.102,
        multiclassBrier: 0.591,
      },
    ],
    selectedCandidateCounts: { 'slot-home-away-pool-1': 6 },
    selectedGroupingCounts: { 'slot-home-away': 10, slot: 4 },
    rawCurvesMonotoneByConstruction: true,
    fittedCurvesMonotoneByConstruction: true,
    monotoneProjectionApplied: false,
    untouchedTestReservation: dataset.untouchedTestReservation,
    walkForwardSha256: digest('e'),
  };
  return {
    dataset,
    datasetFileSha256: sha256(datasetText),
    evaluation,
    evaluationFileSha256: sha256(JSON.stringify(evaluation)),
    walkForward,
    walkForwardFileSha256: sha256(JSON.stringify(walkForward)),
  };
}

test('freezes the agreed 18-group PA-survival baseline deterministically', () => {
  const source = makeSources();
  const first = buildM8PaSurvivalBaselineArtifact({
    rawDataset: source.dataset,
    datasetFileSha256: source.datasetFileSha256,
    rawEvaluation: source.evaluation,
    evaluationFileSha256: source.evaluationFileSha256,
    rawWalkForward: source.walkForward,
    walkForwardFileSha256: source.walkForwardFileSha256,
  });
  const second = buildM8PaSurvivalBaselineArtifact({
    rawDataset: source.dataset,
    datasetFileSha256: source.datasetFileSha256,
    rawEvaluation: source.evaluation,
    evaluationFileSha256: source.evaluationFileSha256,
    rawWalkForward: source.walkForward,
    walkForwardFileSha256: source.walkForwardFileSha256,
  });

  assert.deepEqual(first, second);
  assert.equal(first.groups.length, 18);
  assert.equal(first.selectedCandidateId, 'slot-home-away-pool-50');
  assert.equal(first.status, 'benchmark-only-not-production-validated');
  assert.equal(verifyM8PaSurvivalBaselineArtifact(first), first);
});

test('rejects disagreement between holdout and walk-forward selection', () => {
  const source = makeSources();
  source.walkForward.selectedCandidateId = 'slot-home-away-pool-25';
  assert.throws(
    () =>
      buildM8PaSurvivalBaselineArtifact({
        rawDataset: source.dataset,
        datasetFileSha256: source.datasetFileSha256,
        rawEvaluation: source.evaluation,
        evaluationFileSha256: source.evaluationFileSha256,
        rawWalkForward: source.walkForward,
        walkForwardFileSha256: source.walkForwardFileSha256,
      }),
    /do not agree on pool-50/,
  );
});

test('rejects a fitted survival curve that does not reconstruct its PMF', () => {
  const source = makeSources();
  source.evaluation.selectedModel.groups[0].fittedSurvival = [0.4];
  assert.throws(
    () =>
      buildM8PaSurvivalBaselineArtifact({
        rawDataset: source.dataset,
        datasetFileSha256: source.datasetFileSha256,
        rawEvaluation: source.evaluation,
        evaluationFileSha256: source.evaluationFileSha256,
        rawWalkForward: source.walkForward,
        walkForwardFileSha256: source.walkForwardFileSha256,
      }),
    /does not reconstruct/,
  );
});

test('rejects any untouched-test row payload', () => {
  const source = makeSources();
  source.dataset.untouchedTestReservation = {
    ...source.dataset.untouchedTestReservation,
    rows: [],
  };
  assert.throws(
    () =>
      buildM8PaSurvivalBaselineArtifact({
        rawDataset: source.dataset,
        datasetFileSha256: source.datasetFileSha256,
        rawEvaluation: source.evaluation,
        evaluationFileSha256: source.evaluationFileSha256,
        rawWalkForward: source.walkForward,
        walkForwardFileSha256: source.walkForwardFileSha256,
      }),
    /untouched-test rows must remain excluded/,
  );
});
