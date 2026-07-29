import assert from 'node:assert/strict';
import test from 'node:test';

import { createProbabilityMassFunction } from '../src/core/index.js';
import {
  createGameScenarioSet,
  createHitterPASurvivalState,
  createStarterRetentionState,
  deriveJointNamedHitterScenarioAssumptions,
  deriveNamedHitterOpportunityCountDistribution,
  type GameScenarioSet,
  type LineupSourceStatus,
  type StarterRetentionState,
  type TeamOffenseScenarioState,
  type TeamSide,
} from '../src/game/index.js';

function deterministicCount(count: number) {
  const probabilities = Array<number>(count + 1).fill(0);
  probabilities[count] = 1;
  return createProbabilityMassFunction(probabilities);
}

function teamScenario(
  teamId: string,
  side: TeamSide,
  opponentTeamId: string,
  sourceStatus: LineupSourceStatus,
): TeamOffenseScenarioState {
  const entries = Array.from({ length: 9 }, (_, index) => ({
    playerId: `${teamId}-player-${index + 1}`,
    lineupSlot: (index + 1) as 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9,
  }));
  return {
    teamId,
    side,
    lineup: {
      teamId,
      side,
      sourceStatus,
      entries,
    },
    offensiveEnvironment: {
      environmentId: `${teamId}-environment`,
      version: 'named-hitter-opportunity-test-v1',
    },
    opposingStarter: {
      teamId: opponentTeamId,
      pitcherId: `${opponentTeamId}-starter`,
      workloadVersion: 'named-hitter-opportunity-test-v1',
      battersFacedDistribution: deterministicCount(18),
    },
    opposingBullpen: {
      teamId: opponentTeamId,
      workloadVersion: 'named-hitter-opportunity-test-v1',
      battersFacedDistribution: deterministicCount(18),
    },
    jointPitchingWorkload: {
      version: 'named-hitter-opportunity-test-v1',
      paths: [
        {
          weight: 1,
          starterBattersFaced: 18,
          bullpenBattersFaced: 18,
        },
      ],
    },
    teamBattersFacedDistribution: deterministicCount(36),
    lineupSlotOpportunities: entries.map((entry) =>
      createHitterPASurvivalState({
        lineupSlot: entry.lineupSlot,
        rawSurvival: [1, 1, 1, 1],
      }),
    ),
  };
}

function scenarioSet(sourceStatus: LineupSourceStatus): GameScenarioSet {
  return createGameScenarioSet({
    scenarioSetId: 'named-hitter-opportunity-test',
    version: 'named-hitter-opportunity-test-v1',
    gameId: 'named-hitter-opportunity-game',
    homeAway: {
      homeTeamId: 'home-team',
      awayTeamId: 'away-team',
    },
    scenarios: [
      {
        scenarioId: 'base',
        weight: 1,
        teams: [
          teamScenario('home-team', 'home', 'away-team', sourceStatus),
          teamScenario('away-team', 'away', 'home-team', sourceStatus),
        ],
      },
    ],
  });
}

function retention(
  set: GameScenarioSet,
  overrides: Partial<StarterRetentionState> = {},
): StarterRetentionState {
  return createStarterRetentionState({
    scenarioSetId: set.scenarioSetId,
    scenarioSetVersion: set.version,
    gameId: set.gameId,
    scenarioId: 'base',
    teamId: 'home-team',
    lineupSlot: 1,
    version: 'starter-retention-test-v1',
    conditionalRetention: [1, 1, 0.5, 0.5],
    ...overrides,
  });
}

test('starter retention converts slot turns into the named hitter PA distribution', () => {
  const set = scenarioSet('projected');
  const slotDistribution = set.scenarios[0]!.teams[0]
    .lineupSlotOpportunities[0]!;
  const namedDistribution = deriveNamedHitterOpportunityCountDistribution(
    createProbabilityMassFunction([0, 0, 0, 0, 1]),
    retention(set),
  );

  assert.deepEqual(slotDistribution.adjustedSurvival, [1, 1, 1, 1]);
  assert.deepEqual(namedDistribution.probabilities, [0, 0, 0.5, 0.25, 0.25]);
});

test('named hitter derivation preserves slot turns separately and rejects mismatched retention identity', () => {
  const set = scenarioSet('projected');
  const assumptions = deriveJointNamedHitterScenarioAssumptions(
    set,
    'base',
    'home-team',
    'home-team-player-1',
    retention(set),
    (context) => context.offensiveEnvironment.environmentId,
  );

  assert.deepEqual(
    assumptions.slotOpportunityCountDistribution.probabilities,
    [0, 0, 0, 0, 1],
  );
  assert.deepEqual(
    assumptions.opportunityCountDistribution.probabilities,
    [0, 0, 0.5, 0.25, 0.25],
  );
  assert.equal(assumptions.starterRetentionVersion, 'starter-retention-test-v1');

  assert.throws(
    () =>
      deriveJointNamedHitterScenarioAssumptions(
        set,
        'base',
        'home-team',
        'home-team-player-1',
        retention(set, { teamId: 'wrong-team' }),
        (context) => context.offensiveEnvironment.environmentId,
      ),
    /exact shared scenario, team, and batting slot/,
  );
});

test('projected and confirmed lineup metadata produce identical named hitter distributions', () => {
  const projectedSet = scenarioSet('projected');
  const confirmedSet = scenarioSet('confirmed');
  const projected = deriveJointNamedHitterScenarioAssumptions(
    projectedSet,
    'base',
    'home-team',
    'home-team-player-1',
    retention(projectedSet),
    (context) => context.offensiveEnvironment.environmentId,
  );
  const confirmed = deriveJointNamedHitterScenarioAssumptions(
    confirmedSet,
    'base',
    'home-team',
    'home-team-player-1',
    retention(confirmedSet),
    (context) => context.offensiveEnvironment.environmentId,
  );

  assert.deepEqual(projected, confirmed);
});
