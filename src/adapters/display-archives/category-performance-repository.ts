import { readFile, readdir } from 'node:fs/promises';
import path from 'node:path';

import {
  CATEGORY_PERFORMANCE_REPORT_TYPE,
  CATEGORY_PERFORMANCE_REPORT_VERSION,
  PRODUCT_CATEGORY_TITLES,
  type ProductCategoryId,
  type ProductCategoryPerformanceEvidence,
  type ProductCategoryPerformanceRepository,
  type ProductCategoryPerformanceSummary,
} from '../../application/index.js';

export const CATEGORY_PERFORMANCE_DISPLAY_ROOT =
  'artifacts/display-archives/category-performance' as const;

const REPORT_PATTERN =
  /^product-category-performance-v1--([a-f0-9]{64})\.json$/u;

function record(value: unknown, label: string): Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new TypeError(`${label} must be an object.`);
  }
  return value as Record<string, unknown>;
}

function nonnegativeInteger(value: unknown, label: string): number {
  if (!Number.isSafeInteger(value) || (value as number) < 0) {
    throw new TypeError(`${label} must be a non-negative safe integer.`);
  }
  return value as number;
}

function timestampOrNull(value: unknown, label: string): string | null {
  if (value === null) return null;
  if (typeof value !== 'string' || !Number.isFinite(Date.parse(value))) {
    throw new TypeError(`${label} must be an ISO timestamp or null.`);
  }
  return value;
}

function summary(value: unknown, label: string): ProductCategoryPerformanceSummary {
  const source = record(value, label);
  const gradedPicks = nonnegativeInteger(source['gradedPicks'], `${label}.gradedPicks`);
  const wins = nonnegativeInteger(source['wins'], `${label}.wins`);
  const losses = nonnegativeInteger(source['losses'], `${label}.losses`);
  const voids = nonnegativeInteger(source['voids'], `${label}.voids`);
  const decidedPicks = nonnegativeInteger(source['decidedPicks'], `${label}.decidedPicks`);
  if (wins + losses !== decidedPicks || decidedPicks + voids !== gradedPicks) {
    throw new Error(`${label} count totals do not reconcile.`);
  }
  const winRate = source['winRate'];
  if (decidedPicks === 0) {
    if (winRate !== null) throw new Error(`${label}.winRate must be null without decided picks.`);
  } else if (
    typeof winRate !== 'number' ||
    !Number.isFinite(winRate) ||
    Math.abs(winRate - wins / decidedPicks) > 1e-12
  ) {
    throw new Error(`${label}.winRate does not equal wins / decided picks.`);
  }
  return Object.freeze({ gradedPicks, wins, losses, voids, decidedPicks, winRate: winRate as number | null });
}

function parseEvidence(raw: unknown, fileName: string): ProductCategoryPerformanceEvidence {
  const source = record(raw, 'category performance evidence');
  if (
    source['reportVersion'] !== CATEGORY_PERFORMANCE_REPORT_VERSION ||
    source['reportType'] !== CATEGORY_PERFORMANCE_REPORT_TYPE
  ) {
    throw new Error('Category performance report contract is unsupported.');
  }
  const match = REPORT_PATTERN.exec(fileName);
  if (match === null || source['sourceSetSha256'] !== match[1]) {
    throw new Error('Category performance source identity does not match its filename.');
  }
  const generatedAt = timestampOrNull(source['generatedAt'], 'generatedAt');
  if (generatedAt === null) throw new Error('generatedAt is required.');
  if (typeof source['productDisplayBoardVersion'] !== 'string' || source['productDisplayBoardVersion'].length === 0) {
    throw new TypeError('productDisplayBoardVersion must be a nonempty string.');
  }
  const categoriesSource = record(source['categories'], 'categories');
  const categories = {} as Record<ProductCategoryId, ProductCategoryPerformanceSummary>;
  for (const categoryId of Object.keys(PRODUCT_CATEGORY_TITLES) as ProductCategoryId[]) {
    categories[categoryId] = summary(categoriesSource[categoryId], `categories.${categoryId}`);
  }
  if (Object.keys(categoriesSource).length !== Object.keys(PRODUCT_CATEGORY_TITLES).length) {
    throw new Error('Category performance evidence must contain exactly the three product categories.');
  }
  const safety = record(source['safety'], 'safety');
  if (
    safety['evidenceOnly'] !== true ||
    safety['archivesModified'] !== false ||
    safety['probabilitiesModified'] !== false ||
    safety['rankingModified'] !== false
  ) {
    throw new Error('Category performance safety boundary drifted.');
  }
  const pairedCapturesIncluded = nonnegativeInteger(source['pairedCapturesIncluded'], 'pairedCapturesIncluded');
  const firstCaptureAt = timestampOrNull(source['firstCaptureAt'], 'firstCaptureAt');
  const lastCaptureAt = timestampOrNull(source['lastCaptureAt'], 'lastCaptureAt');
  if (pairedCapturesIncluded === 0 && (firstCaptureAt !== null || lastCaptureAt !== null)) {
    throw new Error('Empty category performance evidence cannot claim capture timestamps.');
  }
  if (pairedCapturesIncluded > 0 && (firstCaptureAt === null || lastCaptureAt === null || firstCaptureAt > lastCaptureAt)) {
    throw new Error('Category performance capture range is invalid.');
  }
  return Object.freeze({
    reportVersion: CATEGORY_PERFORMANCE_REPORT_VERSION,
    reportType: CATEGORY_PERFORMANCE_REPORT_TYPE,
    generatedAt,
    productDisplayBoardVersion: source['productDisplayBoardVersion'],
    sourceSetSha256: source['sourceSetSha256'] as string,
    pairedCapturesIncluded,
    firstCaptureAt,
    lastCaptureAt,
    categories: Object.freeze(categories),
    safety: Object.freeze({
      evidenceOnly: true,
      archivesModified: false,
      probabilitiesModified: false,
      rankingModified: false,
    }),
  });
}

async function readLatest(rootDirectory: string): Promise<ProductCategoryPerformanceEvidence | null> {
  let entries;
  try {
    entries = await readdir(rootDirectory, { withFileTypes: true });
  } catch (error) {
    if (error !== null && typeof error === 'object' && 'code' in error && error.code === 'ENOENT') return null;
    throw error;
  }
  const candidates = [] as ProductCategoryPerformanceEvidence[];
  for (const entry of entries) {
    if (!entry.isFile() || !REPORT_PATTERN.test(entry.name)) continue;
    const parsed = JSON.parse(await readFile(path.join(rootDirectory, entry.name), 'utf8')) as unknown;
    candidates.push(parseEvidence(parsed, entry.name));
  }
  candidates.sort((left, right) => left.generatedAt.localeCompare(right.generatedAt) || left.sourceSetSha256.localeCompare(right.sourceSetSha256));
  return candidates.at(-1) ?? null;
}

export function createProductCategoryPerformanceRepository(
  options: Readonly<{ rootDirectory?: string }> = {},
): ProductCategoryPerformanceRepository {
  const rootDirectory = path.resolve(options.rootDirectory ?? CATEGORY_PERFORMANCE_DISPLAY_ROOT);
  return Object.freeze({ readLatest: () => readLatest(rootDirectory) });
}
