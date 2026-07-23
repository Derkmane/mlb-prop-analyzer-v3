import assert from 'node:assert/strict';
import test from 'node:test';

import { createProbabilityMassFunction } from '../src/core/index.js';
import {
  assertSharedScenarioReference,
  ContradictoryGameScenarioError,
  createGameScenarioSet,
  createHitterPASurvivalState,
  createSharedScenarioReference,
  deriveJointHitterScenarioAssumptions,
  deriveLineupSlotSurvivalFromTeamBattersFaced,
  expectedCountFromProbabilityMassFunction,
  hitterOpportunityCountDistribution,
  type GameScenario,
  type GameScenarioSet,
  type LineupState,
  type SurvivalMonotonicityPolicy,
  type TeamOffenseScenarioState,
  type TeamSide,
} from '../src/game/index.js';

const SYNTHETIC_MONOTONICITY_POLICY: SurvivalMonotonicityPolicy = Object.freeze({
  version: 'synthetic-monotonicity-policy-v1',
  maximumAllowedIncrease: 0.05,
});

function deterministicCount(count: number) {
  const probabilities = Array<number>(count + 1).fill(0);
  probabilities[count] = 1;
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
  maxPlateAppearances: number,
  environmentId: string,
): TeamOffenseScenarioState {
  const teamLineup = lineup(teamId, side);
  const teamBattersFaced = maxPlateAppearances * 9;
  const starterBattersFaced = Math.floor(teamBattersFaced / 2);
  const bullpenBattersFaced = teamBattersFaced - starterBattersFaced;

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
      battersFacedDistribution: deterministicCount(starterBattersFaced),
    },
    opposingBullpen: {
      teamId: opponentTeamId,
      workloadVersion: 'synthetic-bullpen-workload-v1',
      battersFacedDistribution: deterministicCount(bullpenBattersFaced),
    },
    teamBattersFacedDistribution: deterministicCount(teamBattersFaced),
    lineupSlotOpportunities: teamLineup.entries.map((entry) =>
      createHitterPASurvivalState({
        lineupSlot: entry.lineupSlot,
        rawSurvival: Array<number>(maxPlateAppearances).fill(1),
        monotonicityPolicy: SYNTHETIC_MONOTONICITY_POLICY,
      }),
    ),
  };
}

function scenario(
  scenarioId: string,
  weight: number,
  homeMaxPlateAppearances: number,
  homeEnvironmentId: string,
): GameScenario {
  return {
    scenarioId,
    weight,
    teams: [
      teamScenario(
        'home-team',
        'home',
        'away-team',
        homeMaxPlateAppearances,
        homeEnvironmentId,
      ),
      teamScenario(
        'away-team',
        'away',
        'home-team',
        4,
        'away-neutral-environment',
      ),
    ],
  };
}

