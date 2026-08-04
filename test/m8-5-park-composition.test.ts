import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';

import { loadFrozenBatterHitsProbabilityArtifactsFromFiles } from '../src/adapters/index.js';
import { connectPregameBatterHitsBoard } from '../src/composition/index.js';
import {
  buildFrozenBatterHitsRuntimeDistribution,
  projectM8_5ParkMultipliersToModeledCategoriesV1,
  resolveM8_5ParkTransformationV1,
  type BatterHitsPlayerIdentity,
  type BatterHitsRuntimeContextFactors,
  type ConfirmedBatterHitsRuntimeObservation,
  type M8_5ParkTransformationResolutionV1,
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
const PARK_ARTIFACT_PATH = path.resolve(
  'model-artifacts/m8-5-park-transformation-v1.json',
);

const BOARD_SOURCE_SNAPSHOT_SHA256 =
  '250c1b9c02bb1334c0dce563d14194cabc404dbb48da08a9d49fcd3f457b7db7';
const GAME_SOURCE_SNAPSHOT_SHA256 =
  'f794c97cda6ad78e239c2b6efc9efd64ae2414a9c627672d9db166f7b05a3185';
const LINEUP_SOURCE_SNAPSHOT_SHA256 =
  'e22f4601fd95c74f2cb692f9f3db322f6a43c3f2b26026bcc23311e3c40ca7cd';
const SOURCE_CAPTURED_AT = '2026-07-23T15:12:25.190Z';
const MATCHED_GAME_ID = 5059315;
const HIT_CATEGORIES = new Set(['1B', '2B', '3B', 'HR']);

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
  readonly venue?: string;
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
  const venue = game.venue;
  assert.ok(typeof venue === 'string');

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
    venue,
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

function firstBaselineHalfHitOffer(): NormalizedBatterHitsBoardOffer {
  const offer = pregameBoard().offers.find(
    (candidate) => candidate.offerType === 'baseline' && candidate.line === 0.5,
  );
  assert.ok(offer);
  return offer;
}

function earlyLineupBaselineHalfHitOffer(): NormalizedBatterHitsBoardOffer {
  const lineups = readJson(LINEUPS_FIXTURE_PATH) as LineupsFixture;
  const earlyHitters = new Set(
    lineups.data
      .filter((row) => {
        const [batterSide] = row.player.bats_throws.split('/');
        return (
          row.game_id === MATCHED_GAME_ID &&
          row.is_probable_pitcher === false &&
          row.batting_order !== null &&
          row.batting_order <= 2 &&
          (batterSide === 'L' || batterSide === 'R')
        );
      })
      .map((row) => row.player.id),
  );
  const offer = pregameBoard().offers.find(
    (candidate) =>
      candidate.offerType === 'baseline' &&
      candidate.line === 0.5 &&
      earlyHitters.has(candidate.providerPlayerId),
  );
  assert.ok(offer);
  return offer;
}

function parkResolutionFor(
  observation: ConfirmedBatterHitsRuntimeObservation,
): M8_5ParkTransformationResolutionV1 {
  assert.ok(observation.venue);
  return resolveM8_5ParkTransformationV1(readJson(PARK_ARTIFACT_PATH), {
    venue: observation.venue,
    batterHand: observation.batterSide,
  });
}

function parkContextFor(
  observation: ConfirmedBatterHitsRuntimeObservation,
  modeledCategories: readonly string[],
): BatterHitsRuntimeContextFactors {
  return {
    parkMultipliersByCategory:
      projectM8_5ParkMultipliersToModeledCategoriesV1(
        parkResolutionFor(observation),
        modeledCategories,
      ),
  };
}

function contrastingBullpenOverride(
  modeledCategories: readonly string[],
): NonNullable<BatterHitsRuntimeContextFactors['bullpenOverrideByHand']> {
  const nonHitCategoryCount = modeledCategories.filter(
    (category) => !HIT_CATEGORIES.has(category),
  ).length;
  assert.ok(nonHitCategoryCount > 0);

  const vector = Object.freeze(
    Object.fromEntries(
      modeledCategories.map((category) => [
        category,
        HIT_CATEGORIES.has(category) ? 0.23 : 0.08 / nonHitCategoryCount,
      ]),
    ),
  );
  return Object.freeze({ L: vector, R: vector });
}

function scenarioAt(
  distribution: ReturnType<typeof buildFrozenBatterHitsRuntimeDistribution>,
  index: number,
) {
  const scenario = distribution.scenarios[index];
  assert.ok(scenario);
  return scenario;
}

test('omitting park reproduces the frozen distribution exactly', async () => {
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

test('a real venue-hand park multiplier set moves the statistic distribution', async () => {
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
    parkContextFor(observation, artifacts.terminalOutcome.categories),
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

test('park applies to both starter and reliever branches', async () => {
  const offer = earlyLineupBaselineHalfHitOffer();
  const observation = observationFor(offer);
  assert.ok(observation.lineupSlot <= 2);
  const artifacts = await loadFrozenBatterHitsProbabilityArtifactsFromFiles();
  const parkContext = parkContextFor(
    observation,
    artifacts.terminalOutcome.categories,
  );
  const bullpenOverride = contrastingBullpenOverride(
    artifacts.terminalOutcome.categories,
  );

  const genericNoPark = buildFrozenBatterHitsRuntimeDistribution(
    offer,
    observation,
    artifacts,
  );
  const genericPark = buildFrozenBatterHitsRuntimeDistribution(
    offer,
    observation,
    artifacts,
    parkContext,
  );
  const contrastNoPark = buildFrozenBatterHitsRuntimeDistribution(
    offer,
    observation,
    artifacts,
    { bullpenOverrideByHand: bullpenOverride },
  );
  const contrastPark = buildFrozenBatterHitsRuntimeDistribution(
    offer,
    observation,
    artifacts,
    {
      bullpenOverrideByHand: bullpenOverride,
      parkMultipliersByCategory: parkContext.parkMultipliersByCategory,
    },
  );

  const genericNoParkScenario = scenarioAt(genericNoPark, 0);
  const genericParkScenario = scenarioAt(genericPark, 0);
  const contrastNoParkScenario = scenarioAt(contrastNoPark, 0);
  const contrastParkScenario = scenarioAt(contrastPark, 0);

  const firstGenericNoPark = genericNoParkScenario.perOpportunityHitProbabilities[0];
  const firstGenericPark = genericParkScenario.perOpportunityHitProbabilities[0];
  const firstContrastNoPark = contrastNoParkScenario.perOpportunityHitProbabilities[0];
  assert.ok(firstGenericNoPark !== undefined);
  assert.ok(firstGenericPark !== undefined);
  assert.ok(firstContrastNoPark !== undefined);
  assert.ok(Math.abs(firstGenericNoPark - firstContrastNoPark) <= 1e-15);
  assert.ok(Math.abs(firstGenericPark - firstGenericNoPark) > 1e-12);

  const lateIndex =
    Math.min(
      genericNoParkScenario.perOpportunityHitProbabilities.length,
      genericParkScenario.perOpportunityHitProbabilities.length,
      contrastNoParkScenario.perOpportunityHitProbabilities.length,
      contrastParkScenario.perOpportunityHitProbabilities.length,
    ) - 1;
  assert.ok(lateIndex >= 2);

  const genericNoParkLate =
    genericNoParkScenario.perOpportunityHitProbabilities[lateIndex];
  const genericParkLate =
    genericParkScenario.perOpportunityHitProbabilities[lateIndex];
  const contrastNoParkLate =
    contrastNoParkScenario.perOpportunityHitProbabilities[lateIndex];
  const contrastParkLate =
    contrastParkScenario.perOpportunityHitProbabilities[lateIndex];
  assert.ok(genericNoParkLate !== undefined);
  assert.ok(genericParkLate !== undefined);
  assert.ok(contrastNoParkLate !== undefined);
  assert.ok(contrastParkLate !== undefined);
  assert.ok(Math.abs(genericNoParkLate - contrastNoParkLate) > 1e-6);

  const genericParkDelta = genericParkLate - genericNoParkLate;
  const contrastParkDelta = contrastParkLate - contrastNoParkLate;
  assert.ok(Math.abs(genericParkDelta - contrastParkDelta) > 1e-10);
});

test('an unknown venue fails closed', async () => {
  const offer = firstBaselineHalfHitOffer();
  const observation = observationFor(offer);
  const artifacts = await loadFrozenBatterHitsProbabilityArtifactsFromFiles();

  assert.throws(
    () =>
      projectM8_5ParkMultipliersToModeledCategoriesV1(
        resolveM8_5ParkTransformationV1(readJson(PARK_ARTIFACT_PATH), {
          venue: 'Unknown Park',
          batterHand: observation.batterSide,
        }),
        artifacts.terminalOutcome.categories,
      ),
    /has no effect/u,
  );
});

test('a non-identity multiplier on an omitted category fails closed', async () => {
  const offer = firstBaselineHalfHitOffer();
  const observation = observationFor(offer);
  const artifacts = await loadFrozenBatterHitsProbabilityArtifactsFromFiles();
  const resolution = parkResolutionFor(observation);
  const nonIdentityOmitted = {
    ...resolution,
    relativeRateMultipliers: resolution.relativeRateMultipliers.map((entry) =>
      entry.category === 'OTHER_PA'
        ? { ...entry, multiplier: 1.01 }
        : entry,
    ),
  } as M8_5ParkTransformationResolutionV1;

  assert.throws(
    () =>
      projectM8_5ParkMultipliersToModeledCategoriesV1(
        nonIdentityOmitted,
        artifacts.terminalOutcome.categories,
      ),
    /omitted category OTHER_PA must be exactly identity/u,
  );
});
