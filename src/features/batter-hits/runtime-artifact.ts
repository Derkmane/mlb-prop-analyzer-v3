import { createHash } from 'node:crypto';

export const BATTER_HITS_FROZEN_RUNTIME_MODEL_VERSION =
  'm8-batter-hits-runtime-freeze-v1' as const;
export const BATTER_HITS_FROZEN_RUNTIME_ARTIFACT_SHA256 =
  'e5a660ffc0aefc093dc80aae0169109bd7717605098d790b3257a83fad5bf3de' as const;
export const BATTER_HITS_FROZEN_SETTLEMENT_VERSION =
  'batter-hits-settlement-not-production-validated' as const;
export const BATTER_HITS_FROZEN_SETTLEMENT_REGISTRY_VERSION =
  'settlement-registry-v1' as const;

export const BATTER_HITS_FROZEN_COMPONENT_CANDIDATES = Object.freeze({
  recencyWeighting: 'uniform',
  batterPooling: 'league-pa-256',
  pitcherAllowedPooling: 'league-pa-256',
  coherentMatchup: 'batter-1.00-pitcher-0.75',
  platoon: 'league-raw-cell-limit-split-pa-1024-coefficient-0.75',
  starterBullpenTransition: 'starter-bf-side-pool-1000',
  paSurvival: 'slot-home-away-pool-50',
  sharedOffensiveEnvironment: 'shared-environment-k4',
} as const);

export type BatterHitsFrozenComponentId =
  keyof typeof BATTER_HITS_FROZEN_COMPONENT_CANDIDATES;

export interface FrozenBatterHitsFittedComponent {
  readonly candidateId: string;
  readonly fixedValidation: Readonly<Record<string, unknown>>;
  readonly walkForward: Readonly<Record<string, unknown>>;
}

export type FrozenBatterHitsFittedComponents = Readonly<{
  [ComponentId in BatterHitsFrozenComponentId]: FrozenBatterHitsFittedComponent;
}>;

export interface FrozenBatterHitsRuntimeSourceArtifact {
  readonly sourcePath: string;
  readonly sourceSha256: string;
}

export interface FrozenBatterHitsRuntimeArtifact {
  readonly purpose: string;
  readonly artifactVersion: 1;
  readonly modelVersion: typeof BATTER_HITS_FROZEN_RUNTIME_MODEL_VERSION;
  readonly settlementVersion: typeof BATTER_HITS_FROZEN_SETTLEMENT_VERSION;
  readonly settlementRegistryVersion:
    typeof BATTER_HITS_FROZEN_SETTLEMENT_REGISTRY_VERSION;
  readonly status: 'frozen-current-season-runtime-manifest-before-untouched-test';
  readonly productionEnabled: false;
  readonly untouchedTestAccessed: false;
  readonly activeSeason: 2026;
  readonly componentManifest: Readonly<Record<string, Readonly<Record<string, unknown>>>>;
  readonly fittedComponents: FrozenBatterHitsFittedComponents;
  readonly runtimeSourceArtifacts: readonly FrozenBatterHitsRuntimeSourceArtifact[];
  readonly untouchedTestReservation: Readonly<Record<string, unknown>> & {
    readonly rowsIncluded: false;
  };
  readonly artifactSha256: typeof BATTER_HITS_FROZEN_RUNTIME_ARTIFACT_SHA256;
}

type JsonRecord = Record<string, unknown>;

function record(value: unknown, label: string): JsonRecord {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new TypeError(`${label} must be an object.`);
  }
  return value as JsonRecord;
}

function array(value: unknown, label: string): readonly unknown[] {
  if (!Array.isArray(value)) {
    throw new TypeError(`${label} must be an array.`);
  }
  return value;
}

function nonEmptyString(value: unknown, label: string): string {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new TypeError(`${label} must be a non-empty string.`);
  }
  return value;
}

function exactString(value: unknown, expected: string, label: string): void {
  if (value !== expected) {
    throw new Error(`${label} must equal ${expected}.`);
  }
}

function exactFalse(value: unknown, label: string): void {
  if (value !== false) {
    throw new Error(`${label} must remain false.`);
  }
}

function sha256(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

function assertSha256(value: unknown, label: string): string {
  const normalized = nonEmptyString(value, label);
  if (!/^[a-f0-9]{64}$/u.test(normalized)) {
    throw new Error(`${label} must be a lowercase SHA-256 value.`);
  }
  return normalized;
}

function sortedKeys(value: JsonRecord): readonly string[] {
  return Object.keys(value).sort();
}

function assertExactKeys(
  value: JsonRecord,
  expectedKeys: readonly string[],
  label: string,
): void {
  const actual = sortedKeys(value);
  const expected = [...expectedKeys].sort();
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    throw new Error(`${label} keys must equal ${expected.join(', ')}.`);
  }
}

