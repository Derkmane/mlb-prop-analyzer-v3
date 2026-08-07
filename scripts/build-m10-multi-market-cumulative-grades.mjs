import { createHash } from 'node:crypto';
import { access, mkdir, readFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

import { persistImmutableJson } from './m10-grade-saved-archive-utils.mjs';
import { M10_HHR_CUMULATIVE_VERSION } from './m10-hhr-evidence-utils.mjs';
import { M10_SELECTED_SIDE_GRADE_METRICS_VERSION } from './m10-selected-side-grade-metrics-utils.mjs';

export const M10_MULTI_MARKET_CUMULATIVE_VERSION =
  'm10-multi-market-cumulative-selected-side-v1';

const SHA256_PATTERN = /^[a-f0-9]{64}$/u;

function object(value, label) {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new TypeError(`${label} must be an object.`);
  }
  return value;
}

function nonemptyString(value, label) {
  if (typeof value !== 'string' || value.length === 0) {
    throw new TypeError(`${label} must be a nonempty string.`);
  }
  return value;
}

function sha256(value, label) {
  if (typeof value !== 'string' || !SHA256_PATTERN.test(value)) {
    throw new TypeError(`${label} must be a lowercase SHA-256.`);
  }
  return value;
}

function isoTimestamp(value, label) {
  nonemptyString(value, label);
  if (!Number.isFinite(Date.parse(value))) {
    throw new TypeError(`${label} must be an ISO timestamp.`);
  }
  return value;
}

