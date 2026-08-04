import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

import { connectPregameBatterHitsBoard } from '../../src/composition/index.js';
import type {
  BatterHitsPlayerIdentity,
  BatterHitsRuntimeObservation,
  NormalizedBatterHitsBoardOffer,
} from '../../src/features/batter-hits/index.js';
import { m9FinalGameEnvironmentResolutionInput } from './m9-final-probability-resolution.js';

export const M9_FIXTURE_DIRECTORY = path.resolve(
  'fixtures/sanitized/provider-capabilities/2026-07-23/player-identity',
);
export const M9_ODDS_FIXTURE_PATH = path.join(
  M9_FIXTURE_DIRECTORY,
  'the-odds-api-22fc220be6958e93fba4354054d8fd16-underdog-batter-hits.json',
);
export const M9_GAMES_FIXTURE_PATH = path.join(
  M9_FIXTURE_DIRECTORY,
  'balldontlie-games-2026-07-23.json',
);
export const M9_LINEUPS_FIXTURE_PATH = path.join(
  M9_FIXTURE_DIRECTORY,
  'balldontlie-lineups-5059315.json',
);
export const M9_LINKAGE_FIXTURE_PATH = path.join(
  M9_FIXTURE_DIRECTORY,
  'cross-provider-player-linkage-5059315.json',
);

export const M9_BOARD_SOURCE_SNAPSHOT_SHA256 =
  '250c1b9c02bb1334c0dce563d14194cabc404dbb48da08a9d49fcd3f457b7db7';
export const M9_GAME_SOURCE_SNAPSHOT_SHA256 =
  'f794c97cda6ad78e239c2b6efc9efd64ae2414a9c627672d9db166f7b05a3185';
export const M9_LINEUP_SOURCE_SNAPSHOT_SHA256 =
  'e22f4601fd95c74f2cb692f9f3db322f6a43c3f2b26026bcc23311e3c40ca7cd';
export const M9_SOURCE_CAPTURED_AT = '2026-07-23T15:12:25.190Z';
export const M9_MATCHED_GAME_ID = 5059315;

type Hand = 'L' | 'R';

interface LinkageMatch {
  readonly playerId: number;
  readonly fullName: string;
  readonly teamId: number;
  readonly teamDisplayName: string;
}

interface LinkageFixture {
  readonly oddsEvent: { readonly eventId: string };
  readonly balldontlieGame: { readonly gameId: number };
  readonly matches: readonly {
    readonly offerPlayer: string;
    readonly matchCount: number;
    readonly matches: readonly LinkageMatch[];
  }[];
}

interface GameRecord {
  readonly id: number;
  readonly home_team: { readonly id: number };
  readonly away_team: { readonly id: number };
  readonly venue?: string;
}

interface LineupRecord {
  readonly game_id: number;
  readonly player: {
    readonly id: number;
    readonly bats_throws: string;
  };
  readonly team: { readonly id: number };
  readonly batting_order: number | null;
  readonly is_probable_pitcher: boolean;
}

export function m9ReadJson(filePath: string): unknown {
  return JSON.parse(fs.readFileSync(filePath, 'utf8')) as unknown;
}

export function m9ResolvedIdentities(): BatterHitsPlayerIdentity[] {
  const linkage = m9ReadJson(M9_LINKAGE_FIXTURE_PATH) as LinkageFixture;
  return linkage.matches.flatMap((record) => {
    const match = record.matches[0];
    if (
      record.matchCount !== 1 ||
      record.matches.length !== 1 ||
      match === undefined
    ) {
      return [];
    }
    return [{
      providerEventId: linkage.oddsEvent.eventId,
      offerPlayerName: record.offerPlayer,
      providerGameId: linkage.balldontlieGame.gameId,
      providerPlayerId: match.playerId,
      providerTeamId: match.teamId,
      playerName: match.fullName,
      teamName: match.teamDisplayName,
    }];
  });
}

