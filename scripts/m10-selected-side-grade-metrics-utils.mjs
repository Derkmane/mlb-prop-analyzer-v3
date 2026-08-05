import { createHash } from 'node:crypto';

import { selectOpportunityMinerFavoritesV1 } from '../dist/src/categories/index.js';
import {
  M10_SCHEDULED_ARCHIVE_GRADING_VERSION,
  verifyAndProjectM9ArchiveBytes,
} from './m10-scheduled-archive-grading-utils.mjs';

export const M10_SELECTED_SIDE_GRADE_METRICS_VERSION =
  'm10-selected-side-cumulative-grade-metrics-v1';

export const M10_SELECTED_SIDE_CALIBRATION_BUCKETS = Object.freeze([
  Object.freeze({ label: '50-55%', lowerInclusive: 0.5, upperExclusive: 0.55 }),
  Object.freeze({ label: '55-60%', lowerInclusive: 0.55, upperExclusive: 0.6 }),
  Object.freeze({ label: '60-65%', lowerInclusive: 0.6, upperExclusive: 0.65 }),
  Object.freeze({ label: '65-70%', lowerInclusive: 0.65, upperExclusive: 0.7 }),
  Object.freeze({ label: '70-75%', lowerInclusive: 0.7, upperExclusive: 0.75 }),
  Object.freeze({ label: '75-80%', lowerInclusive: 0.75, upperExclusive: 0.8 }),
  Object.freeze({ label: '80%+', lowerInclusive: 0.8, upperExclusive: null }),
]);

const PROBABILITY_TOLERANCE = 1e-12;
const SHA256_PATTERN = /^[a-f0-9]{64}$/u;

function object(value, label) {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new TypeError(`${label} must be an object.`);
  }
  return value;
}

function array(value, label) {
  if (!Array.isArray(value)) {
    throw new TypeError(`${label} must be an array.`);
  }
  return value;
}

function nonemptyString(value, label) {
  if (typeof value !== 'string' || value.length === 0) {
    throw new TypeError(`${label} must be a nonempty string.`);
  }
  return value;
}

function positiveInteger(value, label) {
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new TypeError(`${label} must be a positive safe integer.`);
  }
  return value;
}

function finiteNumber(value, label) {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new TypeError(`${label} must be finite.`);
  }
  return value;
}

function probability(value, label) {
  finiteNumber(value, label);
  if (value < 0 || value > 1) {
    throw new RangeError(`${label} must be in [0, 1].`);
  }
  return value;
}

function timestamp(value, label) {
  nonemptyString(value, label);
  if (!Number.isFinite(Date.parse(value))) {
    throw new TypeError(`${label} must be an ISO timestamp.`);
  }
  return value;
}

function sha256(value, label) {
  if (typeof value !== 'string' || !SHA256_PATTERN.test(value)) {
    throw new TypeError(`${label} must be a lowercase SHA-256.`);
  }
  return value;
}

function approximatelyEqual(left, right) {
  return Math.abs(left - right) <= PROBABILITY_TOLERANCE;
}

function stableJson(value) {
  if (
    value === null ||
    typeof value === 'boolean' ||
    typeof value === 'string' ||
    typeof value === 'number'
  ) {
    if (typeof value === 'number' && !Number.isFinite(value)) {
      throw new TypeError('Stable JSON values must contain only finite numbers.');
    }
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map((entry) => stableJson(entry)).join(',')}]`;
  }
  if (typeof value === 'object') {
    return `{${Object.keys(value)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${stableJson(value[key])}`)
      .join(',')}}`;
  }
  throw new TypeError('Stable JSON values must be JSON-compatible.');
}

export function sha256Bytes(value) {
  return createHash('sha256').update(value).digest('hex');
}

export function canonicalJsonBytes(value) {
  return Buffer.from(`${JSON.stringify(value, null, 2)}\n`, 'utf8');
}

