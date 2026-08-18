import { compareRankableProbabilitiesForRanking } from '../core/index.js';
import type { Probability } from '../domain/probability.js';

/** Minimum immutable fields a category is permitted to inspect for ranking. */
export interface CategoryRankableCandidate {
  readonly playerId: string;
  readonly pVoid: Probability;
  readonly pWinGivenGrades: Probability | null;
}

/**
 * The only categories-layer adapter to the canonical core comparator.
 * Categories may filter, deduplicate, sort, and select, but they may not
 * introduce a second ranking rule or alter candidate probabilities.
 */
export function comparePredictionCandidatesForCategory(
  left: CategoryRankableCandidate,
  right: CategoryRankableCandidate,
): number {
  if (left.pWinGivenGrades === null || right.pWinGivenGrades === null) {
    throw new RangeError('fully void category candidates are not rankable');
  }
  return compareRankableProbabilitiesForRanking(
    { pWinGivenGrades: left.pWinGivenGrades, pVoid: left.pVoid },
    { pWinGivenGrades: right.pWinGivenGrades, pVoid: right.pVoid },
  );
}

/** Deduplicates to one prop per player and applies the canonical ordering. */
export function deduplicateAndSortPredictionCandidatesForCategory<
  TCandidate extends CategoryRankableCandidate,
>(candidates: readonly TCandidate[]): readonly TCandidate[] {
  const bestByPlayer = new Map<string, TCandidate>();
  for (const candidate of candidates) {
    const incumbent = bestByPlayer.get(candidate.playerId);
    if (
      incumbent === undefined ||
      comparePredictionCandidatesForCategory(candidate, incumbent) < 0
    ) {
      bestByPlayer.set(candidate.playerId, candidate);
    }
  }

  return Object.freeze(
    [...bestByPlayer.values()].sort(comparePredictionCandidatesForCategory),
  );
}
