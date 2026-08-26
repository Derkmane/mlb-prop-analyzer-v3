import { createHash } from 'node:crypto';

import {
  buildResearchProductBoardV2,
  PRODUCT_CATEGORY_TITLES,
  PRODUCT_DISPLAY_BOARD_VERSION,
  RESEARCH_BATTER_HHR_MARKET,
  RESEARCH_BATTER_HITS_MARKET,
} from '../dist/src/application/index.js';

export const CATEGORY_PERFORMANCE_REPORT_VERSION = 1;
export const CATEGORY_PERFORMANCE_REPORT_TYPE = 'product-category-performance-v1';

const DISPLAY_ARCHIVE_CONTRACT = 'phase1-trimmed-board-display-v1';
const SUPPORTED_PERSISTED_MARKETS = Object.freeze({
  'batter-hits': RESEARCH_BATTER_HITS_MARKET,
  'batter-hhr': RESEARCH_BATTER_HHR_MARKET,
});

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

function string(value, label) {
  if (typeof value !== 'string' || value.length === 0) {
    throw new TypeError(`${label} must be a nonempty string.`);
  }
  return value;
}

function timestamp(value, label) {
  const result = string(value, label);
  if (!Number.isFinite(Date.parse(result))) throw new TypeError(`${label} must be an ISO timestamp.`);
  return result;
}

function finite(value, label) {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new TypeError(`${label} must be finite.`);
  }
  return value;
}

function integer(value, label) {
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new TypeError(`${label} must be a positive safe integer.`);
  }
  return value;
}

function nullableFinite(value, label) {
  if (value === null || value === undefined) return null;
  return finite(value, label);
}

function nullableString(value, label) {
  if (value === null || value === undefined) return null;
  return string(value, label);
}

function probability(value, label) {
  const result = finite(value, label);
  if (result < 0 || result > 1) throw new RangeError(`${label} must be in [0, 1].`);
  return result;
}

