import {
  HIGH_PROBABILITY_ALTLINE_CATEGORY_ID,
  HIGH_PROBABILITY_BASELINE_CATEGORY_ID,
  OPPORTUNITY_MINER_CATEGORY_ID,
  indicativeImpliedProbabilityFromAmericanPrice,
  selectCategoryOutputV1,
  selectHighProbabilityAltlinePropsV1,
  selectHighProbabilityBaselinePropsV1,
  selectOpportunityMinerFavoritesV1,
} from '../dist/src/categories/index.js';

export const LEGACY_CATEGORY_PERFORMANCE_BOARD_VERSION =
  'm10-category-performance-legacy-underdog-v1';

const LEGACY_BASELINE_MARKET_KEY_BY_MARKET = Object.freeze({
  'batter-hits': 'batter_hits',
  'batter-hits-runs-rbis': 'batter_hits_runs_rbis',
});

function stableIdentity(values) {
  return JSON.stringify(values);
}

function exactOfferIdentity(row) {
  return stableIdentity([
    row.market,
    row.captureKey,
    row.providerEventId,
    row.providerGameId,
    row.providerPlayerId,
  ]);
}

function baselineProviderMarketKey(row) {
  const value = LEGACY_BASELINE_MARKET_KEY_BY_MARKET[row.market];
  if (value === undefined) {
    throw new Error(`Unsupported legacy category-performance market ${row.market}.`);
  }
  return value;
}

function verifiedLegacyBaselineLines(rows) {
  const lineSets = new Map();
  for (const row of rows) {
    if (row.providerMarketKey !== baselineProviderMarketKey(row)) continue;
    const identity = exactOfferIdentity(row);
    const lines = lineSets.get(identity) ?? new Set();
    lines.add(row.postedLine);
    lineSets.set(identity, lines);
  }

  const verified = new Map();
  for (const [identity, lines] of lineSets) {
    if (lines.size !== 1) continue;
    const baselineLine = [...lines][0];
    if (baselineLine !== undefined) verified.set(identity, baselineLine);
  }
  return verified;
}

function legacyCandidate(row) {
  return Object.freeze({
    playerId: String(row.providerPlayerId),
    line: row.postedLine,
    selectedSide: row.selectedSide,
    pVoid: row.pVoid,
    pWinGivenGrades: row.pWinGivenGrades,
    sourceRow: row,
  });
}

function verifiedLegacyOfferInputs(rows, candidateByRow) {
  const baselineLines = verifiedLegacyBaselineLines(rows);
  return Object.freeze(
    rows.flatMap((row) => {
      const baselineLine = baselineLines.get(exactOfferIdentity(row));
      const candidate = candidateByRow.get(row);
      if (baselineLine === undefined || candidate === undefined) return [];
      const postedImpliedProbability =
        row.americanPrice !== null &&
        Number.isInteger(row.americanPrice) &&
        row.americanPrice !== 0
          ? indicativeImpliedProbabilityFromAmericanPrice(row.americanPrice)
          : null;
      return [
        Object.freeze({
          candidate,
          offerType: row.postedLine === baselineLine ? 'baseline' : 'alternate',
          americanPrice: row.americanPrice,
          multiplier: row.multiplier,
          postedImpliedProbability,
          priceEdge:
            postedImpliedProbability === null
              ? null
              : row.pWinGivenGrades - postedImpliedProbability,
        }),
      ];
    }),
  );
}

function historicalPick(candidate) {
  const row = candidate.sourceRow;
  return Object.freeze({
    player: row.playerName,
    playerId: String(row.providerPlayerId),
    gameTime: row.eventCommenceTime,
    market: row.market === 'batter-hits' ? 'Hits' : 'Hits + Runs + RBIs',
    boardSource: null,
    providerBookmakerKey: 'underdog',
    selectedSide: row.selectedSide,
    postedLine: row.postedLine,
  });
}

function category(categoryId, candidates) {
  return Object.freeze({
    categoryId,
    picks: Object.freeze(candidates.map(historicalPick)),
  });
}

/**
 * Reconstructs only source-null legacy Underdog-era category membership for
 * immutable category-performance grading. This is the exact category-selection
 * shape used by the repository before the Pick6/DraftKings source switch:
 * same-capture provider baseline lines establish baseline versus alternate,
 * Opportunity Miner uses archived price/multiplier evidence, and the universal
 * category output gate applies P(Win | grades) > 0.50 with the normal cap.
 *
 * This helper is historical evidence compatibility only. It does not authorize
 * Underdog for current research ranking or production output.
 */
export function buildLegacyCategoryPerformanceBoardV1(rows) {
  if (!Array.isArray(rows)) throw new TypeError('legacy category rows must be an array.');
  for (const [index, row] of rows.entries()) {
    if (row?.boardSource !== null) {
      throw new Error(`legacy category row ${index} must have null boardSource.`);
    }
  }

  const candidateByRow = new Map(
    rows.map((row) => [row, legacyCandidate(row)]),
  );
  const offerInputs = verifiedLegacyOfferInputs(rows, candidateByRow);
  const baseline = selectHighProbabilityBaselinePropsV1(offerInputs);
  const altline = selectHighProbabilityAltlinePropsV1(offerInputs);
  const minerInputs = rows.flatMap((row) => {
    if (
      row.americanPrice === null ||
      !Number.isInteger(row.americanPrice) ||
      row.americanPrice === 0 ||
      row.multiplier === null ||
      row.multiplier <= 0
    ) {
      return [];
    }
    return [
      Object.freeze({
        candidate: candidateByRow.get(row),
        americanPrice: row.americanPrice,
        multiplier: row.multiplier,
      }),
    ];
  });
  const opportunity = selectOpportunityMinerFavoritesV1(minerInputs);

  const opportunityPicks = selectCategoryOutputV1(
    opportunity.eligibleCandidates,
  );
  const baselinePicks = selectCategoryOutputV1(
    baseline.eligibleCandidates.map((input) => input.candidate),
  );
  const altlinePicks = selectCategoryOutputV1(
    altline.eligibleCandidates.map((input) => input.candidate),
  );

  return Object.freeze({
    boardVersion: LEGACY_CATEGORY_PERFORMANCE_BOARD_VERSION,
    categories: Object.freeze([
      category(OPPORTUNITY_MINER_CATEGORY_ID, opportunityPicks),
      category(HIGH_PROBABILITY_BASELINE_CATEGORY_ID, baselinePicks),
      category(HIGH_PROBABILITY_ALTLINE_CATEGORY_ID, altlinePicks),
    ]),
  });
}
