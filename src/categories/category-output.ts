import type { CategoryRankableCandidate } from './category-ranking.js';

export const CATEGORY_OUTPUT_LIMIT = 20 as const;
export const CATEGORY_MIN_WIN_PROBABILITY_EXCLUSIVE = 0.5 as const;

/**
 * Applies the universal product-category win-probability floor and output cap
 * to an already-eligible, already-deduplicated, already-sorted candidate list.
 * This function does not sort, settle, or alter any candidate or probability.
 */
export function selectCategoryOutputV1<TCandidate extends CategoryRankableCandidate>(
  eligibleCandidates: readonly TCandidate[],
): readonly TCandidate[] {
  return Object.freeze(
    eligibleCandidates
      .filter(
        (candidate) =>
          candidate.pWinGivenGrades !== null &&
          candidate.pWinGivenGrades > CATEGORY_MIN_WIN_PROBABILITY_EXCLUSIVE,
      )
      .slice(0, CATEGORY_OUTPUT_LIMIT),
  );
}