function propIdentity(row) {
  return stableJson([
    row.providerEventId,
    row.providerGameId,
    row.providerPlayerId,
    row.providerMarketKey,
    row.offerType,
    row.postedLine,
  ]);
}

function rowIdentity(row) {
  return stableJson([
    row.providerEventId,
    row.providerGameId,
    row.providerPlayerId,
    row.providerMarketKey,
    row.offerType,
    row.selectedSide,
    row.postedLine,
  ]);
}

function validatePriceEvidence(rawOffer, projectedRow, index) {
  const offer = object(rawOffer, `archive.rankedRows[${index}].normalizedOffer`);
  const providerMarketKey = nonemptyString(
    offer.providerMarketKey,
    `archive.rankedRows[${index}].normalizedOffer.providerMarketKey`,
  );
  const americanPrice = finiteNumber(
    offer.americanPrice,
    `archive.rankedRows[${index}].normalizedOffer.americanPrice`,
  );
  if (!Number.isSafeInteger(americanPrice) || americanPrice === 0) {
    throw new TypeError(`archive.rankedRows[${index}] americanPrice is malformed.`);
  }
  const multiplier = finiteNumber(
    offer.multiplier,
    `archive.rankedRows[${index}].normalizedOffer.multiplier`,
  );
  if (multiplier <= 0) {
    throw new RangeError(`archive.rankedRows[${index}] multiplier must be positive.`);
  }
  if (
    offer.providerEventId !== projectedRow.providerEventId ||
    offer.providerGameId !== projectedRow.providerGameId ||
    offer.providerPlayerId !== projectedRow.providerPlayerId ||
    offer.playerName !== projectedRow.playerName ||
    offer.offerType !== projectedRow.offerType ||
    offer.selectedSide !== projectedRow.selectedSide ||
    offer.postedLine !== projectedRow.postedLine
  ) {
    throw new Error(`archive.rankedRows[${index}] price-evidence identity drifted.`);
  }
  return Object.freeze({ providerMarketKey, americanPrice, multiplier });
}

