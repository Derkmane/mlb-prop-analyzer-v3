import {
  hitterSurvivalToCountProbabilityMassFunction,
  validateUnitIntervalVector,
} from '../core/index.js';
import type { ProbabilityMassFunction } from '../domain/probability.js';
import type {
  HitterPASurvivalState,
  LineupSlot,
  SurvivalAdjustmentMethod,
} from './contracts.js';

export interface HitterPASurvivalInput {
  readonly lineupSlot: LineupSlot;
  readonly rawSurvival: readonly number[];
  readonly weights?: readonly number[];
}

interface IsotonicBlock {
  readonly start: number;
  readonly end: number;
  readonly totalWeight: number;
  readonly weightedSum: number;
}

function blockMean(block: IsotonicBlock): number {
  return block.weightedSum / block.totalWeight;
}

function validateLineupSlot(lineupSlot: number): asserts lineupSlot is LineupSlot {
  if (!Number.isInteger(lineupSlot) || lineupSlot < 1 || lineupSlot > 9) {
    throw new RangeError('lineupSlot must be an integer from 1 through 9');
  }
}

function validateWeights(
  rawSurvival: readonly number[],
  weights: readonly number[] | undefined,
): readonly number[] {
  if (weights === undefined) {
    return Object.freeze(rawSurvival.map(() => 1));
  }

  if (weights.length !== rawSurvival.length) {
    throw new RangeError('survival weights must match the survival-curve length');
  }

  return Object.freeze(
    weights.map((weight, index) => {
      if (!Number.isFinite(weight) || weight <= 0) {
        throw new RangeError(`survival weights[${index}] must be finite and positive`);
      }
      return weight;
    }),
  );
}

function projectWeightedNonIncreasing(
  values: readonly number[],
  weights: readonly number[],
): readonly number[] {
  const blocks: IsotonicBlock[] = [];

  for (const [index, value] of values.entries()) {
    const weight = weights[index];
    if (weight === undefined) {
      throw new RangeError('missing isotonic weight');
    }

    blocks.push({
      start: index,
      end: index,
      totalWeight: weight,
      weightedSum: value * weight,
    });

    while (blocks.length >= 2) {
      const right = blocks[blocks.length - 1];
      const left = blocks[blocks.length - 2];
      if (left === undefined || right === undefined) {
        throw new RangeError('invalid isotonic block state');
      }

      if (blockMean(left) >= blockMean(right)) {
        break;
      }

      blocks.splice(blocks.length - 2, 2, {
        start: left.start,
        end: right.end,
        totalWeight: left.totalWeight + right.totalWeight,
        weightedSum: left.weightedSum + right.weightedSum,
      });
    }
  }

  const projected = Array<number>(values.length).fill(0);
  for (const block of blocks) {
    const mean = blockMean(block);
    for (let index = block.start; index <= block.end; index += 1) {
      projected[index] = mean;
    }
  }

  return Object.freeze(projected);
}

function adjustmentMethod(
  rawSurvival: readonly number[],
  adjustedSurvival: readonly number[],
): SurvivalAdjustmentMethod {
  return rawSurvival.some(
    (value, index) => value !== adjustedSurvival[index],
  )
    ? 'weighted-isotonic'
    : 'none';
}

export function createHitterPASurvivalState(
  input: HitterPASurvivalInput,
): HitterPASurvivalState {
  validateLineupSlot(input.lineupSlot);

  const rawSurvival = validateUnitIntervalVector(
    input.rawSurvival,
    'raw hitter PA survival',
  );
  const weights = validateWeights(rawSurvival, input.weights);
  const adjustedSurvival = projectWeightedNonIncreasing(rawSurvival, weights);
  const method = adjustmentMethod(rawSurvival, adjustedSurvival);

  return Object.freeze({
    lineupSlot: input.lineupSlot,
    rawSurvival,
    adjustedSurvival,
    adjustmentMethod: method,
    adjustmentVersion:
      method === 'weighted-isotonic' ? 'weighted-isotonic-v1' : 'none-v1',
  });
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
