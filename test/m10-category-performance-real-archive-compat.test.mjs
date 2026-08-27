import assert from 'node:assert/strict';
import test from 'node:test';

import {
  HIGH_PROBABILITY_ALTLINE_CATEGORY_ID,
  HIGH_PROBABILITY_BASELINE_CATEGORY_ID,
  OPPORTUNITY_MINER_CATEGORY_ID,
} from '../dist/src/categories/index.js';
import {
  BATTER_HITS_DRAFTKINGS_SETTLEMENT_RULE_VERSION,
} from '../dist/src/features/batter-hits/settlement.js';
import {
  recoverBatterHitsGradeProviderMarketKeys,
  retainCategoryPerformanceDisplayRows,
} from '../scripts/build-m10-category-performance.mjs';
import {
  buildProductCategoryPerformanceReportV1,
} from '../scripts/m10-category-performance-utils.mjs';

const CAPTURED_AT = '2026-08-25T20:00:00.000Z';
const GAME_TIME = '2026-08-25T23:00:00.000Z';

function displayArchive(persistedMarket, captureKey, rows) {
  return Object.freeze({
    displayArchiveVersion: 1,
    displayArchiveContract: 'phase1-trimmed-board-display-v1',
    market: persistedMarket,
    captureKey,
    capturedAt: CAPTURED_AT,
    captureDateUtc: '2026-08-25',
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

function activeHitsRow() {
  return Object.freeze({
    rank: 1,
    boardSource: 'draftkings',
    providerBookmakerKey: 'draftkings',
    providerRegion: 'us',
    settlementRuleVersion: BATTER_HITS_DRAFTKINGS_SETTLEMENT_RULE_VERSION,
    providerEventId: 'event-hits-compat',
    providerGameId: 9001,
    providerPlayerId: 501,
    providerTeamId: 10,
    playerName: 'Compatibility Batter',
    teamName: 'Home Club',
    homeTeamName: 'Home Club',
    awayTeamName: 'Away Club',
    eventCommenceTime: GAME_TIME,
    baseMarketKey: 'batter_hits',
    providerMarketKey: 'batter_hits',
    marketLabel: 'Batter Hits',
    offerType: 'baseline',
    settlementStatistic: 'hits',
    selectedSide: 'lower',
    postedLine: 1.5,
    americanPrice: null,
    multiplier: null,
    pWin: 0.7,
    pLoss: 0.3,
    pVoid: 0,
    pWinGivenGrades: 0.7,
    lineupStatus: 'confirmed',
    analysisContext: Object.freeze({
      expectedPlateAppearances: 4.2,
      lineupSlot: 2,
      batterSide: 'R',
      opposingStarterHand: 'R',
      venue: null,
      teamImpliedRunTotal: null,
    }),
  });
}

function legacyHhrRows() {
  const shared = Object.freeze({
    rank: null,
    providerEventId: 'event-hhr-legacy',
    providerGameId: 9002,
    providerPlayerId: 502,
    providerTeamId: null,
    playerName: 'Legacy HHR Batter',
    teamName: null,
    homeTeamName: 'Home Club',
    awayTeamName: 'Away Club',
    eventCommenceTime: GAME_TIME,
    baseMarketKey: 'batter_hits_runs_rbis',
    marketLabel: 'Batter Hits + Runs + RBIs',
    settlementStatistic: 'hits+runs+rbi',
    americanPrice: -110,
    multiplier: 1.1,
    pVoid: 0,
    lineupStatus: 'confirmed',
  });
  return Object.freeze([
    Object.freeze({
      ...shared,
      providerMarketKey: 'batter_hits_runs_rbis',
      offerType: 'baseline',
      selectedSide: 'lower',
      postedLine: 1.5,
      pWin: 0.55,
      pLoss: 0.45,
      pWinGivenGrades: 0.55,
    }),
    Object.freeze({
      ...shared,
      providerMarketKey: 'batter_hits_runs_rbis_alternate',
      offerType: 'alternate',
      selectedSide: 'higher',
      postedLine: 0.5,
      pWin: 0.65,
      pLoss: 0.35,
      pWinGivenGrades: 0.65,
    }),
  ]);
}

function hitsGradeWithoutProviderMarketKey(hitsRow) {
  return Object.freeze({
    reportVersion: 'm10-scheduled-saved-archive-final-hits-grading-v2',
    reportType: 'scheduled-real-archived-board-official-hits-grade-v2',
    gradedAt: '2026-08-26T05:00:00.000Z',
    source: Object.freeze({
      captureKey: 'hits-compat',
      archiveSha256: 'c'.repeat(64),
      archiveFileSha256: 'd'.repeat(64),
      archiveModified: false,
    }),
    rows: Object.freeze([
      Object.freeze({
        providerEventId: hitsRow.providerEventId,
        providerGameId: hitsRow.providerGameId,
        providerPlayerId: hitsRow.providerPlayerId,
        playerName: hitsRow.playerName,
        offerType: 'baseline',
        selectedSide: hitsRow.selectedSide,
        postedLine: hitsRow.postedLine,
        outcome: 'win',
      }),
    ]),
    safety: Object.freeze({
      productionEnabled: false,
      rankingEnabled: false,
      archiveModified: false,
      evidenceOnly: true,
      finalOnly: true,
    }),
  });
}

function hhrGradeReport(rows) {
  return Object.freeze({
    value: Object.freeze({
      reportVersion: 1,
      reportType: 'm10-hhr-final-grade-v1',
      gradedAt: '2026-08-26T05:05:00.000Z',
      source: Object.freeze({
        captureKey: 'hhr-legacy',
        archiveSha256: 'f'.repeat(64),
        archiveFileSha256: '0'.repeat(64),
        archiveModified: false,
      }),
      rows: Object.freeze([
        Object.freeze({
          providerEventId: rows[0].providerEventId,
          providerGameId: rows[0].providerGameId,
          providerPlayerId: rows[0].providerPlayerId,
          providerMarketKey: rows[0].providerMarketKey,
          selectedSide: rows[0].selectedSide,
          postedLine: rows[0].postedLine,
          outcome: 'win',
        }),
        Object.freeze({
          providerEventId: rows[1].providerEventId,
          providerGameId: rows[1].providerGameId,
          providerPlayerId: rows[1].providerPlayerId,
          providerMarketKey: rows[1].providerMarketKey,
          selectedSide: rows[1].selectedSide,
          postedLine: rows[1].postedLine,
          outcome: 'loss',
        }),
      ]),
      safety: Object.freeze({
        productionEnabled: false,
        rankingEnabled: false,
        archiveModified: false,
        evidenceOnly: true,
        finalOnly: true,
      }),
    }),
    fileSha256: '1'.repeat(64),
  });
}

test('active-source category performance still recovers omitted Hits market identity', () => {
  const hitsRow = activeHitsRow();
  const rawHitsGrade = hitsGradeWithoutProviderMarketKey(hitsRow);
  const recoveredHitsGrade = recoverBatterHitsGradeProviderMarketKeys(rawHitsGrade);
  assert.equal(recoveredHitsGrade.rows[0].providerMarketKey, 'batter_hits');

  const report = buildProductCategoryPerformanceReportV1({
    pairedCaptures: [
      Object.freeze({
        capturedAt: CAPTURED_AT,
        hitsDisplayArchive: retainCategoryPerformanceDisplayRows(
          displayArchive('batter-hits', 'hits-compat', [hitsRow]),
        ),
        hhrDisplayArchive: retainCategoryPerformanceDisplayRows(
          displayArchive('batter-hhr', 'hhr-compat', []),
        ),
        hitsGradeReport: Object.freeze({
          value: recoveredHitsGrade,
          fileSha256: 'e'.repeat(64),
        }),
        hhrGradeReport: null,
      }),
    ],
  });

  assert.ok(report);
  assert.deepEqual(report.categories[HIGH_PROBABILITY_BASELINE_CATEGORY_ID], {
    gradedPicks: 1,
    wins: 1,
    losses: 0,
    voids: 0,
    decidedPicks: 1,
    winRate: 1,
  });
});

test('legacy source-null saved rows remain eligible for historical category W-L-V reconstruction', () => {
  const hhrRows = legacyHhrRows();
  const retainedHhrArchive = retainCategoryPerformanceDisplayRows(
    displayArchive('batter-hhr', 'hhr-legacy', hhrRows),
  );
  assert.equal(retainedHhrArchive.rows.length, 2);

  const report = buildProductCategoryPerformanceReportV1({
    pairedCaptures: [
      Object.freeze({
        capturedAt: CAPTURED_AT,
        hitsDisplayArchive: retainCategoryPerformanceDisplayRows(
          displayArchive('batter-hits', 'hits-legacy', []),
        ),
        hhrDisplayArchive: retainedHhrArchive,
        hitsGradeReport: null,
        hhrGradeReport: hhrGradeReport(hhrRows),
      }),
    ],
  });

  assert.ok(report);
  assert.deepEqual(report.categories[OPPORTUNITY_MINER_CATEGORY_ID], {
    gradedPicks: 1,
    wins: 0,
    losses: 1,
    voids: 0,
    decidedPicks: 1,
    winRate: 0,
  });
  assert.deepEqual(report.categories[HIGH_PROBABILITY_BASELINE_CATEGORY_ID], {
    gradedPicks: 1,
    wins: 1,
    losses: 0,
    voids: 0,
    decidedPicks: 1,
    winRate: 1,
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

test('Hits market-key recovery fails closed when the preserved offer type is unsupported', () => {
  const hitsRow = activeHitsRow();
  const raw = hitsGradeWithoutProviderMarketKey(hitsRow);
  const malformed = Object.freeze({
    ...raw,
    rows: Object.freeze([
      Object.freeze({ ...raw.rows[0], offerType: 'unknown' }),
    ]),
  });
  assert.throws(
    () => recoverBatterHitsGradeProviderMarketKeys(malformed),
    /missing providerMarketKey and has unsupported offerType/u,
  );
});
