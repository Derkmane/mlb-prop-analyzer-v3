import assert from 'node:assert/strict';
import test from 'node:test';
import { createHash } from 'node:crypto';

import {
  buildM8PaSurvivalDataset,
  verifyM8PaSurvivalDataset,
} from '../scripts/m8-pa-survival-dataset-utils.mjs';

const digest = (value) =>
  createHash('sha256').update(String(value)).digest('hex');

function starter(slot, overrides = {}) {
  return {
    battingOrder: slot,
    playerId: 1000 + slot,
    playerName: `Player ${slot}`,
    statsRowCount: 1,
    directPlateAppearances: 4,
    componentCandidate: 4,
    directMatchesCandidate: true,
    ...overrides,
  };
}

function team(side, teamId, overrides = {}) {
  const starters = Array.from({ length: 9 }, (_, index) => starter(index + 1));
  return {
    side,
    teamId,
    teamName: `${side} team`,
    lineupRowCount: 10,
    battingRowCount: 9,
    slots: [1, 2, 3, 4, 5, 6, 7, 8, 9],
    missingSlots: [],
    duplicateSlots: [],
    completeOfficialSlots: true,
    starters,
    ...overrides,
  };
}

function capture({ gameId, observedDate, periodId, teams, suffix = '' }) {
  return {
    captureVersion: 1,
    provider: 'BALLDONTLIE MLB API',
    sourcePlanSha256: digest('plan'),
    plannedGame: {
      gameId,
      observedDate,
      periodId,
      sourceRowCount: 10,
    },
    summary: {
      status: 'STATUS_FINAL',
      season: 2026,
      seasonType: 'regular',
      teams,
      snapshots: {
        statsRawBodySha256s: [digest(`stats-${gameId}`)],
        lineupRawBodySha256s: [digest(`lineups-${gameId}`)],
      },
    },
    captureSha256: digest(`capture-${gameId}-${suffix}`),
    untouchedTestReservation: {
      startDate: '2026-07-06',
      endDate: '2026-07-25',
      rowsIncluded: false,
    },
  };
}

function manifest(games) {
  return {
    manifestVersion: 1,
    provider: 'BALLDONTLIE MLB API',
    activeSeason: 2026,
    sourcePlanSha256: digest('plan'),
    sourceResolvedDatasetSha256: digest('resolved'),
    gameCount: games.length,
    sourceRowCount: 100,
    includedPeriods: ['fit', 'validation'],
    untouchedTestReservation: {
      startDate: '2026-07-06',
      endDate: '2026-07-25',
      rowsIncluded: false,
    },
    games: games.map((game) => ({
      gameId: game.plannedGame.gameId,
      observedDate: game.plannedGame.observedDate,
      periodId: game.plannedGame.periodId,
      summarySha256: digest(`summary-${game.plannedGame.gameId}`),
    })),
    manifestSha256: digest('manifest'),
  };
}

test('uses direct PA totals and retains component mismatches as audit metadata', () => {
  const away = team('away', 1);
  away.starters[0] = starter(1, {
    directPlateAppearances: 5,
    componentCandidate: 4,
    directMatchesCandidate: false,
  });
  const game = capture({
    gameId: 1,
    observedDate: '2026-04-01',
    periodId: 'fit',
    teams: [away, team('home', 2)],
  });

  const dataset = buildM8PaSurvivalDataset({
    captureManifest: manifest([game]),
    captures: [game],
  });
  const row = dataset.periods.fit.rows.find(
    (value) => value.side === 'away' && value.lineupSlot === 1,
  );

  assert.equal(row.plateAppearances, 5);
  assert.equal(row.sourceField, 'stats.plate_appearances');
  assert.equal(row.componentCandidate, 4);
  assert.equal(row.componentAuditStatus, 'mismatch');
  assert.equal(dataset.totals.componentAuditMismatchCount, 1);
  assert.equal(dataset.exclusionPolicy.componentArithmeticFallback, 'prohibited');
});

test('excludes incomplete games and explicitly excludes missing, duplicate, and null starter stats', () => {
  const completeAway = team('away', 1);
  completeAway.starters[0] = starter(1, { statsRowCount: 0 });
  completeAway.starters[1] = starter(2, { statsRowCount: 2 });
  completeAway.starters[2] = starter(3, {
    directPlateAppearances: null,
    componentCandidate: 4,
    directMatchesCandidate: null,
  });
  const complete = capture({
    gameId: 2,
    observedDate: '2026-04-02',
    periodId: 'fit',
    teams: [completeAway, team('home', 2)],
  });
  const partialHome = team('home', 4, {
    battingRowCount: 8,
    slots: [1, 2, 3, 4, 5, 6, 7, 8],
    missingSlots: [9],
    completeOfficialSlots: false,
    starters: Array.from({ length: 8 }, (_, index) => starter(index + 1)),
  });
  const incomplete = capture({
    gameId: 3,
    observedDate: '2026-04-03',
    periodId: 'fit',
    teams: [team('away', 3), partialHome],
  });

  const dataset = buildM8PaSurvivalDataset({
    captureManifest: manifest([complete, incomplete]),
    captures: [complete, incomplete],
  });

  assert.equal(dataset.totals.completeLineupGameCount, 1);
  assert.equal(dataset.totals.incompleteLineupGameCount, 1);
  assert.equal(dataset.totals.officialStarterSlotCount, 18);
  assert.equal(dataset.totals.includedObservationCount, 15);
  assert.equal(dataset.totals.excludedMissingStatsCount, 1);
  assert.equal(dataset.totals.excludedDuplicateStatsCount, 1);
  assert.equal(dataset.totals.excludedNullDirectPaCount, 1);
  assert.equal(dataset.incompleteLineupGames[0].gameId, 3);
  assert.deepEqual(
    dataset.excludedStarterObservations.map((row) => row.reason).sort(),
    [
      'duplicate-stats-rows',
      'missing-stats-row',
      'null-direct-plate-appearances',
    ],
  );
});

test('preserves fit-validation chronology and deterministic identity', () => {
  const fit = capture({
    gameId: 10,
    observedDate: '2026-04-10',
    periodId: 'fit',
    teams: [team('away', 1), team('home', 2)],
  });
  const validation = capture({
    gameId: 20,
    observedDate: '2026-06-25',
    periodId: 'validation',
    teams: [team('away', 3), team('home', 4)],
  });
  const sourceManifest = manifest([validation, fit]);

  const first = buildM8PaSurvivalDataset({
    captureManifest: sourceManifest,
    captures: [validation, fit],
  });
  const second = buildM8PaSurvivalDataset({
    captureManifest: sourceManifest,
    captures: [fit, validation],
  });

  assert.equal(first.datasetSha256, second.datasetSha256);
  assert.deepEqual(first, second);
  assert.equal(first.periods.fit.rowCount, 18);
  assert.equal(first.periods.validation.rowCount, 18);
  assert.equal(verifyM8PaSurvivalDataset(first), first);
});

test('rejects exposed untouched-test rows', () => {
  const game = capture({
    gameId: 30,
    observedDate: '2026-04-30',
    periodId: 'fit',
    teams: [team('away', 1), team('home', 2)],
  });
  const sourceManifest = manifest([game]);
  sourceManifest.untouchedTestReservation = {
    ...sourceManifest.untouchedTestReservation,
    rowsIncluded: true,
  };

  assert.throws(
    () =>
      buildM8PaSurvivalDataset({
        captureManifest: sourceManifest,
        captures: [game],
      }),
    /untouched-test rows must remain excluded/,
  );
});