export function verifyAndProjectM10AnalyticsArchiveBytes({
  bytes,
  archivePath,
  expectedCaptureKey = null,
}) {
  const projection = verifyAndProjectM9ArchiveBytes({
    bytes,
    archivePath,
    expectedCaptureKey,
  });
  let parsed;
  try {
    parsed = JSON.parse(Buffer.from(bytes).toString('utf8'));
  } catch (error) {
    throw new Error(
      `Verified archive could not be reparsed for price evidence: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
  const archive = object(parsed, 'archive');
  const rawRankedRows = array(archive.rankedRows, 'archive.rankedRows');
  if (rawRankedRows.length !== projection.rows.length) {
    throw new Error('Archive ranked-row count changed after verification.');
  }
  const rows = projection.rows.map((projectedRow, index) => {
    const rawRankedRow = object(rawRankedRows[index], `archive.rankedRows[${index}]`);
    const price = validatePriceEvidence(
      rawRankedRow.normalizedOffer,
      projectedRow,
      index,
    );
    return Object.freeze({ ...projectedRow, ...price });
  });
  const identities = new Set(rows.map(rowIdentity));
  if (identities.size !== rows.length) {
    throw new Error('Archive analytics rows contain duplicate exact offer identities.');
  }
  return Object.freeze({ ...projection, rows: Object.freeze(rows) });
}

function parseGradeRow(rawRow, expectedRow, index) {
  const row = object(rawRow, `grade report rows[${index}]`);
  positiveInteger(row.rank, `grade report rows[${index}].rank`);
  positiveInteger(row.providerGameId, `grade report rows[${index}].providerGameId`);
  positiveInteger(row.providerPlayerId, `grade report rows[${index}].providerPlayerId`);
  nonemptyString(row.providerEventId, `grade report rows[${index}].providerEventId`);
  nonemptyString(row.playerName, `grade report rows[${index}].playerName`);
  nonemptyString(row.offerType, `grade report rows[${index}].offerType`);
  nonemptyString(row.selectedSide, `grade report rows[${index}].selectedSide`);
  finiteNumber(row.postedLine, `grade report rows[${index}].postedLine`);
  const archivedPWin = probability(
    row.archivedPWin,
    `grade report rows[${index}].archivedPWin`,
  );
  const archivedPLoss = probability(
    row.archivedPLoss,
    `grade report rows[${index}].archivedPLoss`,
  );
  const archivedPVoid = probability(
    row.archivedPVoid,
    `grade report rows[${index}].archivedPVoid`,
  );
  const archivedPWinGivenGrades = probability(
    row.archivedPWinGivenGrades,
    `grade report rows[${index}].archivedPWinGivenGrades`,
  );
  const officialHits = finiteNumber(
    row.officialHits,
    `grade report rows[${index}].officialHits`,
  );
  if (!Number.isSafeInteger(officialHits) || officialHits < 0) {
    throw new TypeError(`grade report rows[${index}].officialHits is malformed.`);
  }
  if (!['win', 'loss', 'void'].includes(row.outcome)) {
    throw new Error(`grade report rows[${index}].outcome is unsupported.`);
  }
  nonemptyString(
    row.settlementVersion,
    `grade report rows[${index}].settlementVersion`,
  );
  if (
    row.rank !== expectedRow.rank ||
    row.providerEventId !== expectedRow.providerEventId ||
    row.providerGameId !== expectedRow.providerGameId ||
    row.providerPlayerId !== expectedRow.providerPlayerId ||
    row.playerName !== expectedRow.playerName ||
    row.offerType !== expectedRow.offerType ||
    row.selectedSide !== expectedRow.selectedSide ||
    row.postedLine !== expectedRow.postedLine ||
    !approximatelyEqual(archivedPWin, expectedRow.pWin) ||
    !approximatelyEqual(archivedPLoss, expectedRow.pLoss) ||
    !approximatelyEqual(archivedPVoid, expectedRow.pVoid) ||
    !approximatelyEqual(
      archivedPWinGivenGrades,
      expectedRow.pWinGivenGrades,
    )
  ) {
    throw new Error(`grade report rows[${index}] drifted from the archive.`);
  }
  return Object.freeze({
    ...expectedRow,
    archivedPWin,
    archivedPLoss,
    archivedPVoid,
    archivedPWinGivenGrades,
    officialHits,
    outcome: row.outcome,
    settlementVersion: row.settlementVersion,
  });
}

export function verifyScheduledGradeReportV1({
  reportBytes,
  projection,
}) {
  let parsed;
  try {
    parsed = JSON.parse(Buffer.from(reportBytes).toString('utf8'));
  } catch (error) {
    throw new Error(
      `Scheduled grade report is not valid JSON: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
  const report = object(parsed, 'scheduled grade report');
  if (report.reportVersion !== M10_SCHEDULED_ARCHIVE_GRADING_VERSION) {
    throw new Error('Scheduled grade report version is unsupported.');
  }
  if (report.reportType !== 'scheduled-real-archived-board-official-hits-grade') {
    throw new Error('Scheduled grade report type is unsupported.');
  }
  timestamp(report.gradedAt, 'scheduled grade report gradedAt');
  const source = object(report.source, 'scheduled grade report source');
  if (
    source.captureKey !== projection.sourceCaptureKey ||
    source.archiveSha256 !== projection.sourceArchiveSha256 ||
    source.archiveFileSha256 !== projection.sourceFileSha256 ||
    source.archivePath !== projection.sourceArchivePath ||
    source.archivedCandidateCount !== projection.rows.length ||
    source.archiveModified !== false
  ) {
    throw new Error('Scheduled grade report source lineage drifted.');
  }
  const safety = object(report.safety, 'scheduled grade report safety');
  if (
    safety.productionEnabled !== false ||
    safety.rankingEnabled !== false ||
    safety.archiveModified !== false
  ) {
    throw new Error('Scheduled grade report safety boundary drifted.');
  }
  const rawRows = array(report.rows, 'scheduled grade report rows');
  if (rawRows.length !== projection.rows.length) {
    throw new Error('Scheduled grade report row count drifted.');
  }
  const rows = rawRows.map((row, index) =>
    parseGradeRow(row, projection.rows[index], index),
  );
  return Object.freeze({
    reportVersion: report.reportVersion,
    reportType: report.reportType,
    gradedAt: report.gradedAt,
    source: Object.freeze({
      captureKey: source.captureKey,
      archiveSha256: source.archiveSha256,
      archiveFileSha256: source.archiveFileSha256,
      archivePath: source.archivePath,
      archivedCandidateCount: source.archivedCandidateCount,
      archiveModified: false,
    }),
    rows: Object.freeze(rows),
    sourceReportSha256: sha256Bytes(reportBytes),
  });
}

function validatePair(rows, key) {
  if (rows.length !== 2) {
    throw new Error(`Prop ${key} must contain exactly one Higher and one Lower row.`);
  }
  const higher = rows.find((row) => row.selectedSide === 'higher');
  const lower = rows.find((row) => row.selectedSide === 'lower');
  if (higher === undefined || lower === undefined) {
    throw new Error(`Prop ${key} must contain one Higher and one Lower row.`);
  }
  if (
    higher.officialHits !== lower.officialHits ||
    higher.settlementVersion !== lower.settlementVersion ||
    !approximatelyEqual(higher.archivedPWin, lower.archivedPLoss) ||
    !approximatelyEqual(higher.archivedPLoss, lower.archivedPWin) ||
    !approximatelyEqual(higher.archivedPVoid, lower.archivedPVoid) ||
    !approximatelyEqual(
      higher.archivedPWinGivenGrades + lower.archivedPWinGivenGrades,
      1,
    )
  ) {
    throw new Error(`Prop ${key} failed complementary probability integrity.`);
  }
  const outcomesAreComplementary =
    (higher.outcome === 'win' && lower.outcome === 'loss') ||
    (higher.outcome === 'loss' && lower.outcome === 'win') ||
    (higher.outcome === 'void' && lower.outcome === 'void');
  if (!outcomesAreComplementary) {
    throw new Error(`Prop ${key} failed complementary settlement integrity.`);
  }
  const selected = rows.filter(
    (row) => row.archivedPWinGivenGrades >= 0.5,
  );
  if (selected.length !== 1) {
    throw new Error(
      `Prop ${key} must have exactly one selected side with P(Win | grades) >= 0.5; received ${selected.length}.`,
    );
  }
  return Object.freeze({ higher, lower, selected: selected[0] });
}

export function selectOneModelSidePerProp(gradedRows) {
  const rows = array(gradedRows, 'gradedRows');
  const byProp = new Map();
  for (const row of rows) {
    const key = propIdentity(row);
    const group = byProp.get(key) ?? [];
    group.push(row);
    byProp.set(key, group);
  }
  const pairs = [...byProp.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, pairRows]) => validatePair(pairRows, key));
  return Object.freeze({
    pairs: Object.freeze(pairs),
    selectedRows: Object.freeze(pairs.map((pair) => pair.selected)),
  });
}

