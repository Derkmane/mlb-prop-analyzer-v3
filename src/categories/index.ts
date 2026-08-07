/** Public boundary for the categories layer. */
export {
  comparePredictionCandidatesForCategory,
  deduplicateAndSortPredictionCandidatesForCategory,
  type CategoryRankableCandidate,
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
  HHR_05_HIGHER_ALT_CATEGORY_ID,
  HHR_05_HIGHER_ALT_CATEGORY_TITLE,
  HHR_25_LOWER_ALT_CATEGORY_ID,
  HHR_25_LOWER_ALT_CATEGORY_TITLE,
  HHR_ALTLINE_CATEGORY_LIMIT,
  selectHhr05HigherAltV1,
  selectHhr25LowerAltV1,
  type HhrAltlineCategoryExclusionCounts,
  type HhrAltlineCategoryExclusionReason,
  type HhrAltlineCategoryId,
  type HhrAltlineCategoryOfferInput,
  type HhrAltlineCategorySelectionV1,
} from './hhr-altline-categories.js';
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
