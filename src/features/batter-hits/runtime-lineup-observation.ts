import type { JsonObject } from '../../domain/saved-prediction.js';
import {
  BATTER_HITS_FEATURE_DATA_FIELD,
} from './manifest.js';
import type { NormalizedBatterHitsBoardOffer } from './normalized-board-offer.js';
import {
  createFrozenBatterHitsProbabilityCandidate,
  type ConfirmedBatterHitsRuntimeObservation,
  type FrozenBatterHitsFeatureValues,
  type FrozenBatterHitsProbabilityArtifacts,
  type FrozenBatterHitsProbabilityResult,
} from './runtime-probability.js';

export type BatterHitsRuntimeLineupStatus = 'projected' | 'confirmed';

/**
 * Active pregame lineup observation. Projected and confirmed versions of an
 * otherwise identical lineup are the same baseball input. The status is source
 * metadata only and may not change eligibility, distributions, or probabilities.
 */
export interface BatterHitsRuntimeObservation
  extends Omit<ConfirmedBatterHitsRuntimeObservation, 'lineupStatus'> {
  readonly lineupStatus: BatterHitsRuntimeLineupStatus;
}

function assertLineupStatus(
  value: BatterHitsRuntimeLineupStatus,
): BatterHitsRuntimeLineupStatus {
  if (value !== 'projected' && value !== 'confirmed') {
    throw new RangeError(
      'runtime observation lineupStatus must be projected or confirmed',
    );
  }
  return value;
}

function probabilityObservation(
  observation: BatterHitsRuntimeObservation,
): ConfirmedBatterHitsRuntimeObservation {
  assertLineupStatus(observation.lineupStatus);
  return Object.freeze({
    ...observation,
    lineupStatus: 'confirmed',
  });
}

function preserveLineupStatusMetadata(
  result: FrozenBatterHitsProbabilityResult,
  lineupStatus: BatterHitsRuntimeLineupStatus,
): FrozenBatterHitsProbabilityResult {
  const rawDetails =
    result.candidate.featureData.values[BATTER_HITS_FEATURE_DATA_FIELD];
  if (
    rawDetails === null ||
    typeof rawDetails !== 'object' ||
    Array.isArray(rawDetails)
  ) {
    throw new TypeError('Batter Hits feature details must be a JSON object');
  }

  const details: JsonObject = Object.freeze({
    ...rawDetails,
    lineupStatus,
  });
  const values: FrozenBatterHitsFeatureValues = Object.freeze({
    ...result.candidate.featureData.values,
    [BATTER_HITS_FEATURE_DATA_FIELD]: details,
  });
  const candidate: FrozenBatterHitsProbabilityResult['candidate'] =
    Object.freeze({
      ...result.candidate,
      featureData: Object.freeze({
        ...result.candidate.featureData,
        values,
      }),
    });

  return Object.freeze({
    ...result,
    candidate,
  });
}

/**
 * Builds the frozen Batter Hits probability result from the active projected or
 * confirmed lineup. Lineup status is removed from the mathematical input and
 * restored only as source metadata on the candidate.
 */
export function createFrozenBatterHitsProbabilityCandidateForActiveLineup(
  offer: NormalizedBatterHitsBoardOffer,
  observation: BatterHitsRuntimeObservation,
  artifacts: FrozenBatterHitsProbabilityArtifacts,
): FrozenBatterHitsProbabilityResult {
  const lineupStatus = assertLineupStatus(observation.lineupStatus);
  const result = createFrozenBatterHitsProbabilityCandidate(
    offer,
    probabilityObservation(observation),
    artifacts,
  );
  return preserveLineupStatusMetadata(result, lineupStatus);
}
