import { createHash } from 'node:crypto';

import { TERMINAL_PA_CATEGORIES } from '../../domain/terminal-pa.js';
import {
  verifyM8_5BatterHitsFactorArtifactV1,
  type M8_5BatterHitsFactorArtifactV1,
  type M8_5ParkTransformationEffect,
  type M8_5TerminalOutcomeProbability,
} from './context-factor-contract.js';

export const M8_5_PARK_FACTOR_ARTIFACT_VERSION = 1 as const;

export type M8_5ParkBatterHand = 'L' | 'R' | 'S';

export interface M8_5ParkEffectIdentityV1 {
  readonly venue: string;
  readonly batterHand: M8_5ParkBatterHand;
  readonly effectIndex: number;
}

export interface M8_5ParkFactorArtifactV1 {
  readonly parkArtifactVersion: typeof M8_5_PARK_FACTOR_ARTIFACT_VERSION;
  readonly factorKey: 'park';
  readonly activeSeason: 2026;
  readonly modelVersion: string;
  readonly productionEnabled: false;
  readonly sourceVenueAuditSha256: string;
  readonly sourceEvaluationDatasetSha256: string;
  readonly sourceEvaluationSha256: string;
  readonly sourceFrozenBaseParitySha256: string;
  readonly sourceFrozenPredictionSha256: string;
  readonly providerVenueTextPreservedExactly: true;
  readonly homeTeamVenueInferenceUsed: false;
  readonly venueAliasMergingUsed: false;
  readonly typedFactorArtifact: M8_5BatterHitsFactorArtifactV1;
  readonly effectIdentities: readonly M8_5ParkEffectIdentityV1[];
  readonly untouchedTestReservation: Readonly<{ readonly rowsIncluded: false }>;
  readonly parkArtifactSha256: string;
}

export interface CreateM8_5ParkFactorArtifactV1Input {
  readonly sourceVenueAuditSha256: string;
  readonly sourceEvaluationDatasetSha256: string;
  readonly sourceEvaluationSha256: string;
  readonly sourceFrozenBaseParitySha256: string;
  readonly sourceFrozenPredictionSha256: string;
  readonly typedFactorArtifact: M8_5BatterHitsFactorArtifactV1;
  readonly effectIdentities: readonly M8_5ParkEffectIdentityV1[];
}

export interface M8_5ParkTransformationResolutionV1 {
  readonly status: 'validated';
  readonly factorKey: 'park';
  readonly modelVersion: string;
  readonly parkArtifactSha256: string;
  readonly typedFactorArtifactSha256: string;
  readonly venue: string;
  readonly batterHand: M8_5ParkBatterHand;
  readonly relativeRateMultipliers: M8_5ParkTransformationEffect['relativeRateMultipliers'];
}

type JsonRecord = Record<string, unknown>;

const ARTIFACT_KEYS = [
  'parkArtifactVersion',
  'factorKey',
  'activeSeason',
  'modelVersion',
  'productionEnabled',
  'sourceVenueAuditSha256',
  'sourceEvaluationDatasetSha256',
  'sourceEvaluationSha256',
  'sourceFrozenBaseParitySha256',
  'sourceFrozenPredictionSha256',
  'providerVenueTextPreservedExactly',
  'homeTeamVenueInferenceUsed',
  'venueAliasMergingUsed',
  'typedFactorArtifact',
  'effectIdentities',
  'untouchedTestReservation',
  'parkArtifactSha256',
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
  throw new TypeError('M8.5 park artifacts must contain JSON values only.');
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
  if (typeof value !== 'string' || value.length === 0) {
    throw new TypeError(`${label} must be a non-empty string.`);
  }
  return value;
}

function exactProviderVenue(value: unknown, label: string): string {
  const venue = nonEmptyString(value, label);
  if (venue.trim() !== venue || venue.includes('\u0000')) {
    throw new Error(`${label} must preserve exact nonblank provider venue text.`);
  }
  return venue;
}

function sha256Text(value: unknown, label: string): string {
  const text = nonEmptyString(value, label);
  if (!/^[a-f0-9]{64}$/u.test(text)) {
    throw new TypeError(`${label} must be a lowercase SHA-256 value.`);
  }
  return text;
}

