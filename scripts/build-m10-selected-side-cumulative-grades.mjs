import { access, mkdir, readFile, readdir } from 'node:fs/promises';
import path from 'node:path';

import { persistImmutableJson } from './m10-grade-saved-archive-utils.mjs';
import { M10_SCHEDULED_ARCHIVE_GRADING_VERSION } from './m10-scheduled-archive-grading-utils.mjs';
import { M10_BATTER_HITS_GRADE_VERSION_V2 } from './m10-batter-hits-final-grade-v2-utils.mjs';
import { verifyBatterHitsFinalGradeReportV2 } from './m10-batter-hits-grade-v2-verifier.mjs';
import {
  buildCumulativeSelectedSideMetricsReportV2,
  buildSelectedSideArchiveMetricsReportV1,
  canonicalJsonBytes,
  M10_SELECTED_SIDE_CUMULATIVE_GRADE_METRICS_VERSION,
  M10_SELECTED_SIDE_GRADE_METRICS_VERSION,
  sha256Bytes,
  verifyAndProjectM10AnalyticsArchiveBytes,
  verifyScheduledGradeReportV1,
} from './m10-selected-side-grade-metrics-utils.mjs';

const DEFAULT_ARCHIVE_ROOT = path.join(
  'artifacts',
  'board-archives',
  'batter-hits',
);
const CAPTURE_FILE_PATTERN = /^(\d{8}T\d{9}Z--[a-f0-9]{64})\.json$/u;

function environment(name, fallback) {
  const value = process.env[name]?.trim();
  return value || fallback;
}

async function exists(filePath) {
  try {
    await access(filePath);
    return true;
  } catch (error) {
    if (error && typeof error === 'object' && error.code === 'ENOENT') {
      return false;
    }
    throw error;
  }
}

function format(value) {
  return value === null ? 'null' : Number(value).toFixed(12);
}

function printSummary(prefix, summary) {
  console.log(`${prefix} PICKS\t${summary.picksGraded}`);
  console.log(`${prefix} WINS\t${summary.wins}`);
  console.log(`${prefix} LOSSES\t${summary.losses}`);
  console.log(`${prefix} VOIDS\t${summary.voids}`);
  console.log(`${prefix} OBSERVED WIN RATE\t${format(summary.observedWinRate)}`);
  console.log(
    `${prefix} MEAN PREDICTED PROBABILITY\t${format(summary.predictedMeanWinProbability)}`,
  );
  console.log(`${prefix} BINARY BRIER\t${format(summary.binaryBrier)}`);
  console.log(`${prefix} BINARY LOG LOSS\t${format(summary.binaryLogLoss)}`);
}

function printCalibration(prefix, calibration) {
  console.log(`${prefix} CALIBRATION`);
  for (const bucket of calibration) {
    console.log(
      [
        prefix,
        bucket.label,
        `n=${bucket.picksGraded}`,
        `wins=${bucket.wins}`,
        `losses=${bucket.losses}`,
        `voids=${bucket.voids}`,
        `predicted=${format(bucket.predictedMeanWinProbability)}`,
        `observed=${format(bucket.observedWinRate)}`,
      ].join('\t'),
    );
  }
}

async function readLatestSupportedGrade({ reportRoot, projection }) {
  const v2Path = path.join(
    reportRoot,
    'grades',
    `${M10_BATTER_HITS_GRADE_VERSION_V2}.json`,
  );
  if (await exists(v2Path)) {
    const bytes = await readFile(v2Path);
    return Object.freeze({
      path: v2Path,
      report: verifyBatterHitsFinalGradeReportV2({ reportBytes: bytes, projection }),
    });
  }
  const v1Path = path.join(
    reportRoot,
    'grades',
    `${M10_SCHEDULED_ARCHIVE_GRADING_VERSION}.json`,
  );
  if (await exists(v1Path)) {
    const bytes = await readFile(v1Path);
    return Object.freeze({
      path: v1Path,
      report: verifyScheduledGradeReportV1({ reportBytes: bytes, projection }),
    });
  }
  return null;
}

const archiveRoot = environment('M10_ARCHIVE_ROOT', DEFAULT_ARCHIVE_ROOT);
const capturesDirectory = path.join(archiveRoot, 'captures');
await mkdir(capturesDirectory, { recursive: true });
const entries = await readdir(capturesDirectory, { withFileTypes: true });
const captures = entries
  .filter((entry) => entry.isFile() && CAPTURE_FILE_PATTERN.test(entry.name))
  .map((entry) => ({
    captureKey: CAPTURE_FILE_PATTERN.exec(entry.name)[1],
    filePath: path.join(capturesDirectory, entry.name),
  }))
  .sort((left, right) => left.captureKey.localeCompare(right.captureKey));

console.log('--- M10 SELECTED-SIDE AND CUMULATIVE GRADING ---');
console.log(`ARCHIVE ROOT\t${archiveRoot}`);
console.log(`CAPTURES DISCOVERED\t${captures.length}`);

const cumulativeInputs = [];
let reportsCreated = 0;
let reportsVerified = 0;
let ungradedArchives = 0;

