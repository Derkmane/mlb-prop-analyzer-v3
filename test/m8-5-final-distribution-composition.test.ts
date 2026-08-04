import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';

import { loadFrozenBatterHitsProbabilityArtifactsFromFiles } from '../src/adapters/index.js';
import { connectPregameBatterHitsBoard } from '../src/composition/index.js';
import {
  M8_5_BATTER_HITS_CONTEXT_MODEL_VERSION,
  M8_5_BATTER_HITS_VALIDATED_COMPOSITION_ORDER,
  buildM8_5GameOffensiveEnvironmentRuntimeV1,
  buildM8_5ValidatedFinalDistributionV1,
  createM8BatterHitsBaseDistribution,
  createValidatedM8_5BatterHitsFactorArtifactV1,
  projectM8_5ParkMultipliersToModeledCategoriesV1,
  resolveM8_5ParkTransformationV1,
  resolveM8_5TeamBullpenOutcomeV1,
  settleM8BatterHitsBaseOffer,
  settleM8_5FinalOfferV1,
  verifyM8_5BatterHitsFactorArtifactV1,
  verifyM8_5FinalDistributionV1,
  verifyM8_5ParkFactorArtifactV1,
  type BatterHitsPlayerIdentity,
  type ConfirmedBatterHitsRuntimeObservation,
  type FrozenBatterHitsProbabilityArtifacts,
  type M8_5BatterHitsFactorArtifactV1,
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
const TEAM_BULLPEN_ARTIFACT_PATH = path.resolve(
  'model-artifacts/m8-5-team-bullpen-outcome-v1.json',
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
  assert.ok(typeof game.venue === 'string');
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

function gameEnvironmentResolutionInput(
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

function offerAt(
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

function probabilityMass(distribution: {
  readonly probabilities: readonly number[];
}): number {
  return distribution.probabilities.reduce(
    (sum, probability) => sum + probability,
    0,
  );
}

function bullpenOverride(
  rawArtifact: unknown,
  teamId: number,
  modeledCategories: readonly string[],
): Readonly<Record<Hand, Readonly<Record<string, number>>>> {
  const artifact = verifyM8_5BatterHitsFactorArtifactV1(rawArtifact);
  const vectors = {} as Record<Hand, Readonly<Record<string, number>>>;
  const modeled = new Set(modeledCategories);
  for (const hand of ['L', 'R'] as const) {
    const resolution = resolveM8_5TeamBullpenOutcomeV1(artifact, {
      opposingPitchingTeamId: teamId,
      bullpenPitcherHand: hand,
    });
    assert.equal(resolution.status, 'validated');
    if (resolution.status !== 'validated') {
      throw new Error('fixture team bullpen resolution must be validated.');
    }
    const vector: Record<string, number> = {};
    for (const entry of resolution.categoryProbabilities) {
      if (!modeled.has(entry.category)) {
        assert.equal(entry.probability, 0);
      }
    }
    for (const category of modeledCategories) {
      const entry = resolution.categoryProbabilities.find(
        (candidate) => candidate.category === category,
      );
      assert.ok(entry);
      vector[category] = entry.probability;
    }
    vectors[hand] = Object.freeze(vector);
  }
  return Object.freeze(vectors);
}

async function compositionInputs() {
  const offer = baselineOffer();
  const observation = observationFor(offer);
  const artifacts = await loadFrozenBatterHitsProbabilityArtifactsFromFiles();
  const sourceBaseDistribution = createM8BatterHitsBaseDistribution(
    offer,
    observation,
    artifacts,
    SOURCE_CAPTURED_AT,
  );
  const gameModel = readJson(
    GAME_ENVIRONMENT_MODEL_PATH,
  ) as M8_5GameOffensiveEnvironmentModelArtifactV1;
  return {
    offer,
    observation,
    artifacts,
    sourceBaseDistribution,
    gameModel,
    gameResolutionInput: gameEnvironmentResolutionInput(
      offer,
      artifacts,
      gameModel,
    ),
    teamArtifact: readJson(TEAM_BULLPEN_ARTIFACT_PATH),
    parkArtifact: readJson(PARK_ARTIFACT_PATH),
  };
}

test('canonical M8.5 composition applies game environment, bullpen replacement, and park transformation exactly once', async () => {
  const inputs = await compositionInputs();
  const composed = buildM8_5ValidatedFinalDistributionV1({
    sourceBaseDistribution: inputs.sourceBaseDistribution,
    offer: inputs.offer,
    observation: inputs.observation,
    artifacts: inputs.artifacts,
    rawGameEnvironmentModelArtifact: inputs.gameModel,
    gameEnvironmentResolutionInput: inputs.gameResolutionInput,
    rawTeamBullpenFactorArtifact: inputs.teamArtifact,
    rawParkFactorArtifact: inputs.parkArtifact,
  });
  const composedAgain = buildM8_5ValidatedFinalDistributionV1({
    sourceBaseDistribution: inputs.sourceBaseDistribution,
    offer: inputs.offer,
    observation: inputs.observation,
    artifacts: inputs.artifacts,
    rawGameEnvironmentModelArtifact: inputs.gameModel,
    gameEnvironmentResolutionInput: inputs.gameResolutionInput,
    rawTeamBullpenFactorArtifact: inputs.teamArtifact,
    rawParkFactorArtifact: inputs.parkArtifact,
  });

  const teamArtifact = verifyM8_5BatterHitsFactorArtifactV1(
    inputs.teamArtifact,
  );
  const parkArtifact = verifyM8_5ParkFactorArtifactV1(inputs.parkArtifact);
  const parkResolution = resolveM8_5ParkTransformationV1(parkArtifact, {
    venue: inputs.observation.venue,
    batterHand: inputs.observation.batterSide,
  });
  const parkMultipliers =
    projectM8_5ParkMultipliersToModeledCategoriesV1(
      parkResolution,
      inputs.artifacts.terminalOutcome.categories,
    );
  const bullpen = bullpenOverride(
    teamArtifact,
    inputs.observation.opposingStarterTeamId,
    inputs.artifacts.terminalOutcome.categories,
  );
  const manual = buildM8_5GameOffensiveEnvironmentRuntimeV1({
    offer: inputs.offer,
    observation: inputs.observation,
    artifacts: inputs.artifacts,
    rawModelArtifact: inputs.gameModel,
    resolutionInput: inputs.gameResolutionInput,
    contextFactors: {
      bullpenOverrideByHand: bullpen,
      parkMultipliersByCategory: parkMultipliers,
    },
  });

  assert.deepEqual(
    composed.applicationOrder,
    M8_5_BATTER_HITS_VALIDATED_COMPOSITION_ORDER,
  );
  assert.equal(
    composed.contextModelVersion,
    M8_5_BATTER_HITS_CONTEXT_MODEL_VERSION,
  );
  assert.deepEqual(composed.finalDistribution.dFinal, manual.distribution);
  assert.deepEqual(composed, composedAgain);
  assert.deepEqual(
    composed.finalDistribution.factorReferences.map(
      (reference) => reference.factorKey,
    ),
    ['teamSpecificBullpen', 'gameSpecificOffensiveEnvironment', 'park'],
  );
  const references = new Map(
    composed.finalDistribution.factorReferences.map((reference) => [
      reference.factorKey,
      reference,
    ]),
  );
  assert.equal(
    references.get('gameSpecificOffensiveEnvironment')?.artifactSha256,
    composed.gameEnvironmentResolution.factorArtifact.artifactSha256,
  );
  assert.equal(
    references.get('teamSpecificBullpen')?.artifactSha256,
    teamArtifact.artifactSha256,
  );
  assert.equal(
    references.get('park')?.artifactSha256,
    parkArtifact.typedFactorArtifact.artifactSha256,
  );
  assert.deepEqual(
    composed.finalDistribution.dFinal.scenarios.map((scenario) => scenario.weight),
    composed.gameEnvironmentResolution.scenarioWeights.map((entry) => entry.weight),
  );
  composed.finalDistribution.dFinal.scenarios.forEach((scenario, index) => {
    assert.deepEqual(
      scenario.opportunityCountDistribution,
      inputs.sourceBaseDistribution.dBase.scenarios[index]
        ?.opportunityCountDistribution,
    );
  });
  assert.ok(
    composed.finalDistribution.dFinal.scenarios.some(
      (scenario, index) =>
        JSON.stringify(scenario.hitDistribution) !==
        JSON.stringify(
          inputs.sourceBaseDistribution.dBase.scenarios[index]?.hitDistribution,
        ),
    ),
  );
  assert.notDeepEqual(
    composed.finalDistribution.dFinal.opportunityDistribution,
    inputs.sourceBaseDistribution.dBase.opportunityDistribution,
  );
  assert.notDeepEqual(
    composed.finalDistribution.dFinal.statisticDistribution,
    inputs.sourceBaseDistribution.dBase.statisticDistribution,
  );
  assert.ok(
    Math.abs(
      probabilityMass(
        composed.finalDistribution.dFinal.opportunityDistribution,
      ) - 1,
    ) <= 1e-12,
  );
  assert.ok(
    Math.abs(
      probabilityMass(composed.finalDistribution.dFinal.statisticDistribution) -
        1,
    ) <= 1e-12,
  );
  assert.deepEqual(
    verifyM8_5FinalDistributionV1(composed.finalDistribution),
    composed.finalDistribution,
  );

  const doubledPark = Object.freeze(
    Object.fromEntries(
      Object.entries(parkMultipliers).map(([category, multiplier]) => [
        category,
        multiplier ** 2,
      ]),
    ),
  );
  const incorrectlyDoubled = buildM8_5GameOffensiveEnvironmentRuntimeV1({
    offer: inputs.offer,
    observation: inputs.observation,
    artifacts: inputs.artifacts,
    rawModelArtifact: inputs.gameModel,
    resolutionInput: inputs.gameResolutionInput,
    contextFactors: {
      bullpenOverrideByHand: bullpen,
      parkMultipliersByCategory: doubledPark,
    },
  });
  assert.notDeepEqual(
    composed.finalDistribution.dFinal.statisticDistribution,
    incorrectlyDoubled.distribution.statisticDistribution,
  );
});

test('one canonical composed D_final is independent of posted side and line and settles Higher or Lower exactly', async () => {
  const inputs = await compositionInputs();
  const composed = buildM8_5ValidatedFinalDistributionV1({
    sourceBaseDistribution: inputs.sourceBaseDistribution,
    offer: inputs.offer,
    observation: inputs.observation,
    artifacts: inputs.artifacts,
    rawGameEnvironmentModelArtifact: inputs.gameModel,
    gameEnvironmentResolutionInput: inputs.gameResolutionInput,
    rawTeamBullpenFactorArtifact: inputs.teamArtifact,
    rawParkFactorArtifact: inputs.parkArtifact,
  });
  const higherOffer = offerAt(inputs.offer, 'higher', 1.5);
  const lowerOffer = offerAt(inputs.offer, 'lower', 1.5);
  const higherBase = settleM8BatterHitsBaseOffer(
    inputs.sourceBaseDistribution,
    higherOffer,
  );
  const lowerBase = settleM8BatterHitsBaseOffer(
    inputs.sourceBaseDistribution,
    lowerOffer,
  );
  const higherFinal = settleM8_5FinalOfferV1({
    sourceM8Evaluation: higherBase,
    finalDistribution: composed.finalDistribution,
  });
  const lowerFinal = settleM8_5FinalOfferV1({
    sourceM8Evaluation: lowerBase,
    finalDistribution: composed.finalDistribution,
  });

  assert.strictEqual(higherFinal.finalDistribution, composed.finalDistribution);
  assert.strictEqual(lowerFinal.finalDistribution, composed.finalDistribution);
  assert.strictEqual(higherFinal.dFinal, composed.finalDistribution.dFinal);
  assert.strictEqual(lowerFinal.dFinal, composed.finalDistribution.dFinal);
  assert.equal(higherFinal.probabilities.pWin, lowerFinal.probabilities.pLoss);
  assert.equal(higherFinal.probabilities.pLoss, lowerFinal.probabilities.pWin);
  assert.equal(higherFinal.probabilities.pVoid, lowerFinal.probabilities.pVoid);

  const lowerComposition = buildM8_5ValidatedFinalDistributionV1({
    sourceBaseDistribution: inputs.sourceBaseDistribution,
    offer: lowerOffer,
    observation: inputs.observation,
    artifacts: inputs.artifacts,
    rawGameEnvironmentModelArtifact: inputs.gameModel,
    gameEnvironmentResolutionInput: inputs.gameResolutionInput,
    rawTeamBullpenFactorArtifact: inputs.teamArtifact,
    rawParkFactorArtifact: inputs.parkArtifact,
  });
  assert.equal(
    lowerComposition.finalDistribution.finalDistributionSha256,
    composed.finalDistribution.finalDistributionSha256,
  );
  assert.deepEqual(
    lowerComposition.finalDistribution.dFinal,
    composed.finalDistribution.dFinal,
  );
});

test('canonical composition fails closed on source drift, side input, unknown venue, artifact drift, and omitted-category bullpen mass', async () => {
  const inputs = await compositionInputs();
  const build = (overrides: Partial<{
    observation: ConfirmedBatterHitsRuntimeObservation;
    gameResolutionInput: ResolveM8_5GameOffensiveEnvironmentV1Input;
    teamArtifact: unknown;
    parkArtifact: unknown;
  }> = {}) =>
    buildM8_5ValidatedFinalDistributionV1({
      sourceBaseDistribution: inputs.sourceBaseDistribution,
      offer: inputs.offer,
      observation: overrides.observation ?? inputs.observation,
      artifacts: inputs.artifacts,
      rawGameEnvironmentModelArtifact: inputs.gameModel,
      gameEnvironmentResolutionInput:
        overrides.gameResolutionInput ?? inputs.gameResolutionInput,
      rawTeamBullpenFactorArtifact:
        overrides.teamArtifact ?? inputs.teamArtifact,
      rawParkFactorArtifact: overrides.parkArtifact ?? inputs.parkArtifact,
    });

  assert.throws(
    () =>
      build({
        observation: Object.freeze({
          ...inputs.observation,
          lineupSlot: (inputs.observation.lineupSlot === 9
            ? 8
            : inputs.observation.lineupSlot +
              1) as ConfirmedBatterHitsRuntimeObservation['lineupSlot'],
        }),
      }),
    /source D_base SHA-256/u,
  );

  assert.throws(
    () =>
      build({
        gameResolutionInput: Object.freeze({
          ...inputs.gameResolutionInput,
          selectedSide: 'higher',
        }) as unknown as ResolveM8_5GameOffensiveEnvironmentV1Input,
      }),
    /unexpected field selectedSide/u,
  );

  assert.throws(
    () =>
      build({
        observation: Object.freeze({
          ...inputs.observation,
          venue: 'Unknown Exact Provider Venue',
        }),
      }),
    /park artifact has no effect/u,
  );

  assert.throws(
    () =>
      build({
        parkArtifact: {
          ...(inputs.parkArtifact as Record<string, unknown>),
          parkArtifactSha256: '0'.repeat(64),
        },
      }),
    /parkArtifactSha256/u,
  );

  const originalTeamArtifact = verifyM8_5BatterHitsFactorArtifactV1(
    inputs.teamArtifact,
  );
  assert.ok(originalTeamArtifact.validationEvidence !== null);
  const targetMatchup =
    `pitching-team:${inputs.observation.opposingStarterTeamId}|pitcher-hand:L`;
  const boundaryEffects = originalTeamArtifact.effects.map((effect) => {
    if (
      effect.kind !== 'terminal-outcome-vector' ||
      effect.matchupKey !== targetMatchup
    ) {
      return effect;
    }
    const epsilon = 1e-6;
    const donor = effect.categoryProbabilities.find(
      (entry) => entry.category === 'BIP_OUT',
    );
    assert.ok(donor && donor.probability > epsilon);
    return Object.freeze({
      ...effect,
      categoryProbabilities: Object.freeze(
        effect.categoryProbabilities.map((entry) =>
          entry.category === 'OTHER_PA'
            ? Object.freeze({ ...entry, probability: epsilon })
            : entry.category === 'BIP_OUT'
              ? Object.freeze({
                  ...entry,
                  probability: entry.probability - epsilon,
                })
              : entry,
        ),
      ),
    });
  });
  const boundaryArtifact = createValidatedM8_5BatterHitsFactorArtifactV1({
    factorKey: 'teamSpecificBullpen',
    modelVersion: `${originalTeamArtifact.modelVersion}-omitted-category-test`,
    requiredInputs: originalTeamArtifact.requiredInputs,
    sourceEvidenceVersion: originalTeamArtifact.sourceEvidenceVersion,
    validationEvidence: originalTeamArtifact.validationEvidence,
    effects: boundaryEffects,
  });
  assert.throws(
    () => build({ teamArtifact: boundaryArtifact }),
    /omitted category OTHER_PA must be exactly zero/u,
  );
});
