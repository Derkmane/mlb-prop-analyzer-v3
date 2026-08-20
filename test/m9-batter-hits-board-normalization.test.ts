import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';

import {
  deriveStandardBookBaselineLines,
  OddsApiBatterHitsBoardError,
} from '../src/adapters/index.js';
import { connectNormalizedBatterHitsBoard } from '../src/composition/index.js';
import type { BatterHitsPlayerIdentity } from '../src/features/batter-hits/index.js';

const FIXTURE_DIRECTORY = path.resolve(
  'fixtures/sanitized/provider-capabilities/2026-07-23/player-identity',
);
const ODDS_FIXTURE_PATH = path.join(
  FIXTURE_DIRECTORY,
  'the-odds-api-22fc220be6958e93fba4354054d8fd16-underdog-batter-hits.json',
);
const LINKAGE_FIXTURE_PATH = path.join(
  FIXTURE_DIRECTORY,
  'cross-provider-player-linkage-5059315.json',
);
const SOURCE_SNAPSHOT_SHA256 =
  '250c1b9c02bb1334c0dce563d14194cabc404dbb48da08a9d49fcd3f457b7db7';
const SOURCE_CAPTURED_AT = '2026-07-23T15:12:25.190Z';

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

function readJson(filePath: string): unknown {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function readRawBoard(): Record<string, unknown> {
  return readJson(ODDS_FIXTURE_PATH) as Record<string, unknown>;
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

function normalize(
  rawEventSnapshot: unknown = readRawBoard(),
  playerIdentities: readonly unknown[] = resolvedIdentities(),
) {
  return connectNormalizedBatterHitsBoard({
    rawEventSnapshot,
    sourceSnapshotSha256: SOURCE_SNAPSHOT_SHA256,
    sourceCapturedAt: SOURCE_CAPTURED_AT,
    playerIdentities,
  });
}

function targetOutcome(
  rawBoard: Record<string, unknown>,
): Record<string, unknown> {
  const bookmakers = rawBoard['bookmakers'];
  assert.ok(Array.isArray(bookmakers));
  const bookmaker = bookmakers[0] as Record<string, unknown> | undefined;
  assert.ok(bookmaker);
  const markets = bookmaker['markets'];
  assert.ok(Array.isArray(markets));
  const market = markets[0] as Record<string, unknown> | undefined;
  assert.ok(market);
  const outcomes = market['outcomes'];
  assert.ok(Array.isArray(outcomes));
  const outcome = outcomes[0] as Record<string, unknown> | undefined;
  assert.ok(outcome);
  return outcome;
}

function expectBoardError(
  operation: () => unknown,
  expectedCode: OddsApiBatterHitsBoardError['code'],
): void {
  assert.throws(operation, (error: unknown) => {
    assert.ok(error instanceof OddsApiBatterHitsBoardError);
    assert.equal(error.code, expectedCode);
    return true;
  });
}

test('standard-book baseline derivation is isolated to the requested market key', () => {
  const bookmaker = (key: string, point: number) => ({
    key: `book-${point}`,
    markets: [{ key, outcomes: [{ description: 'Market Split', point }] }],
  });
  const snapshot = {
    bookmakers: [
      bookmaker('batter_hits', 0.5),
      bookmaker('batter_hits_runs_rbis', 1.5),
      bookmaker('batter_hits_runs_rbis', 1.5),
    ],
  };

  assert.equal(deriveStandardBookBaselineLines(snapshot, 'batter_hits').get('Market Split'), 0.5);
  assert.equal(
    deriveStandardBookBaselineLines(snapshot, 'batter_hits_runs_rbis').get('Market Split'),
    1.5,
  );
});

test('normalizes committed Underdog baseline and alternate offers with exact side and line identity', () => {
  const board = normalize();

  assert.equal(board.providerEventId, '22fc220be6958e93fba4354054d8fd16');
  assert.equal(board.offers.length, 34);
  assert.equal(board.rejectedOffers.length, 2);
  assert.equal(
    board.offers.filter((offer) => offer.offerType === 'baseline').length,
    6,
  );
  assert.equal(
    board.offers.filter((offer) => offer.offerType === 'alternate').length,
    28,
  );

  assert.deepEqual(
    board.rejectedOffers.map((offer) => [
      offer.playerDescription,
      offer.rawSide,
      offer.matchCount,
    ]),
    [
      ['James Jarvis', 'Over', 0],
      ['James Jarvis', 'Under', 0],
    ],
  );

  const baselineLower = board.offers.find(
    (offer) =>
      offer.playerName === 'Gavin Sheets' && offer.selectedSide === 'lower',
  );
  assert.ok(baselineLower);
  assert.equal(baselineLower.providerMarketKey, 'batter_hits');
  assert.equal(baselineLower.offerType, 'baseline');
  assert.equal(baselineLower.rawSide, 'Under');
  assert.equal(baselineLower.line, 0.5);
  assert.equal(baselineLower.providerGameId, 5059315);
  assert.equal(baselineLower.providerPlayerId, 725);
  assert.equal(baselineLower.providerTeamId, 23);
  assert.equal(baselineLower.teamName, 'San Diego Padres');
  assert.equal(baselineLower.marketLastUpdate, '2026-07-23T15:11:47Z');
  assert.equal(baselineLower.sourceSnapshotSha256, SOURCE_SNAPSHOT_SHA256);

  const alternateHigher = board.offers.find(
    (offer) =>
      offer.playerName === 'Fernando Tatis Jr.' &&
      offer.selectedSide === 'higher',
  );
  assert.ok(alternateHigher);
  assert.equal(alternateHigher.providerMarketKey, 'batter_hits_alternate');
  assert.equal(alternateHigher.offerType, 'alternate');
  assert.equal(alternateHigher.rawSide, 'Over');
  assert.equal(alternateHigher.line, 0.5);

  assert.equal(baselineLower.line, alternateHigher.line);
  assert.equal('pWin' in baselineLower, false);
  assert.equal('pLoss' in baselineLower, false);
  assert.equal('pVoid' in baselineLower, false);
  assert.equal('pWinGivenGrades' in baselineLower, false);
});

test('accepts BDL bats/throws metadata on resolved player identities used by projected lineups', () => {
  const identities = resolvedIdentities().map((identity) => ({
    ...identity,
    batsThrows: 'R/R',
  }));

  const board = normalize(readRawBoard(), identities);

  assert.equal(board.offers.length, 34);
  assert.equal(board.rejectedOffers.length, 2);
});

test('classifies by the player baseline line and collapses overlap between provider keys', () => {
  const rawBoard = structuredClone(readRawBoard());
  const bookmaker = (rawBoard['bookmakers'] as Record<string, unknown>[])[0]!;
  const markets = bookmaker['markets'] as Record<string, unknown>[];
  const baseline = markets.find((market) => market['key'] === 'batter_hits')!;
  const alternate = markets.find(
    (market) => market['key'] === 'batter_hits_alternate',
  )!;
  const baselineOutcomes = baseline['outcomes'] as Record<string, unknown>[];
  const gavinOver = baselineOutcomes.find(
    (outcome) => outcome['description'] === 'Gavin Sheets' && outcome['name'] === 'Over',
  )!;
  const gavinUnder = baselineOutcomes.find(
    (outcome) => outcome['description'] === 'Gavin Sheets' && outcome['name'] === 'Under',
  )!;
  baseline['outcomes'] = baselineOutcomes.filter((outcome) => outcome !== gavinOver);
  (alternate['outcomes'] as Record<string, unknown>[]).push(
    structuredClone(gavinOver),
    structuredClone(gavinUnder),
    { ...structuredClone(gavinOver), point: 1.5 },
  );

  const board = normalize(rawBoard);
  const gavinOffers = board.offers.filter((offer) => offer.playerName === 'Gavin Sheets');
  assert.equal(gavinOffers.length, 3);
  assert.equal(
    gavinOffers.find((offer) => offer.selectedSide === 'higher' && offer.line === 0.5)?.offerType,
    'baseline',
  );
  assert.equal(
    gavinOffers.find((offer) => offer.selectedSide === 'higher' && offer.line === 1.5)?.offerType,
    'alternate',
  );
  assert.equal(
    gavinOffers.filter((offer) => offer.selectedSide === 'lower' && offer.line === 0.5).length,
    1,
  );
});

test('fails each event-scoped player with zero or multiple identity matches closed', () => {
  const identities = resolvedIdentities();
  const gavinSheets = identities.find(
    (identity) => identity.offerPlayerName === 'Gavin Sheets',
  );
  assert.ok(gavinSheets);

  const board = normalize(readRawBoard(), [
    ...identities,
    { ...gavinSheets, providerPlayerId: 999999 },
  ]);

  assert.equal(board.offers.length, 32);
  assert.equal(board.rejectedOffers.length, 4);
  assert.equal(
    board.rejectedOffers.filter(
      (offer) =>
        offer.playerDescription === 'Gavin Sheets' && offer.matchCount === 2,
    ).length,
    2,
  );
  assert.equal(
    board.offers.some((offer) => offer.playerName === 'Gavin Sheets'),
    false,
  );
});

test('rejects unsupported side and non-null source IDs instead of inventing contracts', () => {
  const unsupportedSide = structuredClone(readRawBoard());
  targetOutcome(unsupportedSide)['name'] = 'Push';
  expectBoardError(
    () => normalize(unsupportedSide),
    'UNSUPPORTED_SELECTED_SIDE',
  );

  const unsupportedSourceId = structuredClone(readRawBoard());
  targetOutcome(unsupportedSourceId)['sid'] = 'unverified-provider-id';
  expectBoardError(
    () => normalize(unsupportedSourceId),
    'UNSUPPORTED_SOURCE_ID_CONTRACT',
  );
});
