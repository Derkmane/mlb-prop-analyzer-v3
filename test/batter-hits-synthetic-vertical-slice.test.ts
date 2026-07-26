import assert from 'node:assert/strict';
import test from 'node:test';

import {
  authorizeMarketForPrediction,
  MarketRegistryUnavailableError,
} from '../src/application/market-registry-gate.js';
import { PRODUCTION_REGISTRIES } from '../src/composition/registries.js';
import {
  createProbabilityMassFunction,
  mixBernoulliOutcomesOverCountDistribution,
  mixProbabilityMassFunctions,
} from '../src/core/index.js';
import {
  buildSyntheticBatterHitsDistribution,
  createSyntheticBatterHitsCandidate,
  createSyntheticBatterHitsSavedPrediction,
  predictSyntheticBatterHits,
  serializeSyntheticBatterHitsJson,
  SYNTHETIC_BATTER_HITS_SOURCE_KIND,
  type SyntheticBatterHitsModelConfiguration,
  type SyntheticBatterHitsOffer,
} from '../src/features/batter-hits/index.js';
import { BATTER_HITS_MARKET_KEY } from '../src/features/batter-hits/manifest.js';
import {
  createGameScenarioSet,
  createHitterPASurvivalState,
  createSharedScenarioReference,
  deriveLineupSlotSurvivalFromTeamBattersFaced,
  type GameScenario,
  type GameScenarioSet,
  type JointPitchingWorkloadPath,
  type LineupState,
  type TeamOffenseScenarioState,
  type TeamSide,
} from '../src/game/index.js';

function distributionFromPaths(
  paths: readonly JointPitchingWorkloadPath[],
  count: (path: JointPitchingWorkloadPath) => number,
) {
  const maximum = Math.max(...paths.map(count));
  const probabilities = Array<number>(maximum + 1).fill(0);
  for (const path of paths) {
    const value = count(path);
    probabilities[value] = (probabilities[value] ?? 0) + path.weight;
  }
  return createProbabilityMassFunction(probabilities);
}

function lineup(teamId: string, side: TeamSide): LineupState {
  return {
    teamId,
    side,
    entries: Array.from({ length: 9 }, (_, index) => ({
      playerId: `${teamId}-player-${index + 1}`,
      lineupSlot: (index + 1) as 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9,
    })),
  };
}

function teamScenario(
  teamId: string,
  side: TeamSide,
  opponentTeamId: string,
  environmentId: string,
  workloadPaths: readonly JointPitchingWorkloadPath[],
): TeamOffenseScenarioState {
  const teamLineup = lineup(teamId, side);
  const starterDistribution = distributionFromPaths(
    workloadPaths,
    (path) => path.starterBattersFaced,
  );
  const bullpenDistribution = distributionFromPaths(
    workloadPaths,
    (path) => path.bullpenBattersFaced,
  );
  const teamBattersFacedDistribution = distributionFromPaths(
    workloadPaths,
    (path) => path.starterBattersFaced + path.bullpenBattersFaced,
  );

  return {
    teamId,
    side,
    lineup: teamLineup,
    offensiveEnvironment: {
      environmentId,
      version: 'synthetic-environment-v1',
    },
    opposingStarter: {
      teamId: opponentTeamId,
      pitcherId: `${opponentTeamId}-starter`,
      workloadVersion: 'synthetic-starter-workload-v1',
      battersFacedDistribution: starterDistribution,
    },
    opposingBullpen: {
      teamId: opponentTeamId,
      workloadVersion: 'synthetic-bullpen-workload-v1',
      battersFacedDistribution: bullpenDistribution,
    },
    jointPitchingWorkload: {
      version: 'synthetic-joint-workload-v1',
      paths: workloadPaths,
    },
    teamBattersFacedDistribution,
    lineupSlotOpportunities: teamLineup.entries.map((entry) =>
      createHitterPASurvivalState({
        lineupSlot: entry.lineupSlot,
        rawSurvival: deriveLineupSlotSurvivalFromTeamBattersFaced(
          teamBattersFacedDistribution,
          entry.lineupSlot,
        ),
      }),
    ),
  };
}

