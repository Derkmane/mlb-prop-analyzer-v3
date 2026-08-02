import { createHash } from 'node:crypto';

import {
  createValidatedM8_5BatterHitsFactorArtifactV1,
  type M8_5BatterHitsFactorArtifactV1,
  type M8_5CurrentSeasonValidationEvidence,
  type M8_5ScenarioWeight,
} from './context-factor-contract.js';

export const M8_5_GAME_OFFENSIVE_ENVIRONMENT_MODEL_ARTIFACT_VERSION = 1 as const;
export const M8_5_GAME_OFFENSIVE_ENVIRONMENT_ACTIVE_SEASON = 2026 as const;

export interface M8_5GameEnvironmentFeatureNormalizationV1 {
  readonly featureName: string;
  readonly mean: number;
  readonly scale: number;
}

export interface M8_5GameEnvironmentCoefficientV1 {
  readonly featureName: string;
  readonly coefficient: number;
}

export interface M8_5GameEnvironmentScenarioLogitV1 {
  readonly scenarioId: string;
  readonly intercept: number;
  readonly coefficients: readonly M8_5GameEnvironmentCoefficientV1[];
}

export interface M8_5GameOffensiveEnvironmentModelArtifactV1 {
  readonly artifactVersion: typeof M8_5_GAME_OFFENSIVE_ENVIRONMENT_MODEL_ARTIFACT_VERSION;
  readonly factorKey: 'gameSpecificOffensiveEnvironment';
  readonly status: 'validated';
  readonly modelVersion: string;
  readonly productionEnabled: false;
  readonly activeSeason: typeof M8_5_GAME_OFFENSIVE_ENVIRONMENT_ACTIVE_SEASON;
  readonly applicationStage: 'shared-scenario-before-statistic-distribution';
  readonly selectedSideInputAllowed: false;
  readonly directProbabilityEffectAllowed: false;
  readonly sourceSharedEnvironmentModelVersion: string;
  readonly sourceSharedEnvironmentArtifactSha256: string;
  readonly scenarioIds: readonly string[];
  readonly featureNames: readonly string[];
  readonly featureNormalization: readonly M8_5GameEnvironmentFeatureNormalizationV1[];
  readonly scenarioLogits: readonly M8_5GameEnvironmentScenarioLogitV1[];
  readonly validationEvidence: Readonly<M8_5CurrentSeasonValidationEvidence>;
  readonly untouchedTestReservation: Readonly<{ readonly rowsIncluded: false }>;
  readonly artifactSha256: string;
}

export interface CreateM8_5GameOffensiveEnvironmentModelArtifactV1Input {
  readonly modelVersion: string;
  readonly sourceSharedEnvironmentModelVersion: string;
  readonly sourceSharedEnvironmentArtifactSha256: string;
  readonly scenarioIds: readonly string[];
  readonly featureNames: readonly string[];
  readonly featureNormalization: readonly M8_5GameEnvironmentFeatureNormalizationV1[];
  readonly scenarioLogits: readonly M8_5GameEnvironmentScenarioLogitV1[];
  readonly validationEvidence: Readonly<M8_5CurrentSeasonValidationEvidence>;
}

export interface ResolveM8_5GameOffensiveEnvironmentV1Input {
  readonly gameId: string;
  readonly sourceSharedEnvironmentModelVersion: string;
  readonly sourceSharedEnvironmentArtifactSha256: string;
  readonly scenarioIds: readonly string[];
  readonly features: Readonly<Record<string, number>>;
}

export interface M8_5GameOffensiveEnvironmentResolutionV1 {
  readonly status: 'validated';
  readonly factorKey: 'gameSpecificOffensiveEnvironment';
  readonly gameId: string;
  readonly modelVersion: string;
  readonly modelArtifactSha256: string;
  readonly inputSha256: string;
  readonly sourceSharedEnvironmentModelVersion: string;
  readonly sourceSharedEnvironmentArtifactSha256: string;
  readonly scenarioWeights: readonly M8_5ScenarioWeight[];
  readonly factorArtifact: Readonly<M8_5BatterHitsFactorArtifactV1>;
}

