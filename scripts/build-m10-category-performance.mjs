import { createHash } from 'node:crypto';
import { access, mkdir, readFile, readdir, unlink, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

import {
  CATEGORY_PERFORMANCE_REPORT_TYPE,
  buildProductCategoryPerformanceReportV1,
  normalizeCategoryPerformanceGradeReport,
} from './m10-category-performance-utils.mjs';

const HITS_DISPLAY_ROOT = path.resolve('artifacts/display-archives/batter-hits/captures');
const HHR_DISPLAY_ROOT = path.resolve('artifacts/display-archives/batter-hhr/captures');
const HITS_GRADE_ROOT = path.resolve(
  process.env.M10_ARCHIVE_ROOT?.trim() || 'artifacts/board-archives/batter-hits',
);
const HHR_GRADE_ROOT = path.resolve(
  process.env.M10_HHR_ARCHIVE_ROOT?.trim() || 'artifacts/board-archives/batter-hhr',
);
const OUTPUT_ROOT = path.resolve('artifacts/display-archives/category-performance');
const DISPLAY_PATTERN = /^(\d{8}T\d{9}Z)--[a-f0-9]{64}\.json$/u;
const REPORT_PATTERN = /^product-category-performance-v1--[a-f0-9]{64}\.json$/u;
const BATTER_HITS_PROVIDER_MARKET_BY_OFFER_TYPE = Object.freeze({
  baseline: 'batter_hits',
  alternate: 'batter_hits_alternate',
});

function sha256(bytes) {
  return createHash('sha256').update(bytes).digest('hex');
}

function object(value, label) {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new TypeError(`${label} must be an object.`);
  }
  return value;
}

function array(value, label) {
  if (!Array.isArray(value)) throw new TypeError(`${label} must be an array.`);
  return value;
}

export function retainCategoryAuthorizedDisplayRows(rawArchive) {
  const archive = object(rawArchive, 'category performance display archive');
  const rows = array(archive.rows, 'category performance display archive rows');
  const retained = rows.filter((rawRow, index) => {
    const row = object(rawRow, `category performance display archive rows[${index}]`);
    return row.boardSource === 'pick6' || row.boardSource === 'draftkings';
  });
  return Object.freeze({
    ...archive,
    rows: Object.freeze(retained),
  });
}

export function recoverBatterHitsGradeProviderMarketKeys(rawReport) {
  const report = object(rawReport, 'Batter Hits category performance grade report');
  const rows = array(report.rows, 'Batter Hits category performance grade report rows');
  const recoveredRows = rows.map((rawRow, index) => {
    const row = object(rawRow, `Batter Hits category performance grade report rows[${index}]`);
    if (row.providerMarketKey !== undefined && row.providerMarketKey !== null) return row;
    const providerMarketKey = BATTER_HITS_PROVIDER_MARKET_BY_OFFER_TYPE[row.offerType];
    if (providerMarketKey === undefined) {
      throw new Error(
        `Batter Hits grade row ${index} is missing providerMarketKey and has unsupported offerType ${String(row.offerType)}.`,
      );
    }
    return Object.freeze({ ...row, providerMarketKey });
  });
  return Object.freeze({
    ...report,
    rows: Object.freeze(recoveredRows),
  });
}

async function exists(filePath) {
  try {
    await access(filePath);
    return true;
  } catch (error) {
    if (error && typeof error === 'object' && error.code === 'ENOENT') return false;
    throw error;
  }
}

async function readJsonFile(filePath) {
  const bytes = await readFile(filePath);
  return Object.freeze({
    value: JSON.parse(bytes.toString('utf8')),
    fileSha256: sha256(bytes),
    filePath,
  });
}

async function displayFilesByTimestamp(root) {
  if (!(await exists(root))) return new Map();
  const entries = await readdir(root, { withFileTypes: true });
  const result = new Map();
  for (const entry of entries) {
    if (!entry.isFile()) continue;
    const match = DISPLAY_PATTERN.exec(entry.name);
    if (match === null) continue;
    const timestampKey = match[1];
    if (result.has(timestampKey)) {
      throw new Error(`Duplicate display archive timestamp ${timestampKey} under ${root}.`);
    }
    result.set(timestampKey, path.join(root, entry.name));
  }
  return result;
}

async function latestSupportedGradeReport(
  root,
  captureKey,
  { recoverHitsProviderMarketKey = false } = {},
) {
  const directory = path.join(root, captureKey, 'grades');
  if (!(await exists(directory))) return null;
  const entries = await readdir(directory, { withFileTypes: true });
  const candidates = [];
  for (const entry of entries) {
    if (!entry.isFile() || !entry.name.endsWith('.json')) continue;
    const file = await readJsonFile(path.join(directory, entry.name));
    try {
      const value = recoverHitsProviderMarketKey
        ? recoverBatterHitsGradeProviderMarketKeys(file.value)
        : file.value;
      const normalized = normalizeCategoryPerformanceGradeReport(value, file.fileSha256);
      if (normalized.captureKey !== captureKey) {
        throw new Error(`Grade report ${entry.name} capture identity drifted.`);
      }
      candidates.push(Object.freeze({ ...file, value, gradedAt: normalized.gradedAt }));
    } catch (error) {
      console.error(`SKIPPED CATEGORY PERFORMANCE GRADE\t${entry.name}\t${error instanceof Error ? error.message : String(error)}`);
    }
  }
  candidates.sort((left, right) => left.gradedAt.localeCompare(right.gradedAt) || left.fileSha256.localeCompare(right.fileSha256));
  return candidates.at(-1) ?? null;
}

