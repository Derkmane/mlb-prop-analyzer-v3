import {
  hitterSurvivalToCountProbabilityMassFunction,
  validateProbabilityMassFunction,
} from '../core/index.js';
import type { ProbabilityMassFunction } from '../domain/probability.js';
import type {
  GameScenarioSet,
  JointNamedHitterScenarioAssumptions,
  LineupSlot,
  StarterRetentionState,
} from './contracts.js';
import { deriveJointHitterScenarioAssumptions } from './scenario-set.js';

const RETENTION_TOLERANCE = 1e-12;

function assertNonEmpty(value: string, label: string): void {
  if (value.trim().length === 0) {
    throw new RangeError(`${label} must not be empty`);
  }
}

function validateLineupSlot(lineupSlot: number): asserts lineupSlot is LineupSlot {
  if (!Number.isInteger(lineupSlot) || lineupSlot < 1 || lineupSlot > 9) {
    throw new RangeError('lineupSlot must be an integer from 1 through 9');
  }
}

function effectiveMaximumCount(distribution: ProbabilityMassFunction): number {
  let maximum = distribution.probabilities.length - 1;
  while (maximum > 0 && distribution.probabilities[maximum] === 0) {
    maximum -= 1;
  }
  return maximum;
}

function survivalFromCountDistribution(
  distribution: ProbabilityMassFunction,
): readonly number[] {
  const validated = validateProbabilityMassFunction(
    distribution,
    'batting-slot opportunity distribution',
  );
  const maximum = effectiveMaximumCount(validated);
  const survival: number[] = [];
  for (let count = 1; count <= maximum; count += 1) {
    survival.push(
      validated.probabilities
        .slice(count, maximum + 1)
        .reduce((sum, mass) => sum + mass, 0),
    );
  }
  return Object.freeze(survival);
}

export function createStarterRetentionState(
  input: StarterRetentionState,
): StarterRetentionState {
  assertNonEmpty(input.scenarioSetId, 'starter retention scenarioSetId');
  assertNonEmpty(
    input.scenarioSetVersion,
    'starter retention scenarioSetVersion',
  );
  assertNonEmpty(input.gameId, 'starter retention gameId');
  assertNonEmpty(input.scenarioId, 'starter retention scenarioId');
  assertNonEmpty(input.teamId, 'starter retention teamId');
  validateLineupSlot(input.lineupSlot);
  assertNonEmpty(input.version, 'starter retention version');

  if (input.conditionalRetention.length === 0) {
    throw new RangeError('starter retention must contain at least the first turn');
  }
  const conditionalRetention = input.conditionalRetention.map((value, index) => {
    if (!Number.isFinite(value) || value <= 0 || value > 1) {
      throw new RangeError(
        `starter retention turn ${index + 1} must be greater than 0 and at most 1`,
      );
    }
    return value;
  });
  if (Math.abs((conditionalRetention[0] ?? Number.NaN) - 1) > RETENTION_TOLERANCE) {
    throw new RangeError(
      'starter retention for the first turn must equal 1 because pregame eligibility is separate',
    );
  }

  return Object.freeze({
    scenarioSetId: input.scenarioSetId,
    scenarioSetVersion: input.scenarioSetVersion,
    gameId: input.gameId,
    scenarioId: input.scenarioId,
    teamId: input.teamId,
    lineupSlot: input.lineupSlot,
    version: input.version,
    conditionalRetention: Object.freeze(conditionalRetention),
  });
}

export function deriveNamedHitterOpportunityCountDistribution(
  slotOpportunityCountDistribution: ProbabilityMassFunction,
  rawRetention: StarterRetentionState,
): ProbabilityMassFunction {
  const retention = createStarterRetentionState(rawRetention);
  const slotSurvival = survivalFromCountDistribution(
    slotOpportunityCountDistribution,
  );
  if (retention.conditionalRetention.length !== slotSurvival.length) {
    throw new RangeError(
      'starter retention length must match the batting-slot opportunity support',
    );
  }

  let cumulativeRetention = 1;
  const namedPlayerSurvival = slotSurvival.map((slotProbability, index) => {
    const conditional = retention.conditionalRetention[index];
    if (conditional === undefined) {
      throw new RangeError('starter retention is missing a required turn');
    }
    cumulativeRetention *= conditional;
    return slotProbability * cumulativeRetention;
  });

  return hitterSurvivalToCountProbabilityMassFunction(namedPlayerSurvival);
}

function assertRetentionMatchesSharedScenario(
  retention: StarterRetentionState,
  scenarioSet: GameScenarioSet,
  scenarioId: string,
  teamId: string,
  lineupSlot: LineupSlot,
): void {
  if (
    retention.scenarioSetId !== scenarioSet.scenarioSetId ||
    retention.scenarioSetVersion !== scenarioSet.version ||
    retention.gameId !== scenarioSet.gameId ||
    retention.scenarioId !== scenarioId ||
    retention.teamId !== teamId ||
    retention.lineupSlot !== lineupSlot
  ) {
    throw new RangeError(
      'starter retention must reference the exact shared scenario, team, and batting slot',
    );
  }
}

export function deriveJointNamedHitterScenarioAssumptions<TOutcomeAssumption>(
  scenarioSet: GameScenarioSet,
  scenarioId: string,
  teamId: string,
  playerId: string,
  rawRetention: StarterRetentionState,
  deriveOutcomeAssumption: Parameters<
    typeof deriveJointHitterScenarioAssumptions<TOutcomeAssumption>
  >[4],
): JointNamedHitterScenarioAssumptions<TOutcomeAssumption> {
  const slotAssumptions = deriveJointHitterScenarioAssumptions(
    scenarioSet,
    scenarioId,
    teamId,
    playerId,
    deriveOutcomeAssumption,
  );
  const retention = createStarterRetentionState(rawRetention);
  assertRetentionMatchesSharedScenario(
    retention,
    scenarioSet,
    scenarioId,
    teamId,
    slotAssumptions.lineupSlot,
  );
  const namedPlayerDistribution = deriveNamedHitterOpportunityCountDistribution(
    slotAssumptions.opportunityCountDistribution,
    retention,
  );

  return Object.freeze({
    scenarioSetId: slotAssumptions.scenarioSetId,
    scenarioSetVersion: slotAssumptions.scenarioSetVersion,
    gameId: slotAssumptions.gameId,
    scenarioId: slotAssumptions.scenarioId,
    teamId: slotAssumptions.teamId,
    playerId: slotAssumptions.playerId,
    lineupSlot: slotAssumptions.lineupSlot,
    offensiveEnvironmentId: slotAssumptions.offensiveEnvironmentId,
    starterRetentionVersion: retention.version,
    slotOpportunityCountDistribution:
      slotAssumptions.opportunityCountDistribution,
    opportunityCountDistribution: namedPlayerDistribution,
    outcomeAssumption: slotAssumptions.outcomeAssumption,
  });
}