for (const capture of captures) {
  const archiveBytes = await readFile(capture.filePath);
  const projection = verifyAndProjectM10AnalyticsArchiveBytes({
    bytes: archiveBytes,
    archivePath: capture.filePath,
    expectedCaptureKey: capture.captureKey,
  });
  const reportRoot = path.join(archiveRoot, capture.captureKey);
  const sourceGradeInput = await readLatestSupportedGrade({ reportRoot, projection });
  if (sourceGradeInput === null) {
    ungradedArchives += 1;
    console.log(`SKIP UNGRADED\t${capture.captureKey}`);
    continue;
  }
  const sourceGrade = sourceGradeInput.report;
  const report = buildSelectedSideArchiveMetricsReportV1({
    projection,
    gradeReport: sourceGrade,
    generatedAt: sourceGrade.gradedAt,
  });
  const expectedBytes = canonicalJsonBytes(report);
  const selectedReportPath = path.join(
    reportRoot,
    'grades',
    `${M10_SELECTED_SIDE_GRADE_METRICS_VERSION}.json`,
  );
  let reportSha256;
  if (await exists(selectedReportPath)) {
    const existing = await readFile(selectedReportPath);
    if (!existing.equals(expectedBytes)) {
      throw new Error(
        `Immutable selected-side report drifted: ${selectedReportPath}`,
      );
    }
    reportSha256 = sha256Bytes(existing);
    reportsVerified += 1;
    console.log(`VERIFIED REPORT\t${capture.captureKey}\t${reportSha256}`);
  } else {
    const persisted = await persistImmutableJson(selectedReportPath, report);
    reportSha256 = persisted.sha256;
    reportsCreated += 1;
    console.log(`CREATED REPORT\t${capture.captureKey}\t${reportSha256}`);
  }
  cumulativeInputs.push(Object.freeze({ report, reportSha256 }));

  console.log(`CAPTURE\t${capture.captureKey}`);
  console.log(`SOURCE GRADE\t${sourceGrade.reportVersion}\t${sourceGradeInput.path}`);
  printSummary('SELECTED SIDE', report.selectedSide.summary);
  printCalibration('SELECTED SIDE', report.selectedSide.calibration);
  printSummary('OPPORTUNITY MINER', report.opportunityMiner.summary);
  for (const row of report.opportunityMiner.rows) {
    console.log(
      [
        'OPPORTUNITY MINER PICK',
        row.playerName,
        row.selectedSide,
        row.postedLine,
        `predicted=${format(row.archivedPWinGivenGrades)}`,
        `hits=${row.officialHits}`,
        row.outcome,
      ].join('\t'),
    );
  }
  console.log(
    `COMPLEMENTARY INTEGRITY\tSTRUCTURALLY FORCED\tNOT PERFORMANCE\tpairs=${report.complementaryIntegrity.complementaryPropPairs}\trows=${report.complementaryIntegrity.allComplementaryRows}`,
  );
  console.log('ARCHIVE MODIFIED\tfalse');
}

let cumulativePath = null;
let cumulativeSha256 = null;
if (cumulativeInputs.length > 0) {
  const generatedAt = cumulativeInputs
    .map((input) => input.report.generatedAt)
    .sort()
    .at(-1);
  const cumulative = buildCumulativeSelectedSideMetricsReportV2({
    reports: cumulativeInputs,
    generatedAt,
  });
  cumulativePath = path.join(
    archiveRoot,
    'cumulative',
    `${M10_SELECTED_SIDE_CUMULATIVE_GRADE_METRICS_VERSION}--${cumulative.sourceSetSha256}.json`,
  );
  const expectedBytes = canonicalJsonBytes(cumulative);
  if (await exists(cumulativePath)) {
    const existing = await readFile(cumulativePath);
    if (!existing.equals(expectedBytes)) {
      throw new Error(`Immutable cumulative report drifted: ${cumulativePath}`);
    }
    cumulativeSha256 = sha256Bytes(existing);
    console.log(`VERIFIED CUMULATIVE\t${cumulative.sourceSetSha256}\t${cumulativeSha256}`);
  } else {
    const persisted = await persistImmutableJson(cumulativePath, cumulative);
    cumulativeSha256 = persisted.sha256;
    console.log(`CREATED CUMULATIVE\t${cumulative.sourceSetSha256}\t${cumulativeSha256}`);
  }
  console.log(`CUMULATIVE ARCHIVES\t${cumulative.archivesIncluded}`);
  printSummary('CUMULATIVE SELECTED SIDE', cumulative.selectedSide.summary);
  printCalibration(
    'CUMULATIVE SELECTED SIDE',
    cumulative.selectedSide.calibration,
  );
  printSummary(
    'CUMULATIVE OPPORTUNITY MINER',
    cumulative.opportunityMiner.summary,
  );
}

console.log(`REPORTS CREATED\t${reportsCreated}`);
console.log(`REPORTS VERIFIED\t${reportsVerified}`);
console.log(`UNGRADED ARCHIVES SKIPPED\t${ungradedArchives}`);
console.log(`CUMULATIVE PATH\t${cumulativePath ?? 'none'}`);
console.log(`CUMULATIVE SHA-256\t${cumulativeSha256 ?? 'none'}`);
console.log('ARCHIVES MODIFIED\t0');
console.log('PRODUCTION\tDISABLED');
console.log('RANKING\tDISABLED');
console.log('--- END M10 SELECTED-SIDE AND CUMULATIVE GRADING ---');
