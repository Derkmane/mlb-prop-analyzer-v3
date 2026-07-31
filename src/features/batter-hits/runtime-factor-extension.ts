import {
  BATTER_HITS_COMPLETE_CANDIDATE_SHA256,
} from './runtime-probability.js';

export const BATTER_HITS_FACTOR_EXTENSION_ARTIFACT_VERSION = 1 as const;
export const BATTER_HITS_FACTOR_EXTENSION_MODEL_VERSION =
  'm8-batter-hits-factor-extension-contract-v1' as const;

export const BATTER_HITS_FACTOR_KEYS = [
  'teamSpecificBullpen',
  'gameSpecificOffensiveEnvironment',
  'park',
  'timesThroughOrder',
  'defenseToBattedBall',
] as const;

export type BatterHitsFactorKey = (typeof BATTER_HITS_FACTOR_KEYS)[number];

interface BatterHitsFactorBase {
  readonly applicationStage: 'statistic-distribution-before-settlement';
  readonly selectedSideInputForbidden: true;
}

export interface IdentityBatterHitsFactor extends BatterHitsFactorBase {
  readonly status: 'identity';
  readonly coefficient: 0;
  readonly modelVersion: 'identity';
  readonly artifactSha256: null;
  readonly validationStatus: 'deferred';
  readonly currentSeasonOnly: true;
}

export interface FittedBatterHitsFactor extends BatterHitsFactorBase {
  readonly status: 'fitted';
  readonly coefficient: number;
  readonly modelVersion: string;
  readonly artifactSha256: string;
  readonly validationStatus: 'production-validation-passed';
  readonly currentSeasonOnly: true;
}

export type BatterHitsFactorDescriptor =
  | IdentityBatterHitsFactor
  | FittedBatterHitsFactor;

export interface BatterHitsFactorExtensionArtifactV1 {
  readonly artifactVersion: typeof BATTER_HITS_FACTOR_EXTENSION_ARTIFACT_VERSION;
  readonly modelVersion: typeof BATTER_HITS_FACTOR_EXTENSION_MODEL_VERSION;
  readonly productionEnabled: false;
  readonly activeSeason: 2026;
  readonly sourceCompleteCandidateArtifactSha256:
    typeof BATTER_HITS_COMPLETE_CANDIDATE_SHA256;
  readonly factors: Readonly<Record<BatterHitsFactorKey, BatterHitsFactorDescriptor>>;
  readonly untouchedTestReservation: {
    readonly rowsIncluded: false;
  };
  readonly artifactSha256: string;
}

function assertExact(value: unknown, expected: unknown, label: string): void {
  if (value !== expected) {
    throw new Error(`${label} must equal ${String(expected)}.`);
  }
}

function assertNonEmptyString(value: unknown, label: string): string {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new TypeError(`${label} must be a non-empty string.`);
  }
  return value.trim();
}

function assertSha256(value: unknown, label: string): string {
  const text = assertNonEmptyString(value, label);
  if (!/^[a-f0-9]{64}$/u.test(text)) {
    throw new Error(`${label} must be a lowercase SHA-256 value.`);
  }
  return text;
}

function asRecord(value: unknown, label: string): Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new TypeError(`${label} must be an object.`);
  }
  return value as Record<string, unknown>;
}

function verifyFactor(
  value: unknown,
  key: BatterHitsFactorKey,
): BatterHitsFactorDescriptor {
  const factor = asRecord(value, `factor ${key}`);
  assertExact(
    factor.applicationStage,
    'statistic-distribution-before-settlement',
    `factor ${key}.applicationStage`,
  );
  assertExact(
    factor.selectedSideInputForbidden,
    true,
    `factor ${key}.selectedSideInputForbidden`,
  );
  assertExact(
    factor.currentSeasonOnly,
    true,
    `factor ${key}.currentSeasonOnly`,
  );

  if (factor.status === 'identity') {
    assertExact(factor.coefficient, 0, `factor ${key}.coefficient`);
    assertExact(factor.modelVersion, 'identity', `factor ${key}.modelVersion`);
    assertExact(factor.artifactSha256, null, `factor ${key}.artifactSha256`);
    assertExact(
      factor.validationStatus,
      'deferred',
      `factor ${key}.validationStatus`,
    );
    return factor as unknown as IdentityBatterHitsFactor;
  }

  if (factor.status === 'fitted') {
    if (
      typeof factor.coefficient !== 'number' ||
      !Number.isFinite(factor.coefficient) ||
      factor.coefficient === 0
    ) {
      throw new RangeError(
        `factor ${key}.coefficient must be one finite non-zero fitted value.`,
      );
    }
    assertNonEmptyString(factor.modelVersion, `factor ${key}.modelVersion`);
    assertSha256(factor.artifactSha256, `factor ${key}.artifactSha256`);
    assertExact(
      factor.validationStatus,
      'production-validation-passed',
      `factor ${key}.validationStatus`,
    );
    return factor as unknown as FittedBatterHitsFactor;
  }

  throw new Error(`factor ${key}.status must be identity or fitted.`);
}

export function verifyBatterHitsFactorExtensionArtifactV1(
  value: unknown,
): BatterHitsFactorExtensionArtifactV1 {
  const artifact = asRecord(value, 'Batter Hits factor extension artifact');
  assertExact(
    artifact.artifactVersion,
    BATTER_HITS_FACTOR_EXTENSION_ARTIFACT_VERSION,
    'factor extension artifactVersion',
  );
  assertExact(
    artifact.modelVersion,
    BATTER_HITS_FACTOR_EXTENSION_MODEL_VERSION,
    'factor extension modelVersion',
  );
  assertExact(
    artifact.productionEnabled,
    false,
    'factor extension productionEnabled',
  );
  assertExact(artifact.activeSeason, 2026, 'factor extension activeSeason');
  assertExact(
    artifact.sourceCompleteCandidateArtifactSha256,
    BATTER_HITS_COMPLETE_CANDIDATE_SHA256,
    'factor extension source complete-candidate SHA-256',
  );
  const reservation = asRecord(
    artifact.untouchedTestReservation,
    'factor extension untouchedTestReservation',
  );
  assertExact(
    reservation.rowsIncluded,
    false,
    'factor extension untouchedTestReservation.rowsIncluded',
  );
  assertSha256(artifact.artifactSha256, 'factor extension artifactSha256');

  const factors = asRecord(artifact.factors, 'factor extension factors');
  const keys = Object.keys(factors).sort();
  const expectedKeys = [...BATTER_HITS_FACTOR_KEYS].sort();
  if (JSON.stringify(keys) !== JSON.stringify(expectedKeys)) {
    throw new Error(
      'factor extension factors must contain every and only the versioned Batter Hits factor keys.',
    );
  }
  for (const key of BATTER_HITS_FACTOR_KEYS) {
    verifyFactor(factors[key], key);
  }

  return Object.freeze(
    artifact as unknown as BatterHitsFactorExtensionArtifactV1,
  );
}