type JsonRecord = Record<string, unknown>;

const ARTIFACT_KEYS = [
  'artifactVersion',
  'factorKey',
  'status',
  'modelVersion',
  'productionEnabled',
  'activeSeason',
  'applicationStage',
  'selectedSideInputAllowed',
  'directProbabilityEffectAllowed',
  'sourceSharedEnvironmentModelVersion',
  'sourceSharedEnvironmentArtifactSha256',
  'scenarioIds',
  'featureNames',
  'featureNormalization',
  'scenarioLogits',
  'validationEvidence',
  'untouchedTestReservation',
  'artifactSha256',
] as const;

const RESOLUTION_INPUT_KEYS = [
  'gameId',
  'sourceSharedEnvironmentModelVersion',
  'sourceSharedEnvironmentArtifactSha256',
  'scenarioIds',
  'features',
] as const;

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
  throw new TypeError('game offensive-environment values must be JSON-compatible.');
}

function sha256(value: unknown): string {
  return createHash('sha256').update(stableJson(value)).digest('hex');
}

function asRecord(value: unknown, label: string): JsonRecord {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new TypeError(`${label} must be an object.`);
  }
  return value as JsonRecord;
}

function assertExactKeys(
  record: JsonRecord,
  expectedKeys: readonly string[],
  label: string,
): void {
  const expected = new Set(expectedKeys);
  for (const key of Object.keys(record)) {
    if (!expected.has(key)) {
      throw new Error(`${label} contains unexpected field ${key}.`);
    }
  }
  for (const key of expectedKeys) {
    if (!(key in record)) {
      throw new Error(`${label} is missing required field ${key}.`);
    }
  }
}

function nonEmptyString(value: unknown, label: string): string {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new TypeError(`${label} must be a non-empty string.`);
  }
  return value.trim();
}

function sha256String(value: unknown, label: string): string {
  const text = nonEmptyString(value, label);
  if (!/^[a-f0-9]{64}$/u.test(text)) {
    throw new Error(`${label} must be a lowercase SHA-256 value.`);
  }
  return text;
}

function finiteNumber(value: unknown, label: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new TypeError(`${label} must be a finite number.`);
  }
  return value;
}

function positiveNumber(value: unknown, label: string): number {
  const number = finiteNumber(value, label);
  if (!(number > 0)) {
    throw new RangeError(`${label} must be greater than zero.`);
  }
  return number;
}

function stringArray(value: unknown, label: string): readonly string[] {
  if (!Array.isArray(value) || value.length === 0) {
    throw new TypeError(`${label} must be a non-empty array.`);
  }
  const values = value.map((entry, index) =>
    nonEmptyString(entry, `${label}[${index}]`),
  );
  if (new Set(values).size !== values.length) {
    throw new Error(`${label} must contain unique values.`);
  }
  return Object.freeze(values);
}

function assertSameStrings(
  actual: readonly string[],
  expected: readonly string[],
  label: string,
): void {
  if (
    actual.length !== expected.length ||
    actual.some((value, index) => value !== expected[index])
  ) {
    throw new Error(`${label} does not match the frozen model artifact.`);
  }
}

function isoDate(value: unknown, label: string): string {
  const text = nonEmptyString(value, label);
  if (!/^\d{4}-\d{2}-\d{2}$/u.test(text)) {
    throw new Error(`${label} must use YYYY-MM-DD.`);
  }
  return text;
}

