import type { CategoryRankableCandidate } from './category-ranking.js';
import {
  selectOfferTypeCategoryV1,
  type CategoryOfferInput,
} from './offer-type-category.js';

export const HIGH_PROBABILITY_ALTLINE_CATEGORY_ID =
  'high-probability-altline-props' as const;

export interface HighProbabilityAltlineSelectionV1<
  TCandidate extends CategoryRankableCandidate,
> {
  readonly categoryId: typeof HIGH_PROBABILITY_ALTLINE_CATEGORY_ID;
  readonly eligibleCandidates: readonly CategoryOfferInput<TCandidate>[];
  readonly ineligibleCandidates: readonly CategoryOfferInput<TCandidate>[];
}

/** Selects only alternate offers using the canonical category ordering. */
export function selectHighProbabilityAltlinePropsV1<
  TCandidate extends CategoryRankableCandidate,
>(
  inputs: readonly Readonly<CategoryOfferInput<TCandidate>>[],
): HighProbabilityAltlineSelectionV1<TCandidate> {
  const selection = selectOfferTypeCategoryV1(inputs, 'alternate');
  return Object.freeze({
    categoryId: HIGH_PROBABILITY_ALTLINE_CATEGORY_ID,
    eligibleCandidates: selection.eligibleCandidates,
    ineligibleCandidates: selection.ineligibleCandidates,
  });
}
