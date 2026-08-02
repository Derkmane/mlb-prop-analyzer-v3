import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import test from 'node:test';

import {
  buildM8_5GameOffensiveEnvironmentFeatureDataset,
  verifyM8_5GameOffensiveEnvironmentFeatureDataset,
} from '../scripts/m8-5-game-offensive-environment-feature-dataset-utils.mjs';

const SHA_A = 'a'.repeat(64);
const SHA_B = 'b'.repeat(64);
const SHA_C = 'c'.repeat(64);
const SHA_D = 'd'.repeat(64);
const SHA_E = 'e'.repeat(64);

function sha256(value) {
  return createHash('sha256').update(value).digest('hex');
}

function game({
  gameId,
  observedDate,
  periodId,
  awayTeamId = 1,
  homeTeamId = 2,
  awayPa,
  homePa,
  awayHits,
  homeHits,
}) {
  return {
    gameId,
    observedDate,
    periodId,
    awayTeamId,
    homeTeamId,
    awayPa,
    homePa,
    awayHits,
    homeHits,
  };
}

function sourceRow(gameValue, side) {
  const isAway = side === 'away';
  const teamId = isAway ? gameValue.awayTeamId : gameValue.homeTeamId;
  const opponentTeamId = isAway ? gameValue.homeTeamId : gameValue.awayTeamId;
  const teamPlateAppearances = isAway ? gameValue.awayPa : gameValue.homePa;
  const opponentPlateAppearances = isAway ? gameValue.homePa : gameValue.awayPa;
  const teamHits = isAway ? gameValue.awayHits : gameValue.homeHits;
  return {
    rowId: `${gameValue.periodId}:${gameValue.observedDate}:${gameValue.gameId}:${side}:${teamId}`,
    observedDate: gameValue.observedDate,
    periodId: gameValue.periodId,
    gameId: gameValue.gameId,
    side,
    homeAway: side,
    teamId,
    teamName: `Team ${teamId}`,
    opponentTeamId,
    opponentTeamName: `Team ${opponentTeamId}`,
    teamPlateAppearances,
    opponentPlateAppearances,
    gamePlateAppearances: teamPlateAppearances + opponentPlateAppearances,
    teamHits,
    teamRuns: 1,
    pitcherIds: [teamId * 100 + gameValue.gameId],
    pitcherCount: 1,
    resolvedRowCount: teamPlateAppearances,
    paEvidenceRowCount: teamPlateAppearances,
    ignoredBaserunningRowCount: 0,
    directBatterPaComparator: { available: false, reason: 'test-fixture' },
    sourceCaptureSha256: SHA_D,
    sourceStatsRawBodySha256s: [],
  };
}