function validationEvidence(
  value: unknown,
): Readonly<M8_5CurrentSeasonValidationEvidence> {
  const evidence = asRecord(value, 'validationEvidence');
  assertExactKeys(
    evidence,
    [
      'fitPeriod',
      'validationPeriod',
      'walkForwardEvaluated',
      'untouchedRowsIncluded',
      'evidenceArtifactSha256',
    ],
    'validationEvidence',
  );
  const fit = asRecord(evidence['fitPeriod'], 'validationEvidence.fitPeriod');
  const validation = asRecord(
    evidence['validationPeriod'],
    'validationEvidence.validationPeriod',
  );
  assertExactKeys(fit, ['start', 'end'], 'validationEvidence.fitPeriod');
  assertExactKeys(
    validation,
    ['start', 'end'],
    'validationEvidence.validationPeriod',
  );
  const fitStart = isoDate(fit['start'], 'validationEvidence.fitPeriod.start');
  const fitEnd = isoDate(fit['end'], 'validationEvidence.fitPeriod.end');
  const validationStart = isoDate(
    validation['start'],
    'validationEvidence.validationPeriod.start',
  );
  const validationEnd = isoDate(
    validation['end'],
    'validationEvidence.validationPeriod.end',
  );
  if (!(fitStart <= fitEnd && fitEnd < validationStart && validationStart <= validationEnd)) {
    throw new Error('validationEvidence periods must be chronological and non-overlapping.');
  }
  if (evidence['walkForwardEvaluated'] !== true) {
    throw new Error('validationEvidence.walkForwardEvaluated must equal true.');
  }
  if (evidence['untouchedRowsIncluded'] !== false) {
    throw new Error('validationEvidence.untouchedRowsIncluded must equal false.');
  }
  const verified = {
    fitPeriod: Object.freeze({ start: fitStart, end: fitEnd }),
    validationPeriod: Object.freeze({
      start: validationStart,
      end: validationEnd,
    }),
    walkForwardEvaluated: true as const,
    untouchedRowsIncluded: false as const,
    evidenceArtifactSha256: sha256String(
      evidence['evidenceArtifactSha256'],
      'validationEvidence.evidenceArtifactSha256',
    ),
  };
  return Object.freeze(verified);
}

function normalizationRows(
  value: unknown,
  featureNames: readonly string[],
): readonly M8_5GameEnvironmentFeatureNormalizationV1[] {
  if (!Array.isArray(value) || value.length !== featureNames.length) {
    throw new Error('featureNormalization must contain one row per featureName.');
  }
  const rows = value.map((entry, index) => {
    const row = asRecord(entry, `featureNormalization[${index}]`);
    assertExactKeys(
      row,
      ['featureName', 'mean', 'scale'],
      `featureNormalization[${index}]`,
    );
    return Object.freeze({
      featureName: nonEmptyString(
        row['featureName'],
        `featureNormalization[${index}].featureName`,
      ),
      mean: finiteNumber(row['mean'], `featureNormalization[${index}].mean`),
      scale: positiveNumber(row['scale'], `featureNormalization[${index}].scale`),
    });
  });
  assertSameStrings(
    rows.map((row) => row.featureName),
    featureNames,
    'featureNormalization feature order',
  );
  return Object.freeze(rows);
}

