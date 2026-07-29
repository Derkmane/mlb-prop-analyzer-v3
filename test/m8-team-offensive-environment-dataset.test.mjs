import test from 'node:test';
import assert from 'node:assert/strict';

import {
  buildM8TeamOffensiveEnvironmentDataset,
  verifyM8TeamOffensiveEnvironmentDataset,
} from '../scripts/m8-team-offensive-environment-dataset-utils.mjs';

const SHA_A = 'a'.repeat(64);
const SHA_B = 'b'.repeat(64);
const SHA_C = 'c'.repeat(64);
const SHA_D = 'd'.repeat(64);

function lineupTeam(side, teamId, players) {
  return {
    side,
    teamId,
    teamName: `Team ${teamId}`,
    completeOfficialSlots: true,
    missingSlots: [],
    duplicateSlots: [],
    starters: players.map((playerId, index) => ({
      battingOrder: index + 1,
      playerId,
      playerName: `Player ${playerId}`,
      statsRowCount: 1,
      directPlateAppearances: index < 3 ? 4 : 3,
    })),
  };
}

function gameCapture({ gameId, date, periodId, invalidHome = false }) {
  const awayPlayers = Array.from(
    { length: 9 },
    (_, index) => gameId * 100 + index + 1,
  );
  const homePlayers = Array.from(
    { length: 9 },
    (_, index) => gameId * 100 + index + 11,
  );
  const awayTeamId = gameId * 10 + 1;
  const homeTeamId = gameId * 10 + 2;
  const makeRows = (teamId, players, invalid) =>
    players.map((playerId, index) => ({
      game_id: gameId,
      team: { id: teamId },
      player: { id: playerId },
      plate_appearances: invalid && index === 0 ? null : index < 3 ? 4 : 3,
      at_bats: index < 3 ? 4 : 3,
      bb: 0,
      hit_by_pitch: 0,
      sac_flies: 0,
      sac_bunts: 0,
      hits: index % 3 === 0 ? 1 : 0,
      runs: index % 4 === 0 ? 1 : 0,
      rbi: 0,
    }));
  const awaySummary = lineupTeam('away', awayTeamId, awayPlayers);
  const homeSummary = lineupTeam('home', homeTeamId, homePlayers);
  if (invalidHome) {
    homeSummary.starters[0].directPlateAppearances = null;
  }
  return {
    captureVersion: 1,
    provider: 'BALLDONTLIE MLB API',
    sourcePlanSha256: SHA_A,
    plannedGame: { gameId, observedDate: date, periodId, sourceRowCount: 1 },
    gameSnapshot: {
      body: {
        data: {
          id: gameId,
          status: 'STATUS_FINAL',
          season: 2026,
          season_type: 'regular',
          away_team: { id: awayTeamId, display_name: `Team ${awayTeamId}` },
          home_team: { id: homeTeamId, display_name: `Team ${homeTeamId}` },
        },
      },
    },
    statsPages: [
      {
        body: {
          data: [
            ...makeRows(awayTeamId, awayPlayers, false),
            ...makeRows(homeTeamId, homePlayers, invalidHome),
          ],
        },
      },
    ],
    lineupPages: [],
    summary: {
      status: 'STATUS_FINAL',
      season: 2026,
      seasonType: 'regular',
      teams: [awaySummary, homeSummary],
      snapshots: { statsRawBodySha256s: [SHA_D] },
    },
    untouchedTestReservation: { rowsIncluded: false },
    captureSha256: SHA_B,
  };
}

function manifest(captures) {
  return {
    manifestVersion: 1,
    provider: 'BALLDONTLIE MLB API',
    sourcePlanSha256: SHA_A,
    sourceResolvedDatasetSha256: SHA_C,
    sourceRowCount: captures.length,
    gameCount: captures.length,
    includedPeriods: ['fit', 'validation'],
    untouchedTestReservation: { rowsIncluded: false },
    totals: {},
    games: captures.map((capture) => ({
      gameId: capture.plannedGame.gameId,
      observedDate: capture.plannedGame.observedDate,
      periodId: capture.plannedGame.periodId,
      summarySha256: SHA_D,
    })),
    manifestSha256: SHA_B,
  };
}

test('builds paired team-game rows from direct PA and hit evidence', () => {
  const captures = [
    gameCapture({ gameId: 1, date: '2026-06-01', periodId: 'fit' }),
    gameCapture({ gameId: 2, date: '2026-06-22', periodId: 'validation' }),
  ];
  const dataset = buildM8TeamOffensiveEnvironmentDataset({
    captureManifest: manifest(captures),
    captures,
  });
  assert.equal(dataset.periods.fit.rowCount, 2);
  assert.equal(dataset.periods.validation.rowCount, 2);
  assert.equal(dataset.totals.includedGameCount, 2);
  assert.equal(dataset.totals.includedTeamGameCount, 4);
  assert.equal(dataset.periods.fit.rows[0].teamPlateAppearances, 30);
  assert.equal(dataset.periods.fit.rows[0].teamHits, 3);
  assert.equal(dataset.periods.fit.rows[0].gamePlateAppearances, 60);
  assert.equal(dataset.exclusionPolicy.componentArithmeticFallback, 'prohibited');
  verifyM8TeamOffensiveEnvironmentDataset(dataset);
});

test('excludes both sides when one team has incomplete direct PA evidence', () => {
  const captures = [
    gameCapture({ gameId: 1, date: '2026-06-01', periodId: 'fit' }),
    gameCapture({
      gameId: 2,
      date: '2026-06-22',
      periodId: 'validation',
      invalidHome: true,
    }),
    gameCapture({ gameId: 3, date: '2026-06-23', periodId: 'validation' }),
  ];
  const dataset = buildM8TeamOffensiveEnvironmentDataset({
    captureManifest: manifest(captures),
    captures,
  });
  assert.equal(dataset.totals.includedGameCount, 2);
  assert.equal(dataset.totals.excludedGameCount, 1);
  assert.equal(dataset.totals.excludedTeamGameCount, 2);
  assert.equal(dataset.excludedGames[0].gameId, 2);
  assert.match(dataset.excludedGames[0].reasons.join(','), /home:/);
});

test('is deterministic for identical ordered evidence', () => {
  const captures = [
    gameCapture({ gameId: 1, date: '2026-06-01', periodId: 'fit' }),
    gameCapture({ gameId: 2, date: '2026-06-22', periodId: 'validation' }),
  ];
  const first = buildM8TeamOffensiveEnvironmentDataset({
    captureManifest: manifest(captures),
    captures,
  });
  const second = buildM8TeamOffensiveEnvironmentDataset({
    captureManifest: manifest(captures),
    captures: [...captures].reverse(),
  });
  assert.equal(first.datasetSha256, second.datasetSha256);
  assert.deepEqual(first, second);
});

test('rejects any untouched-test row payload', () => {
  const captures = [
    gameCapture({ gameId: 1, date: '2026-06-01', periodId: 'fit' }),
    gameCapture({ gameId: 2, date: '2026-06-22', periodId: 'validation' }),
  ];
  const badManifest = manifest(captures);
  badManifest.untouchedTestReservation = { rowsIncluded: false, rows: [] };
  assert.throws(
    () =>
      buildM8TeamOffensiveEnvironmentDataset({
        captureManifest: badManifest,
        captures,
      }),
    /untouched-test rows excluded/,
  );
});
