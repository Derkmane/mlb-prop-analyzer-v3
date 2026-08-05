import assert from 'node:assert/strict';
import { access, readFile } from 'node:fs/promises';
import test from 'node:test';

import {
  buildBallDontLiePlayerLookupRequest,
  formatBallDontLiePlayerLookupDiagnostic,
  M9_PLAYER_LOOKUP_DIAGNOSTIC_SAMPLE_LIMIT,
  resolveActiveLineupIdentities,
  resolveExactBallDontLiePlayerIdentity,
  splitBallDontLiePlayerLookupName,
} from '../scripts/archive-m9-batter-hits-board.mjs';

function event() {
  return Object.freeze({
    id: 'odds-event-1',
    homeTeamName: 'Atlanta Braves',
    awayTeamName: 'San Diego Padres',
  });
}

function game() {
  return Object.freeze({
    id: 5059315,
    home_team: Object.freeze({ id: 2 }),
    away_team: Object.freeze({ id: 23 }),
  });
}

function player({
  id,
  firstName,
  lastName,
  fullName,
  teamId,
  teamName,
}) {
  return Object.freeze({
    id,
    first_name: firstName,
    last_name: lastName,
    full_name: fullName,
    team: Object.freeze({
      id: teamId,
      display_name: teamName,
    }),
  });
}

function exactIdentity(overrides = {}) {
  return Object.freeze({
    providerEventId: 'odds-event-1',
    offerPlayerName: 'Fernando Tatis Jr.',
    providerGameId: 5059315,
    providerPlayerId: 492,
    providerTeamId: 23,
    playerName: 'Fernando Tatis Jr.',
    teamName: 'San Diego Padres',
    ...overrides,
  });
}

test('the live path builds the verified separate first_name and last_name request including suffixes', () => {
  assert.deepEqual(splitBallDontLiePlayerLookupName('Fernando Tatis Jr.'), {
    fullName: 'Fernando Tatis Jr.',
    firstName: 'Fernando',
    lastName: 'Tatis Jr.',
  });

  const request = buildBallDontLiePlayerLookupRequest('Fernando Tatis Jr.');
  assert.equal(request.url.pathname, '/mlb/v1/players');
  assert.equal(request.url.searchParams.get('first_name'), 'Fernando');
  assert.equal(request.url.searchParams.get('last_name'), 'Tatis Jr.');
  assert.equal(request.url.searchParams.get('per_page'), '100');
  assert.equal(request.url.searchParams.has('full_name'), false);
  assert.deepEqual(request.requestParameters, {
    first_name: 'Fernando',
    last_name: 'Tatis Jr.',
    per_page: '100',
  });
});

test('one exact name on a matched-game team resolves and every rejected candidate records why', () => {
  const request = buildBallDontLiePlayerLookupRequest('Fernando Tatis Jr.');
  const resolution = resolveExactBallDontLiePlayerIdentity({
    event: event(),
    game: game(),
    playerName: 'Fernando Tatis Jr.',
    requestParameters: request.requestParameters,
    rawPlayersSnapshot: {
      data: [
        player({
          id: 492,
          firstName: 'Fernando',
          lastName: 'Tatis Jr.',
          fullName: 'Fernando Tatis Jr.',
          teamId: 23,
          teamName: 'San Diego Padres',
        }),
        player({
          id: 999,
          firstName: 'Fernando',
          lastName: 'Tatis Jr.',
          fullName: 'Fernando Tatis Jr.',
          teamId: 14,
          teamName: 'Los Angeles Dodgers',
        }),
        player({
          id: 1000,
          firstName: 'Fernando',
          lastName: 'Tatis',
          fullName: 'Fernando Tatis',
          teamId: 23,
          teamName: 'San Diego Padres',
        }),
      ],
    },
  });

  assert.equal(resolution.status, 'exact');
  assert.deepEqual(resolution.identity, exactIdentity());
  assert.equal(resolution.rawResponseRecordCount, 3);
  assert.deepEqual(
    resolution.candidates.map((candidate) => ({
      providerPlayerId: candidate.providerPlayerId,
      accepted: candidate.accepted,
      rejectionReasons: candidate.rejectionReasons,
    })),
    [
      { providerPlayerId: 492, accepted: true, rejectionReasons: [] },
      {
        providerPlayerId: 999,
        accepted: false,
        rejectionReasons: ['TEAM_NOT_IN_MATCHED_GAME'],
      },
      {
        providerPlayerId: 1000,
        accepted: false,
        rejectionReasons: ['LAST_NAME_MISMATCH', 'FULL_NAME_MISMATCH'],
      },
    ],
  );
});

test('zero and multiple exact candidates remain fail closed without fuzzy matching or coercion', () => {
  const request = buildBallDontLiePlayerLookupRequest('Fernando Tatis Jr.');
  const zero = resolveExactBallDontLiePlayerIdentity({
    event: event(),
    game: game(),
    playerName: 'Fernando Tatis Jr.',
    requestParameters: request.requestParameters,
    rawPlayersSnapshot: { data: [] },
  });
  assert.equal(zero.status, 'zero-matches');
  assert.equal(zero.identity, null);

  const duplicate = player({
    id: 492,
    firstName: 'Fernando',
    lastName: 'Tatis Jr.',
    fullName: 'Fernando Tatis Jr.',
    teamId: 23,
    teamName: 'San Diego Padres',
  });
  const multiple = resolveExactBallDontLiePlayerIdentity({
    event: event(),
    game: game(),
    playerName: 'Fernando Tatis Jr.',
    requestParameters: request.requestParameters,
    rawPlayersSnapshot: {
      data: [duplicate, { ...duplicate, id: 1492 }],
    },
  });
  assert.equal(multiple.status, 'multiple-matches');
  assert.equal(multiple.identity, null);
});