function validateEvidence(value: unknown, label: string): void {
  const evidence = record(value, label);
  nonEmptyString(evidence['sourcePath'], `${label}.sourcePath`);
  assertSha256(evidence['sourceSha256'], `${label}.sourceSha256`);

  if (typeof evidence['selectedCandidateObserved'] !== 'boolean') {
    throw new Error(`${label}.selectedCandidateObserved must be boolean.`);
  }

  const declared = array(
    evidence['declaredNondominatedCandidateIds'],
    `${label}.declaredNondominatedCandidateIds`,
  );
  if (declared.length === 0) {
    throw new Error(`${label} must preserve a declared nondominated set.`);
  }
  declared.forEach((candidateId, index) => {
    nonEmptyString(candidateId, `${label}.declaredNondominatedCandidateIds[${index}]`);
  });

  const properScores = array(evidence['properScores'], `${label}.properScores`);
  if (properScores.length === 0) {
    throw new Error(`${label} must preserve log-loss or Brier evidence.`);
  }
  properScores.forEach((rawScore, index) => {
    const score = record(rawScore, `${label}.properScores[${index}]`);
    nonEmptyString(score['path'], `${label}.properScores[${index}].path`);
    if (typeof score['value'] !== 'number' || !Number.isFinite(score['value'])) {
      throw new Error(`${label}.properScores[${index}].value must be finite.`);
    }
  });

  array(evidence['explicitNondominatedSets'], `${label}.explicitNondominatedSets`);
}

function validateIdentityComponent(value: unknown, label: string): void {
  const component = record(value, label);
  exactFalse(component['modeled'], `${label}.modeled`);
  exactString(component['reason'], 'deferred, not fitted in M8', `${label}.reason`);
  exactString(component['adjustment'], 'identity', `${label}.adjustment`);
}

function validateComponentManifest(value: unknown): void {
  const manifest = record(value, 'componentManifest');
  assertExactKeys(
    manifest,
    ['park', 'defenseToBattedBall', 'timesThroughOrder', 'eligibilityAndParticipation'],
    'componentManifest',
  );

  validateIdentityComponent(manifest['park'], 'componentManifest.park');
  validateIdentityComponent(
    manifest['defenseToBattedBall'],
    'componentManifest.defenseToBattedBall',
  );
  validateIdentityComponent(
    manifest['timesThroughOrder'],
    'componentManifest.timesThroughOrder',
  );

  const eligibility = record(
    manifest['eligibilityAndParticipation'],
    'componentManifest.eligibilityAndParticipation',
  );
  exactFalse(
    eligibility['modeled'],
    'componentManifest.eligibilityAndParticipation.modeled',
  );
  exactString(
    eligibility['reason'],
    'deferred to the ranking pipeline',
    'componentManifest.eligibilityAndParticipation.reason',
  );
  exactString(
    eligibility['adjustment'],
    'runtime-gate',
    'componentManifest.eligibilityAndParticipation.adjustment',
  );
}

function validateFittedComponents(value: unknown): void {
  const components = record(value, 'fittedComponents');
  const componentIds = Object.keys(BATTER_HITS_FROZEN_COMPONENT_CANDIDATES) as
    BatterHitsFrozenComponentId[];
  assertExactKeys(components, componentIds, 'fittedComponents');

  for (const componentId of componentIds) {
    const component = record(
      components[componentId],
      `fittedComponents.${componentId}`,
    );
    exactString(
      component['candidateId'],
      BATTER_HITS_FROZEN_COMPONENT_CANDIDATES[componentId],
      `fittedComponents.${componentId}.candidateId`,
    );
    validateEvidence(
      component['fixedValidation'],
      `fittedComponents.${componentId}.fixedValidation`,
    );
    validateEvidence(
      component['walkForward'],
      `fittedComponents.${componentId}.walkForward`,
    );

    const fixed = record(
      component['fixedValidation'],
      `fittedComponents.${componentId}.fixedValidation`,
    );
    const walkForward = record(
      component['walkForward'],
      `fittedComponents.${componentId}.walkForward`,
    );
    if (
      fixed['selectedCandidateObserved'] !== true &&
      walkForward['selectedCandidateObserved'] !== true
    ) {
      throw new Error(
        `fittedComponents.${componentId} candidate is absent from both evidence artifacts.`,
      );
    }
  }
}

