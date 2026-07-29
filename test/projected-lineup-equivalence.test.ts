import assert from 'node:assert/strict';
import test from 'node:test';

import { createProbabilityMassFunction } from '../src/core/index.js';
import {
  createGameScenarioSet,
  createHitterPASurvivalState,
  deriveJointHitterScenarioAssumptions,
  type GameScenarioSet,
  type LineupSourceStatus,
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
  const teamBattersFaced = 36;
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
      version: 'projected-lineup-equivalence-v1',
    },
    opposingStarter: {
      teamId: opponentTeamId,
      pitcherId: `${opponentTeamId}-starter`,
      workloadVersion: 'projected-lineup-equivalence-v1',
      battersFacedDistribution: deterministicCount(18),
    },
    opposingBullpen: {
      teamId: opponentTeamId,
      workloadVersion: 'projected-lineup-equivalence-v1',
      battersFacedDistribution: deterministicCount(18),
    },
    jointPitchingWorkload: {
      version: 'projected-lineup-equivalence-v1',
      paths: [
        {
          weight: 1,
          starterBattersFaced: 18,
          bullpenBattersFaced: 18,
        },
      ],
    },
    teamBattersFacedDistribution: deterministicCount(teamBattersFaced),
    lineupSlotOpportunities: entries.map((entry) =>
      createHitterPASurvivalState({
        lineupSlot: entry.lineupSlot,
        rawSurvival: [1, 1, 1, 1],
      }),
    ),
  };
}

function scenarioSetInput(sourceStatus: LineupSourceStatus): GameScenarioSet {
  return {
    scenarioSetId: 'projected-lineup-equivalence',
    version: 'projected-lineup-equivalence-v1',
    gameId: 'projected-lineup-equivalence-game',
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
  };
}

function assumptions(sourceStatus: LineupSourceStatus) {
  const scenarioSet = createGameScenarioSet(scenarioSetInput(sourceStatus));
  return deriveJointHitterScenarioAssumptions(
    scenarioSet,
    'base',
    'home-team',
    'home-team-player-1',
    (context) => ({
      scenarioId: context.scenarioId,
      environmentId: context.offensiveEnvironment.environmentId,
      starterId: context.opposingStarter.pitcherId,
    }),
  );
}

test('projected and confirmed versions of the same lineup produce identical model assumptions', () => {
  const projected = assumptions('projected');
  const confirmed = assumptions('confirmed');

  assert.deepEqual(projected, confirmed);
  assert.deepEqual(
    projected.opportunityCountDistribution.probabilities,
    confirmed.opportunityCountDistribution.probabilities,
  );
});
