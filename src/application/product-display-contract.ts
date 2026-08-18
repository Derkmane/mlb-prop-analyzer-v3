import {
  HIGH_PROBABILITY_ALTLINE_CATEGORY_ID,
  HIGH_PROBABILITY_BASELINE_CATEGORY_ID,
  OPPORTUNITY_MINER_CATEGORY_ID,
} from '../categories/index.js';

export const PRODUCT_DISPLAY_BOARD_VERSION = 'three-category-research-product-v2' as const;
export const PRODUCT_RESEARCH_LABEL = 'UNVALIDATED RESEARCH' as const;
export const PRODUCT_EMPTY_CATEGORY_REASON =
  'No research-authorized pregame prop is available for this category right now.' as const;

export const PRODUCT_CATEGORY_TITLES = Object.freeze({
  [OPPORTUNITY_MINER_CATEGORY_ID]: 'Opportunity Miner Favorites',
  [HIGH_PROBABILITY_BASELINE_CATEGORY_ID]: 'High Probability Baseline Props',
  [HIGH_PROBABILITY_ALTLINE_CATEGORY_ID]: 'High Probability Altline Props',
} as const);

export type ProductCategoryId = keyof typeof PRODUCT_CATEGORY_TITLES;

export interface ProductStarterContext {
  readonly name: string | null;
  readonly hand: string | null;
  readonly era: number | null;
  readonly kRate: number | null;
  readonly recentWorkload: string | null;
}

export interface ProductLastFiveResult {
  readonly gameDate: string;
  readonly opponent: string;
  readonly actual: number;
  readonly outcome: 'cash' | 'miss' | 'void';
}

export interface ProductCalibrationDisclosure {
  readonly status: 'failed' | 'passed' | 'insufficient' | 'pending';
  readonly cohort: string;
  readonly predicted: number | null;
  readonly observed: number | null;
  readonly decidedPicks: number | null;
  readonly message: string;
}

export interface ProductDisplayPick {
  readonly playerId: string;
  readonly player: string;
  readonly team: string;
  readonly opponent: string;
  readonly gameTime: string;
  readonly market: 'Hits' | 'Hits + Runs + RBIs';
  readonly postedLine: number;
  readonly selectedSide: 'higher' | 'lower';
  readonly pWin: number;
  readonly pLoss: number;
  readonly pVoid: number;
  readonly pWinGivenGrades: number;
  readonly probabilityLabel: typeof PRODUCT_RESEARCH_LABEL;
  readonly offerType: 'baseline' | 'alternate';
  readonly lineupStatus: 'confirmed' | 'projected' | null;
  readonly capturedAt: string;
  readonly expectedPlateAppearances: number | null;
  readonly lineupSlot: number | null;
  readonly opposingStarter: ProductStarterContext;
  readonly platoon: string | null;
  readonly teamImpliedRunTotal: number | null;
  readonly park: string | null;
  readonly lastFive: readonly ProductLastFiveResult[];
  readonly calibration: ProductCalibrationDisclosure;
}

export interface ProductCategoryDisplaySection {
  readonly categoryId: ProductCategoryId;
  readonly title: string;
  readonly picks: readonly ProductDisplayPick[];
  readonly emptyState: string | null;
}

export function productCategorySectionV2(
  categoryId: ProductCategoryId,
  picks: readonly ProductDisplayPick[],
): ProductCategoryDisplaySection {
  return Object.freeze({
    categoryId,
    title: PRODUCT_CATEGORY_TITLES[categoryId],
    picks: Object.freeze([...picks]),
    emptyState: picks.length === 0 ? PRODUCT_EMPTY_CATEGORY_REASON : null,
  });
}

/** Compatibility helper retained for fail-closed tests and missing-board state. */
export function emptyProductCategorySectionsV1(): readonly ProductCategoryDisplaySection[] {
  return Object.freeze([
    productCategorySectionV2(OPPORTUNITY_MINER_CATEGORY_ID, []),
    productCategorySectionV2(HIGH_PROBABILITY_BASELINE_CATEGORY_ID, []),
    productCategorySectionV2(HIGH_PROBABILITY_ALTLINE_CATEGORY_ID, []),
  ]);
}