function scenarioLogitRows(
  value: unknown,
  scenarioIds: readonly string[],
  featureNames: readonly string[],
): readonly M8_5GameEnvironmentScenarioLogitV1[] {
  if (!Array.isArray(value) || value.length !== scenarioIds.length) {
    throw new Error('scenarioLogits must contain one row per scenarioId.');
  }
  const rows = value.map((entry, scenarioIndex) => {
    const row = asRecord(entry, `scenarioLogits[${scenarioIndex}]`);
    assertExactKeys(
      row,
      ['scenarioId', 'intercept', 'coefficients'],
      `scenarioLogits[${scenarioIndex}]`,
    );
    const coefficientsRaw = row['coefficients'];
    if (!Array.isArray(coefficientsRaw) || coefficientsRaw.length !== featureNames.length) {
      throw new Error(
        `scenarioLogits[${scenarioIndex}].coefficients must contain one row per featureName.`,
      );
    }
    const coefficients = coefficientsRaw.map((coefficientValue, featureIndex) => {
      const coefficient = asRecord(
        coefficientValue,
        `scenarioLogits[${scenarioIndex}].coefficients[${featureIndex}]`,
      );
      assertExactKeys(
        coefficient,
        ['featureName', 'coefficient'],
        `scenarioLogits[${scenarioIndex}].coefficients[${featureIndex}]`,
      );
      return Object.freeze({
        featureName: nonEmptyString(
          coefficient['featureName'],
          `scenarioLogits[${scenarioIndex}].coefficients[${featureIndex}].featureName`,
        ),
        coefficient: finiteNumber(
          coefficient['coefficient'],
          `scenarioLogits[${scenarioIndex}].coefficients[${featureIndex}].coefficient`,
        ),
      });
    });
    assertSameStrings(
      coefficients.map((coefficient) => coefficient.featureName),
      featureNames,
      `scenarioLogits[${scenarioIndex}] coefficient feature order`,
    );
    return Object.freeze({
      scenarioId: nonEmptyString(
        row['scenarioId'],
        `scenarioLogits[${scenarioIndex}].scenarioId`,
      ),
      intercept: finiteNumber(
        row['intercept'],
        `scenarioLogits[${scenarioIndex}].intercept`,
      ),
      coefficients: Object.freeze(coefficients),
    });
  });
  assertSameStrings(
    rows.map((row) => row.scenarioId),
    scenarioIds,
    'scenarioLogits scenario order',
  );
  return Object.freeze(rows);
}

function artifactIdentity(
  artifact: Omit<M8_5GameOffensiveEnvironmentModelArtifactV1, 'artifactSha256'>,
): Omit<M8_5GameOffensiveEnvironmentModelArtifactV1, 'artifactSha256'> {
  return artifact;
}

export function createM8_5GameOffensiveEnvironmentModelArtifactV1(
  input: Readonly<CreateM8_5GameOffensiveEnvironmentModelArtifactV1Input>,
): Readonly<M8_5GameOffensiveEnvironmentModelArtifactV1> {
  const scenarioIds = stringArray(input.scenarioIds, 'scenarioIds');
  const featureNames = stringArray(input.featureNames, 'featureNames');
  const identity = Object.freeze({
    artifactVersion: M8_5_GAME_OFFENSIVE_ENVIRONMENT_MODEL_ARTIFACT_VERSION,
    factorKey: 'gameSpecificOffensiveEnvironment' as const,
    status: 'validated' as const,
    modelVersion: nonEmptyString(input.modelVersion, 'modelVersion'),
    productionEnabled: false as const,
    activeSeason: M8_5_GAME_OFFENSIVE_ENVIRONMENT_ACTIVE_SEASON,
    applicationStage: 'shared-scenario-before-statistic-distribution' as const,
    selectedSideInputAllowed: false as const,
    directProbabilityEffectAllowed: false as const,
    sourceSharedEnvironmentModelVersion: nonEmptyString(
      input.sourceSharedEnvironmentModelVersion,
      'sourceSharedEnvironmentModelVersion',
    ),
    sourceSharedEnvironmentArtifactSha256: sha256String(
      input.sourceSharedEnvironmentArtifactSha256,
      'sourceSharedEnvironmentArtifactSha256',
    ),
    scenarioIds,
    featureNames,
    featureNormalization: normalizationRows(
      input.featureNormalization,
      featureNames,
    ),
    scenarioLogits: scenarioLogitRows(
      input.scenarioLogits,
      scenarioIds,
      featureNames,
    ),
    validationEvidence: validationEvidence(input.validationEvidence),
    untouchedTestReservation: Object.freeze({ rowsIncluded: false as const }),
  });
  return Object.freeze({
    ...identity,
    artifactSha256: sha256(artifactIdentity(identity)),
  });
}

