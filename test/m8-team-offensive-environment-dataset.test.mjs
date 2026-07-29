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
const SHA_E = 'e'.repeat(64);

function resolvedRow({
  gameId,
  date,
  halfInning,
  pitcherId,
  index,
  mappingStatus = 'classified-terminal',
}) {
  return {
    rowId: `${date}:${gameId}:${index}`,
    observedDate: date,
    providerGameId: gameId,
    providerPaNumber: index,
    providerBatterId: gameId * 1000 + index,
    providerPitcherId: pitcherId,
    inning: 1,
    halfInning,
    rawBatterSide: 'R',
    rawPitcherHand: 'R',
    rawResult: mappingStatus === 'baserunning-only' ? 'Caught Stealing 2B' : 'Groundout',
    mappingStatus,
    unresolvedReason: null,
    terminalCategory: mappingStatus === 'classified-terminal' ? 'BIP_OUT' : null,
    normalizedBatterSide: mappingStatus === 'classified-terminal' ? 'R' : null,
    normalizedPitcherHand: mappingStatus === 'classified-terminal' ? 'R' : null,
    overallOutcomeEligible: mappingStatus === 'classified-terminal',
    platoonEligible: mappingStatus === 'classified-terminal',
    includedInOverallOutcomeModel: mappingStatus === 'classified-terminal',
    includedInPlatoonModel: mappingStatus === 'classified-terminal',
  };
}

function gameCapture({
  gameId,
  date,
  periodId,
  missingAwayPitcher = false,
  homeHitsMismatch = false,
  homeDirectPaMismatch = false,
}) {
  const awayTeamId = gameId * 10 + 1;
  const homeTeamId = gameId * 10 + 2;
  const awayTeamName = `Away ${gameId}`;
  const homeTeamName = `Home ${gameId}`;
  const awayPitcherId = gameId * 100 + 1;
  const homePitcherId = gameId * 100 + 2;
  const battingRows = [
    {
      game_id: gameId,
      team_name: awayTeamName,
      player: { id: gameId * 1000 + 1 },
      plate_appearances: 4,
      at_bats: 4,
      bb: 0,
      hit_by_pitch: 0,
      sac_flies: 0,
      sac_bunts: 0,
      hits: 1,
      runs: 1,
      rbi: 0,
    },
    {
      game_id: gameId,
      team_name: awayTeamName,
      player: { id: gameId * 1000 + 2 },
      plate_appearances: 4,
      at_bats: 4,
      bb: 0,
      hit_by_pitch: 0,
      sac_flies: 0,
      sac_bunts: 0,
      hits: 1,
      runs: 0,
      rbi: 0,
    },
    {
      game_id: gameId,
      team_name: homeTeamName,
      player: { id: gameId * 1000 + 3 },
      plate_appearances: homeDirectPaMismatch ? 3 : 4,
      at_bats: homeDirectPaMismatch ? 3 : 4,
      bb: 0,
      hit_by_pitch: 0,
      sac_flies: 0,
      sac_bunts: 0,
      hits: 1,
      runs: 1,
      rbi: 0,
    },
    {
      game_id: gameId,
      team_name: homeTeamName,
      player: { id: gameId * 1000 + 4 },
      plate_appearances: 4,
      at_bats: 4,
      bb: 0,
      hit_by_pitch: 0,
      sac_flies: 0,
      sac_bunts: 0,
      hits: 1,
      runs: 0,
      rbi: 0,
    },
  ];
  const pitchingRows = [
    {
      game_id: gameId,
      team_name: awayTeamName,
      player: { id: awayPitcherId, full_name: `Away Pitcher ${gameId}` },
      batters_faced: 8,
      p_hits: homeHitsMismatch ? 1 : 2,
    },
    ...(missingAwayPitcher
      ? []
      : [
          {
            game_id: gameId,
            team_name: homeTeamName,
            player: { id: homePitcherId, full_name: `Home Pitcher ${gameId}` },
            batters_faced: 8,
            p_hits: 2,
          },
        ]),
  ];
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
          away_team: { id: awayTeamId, display_name: awayTeamName },
          home_team: { id: homeTeamId, display_name: homeTeamName },
          away_team_data: { hits: 2, runs: 1, errors: 0 },
          home_team_data: { hits: 2, runs: 1, errors: 0 },
        },
      },
    },
    statsPages: [{ body: { data: [...battingRows, ...pitchingRows] } }],
    lineupPages: [],
    summary: {
      status: 'STATUS_FINAL',
      season: 2026,
      seasonType: 'regular',
      teams: [],
      snapshots: { statsRawBodySha256s: [SHA_D] },
    },
    untouchedTestReservation: { rowsIncluded: false },
    captureSha256: SHA_B,
  };
}