function performanceSummary(rows) {
  const picks = array(rows, 'performance rows');
  const wins = picks.filter((row) => row.outcome === 'win').length;
  const losses = picks.filter((row) => row.outcome === 'loss').length;
  const voids = picks.filter((row) => row.outcome === 'void').length;
  const decided = picks.filter((row) => row.outcome !== 'void');
  const expectedWins = decided.reduce(
    (total, row) => total + row.archivedPWinGivenGrades,
    0,
  );
  const observedWinRate = decided.length === 0 ? null : wins / decided.length;
  const predictedMeanWinProbability =
    decided.length === 0 ? null : expectedWins / decided.length;
  const binaryBrier =
    decided.length === 0
      ? null
      : decided.reduce((total, row) => {
          const observed = row.outcome === 'win' ? 1 : 0;
          return total + (row.archivedPWinGivenGrades - observed) ** 2;
        }, 0) / decided.length;
  const binaryLogLoss =
    decided.length === 0
      ? null
      : decided.reduce((total, row) => {
          const p = row.archivedPWinGivenGrades;
          const contribution =
            row.outcome === 'win' ? -Math.log(p) : -Math.log(1 - p);
          if (!Number.isFinite(contribution)) {
            throw new Error('Binary log loss is non-finite for a decided pick.');
          }
          return total + contribution;
        }, 0) / decided.length;
  return Object.freeze({
    picksGraded: picks.length,
    wins,
    losses,
    voids,
    decidedPicks: decided.length,
    observedWinRate,
    predictedMeanWinProbability,
    observedMinusPredicted:
      observedWinRate === null || predictedMeanWinProbability === null
        ? null
        : observedWinRate - predictedMeanWinProbability,
    expectedWins,
    actualMinusExpectedWins: wins - expectedWins,
    binaryBrier,
    binaryLogLoss,
  });
}