function stableJson(value) {
  if (
    value === null ||
    typeof value === 'boolean' ||
    typeof value === 'number' ||
    typeof value === 'string'
  ) {
    if (typeof value === 'number' && !Number.isFinite(value)) {
      throw new TypeError('Stable JSON values may contain only finite numbers.');
    }
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`;
  if (typeof value === 'object') {
    return `{${Object.keys(value)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${stableJson(value[key])}`)
      .join(',')}}`;
  }
  throw new TypeError('Stable JSON values must be JSON-compatible.');
}

function digest(value) {
  return createHash('sha256').update(stableJson(value)).digest('hex');
}

function validateHitsCumulative(raw) {
  const report = object(raw, 'Batter Hits cumulative report');
  if (
    report.reportVersion !== M10_SELECTED_SIDE_GRADE_METRICS_VERSION ||
    report.reportType !== 'cumulative-selected-side-and-opportunity-miner-grade-metrics'
  ) {
    throw new Error('Batter Hits cumulative report contract is unsupported.');
  }
  sha256(report.sourceSetSha256, 'Batter Hits sourceSetSha256');
  isoTimestamp(report.generatedAt, 'Batter Hits generatedAt');
  const safety = object(report.safety, 'Batter Hits safety');
  if (
    safety.productionEnabled !== false ||
    safety.rankingEnabled !== false ||
    safety.archivesModified !== false
  ) {
    throw new Error('Batter Hits cumulative safety boundary drifted.');
  }
  return report;
}

function validateHhrCumulative(raw) {
  const report = object(raw, 'HHR cumulative report');
  if (
    report.reportVersion !== 1 ||
    report.reportType !== M10_HHR_CUMULATIVE_VERSION
  ) {
    throw new Error('HHR cumulative report contract is unsupported.');
  }
  sha256(report.sourceSetSha256, 'HHR sourceSetSha256');
  isoTimestamp(report.generatedAt, 'HHR generatedAt');
  const safety = object(report.safety, 'HHR safety');
  if (
    safety.productionEnabled !== false ||
    safety.rankingEnabled !== false ||
    safety.archivesModified !== false ||
    safety.deepLineCohort !== '2.5+'
  ) {
    throw new Error('HHR cumulative safety boundary drifted.');
  }
  const perLine = object(
    object(report.selectedSide, 'HHR selectedSide').perLine,
    'HHR selectedSide.perLine',
  );
  for (const cohort of ['0.5', '1.5', '2.5+']) {
    if (!Object.hasOwn(perLine, cohort)) {
      throw new Error(`HHR cumulative report is missing line cohort ${cohort}.`);
    }
  }
  return report;
}

export function buildM10MultiMarketCumulativeReport({ batterHits, hhr }) {
  const hitsReport = validateHitsCumulative(batterHits);
  const hhrReport = validateHhrCumulative(hhr);
  const generatedAt = [hitsReport.generatedAt, hhrReport.generatedAt].sort().at(-1);
  const source = Object.freeze({
    batterHitsSourceSetSha256: hitsReport.sourceSetSha256,
    hhrSourceSetSha256: hhrReport.sourceSetSha256,
  });
  return Object.freeze({
    reportVersion: 1,
    reportType: M10_MULTI_MARKET_CUMULATIVE_VERSION,
    generatedAt,
    sourceSetSha256: digest(source),
    source,
    markets: Object.freeze({
      batterHits: hitsReport,
      batterHitsRunsRbis: hhrReport,
    }),
    safety: Object.freeze({
      productionEnabled: false,
      rankingEnabled: false,
      evidenceOnly: true,
      archivesModified: false,
      crossMarketPooling: false,
    }),
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

async function latestCumulative(directory, filenamePrefix, validate) {
  const entries = await readdir(directory, { withFileTypes: true });
  const candidates = [];
  for (const entry of entries) {
    if (!entry.isFile() || !entry.name.startsWith(`${filenamePrefix}--`) || !entry.name.endsWith('.json')) {
      continue;
    }
    const filePath = path.join(directory, entry.name);
    const report = validate(JSON.parse(await readFile(filePath, 'utf8')));
    candidates.push({ filePath, report });
  }
  if (candidates.length === 0) {
    throw new Error(`No cumulative report found under ${directory} for ${filenamePrefix}.`);
  }
  candidates.sort((left, right) =>
    left.report.generatedAt.localeCompare(right.report.generatedAt) ||
    left.report.sourceSetSha256.localeCompare(right.report.sourceSetSha256),
  );
  return candidates.at(-1);
}

export async function main() {
  const hitsRoot = path.resolve(
    process.env.M10_ARCHIVE_ROOT?.trim() || 'artifacts/board-archives/batter-hits',
  );
  const hhrRoot = path.resolve(
    process.env.M10_HHR_ARCHIVE_ROOT?.trim() || 'artifacts/board-archives/batter-hhr',
  );
  const outputRoot = path.resolve(
    process.env.M10_MULTI_MARKET_CUMULATIVE_ROOT?.trim() ||
      'artifacts/board-archives/cumulative',
  );
  const hits = await latestCumulative(
    path.join(hitsRoot, 'cumulative'),
    M10_SELECTED_SIDE_GRADE_METRICS_VERSION,
    validateHitsCumulative,
  );
  const hhr = await latestCumulative(
    path.join(hhrRoot, 'cumulative'),
    M10_HHR_CUMULATIVE_VERSION,
    validateHhrCumulative,
  );
  const combined = buildM10MultiMarketCumulativeReport({
    batterHits: hits.report,
    hhr: hhr.report,
  });
  await mkdir(outputRoot, { recursive: true });
  const outputPath = path.join(
    outputRoot,
    `${M10_MULTI_MARKET_CUMULATIVE_VERSION}--${combined.sourceSetSha256}.json`,
  );
  const expectedBytes = Buffer.from(`${JSON.stringify(combined, null, 2)}\n`, 'utf8');
  if (await exists(outputPath)) {
    const existing = await readFile(outputPath);
    if (!existing.equals(expectedBytes)) {
      throw new Error(`Immutable multi-market cumulative report drifted: ${outputPath}`);
    }
    console.log(`VERIFIED MULTI-MARKET CUMULATIVE\t${combined.sourceSetSha256}`);
  } else {
    await persistImmutableJson(outputPath, combined);
    console.log(`CREATED MULTI-MARKET CUMULATIVE\t${combined.sourceSetSha256}`);
  }
  console.log(`BATTER HITS CUMULATIVE\t${hits.filePath}`);
  console.log(`HHR CUMULATIVE\t${hhr.filePath}`);
  console.log(`MULTI-MARKET CUMULATIVE\t${outputPath}`);
  console.log(`HHR 0.5 COUNT\t${combined.markets.batterHitsRunsRbis.selectedSide.perLine['0.5'].summary.picksGraded}`);
  console.log(`HHR 1.5 COUNT\t${combined.markets.batterHitsRunsRbis.selectedSide.perLine['1.5'].summary.picksGraded}`);
  console.log(`HHR 2.5+ COUNT\t${combined.markets.batterHitsRunsRbis.selectedSide.perLine['2.5+'].summary.picksGraded}`);
  console.log('CROSS-MARKET POOLING\tfalse');
  console.log('PRODUCTION\tDISABLED');
  console.log('RANKING\tDISABLED');
}

const invokedPath = process.argv[1];
if (
  invokedPath !== undefined &&
  import.meta.url === pathToFileURL(path.resolve(invokedPath)).href
) {
  main().catch((error) => {
    process.stderr.write(
      `${error instanceof Error ? error.stack ?? error.message : String(error)}\n`,
    );
    process.exitCode = 1;
  });
}
