import { createHash } from 'node:crypto';
import test from 'node:test';
import assert from 'node:assert/strict';

import { evaluateM8SharedOffensiveEnvironment } from '../scripts/m8-shared-offensive-environment-utils.mjs';
import {
  evaluateM8SharedOffensiveEnvironmentWalkForward,
  verifyM8SharedOffensiveEnvironmentWalkForward,
} from '../scripts/m8-shared-offensive-environment-walk-forward-utils.mjs';

const SHA_A = 'a'.repeat(64);
const SHA_B = 'b'.repeat(64);
const SHA_C = 'c'.repeat(64);
const SHA_D = 'd'.repeat(64);
const DATASET_FILE_SHA = 'e'.repeat(64);
const EVALUATION_FILE_SHA = 'f'.repeat(64);

function sha256(value) {
  return createHash('sha256').update(value).digest('hex');
}

function datasetIdentity(dataset) {
  return {
    datasetVersion: dataset.datasetVersion,
    provider: dataset.provider,
    activeSeason: dataset.activeSeason,
    sourceCaptureManifestSha256: dataset.sourceCaptureManifestSha256,
    sourceCapturePlanSha256: dataset.sourceCapturePlanSha256,
    sourceResolvedDatasetSha256: dataset.sourceResolvedDatasetSha256,
    sourceResolvedDatasetFileSha256: dataset.sourceResolvedDatasetFileSha256,
    includedPeriods: dataset.includedPeriods,
    untouchedTestReservation: dataset.untouchedTestReservation,
    exclusionPolicy: dataset.exclusionPolicy,
    totals: dataset.totals,
    exclusionReasonCounts: dataset.exclusionReasonCounts,
    periods: dataset.periods,
    excludedGames: dataset.excludedGames,
  };
}

function gameRows({ gameId, date, periodId, state }) {
  const awayPa = [34, 37, 41, 45][state];
  const homePa = [33, 39, 36, 42][state];
  const awayRates = [0.15, 0.18, 0.24, 0.27];
  const homeRates = [0.17, 0.25, 0.19, 0.26];
  const awayHits = Math.max(0, Math.min(awayPa, Math.round(awayPa * awayRates[state])));
  const homeHits = Math.max(0, Math.min(homePa, Math.round(homePa * homeRates[state])));
  const makeRow = (side, teamPa, opponentPa, hits, runs) => ({
    rowId: `${periodId}:${date}:${gameId}:${side}`,
    observedDate: date,
    periodId,
    gameId,
    side,
    homeAway: side,
    teamId: gameId * 10 + (side === 'away' ? 1 : 2),
    teamName: `${side}-${gameId}`,
    opponentTeamId: gameId * 10 + (side === 'away' ? 2 : 1),
    opponentTeamName: `${side === 'away' ? 'home' : 'away'}-${gameId}`,
    teamPlateAppearances: teamPa,
    opponentPlateAppearances: opponentPa,
    gamePlateAppearances: teamPa + opponentPa,
    teamHits: hits,
    teamRuns: runs,
    pitcherIds: [gameId * 100 + (side === 'away' ? 1 : 2)],
    pitcherCount: 1,
    resolvedRowCount: teamPa,
    paEvidenceRowCount: teamPa,
    ignoredBaserunningRowCount: 0,
    directBatterPaComparator: { available: true, playerCount: 9, totalPlateAppearances: teamPa },
    sourceCaptureSha256: SHA_D,
    sourceStatsRawBodySha256s: [SHA_D],
  });
  return [
    makeRow('away', awayPa, homePa, awayHits, Math.max(0, awayHits - 2)),
    makeRow('home', homePa, awayPa, homeHits, Math.max(0, homeHits - 2)),
  ];
}

function period(rows) {
  const ordered = rows
    .slice()
    .sort(
      (left, right) =>
        left.observedDate.localeCompare(right.observedDate) ||
        left.gameId - right.gameId ||
        left.side.localeCompare(right.side),
    );
  return {
    startDate: ordered[0].observedDate,
    endDate: ordered.at(-1).observedDate,
    rowCount: ordered.length,
    rows: ordered,
  };
}

