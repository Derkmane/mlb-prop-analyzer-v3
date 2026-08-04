import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';

import { loadFrozenBatterHitsProbabilityArtifactsFromFiles } from '../src/adapters/index.js';
import { connectPregameBatterHitsBoard } from '../src/composition/index.js';
import {
  mixBernoulliOutcomesOverCountDistribution,
  mixProbabilityMassFunctions,
} from '../src/core/index.js';
import {
  buildM8_5ValidatedFinalDistributionV1,
  createM8BatterHitsBaseDistribution,
  createM8_5FinalDistributionV1,
  settleM8BatterHitsBaseOffer,
  settleM8_5FinalOfferV1,
  verifyM8_5BatterHitsFactorArtifactV1,
  verifyM8_5ParkFactorArtifactV1,
  type BatterHitsPlayerIdentity,
  type ConfirmedBatterHitsRuntimeObservation,
  type FrozenBatterHitsProbabilityArtifacts,
  type FrozenBatterHitsRuntimeDistribution,
  type M8_5FinalDistributionV1,
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
const SETTLEMENT_LINE = 0.5;
const TOLERANCE = 1e-12;

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
    if (
      record.matchCount !== 1 ||
      record.matches.length !== 1 ||
      match === undefined
    ) {
      return [];
    }
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
      candidate.line === SETTLEMENT_LINE &&
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

function offerForSide(
  source: NormalizedBatterHitsBoardOffer,
  selectedSide: 'higher' | 'lower',
): NormalizedBatterHitsBoardOffer {
  return Object.freeze({
    ...source,
    selectedSide,
    rawSide: selectedSide === 'higher' ? 'Over' : 'Under',
    line: SETTLEMENT_LINE,
  });
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

function directionalShiftMagnitude(
  distribution: FrozenBatterHitsRuntimeDistribution,
): number {
  let minimumMargin = Number.POSITIVE_INFINITY;
  for (const scenario of distribution.scenarios) {
    for (const probability of scenario.perOpportunityHitProbabilities) {
      minimumMargin = Math.min(
        minimumMargin,
        probability,
        1 - probability,
      );
    }
  }
  assert.ok(Number.isFinite(minimumMargin) && minimumMargin > 0);
  return minimumMargin / 4;
}

function shiftHitDistribution(
  source: FrozenBatterHitsRuntimeDistribution,
  delta: number,
): FrozenBatterHitsRuntimeDistribution {
  assert.ok(Number.isFinite(delta) && delta !== 0);
  const scenarios = Object.freeze(
    source.scenarios.map((scenario) => {
      const perOpportunityHitProbabilities = Object.freeze(
        scenario.perOpportunityHitProbabilities.map((probability) => {
          const shifted = probability + delta;
          assert.ok(shifted > 0 && shifted < 1);
          return shifted;
        }),
      );
      return Object.freeze({
        ...scenario,
        perOpportunityHitProbabilities,
        hitDistribution: mixBernoulliOutcomesOverCountDistribution(
          scenario.opportunityCountDistribution,
          perOpportunityHitProbabilities,
        ),
      });
    }),
  );
  return Object.freeze({
    distributionBuilderVersion: source.distributionBuilderVersion,
    opportunityDistribution: source.opportunityDistribution,
    statisticDistribution: mixProbabilityMassFunctions(
      scenarios.map((scenario) => ({
        weight: scenario.weight,
        distribution: scenario.hitDistribution,
      })),
    ),
    scenarios,
  });
}

function tailProbability(
  distribution: FrozenBatterHitsRuntimeDistribution['statisticDistribution'],
  threshold: number,
): number {
  return distribution.probabilities.reduce(
    (sum, probability, value) =>
      value > threshold ? sum + probability : sum,
    0,
  );
}

function requiredProbability(value: number | null, label: string): number {
  assert.notEqual(value, null, `${label} must be rankable`);
  return value;
}

function settleBothSides(
  finalDistribution: M8_5FinalDistributionV1,
  sourceBaseDistribution: Awaited<
    ReturnType<typeof compositionInputs>
  >['sourceBaseDistribution'],
  offer: NormalizedBatterHitsBoardOffer,
) {
  const higherBase = settleM8BatterHitsBaseOffer(
    sourceBaseDistribution,
    offerForSide(offer, 'higher'),
  );
  const lowerBase = settleM8BatterHitsBaseOffer(
    sourceBaseDistribution,
    offerForSide(offer, 'lower'),
  );
  return Object.freeze({
    higher: settleM8_5FinalOfferV1({
      sourceM8Evaluation: higherBase,
      finalDistribution,
    }),
    lower: settleM8_5FinalOfferV1({
      sourceM8Evaluation: lowerBase,
      finalDistribution,
    }),
  });
}

test('composed D_final obeys upward and downward side direction with no side-independent booster', async () => {
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

  const teamArtifact = verifyM8_5BatterHitsFactorArtifactV1(
    inputs.teamArtifact,
  );
  const parkArtifact = verifyM8_5ParkFactorArtifactV1(inputs.parkArtifact);
  const factorArtifacts = Object.freeze([
    composed.gameEnvironmentResolution.factorArtifact,
    teamArtifact,
    parkArtifact.typedFactorArtifact,
  ]);
  const shiftMagnitude = directionalShiftMagnitude(
    composed.finalDistribution.dFinal,
  );
  const upwardRuntimeDistribution = shiftHitDistribution(
    composed.finalDistribution.dFinal,
    shiftMagnitude,
  );
  const downwardRuntimeDistribution = shiftHitDistribution(
    composed.finalDistribution.dFinal,
    -shiftMagnitude,
  );

  const upwardFinalDistribution = createM8_5FinalDistributionV1({
    sourceBaseDistribution: inputs.sourceBaseDistribution,
    dFinal: upwardRuntimeDistribution,
    contextModelVersion: composed.contextModelVersion,
    factorArtifacts,
  });
  const downwardFinalDistribution = createM8_5FinalDistributionV1({
    sourceBaseDistribution: inputs.sourceBaseDistribution,
    dFinal: downwardRuntimeDistribution,
    contextModelVersion: composed.contextModelVersion,
    factorArtifacts,
  });

  for (
    let threshold = 0;
    threshold <
    composed.finalDistribution.dFinal.statisticDistribution.probabilities.length -
      1;
    threshold += 1
  ) {
    const upwardTail = tailProbability(
      upwardRuntimeDistribution.statisticDistribution,
      threshold,
    );
    const neutralTail = tailProbability(
      composed.finalDistribution.dFinal.statisticDistribution,
      threshold,
    );
    const downwardTail = tailProbability(
      downwardRuntimeDistribution.statisticDistribution,
      threshold,
    );
    assert.ok(upwardTail + TOLERANCE >= neutralTail);
    assert.ok(neutralTail + TOLERANCE >= downwardTail);
  }

  const upward = settleBothSides(
    upwardFinalDistribution,
    inputs.sourceBaseDistribution,
    inputs.offer,
  );
  const neutral = settleBothSides(
    composed.finalDistribution,
    inputs.sourceBaseDistribution,
    inputs.offer,
  );
  const downward = settleBothSides(
    downwardFinalDistribution,
    inputs.sourceBaseDistribution,
    inputs.offer,
  );

  const upwardHigher = requiredProbability(
    upward.higher.probabilities.pFinal,
    'upward Higher p_final',
  );
  const neutralHigher = requiredProbability(
    neutral.higher.probabilities.pFinal,
    'neutral Higher p_final',
  );
  const downwardHigher = requiredProbability(
    downward.higher.probabilities.pFinal,
    'downward Higher p_final',
  );
  const upwardLower = requiredProbability(
    upward.lower.probabilities.pFinal,
    'upward Lower p_final',
  );
  const neutralLower = requiredProbability(
    neutral.lower.probabilities.pFinal,
    'neutral Lower p_final',
  );
  const downwardLower = requiredProbability(
    downward.lower.probabilities.pFinal,
    'downward Lower p_final',
  );

  assert.ok(upwardHigher > neutralHigher);
  assert.ok(neutralHigher > downwardHigher);
  assert.ok(upwardLower < neutralLower);
  assert.ok(neutralLower < downwardLower);

  for (const pair of [upward, neutral, downward]) {
    assert.equal(
      pair.higher.probabilities.pWin,
      pair.lower.probabilities.pLoss,
    );
    assert.equal(
      pair.higher.probabilities.pLoss,
      pair.lower.probabilities.pWin,
    );
    assert.equal(
      pair.higher.probabilities.pVoid,
      pair.lower.probabilities.pVoid,
    );
    assert.equal(pair.higher.probabilities.pVoid, 0);
    assert.strictEqual(
      pair.higher.finalDistribution,
      pair.lower.finalDistribution,
    );
    assert.strictEqual(pair.higher.dFinal, pair.lower.dFinal);
  }

  const upwardHigherDelta = requiredProbability(
    upward.higher.probabilities.contextProbabilityDelta,
    'upward Higher context delta',
  );
  const neutralHigherDelta = requiredProbability(
    neutral.higher.probabilities.contextProbabilityDelta,
    'neutral Higher context delta',
  );
  const downwardHigherDelta = requiredProbability(
    downward.higher.probabilities.contextProbabilityDelta,
    'downward Higher context delta',
  );
  const upwardLowerDelta = requiredProbability(
    upward.lower.probabilities.contextProbabilityDelta,
    'upward Lower context delta',
  );
  const neutralLowerDelta = requiredProbability(
    neutral.lower.probabilities.contextProbabilityDelta,
    'neutral Lower context delta',
  );
  const downwardLowerDelta = requiredProbability(
    downward.lower.probabilities.contextProbabilityDelta,
    'downward Lower context delta',
  );

  assert.ok(upwardHigherDelta > neutralHigherDelta);
  assert.ok(neutralHigherDelta > downwardHigherDelta);
  assert.ok(upwardLowerDelta < neutralLowerDelta);
  assert.ok(neutralLowerDelta < downwardLowerDelta);

  assert.deepEqual(
    upwardFinalDistribution.factorReferences,
    composed.finalDistribution.factorReferences,
  );
  assert.deepEqual(
    downwardFinalDistribution.factorReferences,
    composed.finalDistribution.factorReferences,
  );
  assert.equal(
    upwardFinalDistribution.sourceBaseDistributionSha256,
    composed.finalDistribution.sourceBaseDistributionSha256,
  );
  assert.equal(
    downwardFinalDistribution.sourceBaseDistributionSha256,
    composed.finalDistribution.sourceBaseDistributionSha256,
  );
  assert.equal(
    upwardFinalDistribution.sharedScenarioIdentity,
    composed.finalDistribution.sharedScenarioIdentity,
  );
  assert.equal(
    downwardFinalDistribution.sharedScenarioIdentity,
    composed.finalDistribution.sharedScenarioIdentity,
  );
  assert.notEqual(
    upwardFinalDistribution.finalDistributionSha256,
    composed.finalDistribution.finalDistributionSha256,
  );
  assert.notEqual(
    downwardFinalDistribution.finalDistributionSha256,
    composed.finalDistribution.finalDistributionSha256,
  );
  assert.notEqual(
    upwardFinalDistribution.finalDistributionSha256,
    downwardFinalDistribution.finalDistributionSha256,
  );
});
