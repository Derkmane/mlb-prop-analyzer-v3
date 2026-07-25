import type { SavedPredictionSnapshot } from '../../domain/saved-prediction.js';
import {
  renderHistoricalPrediction,
  type HistoricalPredictionView,
} from '../../historical/index.js';
import type {
  SyntheticBatterHitsCandidate,
  SyntheticBatterHitsDistribution,
  SyntheticBatterHitsSavedPredictionInput,
} from './contracts.js';
import { SYNTHETIC_BATTER_HITS_SOURCE_KIND } from './contracts.js';
import { createSyntheticBatterHitsSavedPrediction } from './predict.js';

export interface SyntheticBatterHitsJsonOutput {
  readonly sourceKind: typeof SYNTHETIC_BATTER_HITS_SOURCE_KIND;
  readonly distribution: SyntheticBatterHitsDistribution;
  readonly candidate: SyntheticBatterHitsCandidate;
  readonly savedPrediction: SavedPredictionSnapshot;
  readonly historicalView: HistoricalPredictionView;
}

/** Deterministic, test-only JSON-facing entrypoint. It is not a production route. */
export function runSyntheticBatterHitsJsonEntrypoint(
  input: SyntheticBatterHitsSavedPredictionInput,
): SyntheticBatterHitsJsonOutput {
  const result = createSyntheticBatterHitsSavedPrediction(input);
  const historicalView = renderHistoricalPrediction(result.savedPrediction);

  return Object.freeze({
    sourceKind: SYNTHETIC_BATTER_HITS_SOURCE_KIND,
    distribution: result.distribution,
    candidate: result.candidate,
    savedPrediction: result.savedPrediction,
    historicalView,
  });
}

export function serializeSyntheticBatterHitsJson(
  input: SyntheticBatterHitsSavedPredictionInput,
): string {
  return JSON.stringify(runSyntheticBatterHitsJsonEntrypoint(input));
}
