import type { PredictionCandidate } from '../domain/prediction-candidate.js';
import {
  selectOfferTypeCategoryV1,
  type CategoryOfferInput,
} from './offer-type-category.js';

export const HIGH_PROBABILITY_BASELINE_CATEGORY_ID =
  'high-probability-baseline-props' as const;

export interface HighProbabilityBaselineSelectionV1<
  TCandidate extends PredictionCandidate<unknown>,
> {
  readonly categoryId: typeof HIGH_PROBABILITY_BASELINE_CATEGORY_ID;
  readonly eligibleCandidates: readonly CategoryOfferInput<TCandidate>[];
  readonly ineligibleCandidates: readonly CategoryOfferInput<TCandidate>[];
}

/** Selects only baseline offers using the canonical category ordering. */
export function selectHighProbabilityBaselinePropsV1<
  TCandidate extends PredictionCandidate<unknown>,
>(
  inputs: readonly Readonly<CategoryOfferInput<TCandidate>>[],
): HighProbabilityBaselineSelectionV1<TCandidate> {
  const selection = selectOfferTypeCategoryV1(inputs, 'baseline');
  return Object.freeze({
    categoryId: HIGH_PROBABILITY_BASELINE_CATEGORY_ID,
    eligibleCandidates: selection.eligibleCandidates,
    ineligibleCandidates: selection.ineligibleCandidates,
  });
}
