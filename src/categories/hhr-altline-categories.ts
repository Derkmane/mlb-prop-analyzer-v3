import {
  comparePredictionCandidatesForCategory,
  type CategoryRankableCandidate,
} from './category-ranking.js';
import type { CategoryOfferType } from './offer-type-category.js';

export const HHR_25_LOWER_ALT_CATEGORY_ID = 'hhr-2.5-lower-alt' as const;
export const HHR_05_HIGHER_ALT_CATEGORY_ID = 'hhr-0.5-higher-alt' as const;
export const HHR_25_LOWER_ALT_CATEGORY_TITLE = 'HHR 2.5 Lower Alt' as const;
export const HHR_05_HIGHER_ALT_CATEGORY_TITLE = 'HHR 0.5 Higher Alt' as const;
export const HHR_ALTLINE_CATEGORY_LIMIT = 20 as const;

export type HhrAltlineCategoryId =
  | typeof HHR_25_LOWER_ALT_CATEGORY_ID
  | typeof HHR_05_HIGHER_ALT_CATEGORY_ID;

export type HhrAltlineCategoryExclusionReason =
  | 'not-alternate'
  | 'line-mismatch'
  | 'side-mismatch'
  | 'unrankable-probability'
  | 'duplicate-player'
  | 'top-20-cut';

/**
 * Category input deliberately excludes price, multiplier, lineup status, and
 * every model input. Those values may travel beside this object for evidence
 * and display, but the selector has no contract through which to read them.
 */
export interface HhrAltlineCategoryOfferInput<
  TCandidate extends CategoryRankableCandidate,
> {
  readonly candidate: TCandidate;
  readonly offerType: CategoryOfferType;
}

export interface HhrAltlineCategoryExclusionCounts {
  readonly notAlternate: number;
  readonly lineMismatch: number;
  readonly sideMismatch: number;
  readonly unrankableProbability: number;
  readonly duplicatePlayer: number;
  readonly top20Cut: number;
}

export interface HhrAltlineCategorySelectionV1<
  TCandidate extends CategoryRankableCandidate,
> {
  readonly categoryId: HhrAltlineCategoryId;
  readonly categoryTitle:
    | typeof HHR_25_LOWER_ALT_CATEGORY_TITLE
    | typeof HHR_05_HIGHER_ALT_CATEGORY_TITLE;
  readonly requiredLine: 2.5 | 0.5;
  readonly requiredSide: 'lower' | 'higher';
  /** Exact posted alternate offers at the required line and side before fail-closed checks. */
  readonly postedExactOfferCount: number;
  /** Rankable one-per-player offers before the top-20 cut. */
  readonly availableOfferCount: number;
  readonly selectedCandidates: readonly HhrAltlineCategoryOfferInput<TCandidate>[];
  readonly exclusionCounts: Readonly<HhrAltlineCategoryExclusionCounts>;
}

interface HhrAltlineCategorySpec {
  readonly categoryId: HhrAltlineCategoryId;
  readonly categoryTitle:
    | typeof HHR_25_LOWER_ALT_CATEGORY_TITLE
    | typeof HHR_05_HIGHER_ALT_CATEGORY_TITLE;
  readonly requiredLine: 2.5 | 0.5;
  readonly requiredSide: 'lower' | 'higher';
}

function compareInputs<TCandidate extends CategoryRankableCandidate>(
  left: HhrAltlineCategoryOfferInput<TCandidate>,
  right: HhrAltlineCategoryOfferInput<TCandidate>,
): number {
  return comparePredictionCandidatesForCategory(left.candidate, right.candidate);
}

function selectHhrExactAltlineCategoryV1<
  TCandidate extends CategoryRankableCandidate,
>(
  inputs: readonly Readonly<HhrAltlineCategoryOfferInput<TCandidate>>[],
  spec: Readonly<HhrAltlineCategorySpec>,
): HhrAltlineCategorySelectionV1<TCandidate> {
  let notAlternate = 0;
  let lineMismatch = 0;
  let sideMismatch = 0;
  let unrankableProbability = 0;
  let postedExactOfferCount = 0;
  const rankableExact: HhrAltlineCategoryOfferInput<TCandidate>[] = [];

  for (const input of inputs) {
    if (input.offerType !== 'alternate') {
      notAlternate += 1;
      continue;
    }
    if (input.candidate.line !== spec.requiredLine) {
      lineMismatch += 1;
      continue;
    }
    if (input.candidate.selectedSide !== spec.requiredSide) {
      sideMismatch += 1;
      continue;
    }

    postedExactOfferCount += 1;
    if (input.candidate.pWinGivenGrades === null) {
      unrankableProbability += 1;
      continue;
    }
    rankableExact.push(input);
  }

  const bestByPlayer = new Map<
    string,
    HhrAltlineCategoryOfferInput<TCandidate>
  >();
  let duplicatePlayer = 0;
  for (const input of rankableExact) {
    const incumbent = bestByPlayer.get(input.candidate.playerId);
    if (incumbent === undefined) {
      bestByPlayer.set(input.candidate.playerId, input);
      continue;
    }
    duplicatePlayer += 1;
    if (compareInputs(input, incumbent) < 0) {
      bestByPlayer.set(input.candidate.playerId, input);
    }
  }

  const available = [...bestByPlayer.values()].sort(compareInputs);
  const selectedCandidates = Object.freeze(
    available.slice(0, HHR_ALTLINE_CATEGORY_LIMIT),
  );
  const top20Cut = Math.max(0, available.length - selectedCandidates.length);

  return Object.freeze({
    categoryId: spec.categoryId,
    categoryTitle: spec.categoryTitle,
    requiredLine: spec.requiredLine,
    requiredSide: spec.requiredSide,
    postedExactOfferCount,
    availableOfferCount: available.length,
    selectedCandidates,
    exclusionCounts: Object.freeze({
      notAlternate,
      lineMismatch,
      sideMismatch,
      unrankableProbability,
      duplicatePlayer,
      top20Cut,
    }),
  });
}

/** Selects only exact posted HHR 2.5 Lower alternate offers. */
export function selectHhr25LowerAltV1<
  TCandidate extends CategoryRankableCandidate,
>(
  inputs: readonly Readonly<HhrAltlineCategoryOfferInput<TCandidate>>[],
): HhrAltlineCategorySelectionV1<TCandidate> {
  return selectHhrExactAltlineCategoryV1(inputs, {
    categoryId: HHR_25_LOWER_ALT_CATEGORY_ID,
    categoryTitle: HHR_25_LOWER_ALT_CATEGORY_TITLE,
    requiredLine: 2.5,
    requiredSide: 'lower',
  });
}

/** Selects only exact posted HHR 0.5 Higher alternate offers. */
export function selectHhr05HigherAltV1<
  TCandidate extends CategoryRankableCandidate,
>(
  inputs: readonly Readonly<HhrAltlineCategoryOfferInput<TCandidate>>[],
): HhrAltlineCategorySelectionV1<TCandidate> {
  return selectHhrExactAltlineCategoryV1(inputs, {
    categoryId: HHR_05_HIGHER_ALT_CATEGORY_ID,
    categoryTitle: HHR_05_HIGHER_ALT_CATEGORY_TITLE,
    requiredLine: 0.5,
    requiredSide: 'higher',
  });
}
