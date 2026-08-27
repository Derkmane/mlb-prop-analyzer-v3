import assert from 'node:assert/strict';
import test from 'node:test';

import {
  HIGH_PROBABILITY_BASELINE_CATEGORY_ID,
} from '../dist/src/categories/index.js';
import {
  BATTER_HITS_DRAFTKINGS_SETTLEMENT_RULE_VERSION,
} from '../dist/src/features/batter-hits/settlement.js';
import {
  recoverBatterHitsGradeProviderMarketKeys,
  retainCategoryAuthorizedDisplayRows,
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

function legacySourceNullHhrRow() {
  return Object.freeze({
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
    providerMarketKey: 'batter_hits_runs_rbis_alternate',
    marketLabel: 'Batter Hits + Runs + RBIs',
    offerType: 'alternate',
    settlementStatistic: 'hits+runs+rbi',
    selectedSide: 'higher',
    postedLine: 0.5,
    americanPrice: -110,
    multiplier: 1,
    pWin: 0.65,
    pLoss: 0.35,
    pVoid: 0,
    pWinGivenGrades: 0.65,
    lineupStatus: 'confirmed',
  });
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

test('real archive compatibility recovers omitted Hits market identity and excludes legacy source-null HHR rows', () => {
  const hitsRow = activeHitsRow();
  const rawHitsGrade = hitsGradeWithoutProviderMarketKey(hitsRow);
  const recoveredHitsGrade = recoverBatterHitsGradeProviderMarketKeys(rawHitsGrade);
  assert.equal(recoveredHitsGrade.rows[0].providerMarketKey, 'batter_hits');

  const hhrArchive = retainCategoryAuthorizedDisplayRows(
    displayArchive('batter-hhr', 'hhr-compat', [legacySourceNullHhrRow()]),
  );
  assert.equal(hhrArchive.rows.length, 0);

  const report = buildProductCategoryPerformanceReportV1({
    pairedCaptures: [
      Object.freeze({
        capturedAt: CAPTURED_AT,
        hitsDisplayArchive: retainCategoryAuthorizedDisplayRows(
          displayArchive('batter-hits', 'hits-compat', [hitsRow]),
        ),
        hhrDisplayArchive: hhrArchive,
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
