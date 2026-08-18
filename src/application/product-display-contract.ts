import {
  HIGH_PROBABILITY_ALTLINE_CATEGORY_ID,
  HIGH_PROBABILITY_BASELINE_CATEGORY_ID,
  OPPORTUNITY_MINER_CATEGORY_ID,
} from '../categories/index.js';

export const PRODUCT_DISPLAY_BOARD_VERSION = 'three-category-product-shell-v1' as const;
export const PRODUCT_EMPTY_CATEGORY_REASON =
  'No production-validated market for this category yet.' as const;

export const PRODUCT_CATEGORY_TITLES = Object.freeze({
  [OPPORTUNITY_MINER_CATEGORY_ID]: 'Opportunity Miner Favorites',
  [HIGH_PROBABILITY_BASELINE_CATEGORY_ID]: 'High Probability Baseline Props',
  [HIGH_PROBABILITY_ALTLINE_CATEGORY_ID]: 'High Probability Altline Props',
} as const);

export type ProductCategoryId = keyof typeof PRODUCT_CATEGORY_TITLES;

export interface ProductDisplayPick {
  readonly player: string;
  readonly team: string;
  readonly opponent: string;
  readonly gameTime: string;
  readonly market: string;
  readonly postedLine: number;
  readonly selectedSide: 'higher' | 'lower';
  readonly pWin: number;
  readonly pLoss: number;
  readonly pVoid: number;
  readonly pWinGivenGrades: number;
  readonly offerType: 'baseline' | 'alternate';
  readonly lineupStatus: string;
  readonly capturedAt: string;
}

export interface ProductCategoryDisplaySection {
  readonly categoryId: ProductCategoryId;
  readonly title: string;
  readonly picks: readonly ProductDisplayPick[];
  readonly emptyState: string | null;
}

/**
 * Current fail-closed production view. Category structure is ready, but no
 * production-disabled market may be copied into these arrays.
 */
export function emptyProductCategorySectionsV1(): readonly ProductCategoryDisplaySection[] {
  return Object.freeze([
    Object.freeze({
      categoryId: OPPORTUNITY_MINER_CATEGORY_ID,
      title: PRODUCT_CATEGORY_TITLES[OPPORTUNITY_MINER_CATEGORY_ID],
      picks: Object.freeze([]),
      emptyState: PRODUCT_EMPTY_CATEGORY_REASON,
    }),
    Object.freeze({
      categoryId: HIGH_PROBABILITY_BASELINE_CATEGORY_ID,
      title: PRODUCT_CATEGORY_TITLES[HIGH_PROBABILITY_BASELINE_CATEGORY_ID],
      picks: Object.freeze([]),
      emptyState: PRODUCT_EMPTY_CATEGORY_REASON,
    }),
    Object.freeze({
      categoryId: HIGH_PROBABILITY_ALTLINE_CATEGORY_ID,
      title: PRODUCT_CATEGORY_TITLES[HIGH_PROBABILITY_ALTLINE_CATEGORY_ID],
      picks: Object.freeze([]),
      emptyState: PRODUCT_EMPTY_CATEGORY_REASON,
    }),
  ]);
}
