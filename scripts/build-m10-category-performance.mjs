import { createHash } from 'node:crypto';
import { access, mkdir, readFile, readdir, unlink, writeFile } from 'node:fs/promises';
import path from 'node:path';

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

function sha256(bytes) {
  return createHash('sha256').update(bytes).digest('hex');
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

async function latestSupportedGradeReport(root, captureKey) {
  const directory = path.join(root, captureKey, 'grades');
  if (!(await exists(directory))) return null;
  const entries = await readdir(directory, { withFileTypes: true });
  const candidates = [];
  for (const entry of entries) {
    if (!entry.isFile() || !entry.name.endsWith('.json')) continue;
    const file = await readJsonFile(path.join(directory, entry.name));
    try {
      const normalized = normalizeCategoryPerformanceGradeReport(file.value, file.fileSha256);
      if (normalized.captureKey !== captureKey) {
        throw new Error(`Grade report ${entry.name} capture identity drifted.`);
      }
      candidates.push(Object.freeze({ ...file, gradedAt: normalized.gradedAt }));
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
    const hitsCaptureKey = hitsFile.value?.captureKey;
    const hhrCaptureKey = hhrFile.value?.captureKey;
    if (typeof hitsCaptureKey !== 'string' || typeof hhrCaptureKey !== 'string') {
      throw new Error(`Paired display capture ${timestampKey} is missing a captureKey.`);
    }
    const [hitsGradeReport, hhrGradeReport] = await Promise.all([
      latestSupportedGradeReport(HITS_GRADE_ROOT, hitsCaptureKey),
      latestSupportedGradeReport(HHR_GRADE_ROOT, hhrCaptureKey),
    ]);
    pairs.push(Object.freeze({
      capturedAt: hitsFile.value.capturedAt,
      hitsDisplayArchive: hitsFile.value,
      hhrDisplayArchive: hhrFile.value,
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

const pairedCaptures = await buildPairedCaptureInputs();
const report = buildProductCategoryPerformanceReportV1({ pairedCaptures });
console.log('--- M10 PRODUCT CATEGORY PERFORMANCE ---');
console.log(`PAIRED DISPLAY CAPTURES\t${pairedCaptures.length}`);
if (report === null) {
  console.log('GRADED CATEGORY PICKS\t0');
  console.log('CATEGORY PERFORMANCE\tUNAVAILABLE');
  console.log('--- END M10 PRODUCT CATEGORY PERFORMANCE ---');
  process.exit(0);
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
