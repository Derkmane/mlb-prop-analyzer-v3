import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';

import { loadFrozenBatterHitsProbabilityArtifactsFromFiles } from '../src/adapters/index.js';
import { connectPregameBatterHitsBoard } from '../src/composition/index.js';
import {
  buildFrozenBatterHitsRuntimeDistribution,
  buildM8_5GameOffensiveEnvironmentRuntimeV1,
  createM8BatterHitsBaseDistribution,
  createM8_5FinalEvaluationV1,
  settleM8BatterHitsBaseOffer,
  type BatterHitsPlayerIdentity,
  type ConfirmedBatterHitsRuntimeObservation,
  type FrozenBatterHitsProbabilityArtifacts,
  type M8_5GameOffensiveEnvironmentModelArtifactV1,
  type NormalizedBatterHitsBoardOffer,
  type ResolveM8_5GameOffensiveEnvironmentV1Input,
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
const GAME_ENVIRONMENT_MODEL_PATH = path.resolve(
  'model-artifacts/m8-5-game-offensive-environment-model-v1.json',
);

const BOARD_SOURCE_SNAPSHOT_SHA256 =
  '250c1b9c02bb1334c0dce563d14194cabc404dbb48da08a9d49fcd3f457b7db7';
const GAME_SOURCE_SNAPSHOT_SHA256 =
  'f794c97cda6ad78e239c2b6efc9efd64ae2414a9c627672d9db166f7b05a3185';
const LINEUP_SOURCE_SNAPSHOT_SHA256 =
  'e22f4601fd95c74f2cb692f9f3db322f6a43c3f2b26026bcc23311e3c40ca7cd';
const SOURCE_CAPTURED_AT = '2026-07-23T15:12:25.190Z';
const MATCHED_GAME_ID = 5059315;
const CONTEXT_MODEL_VERSION = 'm8-5-batter-hits-context-v1';

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

function readJson(filePath: string): unknown {
  return JSON.parse(fs.readFileSync(filePath, 'utf8')) as unknown;
}

function resolvedIdentities(): BatterHitsPlayerIdentity[] {
  const linkage = readJson(LINKAGE_FIXTURE_PATH) as LinkageFixture;
  return linkage.matches.flatMap((record) => {
    const match = record.matches[0];
    if (record.matchCount !== 1 || record.matches.length !== 1 || match === undefined) {
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

function observationFor(
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

function baselineOffer(): NormalizedBatterHitsBoardOffer {
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

function gameEnvironmentModel(): M8_5GameOffensiveEnvironmentModelArtifactV1 {
  return readJson(
    GAME_ENVIRONMENT_MODEL_PATH,
  ) as M8_5GameOffensiveEnvironmentModelArtifactV1;
}

function resolutionInputFor(
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

function alternateOffer(
  source: NormalizedBatterHitsBoardOffer,
): NormalizedBatterHitsBoardOffer {
  return Object.freeze({
    ...source,
    providerMarketKey: 'batter_hits_alternate',
    offerType: 'alternate',
    selectedSide: 'lower',
    rawSide: 'Under',
    line: 1.5,
  });
}

function probabilityMass(distribution: { readonly probabilities: readonly number[] }): number {
  return distribution.probabilities.reduce(
    (sum, probability) => sum + probability,
    0,
  );
}

test('validated game-specific weights preserve one shared scenario set and jointly move opportunity and Hits mixtures', async () => {
  const offer = baselineOffer();
  const observation = observationFor(offer);
  const artifacts = await loadFrozenBatterHitsProbabilityArtifactsFromFiles();
  const model = gameEnvironmentModel();
  const resolutionInput = resolutionInputFor(offer, artifacts, model);

  const frozen = buildFrozenBatterHitsRuntimeDistribution(
    offer,
    observation,
    artifacts,
  );
  const adjusted = buildM8_5GameOffensiveEnvironmentRuntimeV1({
    offer,
    observation,
    artifacts,
    rawModelArtifact: model,
    resolutionInput,
  });
  const adjustedAgain = buildM8_5GameOffensiveEnvironmentRuntimeV1({
    offer,
    observation,
    artifacts,
    rawModelArtifact: model,
    resolutionInput,
  });

  assert.equal(adjusted.productionEnabled, false);
  assert.equal(adjusted.resolution.factorKey, 'gameSpecificOffensiveEnvironment');
  assert.notDeepEqual(
    adjusted.distribution.scenarios.map((scenario) => scenario.weight),
    frozen.scenarios.map((scenario) => scenario.weight),
  );
  assert.deepEqual(
    adjusted.distribution.scenarios.map((scenario) => scenario.weight),
    adjusted.resolution.scenarioWeights.map((entry) => entry.weight),
  );
  assert.equal(adjusted.distribution.scenarios.length, frozen.scenarios.length);
  adjusted.distribution.scenarios.forEach((scenario, index) => {
    const frozenScenario = frozen.scenarios[index];
    assert.ok(frozenScenario);
    assert.equal(scenario.scenarioIndex, frozenScenario.scenarioIndex);
    assert.deepEqual(
      scenario.opportunityCountDistribution,
      frozenScenario.opportunityCountDistribution,
    );
    assert.deepEqual(
      scenario.perOpportunityHitProbabilities,
      frozenScenario.perOpportunityHitProbabilities,
    );
    assert.deepEqual(scenario.hitDistribution, frozenScenario.hitDistribution);
  });
  assert.notDeepEqual(
    adjusted.distribution.opportunityDistribution,
    frozen.opportunityDistribution,
  );
  assert.notDeepEqual(
    adjusted.distribution.statisticDistribution,
    frozen.statisticDistribution,
  );
  assert.ok(
    Math.abs(probabilityMass(adjusted.distribution.opportunityDistribution) - 1) <=
      1e-12,
  );
  assert.ok(
    Math.abs(probabilityMass(adjusted.distribution.statisticDistribution) - 1) <=
      1e-12,
  );
  assert.deepEqual(adjustedAgain, adjusted);

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
  const finalEvaluation = createM8_5FinalEvaluationV1({
    sourceM8Evaluation,
    dFinal: adjusted.distribution,
    contextModelVersion: CONTEXT_MODEL_VERSION,
    factorArtifacts: [adjusted.resolution.factorArtifact],
  });
  assert.deepEqual(finalEvaluation.dFinal, adjusted.distribution);
  assert.deepEqual(finalEvaluation.factorReferences, [
    {
      factorKey: 'gameSpecificOffensiveEnvironment',
      modelVersion: adjusted.resolution.modelVersion,
      artifactSha256: adjusted.resolution.factorArtifact.artifactSha256,
      applicationStages:
        adjusted.resolution.factorArtifact.applicationStages,
    },
  ]);
  assert.equal(
    finalEvaluation.probabilities.contextProbabilityDelta,
    finalEvaluation.probabilities.pFinal! -
      finalEvaluation.probabilities.pBase!,
  );
});

test('baseline Higher and alternate Lower reuse one identical game-adjusted D_final', async () => {
  const higherOffer = baselineOffer();
  const lowerOffer = alternateOffer(higherOffer);
  const observation = observationFor(higherOffer);
  const artifacts = await loadFrozenBatterHitsProbabilityArtifactsFromFiles();
  const model = gameEnvironmentModel();
  const resolutionInput = resolutionInputFor(higherOffer, artifacts, model);

  const higher = buildM8_5GameOffensiveEnvironmentRuntimeV1({
    offer: higherOffer,
    observation,
    artifacts,
    rawModelArtifact: model,
    resolutionInput,
  });
  const lower = buildM8_5GameOffensiveEnvironmentRuntimeV1({
    offer: lowerOffer,
    observation,
    artifacts,
    rawModelArtifact: model,
    resolutionInput,
  });

  assert.deepEqual(lower.distribution, higher.distribution);
  assert.deepEqual(lower.resolution, higher.resolution);
  assert.equal(Object.hasOwn(resolutionInput, 'selectedSide'), false);
  assert.equal(Object.hasOwn(resolutionInput, 'line'), false);
});

test('game-specific runtime composition fails closed on side input, game drift, scenario drift, source drift, and artifact drift', async () => {
  const offer = baselineOffer();
  const observation = observationFor(offer);
  const artifacts = await loadFrozenBatterHitsProbabilityArtifactsFromFiles();
  const model = gameEnvironmentModel();
  const resolutionInput = resolutionInputFor(offer, artifacts, model);
  const build = (rawModelArtifact: unknown, rawResolutionInput: unknown) =>
    buildM8_5GameOffensiveEnvironmentRuntimeV1({
      offer,
      observation,
      artifacts,
      rawModelArtifact,
      resolutionInput:
        rawResolutionInput as ResolveM8_5GameOffensiveEnvironmentV1Input,
    });

  assert.throws(
    () =>
      build(model, {
        ...resolutionInput,
        selectedSide: 'higher',
      }),
    /unexpected field selectedSide/u,
  );
  assert.throws(
    () =>
      build(model, {
        ...resolutionInput,
        gameId: String(offer.providerGameId + 1),
      }),
    /runtime game ID/u,
  );
  assert.throws(
    () =>
      build(model, {
        ...resolutionInput,
        scenarioIds: [...resolutionInput.scenarioIds].reverse(),
      }),
    /scenarioIds does not match/u,
  );
  assert.throws(
    () =>
      build(model, {
        ...resolutionInput,
        sourceSharedEnvironmentArtifactSha256: '0'.repeat(64),
      }),
    /artifact SHA-256 does not match/u,
  );
  assert.throws(
    () =>
      build(
        {
          ...model,
          artifactSha256: '0'.repeat(64),
        },
        resolutionInput,
      ),
    /model artifact SHA-256 is invalid/u,
  );
});