function scenario(
  scenarioId: string,
  weight: number,
  environmentId: string,
  homeWorkloadPaths: readonly JointPitchingWorkloadPath[],
): GameScenario {
  return {
    scenarioId,
    weight,
    teams: [
      teamScenario(
        'home-team',
        'home',
        'away-team',
        environmentId,
        homeWorkloadPaths,
      ),
      teamScenario(
        'away-team',
        'away',
        'home-team',
        'away-neutral-environment',
        [
          {
            weight: 1,
            starterBattersFaced: 18,
            bullpenBattersFaced: 18,
          },
        ],
      ),
    ],
  };
}

function syntheticScenarioSet(): GameScenarioSet {
  return createGameScenarioSet({
    scenarioSetId: 'synthetic-batter-hits-scenarios-v1',
    version: 'game-scenario-contract-v1',
    gameId: 'synthetic-game-1',
    homeAway: {
      homeTeamId: 'home-team',
      awayTeamId: 'away-team',
    },
    scenarios: [
      scenario('low-offense', 0.4, 'home-low-offense', [
        {
          weight: 0.5,
          starterBattersFaced: 18,
          bullpenBattersFaced: 18,
        },
        {
          weight: 0.5,
          starterBattersFaced: 22,
          bullpenBattersFaced: 23,
        },
      ]),
      scenario('high-offense', 0.6, 'home-high-offense', [
        {
          weight: 0.5,
          starterBattersFaced: 22,
          bullpenBattersFaced: 23,
        },
        {
          weight: 0.5,
          starterBattersFaced: 27,
          bullpenBattersFaced: 27,
        },
      ]),
    ],
  });
}

function syntheticModel(
  lowProbabilities: readonly number[] = [0.1, 0.2, 0.3, 0.4, 0.5, 0.6],
  highProbabilities: readonly number[] = [0.2, 0.3, 0.4, 0.5, 0.6, 0.7],
): SyntheticBatterHitsModelConfiguration {
  return {
    sourceKind: SYNTHETIC_BATTER_HITS_SOURCE_KIND,
    modelVersion: 'synthetic-batter-hits-model-v1',
    distributionBuilderVersion: 'batter-hits-synthetic-v1',
    configurationVersion: 'synthetic-batter-hits-config-v1',
    mathSpecVersion: 'canonical-math-spec-v1.4',
    projectRulesVersion: 'project-rules-v2.0',
    normalizedDataVersion: 'synthetic-test-only-no-normalized-board-offer-v1',
    settlementRegistryVersion: 'synthetic-settlement-registry-v1',
    settlementRuleVersion: 'synthetic-batter-hits-settlement-v1',
    eligibilityProbability: 0.97,
    scenarioAssumptions: [
      {
        scenarioId: 'low-offense',
        offensiveEnvironmentId: 'home-low-offense',
        perOpportunityHitProbabilities: lowProbabilities,
      },
      {
        scenarioId: 'high-offense',
        offensiveEnvironmentId: 'home-high-offense',
        perOpportunityHitProbabilities: highProbabilities,
      },
    ],
  };
}

function syntheticOffer(
  scenarioSet: GameScenarioSet,
  overrides: Partial<SyntheticBatterHitsOffer> = {},
): SyntheticBatterHitsOffer {
  return {
    sourceKind: SYNTHETIC_BATTER_HITS_SOURCE_KIND,
    syntheticOfferId: 'synthetic-baseline-higher-0.5',
    eventId: 'synthetic-event-1',
    gameId: scenarioSet.gameId,
    teamId: 'home-team',
    playerId: 'home-team-player-1',
    playerName: 'Synthetic Hitter',
    baseMarketKey: BATTER_HITS_MARKET_KEY,
    line: 0.5,
    selectedSide: 'higher',
    offerType: 'baseline',
    sharedScenarioReference: createSharedScenarioReference(scenarioSet),
    ...overrides,
  };
}

function savedInput(
  scenarioSet = syntheticScenarioSet(),
  model = syntheticModel(),
  offer = syntheticOffer(scenarioSet),
) {
  return {
    snapshotId: 'synthetic-snapshot-1',
    savedAt: '2026-07-25T12:00:00.000Z',
    scenarioSet,
    model,
    offer,
  };
}

function assertVectorClose(
  actual: readonly number[],
  expected: readonly number[],
  tolerance = 1e-12,
): void {
  assert.equal(actual.length, expected.length);
  for (const [index, expectedValue] of expected.entries()) {
    const actualValue = actual[index];
    assert.notEqual(actualValue, undefined);
    assert.ok(
      Math.abs((actualValue ?? Number.NaN) - expectedValue) <= tolerance,
      `expected ${actualValue} to be within ${tolerance} of ${expectedValue}`,
    );
  }
}

