import assert from 'node:assert/strict';
import test from 'node:test';

import {
  HIGH_PROBABILITY_ALTLINE_CATEGORY_ID,
  HIGH_PROBABILITY_BASELINE_CATEGORY_ID,
  OPPORTUNITY_MINER_CATEGORY_ID,
} from '../dist/src/categories/index.js';
import {
  BATTER_HHR_DRAFTKINGS_SETTLEMENT_RULE_VERSION,
} from '../dist/src/features/batter-hhr/contracts.js';
import {
  BATTER_HITS_DRAFTKINGS_SETTLEMENT_RULE_VERSION,
} from '../dist/src/features/batter-hits/settlement.js';
import {
  buildProductCategoryPerformanceReportV1,
} from '../scripts/m10-category-performance-utils.mjs';

const GAME_TIME = '2026-08-25T23:00:00.000Z';

function row({
  gameId,
  playerId,
  playerName,
  marketKey,
  line,
  p,
  price = null,
  multiplier = null,
  settlementRuleVersion,
}) {
  return Object.freeze({
    rank: 1,
    boardSource: 'draftkings',
    providerBookmakerKey: 'draftkings',
    providerRegion: 'us',
    settlementRuleVersion,
    providerEventId: `event-${gameId}`,
    providerGameId: gameId,
    providerPlayerId: playerId,
    providerTeamId: 10,
    playerName,
    teamName: 'Home Club',
    homeTeamName: 'Home Club',
    awayTeamName: 'Away Club',
    eventCommenceTime: GAME_TIME,
    baseMarketKey: marketKey.replace('_alternate', ''),
    providerMarketKey: marketKey,
    marketLabel: marketKey.startsWith('batter_hits_runs_rbis') ? 'Batter Hits + Runs + RBIs' : 'Batter Hits',
    offerType: marketKey.endsWith('_alternate') ? 'alternate' : 'baseline',
    settlementStatistic: marketKey.startsWith('batter_hits_runs_rbis') ? 'hits+runs+rbi' : 'hits',
    selectedSide: 'lower',
    postedLine: line,
    americanPrice: price,
    multiplier,
    pWin: p,
    pLoss: 1 - p,
    pVoid: 0,
    pWinGivenGrades: p,
    lineupStatus: 'confirmed',
    analysisContext: Object.freeze({
      expectedPlateAppearances: 4.2,
      lineupSlot: 3,
      batterSide: 'R',
      opposingStarterHand: 'R',
      venue: null,
      teamImpliedRunTotal: null,
    }),
  });
}

function displayArchive({ persistedMarket, captureKey, capturedAt, rows }) {
  return Object.freeze({
    displayArchiveVersion: 1,
    displayArchiveContract: 'phase1-trimmed-board-display-v1',
    market: persistedMarket,
    captureKey,
    capturedAt,
    captureDateUtc: capturedAt.slice(0, 10),
    fullArchiveSha256: 'a'.repeat(64),
    fullArchiveFileSha256: 'b'.repeat(64),
    productionEnabled: false,
    productionRankingEnabled: false,
    modelVersion: persistedMarket === 'batter-hits'
      ? 'm8-5-batter-hits-successor-freeze-v1'
      : 'm11-batter-hhr-direct-composite-v2',
    distributionBuilderVersion: persistedMarket === 'batter-hits'
      ? 'm9-batter-hits-runtime-distribution-v1'
      : 'm11-batter-hhr-negative-binomial-v1',
    rows: Object.freeze(rows),
  });
}

function gradeRow(sourceRow, outcome) {
  return Object.freeze({
    providerEventId: sourceRow.providerEventId,
    providerGameId: sourceRow.providerGameId,
    providerPlayerId: sourceRow.providerPlayerId,
    providerMarketKey: sourceRow.providerMarketKey,
    boardSource: sourceRow.boardSource,
    providerBookmakerKey: sourceRow.providerBookmakerKey,
    selectedSide: sourceRow.selectedSide,
    postedLine: sourceRow.postedLine,
    outcome,
  });
}

function gradeReport(captureKey, gradedAt, rows) {
  return Object.freeze({
    value: Object.freeze({
      reportVersion: 'test-final-grade-v1',
      reportType: 'test-final-grade-v1',
      gradedAt,
      source: Object.freeze({
        captureKey,
        archiveSha256: 'c'.repeat(64),
        archiveFileSha256: 'd'.repeat(64),
        archiveModified: false,
      }),
      rows: Object.freeze(rows),
      safety: Object.freeze({
        productionEnabled: false,
        rankingEnabled: false,
        archiveModified: false,
        evidenceOnly: true,
        finalOnly: true,
      }),
    }),
    fileSha256: 'e'.repeat(64),
  });
}

