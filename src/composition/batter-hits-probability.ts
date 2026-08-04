import {
  loadFrozenBatterHitsProbabilityArtifactsFromFiles,
  type BatterHitsProbabilityArtifactPaths,
} from '../adapters/index.js';
import {
  createFrozenBatterHitsProbabilityCandidate,
  createM8BatterHitsBaseDistribution,
  settleM8BatterHitsBaseOffer,
  type BatterHitsRuntimeObservation,
  type FrozenBatterHitsProbabilityResult,
  type M8BatterHitsBaseDistributionV1,
  type M8BatterHitsBaseEvaluationV1,
  type NormalizedBatterHitsBoardOffer,
} from '../features/batter-hits/index.js';
import type { PregameNormalizedBatterHitsBoard } from './batter-hits-board.js';

export interface ConnectFrozenBatterHitsProbabilityInput {
  readonly pregameBoard: PregameNormalizedBatterHitsBoard;
  readonly offer: NormalizedBatterHitsBoardOffer;
  readonly observation: BatterHitsRuntimeObservation;
  readonly artifactPaths?: BatterHitsProbabilityArtifactPaths;
}

export interface ConnectM8BatterHitsBaseDistributionInput
  extends ConnectFrozenBatterHitsProbabilityInput {
  readonly evaluatedAt: string;
}

export interface ConnectM8BatterHitsBaseEvaluationFromDistributionInput {
  readonly pregameBoard: PregameNormalizedBatterHitsBoard;
  readonly offer: NormalizedBatterHitsBoardOffer;
  readonly baseDistribution: M8BatterHitsBaseDistributionV1;
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

function observationWithProviderVenue(
  board: PregameNormalizedBatterHitsBoard,
  offer: NormalizedBatterHitsBoardOffer,
  observation: BatterHitsRuntimeObservation,
): BatterHitsRuntimeObservation {
  const venue = board.providerVenueByGameId[String(offer.providerGameId)];
  if (venue === undefined) return observation;
  return Object.freeze({
    ...observation,
    venue,
  });
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
    observationWithProviderVenue(
      input.pregameBoard,
      input.offer,
      input.observation,
    ),
    artifacts,
  );
}

/**
 * Builds the immutable side-independent frozen M8 `D_base` exactly once for
 * one player/game/base-market/baseball-input identity. Exact baseline and
 * alternate offers may then settle this same object without rebuilding it.
 */
export async function connectM8BatterHitsBaseDistribution(
  input: ConnectM8BatterHitsBaseDistributionInput,
): Promise<M8BatterHitsBaseDistributionV1> {
  assertOfferSurvivedPregameGate(input.pregameBoard, input.offer);
  const artifacts = await loadFrozenBatterHitsProbabilityArtifactsFromFiles(
    input.artifactPaths,
  );
  return createM8BatterHitsBaseDistribution(
    input.offer,
    observationWithProviderVenue(
      input.pregameBoard,
      input.offer,
      input.observation,
    ),
    artifacts,
    input.evaluatedAt,
  );
}

/**
 * Settles one exact posted offer from an already-built frozen `D_base`.
 * Discovery remains unthresholded audit evidence and cannot authorize ranking.
 */
export function connectM8BatterHitsBaseEvaluationFromDistribution(
  input: ConnectM8BatterHitsBaseEvaluationFromDistributionInput,
): M8BatterHitsBaseEvaluationV1 {
  assertOfferSurvivedPregameGate(input.pregameBoard, input.offer);
  return settleM8BatterHitsBaseOffer(input.baseDistribution, input.offer);
}

/** Convenience path for one offer. Multi-offer board work should build once
 * with `connectM8BatterHitsBaseDistribution` and settle each exact offer through
 * `connectM8BatterHitsBaseEvaluationFromDistribution`.
 */
export async function connectM8BatterHitsBaseEvaluation(
  input: ConnectM8BatterHitsBaseDistributionInput,
): Promise<M8BatterHitsBaseEvaluationV1> {
  const baseDistribution = await connectM8BatterHitsBaseDistribution(input);
  return connectM8BatterHitsBaseEvaluationFromDistribution({
    pregameBoard: input.pregameBoard,
    offer: input.offer,
    baseDistribution,
  });
}
