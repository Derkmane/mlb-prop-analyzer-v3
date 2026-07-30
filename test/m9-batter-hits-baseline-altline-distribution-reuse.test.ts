import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';

import { loadFrozenBatterHitsProbabilityArtifactsFromFiles } from '../src/adapters/index.js';
import { connectPregameBatterHitsBoard } from '../src/composition/index.js';
import {
  buildFrozenBatterHitsRuntimeDistribution,
  createFrozenBatterHitsProbabilityCandidate,
  type BatterHitsPlayerIdentity,
  type ConfirmedBatterHitsRuntimeObservation,
  type NormalizedBatterHitsBoardOffer,
} from '../src/features/batter-hits/index.js';

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
const LINEUPS_FIXTURE_PATH = path.join(
  FIXTURE_DIRECTORY,
  'balldontlie-lineups-5059315.json',
);
const LINKAGE_FIXTURE_PATH = path.join(
  FIXTURE_DIRECTORY,
  'cross-provider-player-linkage-5059315.json',
);

const BOARD_SOURCE_SNAPSHOT_SHA256 =
  '250c1b9c02bb1334c0dce563d14194cabc404dbb48da08a9d49fcd3f457b7db7';
const GAME_SOURCE_SNAPSHOT_SHA256 =
  'f794c97cda6ad78e239c2b6efc9efd64ae2414a9c627672d9db166f7b05a3185';
const LINEUP_SOURCE_SNAPSHOT_SHA256 =
  'e22f4601fd95c74f2cb692f9f3db322f6a43c3f2b26026bcc23311e3c40ca7cd';
const SOURCE_CAPTURED_AT = '2026-07-23T15:12:25.190Z';
const MATCHED_GAME_ID = 5059315;

type Hand = 'L' | 'R';

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
  readonly oddsEvent: { readonly eventId: string };
  readonly balldontlieGame: { readonly gameId: number };
  readonly matches: readonly LinkagePlayerRecord[];
}

interface TeamRecord {
  readonly id: number;
}

interface GameRecord {
  readonly id: number;
  readonly home_team: TeamRecord;
  readonly away_team: TeamRecord;
}

interface GamesFixture {
  readonly data: readonly GameRecord[];
}

interface LineupPlayer {
  readonly id: number;
  readonly bats_throws: string;
}

interface LineupRecord {
  readonly game_id: number;
  readonly player: LineupPlayer;
  readonly team: TeamRecord;
  readonly batting_order: number | null;
  readonly is_probable_pitcher: boolean;
}

interface LineupsFixture {
  readonly data: readonly LineupRecord[];
}

function readJson(filePath: string): unknown {
  return JSON.parse(fs.readFileSync(filePath, 'utf8')) as unknown;
}

