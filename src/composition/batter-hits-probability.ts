import {
  loadFrozenBatterHitsProbabilityArtifactsFromFiles,
  type BatterHitsProbabilityArtifactPaths,
} from '../adapters/index.js';
import {
  createFrozenBatterHitsProbabilityCandidate,
  type BatterHitsRuntimeObservation,
  type FrozenBatterHitsProbabilityResult,
  type NormalizedBatterHitsBoardOffer,
} from '../features/batter-hits/index.js';
import type { PregameNormalizedBatterHitsBoard } from './batter-hits-board.js';

export interface ConnectFrozenBatterHitsProbabilityInput {
  readonly pregameBoard: PregameNormalizedBatterHitsBoard;
  readonly offer: NormalizedBatterHitsBoardOffer;
  readonly observation: BatterHitsRuntimeObservation;
  readonly artifactPaths?: BatterHitsProbabilityArtifactPaths;
}

function assertOfferSurvivedPregameGate(
  board: PregameNormalizedBatterHitsBoard,
  offer: NormalizedBatterHitsBoardOffer,
): void {
  if (!board.offers.includes(offer)) {
    throw new Error(
      'Batter Hits probability output requires the exact immutable offer object that survived the pregame gate.',
    );
  }
  if (
    board.excludedOffers.some((excluded) => excluded.offer === offer)
  ) {
    throw new Error('An excluded Batter Hits offer cannot produce probabilities.');
  }
}

/**
 * Connects one active projected-or-confirmed pregame lineup to the already-
 * frozen M8 model. Lineup status is source metadata only and cannot alter the
 * distribution or probabilities. This does not authorize ranking or enable the
 * feature in production registries.
 */
export async function connectFrozenBatterHitsProbabilityOutput(
  input: ConnectFrozenBatterHitsProbabilityInput,
): Promise<FrozenBatterHitsProbabilityResult> {
  assertOfferSurvivedPregameGate(input.pregameBoard, input.offer);
  const artifacts = await loadFrozenBatterHitsProbabilityArtifactsFromFiles(
    input.artifactPaths,
  );
  return createFrozenBatterHitsProbabilityCandidate(
    input.offer,
    input.observation,
    artifacts,
  );
}