function stableJson(value) {
  if (value === null || typeof value === 'boolean' || typeof value === 'string') return JSON.stringify(value);
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw new TypeError('Stable JSON numbers must be finite.');
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`;
  if (typeof value === 'object') {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableJson(value[key])}`).join(',')}}`;
  }
  throw new TypeError('Stable JSON value is unsupported.');
}

function sha256(value) {
  return createHash('sha256').update(value).digest('hex');
}

function displayMarket(persistedMarket) {
  const market = SUPPORTED_PERSISTED_MARKETS[persistedMarket];
  if (market === undefined) throw new Error(`Unsupported category-performance display market ${persistedMarket}.`);
  return market;
}

function enrichmentForRow(source, row) {
  if (source.displayEnrichment === undefined) return null;
  const envelope = object(source.displayEnrichment, 'displayEnrichment');
  const byKey = object(envelope.byGamePlayerKey, 'displayEnrichment.byGamePlayerKey');
  const value = byKey[`${row.providerGameId}:${row.providerPlayerId}`];
  return value === undefined ? null : Object.freeze(object(value, 'display enrichment row'));
}

function normalizeDisplayRow({ source, market, raw, index }) {
  const row = object(raw, `${market} rows[${index}]`);
  const pWin = probability(row.pWin, `${market} rows[${index}].pWin`);
  const pLoss = probability(row.pLoss, `${market} rows[${index}].pLoss`);
  const pVoid = probability(row.pVoid, `${market} rows[${index}].pVoid`);
  const pWinGivenGrades = probability(row.pWinGivenGrades, `${market} rows[${index}].pWinGivenGrades`);
  if (Math.abs(pWin + pLoss + pVoid - 1) > 1e-9) {
    throw new Error(`${market} rows[${index}] probability mass drifted.`);
  }
  const boardSource = row.boardSource ?? null;
  if (boardSource !== null && boardSource !== 'pick6' && boardSource !== 'draftkings') {
    throw new Error(`${market} rows[${index}].boardSource is unsupported.`);
  }
  const providerBookmakerKey = row.providerBookmakerKey ?? (boardSource ?? 'underdog');
  const providerRegion = row.providerRegion ?? (boardSource === 'draftkings' ? 'us' : 'us_dfs');
  const analysis = row.analysisContext === undefined ? {} : object(row.analysisContext, `${market} rows[${index}].analysisContext`);
  const providerGameId = integer(row.providerGameId, `${market} rows[${index}].providerGameId`);
  const providerPlayerId = integer(row.providerPlayerId, `${market} rows[${index}].providerPlayerId`);
  return Object.freeze({
    market,
    captureKey: string(source.captureKey, `${market} captureKey`),
    capturedAt: timestamp(source.capturedAt, `${market} capturedAt`),
    modelVersion: string(source.modelVersion, `${market} modelVersion`),
    distributionBuilderVersion: string(source.distributionBuilderVersion, `${market} distributionBuilderVersion`),
    boardSource,
    providerBookmakerKey,
    providerRegion,
    settlementRuleVersion: nullableString(row.settlementRuleVersion, `${market} settlementRuleVersion`),
    providerEventId: string(row.providerEventId, `${market} providerEventId`),
    providerGameId,
    providerPlayerId,
    playerName: string(row.playerName, `${market} playerName`),
    teamName: string(row.teamName, `${market} teamName`),
    homeTeamName: string(row.homeTeamName, `${market} homeTeamName`),
    awayTeamName: string(row.awayTeamName, `${market} awayTeamName`),
    eventCommenceTime: timestamp(row.eventCommenceTime, `${market} eventCommenceTime`),
    providerMarketKey: string(row.providerMarketKey, `${market} providerMarketKey`),
    offerType: string(row.offerType, `${market} offerType`),
    selectedSide: string(row.selectedSide, `${market} selectedSide`),
    postedLine: finite(row.postedLine, `${market} postedLine`),
    americanPrice: nullableFinite(row.americanPrice, `${market} americanPrice`),
    multiplier: nullableFinite(row.multiplier, `${market} multiplier`),
    pWin,
    pLoss,
    pVoid,
    pWinGivenGrades,
    lineupStatus: nullableString(row.lineupStatus, `${market} lineupStatus`),
    analysisContext: Object.freeze({
      expectedPlateAppearances: nullableFinite(analysis.expectedPlateAppearances, `${market} expectedPlateAppearances`),
      lineupSlot: nullableFinite(analysis.lineupSlot, `${market} lineupSlot`),
      batterSide: nullableString(analysis.batterSide, `${market} batterSide`),
      opposingStarterHand: nullableString(analysis.opposingStarterHand, `${market} opposingStarterHand`),
      venue: nullableString(analysis.venue, `${market} venue`),
      teamImpliedRunTotal: nullableFinite(analysis.teamImpliedRunTotal, `${market} teamImpliedRunTotal`),
    }),
    enrichment: enrichmentForRow(source, { providerGameId, providerPlayerId }),
  });
}

export function normalizeCategoryPerformanceDisplayArchive(persistedMarket, raw) {
  const source = object(raw, `${persistedMarket} display archive`);
  if (
    source.displayArchiveVersion !== 1 ||
    source.displayArchiveContract !== DISPLAY_ARCHIVE_CONTRACT ||
    source.market !== persistedMarket
  ) {
    throw new Error(`${persistedMarket} display archive contract is unsupported.`);
  }
  if (source.productionEnabled !== false || source.productionRankingEnabled !== false) {
    throw new Error(`${persistedMarket} display archive must remain production-disabled.`);
  }
  const market = displayMarket(persistedMarket);
  const rows = array(source.rows, `${persistedMarket} rows`).map((row, index) =>
    normalizeDisplayRow({ source, market, raw: row, index }),
  );
  return Object.freeze({
    market,
    persistedMarket,
    captureKey: string(source.captureKey, `${persistedMarket} captureKey`),
    capturedAt: timestamp(source.capturedAt, `${persistedMarket} capturedAt`),
    modelVersion: string(source.modelVersion, `${persistedMarket} modelVersion`),
    distributionBuilderVersion: string(source.distributionBuilderVersion, `${persistedMarket} distributionBuilderVersion`),
    rows: Object.freeze(rows),
  });
}

function normalizeGradeRow(raw, index) {
  const row = object(raw, `grade rows[${index}]`);
  if (!['win', 'loss', 'void'].includes(row.outcome)) {
    throw new Error(`grade rows[${index}].outcome is unsupported.`);
  }
  return Object.freeze({
    providerEventId: string(row.providerEventId, `grade rows[${index}].providerEventId`),
    providerGameId: integer(row.providerGameId, `grade rows[${index}].providerGameId`),
    providerPlayerId: integer(row.providerPlayerId, `grade rows[${index}].providerPlayerId`),
    providerMarketKey: string(row.providerMarketKey, `grade rows[${index}].providerMarketKey`),
    boardSource: row.boardSource ?? null,
    providerBookmakerKey: row.providerBookmakerKey ?? row.bookmaker ?? row.boardSource ?? null,
    selectedSide: string(row.selectedSide, `grade rows[${index}].selectedSide`),
    postedLine: finite(row.postedLine, `grade rows[${index}].postedLine`),
    outcome: row.outcome,
  });
}

export function normalizeCategoryPerformanceGradeReport(raw, reportFileSha256 = null) {
  const report = object(raw, 'grade report');
  const source = object(report.source, 'grade report source');
  const safety = object(report.safety, 'grade report safety');
  if (
    safety.productionEnabled !== false ||
    safety.rankingEnabled !== false ||
    safety.archiveModified !== false ||
    safety.evidenceOnly !== true ||
    safety.finalOnly !== true
  ) {
    throw new Error('Category performance requires final immutable evidence-only grade reports.');
  }
  return Object.freeze({
    captureKey: string(source.captureKey, 'grade report source.captureKey'),
    gradedAt: timestamp(report.gradedAt, 'grade report gradedAt'),
    archiveSha256: nullableString(source.archiveSha256, 'grade report source.archiveSha256'),
    archiveFileSha256: nullableString(source.archiveFileSha256, 'grade report source.archiveFileSha256'),
    reportFileSha256,
    rows: Object.freeze(array(report.rows, 'grade report rows').map(normalizeGradeRow)),
  });
}

function exactGradeIdentity(row) {
  return stableJson([
    row.providerEventId,
    row.providerGameId,
    row.providerPlayerId,
    row.boardSource ?? null,
    row.providerBookmakerKey ?? null,
    row.providerMarketKey,
    row.selectedSide,
    row.postedLine,
  ]);
}

function gradeRowsForDisplayRow(gradeReport, displayRow) {
  return gradeReport.rows.filter((row) =>
    row.providerEventId === displayRow.providerEventId &&
    row.providerGameId === displayRow.providerGameId &&
    row.providerPlayerId === displayRow.providerPlayerId &&
    row.providerMarketKey === displayRow.providerMarketKey &&
    row.selectedSide === displayRow.selectedSide &&
    row.postedLine === displayRow.postedLine &&
    (row.boardSource === null || row.boardSource === displayRow.boardSource) &&
    (row.providerBookmakerKey === null || row.providerBookmakerKey === displayRow.providerBookmakerKey),
  );
}

function productMarketMatches(row, pick) {
  return (
    (row.market === RESEARCH_BATTER_HITS_MARKET && pick.market === 'Hits') ||
    (row.market === RESEARCH_BATTER_HHR_MARKET && pick.market === 'Hits + Runs + RBIs')
  );
}

function sourceRowsForPick(archives, pick) {
  return archives.flatMap((archive) => archive.rows).filter((row) =>
    productMarketMatches(row, pick) &&
    String(row.providerPlayerId) === pick.playerId &&
    row.eventCommenceTime === pick.gameTime &&
    row.boardSource === pick.boardSource &&
    row.providerBookmakerKey === pick.providerBookmakerKey &&
    row.selectedSide === pick.selectedSide &&
    row.postedLine === pick.postedLine,
  );
}

function categoryPickIdentity(categoryId, row) {
  return stableJson([
    categoryId,
    row.boardSource,
    row.market,
    row.providerEventId,
    row.providerGameId,
    row.providerPlayerId,
    row.selectedSide,
    row.postedLine,
  ]);
}

function summarize(records) {
  const wins = records.filter((record) => record.outcome === 'win').length;
  const losses = records.filter((record) => record.outcome === 'loss').length;
  const voids = records.filter((record) => record.outcome === 'void').length;
  const decidedPicks = wins + losses;
  return Object.freeze({
    gradedPicks: records.length,
    wins,
    losses,
    voids,
    decidedPicks,
    winRate: decidedPicks === 0 ? null : wins / decidedPicks,
  });
}

export function buildProductCategoryPerformanceReportV1({ pairedCaptures }) {
  const categoryIds = Object.keys(PRODUCT_CATEGORY_TITLES);
  const retainedByCategory = new Map(categoryIds.map((categoryId) => [categoryId, new Map()]));
  const usedSources = [];
  const contributedCaptureTimes = [];
  let generatedAt = null;

  const orderedPairs = [...array(pairedCaptures, 'pairedCaptures')].sort((left, right) =>
    String(left.capturedAt).localeCompare(String(right.capturedAt)),
  );

  for (const rawPair of orderedPairs) {
    const pair = object(rawPair, 'paired capture');
    const capturedAt = timestamp(pair.capturedAt, 'paired capture capturedAt');
    const hitsArchive = normalizeCategoryPerformanceDisplayArchive('batter-hits', pair.hitsDisplayArchive);
    const hhrArchive = normalizeCategoryPerformanceDisplayArchive('batter-hhr', pair.hhrDisplayArchive);
    if (hitsArchive.capturedAt !== capturedAt || hhrArchive.capturedAt !== capturedAt) {
      throw new Error('Paired display archives must share the exact capture timestamp.');
    }
    const hitsGrade = pair.hitsGradeReport === null || pair.hitsGradeReport === undefined
      ? null
      : normalizeCategoryPerformanceGradeReport(pair.hitsGradeReport.value ?? pair.hitsGradeReport, pair.hitsGradeReport.fileSha256 ?? null);
    const hhrGrade = pair.hhrGradeReport === null || pair.hhrGradeReport === undefined
      ? null
      : normalizeCategoryPerformanceGradeReport(pair.hhrGradeReport.value ?? pair.hhrGradeReport, pair.hhrGradeReport.fileSha256 ?? null);
    if (hitsGrade !== null && hitsGrade.captureKey !== hitsArchive.captureKey) {
      throw new Error('Hits grade report capture identity does not match the paired display archive.');
    }
    if (hhrGrade !== null && hhrGrade.captureKey !== hhrArchive.captureKey) {
      throw new Error('HHR grade report capture identity does not match the paired display archive.');
    }
    const gradeByMarket = new Map([
      [RESEARCH_BATTER_HITS_MARKET, hitsGrade],
      [RESEARCH_BATTER_HHR_MARKET, hhrGrade],
    ]);
    const archives = Object.freeze([hitsArchive, hhrArchive]);
    const board = buildResearchProductBoardV2(archives, Date.parse(capturedAt));
    let captureContributed = false;

    for (const category of board.categories) {
      const retained = retainedByCategory.get(category.categoryId);
      if (retained === undefined) throw new Error(`Unknown product category ${category.categoryId}.`);
      for (const pick of category.picks) {
        const displayRows = sourceRowsForPick(archives, pick);
        if (displayRows.length === 0) {
          throw new Error(`Category pick ${pick.player} could not be traced to its archived source row.`);
        }
        const gradedMatches = displayRows.flatMap((displayRow) => {
          const report = gradeByMarket.get(displayRow.market);
          if (report === null || report === undefined) return [];
          return gradeRowsForDisplayRow(report, displayRow).map((gradeRow) => ({ displayRow, gradeRow, report }));
        });
        if (gradedMatches.length === 0) continue;
        const outcomes = new Set(gradedMatches.map((match) => match.gradeRow.outcome));
        if (outcomes.size !== 1) {
          throw new Error(`Category pick ${pick.player} has conflicting immutable grade outcomes.`);
        }
        const identities = new Set(gradedMatches.map((match) => categoryPickIdentity(category.categoryId, match.displayRow)));
        if (identities.size !== 1) {
          throw new Error(`Category pick ${pick.player} maps to ambiguous product identities.`);
        }
        const selected = gradedMatches
          .slice()
          .sort((left, right) => exactGradeIdentity(left.gradeRow).localeCompare(exactGradeIdentity(right.gradeRow)))[0];
        const identity = [...identities][0];
        retained.set(identity, Object.freeze({
          identity,
          capturedAt,
          outcome: selected.gradeRow.outcome,
          categoryId: category.categoryId,
        }));
        captureContributed = true;
        generatedAt = generatedAt === null || selected.report.gradedAt > generatedAt
          ? selected.report.gradedAt
          : generatedAt;
      }
    }

    if (captureContributed) {
      contributedCaptureTimes.push(capturedAt);
      usedSources.push(Object.freeze({
        capturedAt,
        hitsCaptureKey: hitsArchive.captureKey,
        hhrCaptureKey: hhrArchive.captureKey,
        hitsGrade: hitsGrade === null ? null : Object.freeze({
          captureKey: hitsGrade.captureKey,
          archiveSha256: hitsGrade.archiveSha256,
          archiveFileSha256: hitsGrade.archiveFileSha256,
          reportFileSha256: hitsGrade.reportFileSha256,
        }),
        hhrGrade: hhrGrade === null ? null : Object.freeze({
          captureKey: hhrGrade.captureKey,
          archiveSha256: hhrGrade.archiveSha256,
          archiveFileSha256: hhrGrade.archiveFileSha256,
          reportFileSha256: hhrGrade.reportFileSha256,
        }),
      }));
    }
  }

  if (generatedAt === null) return null;
  const categories = {};
  for (const categoryId of categoryIds) {
    categories[categoryId] = summarize([...retainedByCategory.get(categoryId).values()]);
  }
  const sourceSetSha256 = sha256(stableJson({
    reportVersion: CATEGORY_PERFORMANCE_REPORT_VERSION,
    productDisplayBoardVersion: PRODUCT_DISPLAY_BOARD_VERSION,
    sources: usedSources,
  }));
  const sortedCaptureTimes = [...new Set(contributedCaptureTimes)].sort();
  return Object.freeze({
    reportVersion: CATEGORY_PERFORMANCE_REPORT_VERSION,
    reportType: CATEGORY_PERFORMANCE_REPORT_TYPE,
    generatedAt,
    productDisplayBoardVersion: PRODUCT_DISPLAY_BOARD_VERSION,
    sourceSetSha256,
    pairedCapturesIncluded: sortedCaptureTimes.length,
    firstCaptureAt: sortedCaptureTimes[0] ?? null,
    lastCaptureAt: sortedCaptureTimes.at(-1) ?? null,
    categories: Object.freeze(categories),
    safety: Object.freeze({
      evidenceOnly: true,
      archivesModified: false,
      probabilitiesModified: false,
      rankingModified: false,
    }),
  });
}
