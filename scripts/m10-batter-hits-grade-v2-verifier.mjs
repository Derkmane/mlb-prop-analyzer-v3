import { createHash } from 'node:crypto';

import { settleObservedDiscreteStatisticV1 } from '../dist/src/core/index.js';
import { BATTER_HITS_SETTLEMENT_RULE_VERSION } from '../dist/src/features/batter-hits/index.js';
import {
  M10_BATTER_HITS_GRADE_REPORT_TYPE_V2,
  M10_BATTER_HITS_GRADE_VERSION_V2,
} from './m10-batter-hits-final-grade-v2-utils.mjs';

const PROBABILITY_TOLERANCE = 1e-12;

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

function probability(value, label) {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0 || value > 1) {
    throw new TypeError(`${label} must be a probability in [0, 1].`);
  }
  return value;
}

function close(left, right) {
  return Math.abs(left - right) <= PROBABILITY_TOLERANCE;
}

function sha256Bytes(value) {
  return createHash('sha256').update(value).digest('hex');
}

function verifiedRow(rawRow, expectedRow, index) {
  const row = object(rawRow, `v2 grade rows[${index}]`);
  const archivedPWin = probability(row.archivedPWin, `v2 grade rows[${index}].archivedPWin`);
  const archivedPLoss = probability(row.archivedPLoss, `v2 grade rows[${index}].archivedPLoss`);
  const archivedPVoid = probability(row.archivedPVoid, `v2 grade rows[${index}].archivedPVoid`);
  const archivedPWinGivenGrades = probability(
    row.archivedPWinGivenGrades,
    `v2 grade rows[${index}].archivedPWinGivenGrades`,
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
    !close(archivedPWin, expectedRow.pWin) ||
    !close(archivedPLoss, expectedRow.pLoss) ||
    !close(archivedPVoid, expectedRow.pVoid) ||
    !close(archivedPWinGivenGrades, expectedRow.pWinGivenGrades)
  ) {
    throw new Error(`v2 grade rows[${index}] drifted from the immutable archive.`);
  }
  if (row.settlementVersion !== BATTER_HITS_SETTLEMENT_RULE_VERSION) {
    throw new Error(`v2 grade rows[${index}] did not use the registered Batter Hits settlement rule.`);
  }
  if (row.officialHits === null) {
    if (row.outcome !== 'void' || row.settlementReason !== 'verified-final-nonstarter') {
      throw new Error(`v2 grade rows[${index}] null Hits row is not a verified nonstarter void.`);
    }
    const settlement = object(row.gradingSettlement, `v2 grade rows[${index}].gradingSettlement`);
    if (
      settlement.eligibilityProbability !== 0 ||
      settlement.winProbability !== 0 ||
      settlement.lossProbability !== 0 ||
      settlement.voidProbability !== 1 ||
      settlement.winProbabilityGivenGrades !== null ||
      settlement.settlementRuleVersion !== BATTER_HITS_SETTLEMENT_RULE_VERSION
    ) {
      throw new Error(`v2 grade rows[${index}] nonstarter settlement is not a full registered-rule void.`);
    }
  } else {
    if (!Number.isSafeInteger(row.officialHits) || row.officialHits < 0) {
      throw new Error(`v2 grade rows[${index}].officialHits is malformed.`);
    }
    if (row.settlementReason !== 'official-final-hits') {
      throw new Error(`v2 grade rows[${index}] official Hits settlement reason is unsupported.`);
    }
    const settlement = settleObservedDiscreteStatisticV1({
      observedStatistic: row.officialHits,
      line: expectedRow.postedLine,
      selectedSide: expectedRow.selectedSide,
    });
    if (settlement.outcome !== row.outcome || settlement.version !== row.coreSettlementVersion) {
      throw new Error(`v2 grade rows[${index}] core settlement drifted.`);
    }
  }
  return Object.freeze({
    ...expectedRow,
    archivedPWin,
    archivedPLoss,
    archivedPVoid,
    archivedPWinGivenGrades,
    officialHits: row.officialHits,
    outcome: row.outcome,
    settlementVersion: row.settlementVersion,
    settlementReason: row.settlementReason,
  });
}

export function verifyBatterHitsFinalGradeReportV2({ reportBytes, projection }) {
  let parsed;
  try {
    parsed = JSON.parse(Buffer.from(reportBytes).toString('utf8'));
  } catch (error) {
    throw new Error(
      `Batter Hits v2 grade report is not valid JSON: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
  const report = object(parsed, 'Batter Hits v2 grade report');
  if (
    report.reportVersion !== M10_BATTER_HITS_GRADE_VERSION_V2 ||
    report.reportType !== M10_BATTER_HITS_GRADE_REPORT_TYPE_V2
  ) {
    throw new Error('Batter Hits v2 grade report contract is unsupported.');
  }
  const source = object(report.source, 'Batter Hits v2 grade source');
  if (
    source.captureKey !== projection.sourceCaptureKey ||
    source.archiveSha256 !== projection.sourceArchiveSha256 ||
    source.archiveFileSha256 !== projection.sourceFileSha256 ||
    source.archivePath !== projection.sourceArchivePath ||
    source.archivedCandidateCount !== projection.rows.length ||
    source.archiveModified !== false
  ) {
    throw new Error('Batter Hits v2 grade report source lineage drifted.');
  }
  const safety = object(report.safety, 'Batter Hits v2 grade safety');
  if (
    safety.productionEnabled !== false ||
    safety.rankingEnabled !== false ||
    safety.archiveModified !== false ||
    safety.evidenceOnly !== true ||
    safety.finalOnly !== true
  ) {
    throw new Error('Batter Hits v2 grade report safety boundary drifted.');
  }
  const rawRows = array(report.rows, 'Batter Hits v2 grade rows');
  if (rawRows.length !== projection.rows.length) {
    throw new Error('Batter Hits v2 grade report row count drifted.');
  }
  const rows = Object.freeze(rawRows.map((row, index) =>
    verifiedRow(row, projection.rows[index], index),
  ));
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
    rows,
    sourceReportSha256: sha256Bytes(reportBytes),
  });
}
