import assert from 'node:assert/strict';
import test from 'node:test';

import {
  normalizeCrossProviderLineupText,
  resolvePostedLineupIdentity,
} from '../scripts/archive-m9-batter-hits-board.mjs';

const GAME_ID = 5059650;
const TEAM_ID = 8;
const TEAM_NAME = 'Chicago White Sox';
const POSTED_GAME_PK = 999001;
const POSTED_GAME_DATE = '2026-08-17T23:05:00.000Z';
const POSTED_CAPTURED_AT = '2026-08-17T21:05:00.000Z';
const POSTED_SHA = 'a'.repeat(64);
const BDL_CAPTURED_AT = '2026-08-17T21:04:00.000Z';
const BDL_SHA = 'b'.repeat(64);

function identity({ playerName, playerId = 1001 } = {}) {
  return Object.freeze({
    providerEventId: 'event-1',
    offerPlayerName: playerName,
    providerGameId: GAME_ID,
    providerPlayerId: playerId,
    providerTeamId: TEAM_ID,
    playerName,
    teamName: TEAM_NAME,
    batsThrows: 'R/R',
  });
}

function currentLineups(rows = []) {
  return Object.freeze({
    body: Object.freeze({ data: Object.freeze(rows) }),
    capturedAt: BDL_CAPTURED_AT,
    combinedSha256: BDL_SHA,
  });
}

function postedLineup(players) {
  return Object.freeze({
    status: 'posted',
    sourceVersion: 'mlb-stats-schedule-posted-lineups-v2',
    provider: 'MLB Stats API',
    providerGamePk: POSTED_GAME_PK,
    gameDateUtc: POSTED_GAME_DATE,
    homeTeamName: 'Pittsburgh Pirates',
    awayTeamName: TEAM_NAME,
    players: Object.freeze(players),
    sourceCapturedAt: POSTED_CAPTURED_AT,
    sourceSnapshotSha256: POSTED_SHA,
    requestUrl: 'https://statsapi.mlb.com/api/v1/schedule?sportId=1&date=2026-08-17&hydrate=lineups',
  });
}

const realNameCases = Object.freeze([
  ['Luis Robert Jr.', 'Luis Robert Jr'],
  ['Ronald Acuña Jr.', 'Ronald Acuna Jr.'],
  ['Michael Harris II', 'Michael Harris II'],
  ['J.T. Realmuto', 'JT Realmuto'],
  ['Iván Herrera', 'Ivan Herrera'],
  ['José Fermín', 'Jose Fermin'],
]);

test('normalizes real MLB Stats and BALLDONTLIE name variants to exact equality', () => {
  for (const [mlbStatsName, bdlName] of realNameCases) {
    assert.equal(
      normalizeCrossProviderLineupText(mlbStatsName),
      normalizeCrossProviderLineupText(bdlName),
      `${mlbStatsName} should normalize exactly with ${bdlName}`,
    );
  }
  assert.equal(
    normalizeCrossProviderLineupText('  CHICAGO   White Sox  '),
    normalizeCrossProviderLineupText('Chicago White Sox'),
  );
});

test('every accepted MLB Stats posted name resolves as confirmed and preserves posted source lineage', () => {
  realNameCases.forEach(([mlbStatsName, bdlName], index) => {
    const resolved = resolvePostedLineupIdentity({
      game: { id: GAME_ID },
      identity: identity({ playerName: bdlName, playerId: 2000 + index }),
      currentLineups: currentLineups(),
      postedLineup: postedLineup([
        {
          mlbPlayerId: 8000 + index,
          playerName: mlbStatsName,
          teamName: TEAM_NAME,
          lineupSlot: index + 1,
        },
      ]),
    });

    assert.equal(resolved.resolution.resolved, true);
    assert.equal(resolved.resolution.lineupStatus, 'confirmed');
    assert.equal(resolved.resolution.lineupSlot, index + 1);
    assert.equal(resolved.resolution.sourceGameId, String(POSTED_GAME_PK));
    assert.equal(resolved.resolution.sourceGameDateUtc, POSTED_GAME_DATE);
    assert.equal(resolved.resolution.sourceCapturedAt, POSTED_CAPTURED_AT);
    assert.equal(resolved.resolution.sourceSnapshotSha256, POSTED_SHA);
    assert.equal(resolved.hitter.playerName, bdlName);
    assert.equal(resolved.hitter.batsThrows, 'R/R');
  });
});

test('exact BALLDONTLIE current-game row keeps precedence over a conflicting MLB Stats posted slot', () => {
  const player = identity({ playerName: 'Luis Robert Jr', playerId: 3001 });
  const resolved = resolvePostedLineupIdentity({
    game: { id: GAME_ID },
    identity: player,
    currentLineups: currentLineups([
      {
        game_id: GAME_ID,
        player: {
          id: 3001,
          full_name: 'Luis Robert Jr',
          bats_throws: 'R/R',
        },
        team: { id: TEAM_ID, display_name: TEAM_NAME },
        batting_order: 3,
        is_probable_pitcher: false,
      },
    ]),
    postedLineup: postedLineup([
      {
        mlbPlayerId: 9001,
        playerName: 'Luis Robert Jr.',
        teamName: TEAM_NAME,
        lineupSlot: 7,
      },
    ]),
  });

  assert.equal(resolved.resolution.resolved, true);
  assert.equal(resolved.resolution.lineupStatus, 'confirmed');
  assert.equal(resolved.resolution.lineupSlot, 3);
  assert.equal(resolved.resolution.sourceGameId, String(GAME_ID));
  assert.equal(resolved.resolution.sourceGameDateUtc, null);
  assert.equal(resolved.resolution.sourceSnapshotSha256, BDL_SHA);
});

test('normalized ambiguity still fails closed', () => {
  const player = identity({ playerName: 'Ronald Acuna Jr.', playerId: 4001 });
  assert.throws(
    () =>
      resolvePostedLineupIdentity({
        game: { id: GAME_ID },
        identity: player,
        currentLineups: currentLineups(),
        postedLineup: postedLineup([
          {
            mlbPlayerId: 9101,
            playerName: 'Ronald Acuña Jr.',
            teamName: TEAM_NAME,
            lineupSlot: 1,
          },
          {
            mlbPlayerId: 9102,
            playerName: 'Ronald Acuna Jr',
            teamName: TEAM_NAME,
            lineupSlot: 2,
          },
        ]),
      }),
    /Current lineup evidence is ambiguous/u,
  );
});

test('normalization does not permit fuzzy, partial, or suffix-dropping matches', () => {
  const resolved = resolvePostedLineupIdentity({
    game: { id: GAME_ID },
    identity: identity({ playerName: 'Jose Fermin', playerId: 5001 }),
    currentLineups: currentLineups(),
    postedLineup: postedLineup([
      {
        mlbPlayerId: 9201,
        playerName: 'Jose Fermin Jr.',
        teamName: TEAM_NAME,
        lineupSlot: 4,
      },
    ]),
  });

  assert.equal(resolved.resolution.resolved, false);
  assert.equal(resolved.resolution.reason, 'no-current-or-projected-lineup-slot');
  assert.equal(resolved.hitter, null);
});