export function buildSelectedSideCalibration(rows) {
  const picks = array(rows, 'selected-side rows');
  for (const row of picks) {
    if (row.archivedPWinGivenGrades < 0.5) {
      throw new Error('Selected-side calibration cannot contain a probability below 0.5.');
    }
  }
  const buckets = M10_SELECTED_SIDE_CALIBRATION_BUCKETS.map((definition) => {
    const bucketRows = picks.filter(
      (row) =>
        row.archivedPWinGivenGrades >= definition.lowerInclusive &&
        (definition.upperExclusive === null ||
          row.archivedPWinGivenGrades < definition.upperExclusive),
    );
    const summary = performanceSummary(bucketRows);
    return Object.freeze({
      label: definition.label,
      lowerInclusive: definition.lowerInclusive,
      upperExclusive: definition.upperExclusive,
      ...summary,
    });
  });
  const conserved = buckets.reduce(
    (total, bucket) => total + bucket.picksGraded,
    0,
  );
  if (conserved !== picks.length) {
    throw new Error(
      `Selected-side calibration must conserve every pick; expected ${picks.length}, received ${conserved}.`,
    );
  }
  return Object.freeze(buckets);
}

function opportunityMinerRows(gradedRows) {
  const inputs = gradedRows.map((row) => ({
    candidate: Object.freeze({
      ...row,
      playerId: String(row.providerPlayerId),
      eligibilityProbability: 1,
      line: row.postedLine,
      selectedSide: row.selectedSide,
      pWin: row.archivedPWin,
      pLoss: row.archivedPLoss,
      pVoid: row.archivedPVoid,
      pWinGivenGrades: row.archivedPWinGivenGrades,
    }),
    americanPrice: row.americanPrice,
    multiplier: row.multiplier,
  }));
  const selection = selectOpportunityMinerFavoritesV1(inputs);
  return Object.freeze(
    selection.eligibleCandidates.map((candidate) =>
      Object.freeze({
        rank: candidate.rank,
        providerEventId: candidate.providerEventId,
        providerGameId: candidate.providerGameId,
        providerPlayerId: candidate.providerPlayerId,
        providerMarketKey: candidate.providerMarketKey,
        playerName: candidate.playerName,
        offerType: candidate.offerType,
        selectedSide: candidate.selectedSide,
        postedLine: candidate.postedLine,
        americanPrice: candidate.opportunityMiner.americanPrice,
        multiplier: candidate.opportunityMiner.multiplier,
        postedImpliedProbability:
          candidate.opportunityMiner.postedImpliedProbability,
        priceEdge: candidate.opportunityMiner.priceEdge,
        archivedPWinGivenGrades: candidate.archivedPWinGivenGrades,
        officialHits: candidate.officialHits,
        outcome: candidate.outcome,
      }),
    ),
  );
}

