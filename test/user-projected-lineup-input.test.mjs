import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { resolvePostedLineupIdentity } from '../scripts/archive-m9-batter-hits-board.mjs';
import {
  USER_PROJECTED_LINEUP_CONTRACT,
  USER_PROJECTED_LINEUP_SOURCE_TIME_ZONE,
  userProjectionPlayerLabelMatches,
  userProjectedLineupEvidenceForIdentity,
} from '../scripts/user-projected-lineup-utils.mjs';

const GAME_ID = 5059701;
const TEAM_ID = 8;
const OPPONENT_ID = 9;
const TEAM_NAME = 'Chicago White Sox';
const OPPONENT_NAME = 'Chicago Cubs';
const GAME_DATE = '2026-08-19T18:20:00.000Z';
const IMPORTED_AT = '2026-08-19T15:30:00.000Z';
const BDL_CAPTURED_AT = '2026-08-19T16:00:00.000Z';
const BDL_SHA = 'b'.repeat(64);
const POSTED_CAPTURED_AT = '2026-08-19T16:01:00.000Z';
const POSTED_SHA = 'c'.repeat(64);

function game(overrides = {}) {
  return Object.freeze({
    id: GAME_ID,
    date: GAME_DATE,
    away_team_name: TEAM_NAME,
    home_team_name: OPPONENT_NAME,
    away_team: Object.freeze({ id: TEAM_ID, display_name: TEAM_NAME }),
    home_team: Object.freeze({ id: OPPONENT_ID, display_name: OPPONENT_NAME }),
    ...overrides,
  });
}

function identity({ playerName = 'Sam Antonacci', playerId = 1001, teamName = TEAM_NAME, teamId = TEAM_ID } = {}) {
  return Object.freeze({
    providerEventId: 'event-1',
    offerPlayerName: playerName,
    providerGameId: GAME_ID,
    providerPlayerId: playerId,
    providerTeamId: teamId,
    playerName,
    teamName,
    batsThrows: 'L/R',
  });
}

function currentLineups(rows = []) {
  return Object.freeze({
    body: Object.freeze({ data: Object.freeze(rows) }),
    capturedAt: BDL_CAPTURED_AT,
    combinedSha256: BDL_SHA,
  });
}

function postedLineup({ playerName = 'Sam Antonacci', lineupSlot = 4 } = {}) {
  return Object.freeze({
    status: 'posted',
    sourceVersion: 'mlb-stats-schedule-posted-lineups-v2',
    provider: 'MLB Stats API',
    providerGamePk: 999001,
    gameDateUtc: GAME_DATE,
    homeTeamName: OPPONENT_NAME,
    awayTeamName: TEAM_NAME,
    players: Object.freeze([
      Object.freeze({
        mlbPlayerId: 8001,
        playerName,
        teamName: TEAM_NAME,
        lineupSlot,
      }),
    ]),
    sourceCapturedAt: POSTED_CAPTURED_AT,
    sourceSnapshotSha256: POSTED_SHA,
    requestUrl: 'https://statsapi.mlb.com/api/v1/schedule?sportId=1&date=2026-08-19&hydrate=lineups',
  });
}

function artifact({
  slateDate = '2026-08-19',
  awayTeamName = TEAM_NAME,
  homeTeamName = OPPONENT_NAME,
  teams,
} = {}) {
  return {
    version: 1,
    contract: USER_PROJECTED_LINEUP_CONTRACT,
    source: 'RotoWire user-supplied lineup screenshot transcription',
    slateDate,
    sourceTimeZone: USER_PROJECTED_LINEUP_SOURCE_TIME_ZONE,
    importedAt: IMPORTED_AT,
    sourceEvidenceIds: ['chatgpt-user-image-2026-08-19-1'],
    games: [
      {
        awayTeamName,
        homeTeamName,
        teams: teams ?? [
          {
            teamName: TEAM_NAME,
            sourceStatus: 'expected',
            players: [
              { sourcePlayerLabel: 'S. Antonacci', lineupSlot: 1 },
            ],
          },
        ],
      },
    ],
  };
}

function withProjectionRoot(run) {
  const root = mkdtempSync(path.join(os.tmpdir(), 'mlb-user-lineup-'));
  const previous = process.env.USER_PROJECTED_LINEUP_ROOT;
  process.env.USER_PROJECTED_LINEUP_ROOT = root;
  try {
    return run(root);
  } finally {
    if (previous === undefined) delete process.env.USER_PROJECTED_LINEUP_ROOT;
    else process.env.USER_PROJECTED_LINEUP_ROOT = previous;
    rmSync(root, { recursive: true, force: true });
  }
}

function writeArtifact(root, value, fileDate = value.slateDate) {
  writeFileSync(path.join(root, `${fileDate}.json`), `${JSON.stringify(value, null, 2)}\n`);
}

test('user projection label matching accepts exact names and source first-initial labels without fuzzy surname changes', () => {
  assert.equal(userProjectionPlayerLabelMatches('S. Antonacci', 'Sam Antonacci'), true);
  assert.equal(userProjectionPlayerLabelMatches('Sam Antonacci', 'Sam Antonacci'), true);
  assert.equal(userProjectionPlayerLabelMatches('S. Antonacci', 'Sam Antonacci Jr.'), true);
  assert.equal(userProjectionPlayerLabelMatches('S. Antonacci', 'Sam Antonucci'), false);
  assert.equal(userProjectionPlayerLabelMatches('Antonacci', 'Sam Antonacci'), false);
});

