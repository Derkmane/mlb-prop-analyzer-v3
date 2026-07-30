import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';

import { connectPregameBatterHitsBoard } from '../src/composition/index.js';
import type { BatterHitsPlayerIdentity } from '../src/features/batter-hits/index.js';

const FIXTURE_DIRECTORY = path.resolve(
  'fixtures/sanitized/provider-capabilities/2026-07-23/player-identity',
);
const ODDS_FIXTURE_PATH = path.join(
  FIXTURE_DIRECTORY,
  'the-odds-api-22fc220be6958e93fba4354054d8fd16-underdog-batter-hits.json',
);
const GAMES_FIXTURE_PATH = path.join(
  FIXTURE_DIRECTORY,
  'balldontlie-games-2026-07-23.json',
);
const LINKAGE_FIXTURE_PATH = path.join(
  FIXTURE_DIRECTORY,
  'cross-provider-player-linkage-5059315.json',
);

const BOARD_SOURCE_SNAPSHOT_SHA256 =
  '250c1b9c02bb1334c0dce563d14194cabc404dbb48da08a9d49fcd3f457b7db7';
const GAME_SOURCE_SNAPSHOT_SHA256 =
  'f794c97cda6ad78e239c2b6efc9efd64ae2414a9c627672d9db166f7b05a3185';
const SOURCE_CAPTURED_AT = '2026-07-23T15:12:25.190Z';
const MATCHED_GAME_ID = 5059315;

interface LinkageMatch {
  readonly playerId: number;
  readonly fullName: string;
  readonly teamId: number;
  readonly teamDisplayName: string;
}

interface LinkagePlayerRecord {
  readonly offerPlayer: string;
  readonly matchCount: number;
  readonly matches: readonly LinkageMatch[];
}

interface LinkageFixture {
  readonly oddsEvent: {
    readonly eventId: string;
  };
  readonly balldontlieGame: {
    readonly gameId: number;
  };
  readonly matches: readonly LinkagePlayerRecord[];
}

interface MutableGamesFixture {
  data: Array<Record<string, unknown>>;
  meta: Record<string, unknown>;
}