function complementaryIntegrity(pairs, allRows) {
  const wins = allRows.filter((row) => row.outcome === 'win').length;
  const losses = allRows.filter((row) => row.outcome === 'loss').length;
  const voids = allRows.filter((row) => row.outcome === 'void').length;
  const decided = wins + losses;
  const predictedMean =
    decided === 0
      ? null
      : allRows
          .filter((row) => row.outcome !== 'void')
          .reduce((total, row) => total + row.archivedPWinGivenGrades, 0) /
        decided;
  return Object.freeze({
    label: 'STRUCTURALLY FORCED INTEGRITY CHECK — NOT A PERFORMANCE MEASURE',
    structurallyForced: true,
    performanceMeasure: false,
    complementaryPropPairs: pairs.length,
    allComplementaryRows: allRows.length,
    wins,
    losses,
    voids,
    observedWinRate: decided === 0 ? null : wins / decided,
    meanPredictedProbability: predictedMean,
    explanation:
      'Each prop contributes both Higher and Lower. Decided outcomes mirror and complementary probabilities average to 0.5, so these all-row figures do not measure model quality.',
  });
}

export function buildSelectedSideArchiveMetricsReportV1({
  projection,
  gradeReport,
  generatedAt,
}) {
  timestamp(generatedAt, 'generatedAt');
  if (gradeReport.source.captureKey !== projection.sourceCaptureKey) {
    throw new Error('Archive and grade report capture identities differ.');
  }
  const { pairs, selectedRows } = selectOneModelSidePerProp(gradeReport.rows);
  const minerRows = opportunityMinerRows(gradeReport.rows);
  return Object.freeze({
    reportVersion: M10_SELECTED_SIDE_GRADE_METRICS_VERSION,
    reportType: 'selected-side-and-opportunity-miner-grade-metrics',
    generatedAt,
    source: Object.freeze({
      captureKey: projection.sourceCaptureKey,
      archiveSha256: projection.sourceArchiveSha256,
      archiveFileSha256: projection.sourceFileSha256,
      archivePath: projection.sourceArchivePath,
      sourceGradeReportVersion: gradeReport.reportVersion,
      sourceGradeReportSha256: gradeReport.sourceReportSha256,
      archiveModified: false,
    }),
    selectedSide: Object.freeze({
      label: 'MODEL-SELECTED SIDE PERFORMANCE',
      selectionRule: 'exactly one complementary side with p_final >= 0.5',
      summary: performanceSummary(selectedRows),
      calibration: buildSelectedSideCalibration(selectedRows),
      rows: selectedRows,
    }),
    opportunityMiner: Object.freeze({
      label: 'OPPORTUNITY MINER POSITIVE-EDGE SUBSET',
      eligibilityRuleVersion:
        'opportunity-miner-positive-american-price-edge-v1',
      summary: performanceSummary(minerRows),
      rows: minerRows,
    }),
    complementaryIntegrity: complementaryIntegrity(pairs, gradeReport.rows),
    safety: Object.freeze({
      productionEnabled: false,
      rankingEnabled: false,
      archiveModified: false,
      finalOnlySourceGradeRequired: true,
    }),
  });
}

function validateAnalyticsReport(report, label) {
  const value = object(report, label);
  if (value.reportVersion !== M10_SELECTED_SIDE_GRADE_METRICS_VERSION) {
    throw new Error(`${label} version is unsupported.`);
  }
  if (value.reportType !== 'selected-side-and-opportunity-miner-grade-metrics') {
    throw new Error(`${label} type is unsupported.`);
  }
  const source = object(value.source, `${label}.source`);
  nonemptyString(source.captureKey, `${label}.source.captureKey`);
  sha256(source.archiveSha256, `${label}.source.archiveSha256`);
  sha256(source.archiveFileSha256, `${label}.source.archiveFileSha256`);
  sha256(source.sourceGradeReportSha256, `${label}.source.sourceGradeReportSha256`);
  if (source.archiveModified !== false) {
    throw new Error(`${label} claims archive mutation.`);
  }
  const safety = object(value.safety, `${label}.safety`);
  if (
    safety.productionEnabled !== false ||
    safety.rankingEnabled !== false ||
    safety.archiveModified !== false ||
    safety.finalOnlySourceGradeRequired !== true
  ) {
    throw new Error(`${label} safety boundary drifted.`);
  }
  const selectedRows = array(
    object(value.selectedSide, `${label}.selectedSide`).rows,
    `${label}.selectedSide.rows`,
  );
  const minerRows = array(
    object(value.opportunityMiner, `${label}.opportunityMiner`).rows,
    `${label}.opportunityMiner.rows`,
  );
  return Object.freeze({ value, source, selectedRows, minerRows });
}

