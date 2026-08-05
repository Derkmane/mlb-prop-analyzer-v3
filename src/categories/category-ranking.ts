import { compareSettlementResultsForRanking } from '../core/index.js';
import type { PredictionCandidate } from '../domain/prediction-candidate.js';
import type { SettlementResult } from '../domain/settlement.js';

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

/**
 * The only categories-layer adapter to the canonical core comparator.
 * Categories may filter, deduplicate, sort, and select, but they may not
 * introduce a second ranking rule or alter candidate probabilities.
 */
export function comparePredictionCandidatesForCategory(
  left: PredictionCandidate<unknown>,
  right: PredictionCandidate<unknown>,
): number {
  return compareSettlementResultsForRanking(
    settlementView(left),
    settlementView(right),
  );
}

/** Deduplicates to one prop per player and applies the canonical ordering. */
export function deduplicateAndSortPredictionCandidatesForCategory<
  TCandidate extends PredictionCandidate<unknown>,
>(candidates: readonly TCandidate[]): readonly TCandidate[] {
  const bestByPlayer = new Map<string, TCandidate>();
  for (const candidate of candidates) {
    const incumbent = bestByPlayer.get(candidate.playerId);
    if (
      incumbent === undefined ||
      comparePredictionCandidatesForCategory(candidate, incumbent) < 0
    ) {
      bestByPlayer.set(candidate.playerId, candidate);
    }
  }

  return Object.freeze(
    [...bestByPlayer.values()].sort(comparePredictionCandidatesForCategory),
  );
}
