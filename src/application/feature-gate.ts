import type { FeatureRegistration } from '../domain/feature-status.js';

export type FeatureUnavailableCode =
  | 'FEATURE_DISABLED'
  | 'FEATURE_NOT_PRODUCTION_ENABLED';

export class FeatureUnavailableError extends Error {
  readonly code: FeatureUnavailableCode;
  readonly featureId: string;

  constructor(featureId: string, code: FeatureUnavailableCode, message: string) {
    super(message);
    this.name = 'FeatureUnavailableError';
    this.featureId = featureId;
    this.code = code;
  }
}

export function assertFeatureCanProducePrediction(
  registration: FeatureRegistration,
): asserts registration is FeatureRegistration & {
  readonly enabled: true;
  readonly status: 'production-enabled';
} {
  if (!registration.enabled) {
    throw new FeatureUnavailableError(
      registration.featureId,
      'FEATURE_DISABLED',
      `Feature ${registration.featureId} is disabled and cannot produce predictions.`,
    );
  }

  if (registration.status !== 'production-enabled') {
    throw new FeatureUnavailableError(
      registration.featureId,
      'FEATURE_NOT_PRODUCTION_ENABLED',
      `Feature ${registration.featureId} is ${registration.status} and cannot produce predictions.`,
    );
  }
}