function sum(values: readonly number[]): number {
  return values.reduce((total, value) => total + value, 0);
}

test('synthetic input cannot be mistaken for a provider offer and requires the shared GameScenarioSet', () => {
  const scenarioSet = syntheticScenarioSet();
  const model = syntheticModel();
  const invalidOffer = {
    ...syntheticOffer(scenarioSet),
    sourceKind: 'provider-offer',
  } as unknown as SyntheticBatterHitsOffer;

  assert.throws(
    () => predictSyntheticBatterHits({ offer: invalidOffer, scenarioSet, model }),
    /synthetic-test-only/,
  );

  assert.throws(
    () =>
      buildSyntheticBatterHitsDistribution({
        sourceKind: SYNTHETIC_BATTER_HITS_SOURCE_KIND,
        scenarioSet: undefined as unknown as GameScenarioSet,
        sharedScenarioReference: createSharedScenarioReference(scenarioSet),
        teamId: 'home-team',
        playerId: 'home-team-player-1',
        scenarioAssumptions: model.scenarioAssumptions,
      }),
    /shared GameScenarioSet is required/,
  );
});

test('exact opportunity-count mixing and shared scenario mixing conserve probability', () => {
  const scenarioSet = syntheticScenarioSet();
  const model = syntheticModel();
  const prediction = predictSyntheticBatterHits({
    offer: syntheticOffer(scenarioSet),
    scenarioSet,
    model,
  });
  const lowScenario = prediction.distribution.scenarios[0];
  const highScenario = prediction.distribution.scenarios[1];
  assert.notEqual(lowScenario, undefined);
  assert.notEqual(highScenario, undefined);

  const expectedLow = mixBernoulliOutcomesOverCountDistribution(
    lowScenario!.opportunityCountDistribution,
    model.scenarioAssumptions[0]!.perOpportunityHitProbabilities,
  );
  const expectedHigh = mixBernoulliOutcomesOverCountDistribution(
    highScenario!.opportunityCountDistribution,
    model.scenarioAssumptions[1]!.perOpportunityHitProbabilities,
  );
  assertVectorClose(
    lowScenario!.hitDistribution.probabilities,
    expectedLow.probabilities,
  );
  assertVectorClose(
    highScenario!.hitDistribution.probabilities,
    expectedHigh.probabilities,
  );

  const expectedMixture = mixProbabilityMassFunctions([
    { weight: 0.4, distribution: expectedLow },
    { weight: 0.6, distribution: expectedHigh },
  ]);
  assertVectorClose(
    prediction.distribution.statisticDistribution.probabilities,
    expectedMixture.probabilities,
  );
  assert.ok(
    Math.abs(
      sum(prediction.distribution.statisticDistribution.probabilities) - 1,
    ) <= 1e-12,
  );
  assert.ok(
    Math.abs(
      prediction.distribution.scenarios.reduce(
        (total, current) => total + current.weight,
        0,
      ) - 1,
    ) <= 1e-12,
  );
  assert.deepEqual(
    lowScenario!.opportunityCountDistribution.probabilities,
    [0, 0, 0, 0, 0.5, 0.5],
  );
});

