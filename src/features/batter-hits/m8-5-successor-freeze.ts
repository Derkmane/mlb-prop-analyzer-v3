import { createHash } from 'node:crypto';

import { M8_BATTER_HITS_BASE_DISTRIBUTION_CONTRACT } from './base-evaluation.js';
import {
  verifyM8_5BatterHitsFactorArtifactV1,
  type M8_5BatterHitsApplicationStage,
  type M8_5BatterHitsFactorArtifactV1,
  type M8_5BatterHitsFactorKey,
} from './context-factor-contract.js';
import {
  M8_5_BATTER_HITS_CONTEXT_MODEL_VERSION,
  M8_5_BATTER_HITS_VALIDATED_COMPOSITION_ORDER,
  M8_5_PARK_NOT_APPLIED_REASON,
  M8_5_TIMES_THROUGH_ORDER_IDENTITY_REASON,
} from './final-distribution-composition.js';
import { M8_5_BATTER_HITS_FINAL_DISTRIBUTION_CONTRACT } from './final-evaluation.js';
import { verifyM8_5GameOffensiveEnvironmentModelArtifactV1 } from './game-offensive-environment.js';
import { verifyM8_5ParkFactorArtifactV1 } from './park-transformation.js';
import {
  BATTER_HITS_FROZEN_RUNTIME_ARTIFACT_SHA256,
  BATTER_HITS_FROZEN_RUNTIME_MODEL_VERSION,
  BATTER_HITS_FROZEN_SETTLEMENT_REGISTRY_VERSION,
  BATTER_HITS_FROZEN_SETTLEMENT_VERSION,
  verifyFrozenBatterHitsRuntimeArtifact,
} from './runtime-artifact.js';

export const M8_5_BATTER_HITS_SUCCESSOR_FREEZE_MODEL_VERSION =
  'm8-5-batter-hits-successor-freeze-v1' as const;
export const M8_5_BATTER_HITS_SUCCESSOR_FREEZE_STATUS =
  'frozen-current-season-successor-before-new-untouched-test' as const;

export const M8_5_BATTER_HITS_SUCCESSOR_FREEZE_SOURCE_PATHS = Object.freeze({
  sourceM8RuntimeArtifact:
    'model-artifacts/m8-batter-hits-runtime-freeze-v1.json',
  gameSpecificOffensiveEnvironment:
    'model-artifacts/m8-5-game-offensive-environment-model-v1.json',
  teamSpecificBullpen:
    'model-artifacts/m8-5-team-bullpen-outcome-v1.json',
  timesThroughOrder:
    'model-artifacts/m8-5-times-through-order-identity-v1.json',
  park: 'model-artifacts/m8-5-park-transformation-v1.json',
  defenseToBattedBall:
    'model-artifacts/m8-5-defense-to-batted-ball-identity-v1.json',
} as const);

export type M8_5SuccessorFactorDispositionV1 =
  | 'applied'
  | 'identity'
  | 'validated-not-applied';

export interface M8_5SuccessorFactorFreezeV1 {
  readonly factorKey: M8_5BatterHitsFactorKey;
  readonly disposition: M8_5SuccessorFactorDispositionV1;
  readonly modelVersion: string;
  readonly factorArtifactSha256: string;
  readonly sourceArtifactPath: string;
  readonly sourceArtifactSha256: string;
  readonly applicationStages: readonly M8_5BatterHitsApplicationStage[];
  readonly includedInCanonicalDFinalComposition: boolean;
  readonly reason: string | null;
}

export interface M8_5BatterHitsSuccessorFreezeSourcesV1 {
  readonly sourceM8RuntimeArtifact: unknown;
  readonly gameSpecificOffensiveEnvironmentArtifact: unknown;
  readonly teamSpecificBullpenArtifact: unknown;
  readonly timesThroughOrderArtifact: unknown;
  readonly parkArtifact: unknown;
  readonly defenseToBattedBallArtifact: unknown;
}

