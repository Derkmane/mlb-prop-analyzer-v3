import {
  hitterSurvivalToCountProbabilityMassFunction,
  validateProbabilityMassFunction,
  validateUnitIntervalVector,
} from '../core/index.js';
import type { ProbabilityMassFunction } from '../domain/probability.js';
import type {
  HitterPASurvivalState,
  LineupSlot,
} from './contracts.js';

export interface HitterPASurvivalInput {
  readonly lineupSlot: LineupSlot;
  readonly rawSurvival: readonly number[];
}

function validateLineupSlot(lineupSlot: number): asserts lineupSlot is LineupSlot {
  if (!Number.isInteger(lineupSlot) || lineupSlot < 1 || lineupSlot > 9) {
    throw new RangeError('lineupSlot must be an integer from 1 through 9');
  }
}

function assertMonotoneNonIncreasing(
  values: readonly number[],
  label: string,
): void {
  for (let index = 1; index < values.length; index += 1) {
    const previous = values[index - 1];
    const current = values[index];
    if (previous === undefined || current === undefined) {
      throw new RangeError('invalid survival-vector indexing');
    }
    if (previous < current) {
      throw new RangeError(
        `${label} must be monotone non-increasing; projection is deferred until an evidence-backed policy is fitted and validated`,
      );
    }
  }
}

export function createHitterPASurvivalState(
  input: HitterPASurvivalInput,
): HitterPASurvivalState {
  validateLineupSlot(input.lineupSlot);

  const rawSurvival = validateUnitIntervalVector(
    input.rawSurvival,
    'raw hitter PA survival',
  );
  assertMonotoneNonIncreasing(rawSurvival, 'raw hitter PA survival');
  const adjustedSurvival = Object.freeze([...rawSurvival]);

  return Object.freeze({
    lineupSlot: input.lineupSlot,
    rawSurvival,
    adjustedSurvival,
    adjustmentMethod: 'none',
    adjustmentVersion: 'none-v1',
  });
}

export function deriveLineupSlotSurvivalFromTeamBattersFaced(
  teamBattersFacedDistribution: ProbabilityMassFunction,
  lineupSlot: LineupSlot,
): readonly number[] {
  validateLineupSlot(lineupSlot);
  const distribution = validateProbabilityMassFunction(
    teamBattersFacedDistribution,
    'team batters-faced distribution',
  );
  let maximumTeamBattersFaced = distribution.probabilities.length - 1;
  while (
    maximumTeamBattersFaced > 0 &&
    distribution.probabilities[maximumTeamBattersFaced] === 0
  ) {
    maximumTeamBattersFaced -= 1;
  }
  const survival: number[] = [];

  for (
    let requiredTeamBattersFaced = lineupSlot;
    requiredTeamBattersFaced <= maximumTeamBattersFaced;
    requiredTeamBattersFaced += 9
  ) {
    survival.push(
      distribution.probabilities
        .slice(requiredTeamBattersFaced, maximumTeamBattersFaced + 1)
        .reduce((sum, mass) => sum + mass, 0),
    );
  }

  return Object.freeze(survival);
}

export function hitterOpportunityCountDistribution(
  state: HitterPASurvivalState,
): ProbabilityMassFunction {
  return hitterSurvivalToCountProbabilityMassFunction(state.adjustedSurvival);
}

export function expectedHitterPlateAppearances(
  state: HitterPASurvivalState,
): number {
  return state.adjustedSurvival.reduce((sum, probability) => sum + probability, 0);
}
