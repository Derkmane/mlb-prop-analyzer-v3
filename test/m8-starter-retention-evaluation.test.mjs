import assert from 'node:assert/strict';
import test from 'node:test';

import {
  evaluateM8StarterRetention,
  verifyM8StarterRetentionEvaluation,
} from '../scripts/m8-starter-retention-evaluation-utils.mjs';
import { sha256 } from '../scripts/provider-probe-utils.mjs';

const SEALED = Object.freeze({
  startDate: '2026-07-06',
  endDate: '2026-07-25',
  rowsIncluded: false,
  allowedUse: 'final-evaluation-only-after-candidate-selection',
});

const CANDIDATES = Object.freeze([
  Object.freeze({
    candidateId: 'no-retention-slot-turns',
    kind: 'no-retention',
    grouping: 'none',
    leagueEquivalentRisk: null,
  }),
  Object.freeze({
    candidateId: 'retention-league-turn',
    kind: 'retention',
    grouping: 'league',
    leagueEquivalentRisk: 0,
  }),
]);

function row({ periodId, observedDate, index, starterPlateAppearances }) {
  return {
    rowId: `${periodId}:${observedDate}:${index}`,
    observedDate,
    periodId,
    gameId: 1000 + index,
    side: index % 2 === 0 ? 'home' : 'away',
    homeAway: index % 2 === 0 ? 'home' : 'away',
    teamId: 2000 + index,
    playerId: 3000 + index,
    playerName: `Starter ${index}`,
    lineupSlot: (index % 9) + 1,
    slotTurns: 4,
    starterPlateAppearances,
    substituted: starterPlateAppearances < 4,
    firstReplacementTurn: starterPlateAppearances < 4 ? starterPlateAppearances + 1 : null,
    sourceCaptureSha256: String(index % 10).repeat(64),
  };
}

function datasetIdentity(dataset) {
  return {
    datasetVersion: dataset.datasetVersion,
    provider: dataset.provider,
    activeSeason: dataset.activeSeason,
    sourceCaptureManifestSha256: dataset.sourceCaptureManifestSha256,
    sourceResolvedDatasetSha256: dataset.sourceResolvedDatasetSha256,
    sourceResolvedDatasetFileSha256: dataset.sourceResolvedDatasetFileSha256,
    includedPeriods: dataset.includedPeriods,
    untouchedTestReservation: dataset.untouchedTestReservation,
    exclusionPolicy: dataset.exclusionPolicy,
    totals: dataset.totals,
    exclusionReasonCounts: dataset.exclusionReasonCounts,
    periods: dataset.periods,
    excludedTeamGames: dataset.excludedTeamGames,
  };
}

function makeDataset() {
  const fitRows = Array.from({ length: 40 }, (_, index) =>
    row({
      periodId: 'fit',
      observedDate: index < 20 ? '2026-05-01' : '2026-05-02',
      index: index + 1,
      starterPlateAppearances: index % 2 === 0 ? 2 : 4,
    }),
  );
  const validationRows = Array.from({ length: 20 }, (_, index) =>
    row({
      periodId: 'validation',
      observedDate: index < 10 ? '2026-06-22' : '2026-06-23',
      index: 100 + index,
      starterPlateAppearances: index % 2 === 0 ? 2 : 4,
    }),
  );
  const totals = {
    capturedGameCount: 0,
    candidateTeamGameCount: 0,
    includedTeamGameCount: 0,
    excludedTeamGameCount: 0,
    includedSlotObservationCount: fitRows.length + validationRows.length,
    terminalPlateAppearanceCount: 0,
    ignoredBaserunningRowCount: 0,
    substitutedSlotObservationCount: 30,
  };
  const dataset = {
    purpose: 'synthetic starter retention evaluation dataset',
    datasetVersion: 1,
    provider: 'BALLDONTLIE MLB API',
    activeSeason: 2026,
    sourceCaptureManifestSha256: 'a'.repeat(64),
    sourceResolvedDatasetSha256: 'b'.repeat(64),
    sourceResolvedDatasetFileSha256: 'c'.repeat(64),
    includedPeriods: ['fit', 'validation'],
    untouchedTestReservation: SEALED,
    exclusionPolicy: { repairsOrInterpolation: 'prohibited' },
    totals,
    exclusionReasonCounts: {},
    periods: {
      fit: {
        startDate: '2026-05-01',
        endDate: '2026-05-02',
        rowCount: fitRows.length,
        rows: fitRows,
      },
      validation: {
        startDate: '2026-06-22',
        endDate: '2026-06-23',
        rowCount: validationRows.length,
        rows: validationRows,
      },
    },
    excludedTeamGames: [],
  };
  dataset.datasetSha256 = sha256(JSON.stringify(datasetIdentity(dataset)));
  return dataset;
}

test('selects retention over assigning every batting-slot turn to the named starter', () => {
  const dataset = makeDataset();
  const evaluation = evaluateM8StarterRetention({
    rawDataset: dataset,
    datasetText: JSON.stringify(dataset),
    candidates: CANDIDATES,
  });

  assert.equal(evaluation.status, 'starter-retention-candidate-selected');
  assert.equal(evaluation.fixedSelectedCandidateId, 'retention-league-turn');
  assert.equal(evaluation.walkForward.selectedCandidateId, 'retention-league-turn');
  assert.equal(evaluation.selectionAgreement, true);
  assert.equal(evaluation.selectedBeatsNoRetention, true);
  const baseline = evaluation.fixedResults.find(
    (result) => result.candidate.candidateId === 'no-retention-slot-turns',
  );
  const selected = evaluation.fixedResults.find(
    (result) => result.candidate.candidateId === 'retention-league-turn',
  );
  assert.ok(selected.metrics.overall.logLoss < baseline.metrics.overall.logLoss);
  assert.ok(
    selected.metrics.overall.multiclassBrier <
      baseline.metrics.overall.multiclassBrier,
  );
  assert.equal(evaluation.walkForward.foldCount, 2);
  assert.equal(evaluation.untouchedTestReservation.rowsIncluded, false);
  assert.equal(verifyM8StarterRetentionEvaluation(evaluation), evaluation);
});

test('hashes exact dataset file bytes including trailing newline', () => {
  const dataset = makeDataset();
  const text = `${JSON.stringify(dataset)}\n`;

  const evaluation = evaluateM8StarterRetention({
    rawDataset: dataset,
    datasetText: text,
    candidates: CANDIDATES,
  });

  assert.equal(
    evaluation.sourceDatasetFileSha256,
    sha256(text),
  );
});

test('is deterministic for identical versioned inputs', () => {
  const dataset = makeDataset();
  const text = JSON.stringify(dataset);
  const first = evaluateM8StarterRetention({
    rawDataset: dataset,
    datasetText: text,
    candidates: CANDIDATES,
  });
  const second = evaluateM8StarterRetention({
    rawDataset: dataset,
    datasetText: text,
    candidates: CANDIDATES,
  });

  assert.equal(first.evaluationSha256, second.evaluationSha256);
  assert.deepEqual(first, second);
});

test('rejects any dataset that exposes untouched-test rows', () => {
  const dataset = makeDataset();
  dataset.untouchedTestReservation = { ...SEALED, rowsIncluded: true };
  dataset.datasetSha256 = sha256(JSON.stringify(datasetIdentity(dataset)));
  assert.throws(
    () =>
      evaluateM8StarterRetention({
        rawDataset: dataset,
        datasetText: JSON.stringify(dataset),
        candidates: CANDIDATES,
      }),
    /untouched-test rows sealed/,
  );
});
