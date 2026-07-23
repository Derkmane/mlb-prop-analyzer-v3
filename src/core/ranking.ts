import type { SettlementResult } from '../domain/settlement.js';
import {
  PROBABILITY_TOLERANCE,
  validateProbability,
} from './probability-validation.js';

function rankableWinProbability(result: SettlementResult): number {
  if (result.winProbabilityGivenGrades === null) {
    throw new RangeError('a fully void settlement result is not rankable');
  }

  return validateProbability(
    result.winProbabilityGivenGrades,
    'win probability given grades',
  );
}

/**
 * Orders selected sides only by P(Win | grades) descending, then P(Void)
 * ascending. Differences within the approved numerical tolerance are treated
 * as equal so floating-point noise cannot bypass the required tiebreak.
 */
export function compareSettlementResultsForRanking(
  left: SettlementResult,
  right: SettlementResult,
): number {
  const leftWinGivenGrades = rankableWinProbability(left);
  const rightWinGivenGrades = rankableWinProbability(right);
  const leftVoid = validateProbability(left.voidProbability, 'left void probability');
  const rightVoid = validateProbability(
    right.voidProbability,
    'right void probability',
  );
  const winProbabilityDifference = leftWinGivenGrades - rightWinGivenGrades;

  if (Math.abs(winProbabilityDifference) > PROBABILITY_TOLERANCE) {
    return winProbabilityDifference > 0 ? -1 : 1;
  }

  const voidProbabilityDifference = leftVoid - rightVoid;
  if (Math.abs(voidProbabilityDifference) > PROBABILITY_TOLERANCE) {
    return voidProbabilityDifference < 0 ? -1 : 1;
  }

  return 0;
}