function sourceIdentity(dataset) {
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

function sourceDataset(games, excludedGames = []) {
  const periods = {};
  for (const periodId of ['fit', 'validation']) {
    const rows = games
      .filter((gameValue) => gameValue.periodId === periodId)
      .flatMap((gameValue) => [
        sourceRow(gameValue, 'away'),
        sourceRow(gameValue, 'home'),
      ])
      .sort(
        (left, right) =>
          left.observedDate.localeCompare(right.observedDate) ||
          left.gameId - right.gameId ||
          left.side.localeCompare(right.side),
      );
    periods[periodId] = {
      startDate: rows[0]?.observedDate ?? null,
      endDate: rows.at(-1)?.observedDate ?? null,
      rowCount: rows.length,
      rows,
    };
  }
  const dataset = {
    purpose: 'test source team environment dataset',
    datasetVersion: 2,
    provider: 'BALLDONTLIE MLB API',
    activeSeason: 2026,
    sourceCaptureManifestSha256: SHA_A,
    sourceCapturePlanSha256: SHA_B,
    sourceResolvedDatasetSha256: SHA_C,
    sourceResolvedDatasetFileSha256: SHA_D,
    includedPeriods: ['fit', 'validation'],
    untouchedTestReservation: { rowsIncluded: false },
    exclusionPolicy: {},
    totals: {},
    exclusionReasonCounts: {},
    periods,
    excludedGames,
  };
  return {
    ...dataset,
    datasetSha256: sha256(JSON.stringify(sourceIdentity(dataset))),
  };
}

function build(games, excludedGames = []) {
  return buildM8_5GameOffensiveEnvironmentFeatureDataset({
    rawTeamEnvironmentDataset: sourceDataset(games, excludedGames),
    sourceTeamEnvironmentDatasetFileSha256: SHA_E,
  });
}

const BASE_GAMES = [
  game({
    gameId: 1,
    observedDate: '2026-04-01',
    periodId: 'fit',
    awayPa: 36,
    homePa: 34,
    awayHits: 8,
    homeHits: 6,
  }),
  game({
    gameId: 2,
    observedDate: '2026-04-02',
    periodId: 'fit',
    awayPa: 40,
    homePa: 38,
    awayHits: 10,
    homeHits: 9,
  }),
  game({
    gameId: 3,
    observedDate: '2026-06-22',
    periodId: 'validation',
    awayPa: 37,
    homePa: 36,
    awayHits: 7,
    homeHits: 8,
  }),
];

test('builds pregame features only from strictly earlier current-season games', () => {
  const dataset = build(BASE_GAMES);
  const fitRow = dataset.periods.fit.rows[0];
  const validationRow = dataset.periods.validation.rows[0];

  assert.equal(dataset.totals.sourceGameCount, 3);
  assert.equal(dataset.totals.includedGameCount, 2);
  assert.equal(dataset.totals.excludedGameCount, 1);
  assert.equal(dataset.excludedGames[0].gameId, 1);
  assert.deepEqual(fitRow.features, {
    awayOffensePaPerGame: 36,
    awayOffenseHitRate: 8 / 36,
    homeOffensePaPerGame: 34,
    homeOffenseHitRate: 6 / 34,
    awayOpponentPaAllowedPerGame: 36,
    awayOpponentHitRateAllowed: 8 / 36,
    homeOpponentPaAllowedPerGame: 34,
    homeOpponentHitRateAllowed: 6 / 34,
  });
  assert.equal(fitRow.target.awayPlateAppearances, 40);
  assert.equal(validationRow.priorEvidence.awayOffenseGames, 2);
  assert.equal(validationRow.features.awayOffensePaPerGame, 38);
  assert.equal(validationRow.features.homeOffensePaPerGame, 36);
  assert.equal(dataset.excludedOffensiveStatisticsUsed, false);
  verifyM8_5GameOffensiveEnvironmentFeatureDataset(dataset);
});

test('same-date games cannot leak outcomes into each other', () => {
  const games = [
    BASE_GAMES[0],
    { ...BASE_GAMES[1], gameId: 2, observedDate: '2026-04-02' },
    game({
      gameId: 4,
      observedDate: '2026-04-02',
      periodId: 'fit',
      awayPa: 50,
      homePa: 31,
      awayHits: 15,
      homeHits: 3,
    }),
    BASE_GAMES[2],
  ];
  const dataset = build(games);
  const sameDateRows = dataset.periods.fit.rows.filter(
    (row) => row.observedDate === '2026-04-02',
  );
  assert.equal(sameDateRows.length, 2);
  assert.deepEqual(sameDateRows[0].features, sameDateRows[1].features);
  assert.equal(dataset.periods.validation.rows[0].priorEvidence.awayOffenseGames, 3);
  assert.equal(
    dataset.periods.validation.rows[0].features.awayOffensePaPerGame,
    (36 + 40 + 50) / 3,
  );
});

test('a game outcome cannot alter its own features but can alter later-date features', () => {
  const changed = BASE_GAMES.map((gameValue) =>
    gameValue.gameId === 2
      ? { ...gameValue, awayPa: 48, awayHits: 14, homePa: 30, homeHits: 3 }
      : gameValue,
  );
  const original = build(BASE_GAMES);
  const mutated = build(changed);

  assert.deepEqual(original.periods.fit.rows[0].features, mutated.periods.fit.rows[0].features);
  assert.notDeepEqual(
    original.periods.validation.rows[0].features,
    mutated.periods.validation.rows[0].features,
  );
});

test('excluded-game offensive values never enter chronological features', () => {
  const first = build(BASE_GAMES, [
    {
      gameId: 999,
      observedDate: '2026-03-31',
      teams: [{ teamId: 1, teamPlateAppearances: 999, teamHits: 999 }],
      reasons: ['contradictory-offensive-evidence'],
    },
  ]);
  const second = build(BASE_GAMES, [
    {
      gameId: 999,
      observedDate: '2026-03-31',
      teams: [{ teamId: 1, teamPlateAppearances: 1, teamHits: 0 }],
      reasons: ['contradictory-offensive-evidence'],
    },
  ]);

  assert.deepEqual(first.periods, second.periods);
  assert.equal(first.excludedOffensiveStatisticsUsed, false);
  assert.equal(second.excludedOffensiveStatisticsUsed, false);
});

test('input ordering is deterministic and untouched-test payloads fail closed', () => {
  const first = build(BASE_GAMES);
  const second = build([...BASE_GAMES].reverse());
  assert.deepEqual(first, second);

  const badSource = sourceDataset(BASE_GAMES);
  badSource.untouchedTestReservation = { rowsIncluded: false, rows: [] };
  assert.throws(
    () =>
      buildM8_5GameOffensiveEnvironmentFeatureDataset({
        rawTeamEnvironmentDataset: badSource,
        sourceTeamEnvironmentDatasetFileSha256: SHA_E,
      }),
    /untouched-test rows excluded/u,
  );
});