function scenarioSetInput(
  lowWeight = 0.4,
  highWeight = 0.6,
): GameScenarioSet {
  return {
    scenarioSetId: 'synthetic-game-scenarios-v1',
    version: 'game-scenario-contract-v1',
    gameId: 'synthetic-game-1',
    homeAway: {
      homeTeamId: 'home-team',
      awayTeamId: 'away-team',
    },
    scenarios: [
      scenario('lower-offense', lowWeight, 4, 'home-lower-offense'),
      scenario('higher-offense', highWeight, 5, 'home-higher-offense'),
    ],
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

test('GameScenarioSet preserves shared lineup, home-away, environment, starter, bullpen, and conserved weights', () => {
  const set = createGameScenarioSet(scenarioSetInput());

  assert.equal(set.scenarios.length, 2);
  assert.equal(
    set.scenarios.reduce((sum, gameScenario) => sum + gameScenario.weight, 0),
    1,
  );
  assert.equal(set.homeAway.homeTeamId, 'home-team');
  assert.equal(set.homeAway.awayTeamId, 'away-team');
  assert.equal(set.scenarios[0]!.teams[0].lineup.entries.length, 9);
  assert.equal(
    set.scenarios[0]!.teams[0].lineupSlotOpportunities.length,
    9,
  );
  assert.equal(
    set.scenarios[0]!.teams[0].opposingStarter.teamId,
    'away-team',
  );
  assert.equal(
    set.scenarios[0]!.teams[0].opposingBullpen.teamId,
    'away-team',
  );
  assert.ok(Object.isFrozen(set));
  assert.ok(Object.isFrozen(set.scenarios));
  assert.ok(Object.isFrozen(set.scenarios[0]!.teams));
});

test('raw and weighted-isotonic hitter survival curves are both preserved and convert exactly to counts', () => {
  const state = createHitterPASurvivalState({
    lineupSlot: 1,
    rawSurvival: [1, 0.8, 0.82, 0.4],
    monotonicityPolicy: SYNTHETIC_MONOTONICITY_POLICY,
  });

  assert.deepEqual(state.rawSurvival, [1, 0.8, 0.82, 0.4]);
  assertVectorClose(state.adjustedSurvival, [1, 0.81, 0.81, 0.4]);
  assert.equal(state.adjustmentMethod, 'weighted-isotonic');
  assert.equal(state.adjustmentVersion, 'weighted-isotonic-v1');
  assert.equal(
    state.monotonicityPolicyVersion,
    'synthetic-monotonicity-policy-v1',
  );
  assertVectorClose([state.observedMaximumIncrease], [0.02]);
  assertVectorClose(
    hitterOpportunityCountDistribution(state).probabilities,
    [0, 0.19, 0, 0.41, 0.4],
  );
});

test('even a sub-tolerance survival increase is projected before strict core conversion', () => {
  const state = createHitterPASurvivalState({
    lineupSlot: 1,
    rawSurvival: [0.8, 0.8000000000005],
    monotonicityPolicy: SYNTHETIC_MONOTONICITY_POLICY,
  });

  assert.equal(state.adjustmentMethod, 'weighted-isotonic');
  assert.equal(state.adjustedSurvival[0], state.adjustedSurvival[1]);
  assert.doesNotThrow(() => hitterOpportunityCountDistribution(state));
});

test('survival-order violations above the versioned policy fail closed', () => {
  assert.throws(
    () =>
      createHitterPASurvivalState({
        lineupSlot: 1,
        rawSurvival: [0.7, 0.9],
        monotonicityPolicy: SYNTHETIC_MONOTONICITY_POLICY,
      }),
    /exceeds allowed/,
  );
});

test('scenario weights fail closed unless they conserve total probability', () => {
  assert.throws(
    () => createGameScenarioSet(scenarioSetInput(0.4, 0.5)),
    /scenario weights must sum to 1/,
  );
});

test('lineup-slot survival is derived exactly from team batters faced', () => {
  const probabilities = Array<number>(20).fill(0);
  probabilities[10] = 0.5;
  probabilities[19] = 0.5;
  const distribution = createProbabilityMassFunction(probabilities);

  assert.deepEqual(
    deriveLineupSlotSurvivalFromTeamBattersFaced(distribution, 1),
    [1, 1, 0.5],
  );
  assert.deepEqual(
    deriveLineupSlotSurvivalFromTeamBattersFaced(distribution, 2),
    [1, 0.5],
  );
  assert.deepEqual(
    deriveLineupSlotSurvivalFromTeamBattersFaced(distribution, 9),
    [1, 0.5],
  );
});

test('a slot curve with the right expectation but the wrong tail fails team-PA consistency', () => {
  const input = scenarioSetInput();
  const firstScenario = input.scenarios[0]!;
  const home = firstScenario.teams[0];
  const firstSlot = home.lineupSlotOpportunities[0]!;
  const inconsistentHome: TeamOffenseScenarioState = {
    ...home,
    lineupSlotOpportunities: [
      createHitterPASurvivalState({
        lineupSlot: firstSlot.lineupSlot,
        rawSurvival: [1, 1, 0.5, 0.5, 0.5, 0.5],
        monotonicityPolicy: SYNTHETIC_MONOTONICITY_POLICY,
      }),
      ...home.lineupSlotOpportunities.slice(1),
    ],
  };
  const inconsistentScenario: GameScenario = {
    ...firstScenario,
    teams: [inconsistentHome, firstScenario.teams[1]],
  };

  assert.throws(
    () =>
      createGameScenarioSet({
        ...input,
        scenarios: [inconsistentScenario, input.scenarios[1]!],
      }),
    /adjusted lineup-slot survival must match team batters-faced support/,
  );
});

test('starter and bullpen workload expectations must agree with team batters faced', () => {
  const input = scenarioSetInput();
  const firstScenario = input.scenarios[0]!;
  const home = firstScenario.teams[0];
  const inconsistentHome: TeamOffenseScenarioState = {
    ...home,
    opposingBullpen: {
      ...home.opposingBullpen,
      battersFacedDistribution: deterministicCount(17),
    },
  };
  const inconsistentScenario: GameScenario = {
    ...firstScenario,
    teams: [inconsistentHome, firstScenario.teams[1]],
  };

  assert.throws(
    () =>
      createGameScenarioSet({
        ...input,
        scenarios: [inconsistentScenario, input.scenarios[1]!],
      }),
    /starter and bullpen workload expectations must match team batters faced/,
  );
});

test('the same shared scenario moves hitter opportunity and outcome assumptions together', () => {
  const set = createGameScenarioSet(scenarioSetInput());
  const deriveSyntheticOutcome = (environmentId: string): number =>
    environmentId === 'home-higher-offense' ? 0.3 : 0.2;

  const lower = deriveJointHitterScenarioAssumptions(
    set,
    'lower-offense',
    'home-team',
    'home-team-player-1',
    (context) =>
      deriveSyntheticOutcome(context.offensiveEnvironment.environmentId),
  );
  const higher = deriveJointHitterScenarioAssumptions(
    set,
    'higher-offense',
    'home-team',
    'home-team-player-1',
    (context) =>
      deriveSyntheticOutcome(context.offensiveEnvironment.environmentId),
  );

  assert.equal(
    expectedCountFromProbabilityMassFunction(lower.opportunityCountDistribution),
    4,
  );
  assert.equal(
    expectedCountFromProbabilityMassFunction(higher.opportunityCountDistribution),
    5,
  );
  assert.equal(lower.lineupSlot, 1);
  assert.equal(higher.lineupSlot, 1);
  assert.equal(lower.outcomeAssumption, 0.2);
  assert.equal(higher.outcomeAssumption, 0.3);
  assert.equal(lower.offensiveEnvironmentId, 'home-lower-offense');
  assert.equal(higher.offensiveEnvironmentId, 'home-higher-offense');
});

test('feature inputs cannot substitute a contradictory game scenario set', () => {
  const set = createGameScenarioSet(scenarioSetInput());
  const reference = createSharedScenarioReference(set);

  assert.doesNotThrow(() => assertSharedScenarioReference(set, reference));
  assert.throws(
    () =>
      assertSharedScenarioReference(set, {
        ...reference,
        scenarioSetId: 'feature-local-scenario-set',
      }),
    ContradictoryGameScenarioError,
  );
});
