import type { SettlementResult } from '../domain/settlement.js';
import { validateProbability } from './probability-validation.js';

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
 * ascending. Exact ties remain ties so callers retain deterministic stable order.
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

  if (leftWinGivenGrades > rightWinGivenGrades) {
    return -1;
  }
  if (leftWinGivenGrades < rightWinGivenGrades) {
    return 1;
  }
  if (leftVoid < rightVoid) {
    return -1;
  }
  if (leftVoid > rightVoid) {
    return 1;
  }

  return 0;
}