function resolvedIdentities(): BatterHitsPlayerIdentity[] {
  const linkage = readJson(LINKAGE_FIXTURE_PATH) as LinkageFixture;
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

function pregameBoard() {
  return connectPregameBatterHitsBoard({
    rawEventSnapshot: readJson(ODDS_FIXTURE_PATH),
    sourceSnapshotSha256: BOARD_SOURCE_SNAPSHOT_SHA256,
    sourceCapturedAt: SOURCE_CAPTURED_AT,
    playerIdentities: resolvedIdentities(),
    rawGamesSnapshot: readJson(GAMES_FIXTURE_PATH),
    gameSourceSnapshotSha256: GAME_SOURCE_SNAPSHOT_SHA256,
    gameSourceCapturedAt: SOURCE_CAPTURED_AT,
    asOf: SOURCE_CAPTURED_AT,
  });
}

function hand(value: string, label: string): Hand {
  if (value !== 'L' && value !== 'R') {
    throw new Error(`${label} must be an explicit L or R in the committed fixture.`);
  }
  return value;
}

function observationFor(
  offer: NormalizedBatterHitsBoardOffer,
): ConfirmedBatterHitsRuntimeObservation {
  const lineups = readJson(LINEUPS_FIXTURE_PATH) as LineupsFixture;
  const games = readJson(GAMES_FIXTURE_PATH) as GamesFixture;
  const game = games.data.find((row) => row.id === MATCHED_GAME_ID);
  assert.ok(game);

  const hitter = lineups.data.find(
    (row) =>
      row.game_id === MATCHED_GAME_ID &&
      row.player.id === offer.providerPlayerId &&
      row.team.id === offer.providerTeamId &&
      row.batting_order !== null &&
      row.is_probable_pitcher === false,
  );
  assert.ok(hitter);
  assert.ok(
    hitter.batting_order !== null &&
      Number.isInteger(hitter.batting_order) &&
      hitter.batting_order >= 1 &&
      hitter.batting_order <= 9,
  );

  const starter = lineups.data.find(
    (row) =>
      row.game_id === MATCHED_GAME_ID &&
      row.is_probable_pitcher === true &&
      row.team.id !== hitter.team.id,
  );
  assert.ok(starter);

  const [batterSideRaw] = hitter.player.bats_throws.split('/');
  const [, starterHandRaw] = starter.player.bats_throws.split('/');
  const teamSide =
    hitter.team.id === game.home_team.id
      ? 'home'
      : hitter.team.id === game.away_team.id
        ? 'away'
        : null;
  assert.ok(teamSide !== null);

  return {
    lineupStatus: 'confirmed',
    providerGameId: offer.providerGameId,
    providerPlayerId: offer.providerPlayerId,
    providerTeamId: offer.providerTeamId,
    teamSide,
    lineupSlot:
      hitter.batting_order as ConfirmedBatterHitsRuntimeObservation['lineupSlot'],
    batterSide: hand(batterSideRaw ?? '', 'batter side'),
    opposingStarterPitcherId: starter.player.id,
    opposingStarterTeamId: starter.team.id,
    opposingStarterHand: hand(starterHandRaw ?? '', 'starter hand'),
    eligibilityProbability: 1,
    lineupSourceCapturedAt: SOURCE_CAPTURED_AT,
    lineupSourceSnapshotSha256: LINEUP_SOURCE_SNAPSHOT_SHA256,
  };
}

test('observed baseline and alternate offer attributes reuse one statistic distribution for identical player and game inputs', async () => {
  const board = pregameBoard();
  const baselineOffer = board.offers.find(
    (offer) =>
      offer.playerName === 'Gavin Sheets' &&
      offer.offerType === 'baseline' &&
      offer.selectedSide === 'higher' &&
      offer.line === 0.5,
  );
  const observedAlternateOffer = board.offers.find(
    (offer) =>
      offer.playerName === 'Matt Olson' &&
      offer.offerType === 'alternate' &&
      offer.selectedSide === 'lower' &&
      offer.line === 1.5,
  );
  assert.ok(baselineOffer);
  assert.ok(observedAlternateOffer);

  // The committed board has no same-player baseline/alternate pair. This
  // test-only immutable variant holds player/game/model inputs fixed while
  // substituting only a real observed alternate offer attribute set.
  const alternateAttributesForSamePlayer: NormalizedBatterHitsBoardOffer =
    Object.freeze({
      ...baselineOffer,
      providerMarketKey: observedAlternateOffer.providerMarketKey,
      offerType: observedAlternateOffer.offerType,
      selectedSide: observedAlternateOffer.selectedSide,
      rawSide: observedAlternateOffer.rawSide,
      line: observedAlternateOffer.line,
      americanPrice: observedAlternateOffer.americanPrice,
      multiplier: observedAlternateOffer.multiplier,
      marketLastUpdate: observedAlternateOffer.marketLastUpdate,
    });

  const observation = observationFor(baselineOffer);
  const artifacts = await loadFrozenBatterHitsProbabilityArtifactsFromFiles();

  const baselineDistribution = buildFrozenBatterHitsRuntimeDistribution(
    baselineOffer,
    observation,
    artifacts,
  );
  const alternateDistribution = buildFrozenBatterHitsRuntimeDistribution(
    alternateAttributesForSamePlayer,
    observation,
    artifacts,
  );

  assert.deepEqual(alternateDistribution, baselineDistribution);

  const baselineResult = createFrozenBatterHitsProbabilityCandidate(
    baselineOffer,
    observation,
    artifacts,
  );
  const alternateResult = createFrozenBatterHitsProbabilityCandidate(
    alternateAttributesForSamePlayer,
    observation,
    artifacts,
  );

  assert.deepEqual(
    alternateResult.candidate.statisticDistribution,
    baselineResult.candidate.statisticDistribution,
  );
  assert.equal(baselineResult.candidate.selectedSide, 'higher');
  assert.equal(baselineResult.candidate.line, 0.5);
  assert.equal(alternateResult.candidate.selectedSide, 'lower');
  assert.equal(alternateResult.candidate.line, 1.5);
  assert.notEqual(alternateResult.candidate.pWin, baselineResult.candidate.pWin);
  assert.equal(baselineResult.productionEnabled, false);
  assert.equal(alternateResult.productionEnabled, false);
});