export function m9PregameBoard(
  rawGamesSnapshot: unknown = m9ReadJson(M9_GAMES_FIXTURE_PATH),
) {
  return connectPregameBatterHitsBoard({
    rawEventSnapshot: m9ReadJson(M9_ODDS_FIXTURE_PATH),
    sourceSnapshotSha256: M9_BOARD_SOURCE_SNAPSHOT_SHA256,
    sourceCapturedAt: M9_SOURCE_CAPTURED_AT,
    playerIdentities: m9ResolvedIdentities(),
    rawGamesSnapshot,
    gameSourceSnapshotSha256: M9_GAME_SOURCE_SNAPSHOT_SHA256,
    gameSourceCapturedAt: M9_SOURCE_CAPTURED_AT,
    asOf: M9_SOURCE_CAPTURED_AT,
  });
}

function explicitHand(value: string, index: number): Hand {
  const hand = value.split('/')[index];
  if (hand !== 'L' && hand !== 'R') {
    throw new Error('fixture hand must be explicit L or R');
  }
  return hand;
}

export function m9ObservationFor(
  offer: NormalizedBatterHitsBoardOffer,
  lineupStatus: BatterHitsRuntimeObservation['lineupStatus'] = 'confirmed',
): BatterHitsRuntimeObservation {
  const lineups = (m9ReadJson(M9_LINEUPS_FIXTURE_PATH) as {
    readonly data: readonly LineupRecord[];
  }).data;
  const games = (m9ReadJson(M9_GAMES_FIXTURE_PATH) as {
    readonly data: readonly GameRecord[];
  }).data;
  const game = games.find((row) => row.id === M9_MATCHED_GAME_ID);
  assert.ok(game);
  const hitter = lineups.find(
    (row) =>
      row.game_id === M9_MATCHED_GAME_ID &&
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
  const starter = lineups.find(
    (row) =>
      row.game_id === M9_MATCHED_GAME_ID &&
      row.is_probable_pitcher === true &&
      row.team.id !== hitter.team.id,
  );
  assert.ok(starter);
  const teamSide =
    hitter.team.id === game.home_team.id
      ? 'home'
      : hitter.team.id === game.away_team.id
        ? 'away'
        : null;
  assert.ok(teamSide !== null);

  return Object.freeze({
    lineupStatus,
    providerGameId: offer.providerGameId,
    providerPlayerId: offer.providerPlayerId,
    providerTeamId: offer.providerTeamId,
    teamSide,
    ...(game.venue === undefined ? {} : { venue: game.venue }),
    lineupSlot: hitter.batting_order as BatterHitsRuntimeObservation['lineupSlot'],
    batterSide: explicitHand(hitter.player.bats_throws, 0),
    opposingStarterPitcherId: starter.player.id,
    opposingStarterTeamId: starter.team.id,
    opposingStarterHand: explicitHand(starter.player.bats_throws, 1),
    eligibilityProbability: 1,
    lineupSourceCapturedAt: M9_SOURCE_CAPTURED_AT,
    lineupSourceSnapshotSha256: M9_LINEUP_SOURCE_SNAPSHOT_SHA256,
  });
}

export function m9Offer(
  board: ReturnType<typeof m9PregameBoard>,
  playerName: string,
  offerType: 'baseline' | 'alternate',
  line: number,
  selectedSide: 'higher' | 'lower',
): NormalizedBatterHitsBoardOffer {
  const offer = board.offers.find(
    (candidate) =>
      candidate.playerName === playerName &&
      candidate.offerType === offerType &&
      candidate.line === line &&
      candidate.selectedSide === selectedSide,
  );
  assert.ok(offer);
  return offer;
}

export function m9SyntheticOffer(
  source: NormalizedBatterHitsBoardOffer,
  selectedSide: 'higher' | 'lower',
  line: number,
): NormalizedBatterHitsBoardOffer {
  return Object.freeze({
    ...source,
    providerMarketKey: 'batter_hits_alternate',
    offerType: 'alternate',
    selectedSide,
    rawSide: selectedSide === 'higher' ? 'Over' : 'Under',
    line,
  });
}

export async function m9FinalProbabilityInput(
  board: ReturnType<typeof m9PregameBoard>,
  offer: NormalizedBatterHitsBoardOffer,
  lineupStatus: BatterHitsRuntimeObservation['lineupStatus'] = 'confirmed',
) {
  return Object.freeze({
    pregameBoard: board,
    offer,
    observation: m9ObservationFor(offer, lineupStatus),
    gameEnvironmentResolutionInput:
      await m9FinalGameEnvironmentResolutionInput(offer),
  });
}