function batterHand(value: unknown, label: string): M8_5ParkBatterHand {
  if (value !== 'L' && value !== 'R' && value !== 'S') {
    throw new Error(`${label} must be L, R, or S.`);
  }
  return value;
}

function nonNegativeInteger(value: unknown, label: string): number {
  if (!Number.isSafeInteger(value) || Number(value) < 0) {
    throw new TypeError(`${label} must be a non-negative integer.`);
  }
  return Number(value);
}

function withoutHash(record: JsonRecord): JsonRecord {
  const { parkArtifactSha256: _ignored, ...rest } = record;
  return rest;
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

function verifyTypedParkFactor(
  value: unknown,
): M8_5BatterHitsFactorArtifactV1 {
  const artifact = verifyM8_5BatterHitsFactorArtifactV1(value);
  if (artifact.factorKey !== 'park') {
    throw new Error('typed factor artifact must be the park factor.');
  }
  if (artifact.status !== 'validated') {
    throw new Error('park runtime artifact requires a validated typed factor.');
  }
  if (artifact.productionEnabled !== false) {
    throw new Error('park typed factor must remain production-disabled.');
  }
  if (artifact.effects.some((effect) => effect.kind !== 'park-transformation')) {
    throw new Error(
      'validated park typed factor may contain only park-transformation effects.',
    );
  }
  return artifact;
}

function verifyEffectCoverage(
  artifact: M8_5BatterHitsFactorArtifactV1,
  rawIdentities: unknown,
): readonly M8_5ParkEffectIdentityV1[] {
  if (!Array.isArray(rawIdentities) || rawIdentities.length === 0) {
    throw new TypeError('park effectIdentities must be a non-empty array.');
  }
  if (rawIdentities.length !== artifact.effects.length) {
    throw new Error(
      'park effectIdentities must map every typed park effect exactly once.',
    );
  }

  const indices = new Set<number>();
  const venueHands = new Set<string>();
  const handsByVenue = new Map<string, Set<M8_5ParkBatterHand>>();
  const identities = rawIdentities.map((rawIdentity, index) => {
    const identity = asRecord(rawIdentity, `park effectIdentities[${index}]`);
    assertExactKeys(
      identity,
      ['venue', 'batterHand', 'effectIndex'],
      `park effectIdentities[${index}]`,
    );
    const venue = exactProviderVenue(
      identity['venue'],
      `park effectIdentities[${index}].venue`,
    );
    const hand = batterHand(
      identity['batterHand'],
      `park effectIdentities[${index}].batterHand`,
    );
    const effectIndex = nonNegativeInteger(
      identity['effectIndex'],
      `park effectIdentities[${index}].effectIndex`,
    );
    if (effectIndex >= artifact.effects.length) {
      throw new RangeError(`park effect index ${effectIndex} is out of range.`);
    }
    if (indices.has(effectIndex)) {
      throw new Error(`duplicate park effect index ${effectIndex}.`);
    }
    indices.add(effectIndex);
    const venueHandKey = `${venue}\u0000${hand}`;
    if (venueHands.has(venueHandKey)) {
      throw new Error(`duplicate park venue-hand identity ${venue}|${hand}.`);
    }
    venueHands.add(venueHandKey);
    const effect = artifact.effects[effectIndex];
    if (effect?.kind !== 'park-transformation' || effect.batterHand !== hand) {
      throw new Error(
        `park effect ${effectIndex} does not match mapped batter hand ${hand}.`,
      );
    }
    const effectCategories = effect.relativeRateMultipliers.map(
      (entry) => entry.category,
    );
    if (
      JSON.stringify(effectCategories) !== JSON.stringify(TERMINAL_PA_CATEGORIES)
    ) {
      throw new Error(
        `park effect ${effectIndex} must contain every canonical terminal category in canonical order.`,
      );
    }
    const venueHandsSet = handsByVenue.get(venue) ?? new Set<M8_5ParkBatterHand>();
    venueHandsSet.add(hand);
    handsByVenue.set(venue, venueHandsSet);
    return Object.freeze({ venue, batterHand: hand, effectIndex });
  });

  if (indices.size !== artifact.effects.length) {
    throw new Error('park effect mapping does not cover every typed effect.');
  }
  for (const [venue, hands] of handsByVenue) {
    if (!hands.has('L') || !hands.has('R') || !hands.has('S')) {
      throw new Error(`park venue ${venue} must contain L, R, and S effects.`);
    }
  }
  return Object.freeze(identities);
}

export function verifyM8_5ParkFactorArtifactV1(
  value: unknown,
): M8_5ParkFactorArtifactV1 {
  const artifact = asRecord(value, 'M8.5 park factor artifact');
  assertExactKeys(artifact, ARTIFACT_KEYS, 'M8.5 park factor artifact');
  if (artifact['parkArtifactVersion'] !== M8_5_PARK_FACTOR_ARTIFACT_VERSION) {
    throw new Error('parkArtifactVersion is unsupported.');
  }
  if (artifact['factorKey'] !== 'park') {
    throw new Error('park factorKey must equal park.');
  }
  if (artifact['activeSeason'] !== 2026) {
    throw new Error('park activeSeason must equal 2026.');
  }
  const modelVersion = nonEmptyString(
    artifact['modelVersion'],
    'park modelVersion',
  );
  if (artifact['productionEnabled'] !== false) {
    throw new Error('park productionEnabled must remain false.');
  }
  for (const [key, label] of [
    ['sourceVenueAuditSha256', 'park source venue audit SHA-256'],
    ['sourceEvaluationDatasetSha256', 'park source evaluation dataset SHA-256'],
    ['sourceEvaluationSha256', 'park source evaluation SHA-256'],
    ['sourceFrozenBaseParitySha256', 'park source frozen-base parity SHA-256'],
    ['sourceFrozenPredictionSha256', 'park source frozen prediction SHA-256'],
  ] as const) {
    sha256Text(artifact[key], label);
  }
  if (artifact['providerVenueTextPreservedExactly'] !== true) {
    throw new Error('park provider venue text must be preserved exactly.');
  }
  if (artifact['homeTeamVenueInferenceUsed'] !== false) {
    throw new Error('park home-team venue inference is prohibited.');
  }
  if (artifact['venueAliasMergingUsed'] !== false) {
    throw new Error('park venue alias merging is prohibited.');
  }
  const typedFactorArtifact = verifyTypedParkFactor(
    artifact['typedFactorArtifact'],
  );
  if (typedFactorArtifact.modelVersion !== modelVersion) {
    throw new Error('park wrapper and typed factor model versions disagree.');
  }
  const effectIdentities = verifyEffectCoverage(
    typedFactorArtifact,
    artifact['effectIdentities'],
  );
  const reservation = asRecord(
    artifact['untouchedTestReservation'],
    'park untouchedTestReservation',
  );
  assertExactKeys(
    reservation,
    ['rowsIncluded'],
    'park untouchedTestReservation',
  );
  if (reservation['rowsIncluded'] !== false) {
    throw new Error('park untouched-test rows must remain excluded.');
  }
  const actualHash = sha256Text(
    artifact['parkArtifactSha256'],
    'park artifact SHA-256',
  );
  const expectedHash = sha256(withoutHash(artifact));
  if (actualHash !== expectedHash) {
    throw new Error('parkArtifactSha256 does not match the artifact content.');
  }
  return deepFreeze({
    ...artifact,
    typedFactorArtifact,
    effectIdentities,
  }) as unknown as M8_5ParkFactorArtifactV1;
}

export function createM8_5ParkFactorArtifactV1(
  input: CreateM8_5ParkFactorArtifactV1Input,
): M8_5ParkFactorArtifactV1 {
  const typedFactorArtifact = verifyTypedParkFactor(input.typedFactorArtifact);
  const withoutArtifactHash = {
    parkArtifactVersion: M8_5_PARK_FACTOR_ARTIFACT_VERSION,
    factorKey: 'park' as const,
    activeSeason: 2026 as const,
    modelVersion: typedFactorArtifact.modelVersion,
    productionEnabled: false as const,
    sourceVenueAuditSha256: input.sourceVenueAuditSha256,
    sourceEvaluationDatasetSha256: input.sourceEvaluationDatasetSha256,
    sourceEvaluationSha256: input.sourceEvaluationSha256,
    sourceFrozenBaseParitySha256: input.sourceFrozenBaseParitySha256,
    sourceFrozenPredictionSha256: input.sourceFrozenPredictionSha256,
    providerVenueTextPreservedExactly: true as const,
    homeTeamVenueInferenceUsed: false as const,
    venueAliasMergingUsed: false as const,
    typedFactorArtifact,
    effectIdentities: [...input.effectIdentities],
    untouchedTestReservation: { rowsIncluded: false as const },
  };
  return verifyM8_5ParkFactorArtifactV1({
    ...withoutArtifactHash,
    parkArtifactSha256: sha256(withoutArtifactHash),
  });
}

function exactResolutionInput(
  value: unknown,
): Readonly<{ venue: string; batterHand: M8_5ParkBatterHand }> {
  const input = asRecord(value, 'park resolution input');
  assertExactKeys(input, ['venue', 'batterHand'], 'park resolution input');
  return Object.freeze({
    venue: exactProviderVenue(input['venue'], 'park resolution venue'),
    batterHand: batterHand(input['batterHand'], 'park resolution batterHand'),
  });
}

export function resolveM8_5ParkTransformationV1(
  rawArtifact: unknown,
  rawInput: unknown,
): M8_5ParkTransformationResolutionV1 {
  const artifact = verifyM8_5ParkFactorArtifactV1(rawArtifact);
  const input = exactResolutionInput(rawInput);
  const match = artifact.effectIdentities.find(
    (identity) =>
      identity.venue === input.venue &&
      identity.batterHand === input.batterHand,
  );
  if (match === undefined) {
    throw new Error(
      `park artifact has no effect for ${input.venue} and hand ${input.batterHand}.`,
    );
  }
  const effect = artifact.typedFactorArtifact.effects[match.effectIndex];
  if (effect?.kind !== 'park-transformation') {
    throw new Error('park effect mapping resolved a non-park effect.');
  }
  return Object.freeze({
    status: 'validated' as const,
    factorKey: 'park' as const,
    modelVersion: artifact.modelVersion,
    parkArtifactSha256: artifact.parkArtifactSha256,
    typedFactorArtifactSha256:
      artifact.typedFactorArtifact.artifactSha256,
    venue: input.venue,
    batterHand: input.batterHand,
    relativeRateMultipliers: effect.relativeRateMultipliers,
  });
}

export function applyM8_5ParkTransformationV1(
  rawBaseProbabilities: readonly M8_5TerminalOutcomeProbability[],
  resolution: M8_5ParkTransformationResolutionV1,
): readonly M8_5TerminalOutcomeProbability[] {
  if (resolution.status !== 'validated' || resolution.factorKey !== 'park') {
    throw new Error('park transformation resolution is invalid.');
  }
  if (!Array.isArray(rawBaseProbabilities)) {
    throw new TypeError('base terminal probabilities must be an array.');
  }
  const baseByCategory = new Map<string, number>();
  for (const entry of rawBaseProbabilities) {
    if (!TERMINAL_PA_CATEGORIES.includes(entry.category)) {
      throw new Error('base terminal probabilities contain an unknown category.');
    }
    if (!Number.isFinite(entry.probability) || entry.probability < 0) {
      throw new RangeError('base terminal probabilities must be non-negative.');
    }
    if (baseByCategory.has(entry.category)) {
      throw new Error(`duplicate base terminal category ${entry.category}.`);
    }
    baseByCategory.set(entry.category, entry.probability);
  }
  if (baseByCategory.size !== TERMINAL_PA_CATEGORIES.length) {
    throw new Error('base terminal probabilities must contain every canonical category.');
  }
  const multiplierByCategory = new Map(
    resolution.relativeRateMultipliers.map((entry) => [
      entry.category,
      entry.multiplier,
    ]),
  );
  let total = 0;
  const weighted = TERMINAL_PA_CATEGORIES.map((category) => {
    const probability = baseByCategory.get(category)!;
    const multiplier = multiplierByCategory.get(category);
    if (multiplier === undefined || !Number.isFinite(multiplier) || multiplier <= 0) {
      throw new Error(`park multiplier for ${category} is invalid.`);
    }
    const value = probability * multiplier;
    total += value;
    return value;
  });
  if (!(total > 0)) {
    throw new Error('park transformation produced no probability mass.');
  }
  return Object.freeze(
    TERMINAL_PA_CATEGORIES.map((category, index) =>
      Object.freeze({
        category,
        probability: weighted[index]! / total,
      }),
    ),
  );
}