function validateRuntimeSources(value: unknown): void {
  const sources = array(value, 'runtimeSourceArtifacts');
  if (sources.length === 0) {
    throw new Error('runtimeSourceArtifacts must not be empty.');
  }

  const paths = new Set<string>();
  sources.forEach((rawSource, index) => {
    const source = record(rawSource, `runtimeSourceArtifacts[${index}]`);
    const sourcePath = nonEmptyString(
      source['sourcePath'],
      `runtimeSourceArtifacts[${index}].sourcePath`,
    );
    if (paths.has(sourcePath)) {
      throw new Error(`runtimeSourceArtifacts contains duplicate path ${sourcePath}.`);
    }
    paths.add(sourcePath);
    assertSha256(
      source['sourceSha256'],
      `runtimeSourceArtifacts[${index}].sourceSha256`,
    );
  });
}

function artifactIdentity(artifact: JsonRecord): JsonRecord {
  return {
    artifactVersion: artifact['artifactVersion'],
    modelVersion: artifact['modelVersion'],
    settlementVersion: artifact['settlementVersion'],
    settlementRegistryVersion: artifact['settlementRegistryVersion'],
    status: artifact['status'],
    productionEnabled: artifact['productionEnabled'],
    untouchedTestAccessed: artifact['untouchedTestAccessed'],
    activeSeason: artifact['activeSeason'],
    componentManifest: artifact['componentManifest'],
    fittedComponents: artifact['fittedComponents'],
    runtimeSourceArtifacts: artifact['runtimeSourceArtifacts'],
    untouchedTestReservation: artifact['untouchedTestReservation'],
  };
}

function deepFreeze<T>(value: T): T {
  if (value !== null && typeof value === 'object' && !Object.isFrozen(value)) {
    const objectValue = value as Record<string, unknown>;
    for (const child of Object.values(objectValue)) {
      deepFreeze(child);
    }
    Object.freeze(value);
  }
  return value;
}

export function verifyFrozenBatterHitsRuntimeArtifact(
  value: unknown,
): FrozenBatterHitsRuntimeArtifact {
  const artifact = record(value, 'frozen Batter Hits runtime artifact');

  nonEmptyString(artifact['purpose'], 'artifact purpose');
  if (artifact['artifactVersion'] !== 1) {
    throw new Error('artifactVersion must equal 1.');
  }
  exactString(
    artifact['modelVersion'],
    BATTER_HITS_FROZEN_RUNTIME_MODEL_VERSION,
    'modelVersion',
  );
  exactString(
    artifact['settlementVersion'],
    BATTER_HITS_FROZEN_SETTLEMENT_VERSION,
    'settlementVersion',
  );
  exactString(
    artifact['settlementRegistryVersion'],
    BATTER_HITS_FROZEN_SETTLEMENT_REGISTRY_VERSION,
    'settlementRegistryVersion',
  );
  exactString(
    artifact['status'],
    'frozen-current-season-runtime-manifest-before-untouched-test',
    'status',
  );
  exactFalse(artifact['productionEnabled'], 'productionEnabled');
  exactFalse(artifact['untouchedTestAccessed'], 'untouchedTestAccessed');
  if (artifact['activeSeason'] !== 2026) {
    throw new Error('activeSeason must equal 2026.');
  }

  validateComponentManifest(artifact['componentManifest']);
  validateFittedComponents(artifact['fittedComponents']);
  validateRuntimeSources(artifact['runtimeSourceArtifacts']);

  const reservation = record(
    artifact['untouchedTestReservation'],
    'untouchedTestReservation',
  );
  exactFalse(reservation['rowsIncluded'], 'untouchedTestReservation.rowsIncluded');

  exactString(
    artifact['artifactSha256'],
    BATTER_HITS_FROZEN_RUNTIME_ARTIFACT_SHA256,
    'artifactSha256',
  );
  const calculatedSha256 = sha256(JSON.stringify(artifactIdentity(artifact)));
  if (calculatedSha256 !== BATTER_HITS_FROZEN_RUNTIME_ARTIFACT_SHA256) {
    throw new Error(
      `frozen Batter Hits runtime artifact SHA-256 is invalid: ${calculatedSha256}.`,
    );
  }

  return deepFreeze(artifact) as unknown as FrozenBatterHitsRuntimeArtifact;
}
