import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

import {
  buildCumulativeSelectedSideMetricsReportV1,
  buildSelectedSideArchiveMetricsReportV1,
  canonicalJsonBytes,
  selectOneModelSidePerProp,
  sha256Bytes,
} from '../scripts/m10-selected-side-grade-metrics-utils.mjs';

const SHA_A = 'a'.repeat(64);
const SHA_B = 'b'.repeat(64);
const SHA_C = 'c'.repeat(64);

function row({
  rank,
  playerId,
  playerName,
  side,
  p,
  outcome,
  hits,
  americanPrice,
  offerType = 'baseline',
}) {
  return Object.freeze({
    rank,
    providerEventId: playerId.toString(16).padStart(32, '0'),
    providerGameId: 5_000_000 + playerId,
    providerPlayerId: playerId,
    providerMarketKey: `market-${offerType}`,
    playerName,
    offerType,
    selectedSide: side,
    postedLine: 0.5,
    americanPrice,
    multiplier: 1,
    pWin: p,
    pLoss: 1 - p,
    pVoid: 0,
    pWinGivenGrades: p,
    archivedPWin: p,
    archivedPLoss: 1 - p,
    archivedPVoid: 0,
    archivedPWinGivenGrades: p,
    officialHits: hits,
    outcome,
    settlementVersion: 'test-settlement-v1',
  });
}

function pair({
  rank,
  playerId,
  playerName,
  higherP,
  hits,
  higherAmericanPrice,
  lowerAmericanPrice,
  offerType = 'baseline',
}) {
  const higherOutcome = hits > 0.5 ? 'win' : 'loss';
  const lowerOutcome = higherOutcome === 'win' ? 'loss' : 'win';
  return [
    row({
      rank,
      playerId,
      playerName,
      side: 'higher',
      p: higherP,
      outcome: higherOutcome,
      hits,
      americanPrice: higherAmericanPrice,
      offerType,
    }),
    row({
      rank: rank + 1,
      playerId,
      playerName,
      side: 'lower',
      p: 1 - higherP,
      outcome: lowerOutcome,
      hits,
      americanPrice: lowerAmericanPrice,
      offerType,
    }),
  ];
}

function fixture(captureKey = `20260805T160217812Z--${SHA_A}`) {
  const rows = Object.freeze([
    ...pair({
      rank: 1,
      playerId: 101,
      playerName: 'Selected Winner',
      higherP: 0.58,
      hits: 1,
      higherAmericanPrice: -110,
      lowerAmericanPrice: -110,
    }),
    ...pair({
      rank: 3,
      playerId: 102,
      playerName: 'Selected Loser',
      higherP: 0.63,
      hits: 0,
      higherAmericanPrice: -200,
      lowerAmericanPrice: 150,
    }),
    ...pair({
      rank: 5,
      playerId: 103,
      playerName: 'Selected Lower Winner',
      higherP: 0.3,
      hits: 0,
      higherAmericanPrice: 250,
      lowerAmericanPrice: -140,
      offerType: 'alternate',
    }),
  ]);
  const projection = Object.freeze({
    sourceCaptureKey: captureKey,
    sourceArchiveSha256: SHA_B,
    sourceFileSha256: SHA_C,
    sourceArchivePath: `artifacts/board-archives/batter-hits/captures/${captureKey}.json`,
    rows,
  });
  const gradeReport = Object.freeze({
    reportVersion: 'm10-scheduled-saved-archive-final-hits-grading-v1',
    reportType: 'scheduled-real-archived-board-official-hits-grade',
    gradedAt: '2026-08-06T05:00:00.000Z',
    source: Object.freeze({
      captureKey,
      archiveSha256: SHA_B,
      archiveFileSha256: SHA_C,
      archivePath: projection.sourceArchivePath,
      archivedCandidateCount: rows.length,
      archiveModified: false,
    }),
    rows,
    sourceReportSha256: SHA_A,
  });
  return { projection, gradeReport };
}

test('headline performance uses one p_final >= 0.5 side per complementary prop', () => {
  const { projection, gradeReport } = fixture();
  const report = buildSelectedSideArchiveMetricsReportV1({
    projection,
    gradeReport,
    generatedAt: gradeReport.gradedAt,
  });
  assert.equal(report.selectedSide.summary.picksGraded, 3);
  assert.equal(report.selectedSide.summary.wins, 2);
  assert.equal(report.selectedSide.summary.losses, 1);
  assert.equal(report.selectedSide.summary.voids, 0);
  assert.equal(report.selectedSide.summary.observedWinRate, 2 / 3);
  assert.ok(
    Math.abs(
      report.selectedSide.summary.predictedMeanWinProbability -
        (0.58 + 0.63 + 0.7) / 3,
    ) < 1e-12,
  );
  assert.ok(
    Math.abs(report.selectedSide.summary.binaryBrier - 0.2211) < 1e-12,
  );
  const expectedLogLoss =
    (-Math.log(0.58) - Math.log(1 - 0.63) - Math.log(0.7)) / 3;
  assert.ok(
    Math.abs(report.selectedSide.summary.binaryLogLoss - expectedLogLoss) <
      1e-12,
  );
  assert.equal(
    report.selectedSide.calibration.reduce(
      (total, bucket) => total + bucket.picksGraded,
      0,
    ),
    3,
  );
});

