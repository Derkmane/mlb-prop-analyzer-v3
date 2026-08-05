import { compareSettlementResultsForRanking } from '../core/index.js';
import type { EligibilityProbability, Probability } from '../domain/probability.js';
import type { SelectedSide } from '../domain/selected-side.js';
import type { SettlementResult } from '../domain/settlement.js';

/** Minimum immutable fields a category is permitted to inspect for ranking. */
export interface CategoryRankableCandidate {
  readonly playerId: string;
  readonly eligibilityProbability: EligibilityProbability;
  readonly line: number;
  readonly selectedSide: SelectedSide;
  readonly pWin: Probability;
  readonly pLoss: Probability;
  readonly pVoid: Probability;
  readonly pWinGivenGrades: Probability | null;
}

function settlementView(
  candidate: CategoryRankableCandidate,
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
  left: CategoryRankableCandidate,
  right: CategoryRankableCandidate,
): number {
  return compareSettlementResultsForRanking(
    settlementView(left),
    settlementView(right),
  );
}

/** Deduplicates to one prop per player and applies the canonical ordering. */
export function deduplicateAndSortPredictionCandidatesForCategory<
  TCandidate extends CategoryRankableCandidate,
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
