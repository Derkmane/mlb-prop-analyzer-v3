import type { PredictionCandidate } from '../domain/prediction-candidate.js';
import { comparePredictionCandidatesForCategory } from './category-ranking.js';

export type CategoryOfferType = 'baseline' | 'alternate';

/**
 * Posted offer metadata supplied to category selectors. Diagnostic price
 * evidence is preserved but is never read by the ranking comparator.
 */
export interface CategoryOfferInput<
  TCandidate extends PredictionCandidate<unknown>,
> {
  readonly candidate: TCandidate;
  readonly offerType: CategoryOfferType;
  readonly americanPrice: number;
  readonly multiplier: number;
  readonly postedImpliedProbability: number;
  readonly priceEdge: number;
}

export interface OfferTypeCategorySelectionV1<
  TCandidate extends PredictionCandidate<unknown>,
> {
  readonly eligibleCandidates: readonly CategoryOfferInput<TCandidate>[];
  readonly ineligibleCandidates: readonly CategoryOfferInput<TCandidate>[];
}

function compareInputs(
  left: CategoryOfferInput<PredictionCandidate<unknown>>,
  right: CategoryOfferInput<PredictionCandidate<unknown>>,
): number {
  return comparePredictionCandidatesForCategory(
    left.candidate,
    right.candidate,
  );
}

/**
 * Filters by exact offer type, deduplicates to one prop per player, and sorts
 * only by final P(Win | grades), then P(Void), through the core comparator.
 */
export function selectOfferTypeCategoryV1<
  TCandidate extends PredictionCandidate<unknown>,
>(
  inputs: readonly Readonly<CategoryOfferInput<TCandidate>>[],
  requiredOfferType: CategoryOfferType,
): OfferTypeCategorySelectionV1<TCandidate> {
  const eligibleInputs = inputs.filter(
    (input) => input.offerType === requiredOfferType,
  );
  const ineligibleInputs = inputs.filter(
    (input) => input.offerType !== requiredOfferType,
  );

  const bestByPlayer = new Map<string, CategoryOfferInput<TCandidate>>();
  for (const input of eligibleInputs) {
    const incumbent = bestByPlayer.get(input.candidate.playerId);
    if (incumbent === undefined || compareInputs(input, incumbent) < 0) {
      bestByPlayer.set(input.candidate.playerId, input);
    }
  }

  return Object.freeze({
    eligibleCandidates: Object.freeze(
      [...bestByPlayer.values()].sort(compareInputs),
    ),
    ineligibleCandidates: Object.freeze([...ineligibleInputs]),
  });
}