export function buildCumulativeSelectedSideMetricsReportV1({
  reports,
  generatedAt,
}) {
  timestamp(generatedAt, 'generatedAt');
  const inputs = array(reports, 'reports');
  const captures = new Set();
  const sourceReports = [];
  const selectedRows = [];
  const minerRows = [];
  for (const [index, raw] of inputs.entries()) {
    const { value, source, selectedRows: selected, minerRows: miner } =
      validateAnalyticsReport(raw.report, `reports[${index}]`);
    const reportSha256 = sha256(raw.reportSha256, `reports[${index}].reportSha256`);
    if (sha256Bytes(canonicalJsonBytes(value)) !== reportSha256) {
      throw new Error(`reports[${index}] byte identity drifted.`);
    }
    if (captures.has(source.captureKey)) {
      throw new Error(`Duplicate cumulative capture ${source.captureKey}.`);
    }
    captures.add(source.captureKey);
    sourceReports.push(
      Object.freeze({
        captureKey: source.captureKey,
        archiveSha256: source.archiveSha256,
        archiveFileSha256: source.archiveFileSha256,
        sourceGradeReportSha256: source.sourceGradeReportSha256,
        selectedMetricsReportSha256: reportSha256,
      }),
    );
    selectedRows.push(...selected);
    minerRows.push(...miner);
  }
  sourceReports.sort((left, right) =>
    left.captureKey.localeCompare(right.captureKey),
  );
  selectedRows.sort((left, right) =>
    `${left.providerGameId}:${left.providerPlayerId}:${left.providerMarketKey}:${left.offerType}:${left.postedLine}`.localeCompare(
      `${right.providerGameId}:${right.providerPlayerId}:${right.providerMarketKey}:${right.offerType}:${right.postedLine}`,
    ),
  );
  const sourceSetSha256 = sha256Bytes(
    Buffer.from(stableJson(sourceReports), 'utf8'),
  );
  return Object.freeze({
    reportVersion: M10_SELECTED_SIDE_GRADE_METRICS_VERSION,
    reportType: 'cumulative-selected-side-and-opportunity-miner-grade-metrics',
    generatedAt,
    sourceSetSha256,
    archivesIncluded: sourceReports.length,
    sources: Object.freeze(sourceReports),
    selectedSide: Object.freeze({
      label: 'CUMULATIVE MODEL-SELECTED SIDE PERFORMANCE',
      summary: performanceSummary(selectedRows),
      calibration: buildSelectedSideCalibration(selectedRows),
    }),
    opportunityMiner: Object.freeze({
      label: 'CUMULATIVE OPPORTUNITY MINER POSITIVE-EDGE SUBSET',
      summary: performanceSummary(minerRows),
    }),
    complementaryIntegrity: Object.freeze({
      label: 'SOURCE REPORT COMPLEMENTARY INTEGRITY — NOT PERFORMANCE',
      structurallyForced: true,
      performanceMeasure: false,
      archivesChecked: sourceReports.length,
    }),
    safety: Object.freeze({
      productionEnabled: false,
      rankingEnabled: false,
      archivesModified: false,
      finalOnlySourceGradesRequired: true,
    }),
  });
}
