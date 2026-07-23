export const FEATURE_STATUSES = [
  'planned',
  'data-under-investigation',
  'model-under-development',
  'validation',
  'production-enabled',
] as const;

export type FeatureStatus = (typeof FEATURE_STATUSES)[number];

export interface FeatureRegistration {
  readonly featureId: string;
  readonly enabled: boolean;
  readonly status: FeatureStatus;
}