export interface M8_5BatterHitsSuccessorFreezeV1 {
  readonly purpose: string;
  readonly artifactVersion: 1;
  readonly modelVersion:
    typeof M8_5_BATTER_HITS_SUCCESSOR_FREEZE_MODEL_VERSION;
  readonly status: typeof M8_5_BATTER_HITS_SUCCESSOR_FREEZE_STATUS;
  readonly activeSeason: 2026;
  readonly productionEnabled: false;
  readonly rankingEnabled: false;
  readonly hardDiscoveryFilterEnabled: false;
  readonly untouchedTestAccessed: false;
  readonly sourceM8RuntimeArtifact: Readonly<{
    readonly sourcePath: string;
    readonly modelVersion: typeof BATTER_HITS_FROZEN_RUNTIME_MODEL_VERSION;
    readonly artifactSha256:
      typeof BATTER_HITS_FROZEN_RUNTIME_ARTIFACT_SHA256;
  }>;
  readonly dBaseDefinition: Readonly<{
    readonly contractVersion:
      typeof M8_BATTER_HITS_BASE_DISTRIBUTION_CONTRACT;
    readonly identityField: 'baseDistributionSha256';
    readonly identityRule:
      'sha256(stable-json(all D_base fields except baseDistributionSha256))';
    readonly sourceRuntimeArtifactSha256:
      typeof BATTER_HITS_FROZEN_RUNTIME_ARTIFACT_SHA256;
    readonly sharedScenarioIdentityField: 'sharedScenarioIdentity';
  }>;
  readonly dFinalDefinition: Readonly<{
    readonly contractVersion:
      typeof M8_5_BATTER_HITS_FINAL_DISTRIBUTION_CONTRACT;
    readonly identityField: 'finalDistributionSha256';
    readonly identityRule:
      'sha256(stable-json(all D_final fields except finalDistributionSha256))';
    readonly contextModelVersion:
      typeof M8_5_BATTER_HITS_CONTEXT_MODEL_VERSION;
    readonly settlementVersion:
      typeof BATTER_HITS_FROZEN_SETTLEMENT_VERSION;
    readonly settlementRegistryVersion:
      typeof BATTER_HITS_FROZEN_SETTLEMENT_REGISTRY_VERSION;
    readonly sharedScenarioIdentityRule:
      'must equal source D_base sharedScenarioIdentity';
    readonly applicationOrder:
      typeof M8_5_BATTER_HITS_VALIDATED_COMPOSITION_ORDER;
    readonly sameDistributionForBaselineAndAlternate: true;
  }>;
  readonly factors: readonly M8_5SuccessorFactorFreezeV1[];
  readonly newUntouchedTestReservation: Readonly<{
    readonly reserved: false;
    readonly rowsIncluded: false;
    readonly cohortVersion: null;
  }>;
  readonly artifactSha256: string;
}

type JsonRecord = Record<string, unknown>;

function stableJson(value: unknown): string {
  if (
    value === null ||
    typeof value === 'boolean' ||
    typeof value === 'number' ||
    typeof value === 'string'
  ) {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map((entry) => stableJson(entry)).join(',')}]`;
  }
  if (typeof value === 'object') {
    const record = value as JsonRecord;
    return `{${Object.keys(record)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${stableJson(record[key])}`)
      .join(',')}}`;
  }
  throw new TypeError('M8.5 successor freeze values must be JSON-compatible.');
}

function sha256(value: unknown): string {
  return createHash('sha256').update(stableJson(value)).digest('hex');
}

function deepFreeze<T>(value: T): T {
  if (value !== null && typeof value === 'object' && !Object.isFrozen(value)) {
    for (const child of Object.values(value as JsonRecord)) {
      deepFreeze(child);
    }
    Object.freeze(value);
  }
  return value;
}

function cloneJson<T>(value: T): T {
  return deepFreeze(JSON.parse(stableJson(value)) as T);
}

function assertExact(value: unknown, expected: unknown, label: string): void {
  if (value !== expected) {
    throw new Error(`${label} must equal ${String(expected)}.`);
  }
}

function assertIdentityFactor(
  artifact: M8_5BatterHitsFactorArtifactV1,
  factorKey: 'timesThroughOrder' | 'defenseToBattedBall',
): void {
  assertExact(artifact.factorKey, factorKey, `${factorKey} factor key`);
  assertExact(artifact.status, 'disabled', `${factorKey} status`);
  assertExact(
    artifact.validationStatus,
    'not-evaluated',
    `${factorKey} validation status`,
  );
  if (
    artifact.effects.length !== 1 ||
    artifact.effects[0]?.kind !== 'identity' ||
    artifact.applicationStages.length !== 1 ||
    artifact.applicationStages[0] !== 'identity'
  ) {
    throw new Error(`${factorKey} must remain one explicit identity effect.`);
  }
}

function freezeIdentity(
  artifact: Omit<M8_5BatterHitsSuccessorFreezeV1, 'artifactSha256'>,
): unknown {
  const { purpose: _purpose, ...identity } = artifact;
  return identity;
}