function buildDataset({ mutateLastValidation = false } = {}) {
  const fitRows = [];
  for (let index = 0; index < 24; index += 1) {
    const day = String(1 + Math.floor(index / 4)).padStart(2, '0');
    fitRows.push(
      ...gameRows({
        gameId: 100 + index,
        date: `2026-06-${day}`,
        periodId: 'fit',
        state: index % 4,
      }),
    );
  }
  const validationRows = [];
  for (let index = 0; index < 8; index += 1) {
    const day = String(22 + Math.floor(index / 2)).padStart(2, '0');
    const rows = gameRows({
      gameId: 200 + index,
      date: `2026-06-${day}`,
      periodId: 'validation',
      state: (index + 1) % 4,
    });
    if (mutateLastValidation && index >= 6) {
      for (const row of rows) {
        row.teamHits = Math.min(row.teamPlateAppearances, row.teamHits + 8);
        row.teamRuns += 5;
      }
    }
    validationRows.push(...rows);
  }
  const allRows = [...fitRows, ...validationRows];
  const identity = {
    datasetVersion: 2,
    provider: 'BALLDONTLIE MLB API',
    activeSeason: 2026,
    sourceCaptureManifestSha256: SHA_A,
    sourceCapturePlanSha256: SHA_B,
    sourceResolvedDatasetSha256: SHA_C,
    sourceResolvedDatasetFileSha256: SHA_D,
    includedPeriods: ['fit', 'validation'],
    untouchedTestReservation: { rowsIncluded: false },
    exclusionPolicy: {
      pairedTeamGameRequirement: 'both-sides-or-neither',
    },
    totals: {
      capturedGameCount: allRows.length / 2,
      candidateTeamGameCount: allRows.length,
      includedGameCount: allRows.length / 2,
      includedTeamGameCount: allRows.length,
      excludedGameCount: 0,
      excludedTeamGameCount: 0,
      totalIncludedPlateAppearances: allRows.reduce(
        (sum, row) => sum + row.teamPlateAppearances,
        0,
      ),
      totalIncludedHits: allRows.reduce((sum, row) => sum + row.teamHits, 0),
      totalIncludedRuns: allRows.reduce((sum, row) => sum + row.teamRuns, 0),
      ignoredBaserunningRowCount: 0,
      optionalDirectPaComparatorSideCount: allRows.length,
    },
    exclusionReasonCounts: {},
    periods: {
      fit: period(fitRows),
      validation: period(validationRows),
    },
    excludedGames: [],
  };
  return {
    purpose: 'synthetic walk-forward fixture',
    ...identity,
    datasetSha256: sha256(JSON.stringify(datasetIdentity(identity))),
  };
}

function evaluateSource(dataset) {
  return evaluateM8SharedOffensiveEnvironment({
    dataset,
    sourceDatasetFileSha256: DATASET_FILE_SHA,
  });
}

function evaluateWalkForward(dataset, sourceEvaluation = evaluateSource(dataset)) {
  return evaluateM8SharedOffensiveEnvironmentWalkForward({
    dataset,
    sourceDatasetFileSha256: DATASET_FILE_SHA,
    sourceEvaluation,
    sourceEvaluationFileSha256: EVALUATION_FILE_SHA,
  });
}

test('scores every validation game once across deterministic expanding daily folds', () => {
  const dataset = buildDataset();
  const first = evaluateWalkForward(dataset);
  const second = evaluateWalkForward(dataset);
  assert.equal(first.foldCount, 4);
  assert.equal(first.validationGameCount, 8);
  assert.equal(first.allValidationGamesScoredExactlyOnce, true);
  assert.equal(first.folds[0].fitGameCount, 24);
  assert.equal(first.folds.at(-1).fitGameCount, 30);
  for (const fold of first.folds) {
    assert.ok(fold.fitEndDate < fold.validationDate);
    for (const candidate of fold.candidates) {
      assert.ok(Math.abs(candidate.scenarioWeightSum - 1) < 1e-12);
    }
  }
  assert.equal(first.walkForwardSha256, second.walkForwardSha256);
  assert.deepEqual(first, second);
  verifyM8SharedOffensiveEnvironmentWalkForward(first);
});

test('later validation outcomes cannot alter earlier fold fits or scores', () => {
  const original = buildDataset();
  const mutated = buildDataset({ mutateLastValidation: true });
  const originalWalkForward = evaluateWalkForward(original);
  const mutatedWalkForward = evaluateWalkForward(mutated);
  assert.deepEqual(originalWalkForward.folds[0], mutatedWalkForward.folds[0]);
  assert.notDeepEqual(
    originalWalkForward.folds.at(-1).candidates,
    mutatedWalkForward.folds.at(-1).candidates,
  );
});

test('rejects a valid source holdout evaluation from another dataset', () => {
  const original = buildDataset();
  const otherDataset = buildDataset({ mutateLastValidation: true });
  const sourceEvaluation = evaluateSource(original);
  assert.throws(
    () => evaluateWalkForward(otherDataset, sourceEvaluation),
    /source shared-environment evaluation does not match the dataset/,
  );
});

test('rejects any untouched-test row payload', () => {
  const dataset = buildDataset();
  dataset.untouchedTestReservation = { rowsIncluded: false, rows: [] };
  assert.throws(
    () => evaluateWalkForward(dataset),
    /untouched-test rows sealed|untouched-test rows excluded/,
  );
});