test('the player diagnostic prints exact request parameters, raw counts, candidates, rejection reasons, and no secret', () => {
  const request = buildBallDontLiePlayerLookupRequest('Fernando Tatis Jr.');
  const resolution = resolveExactBallDontLiePlayerIdentity({
    event: event(),
    game: game(),
    playerName: 'Fernando Tatis Jr.',
    requestParameters: request.requestParameters,
    rawPlayersSnapshot: {
      data: [
        player({
          id: 492,
          firstName: 'Fernando',
          lastName: 'Tatis Jr.',
          fullName: 'Fernando Tatis Jr.',
          teamId: 23,
          teamName: 'San Diego Padres',
        }),
        player({
          id: 999,
          firstName: 'Fernando',
          lastName: 'Tatis Jr.',
          fullName: 'Fernando Tatis Jr.',
          teamId: 14,
          teamName: 'Los Angeles Dodgers',
        }),
      ],
    },
  });
  const diagnostic = formatBallDontLiePlayerLookupDiagnostic(resolution);
  assert.match(diagnostic, /OFFER PLAYER NAME: Fernando Tatis Jr\./u);
  assert.match(diagnostic, /first_name=Fernando/u);
  assert.match(diagnostic, /last_name=Tatis Jr\./u);
  assert.match(diagnostic, /per_page=100/u);
  assert.match(diagnostic, /Authorization=\[REDACTED\]/u);
  assert.match(diagnostic, /RAW RESPONSE RECORD COUNT: 2/u);
  assert.match(diagnostic, /providerPlayerId=492/u);
  assert.match(diagnostic, /result=ACCEPTED/u);
  assert.match(diagnostic, /TEAM_NOT_IN_MATCHED_GAME/u);
  assert.doesNotMatch(diagnostic, /api[_-]?key|Bearer\s+[A-Za-z0-9]/iu);
  assert.equal(M9_PLAYER_LOOKUP_DIAGNOSTIC_SAMPLE_LIMIT, 3);
});

test('player identity survives independently while missing lineup evidence drops only at the lineup stage', () => {
  const identity = exactIdentity();
  const missing = resolveActiveLineupIdentities({
    event: event(),
    game: game(),
    identities: [identity],
    lineupsSnapshot: { data: [] },
  });
  assert.deepEqual(missing.identities, []);
  assert.deepEqual(missing.lineupResolvedPlayerNames, []);
  assert.deepEqual(missing.lineupExclusions, [
    {
      providerEventId: 'odds-event-1',
      playerName: 'Fernando Tatis Jr.',
      reason: 'NO_ACTIVE_LINEUP_EVIDENCE',
      matchCount: 0,
    },
  ]);

  const active = resolveActiveLineupIdentities({
    event: event(),
    game: game(),
    identities: [identity],
    lineupsSnapshot: {
      data: [
        {
          game_id: 5059315,
          player: {
            id: 492,
            full_name: 'Fernando Tatis Jr.',
            bats_throws: 'R/R',
          },
          team: { id: 23, display_name: 'San Diego Padres' },
          batting_order: 1,
          is_probable_pitcher: false,
        },
      ],
    },
  });
  assert.deepEqual(active.identities, [identity]);
  assert.deepEqual(active.lineupResolvedPlayerNames, ['Fernando Tatis Jr.']);
  assert.deepEqual(active.lineupExclusions, []);
});

test('the live path now differs from the working fixture path only in how provider IDs are acquired, not in fail-closed identity semantics', async () => {
  const [liveSource, fixtureHelper, linkageText] = await Promise.all([
    readFile('scripts/archive-m9-batter-hits-board.mjs', 'utf8'),
    readFile('test/helpers/m9-batter-hits-final-runtime-fixture.ts', 'utf8'),
    readFile(
      'fixtures/sanitized/provider-capabilities/2026-07-23/player-identity/cross-provider-player-linkage-5059315.json',
      'utf8',
    ),
  ]);
  const linkage = JSON.parse(linkageText);

  assert.match(liveSource, /\/mlb\/v1\/players/u);
  assert.match(liveSource, /searchParams\.set\('first_name'/u);
  assert.match(liveSource, /searchParams\.set\('last_name'/u);
  assert.doesNotMatch(liveSource, /function buildPlayerIdentities/u);
  assert.ok(
    liveSource.indexOf('capturePlayerIdentityLookups({') <
      liveSource.indexOf('captureLineups({ gameId: game.id, fetchBdl })'),
  );

  assert.match(fixtureHelper, /M9_LINKAGE_FIXTURE_PATH/u);
  assert.match(fixtureHelper, /record\.matchCount !== 1/u);
  assert.equal(linkage.uniqueMatchCount, 17);
  assert.equal(linkage.unmatchedCount, 1);
  assert.equal(linkage.ambiguousCount, 0);
});

test('temporary M9 player identity correction transport files are absent', async () => {
  await Promise.all([
    assert.rejects(
      access('scripts/__apply-m9-player-identity-fix.mjs'),
      /ENOENT/u,
    ),
    assert.rejects(
      access('.github/workflows/__apply-m9-player-identity-fix.yml'),
      /ENOENT/u,
    ),
  ]);
});
