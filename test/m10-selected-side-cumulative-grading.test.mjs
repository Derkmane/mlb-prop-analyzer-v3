import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

import {
  buildCumulativeSelectedSideMetricsReportV2,
  buildSelectedSideArchiveMetricsReportV1,
  canonicalJsonBytes,
  M10_SELECTED_SIDE_CUMULATIVE_GRADE_METRICS_VERSION,
  M10_SELECTED_SIDE_GRADE_METRICS_VERSION,
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
  eventId = playerId.toString(16).padStart(32, '0'),
  gameId = 5_000_000 + playerId,
  marketKey = `market-${offerType}`,
  line = 0.5,
}) {
  return Object.freeze({
    rank,
    providerEventId: eventId,
    providerGameId: gameId,
    providerPlayerId: playerId,
    providerMarketKey: marketKey,
    playerName,
    offerType,
    selectedSide: side,
    postedLine: line,
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
  eventId,
  gameId,
  marketKey,
  line = 0.5,
}) {
  const higherOutcome = hits > line ? 'win' : hits < line ? 'loss' : 'void';
  const lowerOutcome =
    higherOutcome === 'win' ? 'loss' : higherOutcome === 'loss' ? 'win' : 'void';
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
      eventId,
      gameId,
      marketKey,
      line,
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
      eventId,
      gameId,
      marketKey,
      line,
    }),
  ];
}

function reportFixture({
  captureKey,
  gradedAt,
  pairs,
  sourceArchiveSha256 = SHA_B,
  sourceFileSha256 = SHA_C,
  sourceReportSha256 = SHA_A,
}) {
  const rows = Object.freeze(pairs.flat());
  const projection = Object.freeze({
    sourceCaptureKey: captureKey,
    sourceArchiveSha256,
    sourceFileSha256,
    sourceArchivePath: `artifacts/board-archives/batter-hits/captures/${captureKey}.json`,
    rows,
  });
  const gradeReport = Object.freeze({
    reportVersion: 'm10-scheduled-saved-archive-final-hits-grading-v1',
    reportType: 'scheduled-real-archived-board-official-hits-grade',
    gradedAt,
    source: Object.freeze({
      captureKey,
      archiveSha256: sourceArchiveSha256,
      archiveFileSha256: sourceFileSha256,
      archivePath: projection.sourceArchivePath,
      archivedCandidateCount: rows.length,
      archiveModified: false,
    }),
    rows,
    sourceReportSha256,
  });
  const report = buildSelectedSideArchiveMetricsReportV1({
    projection,
    gradeReport,
    generatedAt: gradedAt,
  });
  return Object.freeze({ projection, gradeReport, report });
}

function fixture(captureKey = `20260805T160217812Z--${SHA_A}`) {
  return reportFixture({
    captureKey,
    gradedAt: '2026-08-06T05:00:00.000Z',
    pairs: [
      pair({
        rank: 1,
        playerId: 101,
        playerName: 'Selected Winner',
        higherP: 0.58,
        hits: 1,
        higherAmericanPrice: -110,
        lowerAmericanPrice: -110,
      }),
      pair({
        rank: 3,
        playerId: 102,
        playerName: 'Selected Loser',
        higherP: 0.63,
        hits: 0,
        higherAmericanPrice: -200,
        lowerAmericanPrice: 150,
      }),
      pair({
        rank: 5,
        playerId: 103,
        playerName: 'Selected Lower Winner',
        higherP: 0.3,
        hits: 0,
        higherAmericanPrice: 250,
        lowerAmericanPrice: -140,
        offerType: 'alternate',
      }),
    ],
  });
}

function cumulativeInput(report) {
  return Object.freeze({
    report,
    reportSha256: sha256Bytes(canonicalJsonBytes(report)),
  });
}

