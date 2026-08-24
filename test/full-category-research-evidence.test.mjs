import assert from 'node:assert/strict';
import test from 'node:test';

import {
  buildSelectedSideArchiveMetricsReportV1,
} from '../scripts/m10-selected-side-grade-metrics-utils.mjs';

const SHA_A = 'a'.repeat(64);
const SHA_B = 'b'.repeat(64);

function gradedRow({ rank, playerId, side, p, outcome }) {
  return Object.freeze({
    rank,
    providerEventId: `event-${playerId}`,
    providerGameId: 8_000_000 + playerId,
    providerPlayerId: playerId,
    providerMarketKey: 'batter_hits',
    playerName: `Research Pick ${playerId}`,
    offerType: 'baseline',
    selectedSide: side,
    postedLine: 0.5,
    americanPrice: -110,
    multiplier: 1,
    pWin: p,
    pLoss: 1 - p,
    pVoid: 0,
    pWinGivenGrades: p,
    archivedPWin: p,
    archivedPLoss: 1 - p,
    archivedPVoid: 0,
    archivedPWinGivenGrades: p,
    officialHits: outcome === 'win' && side === 'higher' ? 1 : 0,
    outcome,
    settlementVersion: 'test-settlement-v1',
  });
}

function complementaryPair(index) {
  const playerId = 700 + index;
  const higherP = 0.60 + index * 0.01;
  const higherWins = index % 2 === 0;
  return Object.freeze([
    gradedRow({
      rank: index * 2 + 1,
      playerId,
      side: 'higher',
      p: higherP,
      outcome: higherWins ? 'win' : 'loss',
    }),
    gradedRow({
      rank: index * 2 + 2,
      playerId,
      side: 'lower',
      p: 1 - higherP,
      outcome: higherWins ? 'loss' : 'win',
    }),
  ]);
}

test('research evidence retains every model-selected prop beyond the Top Five', () => {
  const rows = Object.freeze(
    Array.from({ length: 8 }, (_, index) => complementaryPair(index)).flat(),
  );
  const captureKey = `20260824T180305443Z--${SHA_A}`;
  const projection = Object.freeze({
    sourceCaptureKey: captureKey,
    sourceArchiveSha256: SHA_A,
    sourceFileSha256: SHA_B,
    sourceArchivePath: `artifacts/board-archives/batter-hits/captures/${captureKey}.json`,
    rows,
  });
  const gradeReport = Object.freeze({
    reportVersion: 'test-grade-v1',
    reportType: 'test-grade',
    gradedAt: '2026-08-25T05:00:00.000Z',
    source: Object.freeze({ captureKey }),
    rows,
    sourceReportSha256: SHA_B,
  });

  const report = buildSelectedSideArchiveMetricsReportV1({
    projection,
    gradeReport,
    generatedAt: gradeReport.gradedAt,
  });

  assert.equal(report.selectedSide.rows.length, 8);
  assert.equal(report.selectedSide.summary.picksGraded, 8);
  assert.deepEqual(
    report.selectedSide.rows.map((row) => row.playerName),
    Array.from({ length: 8 }, (_, index) => `Research Pick ${700 + index}`),
  );
  assert.equal(
    report.selectedSide.rows.some((row) => row.playerName === 'Research Pick 705'),
    true,
  );
  assert.equal(
    report.selectedSide.rows.some((row) => row.playerName === 'Research Pick 707'),
    true,
  );
});