function pairedCapture(capturedAt, suffix) {
  const hitsRows = Object.freeze([
    row({
      gameId: 101,
      playerId: 1,
      playerName: 'Baseline Winner',
      marketKey: 'batter_hits',
      line: 1.5,
      p: 0.7,
      price: -120,
      multiplier: 1,
      settlementRuleVersion: BATTER_HITS_DRAFTKINGS_SETTLEMENT_RULE_VERSION,
    }),
    row({
      gameId: 102,
      playerId: 2,
      playerName: 'Altline Loser',
      marketKey: 'batter_hits',
      line: 1.5,
      p: 0.4,
      price: -110,
      multiplier: 1,
      settlementRuleVersion: BATTER_HITS_DRAFTKINGS_SETTLEMENT_RULE_VERSION,
    }),
    row({
      gameId: 102,
      playerId: 2,
      playerName: 'Altline Loser',
      marketKey: 'batter_hits_alternate',
      line: 2.5,
      p: 0.8,
      price: -110,
      multiplier: 1,
      settlementRuleVersion: BATTER_HITS_DRAFTKINGS_SETTLEMENT_RULE_VERSION,
    }),
    row({
      gameId: 104,
      playerId: 4,
      playerName: 'Baseline Void',
      marketKey: 'batter_hits',
      line: 1.5,
      p: 0.6,
      price: null,
      multiplier: null,
      settlementRuleVersion: BATTER_HITS_DRAFTKINGS_SETTLEMENT_RULE_VERSION,
    }),
  ]);
  const hhrRows = Object.freeze([
    row({
      gameId: 103,
      playerId: 3,
      playerName: 'HHR Baseline Loser',
      marketKey: 'batter_hits_runs_rbis',
      line: 1.5,
      p: 0.65,
      price: null,
      multiplier: null,
      settlementRuleVersion: BATTER_HHR_DRAFTKINGS_SETTLEMENT_RULE_VERSION,
    }),
  ]);
  const hitsCaptureKey = `hits-${suffix}`;
  const hhrCaptureKey = `hhr-${suffix}`;
  return Object.freeze({
    capturedAt,
    hitsDisplayArchive: displayArchive({ persistedMarket: 'batter-hits', captureKey: hitsCaptureKey, capturedAt, rows: hitsRows }),
    hhrDisplayArchive: displayArchive({ persistedMarket: 'batter-hhr', captureKey: hhrCaptureKey, capturedAt, rows: hhrRows }),
    hitsGradeReport: gradeReport(hitsCaptureKey, '2026-08-26T05:00:00.000Z', [
      gradeRow(hitsRows[0], 'win'),
      gradeRow(hitsRows[1], 'win'),
      gradeRow(hitsRows[2], 'loss'),
      gradeRow(hitsRows[3], 'void'),
    ]),
    hhrGradeReport: gradeReport(hhrCaptureKey, '2026-08-26T05:05:00.000Z', [
      gradeRow(hhrRows[0], 'loss'),
    ]),
  });
}

test('category performance records each category independently, deduplicates repeated captures, and excludes voids from win rate', () => {
  const report = buildProductCategoryPerformanceReportV1({
    pairedCaptures: [
      pairedCapture('2026-08-25T20:00:00.000Z', 'one'),
      pairedCapture('2026-08-25T20:30:00.000Z', 'two'),
    ],
  });

  assert.ok(report);
  assert.equal(report.pairedCapturesIncluded, 2);
  assert.deepEqual(report.categories[OPPORTUNITY_MINER_CATEGORY_ID], {
    gradedPicks: 2,
    wins: 1,
    losses: 1,
    voids: 0,
    decidedPicks: 2,
    winRate: 0.5,
  });
  assert.deepEqual(report.categories[HIGH_PROBABILITY_BASELINE_CATEGORY_ID], {
    gradedPicks: 3,
    wins: 1,
    losses: 1,
    voids: 1,
    decidedPicks: 2,
    winRate: 0.5,
  });
  assert.deepEqual(report.categories[HIGH_PROBABILITY_ALTLINE_CATEGORY_ID], {
    gradedPicks: 1,
    wins: 0,
    losses: 1,
    voids: 0,
    decidedPicks: 1,
    winRate: 0,
  });
  assert.equal(report.safety.archivesModified, false);
  assert.equal(report.safety.probabilitiesModified, false);
  assert.equal(report.safety.rankingModified, false);
});

test('one-sided archived offers can be graded without synthesizing the opposite side', () => {
  const report = buildProductCategoryPerformanceReportV1({
    pairedCaptures: [pairedCapture('2026-08-25T20:00:00.000Z', 'single')],
  });
  assert.ok(report);
  assert.equal(report.categories[HIGH_PROBABILITY_ALTLINE_CATEGORY_ID].gradedPicks, 1);
  assert.equal(report.categories[HIGH_PROBABILITY_ALTLINE_CATEGORY_ID].losses, 1);
});