export function verifyM8_5GameOffensiveEnvironmentModelArtifactV1(
  rawArtifact: unknown,
): Readonly<M8_5GameOffensiveEnvironmentModelArtifactV1> {
  const artifact = asRecord(rawArtifact, 'game offensive-environment model artifact');
  assertExactKeys(artifact, ARTIFACT_KEYS, 'game offensive-environment model artifact');
  if (
    artifact['artifactVersion'] !==
      M8_5_GAME_OFFENSIVE_ENVIRONMENT_MODEL_ARTIFACT_VERSION ||
    artifact['factorKey'] !== 'gameSpecificOffensiveEnvironment' ||
    artifact['status'] !== 'validated' ||
    artifact['productionEnabled'] !== false ||
    artifact['activeSeason'] !== M8_5_GAME_OFFENSIVE_ENVIRONMENT_ACTIVE_SEASON ||
    artifact['applicationStage'] !==
      'shared-scenario-before-statistic-distribution' ||
    artifact['selectedSideInputAllowed'] !== false ||
    artifact['directProbabilityEffectAllowed'] !== false
  ) {
    throw new Error('unsupported game offensive-environment model artifact contract.');
  }
  if (asRecord(artifact['untouchedTestReservation'], 'untouchedTestReservation')['rowsIncluded'] !== false) {
    throw new Error('game offensive-environment model artifact exposes untouched-test rows.');
  }
  const rebuilt = createM8_5GameOffensiveEnvironmentModelArtifactV1({
    modelVersion: nonEmptyString(artifact['modelVersion'], 'modelVersion'),
    sourceSharedEnvironmentModelVersion: nonEmptyString(
      artifact['sourceSharedEnvironmentModelVersion'],
      'sourceSharedEnvironmentModelVersion',
    ),
    sourceSharedEnvironmentArtifactSha256: sha256String(
      artifact['sourceSharedEnvironmentArtifactSha256'],
      'sourceSharedEnvironmentArtifactSha256',
    ),
    scenarioIds: stringArray(artifact['scenarioIds'], 'scenarioIds'),
    featureNames: stringArray(artifact['featureNames'], 'featureNames'),
    featureNormalization: artifact['featureNormalization'] as readonly M8_5GameEnvironmentFeatureNormalizationV1[],
    scenarioLogits: artifact['scenarioLogits'] as readonly M8_5GameEnvironmentScenarioLogitV1[],
    validationEvidence: artifact['validationEvidence'] as Readonly<M8_5CurrentSeasonValidationEvidence>,
  });
  const artifactSha256 = sha256String(artifact['artifactSha256'], 'artifactSha256');
  if (rebuilt.artifactSha256 !== artifactSha256) {
    throw new Error('game offensive-environment model artifact SHA-256 is invalid.');
  }
  return Object.freeze({ ...rebuilt, artifactSha256 });
}

function verifiedResolutionInput(
  rawInput: unknown,
): Readonly<ResolveM8_5GameOffensiveEnvironmentV1Input> {
  const input = asRecord(rawInput, 'game offensive-environment resolution input');
  assertExactKeys(
    input,
    RESOLUTION_INPUT_KEYS,
    'game offensive-environment resolution input',
  );
  const featuresRecord = asRecord(input['features'], 'features');
  const features = Object.fromEntries(
    Object.entries(featuresRecord).map(([featureName, value]) => [
      nonEmptyString(featureName, 'feature name'),
      finiteNumber(value, `features.${featureName}`),
    ]),
  );
  return Object.freeze({
    gameId: nonEmptyString(input['gameId'], 'gameId'),
    sourceSharedEnvironmentModelVersion: nonEmptyString(
      input['sourceSharedEnvironmentModelVersion'],
      'sourceSharedEnvironmentModelVersion',
    ),
    sourceSharedEnvironmentArtifactSha256: sha256String(
      input['sourceSharedEnvironmentArtifactSha256'],
      'sourceSharedEnvironmentArtifactSha256',
    ),
    scenarioIds: stringArray(input['scenarioIds'], 'scenarioIds'),
    features: Object.freeze(features),
  });
}

