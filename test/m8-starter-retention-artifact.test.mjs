import assert from 'node:assert/strict';
import test from 'node:test';

import {
  buildM8StarterRetentionArtifact,
  verifyM8StarterRetentionArtifact,
} from '../scripts/m8-starter-retention-artifact-utils.mjs';
import { evaluateM8StarterRetention } from '../scripts/m8-starter-retention-evaluation-utils.mjs';
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

function makeRow(periodId, observedDate, index, starterPlateAppearances) {
  return {
    rowId: `${periodId}:${observedDate}:${index}`,
    observedDate,
    periodId,
    gameId: 5000 + index,
    side: index % 2 === 0 ? 'home' : 'away',
    homeAway: index % 2 === 0 ? 'home' : 'away',
    teamId: 6000 + index,
    playerId: 7000 + index,
    playerName: `Starter ${index}`,
    lineupSlot: (index % 9) + 1,
    slotTurns: 4,
    starterPlateAppearances,
    substituted: starterPlateAppearances < 4,
    firstReplacementTurn: starterPlateAppearances < 4 ? 3 : null,
    sourceCaptureSha256: String(index % 10).repeat(64),
  };
}

function makeDataset() {
  const fitRows = Array.from({ length: 40 }, (_, index) =>
    makeRow(
      'fit',
      index < 20 ? '2026-05-01' : '2026-05-02',
      index + 1,
      index % 2 === 0 ? 2 : 4,
    ),
  );
  const validationRows = Array.from({ length: 20 }, (_, index) =>
    makeRow(
      'validation',
      index < 10 ? '2026-06-22' : '2026-06-23',
      index + 100,
      index % 2 === 0 ? 2 : 4,
    ),
  );
  const dataset = {
    purpose: 'synthetic retention artifact dataset',
    datasetVersion: 1,
    provider: 'BALLDONTLIE MLB API',
    activeSeason: 2026,
    sourceCaptureManifestSha256: 'a'.repeat(64),
    sourceResolvedDatasetSha256: 'b'.repeat(64),
    sourceResolvedDatasetFileSha256: 'c'.repeat(64),
    includedPeriods: ['fit', 'validation'],
    untouchedTestReservation: SEALED,
    exclusionPolicy: { repairsOrInterpolation: 'prohibited' },
    totals: {
      capturedGameCount: 0,
      candidateTeamGameCount: 0,
      includedTeamGameCount: 0,
      excludedTeamGameCount: 0,
      includedSlotObservationCount: 60,
      terminalPlateAppearanceCount: 0,
      ignoredBaserunningRowCount: 0,
      substitutedSlotObservationCount: 30,
    },
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

function build() {
  const dataset = makeDataset();
  const datasetText = JSON.stringify(dataset);
  const evaluation = evaluateM8StarterRetention({
    rawDataset: dataset,
    datasetText,
    candidates: CANDIDATES,
  });
  const evaluationText = JSON.stringify(evaluation);
  return buildM8StarterRetentionArtifact({
    rawDataset: dataset,
    datasetFileSha256: sha256(datasetText),
    rawEvaluation: evaluation,
    evaluationFileSha256: sha256(evaluationText),
  });
}

test('freezes selected starter retention while remaining disabled before untouched testing', () => {
  const artifact = build();

  assert.equal(artifact.modelVersion, 'm8-starter-retention-v1');
  assert.equal(
    artifact.status,
    'frozen-current-season-candidate-awaiting-untouched-test',
  );
  assert.equal(artifact.productionEnabled, false);
  assert.equal(artifact.selectedCandidate.candidateId, 'retention-league-turn');
  assert.deepEqual(artifact.conditionalRetentionByGroup.league, [1, 1, 0.5, 1]);
  assert.equal(artifact.untouchedTestReservation.rowsIncluded, false);
  assert.equal(verifyM8StarterRetentionArtifact(artifact), artifact);
});

test('rejects any frozen probability changed after hashing', () => {
  const artifact = build();
  const tampered = structuredClone(artifact);
  tampered.conditionalRetentionByGroup.league[2] = 0.75;
  assert.throws(
    () => verifyM8StarterRetentionArtifact(tampered),
    /artifact SHA-256 is invalid/,
  );
});