test('no user projection file preserves the old unresolved behavior', () =>
  withProjectionRoot(() => {
    const resolved = resolvePostedLineupIdentity({
      game: game(),
      identity: identity(),
      currentLineups: currentLineups(),
      postedLineup: null,
    });
    assert.equal(resolved.resolution.resolved, false);
    assert.equal(resolved.resolution.reason, 'no-current-or-projected-lineup-slot');
    assert.equal(resolved.hitter, null);
  }));

test('a readable partial user lineup fills only the missing-lineup case and remains projected even when the screenshot source says confirmed', () =>
  withProjectionRoot((root) => {
    writeArtifact(root, artifact({
      teams: [
        {
          teamName: TEAM_NAME,
          sourceStatus: 'confirmed',
          players: [{ sourcePlayerLabel: 'S. Antonacci', lineupSlot: 6 }],
        },
      ],
    }));
    const resolved = resolvePostedLineupIdentity({
      game: game(),
      identity: identity(),
      currentLineups: currentLineups(),
      postedLineup: null,
    });
    assert.equal(resolved.resolution.resolved, true);
    assert.equal(resolved.resolution.lineupStatus, 'projected');
    assert.equal(resolved.resolution.lineupSlot, 6);
    assert.equal(resolved.resolution.sourceCapturedAt, IMPORTED_AT);
    assert.match(resolved.resolution.sourceGameId, /^user-projection:2026-08-19:/u);
    assert.equal(resolved.hitter.playerName, 'Sam Antonacci');
  }));

test('exact BALLDONTLIE current-game evidence has precedence over a conflicting user projection', () =>
  withProjectionRoot((root) => {
    writeArtifact(root, artifact({
      teams: [{
        teamName: TEAM_NAME,
        sourceStatus: 'expected',
        players: [{ sourcePlayerLabel: 'S. Antonacci', lineupSlot: 8 }],
      }],
    }));
    const resolved = resolvePostedLineupIdentity({
      game: game(),
      identity: identity(),
      currentLineups: currentLineups([
        {
          game_id: GAME_ID,
          player: { id: 1001, full_name: 'Sam Antonacci', bats_throws: 'L/R' },
          team: { id: TEAM_ID, display_name: TEAM_NAME },
          batting_order: 2,
          is_probable_pitcher: false,
        },
      ]),
      postedLineup: null,
    });
    assert.equal(resolved.resolution.lineupStatus, 'confirmed');
    assert.equal(resolved.resolution.lineupSlot, 2);
    assert.equal(resolved.resolution.sourceSnapshotSha256, BDL_SHA);
  }));

test('MLB Stats posted lineup has precedence over a conflicting user projection', () =>
  withProjectionRoot((root) => {
    writeArtifact(root, artifact({
      teams: [{
        teamName: TEAM_NAME,
        sourceStatus: 'expected',
        players: [{ sourcePlayerLabel: 'S. Antonacci', lineupSlot: 8 }],
      }],
    }));
    const resolved = resolvePostedLineupIdentity({
      game: game(),
      identity: identity(),
      currentLineups: currentLineups(),
      postedLineup: postedLineup({ lineupSlot: 3 }),
    });
    assert.equal(resolved.resolution.lineupStatus, 'confirmed');
    assert.equal(resolved.resolution.lineupSlot, 3);
    assert.equal(resolved.resolution.sourceSnapshotSha256, POSTED_SHA);
  }));

test('wrong-day, wrong-game, and missing-team projection evidence do not leak into the target game', () =>
  withProjectionRoot((root) => {
    writeArtifact(root, artifact({ slateDate: '2026-08-18' }), '2026-08-18');
    assert.deepEqual(
      userProjectedLineupEvidenceForIdentity({ game: game(), identity: identity() }),
      [],
    );

    writeArtifact(root, artifact({
      awayTeamName: 'Arizona Diamondbacks',
      homeTeamName: 'Boston Red Sox',
      teams: [{
        teamName: 'Arizona Diamondbacks',
        sourceStatus: 'expected',
        players: [{ sourcePlayerLabel: 'S. Antonacci', lineupSlot: 1 }],
      }],
    }));
    assert.deepEqual(
      userProjectedLineupEvidenceForIdentity({ game: game(), identity: identity() }),
      [],
    );

    writeArtifact(root, artifact({
      teams: [{
        teamName: OPPONENT_NAME,
        sourceStatus: 'expected',
        players: [{ sourcePlayerLabel: 'S. Antonacci', lineupSlot: 1 }],
      }],
    }));
    assert.deepEqual(
      userProjectedLineupEvidenceForIdentity({ game: game(), identity: identity() }),
      [],
    );
  }));

test('ambiguous user player evidence fails closed instead of choosing a slot', () =>
  withProjectionRoot((root) => {
    writeArtifact(root, artifact({
      teams: [{
        teamName: TEAM_NAME,
        sourceStatus: 'expected',
        players: [
          { sourcePlayerLabel: 'S. Antonacci', lineupSlot: 1 },
          { sourcePlayerLabel: 'Sam Antonacci', lineupSlot: 2 },
        ],
      }],
    }));
    assert.throws(
      () => userProjectedLineupEvidenceForIdentity({ game: game(), identity: identity() }),
      /player evidence is ambiguous/u,
    );
  }));

test('HHR continues to reuse the Batter Hits lineup resolver instead of implementing a second user-projection path', () => {
  const hhrSource = readFileSync('scripts/archive-m10-batter-hhr-board.mjs', 'utf8');
  assert.match(hhrSource, /resolvePostedLineupIdentity/u);
  assert.doesNotMatch(hhrSource, /user-projected-lineup-utils/u);
});
