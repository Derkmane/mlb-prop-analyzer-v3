import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';

import { loadFrozenBatterHitsProbabilityArtifactsFromFiles } from '../src/adapters/index.js';
import { connectPregameBatterHitsBoard } from '../src/composition/index.js';
import {
  buildFrozenBatterHitsRuntimeDistribution,
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
const TEAM_BULLPEN_ARTIFACT_PATH = path.resolve(
  'model-artifacts/m8-5-team-bullpen-outcome-v1.json',
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

interface TeamBullpenCategoryProbability {
  readonly category: string;
  readonly probability: number;
}

interface TeamBullpenEffect {
  readonly matchupKey: string;
  readonly categoryProbabilities: readonly TeamBullpenCategoryProbability[];
}

interface TeamBullpenArtifact {
  readonly effects: readonly TeamBullpenEffect[];
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

function overrideForTeam(
  teamId: number,
  modeledCategories: readonly string[],
): Record<Hand, Record<string, number>> {
  const artifact = readJson(TEAM_BULLPEN_ARTIFACT_PATH) as TeamBullpenArtifact;
  const vectors = {} as Record<Hand, Record<string, number>>;
  const modeledCategorySet = new Set(modeledCategories);

  for (const bullpenHand of ['L', 'R'] as const) {
    const effect = artifact.effects.find(
      (candidate) =>
        candidate.matchupKey ===
        `pitching-team:${teamId}|pitcher-hand:${bullpenHand}`,
    );
    assert.ok(effect);

    for (const categoryProbability of effect.categoryProbabilities) {
      if (!modeledCategorySet.has(categoryProbability.category)) {
        assert.equal(categoryProbability.probability, 0);
      }
    }

    const vector: Record<string, number> = {};
    for (const category of modeledCategories) {
      const categoryProbability = effect.categoryProbabilities.find(
        (candidate) => candidate.category === category,
      );
      assert.ok(categoryProbability);
      vector[category] = categoryProbability.probability;
    }

    const retainedMass = Object.values(vector).reduce(
      (sum, probability) => sum + probability,
      0,
    );
    assert.ok(Math.abs(retainedMass - 1) <= 1e-9);
    vectors[bullpenHand] = vector;
  }

  return vectors;
}

function firstBaselineHalfHitOffer(): NormalizedBatterHitsBoardOffer {
  const offer = pregameBoard().offers.find(
    (candidate) => candidate.offerType === 'baseline' && candidate.line === 0.5,
  );
  assert.ok(offer);
  return offer;
}

test('omitting the team bullpen override reproduces the frozen distribution exactly', async () => {
  const offer = firstBaselineHalfHitOffer();
  const observation = observationFor(offer);
  const artifacts = await loadFrozenBatterHitsProbabilityArtifactsFromFiles();

  const omitted = buildFrozenBatterHitsRuntimeDistribution(
    offer,
    observation,
    artifacts,
  );
  const emptyContext = buildFrozenBatterHitsRuntimeDistribution(
    offer,
    observation,
    artifacts,
    {},
  );

  assert.deepEqual(emptyContext, omitted);
});

test('a team-specific bullpen vector moves the statistic distribution', async () => {
  const offer = firstBaselineHalfHitOffer();
  const observation = observationFor(offer);
  const artifacts = await loadFrozenBatterHitsProbabilityArtifactsFromFiles();

  const frozen = buildFrozenBatterHitsRuntimeDistribution(
    offer,
    observation,
    artifacts,
  );
  const adjusted = buildFrozenBatterHitsRuntimeDistribution(
    offer,
    observation,
    artifacts,
    {
      bullpenOverrideByHand: overrideForTeam(
        observation.opposingStarterTeamId,
        artifacts.terminalOutcome.categories,
      ),
    },
  );

  assert.notDeepEqual(
    adjusted.statisticDistribution,
    frozen.statisticDistribution,
  );
  const adjustedMass = adjusted.statisticDistribution.probabilities.reduce(
    (sum, probability) => sum + probability,
    0,
  );
  assert.ok(Math.abs(adjustedMass - 1) <= 1e-12);
});

test('a malformed bullpen override fails closed', async () => {
  const offer = firstBaselineHalfHitOffer();
  const observation = observationFor(offer);
  const artifacts = await loadFrozenBatterHitsProbabilityArtifactsFromFiles();

  assert.throws(() =>
    buildFrozenBatterHitsRuntimeDistribution(offer, observation, artifacts, {
      bullpenOverrideByHand: {
        L: { '1B': 0.5 },
        R: { '1B': 0.5 },
      },
    }),
  );
});