export function buildM8_5BatterHitsSuccessorFreezeV1(
  sources: Readonly<M8_5BatterHitsSuccessorFreezeSourcesV1>,
): M8_5BatterHitsSuccessorFreezeV1 {
  const sourceM8RuntimeArtifact = verifyFrozenBatterHitsRuntimeArtifact(
    sources.sourceM8RuntimeArtifact,
  );
  const gameEnvironment =
    verifyM8_5GameOffensiveEnvironmentModelArtifactV1(
      sources.gameSpecificOffensiveEnvironmentArtifact,
    );
  const teamBullpen = verifyM8_5BatterHitsFactorArtifactV1(
    sources.teamSpecificBullpenArtifact,
  );
  const timesThroughOrder = verifyM8_5BatterHitsFactorArtifactV1(
    sources.timesThroughOrderArtifact,
  );
  const park = verifyM8_5ParkFactorArtifactV1(sources.parkArtifact);
  const defense = verifyM8_5BatterHitsFactorArtifactV1(
    sources.defenseToBattedBallArtifact,
  );

  assertExact(
    sourceM8RuntimeArtifact.artifactSha256,
    BATTER_HITS_FROZEN_RUNTIME_ARTIFACT_SHA256,
    'source M8 runtime artifact SHA-256',
  );
  assertExact(
    gameEnvironment.factorKey,
    'gameSpecificOffensiveEnvironment',
    'game environment factor key',
  );
  assertExact(gameEnvironment.status, 'validated', 'game environment status');
  assertExact(
    gameEnvironment.applicationStage,
    'shared-scenario-before-statistic-distribution',
    'game environment application stage',
  );
  assertExact(teamBullpen.factorKey, 'teamSpecificBullpen', 'bullpen factor key');
  assertExact(teamBullpen.status, 'validated', 'bullpen status');
  assertIdentityFactor(timesThroughOrder, 'timesThroughOrder');
  assertExact(park.factorKey, 'park', 'park factor key');
  assertExact(park.typedFactorArtifact.status, 'validated', 'park status');
  assertIdentityFactor(defense, 'defenseToBattedBall');

  const factors = Object.freeze<M8_5SuccessorFactorFreezeV1[]>([
    Object.freeze({
      factorKey: 'gameSpecificOffensiveEnvironment',
      disposition: 'applied',
      modelVersion: gameEnvironment.modelVersion,
      factorArtifactSha256: gameEnvironment.artifactSha256,
      sourceArtifactPath:
        M8_5_BATTER_HITS_SUCCESSOR_FREEZE_SOURCE_PATHS.gameSpecificOffensiveEnvironment,
      sourceArtifactSha256: gameEnvironment.artifactSha256,
      applicationStages: Object.freeze([gameEnvironment.applicationStage]),
      includedInCanonicalDFinalComposition: true,
      reason: null,
    }),
    Object.freeze({
      factorKey: 'teamSpecificBullpen',
      disposition: 'applied',
      modelVersion: teamBullpen.modelVersion,
      factorArtifactSha256: teamBullpen.artifactSha256,
      sourceArtifactPath:
        M8_5_BATTER_HITS_SUCCESSOR_FREEZE_SOURCE_PATHS.teamSpecificBullpen,
      sourceArtifactSha256: teamBullpen.artifactSha256,
      applicationStages: Object.freeze([...teamBullpen.applicationStages]),
      includedInCanonicalDFinalComposition: true,
      reason: null,
    }),
    Object.freeze({
      factorKey: 'timesThroughOrder',
      disposition: 'identity',
      modelVersion: timesThroughOrder.modelVersion,
      factorArtifactSha256: timesThroughOrder.artifactSha256,
      sourceArtifactPath:
        M8_5_BATTER_HITS_SUCCESSOR_FREEZE_SOURCE_PATHS.timesThroughOrder,
      sourceArtifactSha256: timesThroughOrder.artifactSha256,
      applicationStages: Object.freeze([...timesThroughOrder.applicationStages]),
      includedInCanonicalDFinalComposition: true,
      reason: M8_5_TIMES_THROUGH_ORDER_IDENTITY_REASON,
    }),
    Object.freeze({
      factorKey: 'park',
      disposition: 'validated-not-applied',
      modelVersion: park.modelVersion,
      factorArtifactSha256: park.typedFactorArtifact.artifactSha256,
      sourceArtifactPath: M8_5_BATTER_HITS_SUCCESSOR_FREEZE_SOURCE_PATHS.park,
      sourceArtifactSha256: park.parkArtifactSha256,
      applicationStages: Object.freeze([
        ...park.typedFactorArtifact.applicationStages,
      ]),
      includedInCanonicalDFinalComposition: true,
      reason: M8_5_PARK_NOT_APPLIED_REASON,
    }),
    Object.freeze({
      factorKey: 'defenseToBattedBall',
      disposition: 'identity',
      modelVersion: defense.modelVersion,
      factorArtifactSha256: defense.artifactSha256,
      sourceArtifactPath:
        M8_5_BATTER_HITS_SUCCESSOR_FREEZE_SOURCE_PATHS.defenseToBattedBall,
      sourceArtifactSha256: defense.artifactSha256,
      applicationStages: Object.freeze([...defense.applicationStages]),
      includedInCanonicalDFinalComposition: false,
      reason:
        'Current-season team-level effect-size pre-screen did not justify fitting or runtime application; Defense remains explicit identity.',
    }),
  ]);

  const withoutHash = cloneJson({
    purpose:
      'Frozen M8.5 Batter Hits successor manifest locking the source M8 model, D_base and D_final identity contracts, context composition, and every closed factor disposition before a new untouched current-season cohort is reserved or read.',
    artifactVersion: 1 as const,
    modelVersion: M8_5_BATTER_HITS_SUCCESSOR_FREEZE_MODEL_VERSION,
    status: M8_5_BATTER_HITS_SUCCESSOR_FREEZE_STATUS,
    activeSeason: 2026 as const,
    productionEnabled: false as const,
    rankingEnabled: false as const,
    hardDiscoveryFilterEnabled: false as const,
    untouchedTestAccessed: false as const,
    sourceM8RuntimeArtifact: {
      sourcePath:
        M8_5_BATTER_HITS_SUCCESSOR_FREEZE_SOURCE_PATHS.sourceM8RuntimeArtifact,
      modelVersion: BATTER_HITS_FROZEN_RUNTIME_MODEL_VERSION,
      artifactSha256: BATTER_HITS_FROZEN_RUNTIME_ARTIFACT_SHA256,
    },
    dBaseDefinition: {
      contractVersion: M8_BATTER_HITS_BASE_DISTRIBUTION_CONTRACT,
      identityField: 'baseDistributionSha256' as const,
      identityRule:
        'sha256(stable-json(all D_base fields except baseDistributionSha256))' as const,
      sourceRuntimeArtifactSha256: BATTER_HITS_FROZEN_RUNTIME_ARTIFACT_SHA256,
      sharedScenarioIdentityField: 'sharedScenarioIdentity' as const,
    },
    dFinalDefinition: {
      contractVersion: M8_5_BATTER_HITS_FINAL_DISTRIBUTION_CONTRACT,
      identityField: 'finalDistributionSha256' as const,
      identityRule:
        'sha256(stable-json(all D_final fields except finalDistributionSha256))' as const,
      contextModelVersion: M8_5_BATTER_HITS_CONTEXT_MODEL_VERSION,
      settlementVersion: BATTER_HITS_FROZEN_SETTLEMENT_VERSION,
      settlementRegistryVersion: BATTER_HITS_FROZEN_SETTLEMENT_REGISTRY_VERSION,
      sharedScenarioIdentityRule:
        'must equal source D_base sharedScenarioIdentity' as const,
      applicationOrder: M8_5_BATTER_HITS_VALIDATED_COMPOSITION_ORDER,
      sameDistributionForBaselineAndAlternate: true as const,
    },
    factors,
    newUntouchedTestReservation: {
      reserved: false as const,
      rowsIncluded: false as const,
      cohortVersion: null,
    },
  });

  return deepFreeze({
    ...withoutHash,
    artifactSha256: sha256(freezeIdentity(withoutHash)),
  });
}

export function verifyM8_5BatterHitsSuccessorFreezeV1(
  rawFreeze: unknown,
  sources: Readonly<M8_5BatterHitsSuccessorFreezeSourcesV1>,
): M8_5BatterHitsSuccessorFreezeV1 {
  const rebuilt = buildM8_5BatterHitsSuccessorFreezeV1(sources);
  if (stableJson(rawFreeze) !== stableJson(rebuilt)) {
    throw new Error(
      'M8.5 successor freeze does not match the frozen source artifacts and composition.',
    );
  }
  return rebuilt;
}
