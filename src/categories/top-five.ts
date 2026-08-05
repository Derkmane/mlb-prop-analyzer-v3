export const TOP_FIVE_LIMIT = 5 as const;

/**
 * Returns the first five already-eligible, already-sorted picks. Top Five does
 * not sort, deduplicate, settle, or alter any candidate or probability.
 */
export function selectTopFiveV1<TCandidate>(
  eligibleCandidates: readonly TCandidate[],
): readonly TCandidate[] {
  return Object.freeze(eligibleCandidates.slice(0, TOP_FIVE_LIMIT));
}