test('Higher and Lower use exact settlement, exchange win/loss mass, and preserve ties and voids', () => {
  const scenarioSet = syntheticScenarioSet();
  const model = syntheticModel();
  const baseOffer = syntheticOffer(scenarioSet);
  const distribution = buildSyntheticBatterHitsDistribution({
    sourceKind: SYNTHETIC_BATTER_HITS_SOURCE_KIND,
    scenarioSet,
    sharedScenarioReference: baseOffer.sharedScenarioReference,
    teamId: baseOffer.teamId,
    playerId: baseOffer.playerId,
    scenarioAssumptions: model.scenarioAssumptions,
  });
  const higher = createSyntheticBatterHitsCandidate(
    syntheticOffer(scenarioSet, {
      syntheticOfferId: 'synthetic-higher-1',
      line: 1,
      selectedSide: 'higher',
    }),
    model,
    distribution,
  );
  const lower = createSyntheticBatterHitsCandidate(
    syntheticOffer(scenarioSet, {
      syntheticOfferId: 'synthetic-lower-1',
      line: 1,
      selectedSide: 'lower',
    }),
    model,
    distribution,
  );

  assert.ok(Math.abs(higher.pWin - lower.pLoss) <= 1e-12);
  assert.ok(Math.abs(higher.pLoss - lower.pWin) <= 1e-12);
  assert.ok(Math.abs(higher.pVoid - lower.pVoid) <= 1e-12);
  assert.ok(higher.pVoid > 1 - model.eligibilityProbability);
  assert.ok(Math.abs(higher.pWin + higher.pLoss + higher.pVoid - 1) <= 1e-12);
  assert.ok(Math.abs(lower.pWin + lower.pLoss + lower.pVoid - 1) <= 1e-12);

  const halfPointHigher = createSyntheticBatterHitsCandidate(
    syntheticOffer(scenarioSet, { line: 0.5, selectedSide: 'higher' }),
    model,
    distribution,
  );
  const halfPointLower = createSyntheticBatterHitsCandidate(
    syntheticOffer(scenarioSet, { line: 0.5, selectedSide: 'lower' }),
    model,
    distribution,
  );
  assert.ok(
    Math.abs(halfPointHigher.pVoid - (1 - model.eligibilityProbability)) <=
      1e-12,
  );
  assert.ok(
    Math.abs(halfPointLower.pVoid - (1 - model.eligibilityProbability)) <=
      1e-12,
  );
  assert.equal(halfPointHigher.selectedSide, 'higher');
  assert.equal(halfPointHigher.line, 0.5);
  assert.equal(halfPointLower.selectedSide, 'lower');
  assert.equal(halfPointLower.line, 0.5);
});

test('baseline and alternate offers settle one identical Hits distribution', () => {
  const scenarioSet = syntheticScenarioSet();
  const model = syntheticModel();
  const baselineOffer = syntheticOffer(scenarioSet);
  const distribution = buildSyntheticBatterHitsDistribution({
    sourceKind: SYNTHETIC_BATTER_HITS_SOURCE_KIND,
    scenarioSet,
    sharedScenarioReference: baselineOffer.sharedScenarioReference,
    teamId: baselineOffer.teamId,
    playerId: baselineOffer.playerId,
    scenarioAssumptions: model.scenarioAssumptions,
  });
  const baseline = createSyntheticBatterHitsCandidate(
    baselineOffer,
    model,
    distribution,
  );
  const alternate = createSyntheticBatterHitsCandidate(
    syntheticOffer(scenarioSet, {
      syntheticOfferId: 'synthetic-alt-lower-1.5',
      offerType: 'alternate',
      line: 1.5,
      selectedSide: 'lower',
    }),
    model,
    distribution,
  );

  assert.strictEqual(baseline.statisticDistribution, distribution.statisticDistribution);
  assert.strictEqual(alternate.statisticDistribution, distribution.statisticDistribution);
  assert.deepEqual(
    baseline.statisticDistribution,
    alternate.statisticDistribution,
  );
  assert.equal(baseline.line, 0.5);
  assert.equal(baseline.selectedSide, 'higher');
  assert.equal(alternate.line, 1.5);
  assert.equal(alternate.selectedSide, 'lower');
});

test('generic candidate preserves identity, probabilities, versions, side, line, and shared scenario reference', () => {
  const scenarioSet = syntheticScenarioSet();
  const model = syntheticModel();
  const offer = syntheticOffer(scenarioSet);
  const { candidate } = predictSyntheticBatterHits({ offer, scenarioSet, model });

  assert.equal(candidate.eventId, offer.eventId);
  assert.equal(candidate.gameId, offer.gameId);
  assert.equal(candidate.playerId, offer.playerId);
  assert.equal(candidate.playerName, offer.playerName);
  assert.equal(candidate.baseMarketKey, BATTER_HITS_MARKET_KEY);
  assert.equal(candidate.marketLabel, 'Batter Hits');
  assert.equal(candidate.settlementStatistic, 'hits');
  assert.equal(candidate.line, offer.line);
  assert.equal(candidate.selectedSide, offer.selectedSide);
  assert.equal(candidate.modelVersion, model.modelVersion);
  assert.equal(
    candidate.distributionBuilderVersion,
    model.distributionBuilderVersion,
  );
  assert.equal(candidate.settlementRuleVersion, model.settlementRuleVersion);
  assert.deepEqual(
    candidate.sharedScenarioReference,
    createSharedScenarioReference(scenarioSet),
  );
  assert.ok(Math.abs(candidate.pWin + candidate.pLoss + candidate.pVoid - 1) <= 1e-12);
});

