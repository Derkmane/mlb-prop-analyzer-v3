import assert from 'node:assert/strict';
import test from 'node:test';

import {
  buildCumulativeSelectedSideMetricsReportV2,
  buildSelectedSideArchiveMetricsReportV1,
  canonicalJsonBytes,
  sha256Bytes,
} from '../scripts/m10-selected-side-grade-metrics-utils.mjs';

const SHA_A = 'a'.repeat(64);
const SHA_B = 'b'.repeat(64);
const SHA_C = 'c'.repeat(64);
const CAPTURE_KEY = `20260818T150000000Z--${SHA_A}`;

function gradedRow({
  rank,
  playerId,
  side,
  probability,
  officialHits,
  outcome,
}) {
  return Object.freeze({
    rank,
    providerEventId: `event-${playerId}`,
    providerGameId: 8_000_000 + playerId,
    providerPlayerId: playerId,
    providerMarketKey: 'batter_hits',
    playerName: `Player ${playerId}`,
    offerType: 'baseline',
    selectedSide: side,
    postedLine: 0.5,
    americanPrice: -110,
    multiplier: 1,
    pWin: probability,
    pLoss: 1 - probability,
    pVoid: 0,
    pWinGivenGrades: probability,
    archivedPWin: probability,
    archivedPLoss: 1 - probability,
    archivedPVoid: 0,
    archivedPWinGivenGrades: probability,
    officialHits,
    outcome,
    settlementVersion: 'underdog-batter-hits-settlement-v1',
    settlementReason: officialHits === null ? 'verified-final-nonstarter' : 'official-final-hits',
  });
}

function pair({ playerId, higherProbability, officialHits, higherOutcome, lowerOutcome }) {
  return Object.freeze([
    gradedRow({
      rank: playerId * 2 - 1,
      playerId,
      side: 'higher',
      probability: higherProbability,
      officialHits,
      outcome: higherOutcome,
    }),
    gradedRow({
      rank: playerId * 2,
      playerId,
      side: 'lower',
      probability: 1 - higherProbability,
      officialHits,
      outcome: lowerOutcome,
    }),
  ]);
}

function fixture() {
  const rows = Object.freeze([
    ...pair({
      playerId: 1,
      higherProbability: 0.62,
      officialHits: 1,
      higherOutcome: 'win',
      lowerOutcome: 'loss',
    }),
    ...pair({
      playerId: 2,
      higherProbability: 0.61,
      officialHits: null,
      higherOutcome: 'void',
      lowerOutcome: 'void',
    }),
  ]);
  const projection = Object.freeze({
    sourceCaptureKey: CAPTURE_KEY,
    sourceArchiveSha256: SHA_B,
    sourceFileSha256: SHA_C,
    sourceArchivePath: `artifacts/board-archives/batter-hits/captures/${CAPTURE_KEY}.json`,
    rows,
  });
  const gradeReport = Object.freeze({
    reportVersion: 'm10-scheduled-saved-archive-final-hits-grading-v2',
    reportType: 'scheduled-real-archived-board-official-hits-grade-v2',
    gradedAt: '2026-08-19T09:00:00.000Z',
    source: Object.freeze({ captureKey: CAPTURE_KEY }),
    rows,
    sourceReportSha256: SHA_A,
  });
  const report = buildSelectedSideArchiveMetricsReportV1({
    projection,
    gradeReport,
    generatedAt: gradeReport.gradedAt,
  });
  return Object.freeze({ report });
}

function calibrationCount(calibration) {
  return calibration.reduce((total, bucket) => total + bucket.picksGraded, 0);
}

test('verified Batter Hits nonstarter void stays in evidence but is excluded from per-archive and cumulative calibration volume', () => {
  const { report } = fixture();

  assert.equal(report.selectedSide.rows.length, 2);
  assert.equal(report.selectedSide.summary.picksGraded, 2);
  assert.equal(report.selectedSide.summary.decidedPicks, 1);
  assert.equal(report.selectedSide.summary.voids, 1);
  assert.equal(calibrationCount(report.selectedSide.calibration), 1);
  assert.equal(
    report.selectedSide.calibration.reduce((total, bucket) => total + bucket.voids, 0),
    0,
  );
  const nonstarter = report.selectedSide.rows.find((row) => row.providerPlayerId === 2);
  assert.ok(nonstarter);
  assert.equal(nonstarter.officialHits, null);
  assert.equal(nonstarter.outcome, 'void');
  assert.equal(nonstarter.settlementReason, 'verified-final-nonstarter');

  const cumulative = buildCumulativeSelectedSideMetricsReportV2({
    reports: [Object.freeze({
      report,
      reportSha256: sha256Bytes(canonicalJsonBytes(report)),
    })],
    generatedAt: report.generatedAt,
  });

  assert.equal(cumulative.selectedSide.retainedSelectedSideRows, 2);
  assert.equal(cumulative.selectedSide.summary.picksGraded, 2);
  assert.equal(cumulative.selectedSide.summary.decidedPicks, 1);
  assert.equal(cumulative.selectedSide.summary.voids, 1);
  assert.equal(calibrationCount(cumulative.selectedSide.calibration), 1);
  const voidEvidence = cumulative.selectedSide.evidenceRows.find(
    (row) => row.providerPlayerId === 2,
  );
  assert.ok(voidEvidence);
  assert.equal(voidEvidence.calibrationDedupStatus, 'retained');
  assert.equal(voidEvidence.calibrationEligible, false);
  assert.equal(voidEvidence.calibrationExclusionReason, 'void');
});
