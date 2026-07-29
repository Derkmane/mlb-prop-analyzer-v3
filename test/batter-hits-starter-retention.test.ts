import assert from 'node:assert/strict';
import test from 'node:test';

import { createProbabilityMassFunction } from '../src/core/index.js';
import {
  buildSyntheticBatterHitsDistribution,
  SYNTHETIC_BATTER_HITS_SOURCE_KIND,
} from '../src/features/batter-hits/index.js';
import {
  createGameScenarioSet,
  createHitterPASurvivalState,
  createSharedScenarioReference,
  createStarterRetentionState,
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
): TeamOffenseScenarioState {
  const entries = Array.from({ length: 9 }, (_, index) => ({
    playerId: `${teamId}-player-${index + 1}`,
    lineupSlot: (index + 1) as 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9,
  }));
  return {
    teamId,
    side,
    lineup: { teamId, side, sourceStatus: 'projected', entries },
    offensiveEnvironment: {
      environmentId: `${teamId}-environment`,
      version: 'starter-retention-feature-test-v1',
    },
    opposingStarter: {
      teamId: opponentTeamId,
      pitcherId: `${opponentTeamId}-starter`,
      workloadVersion: 'starter-retention-feature-test-v1',
      battersFacedDistribution: deterministicCount(18),
    },
    opposingBullpen: {
      teamId: opponentTeamId,
      workloadVersion: 'starter-retention-feature-test-v1',
      battersFacedDistribution: deterministicCount(18),
    },
    jointPitchingWorkload: {
      version: 'starter-retention-feature-test-v1',
      paths: [{ weight: 1, starterBattersFaced: 18, bullpenBattersFaced: 18 }],
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

test('Batter Hits applies starter retention before hit-count convolution', () => {
  const scenarioSet = createGameScenarioSet({
    scenarioSetId: 'starter-retention-feature-test',
    version: 'starter-retention-feature-test-v1',
    gameId: 'starter-retention-feature-game',
    homeAway: { homeTeamId: 'home-team', awayTeamId: 'away-team' },
    scenarios: [
      {
        scenarioId: 'base',
        weight: 1,
        teams: [
          teamScenario('home-team', 'home', 'away-team'),
          teamScenario('away-team', 'away', 'home-team'),
        ],
      },
    ],
  });
  const retention = createStarterRetentionState({
    scenarioSetId: scenarioSet.scenarioSetId,
    scenarioSetVersion: scenarioSet.version,
    gameId: scenarioSet.gameId,
    scenarioId: 'base',
    teamId: 'home-team',
    lineupSlot: 1,
    version: 'starter-retention-feature-test-v1',
    conditionalRetention: [1, 1, 0.5, 0.5],
  });
  const distribution = buildSyntheticBatterHitsDistribution({
    sourceKind: SYNTHETIC_BATTER_HITS_SOURCE_KIND,
    scenarioSet,
    sharedScenarioReference: createSharedScenarioReference(scenarioSet),
    teamId: 'home-team',
    playerId: 'home-team-player-1',
    scenarioAssumptions: [
      {
        scenarioId: 'base',
        offensiveEnvironmentId: 'home-team-environment',
        starterRetention: retention,
        perOpportunityHitProbabilities: [0.2, 0.2, 0.2, 0.2],
      },
    ],
  });

  assert.deepEqual(
    distribution.scenarios[0]!.slotOpportunityCountDistribution.probabilities,
    [0, 0, 0, 0, 1],
  );
  assert.deepEqual(
    distribution.scenarios[0]!.opportunityCountDistribution.probabilities,
    [0, 0, 0.5, 0.25, 0.25],
  );
  assert.equal(
    distribution.scenarios[0]!.starterRetentionVersion,
    'starter-retention-feature-test-v1',
  );
  assert.deepEqual(
    distribution.opportunityDistribution.probabilities,
    [0, 0, 0.5, 0.25, 0.25],
  );
});
