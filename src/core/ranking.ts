import type { SettlementResult } from '../domain/settlement.js';
import { validateProbability } from './probability-validation.js';

export interface RankableProbabilityPair {
  readonly pWinGivenGrades: number;
  readonly pVoid: number;
}

function rankableWinProbability(value: number | null): number {
  if (value === null) {
    throw new RangeError('a fully void settlement result is not rankable');
  }

  return validateProbability(value, 'win probability given grades');
}

/**
 * Canonical comparator for any already-settled selected-side output.
 * Orders only by P(Win | grades) descending, then P(Void) ascending.
 */
export function compareRankableProbabilitiesForRanking(
  left: Readonly<RankableProbabilityPair>,
  right: Readonly<RankableProbabilityPair>,
): number {
  const leftWinGivenGrades = rankableWinProbability(left.pWinGivenGrades);
  const rightWinGivenGrades = rankableWinProbability(right.pWinGivenGrades);
  const leftVoid = validateProbability(left.pVoid, 'left void probability');
  const rightVoid = validateProbability(right.pVoid, 'right void probability');

  if (leftWinGivenGrades > rightWinGivenGrades) return -1;
  if (leftWinGivenGrades < rightWinGivenGrades) return 1;
  if (leftVoid < rightVoid) return -1;
  if (leftVoid > rightVoid) return 1;
  return 0;
}

/**
 * Orders selected sides only by P(Win | grades) descending, then P(Void)
 * ascending. Exact ties remain ties so callers retain deterministic stable order.
 */
export function compareSettlementResultsForRanking(
  left: SettlementResult,
  right: SettlementResult,
): number {
  return compareRankableProbabilitiesForRanking(
    {
      pWinGivenGrades: rankableWinProbability(left.winProbabilityGivenGrades),
      pVoid: left.voidProbability,
    },
    {
      pWinGivenGrades: rankableWinProbability(right.winProbabilityGivenGrades),
      pVoid: right.voidProbability,
    },
  );
}