async function buildPairedCaptureInputs() {
  const [hitsByTimestamp, hhrByTimestamp] = await Promise.all([
    displayFilesByTimestamp(HITS_DISPLAY_ROOT),
    displayFilesByTimestamp(HHR_DISPLAY_ROOT),
  ]);
  const timestamps = [...hitsByTimestamp.keys()]
    .filter((timestampKey) => hhrByTimestamp.has(timestampKey))
    .sort();
  const pairs = [];
  for (const timestampKey of timestamps) {
    const hitsFile = await readJsonFile(hitsByTimestamp.get(timestampKey));
    const hhrFile = await readJsonFile(hhrByTimestamp.get(timestampKey));
    const hitsDisplayArchive = retainCategoryAuthorizedDisplayRows(hitsFile.value);
    const hhrDisplayArchive = retainCategoryAuthorizedDisplayRows(hhrFile.value);
    const hitsCaptureKey = hitsDisplayArchive.captureKey;
    const hhrCaptureKey = hhrDisplayArchive.captureKey;
    if (typeof hitsCaptureKey !== 'string' || typeof hhrCaptureKey !== 'string') {
      throw new Error(`Paired display capture ${timestampKey} is missing a captureKey.`);
    }
    const [hitsGradeReport, hhrGradeReport] = await Promise.all([
      latestSupportedGradeReport(HITS_GRADE_ROOT, hitsCaptureKey, {
        recoverHitsProviderMarketKey: true,
      }),
      latestSupportedGradeReport(HHR_GRADE_ROOT, hhrCaptureKey),
    ]);
    pairs.push(Object.freeze({
      capturedAt: hitsDisplayArchive.capturedAt,
      hitsDisplayArchive,
      hhrDisplayArchive,
      hitsGradeReport,
      hhrGradeReport,
    }));
  }
  return Object.freeze(pairs);
}

async function persistLatestReport(report) {
  await mkdir(OUTPUT_ROOT, { recursive: true });
  const fileName = `${CATEGORY_PERFORMANCE_REPORT_TYPE}--${report.sourceSetSha256}.json`;
  const outputPath = path.join(OUTPUT_ROOT, fileName);
  const bytes = `${JSON.stringify(report, null, 2)}\n`;
  if (await exists(outputPath)) {
    const existing = await readFile(outputPath, 'utf8');
    if (existing !== bytes) throw new Error(`Category performance report drifted at ${outputPath}.`);
  } else {
    await writeFile(outputPath, bytes, { flag: 'wx' });
  }
  const entries = await readdir(OUTPUT_ROOT, { withFileTypes: true });
  for (const entry of entries) {
    if (!entry.isFile() || !REPORT_PATTERN.test(entry.name) || entry.name === fileName) continue;
    await unlink(path.join(OUTPUT_ROOT, entry.name));
  }
  return outputPath;
}

export async function main() {
  const pairedCaptures = await buildPairedCaptureInputs();
  const report = buildProductCategoryPerformanceReportV1({ pairedCaptures });
  console.log('--- M10 PRODUCT CATEGORY PERFORMANCE ---');
  console.log(`PAIRED DISPLAY CAPTURES\t${pairedCaptures.length}`);
  if (report === null) {
    console.log('GRADED CATEGORY PICKS\t0');
    console.log('CATEGORY PERFORMANCE\tUNAVAILABLE');
    console.log('--- END M10 PRODUCT CATEGORY PERFORMANCE ---');
    return;
  }
  const outputPath = await persistLatestReport(report);
  for (const [categoryId, summary] of Object.entries(report.categories)) {
    console.log(`CATEGORY\t${categoryId}\t${summary.wins}-${summary.losses}-${summary.voids}\tdecided=${summary.decidedPicks}\twinRate=${summary.winRate ?? 'n/a'}`);
  }
  console.log(`PAIRED CAPTURES INCLUDED\t${report.pairedCapturesIncluded}`);
  console.log(`SOURCE SET SHA-256\t${report.sourceSetSha256}`);
  console.log(`CATEGORY PERFORMANCE PATH\t${outputPath}`);
  console.log('ARCHIVES MODIFIED\tfalse');
  console.log('PROBABILITIES MODIFIED\tfalse');
  console.log('RANKING MODIFIED\tfalse');
  console.log('--- END M10 PRODUCT CATEGORY PERFORMANCE ---');
}

const invokedPath = process.argv[1];
if (
  invokedPath !== undefined &&
  import.meta.url === pathToFileURL(path.resolve(invokedPath)).href
) {
  await main();
}