function resolvedScenarioWeights(
  artifact: Readonly<M8_5GameOffensiveEnvironmentModelArtifactV1>,
  features: Readonly<Record<string, number>>,
): readonly M8_5ScenarioWeight[] {
  const featureNames = Object.keys(features).sort();
  const expectedFeatureNames = [...artifact.featureNames].sort();
  assertSameStrings(
    featureNames,
    expectedFeatureNames,
    'resolution feature names',
  );
  const normalized = Object.fromEntries(
    artifact.featureNormalization.map((row) => [
      row.featureName,
      (features[row.featureName]! - row.mean) / row.scale,
    ]),
  );
  const logits = artifact.scenarioLogits.map(
    (scenario) =>
      scenario.intercept +
      scenario.coefficients.reduce(
        (sum, coefficient) =>
          sum + coefficient.coefficient * normalized[coefficient.featureName]!,
        0,
      ),
  );
  const maximum = Math.max(...logits);
  const exponentials = logits.map((value) => Math.exp(value - maximum));
  const total = exponentials.reduce((sum, value) => sum + value, 0);
  if (!(total > 0) || !Number.isFinite(total)) {
    throw new Error('game offensive-environment softmax normalization is invalid.');
  }
  return Object.freeze(
    artifact.scenarioIds.map((scenarioId, index) =>
      Object.freeze({ scenarioId, weight: exponentials[index]! / total }),
    ),
  );
}

export function resolveM8_5GameOffensiveEnvironmentV1(
  rawArtifact: unknown,
  rawInput: unknown,
): Readonly<M8_5GameOffensiveEnvironmentResolutionV1> {
  const artifact = verifyM8_5GameOffensiveEnvironmentModelArtifactV1(rawArtifact);
  const input = verifiedResolutionInput(rawInput);
  if (
    input.sourceSharedEnvironmentModelVersion !==
    artifact.sourceSharedEnvironmentModelVersion
  ) {
    throw new Error('shared offensive-environment model version does not match the frozen model artifact.');
  }
  if (
    input.sourceSharedEnvironmentArtifactSha256 !==
    artifact.sourceSharedEnvironmentArtifactSha256
  ) {
    throw new Error('shared offensive-environment artifact SHA-256 does not match the frozen model artifact.');
  }
  assertSameStrings(
    input.scenarioIds,
    artifact.scenarioIds,
    'resolution scenarioIds',
  );
  const scenarioWeights = resolvedScenarioWeights(artifact, input.features);
  const inputSha256 = sha256({
    gameId: input.gameId,
    sourceSharedEnvironmentModelVersion:
      input.sourceSharedEnvironmentModelVersion,
    sourceSharedEnvironmentArtifactSha256:
      input.sourceSharedEnvironmentArtifactSha256,
    scenarioIds: input.scenarioIds,
    features: input.features,
  });
  const factorArtifact = createValidatedM8_5BatterHitsFactorArtifactV1({
    factorKey: 'gameSpecificOffensiveEnvironment',
    modelVersion: artifact.modelVersion,
    requiredInputs: Object.freeze([
      'gameId',
      'sourceSharedEnvironmentModelVersion',
      'sourceSharedEnvironmentArtifactSha256',
      ...artifact.featureNames,
    ]),
    sourceEvidenceVersion: `model:${artifact.artifactSha256}|input:${inputSha256}`,
    validationEvidence: artifact.validationEvidence,
    effects: Object.freeze([
      Object.freeze({
        kind: 'scenario-mixture' as const,
        applicationStage: 'shared-scenario-before-statistic-distribution' as const,
        scenarioWeights,
      }),
    ]),
  });
  return Object.freeze({
    status: 'validated' as const,
    factorKey: 'gameSpecificOffensiveEnvironment' as const,
    gameId: input.gameId,
    modelVersion: artifact.modelVersion,
    modelArtifactSha256: artifact.artifactSha256,
    inputSha256,
    sourceSharedEnvironmentModelVersion:
      artifact.sourceSharedEnvironmentModelVersion,
    sourceSharedEnvironmentArtifactSha256:
      artifact.sourceSharedEnvironmentArtifactSha256,
    scenarioWeights,
    factorArtifact,
  });
}
