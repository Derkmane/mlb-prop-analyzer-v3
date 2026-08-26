import type { ProductCategoryId } from './product-display-contract.js';

export const CATEGORY_PERFORMANCE_REPORT_VERSION = 1 as const;
export const CATEGORY_PERFORMANCE_REPORT_TYPE =
  'product-category-performance-v1' as const;

export interface ProductCategoryPerformanceSummary {
  readonly gradedPicks: number;
  readonly wins: number;
  readonly losses: number;
  readonly voids: number;
  readonly decidedPicks: number;
  readonly winRate: number | null;
}

export interface ProductCategoryPerformanceEvidence {
  readonly reportVersion: typeof CATEGORY_PERFORMANCE_REPORT_VERSION;
  readonly reportType: typeof CATEGORY_PERFORMANCE_REPORT_TYPE;
  readonly generatedAt: string;
  readonly productDisplayBoardVersion: string;
  readonly sourceSetSha256: string;
  readonly pairedCapturesIncluded: number;
  readonly firstCaptureAt: string | null;
  readonly lastCaptureAt: string | null;
  readonly categories: Readonly<Record<ProductCategoryId, ProductCategoryPerformanceSummary>>;
  readonly safety: Readonly<{
    evidenceOnly: true;
    archivesModified: false;
    probabilitiesModified: false;
    rankingModified: false;
  }>;
}

export interface ProductCategoryPerformanceRepository {
  readonly readLatest: () => Promise<ProductCategoryPerformanceEvidence | null>;
}
