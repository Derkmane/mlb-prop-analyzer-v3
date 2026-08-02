import assert from 'node:assert/strict';
import test from 'node:test';

import {
  buildM8_5TeamBullpenTeamIdentityProjection,
} from '../scripts/m8-5-team-bullpen-team-identity-utils.mjs';

const HASH = 'a'.repeat(64);

function includedRow(periodId, observedDate, gameId, side, teamId, opponentTeamId) {
  return Object.freeze({
    rowId: `${periodId}:${observedDate}:${gameId}:${side}:${teamId}`,
    periodId,
    observedDate,
    gameId,
    side,
    homeAway: side,
    teamId,
    opponentTeamId,
    teamPlateAppearances: 30,
    opponentPlateAppearances: 31,
    gamePlateAppearances: 61,
    teamHits: 7,
    teamRuns: 3,
    pitcherIds: Object.freeze([1000 + gameId]),
    ignoredBaserunningRowCount: 0,
  });
}

function excludedTeam(side, teamId, opponentTeamId) {
  return Object.freeze({
    side,
    opponentSide: side === 'away' ? 'home' : 'away',
    teamId,
    opponentTeamId,
    reasons: Object.freeze(['pitcher-stats-row-missing']),
    pitcherIds: Object.freeze([999]),
    pitcherRows: Object.freeze([]),
    resolvedRowCount: 2,
    evidenceRowCount: 2,
    ignoredBaserunningRowCount: 0,
    rejectedOffensiveValue: 12345,
  });
}

function dataset(overrides = {}) {
  return Object.freeze({
    datasetVersion: 2,
    provider: 'BALLDONTLIE MLB API',
    activeSeason: 2026,
    datasetSha256: HASH,
    sourceResolvedDatasetSha256: 'b'.repeat(64),
    periods: Object.freeze({
      fit: Object.freeze({
        rows: Object.freeze([
          includedRow('fit', '2026-04-01', 1, 'away', 100, 200),
          includedRow('fit', '2026-04-01', 1, 'home', 200, 100),
        ]),
      }),
      validation: Object.freeze({
        rows: Object.freeze([
          includedRow('validation', '2026-06-22', 3, 'away', 300, 400),
          includedRow('validation', '2026-06-22', 3, 'home', 400, 300),
        ]),
      }),
    }),
    excludedGames: Object.freeze([
      Object.freeze({
        gameId: 2,
        observedDate: '2026-04-02',
        periodId: 'fit',
        reasons: Object.freeze(['away:pitcher-stats-row-missing']),
        teams: Object.freeze([
          excludedTeam('away', 500, 600),
          excludedTeam('home', 600, 500),
        ]),
      }),
    ]),
    untouchedTestReservation: Object.freeze({ rowsIncluded: false }),
    ...overrides,
  });
}

test('uses excluded games for verified team identity only while rejected offensive values stay excluded', () => {
  const source = dataset();
  const projection = buildM8_5TeamBullpenTeamIdentityProjection(source);

  assert.equal(projection.dataset.datasetSha256, HASH);
  assert.equal(projection.evidence.counts.includedIdentityRowCount, 4);
  assert.equal(projection.evidence.counts.excludedGameIdentityRowCount, 2);
  assert.equal(projection.dataset.periods.fit.rowCount, 4);
  const recovered = projection.dataset.periods.fit.rows.find(
    (row) => row.gameId === 2 && row.side === 'away',
  );
  assert.deepEqual(
    {
      teamId: recovered.teamId,
      opponentTeamId: recovered.opponentTeamId,
      identitySource: recovered.identitySource,
    },
    {
      teamId: 500,
      opponentTeamId: 600,
      identitySource: 'excluded-game-team-identity-only',
    },
  );
  assert.equal(Object.hasOwn(recovered, 'rejectedOffensiveValue'), false);
  assert.equal(Object.hasOwn(recovered, 'teamPlateAppearances'), false);
});

test('duplicate included and excluded identity for one team-game fails closed', () => {
  const source = dataset({
    excludedGames: Object.freeze([
      Object.freeze({
        gameId: 1,
        observedDate: '2026-04-01',
        periodId: 'fit',
        reasons: Object.freeze(['away:pitcher-stats-row-missing']),
        teams: Object.freeze([
          excludedTeam('away', 100, 200),
          excludedTeam('home', 200, 100),
        ]),
      }),
    ]),
  });
  assert.throws(
    () => buildM8_5TeamBullpenTeamIdentityProjection(source),
    /duplicate team identity/u,
  );
});

test('nonreciprocal excluded-game team identities fail closed', () => {
  const source = dataset({
    excludedGames: Object.freeze([
      Object.freeze({
        gameId: 2,
        observedDate: '2026-04-02',
        periodId: 'fit',
        reasons: Object.freeze(['away:pitcher-stats-row-missing']),
        teams: Object.freeze([
          excludedTeam('away', 500, 600),
          excludedTeam('home', 700, 500),
        ]),
      }),
    ]),
  });
  assert.throws(
    () => buildM8_5TeamBullpenTeamIdentityProjection(source),
    /not reciprocal/u,
  );
});
