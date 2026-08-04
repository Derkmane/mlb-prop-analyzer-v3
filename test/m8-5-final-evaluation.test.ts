import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';

import { loadFrozenBatterHitsProbabilityArtifactsFromFiles } from '../src/adapters/index.js';
import { connectPregameBatterHitsBoard } from '../src/composition/index.js';
import { settleDiscreteStatistic } from '../src/core/index.js';
import {
  buildFrozenBatterHitsRuntimeDistribution,
  createM8BatterHitsBaseDistribution,
  createM8_5FinalDistributionV1,
  createM8_5FinalEvaluationV1,
  projectM8_5ParkMultipliersToModeledCategoriesV1,
  resolveM8_5ParkTransformationV1,
  settleM8BatterHitsBaseOffer,
  settleM8_5FinalOfferV1,
  verifyM8_5FinalEvaluationV1,
  verifyM8_5ParkFactorArtifactV1,
  type BatterHitsPlayerIdentity,
  type ConfirmedBatterHitsRuntimeObservation,
  type M8BatterHitsBaseEvaluationV1,
  type M8_5FinalDistributionV1,
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

async function evaluationInputs() {
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
  const parkArtifact = verifyM8_5ParkFactorArtifactV1(
    readJson(PARK_ARTIFACT_PATH),
  );
  const parkResolution = resolveM8_5ParkTransformationV1(
    parkArtifact,
    {
      venue: observation.venue,
      batterHand: observation.batterSide,
    },
  );
  const dFinal = buildFrozenBatterHitsRuntimeDistribution(
    offer,
    observation,
    artifacts,
    {
      parkMultipliersByCategory:
        projectM8_5ParkMultipliersToModeledCategoriesV1(
          parkResolution,
          artifacts.terminalOutcome.categories,
        ),
    },
  );
  return {
    offer,
    sourceBaseDistribution,
    sourceM8Evaluation,
    dFinal,
    parkArtifact,
  };
}

function offerAt(
  source: NormalizedBatterHitsBoardOffer,
  selectedSide: 'higher' | 'lower',
  line: number,
): NormalizedBatterHitsBoardOffer {
  return Object.freeze({
    ...source,
    offerType: 'alternate',
    providerMarketKey: 'batter_hits_alternate',
    selectedSide,
    rawSide: selectedSide === 'higher' ? 'Over' : 'Under',
    line,
  });
}

test('M8.5 final evaluation preserves complete lineage and exact final settlement', async () => {
  const {
    sourceM8Evaluation,
    dFinal,
    parkArtifact,
  } = await evaluationInputs();

  const evaluation = createM8_5FinalEvaluationV1({
    sourceM8Evaluation,
    dFinal,
    contextModelVersion: CONTEXT_MODEL_VERSION,
    factorArtifacts: [parkArtifact.typedFactorArtifact],
  });
  const manual = settleDiscreteStatistic({
    statisticDistribution: dFinal.statisticDistribution,
    eligibilityProbability: 1,
    line: sourceM8Evaluation.offer.line,
    selectedSide: sourceM8Evaluation.offer.selectedSide,
  });

  assert.deepEqual(verifyM8_5FinalEvaluationV1(evaluation), evaluation);
  assert.equal(
    evaluation.sourceM8EvaluationSha256,
    sourceM8Evaluation.baseEvaluationSha256,
  );
  assert.equal(
    evaluation.baseDistributionSha256,
    sourceM8Evaluation.baseDistributionSha256,
  );
  assert.equal(
    evaluation.sharedScenarioIdentity,
    sourceM8Evaluation.sharedScenarioIdentity,
  );
  assert.equal(evaluation.contextModelVersion, CONTEXT_MODEL_VERSION);
  assert.equal(
    evaluation.settlementRuleVersion,
    sourceM8Evaluation.baseDistribution.versions.settlementRuleVersion,
  );
  assert.deepEqual(evaluation.factorReferences, [
    {
      factorKey: 'park',
      modelVersion: parkArtifact.typedFactorArtifact.modelVersion,
      artifactSha256: parkArtifact.typedFactorArtifact.artifactSha256,
      applicationStages:
        parkArtifact.typedFactorArtifact.applicationStages,
    },
  ]);
  assert.deepEqual(evaluation.dBase, sourceM8Evaluation.dBase);
  assert.deepEqual(evaluation.dFinal, dFinal);
  assert.notDeepEqual(evaluation.dFinal, evaluation.dBase);
  assert.deepEqual(evaluation.probabilities, {
    pWin: manual.winProbability,
    pLoss: manual.lossProbability,
    pVoid: manual.voidProbability,
    pBase: sourceM8Evaluation.probabilities.pBase,
    pFinal: manual.winProbabilityGivenGrades,
    contextProbabilityDelta:
      manual.winProbabilityGivenGrades! - sourceM8Evaluation.probabilities.pBase!,
  });
  assert.match(evaluation.finalDistributionSha256, /^[a-f0-9]{64}$/u);
  assert.match(evaluation.finalEvaluationSha256, /^[a-f0-9]{64}$/u);
  assert.equal(evaluation.productionEnabled, false);
  assert.equal(evaluation.hardDiscoveryFilterEnabled, false);
  assert.equal(Object.isFrozen(evaluation), true);
  assert.equal(Object.isFrozen(evaluation.finalDistribution), true);
  assert.equal(Object.isFrozen(evaluation.dFinal), true);
  assert.equal(Object.isFrozen(evaluation.probabilities), true);
});

test('one immutable D_final settles baseline and alternate Higher or Lower offers without rebuilding', async () => {
  const {
    offer,
    sourceBaseDistribution,
    dFinal,
    parkArtifact,
  } = await evaluationInputs();
  const finalDistribution = createM8_5FinalDistributionV1({
    sourceBaseDistribution,
    dFinal,
    contextModelVersion: CONTEXT_MODEL_VERSION,
    factorArtifacts: [parkArtifact.typedFactorArtifact],
  });
  const higherOffer = offerAt(offer, 'higher', 1.5);
  const lowerOffer = offerAt(offer, 'lower', 1.5);
  const higherBase = settleM8BatterHitsBaseOffer(
    sourceBaseDistribution,
    higherOffer,
  );
  const lowerBase = settleM8BatterHitsBaseOffer(
    sourceBaseDistribution,
    lowerOffer,
  );
  const higherFinal = settleM8_5FinalOfferV1({
    sourceM8Evaluation: higherBase,
    finalDistribution,
  });
  const lowerFinal = settleM8_5FinalOfferV1({
    sourceM8Evaluation: lowerBase,
    finalDistribution,
  });

  assert.strictEqual(higherFinal.finalDistribution, finalDistribution);
  assert.strictEqual(lowerFinal.finalDistribution, finalDistribution);
  assert.strictEqual(higherFinal.dFinal, finalDistribution.dFinal);
  assert.strictEqual(lowerFinal.dFinal, finalDistribution.dFinal);
  assert.equal(higherFinal.offer.line, 1.5);
  assert.equal(lowerFinal.offer.line, 1.5);
  assert.equal(higherFinal.offer.selectedSide, 'higher');
  assert.equal(lowerFinal.offer.selectedSide, 'lower');
  assert.equal(higherFinal.probabilities.pWin, lowerFinal.probabilities.pLoss);
  assert.equal(higherFinal.probabilities.pLoss, lowerFinal.probabilities.pWin);
  assert.equal(higherFinal.probabilities.pVoid, lowerFinal.probabilities.pVoid);
  assert.notEqual(
    higherFinal.finalEvaluationSha256,
    lowerFinal.finalEvaluationSha256,
  );
});

test('M8.5 final evaluation fails closed on source, factor, scenario, or hash drift', async () => {
  const {
    sourceM8Evaluation,
    sourceBaseDistribution,
    dFinal,
    parkArtifact,
  } = await evaluationInputs();

  assert.throws(
    () =>
      createM8_5FinalDistributionV1({
        sourceBaseDistribution,
        dFinal,
        contextModelVersion: CONTEXT_MODEL_VERSION,
        factorArtifacts: [
          parkArtifact.typedFactorArtifact,
          parkArtifact.typedFactorArtifact,
        ],
      }),
    /duplicate M8\.5 factor park/u,
  );

  const driftedScenarioDistribution = Object.freeze({
    ...dFinal,
    scenarios: Object.freeze(
      dFinal.scenarios.map((scenario, index) =>
        index === 0
          ? Object.freeze({
              ...scenario,
              scenarioIndex: scenario.scenarioIndex + 100,
            })
          : scenario,
      ),
    ),
  }) as typeof dFinal;
  assert.throws(
    () =>
      createM8_5FinalDistributionV1({
        sourceBaseDistribution,
        dFinal: driftedScenarioDistribution,
        contextModelVersion: CONTEXT_MODEL_VERSION,
        factorArtifacts: [parkArtifact.typedFactorArtifact],
      }),
    /shared scenario index/u,
  );

  const finalDistribution = createM8_5FinalDistributionV1({
    sourceBaseDistribution,
    dFinal,
    contextModelVersion: CONTEXT_MODEL_VERSION,
    factorArtifacts: [parkArtifact.typedFactorArtifact],
  });
  const tamperedSource = Object.freeze({
    ...sourceM8Evaluation,
    probabilities: Object.freeze({
      ...sourceM8Evaluation.probabilities,
      pBase: sourceM8Evaluation.probabilities.pBase! + 0.01,
    }),
  }) as M8BatterHitsBaseEvaluationV1;
  assert.throws(
    () =>
      settleM8_5FinalOfferV1({
        sourceM8Evaluation: tamperedSource,
        finalDistribution,
      }),
    /source M8 evaluation/u,
  );

  const evaluation = settleM8_5FinalOfferV1({
    sourceM8Evaluation,
    finalDistribution,
  });
  const tamperedEvaluation = Object.freeze({
    ...evaluation,
    finalEvaluationSha256: '0'.repeat(64),
  }) as typeof evaluation;
  assert.throws(
    () => verifyM8_5FinalEvaluationV1(tamperedEvaluation),
    /canonical hash and settlement/u,
  );

  const tamperedFactorReference = Object.freeze({
    ...finalDistribution,
    factorReferences: Object.freeze([
      Object.freeze({
        ...finalDistribution.factorReferences[0]!,
        applicationStages: Object.freeze(['identity' as const]),
      }),
    ]),
  }) as M8_5FinalDistributionV1;
  assert.throws(
    () =>
      settleM8_5FinalOfferV1({
        sourceM8Evaluation,
        finalDistribution: tamperedFactorReference,
      }),
    /applied factor park must have non-identity stages and no reason/u,
  );
});