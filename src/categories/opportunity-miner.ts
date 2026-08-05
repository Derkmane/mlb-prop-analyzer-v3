import { validateProbability } from '../core/index.js';
import type { PredictionCandidate } from '../domain/prediction-candidate.js';
import { deduplicateAndSortPredictionCandidatesForCategory } from './category-ranking.js';

export const OPPORTUNITY_MINER_CATEGORY_ID =
  'opportunity-miner-favorites' as const;

export const OPPORTUNITY_MINER_PRICE_EDGE_RULE_V1 = Object.freeze({
  version: 'opportunity-miner-positive-american-price-edge-v1',
  diagnosticVersion: 'indicative-american-price-implied-probability-v1',
  priceSource: 'americanPrice',
  priceEdgeThresholdExclusive: 0,
  multiplierTreatment: 'preserve-only-no-conversion',
} as const);

export interface OpportunityMinerCandidateInput<
  TCandidate extends PredictionCandidate<unknown>,
> {
  readonly candidate: TCandidate;
  readonly americanPrice: number;
  readonly multiplier: number;
}

export interface OpportunityMinerPriceDiagnosticV1 {
  readonly label: 'DIAGNOSTIC ONLY';
  readonly version: typeof OPPORTUNITY_MINER_PRICE_EDGE_RULE_V1.diagnosticVersion;
  readonly eligibilityRuleVersion: typeof OPPORTUNITY_MINER_PRICE_EDGE_RULE_V1.version;
  readonly americanPrice: number;
  readonly multiplier: number;
  readonly postedImpliedProbability: number;
  readonly priceEdge: number;
}

export type OpportunityMinerCandidateV1<
  TCandidate extends PredictionCandidate<unknown>,
> = TCandidate & {
  readonly opportunityMiner: OpportunityMinerPriceDiagnosticV1;
};

export interface OpportunityMinerSelectionV1<
  TCandidate extends PredictionCandidate<unknown>,
> {
  readonly categoryId: typeof OPPORTUNITY_MINER_CATEGORY_ID;
  readonly eligibilityRuleVersion: typeof OPPORTUNITY_MINER_PRICE_EDGE_RULE_V1.version;
  readonly eligibleCandidates: readonly OpportunityMinerCandidateV1<TCandidate>[];
  readonly ineligibleCandidates: readonly OpportunityMinerCandidateV1<TCandidate>[];
}

function validateAmericanPrice(americanPrice: number): number {
  if (!Number.isInteger(americanPrice) || americanPrice === 0) {
    throw new RangeError('americanPrice must be a nonzero integer.');
  }
  return americanPrice;
}

function validateMultiplier(multiplier: number): number {
  if (!Number.isFinite(multiplier) || multiplier <= 0) {
    throw new RangeError('multiplier must be a positive finite number.');
  }
  return multiplier;
}

/**
 * Converts the observed American price into an indicative implied probability.
 * The separately observed multiplier is never read by this calculation.
 */
export function indicativeImpliedProbabilityFromAmericanPrice(
  rawAmericanPrice: number,
): number {
  const americanPrice = validateAmericanPrice(rawAmericanPrice);
  const impliedProbability =
    americanPrice < 0
      ? Math.abs(americanPrice) / (Math.abs(americanPrice) + 100)
      : 100 / (americanPrice + 100);
  return validateProbability(
    impliedProbability,
    'indicative American-price implied probability',
  );
}

/**
 * Adds versioned diagnostic price evidence without changing any candidate
 * probability, distribution, selected side, line, or model lineage.
 */
export function createOpportunityMinerCandidateV1<
  TCandidate extends PredictionCandidate<unknown>,
>(
  input: Readonly<OpportunityMinerCandidateInput<TCandidate>>,
): OpportunityMinerCandidateV1<TCandidate> {
  if (input.candidate.pWinGivenGrades === null) {
    throw new RangeError(
      'Opportunity Miner requires final P(Win | grades) to be available.',
    );
  }
  const pFinal = validateProbability(
    input.candidate.pWinGivenGrades,
    'Opportunity Miner final P(Win | grades)',
  );
  const americanPrice = validateAmericanPrice(input.americanPrice);
  const multiplier = validateMultiplier(input.multiplier);
  const postedImpliedProbability =
    indicativeImpliedProbabilityFromAmericanPrice(americanPrice);
  const diagnostic = Object.freeze({
    label: 'DIAGNOSTIC ONLY' as const,
    version: OPPORTUNITY_MINER_PRICE_EDGE_RULE_V1.diagnosticVersion,
    eligibilityRuleVersion: OPPORTUNITY_MINER_PRICE_EDGE_RULE_V1.version,
    americanPrice,
    multiplier,
    postedImpliedProbability,
    priceEdge: pFinal - postedImpliedProbability,
  });

  return Object.freeze({
    ...input.candidate,
    opportunityMiner: diagnostic,
  });
}

/**
 * Applies only the versioned positive-price-edge eligibility gate, deduplicates
 * to one prop per player using the canonical comparator, and orders the final
 * category only by final P(Win | grades), then P(Void). Price edge and
 * multiplier are never ranking or tiebreak quantities.
 */
export function selectOpportunityMinerFavoritesV1<
  TCandidate extends PredictionCandidate<unknown>,
>(
  inputs: readonly Readonly<OpportunityMinerCandidateInput<TCandidate>>[],
): OpportunityMinerSelectionV1<TCandidate> {
  const enriched = inputs.map((input) =>
    createOpportunityMinerCandidateV1(input),
  );
  const eligible = enriched.filter(
    (candidate) =>
      candidate.opportunityMiner.priceEdge >
      OPPORTUNITY_MINER_PRICE_EDGE_RULE_V1.priceEdgeThresholdExclusive,
  );
  const ineligible = enriched.filter(
    (candidate) =>
      candidate.opportunityMiner.priceEdge <=
      OPPORTUNITY_MINER_PRICE_EDGE_RULE_V1.priceEdgeThresholdExclusive,
  );

  const eligibleCandidates =
    deduplicateAndSortPredictionCandidatesForCategory(eligible);

  return Object.freeze({
    categoryId: OPPORTUNITY_MINER_CATEGORY_ID,
    eligibilityRuleVersion: OPPORTUNITY_MINER_PRICE_EDGE_RULE_V1.version,
    eligibleCandidates,
    ineligibleCandidates: Object.freeze(ineligible),
  });
}