test('synthetic saved prediction is immutable after source inputs are mutated', () => {
  const lowProbabilities = [0.1, 0.2, 0.3, 0.4, 0.5, 0.6];
  const highProbabilities = [0.2, 0.3, 0.4, 0.5, 0.6, 0.7];
  const scenarioSet = syntheticScenarioSet();
  const model = syntheticModel(lowProbabilities, highProbabilities);
  const input = savedInput(scenarioSet, model, syntheticOffer(scenarioSet));
  const result = createSyntheticBatterHitsSavedPrediction(input);
  const serializedBeforeMutation = JSON.stringify(result.savedPrediction);

  lowProbabilities[0] = 0.99;
  highProbabilities[0] = 0.99;

  assert.equal(JSON.stringify(result.savedPrediction), serializedBeforeMutation);
  assert.ok(Object.isFrozen(result.savedPrediction));
  assert.ok(Object.isFrozen(result.savedPrediction.scenarioWeights));
  assert.ok(Object.isFrozen(result.savedPrediction.opportunityDistribution));
  assert.ok(Object.isFrozen(result.savedPrediction.statisticDistribution));
  assert.ok(Object.isFrozen(result.savedPrediction.featureData));
  assert.ok(Object.isFrozen(result.savedPrediction.featureData.values));
  assert.equal(result.savedPrediction.line, input.offer.line);
  assert.equal(result.savedPrediction.selectedSide, input.offer.selectedSide);
  assert.deepEqual(
    result.savedPrediction.opportunityDistribution,
    result.distribution.opportunityDistribution,
  );
  assert.deepEqual(
    result.savedPrediction.statisticDistribution,
    result.distribution.statisticDistribution,
  );
  assert.deepEqual(result.savedPrediction.scenarioWeights, [
    { scenarioId: 'low-offense', weight: 0.4 },
    { scenarioId: 'high-offense', weight: 0.6 },
  ]);
  assert.equal(result.savedPrediction.providerSnapshots.length, 0);
});

test('synthetic JSON output is deterministic and preserves side-aware historical fields', () => {
  const input = savedInput();
  const first = serializeSyntheticBatterHitsJson(input);
  const second = serializeSyntheticBatterHitsJson(input);
  assert.equal(first, second);

  const parsed = JSON.parse(first) as {
    sourceKind: string;
    candidate: { line: number; selectedSide: string; pWin: number };
    savedPrediction: {
      line: number;
      selectedSide: string;
      modelVersion: string;
      settlementRuleVersion: string;
    };
    historicalView: {
      status: string;
      line: number;
      selectedSide: string;
      pWin: number;
    };
  };
  assert.equal(parsed.sourceKind, SYNTHETIC_BATTER_HITS_SOURCE_KIND);
  assert.equal(parsed.candidate.line, input.offer.line);
  assert.equal(parsed.candidate.selectedSide, input.offer.selectedSide);
  assert.equal(parsed.savedPrediction.modelVersion, input.model.modelVersion);
  assert.equal(
    parsed.savedPrediction.settlementRuleVersion,
    input.model.settlementRuleVersion,
  );
  assert.equal(parsed.historicalView.status, 'historical');
  assert.equal(parsed.historicalView.line, input.offer.line);
  assert.equal(parsed.historicalView.selectedSide, input.offer.selectedSide);
  assert.equal(parsed.historicalView.pWin, parsed.candidate.pWin);
});

test('disabled Batter Hits fails closed before any synthetic distribution builder can run', () => {
  let syntheticBuilderInvoked = false;
  const productionAttempt = () => {
    authorizeMarketForPrediction(PRODUCTION_REGISTRIES, BATTER_HITS_MARKET_KEY);
    syntheticBuilderInvoked = true;
    return predictSyntheticBatterHits(savedInput());
  };

  assert.throws(
    productionAttempt,
    (error: unknown) =>
      error instanceof MarketRegistryUnavailableError &&
      error.code === 'MARKET_NOT_PRODUCTION_ENABLED',
  );
  assert.equal(syntheticBuilderInvoked, false);
});
