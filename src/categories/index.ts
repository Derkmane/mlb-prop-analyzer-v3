/** Public boundary for the categories layer. */
export {
  comparePredictionCandidatesForCategory,
  deduplicateAndSortPredictionCandidatesForCategory,
} from './category-ranking.js';
export {
  HIGH_PROBABILITY_BASELINE_CATEGORY_ID,
  selectHighProbabilityBaselinePropsV1,
  type HighProbabilityBaselineSelectionV1,
} from './high-probability-baseline.js';
export {
  createOpportunityMinerCandidateV1,
  indicativeImpliedProbabilityFromAmericanPrice,
  OPPORTUNITY_MINER_CATEGORY_ID,
  OPPORTUNITY_MINER_PRICE_EDGE_RULE_V1,
  selectOpportunityMinerFavoritesV1,
  type OpportunityMinerCandidateInput,
  type OpportunityMinerCandidateV1,
  type OpportunityMinerPriceDiagnosticV1,
  type OpportunityMinerSelectionV1,
} from './opportunity-miner.js';
export {
  selectOfferTypeCategoryV1,
  type CategoryOfferInput,
  type CategoryOfferType,
  type OfferTypeCategorySelectionV1,
} from './offer-type-category.js';