test('complementary all-row output is labeled structurally forced and never performance', () => {
  const { projection, gradeReport } = fixture();
  const report = buildSelectedSideArchiveMetricsReportV1({
    projection,
    gradeReport,
    generatedAt: gradeReport.gradedAt,
  });
  assert.equal(report.complementaryIntegrity.complementaryPropPairs, 3);
  assert.equal(report.complementaryIntegrity.allComplementaryRows, 6);
  assert.equal(report.complementaryIntegrity.wins, 3);
  assert.equal(report.complementaryIntegrity.losses, 3);
  assert.equal(report.complementaryIntegrity.observedWinRate, 0.5);
  assert.equal(report.complementaryIntegrity.meanPredictedProbability, 0.5);
  assert.equal(report.complementaryIntegrity.structurallyForced, true);
  assert.equal(report.complementaryIntegrity.performanceMeasure, false);
  assert.match(report.complementaryIntegrity.label, /NOT A PERFORMANCE MEASURE/u);
});

test('Opportunity Miner is derived through the canonical positive-edge selector and reported separately', () => {
  const { projection, gradeReport } = fixture();
  const report = buildSelectedSideArchiveMetricsReportV1({
    projection,
    gradeReport,
    generatedAt: gradeReport.gradedAt,
  });
  assert.deepEqual(
    report.opportunityMiner.rows.map((pick) => ({
      playerName: pick.playerName,
      selectedSide: pick.selectedSide,
      outcome: pick.outcome,
    })),
    [
      {
        playerName: 'Selected Lower Winner',
        selectedSide: 'lower',
        outcome: 'win',
      },
      {
        playerName: 'Selected Winner',
        selectedSide: 'higher',
        outcome: 'win',
      },
    ],
  );
  assert.equal(report.opportunityMiner.summary.picksGraded, 2);
  assert.equal(report.opportunityMiner.summary.wins, 2);
});

test('an exact 50/50 complementary pair fails closed instead of double-selecting', () => {
  const rows = pair({
    rank: 1,
    playerId: 201,
    playerName: 'No Preference',
    higherP: 0.5,
    hits: 1,
    higherAmericanPrice: 100,
    lowerAmericanPrice: 100,
  });
  assert.throws(
    () => selectOneModelSidePerProp(rows),
    /exactly one selected side/u,
  );
});

test('cumulative selected-side metrics conserve running totals and bucket counts across archives', () => {
  const first = fixture();
  const second = fixture(`20260806T160217812Z--${'d'.repeat(64)}`);
  const firstReport = buildSelectedSideArchiveMetricsReportV1({
    projection: first.projection,
    gradeReport: first.gradeReport,
    generatedAt: first.gradeReport.gradedAt,
  });
  const secondReport = buildSelectedSideArchiveMetricsReportV1({
    projection: second.projection,
    gradeReport: second.gradeReport,
    generatedAt: '2026-08-07T05:00:00.000Z',
  });
  const cumulative = buildCumulativeSelectedSideMetricsReportV1({
    reports: [firstReport, secondReport].map((report) => ({
      report,
      reportSha256: sha256Bytes(canonicalJsonBytes(report)),
    })),
    generatedAt: secondReport.generatedAt,
  });
  assert.equal(cumulative.archivesIncluded, 2);
  assert.equal(cumulative.selectedSide.summary.picksGraded, 6);
  assert.equal(cumulative.selectedSide.summary.wins, 4);
  assert.equal(cumulative.selectedSide.summary.losses, 2);
  assert.equal(
    cumulative.selectedSide.calibration.reduce(
      (total, bucket) => total + bucket.picksGraded,
      0,
    ),
    6,
  );
  assert.equal(cumulative.opportunityMiner.summary.picksGraded, 4);
});

test('cumulative grading rejects duplicate archive identities', () => {
  const source = fixture();
  const report = buildSelectedSideArchiveMetricsReportV1({
    projection: source.projection,
    gradeReport: source.gradeReport,
    generatedAt: source.gradeReport.gradedAt,
  });
  const input = {
    report,
    reportSha256: sha256Bytes(canonicalJsonBytes(report)),
  };
  assert.throws(
    () =>
      buildCumulativeSelectedSideMetricsReportV1({
        reports: [input, input],
        generatedAt: report.generatedAt,
      }),
    /Duplicate cumulative capture/u,
  );
});

test('scheduled workflow builds cumulative selected-side evidence and keeps always-on uploads and timeout', async () => {
  const workflow = await readFile(
    '.github/workflows/m10-grade-pending-archives.yml',
    'utf8',
  );
  assert.match(workflow, /timeout-minutes:\s*180/u);
  assert.match(workflow, /build-m10-selected-side-cumulative-grades\.mjs/u);
  assert.ok((workflow.match(/if:\s*always\(\)/gu) ?? []).length >= 3);
  assert.match(workflow, /artifacts\/board-archives\/batter-hits/u);
  assert.doesNotMatch(workflow, /productionEnabled:\s*true/u);
  assert.doesNotMatch(workflow, /rankingEnabled:\s*true/u);
});
