import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

import { loadFrozenBatterHitsProbabilityArtifactsFromFiles } from '../../src/adapters/index.js';
import { connectPregameBatterHitsBoard } from '../../src/composition/index.js';
import {
  createM8BatterHitsBaseDistribution,
  settleM8BatterHitsBaseOffer,
  type BatterHitsPlayerIdentity,
  type ConfirmedBatterHitsRuntimeObservation,
  type FrozenBatterHitsProbabilityArtifacts,
  type M8BatterHitsBaseDistributionV1,
  type M8BatterHitsBaseEvaluationV1,
  type M8_5GameOffensiveEnvironmentModelArtifactV1,
  type NormalizedBatterHitsBoardOffer,
  type ResolveM8_5GameOffensiveEnvironmentV1Input,
} from '../../src/features/batter-hits/index.js';

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
export const GAME_ENVIRONMENT_MODEL_PATH = path.resolve(
  'model-artifacts/m8-5-game-offensive-environment-model-v1.json',
);
export const TEAM_BULLPEN_ARTIFACT_PATH = path.resolve(
  'model-artifacts/m8-5-team-bullpen-outcome-v1.json',
);
export const PARK_ARTIFACT_PATH = path.resolve(
  'model-artifacts/m8-5-park-transformation-v1.json',
);

const BOARD_SOURCE_SNAPSHOT_SHA256 =
  '250c1b9c02bb1334c0dce563d14194cabc404dbb48da08a9d49fcd3f457b7db7';
const GAME_SOURCE_SNAPSHOT_SHA256 =
  'f794c97cda6ad78e239c2b6efc9efd64ae2414a9c627672d9db166f7b05a3185';
const LINEUP_SOURCE_SNAPSHOT_SHA256 =
  'e22f4601fd95c74f2cb692f9f3db322f6a43c3f2b26026bcc23311e3c40ca7cd';
export const SOURCE_CAPTURED_AT = '2026-07-23T15:12:25.190Z';
const MATCHED_GAME_ID = 5059315;

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
  readonly venue: string;
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

export function readJson(filePath: string): unknown {
  return JSON.parse(fs.readFileSync(filePath, 'utf8')) as unknown;
}

function resolvedIdentities(): BatterHitsPlayerIdentity[] {
  const linkage = readJson(LINKAGE_FIXTURE_PATH) as LinkageFixture;
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

function explicitHand(value: string, index: number): Hand {
  const hand = value.split('/')[index];
  if (hand !== 'L' && hand !== 'R') {
    throw new Error('fixture hand must be explicit L or R');
  }
  return hand;
}

export function observationFor(
  offer: NormalizedBatterHitsBoardOffer,
): ConfirmedBatterHitsRuntimeObservation {
  const lineups = (readJson(LINEUPS_FIXTURE_PATH) as {
    readonly data: readonly LineupRecord[];
  }).data;
  const games = (readJson(GAMES_FIXTURE_PATH) as {
    readonly data: readonly GameRecord[];
  }).data;
  const game = games.find((row) => row.id === MATCHED_GAME_ID);
  assert.ok(game);
  const hitter = lineups.find(
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
  const starter = lineups.find(
    (row) =>
      row.game_id === MATCHED_GAME_ID &&
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

  return {
    lineupStatus: 'confirmed',
    providerGameId: offer.providerGameId,
    providerPlayerId: offer.providerPlayerId,
    providerTeamId: offer.providerTeamId,
    teamSide,
    venue: game.venue,
    lineupSlot:
      hitter.batting_order as ConfirmedBatterHitsRuntimeObservation['lineupSlot'],
    batterSide: explicitHand(hitter.player.bats_throws, 0),
    opposingStarterPitcherId: starter.player.id,
    opposingStarterTeamId: starter.team.id,
    opposingStarterHand: explicitHand(starter.player.bats_throws, 1),
    eligibilityProbability: 1,
    lineupSourceCapturedAt: SOURCE_CAPTURED_AT,
    lineupSourceSnapshotSha256: LINEUP_SOURCE_SNAPSHOT_SHA256,
  };
}

export function baselineOffer(): NormalizedBatterHitsBoardOffer {
  const offer = pregameBoard().offers.find(
    (candidate) =>
      candidate.playerName === 'Gavin Sheets' &&
      candidate.offerType === 'baseline' &&
      candidate.line === 0.5 &&
      candidate.selectedSide === 'higher',
  );
  assert.ok(offer);
  return offer;
}

export function gameEnvironmentResolutionInput(
  offer: NormalizedBatterHitsBoardOffer,
  artifacts: FrozenBatterHitsProbabilityArtifacts,
  model: M8_5GameOffensiveEnvironmentModelArtifactV1,
): ResolveM8_5GameOffensiveEnvironmentV1Input {
  return Object.freeze({
    gameId: String(offer.providerGameId),
    sourceSharedEnvironmentModelVersion:
      artifacts.sharedEnvironment.modelVersion,
    sourceSharedEnvironmentArtifactSha256:
      artifacts.sharedEnvironment.artifactSha256,
    scenarioIds: Object.freeze([...model.scenarioIds]),
    features: Object.freeze(
      Object.fromEntries(
        model.featureNormalization.map((row) => [
          row.featureName,
          row.mean,
        ]),
      ),
    ),
  });
}

export function offerAt(
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

export interface FinalEvaluationFixture {
  readonly offer: NormalizedBatterHitsBoardOffer;
  readonly observation: ConfirmedBatterHitsRuntimeObservation;
  readonly artifacts: FrozenBatterHitsProbabilityArtifacts;
  readonly sourceBaseDistribution: M8BatterHitsBaseDistributionV1;
  readonly sourceM8Evaluation: M8BatterHitsBaseEvaluationV1;
  readonly gameModel: M8_5GameOffensiveEnvironmentModelArtifactV1;
  readonly gameResolutionInput: ResolveM8_5GameOffensiveEnvironmentV1Input;
  readonly teamArtifact: unknown;
  readonly parkArtifact: unknown;
}

export async function loadFinalEvaluationFixture(): Promise<FinalEvaluationFixture> {
  const offer = baselineOffer();
  const observation = observationFor(offer);
  const artifacts = await loadFrozenBatterHitsProbabilityArtifactsFromFiles();
  const sourceBaseDistribution = createM8BatterHitsBaseDistribution(
    offer,
    observation,
    artifacts,
    SOURCE_CAPTURED_AT,
  );
  const sourceM8Evaluation = settleM8BatterHitsBaseOffer(
    sourceBaseDistribution,
    offer,
  );
  const gameModel = readJson(
    GAME_ENVIRONMENT_MODEL_PATH,
  ) as M8_5GameOffensiveEnvironmentModelArtifactV1;
  return Object.freeze({
    offer,
    observation,
    artifacts,
    sourceBaseDistribution,
    sourceM8Evaluation,
    gameModel,
    gameResolutionInput: gameEnvironmentResolutionInput(
      offer,
      artifacts,
      gameModel,
    ),
    teamArtifact: readJson(TEAM_BULLPEN_ARTIFACT_PATH),
    parkArtifact: readJson(PARK_ARTIFACT_PATH),
  });
}

export function probabilityMass(distribution: {
  readonly probabilities: readonly number[];
}): number {
  return distribution.probabilities.reduce(
    (sum, probability) => sum + probability,
    0,
  );
}