function resolvedDataset(captures) {
  const periods = { fit: { rows: [] }, validation: { rows: [] } };
  for (const capture of captures) {
    const { gameId, observedDate: date, periodId } = capture.plannedGame;
    const awayPitcherId = gameId * 100 + 1;
    const homePitcherId = gameId * 100 + 2;
    periods[periodId].rows.push(
      resolvedRow({ gameId, date, halfInning: 'top', pitcherId: homePitcherId, index: 1 }),
      resolvedRow({ gameId, date, halfInning: 'bottom', pitcherId: awayPitcherId, index: 2 }),
      resolvedRow({
        gameId,
        date,
        halfInning: 'top',
        pitcherId: gameId * 100 + 99,
        index: 3,
        mappingStatus: 'baserunning-only',
      }),
    );
  }
  return {
    datasetVersion: 3,
    activeSeason: 2026,
    datasetSha256: SHA_C,
    periods,
    untouchedTestReservation: { rowsIncluded: false },
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

function build(captures) {
  return buildM8TeamOffensiveEnvironmentDataset({
    captureManifest: manifest(captures),
    captures,
    resolvedDataset: resolvedDataset(captures),
    sourceResolvedDatasetFileSha256: SHA_E,
  });
}

test('uses game identity/outcomes and opponent pitcher BF while ignoring baserunning-only ghost pitcher IDs', () => {
  const captures = [
    gameCapture({ gameId: 1, date: '2026-06-01', periodId: 'fit' }),
    gameCapture({ gameId: 2, date: '2026-06-22', periodId: 'validation' }),
  ];
  const dataset = build(captures);
  assert.equal(dataset.datasetVersion, 2);
  assert.equal(dataset.totals.includedGameCount, 2);
  assert.equal(dataset.periods.fit.rows[0].teamPlateAppearances, 8);
  assert.equal(dataset.periods.fit.rows[0].teamHits, 2);
  assert.equal(dataset.periods.fit.rows[0].teamRuns, 1);
  assert.equal(dataset.totals.ignoredBaserunningRowCount, 2);
  assert.equal(dataset.exclusionPolicy.lineupRequirement, 'none');
  assert.equal(
    dataset.exclusionPolicy.statsTeamNameRole,
    'optional-cross-check-only-never-team-identity-or-primary-join',
  );
  verifyM8TeamOffensiveEnvironmentDataset(dataset);
});

test('fails the entire game closed when a real observed pitcher stats row is missing', () => {
  const captures = [
    gameCapture({ gameId: 1, date: '2026-06-01', periodId: 'fit' }),
    gameCapture({
      gameId: 2,
      date: '2026-06-22',
      periodId: 'validation',
      missingAwayPitcher: true,
    }),
    gameCapture({ gameId: 3, date: '2026-06-23', periodId: 'validation' }),
  ];
  const dataset = build(captures);
  assert.equal(dataset.totals.includedGameCount, 2);
  assert.equal(dataset.totals.excludedGameCount, 1);
  assert.match(dataset.excludedGames[0].reasons.join(','), /pitcher-stats-row-missing/);
});

test('fails closed on pitcher hits versus game-team hits contradiction', () => {
  const captures = [
    gameCapture({ gameId: 1, date: '2026-06-01', periodId: 'fit' }),
    gameCapture({
      gameId: 2,
      date: '2026-06-22',
      periodId: 'validation',
      homeHitsMismatch: true,
    }),
    gameCapture({ gameId: 3, date: '2026-06-23', periodId: 'validation' }),
  ];
  const dataset = build(captures);
  assert.equal(dataset.totals.excludedGameCount, 1);
  assert.match(
    dataset.excludedGames[0].reasons.join(','),
    /pitcher-hits-vs-game-team-hits-mismatch/,
  );
});

test('uses exact team_name only as an optional direct-PA contradiction check', () => {
  const captures = [
    gameCapture({ gameId: 1, date: '2026-06-01', periodId: 'fit' }),
    gameCapture({
      gameId: 2,
      date: '2026-06-22',
      periodId: 'validation',
      homeDirectPaMismatch: true,
    }),
    gameCapture({ gameId: 3, date: '2026-06-23', periodId: 'validation' }),
  ];
  const dataset = build(captures);
  assert.equal(dataset.totals.excludedGameCount, 1);
  assert.match(
    dataset.excludedGames[0].reasons.join(','),
    /pitcher-bf-vs-direct-batter-pa-mismatch/,
  );
});

test('is deterministic for identical evidence regardless of capture order', () => {
  const captures = [
    gameCapture({ gameId: 1, date: '2026-06-01', periodId: 'fit' }),
    gameCapture({ gameId: 2, date: '2026-06-22', periodId: 'validation' }),
  ];
  const first = build(captures);
  const second = build([...captures].reverse());
  assert.equal(first.datasetSha256, second.datasetSha256);
  assert.deepEqual(first, second);
});

test('rejects untouched-test rows in either source artifact', () => {
  const captures = [
    gameCapture({ gameId: 1, date: '2026-06-01', periodId: 'fit' }),
    gameCapture({ gameId: 2, date: '2026-06-22', periodId: 'validation' }),
  ];
  const badResolved = resolvedDataset(captures);
  badResolved.untouchedTestReservation = { rowsIncluded: false, rows: [] };
  assert.throws(
    () =>
      buildM8TeamOffensiveEnvironmentDataset({
        captureManifest: manifest(captures),
        captures,
        resolvedDataset: badResolved,
        sourceResolvedDatasetFileSha256: SHA_E,
      }),
    /untouched-test rows excluded/,
  );
});
