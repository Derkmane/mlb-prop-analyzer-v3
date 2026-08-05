/** Public boundary for the categories layer. */
export {
  comparePredictionCandidatesForCategory,
  deduplicateAndSortPredictionCandidatesForCategory,
} from './category-ranking.js';
export {
  HIGH_PROBABILITY_ALTLINE_CATEGORY_ID,
  selectHighProbabilityAltlinePropsV1,
  type HighProbabilityAltlineSelectionV1,
} from './high-probability-altline.js';
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
export { selectTopFiveV1, TOP_FIVE_LIMIT } from './top-five.js';