function readJson(filePath: string): unknown {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function readRawBoard(): unknown {
  return readJson(ODDS_FIXTURE_PATH);
}

function readRawGames(): MutableGamesFixture {
  return readJson(GAMES_FIXTURE_PATH) as MutableGamesFixture;
}

function readLinkage(): LinkageFixture {
  return readJson(LINKAGE_FIXTURE_PATH) as LinkageFixture;
}

function resolvedIdentities(): BatterHitsPlayerIdentity[] {
  const linkage = readLinkage();

  return linkage.matches.flatMap((record) => {
    if (record.matchCount !== 1 || record.matches.length !== 1) return [];

    const match = record.matches[0];
    if (match === undefined) return [];

    return [
      {
        providerEventId: linkage.oddsEvent.eventId,
        offerPlayerName: record.offerPlayer,
        providerGameId: linkage.balldontlieGame.gameId,
        providerPlayerId: match.playerId,
        providerTeamId: match.teamId,
        playerName: match.fullName,
        teamName: match.teamDisplayName,
      },
    ];
  });
}

function matchedGame(games: MutableGamesFixture): Record<string, unknown> {
  const game = games.data.find((row) => row['id'] === MATCHED_GAME_ID);
  assert.ok(game);
  return game;
}

function connect(
  rawGamesSnapshot: unknown = readRawGames(),
  asOf = SOURCE_CAPTURED_AT,
) {
  return connectPregameBatterHitsBoard({
    rawEventSnapshot: readRawBoard(),
    sourceSnapshotSha256: BOARD_SOURCE_SNAPSHOT_SHA256,
    sourceCapturedAt: SOURCE_CAPTURED_AT,
    playerIdentities: resolvedIdentities(),
    rawGamesSnapshot,
    gameSourceSnapshotSha256: GAME_SOURCE_SNAPSHOT_SHA256,
    gameSourceCapturedAt: SOURCE_CAPTURED_AT,
    asOf,
  });
}

function offerIdentity(
  offer: ReturnType<typeof connect>['offers'][number],
): readonly [string, string, number, number, string, string] {
  return [
    offer.providerMarketKey,
    offer.offerType,
    offer.providerPlayerId,
    offer.line,
    offer.selectedSide,
    offer.rawSide,
  ];
}

test('scheduled pregame offers survive with exact selected side and line identity', () => {
  const board = connect();

  assert.equal(board.offers.length, 34);
  assert.equal(board.excludedOffers.length, 0);
  assert.equal(board.rejectedOffers.length, 2);
  assert.equal(board.gameSourceSnapshotSha256, GAME_SOURCE_SNAPSHOT_SHA256);

  const baselineLower = board.offers.find(
    (offer) =>
      offer.playerName === 'Gavin Sheets' && offer.selectedSide === 'lower',
  );
  assert.ok(baselineLower);
  assert.deepEqual(offerIdentity(baselineLower), [
    'batter_hits',
    'baseline',
    725,
    0.5,
    'lower',
    'Under',
  ]);

  const alternateHigher = board.offers.find(
    (offer) =>
      offer.playerName === 'Matt Olson' && offer.selectedSide === 'higher',
  );
  assert.ok(alternateHigher);
  assert.deepEqual(offerIdentity(alternateHigher), [
    'batter_hits_alternate',
    'alternate',
    856,
    1.5,
    'higher',
    'Over',
  ]);

  assert.equal('pWin' in baselineLower, false);
  assert.equal('pLoss' in baselineLower, false);
  assert.equal('pVoid' in baselineLower, false);
  assert.equal('pWinGivenGrades' in baselineLower, false);
});

test('a final matched game excludes every offer before ranking', () => {
  const games = readRawGames();
  matchedGame(games)['status'] = 'STATUS_FINAL';

  const board = connect(games);

  assert.equal(board.offers.length, 0);
  assert.equal(board.excludedOffers.length, 34);
  assert.ok(
    board.excludedOffers.every(
      (excluded) =>
        excluded.reason === 'GAME_STATUS_NOT_SCHEDULED' &&
        excluded.rawGameStatus === 'STATUS_FINAL',
    ),
  );
});

test('the earlier preserved provider start time is a strict pregame cutoff', () => {
  const immediatelyBefore = connect(
    readRawGames(),
    '2026-07-23T16:14:59.999Z',
  );
  assert.equal(immediatelyBefore.offers.length, 34);

  const atCutoff = connect(readRawGames(), '2026-07-23T16:15:00.000Z');
  assert.equal(atCutoff.offers.length, 0);
  assert.equal(atCutoff.excludedOffers.length, 34);
  assert.ok(
    atCutoff.excludedOffers.every(
      (excluded) =>
        excluded.reason === 'GAME_START_REACHED' &&
        excluded.cutoffTime === '2026-07-23T16:15:00.000Z',
    ),
  );
});

test('unknown or missing matched game state fails closed', () => {
  const unknownStatus = readRawGames();
  matchedGame(unknownStatus)['status'] = 'STATUS_IN_PROGRESS';

  const unknownBoard = connect(unknownStatus);
  assert.equal(unknownBoard.offers.length, 0);
  assert.equal(unknownBoard.excludedOffers.length, 34);
  assert.ok(
    unknownBoard.excludedOffers.every(
      (excluded) =>
        excluded.reason === 'GAME_STATE_UNRESOLVED' &&
        excluded.rawGameStatus === 'STATUS_IN_PROGRESS',
    ),
  );

  const missingGame = readRawGames();
  missingGame.data = missingGame.data.filter(
    (row) => row['id'] !== MATCHED_GAME_ID,
  );

  const missingBoard = connect(missingGame);
  assert.equal(missingBoard.offers.length, 0);
  assert.equal(missingBoard.excludedOffers.length, 34);
  assert.ok(
    missingBoard.excludedOffers.every(
      (excluded) =>
        excluded.reason === 'GAME_STATE_UNRESOLVED' &&
        excluded.rawGameStatus === undefined,
    ),
  );
});
