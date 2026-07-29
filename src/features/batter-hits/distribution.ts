import {
  mixBernoulliOutcomesOverCountDistribution,
  mixProbabilityMassFunctions,
  validateUnitIntervalVector,
} from '../../core/index.js';
import {
  assertSharedScenarioReference,
  createStarterRetentionState,
  deriveJointHitterScenarioAssumptions,
  deriveJointNamedHitterScenarioAssumptions,
} from '../../game/index.js';
import type {
  SharedOutcomeContext,
  StarterRetentionState,
} from '../../game/index.js';
import type {
  SyntheticBatterHitsDistribution,
  SyntheticBatterHitsDistributionInput,
  SyntheticBatterHitsScenarioAssumption,
  SyntheticBatterHitsScenarioDistribution,
} from './contracts.js';
import { SYNTHETIC_BATTER_HITS_SOURCE_KIND } from './contracts.js';

function assertNonEmpty(value: string, label: string): void {
  if (value.trim().length === 0) {
    throw new RangeError(`${label} must not be empty`);
  }
}

function assertSyntheticSourceKind(value: unknown): void {
  if (value !== SYNTHETIC_BATTER_HITS_SOURCE_KIND) {
    throw new RangeError(
      'Batter Hits M7 input must be explicitly marked synthetic-test-only',
    );
  }
}

function indexScenarioAssumptions(
  assumptions: readonly SyntheticBatterHitsScenarioAssumption[],
): ReadonlyMap<string, SyntheticBatterHitsScenarioAssumption> {
  const byScenarioId = new Map<string, SyntheticBatterHitsScenarioAssumption>();

  for (const assumption of assumptions) {
    assertNonEmpty(assumption.scenarioId, 'synthetic scenarioId');
    assertNonEmpty(
      assumption.offensiveEnvironmentId,
      'synthetic offensiveEnvironmentId',
    );
    if (byScenarioId.has(assumption.scenarioId)) {
      throw new RangeError(
        `duplicate synthetic hit assumption for scenario ${assumption.scenarioId}`,
      );
    }
    byScenarioId.set(assumption.scenarioId, assumption);
  }

  return byScenarioId;
}

function effectiveMaximumCount(probabilities: readonly number[]): number {
  let maximum = probabilities.length - 1;
  while (maximum > 0 && probabilities[maximum] === 0) maximum -= 1;
  return maximum;
}

function syntheticAllOnesRetention(
  input: SyntheticBatterHitsDistributionInput,
  scenarioId: string,
  lineupSlot: 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9,
  slotProbabilities: readonly number[],
): StarterRetentionState {
  const maximumCount = effectiveMaximumCount(slotProbabilities);
  if (maximumCount < 1) {
    throw new RangeError(
      'synthetic Batter Hits requires positive batting-slot opportunity support',
    );
  }
  return createStarterRetentionState({
    scenarioSetId: input.scenarioSet.scenarioSetId,
    scenarioSetVersion: input.scenarioSet.version,
    gameId: input.scenarioSet.gameId,
    scenarioId,
    teamId: input.teamId,
    lineupSlot,
    version: 'synthetic-test-only-no-substitution-v1',
    conditionalRetention: Array<number>(maximumCount).fill(1),
  });
}

export function buildSyntheticBatterHitsDistribution(
  input: SyntheticBatterHitsDistributionInput,
): SyntheticBatterHitsDistribution {
  assertSyntheticSourceKind(input.sourceKind);
  if (input.scenarioSet === undefined || input.scenarioSet === null) {
    throw new RangeError('shared GameScenarioSet is required');
  }
  assertNonEmpty(input.teamId, 'synthetic teamId');
  assertNonEmpty(input.playerId, 'synthetic playerId');
  assertSharedScenarioReference(
    input.scenarioSet,
    input.sharedScenarioReference,
  );

  const assumptionsByScenarioId = indexScenarioAssumptions(
    input.scenarioAssumptions,
  );
  if (assumptionsByScenarioId.size !== input.scenarioSet.scenarios.length) {
    throw new RangeError(
      'one synthetic hit assumption is required for every shared game scenario',
    );
  }

  const scenarios: SyntheticBatterHitsScenarioDistribution[] =
    input.scenarioSet.scenarios.map((scenario) => {
      const syntheticAssumption = assumptionsByScenarioId.get(
        scenario.scenarioId,
      );
      if (syntheticAssumption === undefined) {
        throw new RangeError(
          `missing synthetic hit assumption for scenario ${scenario.scenarioId}`,
        );
      }

      const deriveOutcomeAssumption = (context: SharedOutcomeContext) => {
        if (
          context.offensiveEnvironment.environmentId !==
          syntheticAssumption.offensiveEnvironmentId
        ) {
          throw new RangeError(
            `synthetic hit assumption for ${scenario.scenarioId} must reference its shared offensive environment`,
          );
        }
        return validateUnitIntervalVector(
          syntheticAssumption.perOpportunityHitProbabilities,
          `synthetic per-opportunity hit probabilities for ${scenario.scenarioId}`,
        );
      };

      const slotAssumptions = deriveJointHitterScenarioAssumptions(
        input.scenarioSet,
        scenario.scenarioId,
        input.teamId,
        input.playerId,
        deriveOutcomeAssumption,
      );
      const retention =
        syntheticAssumption.starterRetention ??
        syntheticAllOnesRetention(
          input,
          scenario.scenarioId,
          slotAssumptions.lineupSlot,
          slotAssumptions.opportunityCountDistribution.probabilities,
        );
      const jointAssumptions = deriveJointNamedHitterScenarioAssumptions(
        input.scenarioSet,
        scenario.scenarioId,
        input.teamId,
        input.playerId,
        retention,
        deriveOutcomeAssumption,
      );

      const perOpportunityHitProbabilities =
        jointAssumptions.outcomeAssumption;
      const hitDistribution = mixBernoulliOutcomesOverCountDistribution(
        jointAssumptions.opportunityCountDistribution,
        perOpportunityHitProbabilities,
      );

      return Object.freeze({
        scenarioId: scenario.scenarioId,
        weight: scenario.weight,
        offensiveEnvironmentId: jointAssumptions.offensiveEnvironmentId,
        starterRetentionVersion: jointAssumptions.starterRetentionVersion,
        slotOpportunityCountDistribution:
          jointAssumptions.slotOpportunityCountDistribution,
        opportunityCountDistribution:
          jointAssumptions.opportunityCountDistribution,
        perOpportunityHitProbabilities,
        hitDistribution,
      });
    });

  const opportunityDistribution = mixProbabilityMassFunctions(
    scenarios.map((scenario) => ({
      weight: scenario.weight,
      distribution: scenario.opportunityCountDistribution,
    })),
  );
  const statisticDistribution = mixProbabilityMassFunctions(
    scenarios.map((scenario) => ({
      weight: scenario.weight,
      distribution: scenario.hitDistribution,
    })),
  );

  return Object.freeze({
    sourceKind: SYNTHETIC_BATTER_HITS_SOURCE_KIND,
    sharedScenarioReference: input.sharedScenarioReference,
    teamId: input.teamId,
    playerId: input.playerId,
    opportunityDistribution,
    statisticDistribution,
    scenarios: Object.freeze(scenarios),
  });
}
