import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';

import {
  evaluateM8SharedOffensiveEnvironment,
  verifyM8SharedOffensiveEnvironmentEvaluation,
} from '../scripts/m8-shared-offensive-environment-utils.mjs';

const SHA = 'a'.repeat(64);

function sha256(value) {
  return createHash('sha256').update(value).digest('hex');
}

function dataset({ mutateValidation = false, badPair = false, exposeUntouched = false } = {}) {
  const makePeriod = (periodId, startIndex, count, validation = false) => {
    const rows = [];
    for (let index = 0; index < count; index += 1) {
      const gameId = startIndex + index;
      const high = index % 2 === 1;
      const awayPa = high ? 44 + (index % 3) : 30 + (index % 3);
      const homePa = high ? 43 + ((index + 1) % 3) : 29 + ((index + 1) % 3);
      const awayRate = high ? 0.28 : 0.1;
      const homeRate = high ? 0.27 : 0.11;
      const shift = validation && mutateValidation ? 6 : 0;
      const date =
        periodId === 'fit'
          ? `2026-06-${String(1 + index).padStart(2, '0')}`
          : `2026-07-${String(1 + index).padStart(2, '0')}`;
      rows.push({
        rowId: `${periodId}:${gameId}:away`,
        observedDate: date,
        periodId,
        gameId,
        side: 'away',
        homeAway: 'away',
        teamId: gameId * 10 + 1,
        teamPlateAppearances: awayPa + shift,
        teamHits: Math.round((awayPa + shift) * awayRate),
        teamRuns: 1,
        opponentPlateAppearances: homePa + shift,
        gamePlateAppearances: awayPa + homePa + shift * 2,
        pitcherIds: [gameId * 100 + 1],
        ignoredBaserunningRowCount: 0,
      });
      if (!(badPair && periodId === 'validation' && index === 0)) {
        rows.push({
          rowId: `${periodId}:${gameId}:home`,
          observedDate: date,
          periodId,
          gameId,
          side: 'home',
          homeAway: 'home',
          teamId: gameId * 10 + 2,
          teamPlateAppearances: homePa + shift,
          teamHits: Math.round((homePa + shift) * homeRate),
          teamRuns: 1,
          opponentPlateAppearances: awayPa + shift,
          gamePlateAppearances: awayPa + homePa + shift * 2,
          pitcherIds: [gameId * 100 + 2],
          ignoredBaserunningRowCount: 0,
        });
      }
    }
    return {
      startDate: rows[0].observedDate,
      endDate: rows.at(-1).observedDate,
      rowCount: rows.length,
      rows,
    };
  };
  const base = {
    datasetVersion: 2,
    provider: 'BALLDONTLIE MLB API',
    activeSeason: 2026,
    sourceCaptureManifestSha256: SHA,
    sourceCapturePlanSha256: SHA,
    sourceResolvedDatasetSha256: SHA,
    sourceResolvedDatasetFileSha256: SHA,
    includedPeriods: ['fit', 'validation'],
    untouchedTestReservation: exposeUntouched
      ? { rowsIncluded: false, rows: [] }
      : { rowsIncluded: false },
    exclusionPolicy: {},
    totals: {},
    exclusionReasonCounts: {},
    periods: {
      fit: makePeriod('fit', 1, 20, false),
      validation: makePeriod('validation', 100, 10, true),
    },
    excludedGames: [],
  };
  const allRows = [...base.periods.fit.rows, ...base.periods.validation.rows];
  base.totals = {
    capturedGameCount: 30,
    candidateTeamGameCount: 60,
    includedGameCount: 30,
    includedTeamGameCount: 60,
    excludedGameCount: 0,
    excludedTeamGameCount: 0,
    totalIncludedPlateAppearances: allRows.reduce(
      (sum, row) => sum + row.teamPlateAppearances,
      0,
    ),
    totalIncludedHits: allRows.reduce((sum, row) => sum + row.teamHits, 0),
    totalIncludedRuns: 60,
    ignoredBaserunningRowCount: 0,
    optionalDirectPaComparatorSideCount: 0,
  };
  const identity = {
    datasetVersion: base.datasetVersion,
    provider: base.provider,
    activeSeason: base.activeSeason,
    sourceCaptureManifestSha256: base.sourceCaptureManifestSha256,
    sourceCapturePlanSha256: base.sourceCapturePlanSha256,
    sourceResolvedDatasetSha256: base.sourceResolvedDatasetSha256,
    sourceResolvedDatasetFileSha256: base.sourceResolvedDatasetFileSha256,
    includedPeriods: base.includedPeriods,
    untouchedTestReservation: base.untouchedTestReservation,
    exclusionPolicy: base.exclusionPolicy,
    totals: base.totals,
    exclusionReasonCounts: base.exclusionReasonCounts,
    periods: base.periods,
    excludedGames: base.excludedGames,
  };
  base.datasetSha256 = sha256(JSON.stringify(identity));
  return base;
}

test('selects shared scenarios on a deterministic bimodal game environment', () => {
  const result = evaluateM8SharedOffensiveEnvironment({
    dataset: dataset(),
    sourceDatasetFileSha256: SHA,
  });
  assert.equal(result.holdoutSupportsSharedScenarios, true);
  assert.ok(result.selectedCandidate.scenarioCount > 1);
  assert.ok(
    result.selectedCandidate.validation.jointLogLoss <
      result.independenceBaseline.validation.jointLogLoss,
  );
  verifyM8SharedOffensiveEnvironmentEvaluation(result);
});

test('fits parameters from fit rows only', () => {
  const first = evaluateM8SharedOffensiveEnvironment({
    dataset: dataset(),
    sourceDatasetFileSha256: SHA,
  });
  const second = evaluateM8SharedOffensiveEnvironment({
    dataset: dataset({ mutateValidation: true }),
    sourceDatasetFileSha256: SHA,
  });
  const strip = (result) =>
    result.candidates
      .map((candidate) => ({
        scenarioCount: candidate.scenarioCount,
        selectedInitialization: candidate.selectedInitialization,
        scenarios: candidate.scenarios,
      }))
      .sort((left, right) => left.scenarioCount - right.scenarioCount);
  assert.deepEqual(strip(first), strip(second));
});

test('is deterministic for identical input', () => {
  const first = evaluateM8SharedOffensiveEnvironment({
    dataset: dataset(),
    sourceDatasetFileSha256: SHA,
  });
  const second = evaluateM8SharedOffensiveEnvironment({
    dataset: dataset(),
    sourceDatasetFileSha256: SHA,
  });
  assert.equal(first.evaluationSha256, second.evaluationSha256);
  assert.deepEqual(first, second);
});

test('conserves each candidate scenario weight', () => {
  const result = evaluateM8SharedOffensiveEnvironment({
    dataset: dataset(),
    sourceDatasetFileSha256: SHA,
  });
  for (const candidate of result.candidates) {
    const total = candidate.scenarios.reduce((sum, scenario) => sum + scenario.weight, 0);
    assert.ok(Math.abs(total - 1) < 1e-12);
  }
});

test('rejects a period missing one team side', () => {
  assert.throws(
    () =>
      evaluateM8SharedOffensiveEnvironment({
        dataset: dataset({ badPair: true }),
        sourceDatasetFileSha256: SHA,
      }),
    /both sides/,
  );
});

test('rejects untouched-test payloads', () => {
  assert.throws(
    () =>
      evaluateM8SharedOffensiveEnvironment({
        dataset: dataset({ exposeUntouched: true }),
        sourceDatasetFileSha256: SHA,
      }),
    /untouched-test rows excluded/,
  );
});