test('headline performance uses one p_final >= 0.5 side per complementary prop', () => {
  const { report } = fixture();
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
  const { report } = fixture();
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
  const { report } = fixture();
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

test('Batter Hits cumulative v2 retains only the latest same-day selected side and leaves per-capture bytes unchanged', () => {
  const repeated = {
    playerId: 501,
    playerName: 'Repeated Prop',
    gameId: 7_000_001,
    marketKey: 'batter_hits_alternate',
    offerType: 'alternate',
    line: 0.5,
    hits: 1,
    higherAmericanPrice: -110,
    lowerAmericanPrice: -110,
  };
  const old = reportFixture({
    captureKey: `20260810T120000000Z--${SHA_A}`,
    gradedAt: '2026-08-11T05:00:00.000Z',
    pairs: [pair({ rank: 1, eventId: 'event-old', higherP: 0.62, ...repeated })],
  });
  const middle = reportFixture({
    captureKey: `20260810T130000000Z--${SHA_B}`,
    gradedAt: '2026-08-11T05:05:00.000Z',
    sourceArchiveSha256: SHA_C,
    pairs: [pair({ rank: 1, eventId: 'event-middle', higherP: 0.38, ...repeated })],
  });
  const latest = reportFixture({
    captureKey: `20260810T140000000Z--${SHA_C}`,
    gradedAt: '2026-08-11T05:10:00.000Z',
    sourceArchiveSha256: SHA_A,
    pairs: [
      pair({ rank: 1, eventId: 'event-latest', higherP: 0.67, ...repeated }),
      pair({
        rank: 3,
        eventId: 'event-distinct',
        playerId: 502,
        playerName: 'Distinct Prop',
        gameId: 7_000_002,
        marketKey: 'batter_hits',
        offerType: 'baseline',
        line: 0.5,
        higherP: 0.61,
        hits: 0,
        higherAmericanPrice: -110,
        lowerAmericanPrice: -110,
      }),
    ],
  });

  assert.equal(old.report.reportVersion, M10_SELECTED_SIDE_GRADE_METRICS_VERSION);
  assert.equal(middle.report.reportVersion, M10_SELECTED_SIDE_GRADE_METRICS_VERSION);
  assert.equal(latest.report.reportVersion, M10_SELECTED_SIDE_GRADE_METRICS_VERSION);
  assert.equal(old.report.selectedSide.rows[0].selectedSide, 'higher');
  assert.equal(middle.report.selectedSide.rows[0].selectedSide, 'lower');
  assert.equal(latest.report.selectedSide.rows[0].selectedSide, 'higher');

  const beforeBytes = [old, middle, latest].map(({ report }) => canonicalJsonBytes(report).toString('utf8'));
  const inputs = [old.report, middle.report, latest.report].map(cumulativeInput);
  const generatedAt = latest.report.generatedAt;
  const cumulative = buildCumulativeSelectedSideMetricsReportV2({
    reports: inputs,
    generatedAt,
  });
  const shuffled = buildCumulativeSelectedSideMetricsReportV2({
    reports: [inputs[2], inputs[0], inputs[1]],
    generatedAt,
  });

  assert.equal(cumulative.reportVersion, M10_SELECTED_SIDE_CUMULATIVE_GRADE_METRICS_VERSION);
  assert.equal(cumulative.archivesIncluded, 3);
  assert.equal(cumulative.selectedSide.selectedSideRowsBeforeDedup, 4);
  assert.equal(cumulative.selectedSide.retainedSelectedSideRows, 2);
  assert.equal(cumulative.selectedSide.supersededSelectedSideRows, 2);
  assert.deepEqual(cumulative.selectedSide.deduplicationIdentity, [
    'providerGameId',
    'providerPlayerId',
    'providerMarketKey',
    'offerType',
    'postedLine',
  ]);
  assert.equal(
    cumulative.selectedSide.deduplicationWinnerRule,
    'most-recent-capture-timestamp-only',
  );

  const repeatedEvidence = cumulative.selectedSide.evidenceRows.filter(
    (evidence) => evidence.providerPlayerId === repeated.playerId,
  );
  assert.equal(repeatedEvidence.length, 3);
  assert.deepEqual(
    repeatedEvidence.map((evidence) => evidence.providerEventId),
    ['event-old', 'event-middle', 'event-latest'],
  );
  assert.deepEqual(
    repeatedEvidence.map((evidence) => evidence.selectedSide),
    ['higher', 'lower', 'higher'],
  );
  assert.deepEqual(
    repeatedEvidence.map((evidence) => evidence.calibrationDedupStatus),
    ['superseded', 'superseded', 'retained'],
  );
  assert.deepEqual(
    repeatedEvidence.map((evidence) => evidence.calibrationEligible),
    [false, false, true],
  );
  assert.equal(repeatedEvidence[0].supersededByCaptureKey, latest.projection.sourceCaptureKey);
  assert.equal(repeatedEvidence[1].supersededByCaptureKey, latest.projection.sourceCaptureKey);
  assert.equal(repeatedEvidence[2].supersededByCaptureKey, null);
  assert.equal(repeatedEvidence[2].captureTimestamp, '2026-08-10T14:00:00.000Z');
  assert.equal(repeatedEvidence[2].archivedPWinGivenGrades, 0.67);

  assert.equal(cumulative.selectedSide.summary.picksGraded, 2);
  assert.equal(
    cumulative.selectedSide.calibration.reduce(
      (total, bucket) => total + bucket.picksGraded,
      0,
    ),
    2,
  );
  assert.ok(
    cumulative.selectedSide.evidenceRows.some(
      (evidence) =>
        evidence.providerPlayerId === 502 &&
        evidence.calibrationDedupStatus === 'retained',
    ),
  );

  const expectedMinerPicks =
    old.report.opportunityMiner.summary.picksGraded +
    middle.report.opportunityMiner.summary.picksGraded +
    latest.report.opportunityMiner.summary.picksGraded;
  assert.equal(cumulative.opportunityMiner.summary.picksGraded, expectedMinerPicks);

  assert.equal(cumulative.sourceSetSha256, shuffled.sourceSetSha256);
  assert.deepEqual(canonicalJsonBytes(cumulative), canonicalJsonBytes(shuffled));
  assert.deepEqual(
    [old, middle, latest].map(({ report }) => canonicalJsonBytes(report).toString('utf8')),
    beforeBytes,
  );
});

test('Batter Hits cumulative v2 fails closed when the same identity has two different capture keys at one timestamp', () => {
  const common = {
    playerId: 601,
    playerName: 'Ambiguous Prop',
    gameId: 7_100_001,
    marketKey: 'batter_hits',
    offerType: 'baseline',
    line: 0.5,
    hits: 1,
    higherAmericanPrice: -110,
    lowerAmericanPrice: -110,
  };
  const first = reportFixture({
    captureKey: `20260810T150000000Z--${SHA_A}`,
    gradedAt: '2026-08-11T06:00:00.000Z',
    pairs: [pair({ rank: 1, eventId: 'ambiguous-a', higherP: 0.6, ...common })],
  });
  const second = reportFixture({
    captureKey: `20260810T150000000Z--${SHA_B}`,
    gradedAt: '2026-08-11T06:01:00.000Z',
    sourceArchiveSha256: SHA_C,
    pairs: [pair({ rank: 1, eventId: 'ambiguous-b', higherP: 0.7, ...common })],
  });
  assert.throws(
    () =>
      buildCumulativeSelectedSideMetricsReportV2({
        reports: [cumulativeInput(first.report), cumulativeInput(second.report)],
        generatedAt: second.report.generatedAt,
      }),
    /latest-capture selection is ambiguous/u,
  );
});

test('cumulative grading rejects duplicate archive identities under v2', () => {
  const source = fixture();
  const input = cumulativeInput(source.report);
  assert.throws(
    () =>
      buildCumulativeSelectedSideMetricsReportV2({
        reports: [input, input],
        generatedAt: source.report.generatedAt,
      }),
    /Duplicate cumulative capture/u,
  );
});

test('scheduled workflow builds cumulative v2 evidence and keeps always-on uploads and timeout', async () => {
  const workflow = await readFile(
    '.github/workflows/m10-grade-pending-archives.yml',
    'utf8',
  );
  assert.match(workflow, /timeout-minutes:\s*180/u);
  assert.match(workflow, /build-m10-selected-side-cumulative-grades\.mjs/u);
  assert.match(workflow, /m10-multi-market-cumulative-selected-side-v2--\*\.json/u);
  assert.doesNotMatch(workflow, /git add -f -- artifacts\/board-archives\/cumulative\/m10-multi-market-cumulative-selected-side-v1--\*\.json/u);
  assert.ok((workflow.match(/if:\s*always\(\)/gu) ?? []).length >= 3);
  assert.match(workflow, /artifacts\/board-archives\/batter-hits/u);
  assert.doesNotMatch(workflow, /productionEnabled:\s*true/u);
  assert.doesNotMatch(workflow, /rankingEnabled:\s*true/u);
});
