import { compareSettlementResultsForRanking } from '../core/index.js';
import type { PredictionCandidate } from '../domain/prediction-candidate.js';
import type { SettlementResult } from '../domain/settlement.js';
import {
  FeatureUnavailableError,
  type FeatureUnavailableCode,
} from './feature-gate.js';
import {
  authorizeMarketForPrediction,
  MarketRegistryUnavailableError,
  type MarketRegistryUnavailableCode,
  type ProductionMarketAuthorization,
  type ProductionRegistrySnapshot,
} from './market-registry-gate.js';

export const CANDIDATE_RANKING_EXCLUSION_REASONS = [
  'WIN_PROBABILITY_GIVEN_GRADES_UNAVAILABLE',
  'MARKET_NOT_AUTHORIZED',
  'DISTRIBUTION_BUILDER_VERSION_MISMATCH',
  'SETTLEMENT_RULE_VERSION_MISMATCH',
] as const;

export type CandidateRankingExclusionReason =
  (typeof CANDIDATE_RANKING_EXCLUSION_REASONS)[number];

export type CandidateRankingAuthorizationCode =
  | MarketRegistryUnavailableCode
  | FeatureUnavailableCode;

export interface ExcludedPredictionCandidate<TCandidate> {
  readonly candidate: TCandidate;
  readonly reason: CandidateRankingExclusionReason;
  readonly authorizationCode?: CandidateRankingAuthorizationCode;
}

export interface RankPredictionCandidatesInput<TCandidate> {
  readonly candidates: readonly TCandidate[];
  readonly registries: ProductionRegistrySnapshot;
}

export interface RankedPredictionCandidates<TCandidate> {
  readonly rankedCandidates: readonly TCandidate[];
  readonly excludedCandidates: readonly ExcludedPredictionCandidate<TCandidate>[];
}

function settlementView(
  candidate: PredictionCandidate<unknown>,
): SettlementResult {
  return Object.freeze({
    eligibilityProbability: candidate.eligibilityProbability,
    line: candidate.line,
    selectedSide: candidate.selectedSide,
    winProbability: candidate.pWin,
    lossProbability: candidate.pLoss,
    voidProbability: candidate.pVoid,
    winProbabilityGivenGrades: candidate.pWinGivenGrades,
  });
}

function exclude<TCandidate>(
  candidate: TCandidate,
  reason: CandidateRankingExclusionReason,
  authorizationCode?: CandidateRankingAuthorizationCode,
): ExcludedPredictionCandidate<TCandidate> {
  return Object.freeze({
    candidate,
    reason,
    ...(authorizationCode === undefined ? {} : { authorizationCode }),
  });
}

/**
 * Filters candidates that cannot lawfully rank, then delegates ordering to the
 * single core SettlementResult comparator. Candidate diagnostics and offer
 * economics are intentionally never read by this path.
 */
export function rankPredictionCandidates<
  TCandidate extends PredictionCandidate<unknown>,
>(
  input: Readonly<RankPredictionCandidatesInput<TCandidate>>,
): RankedPredictionCandidates<TCandidate> {
  const rankable: TCandidate[] = [];
  const excluded: ExcludedPredictionCandidate<TCandidate>[] = [];

  for (const candidate of input.candidates) {
    if (candidate.pWinGivenGrades === null) {
      excluded.push(
        exclude(candidate, 'WIN_PROBABILITY_GIVEN_GRADES_UNAVAILABLE'),
      );
      continue;
    }

    let authorization: ProductionMarketAuthorization;
    try {
      authorization = authorizeMarketForPrediction(
        input.registries,
        candidate.baseMarketKey,
      );
    } catch (error) {
      if (
        !(
          error instanceof MarketRegistryUnavailableError ||
          error instanceof FeatureUnavailableError
        )
      ) {
        throw error;
      }
      excluded.push(
        exclude(candidate, 'MARKET_NOT_AUTHORIZED', error.code),
      );
      continue;
    }

    if (
      candidate.distributionBuilderVersion !==
      authorization.distributionBuilderVersion
    ) {
      excluded.push(
        exclude(candidate, 'DISTRIBUTION_BUILDER_VERSION_MISMATCH'),
      );
      continue;
    }

    if (candidate.settlementRuleVersion !== authorization.settlementRuleVersion) {
      excluded.push(
        exclude(candidate, 'SETTLEMENT_RULE_VERSION_MISMATCH'),
      );
      continue;
    }

    rankable.push(candidate);
  }

  const rankedCandidates = [...rankable].sort((left, right) =>
    compareSettlementResultsForRanking(
      settlementView(left),
      settlementView(right),
    ),
  );

  return Object.freeze({
    rankedCandidates: Object.freeze(rankedCandidates),
    excludedCandidates: Object.freeze(excluded),
  });
}
