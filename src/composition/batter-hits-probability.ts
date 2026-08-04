import {
  loadFrozenBatterHitsProbabilityArtifactsFromFiles,
  loadM8_5BatterHitsSuccessorArtifactsFromFiles,
  type BatterHitsProbabilityArtifactPaths,
  type M8_5BatterHitsSuccessorArtifactPaths,
} from '../adapters/index.js';
import {
  buildM8_5ValidatedFinalDistributionV1,
  createM8BatterHitsBaseDistribution,
  createM8_5BatterHitsFinalProbabilityResultV1,
  settleM8BatterHitsBaseOffer,
  settleM8_5FinalOfferV1,
  type BatterHitsRuntimeObservation,
  type M8BatterHitsBaseDistributionV1,
  type M8BatterHitsBaseEvaluationV1,
  type M8_5BatterHitsFinalProbabilityResultV1,
  type NormalizedBatterHitsBoardOffer,
  type ResolveM8_5GameOffensiveEnvironmentV1Input,
} from '../features/batter-hits/index.js';
import type { PregameNormalizedBatterHitsBoard } from './batter-hits-board.js';

export interface ConnectFrozenBatterHitsProbabilityInput {
  readonly pregameBoard: PregameNormalizedBatterHitsBoard;
  readonly offer: NormalizedBatterHitsBoardOffer;
  readonly observation: BatterHitsRuntimeObservation;
  readonly gameEnvironmentResolutionInput:
    ResolveM8_5GameOffensiveEnvironmentV1Input;
  readonly artifactPaths?: BatterHitsProbabilityArtifactPaths;
  readonly successorArtifactPaths?: M8_5BatterHitsSuccessorArtifactPaths;
}

export interface ConnectM8BatterHitsBaseDistributionInput {
  readonly pregameBoard: PregameNormalizedBatterHitsBoard;
  readonly offer: NormalizedBatterHitsBoardOffer;
  readonly observation: BatterHitsRuntimeObservation;
  readonly artifactPaths?: BatterHitsProbabilityArtifactPaths;
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
  if (board.excludedOffers.some((excluded) => excluded.offer === offer)) {
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

function alignedSuccessorArtifactPaths(
  input: ConnectFrozenBatterHitsProbabilityInput,
): M8_5BatterHitsSuccessorArtifactPaths | undefined {
  const runtimeManifestPath = input.artifactPaths?.runtimeManifestPath;
  if (
    runtimeManifestPath === undefined ||
    input.successorArtifactPaths?.sourceM8RuntimeArtifactPath !== undefined
  ) {
    return input.successorArtifactPaths;
  }
  return Object.freeze({
    ...input.successorArtifactPaths,
    sourceM8RuntimeArtifactPath: runtimeManifestPath,
  });
}

/**
 * Connects one active projected-or-confirmed pregame lineup to the exact
 * frozen M8.5 successor. The public candidate probability fields are settled
 * only from canonical `D_final`; `D_base` survives as audit-only lineage and
 * diagnostics. This path has no fallback to the frozen M8 candidate and does
 * not authorize ranking or enable the feature in production registries.
 */
export async function connectFrozenBatterHitsProbabilityOutput(
  input: ConnectFrozenBatterHitsProbabilityInput,
): Promise<M8_5BatterHitsFinalProbabilityResultV1> {
  assertOfferSurvivedPregameGate(input.pregameBoard, input.offer);
  const observation = observationWithProviderVenue(
    input.pregameBoard,
    input.offer,
    input.observation,
  );
  const [artifacts, successorArtifacts] = await Promise.all([
    loadFrozenBatterHitsProbabilityArtifactsFromFiles(input.artifactPaths),
    loadM8_5BatterHitsSuccessorArtifactsFromFiles(
      alignedSuccessorArtifactPaths(input),
    ),
  ]);
  const baseDistribution = createM8BatterHitsBaseDistribution(
    input.offer,
    observation,
    artifacts,
    input.pregameBoard.asOf,
  );
  const sourceM8Evaluation = settleM8BatterHitsBaseOffer(
    baseDistribution,
    input.offer,
  );
  const composed = buildM8_5ValidatedFinalDistributionV1({
    sourceBaseDistribution: baseDistribution,
    offer: input.offer,
    observation,
    artifacts,
    rawGameEnvironmentModelArtifact:
      successorArtifacts.gameEnvironmentModelArtifact,
    gameEnvironmentResolutionInput: input.gameEnvironmentResolutionInput,
    rawTeamBullpenFactorArtifact: successorArtifacts.teamBullpenArtifact,
    rawParkFactorArtifact: successorArtifacts.parkArtifact,
  });
  const finalEvaluation = settleM8_5FinalOfferV1({
    sourceM8Evaluation,
    finalDistribution: composed.finalDistribution,
  });
  return createM8_5BatterHitsFinalProbabilityResultV1({
    finalEvaluation,
    successorFreeze: successorArtifacts.successorFreeze,
  });
}

/**
 * Builds the immutable side-independent frozen M8 `D_base` exactly once for
 * one player/game/base-market/baseball-input identity. This remains an audit
 * and discovery boundary; it is not the public final probability candidate.
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

/** Convenience path for one audit-only base offer. Multi-offer board work
 * should build once with `connectM8BatterHitsBaseDistribution` and settle each
 * exact offer through `connectM8BatterHitsBaseEvaluationFromDistribution`.
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
