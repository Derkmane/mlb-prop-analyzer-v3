import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';

import {
  connectNormalizedBatterHitsBoard,
  connectPregameBatterHitsBoard,
} from '../src/composition/index.js';
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

interface RawOutcome {
  readonly name: string;
  readonly description: string;
  readonly point: number;
}

interface RawMarket {
  readonly key: string;
  readonly outcomes: readonly RawOutcome[];
}

interface RawBookmaker {
  readonly key: string;
  readonly markets: readonly RawMarket[];
}

interface RawBoardFixture {
  readonly bookmakers: readonly RawBookmaker[];
}

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

interface ExpectedOfferIdentity {
  readonly providerMarketKey: 'batter_hits' | 'batter_hits_alternate';
  readonly providerPlayerId: number;
  readonly rawSide: 'Over' | 'Under';
  readonly selectedSide: 'higher' | 'lower';
  readonly line: number;
}

function readJson(filePath: string): unknown {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function readRawBoard(): RawBoardFixture {
  return readJson(ODDS_FIXTURE_PATH) as RawBoardFixture;
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

function expectedOffers(): ExpectedOfferIdentity[] {
  const identitiesByOfferName = new Map(
    resolvedIdentities().map((identity) => [identity.offerPlayerName, identity]),
  );
  const underdog = readRawBoard().bookmakers.find(
    (bookmaker) => bookmaker.key === 'underdog',
  );
  assert.ok(underdog);

  return underdog.markets.flatMap((market) => {
    if (
      market.key !== 'batter_hits' &&
      market.key !== 'batter_hits_alternate'
    ) {
      return [];
    }

    return market.outcomes.flatMap((outcome) => {
      const identity = identitiesByOfferName.get(outcome.description);
      if (identity === undefined) return [];

      assert.ok(outcome.name === 'Over' || outcome.name === 'Under');

      return [
        {
          providerMarketKey: market.key,
          providerPlayerId: identity.providerPlayerId,
          rawSide: outcome.name,
          selectedSide: outcome.name === 'Over' ? 'higher' : 'lower',
          line: outcome.point,
        },
      ];
    });
  });
}

function identityKey(
  offer: Pick<
    ExpectedOfferIdentity,
    'providerMarketKey' | 'providerPlayerId' | 'rawSide'
  >,
): string {
  return JSON.stringify([
    offer.providerMarketKey,
    offer.providerPlayerId,
    offer.rawSide,
  ]);
}

function connectNormalized() {
  return connectNormalizedBatterHitsBoard({
    rawEventSnapshot: readRawBoard(),
    sourceSnapshotSha256: BOARD_SOURCE_SNAPSHOT_SHA256,
    sourceCapturedAt: SOURCE_CAPTURED_AT,
    playerIdentities: resolvedIdentities(),
  });
}

function connectPregame(rawGamesSnapshot: unknown = readRawGames()) {
  return connectPregameBatterHitsBoard({
    rawEventSnapshot: readRawBoard(),
    sourceSnapshotSha256: BOARD_SOURCE_SNAPSHOT_SHA256,
    sourceCapturedAt: SOURCE_CAPTURED_AT,
    playerIdentities: resolvedIdentities(),
    rawGamesSnapshot,
    gameSourceSnapshotSha256: GAME_SOURCE_SNAPSHOT_SHA256,
    gameSourceCapturedAt: SOURCE_CAPTURED_AT,
    asOf: SOURCE_CAPTURED_AT,
  });
}

function matchedGame(games: MutableGamesFixture): Record<string, unknown> {
  const game = games.data.find((row) => row['id'] === MATCHED_GAME_ID);
  assert.ok(game);
  return game;
}

test('all linked baseline and alternate offers preserve exact posted side and line through both public board boundaries', () => {
  const expected = expectedOffers();
  const normalized = connectNormalized();
  const pregame = connectPregame();

  assert.equal(expected.length, 34);
  assert.equal(normalized.offers.length, expected.length);
  assert.equal(pregame.offers.length, expected.length);
  assert.equal(pregame.excludedOffers.length, 0);

  const normalizedByIdentity = new Map(
    normalized.offers.map((offer) => [identityKey(offer), offer]),
  );
  const pregameByIdentity = new Map(
    pregame.offers.map((offer) => [identityKey(offer), offer]),
  );

  assert.equal(normalizedByIdentity.size, expected.length);
  assert.equal(pregameByIdentity.size, expected.length);

  for (const rawOffer of expected) {
    const key = identityKey(rawOffer);
    const normalizedOffer = normalizedByIdentity.get(key);
    const pregameOffer = pregameByIdentity.get(key);

    assert.ok(normalizedOffer, `Missing normalized offer ${key}`);
    assert.ok(pregameOffer, `Missing pregame offer ${key}`);

    assert.equal(normalizedOffer.rawSide, rawOffer.rawSide);
    assert.equal(normalizedOffer.selectedSide, rawOffer.selectedSide);
    assert.equal(normalizedOffer.line, rawOffer.line);

    assert.equal(pregameOffer.rawSide, rawOffer.rawSide);
    assert.equal(pregameOffer.selectedSide, rawOffer.selectedSide);
    assert.equal(pregameOffer.line, rawOffer.line);

    assert.deepEqual(pregameOffer, normalizedOffer);
  }

  assert.ok(expected.some((offer) => offer.providerMarketKey === 'batter_hits'));
  assert.ok(
    expected.some(
      (offer) => offer.providerMarketKey === 'batter_hits_alternate',
    ),
  );
  assert.ok(expected.some((offer) => offer.selectedSide === 'higher'));
  assert.ok(expected.some((offer) => offer.selectedSide === 'lower'));
});

test('final-game exclusion retains each normalized offer side and line unchanged', () => {
  const normalized = connectNormalized();
  const games = readRawGames();
  matchedGame(games)['status'] = 'STATUS_FINAL';

  const excludedBoard = connectPregame(games);

  assert.equal(excludedBoard.offers.length, 0);
  assert.equal(excludedBoard.excludedOffers.length, normalized.offers.length);

  const normalizedByIdentity = new Map(
    normalized.offers.map((offer) => [identityKey(offer), offer]),
  );

  for (const exclusion of excludedBoard.excludedOffers) {
    const normalizedOffer = normalizedByIdentity.get(identityKey(exclusion.offer));
    assert.ok(normalizedOffer);
    assert.deepEqual(exclusion.offer, normalizedOffer);
    assert.equal(exclusion.offer.selectedSide, normalizedOffer.selectedSide);
    assert.equal(exclusion.offer.line, normalizedOffer.line);
  }
});
