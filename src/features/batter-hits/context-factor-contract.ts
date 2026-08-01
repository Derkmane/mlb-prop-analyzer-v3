import { createHash } from 'node:crypto';

import {
  TERMINAL_PA_CATEGORIES,
  type TerminalPaCategory,
} from '../../domain/terminal-pa.js';

export const M8_5_BATTER_HITS_FACTOR_CONTRACT_VERSION = 1 as const;
export const M8_5_BATTER_HITS_ACTIVE_SEASON = 2026 as const;

export const M8_5_BATTER_HITS_FACTOR_KEYS = [
  'teamSpecificBullpen',
  'gameSpecificOffensiveEnvironment',
  'park',
  'timesThroughOrder',
  'defenseToBattedBall',
] as const;

export const M8_5_BATTER_HITS_EFFECT_KINDS = [
  'identity',
  'terminal-outcome-vector',
  'scenario-mixture',
  'opportunity-survival',
  'workload-transition',
  'park-transformation',
  'batted-ball-translation',
] as const;

export const M8_5_BATTER_HITS_BATTED_BALL_CATEGORIES = [
  '1B',
  '2B',
  '3B',
  'ROE',
  'FC',
  'SF',
  'SH',
  'BIP_OUT',
] as const;

export type M8_5BatterHitsFactorKey =
  (typeof M8_5_BATTER_HITS_FACTOR_KEYS)[number];
export type M8_5BatterHitsEffectKind =
  (typeof M8_5_BATTER_HITS_EFFECT_KINDS)[number];
export type M8_5BatterHitsBattedBallCategory =
  (typeof M8_5_BATTER_HITS_BATTED_BALL_CATEGORIES)[number];

export type M8_5BatterHitsApplicationStage =
  | 'identity'
  | 'terminal-outcome-before-statistic-distribution'
  | 'shared-scenario-before-statistic-distribution'
  | 'opportunity-before-count-conversion'
  | 'workload-before-shared-scenario-mixing';

export interface M8_5IdentityEffect {
  readonly kind: 'identity';
  readonly applicationStage: 'identity';
}

export interface M8_5TerminalOutcomeProbability {
  readonly category: TerminalPaCategory;
  readonly probability: number;
}

export interface M8_5TerminalOutcomeVectorEffect {
  readonly kind: 'terminal-outcome-vector';
  readonly applicationStage: 'terminal-outcome-before-statistic-distribution';
  readonly scope: 'starter' | 'bullpen' | 'all-pitchers';
  readonly matchupKey: string;
  readonly categoryProbabilities: readonly M8_5TerminalOutcomeProbability[];
}

export interface M8_5ScenarioWeight {
  readonly scenarioId: string;
  readonly weight: number;
}

export interface M8_5ScenarioMixtureEffect {
  readonly kind: 'scenario-mixture';
  readonly applicationStage: 'shared-scenario-before-statistic-distribution';
  readonly scenarioWeights: readonly M8_5ScenarioWeight[];
}

export interface M8_5OpportunitySurvivalEffect {
  readonly kind: 'opportunity-survival';
  readonly applicationStage: 'opportunity-before-count-conversion';
  readonly lineupSlot: 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 | 'all';
  readonly survivalProbabilities: readonly number[];
}

export interface M8_5WorkloadDestination {
  readonly toState: string;
  readonly probability: number;
}

export interface M8_5WorkloadTransitionRow {
  readonly fromState: string;
  readonly destinations: readonly M8_5WorkloadDestination[];
}

export interface M8_5WorkloadTransitionEffect {
  readonly kind: 'workload-transition';
  readonly applicationStage: 'workload-before-shared-scenario-mixing';
  readonly teamSide: 'home' | 'away' | 'both';
  readonly transitionRows: readonly M8_5WorkloadTransitionRow[];
}

export interface M8_5ParkRateMultiplier {
  readonly category: TerminalPaCategory;
  readonly multiplier: number;
}

export interface M8_5ParkTransformationEffect {
  readonly kind: 'park-transformation';
  readonly applicationStage: 'terminal-outcome-before-statistic-distribution';
  readonly batterHand: 'L' | 'R' | 'S';
  readonly relativeRateMultipliers: readonly M8_5ParkRateMultiplier[];
}

export interface M8_5BattedBallDestination {
  readonly category: M8_5BatterHitsBattedBallCategory;
  readonly probability: number;
}

export interface M8_5BattedBallTransitionRow {
  readonly fromCategory: M8_5BatterHitsBattedBallCategory;
  readonly destinations: readonly M8_5BattedBallDestination[];
}

export interface M8_5BattedBallTranslationEffect {
  readonly kind: 'batted-ball-translation';
  readonly applicationStage: 'terminal-outcome-before-statistic-distribution';
  readonly teamSide: 'home' | 'away' | 'both';
  readonly transitionRows: readonly M8_5BattedBallTransitionRow[];
}

export type M8_5BatterHitsContextEffect =
  | M8_5IdentityEffect
  | M8_5TerminalOutcomeVectorEffect
  | M8_5ScenarioMixtureEffect
  | M8_5OpportunitySurvivalEffect
  | M8_5WorkloadTransitionEffect
  | M8_5ParkTransformationEffect
  | M8_5BattedBallTranslationEffect;

export interface M8_5EvidencePeriod {
  readonly start: string;
  readonly end: string;
}

export interface M8_5CurrentSeasonValidationEvidence {
  readonly fitPeriod: Readonly<M8_5EvidencePeriod>;
  readonly validationPeriod: Readonly<M8_5EvidencePeriod>;
  readonly walkForwardEvaluated: true;
  readonly untouchedRowsIncluded: false;
  readonly evidenceArtifactSha256: string;
}

export interface M8_5BatterHitsFactorArtifactV1 {
  readonly contractVersion: typeof M8_5_BATTER_HITS_FACTOR_CONTRACT_VERSION;
  readonly factorKey: M8_5BatterHitsFactorKey;
  readonly status: 'disabled' | 'validated';
  readonly modelVersion: string;
  readonly productionEnabled: false;
  readonly activeSeason: typeof M8_5_BATTER_HITS_ACTIVE_SEASON;
  readonly validationStatus: 'not-evaluated' | 'current-season-validated';
  readonly applicationStages: readonly M8_5BatterHitsApplicationStage[];
  readonly selectedSideInputAllowed: false;
  readonly directProbabilityEffectAllowed: false;
  readonly requiredInputs: readonly string[];
  readonly sourceEvidenceVersion: string;
  readonly validationEvidence: Readonly<M8_5CurrentSeasonValidationEvidence> | null;
  readonly effects: readonly M8_5BatterHitsContextEffect[];
  readonly untouchedTestReservation: Readonly<{ readonly rowsIncluded: false }>;
  readonly artifactSha256: string;
}

export interface CreateDisabledM8_5BatterHitsFactorArtifactInput {
  readonly factorKey: M8_5BatterHitsFactorKey;
  readonly requiredInputs: readonly string[];
  readonly sourceEvidenceVersion: string;
}

export interface CreateValidatedM8_5BatterHitsFactorArtifactInput {
  readonly factorKey: M8_5BatterHitsFactorKey;
  readonly modelVersion: string;
  readonly requiredInputs: readonly string[];
  readonly sourceEvidenceVersion: string;
  readonly validationEvidence: Readonly<M8_5CurrentSeasonValidationEvidence>;
  readonly effects: readonly Exclude<M8_5BatterHitsContextEffect, M8_5IdentityEffect>[];
}

type JsonRecord = Record<string, unknown>;

const ARTIFACT_KEYS = [
  'contractVersion',
  'factorKey',
  'status',
  'modelVersion',
  'productionEnabled',
  'activeSeason',
  'validationStatus',
  'applicationStages',
  'selectedSideInputAllowed',
  'directProbabilityEffectAllowed',
  'requiredInputs',
  'sourceEvidenceVersion',
  'validationEvidence',
  'effects',
  'untouchedTestReservation',
  'artifactSha256',
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
  throw new TypeError('M8.5 factor artifacts must contain JSON values only.');
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

function assertExact(value: unknown, expected: unknown, label: string): void {
  if (value !== expected) {
    throw new Error(`${label} must equal ${String(expected)}.`);
  }
}

function nonEmptyString(value: unknown, label: string): string {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new TypeError(`${label} must be a non-empty string.`);
  }
  return value.trim();
}

function assertSha256(value: unknown, label: string): string {
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

function probability(value: unknown, label: string): number {
  const number = finiteNumber(value, label);
  if (number < 0 || number > 1) {
    throw new RangeError(`${label} must be between 0 and 1.`);
  }
  return number;
}

function assertSumToOne(values: readonly number[], label: string): void {
  const sum = values.reduce((total, value) => total + value, 0);
  if (Math.abs(sum - 1) > 1e-9) {
    throw new RangeError(`${label} must sum to 1.`);
  }
}

function assertUnique(values: readonly string[], label: string): void {
  if (new Set(values).size !== values.length) {
    throw new Error(`${label} must contain unique values.`);
  }
}

function stringArray(value: unknown, label: string): readonly string[] {
  if (!Array.isArray(value) || value.length === 0) {
    throw new TypeError(`${label} must be a non-empty array.`);
  }
  const strings = value.map((entry, index) =>
    nonEmptyString(entry, `${label}[${index}]`),
  );
  assertUnique(strings, label);
  return strings;
}

function isTerminalPaCategory(value: unknown): value is TerminalPaCategory {
  return (
    typeof value === 'string' &&
    TERMINAL_PA_CATEGORIES.includes(value as TerminalPaCategory)
  );
}

function terminalPaCategory(value: unknown, label: string): TerminalPaCategory {
  if (!isTerminalPaCategory(value)) {
    throw new Error(`${label} must be a canonical terminal PA category.`);
  }
  return value;
}

function isBattedBallCategory(
  value: unknown,
): value is M8_5BatterHitsBattedBallCategory {
  return (
    typeof value === 'string' &&
    M8_5_BATTER_HITS_BATTED_BALL_CATEGORIES.includes(
      value as M8_5BatterHitsBattedBallCategory,
    )
  );
}

function battedBallCategory(
  value: unknown,
  label: string,
): M8_5BatterHitsBattedBallCategory {
  if (!isBattedBallCategory(value)) {
    throw new Error(`${label} must be a supported batted-ball category.`);
  }
  return value;
}

function verifyIdentityEffect(record: JsonRecord): M8_5IdentityEffect {
  assertExactKeys(record, ['kind', 'applicationStage'], 'identity effect');
  assertExact(record['applicationStage'], 'identity', 'identity effect applicationStage');
  return record as unknown as M8_5IdentityEffect;
}

function verifyTerminalOutcomeVectorEffect(
  record: JsonRecord,
): M8_5TerminalOutcomeVectorEffect {
  assertExactKeys(
    record,
    ['kind', 'applicationStage', 'scope', 'matchupKey', 'categoryProbabilities'],
    'terminal-outcome-vector effect',
  );
  assertExact(
    record['applicationStage'],
    'terminal-outcome-before-statistic-distribution',
    'terminal-outcome-vector applicationStage',
  );
  if (!['starter', 'bullpen', 'all-pitchers'].includes(String(record['scope']))) {
    throw new Error('terminal-outcome-vector scope is unsupported.');
  }
  nonEmptyString(record['matchupKey'], 'terminal-outcome-vector matchupKey');
  if (!Array.isArray(record['categoryProbabilities'])) {
    throw new TypeError('terminal-outcome-vector categoryProbabilities must be an array.');
  }
  const categories: string[] = [];
  const probabilities: number[] = [];
  for (const [index, value] of record['categoryProbabilities'].entries()) {
    const entry = asRecord(value, `categoryProbabilities[${index}]`);
    assertExactKeys(entry, ['category', 'probability'], `categoryProbabilities[${index}]`);
    categories.push(
      terminalPaCategory(entry['category'], `categoryProbabilities[${index}].category`),
    );
    probabilities.push(
      probability(entry['probability'], `categoryProbabilities[${index}].probability`),
    );
  }
  assertUnique(categories, 'terminal-outcome-vector categories');
  const expected = [...TERMINAL_PA_CATEGORIES].sort();
  const actual = [...categories].sort();
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    throw new Error(
      'terminal-outcome-vector must contain every and only canonical terminal PA category.',
    );
  }
  assertSumToOne(probabilities, 'terminal-outcome-vector categoryProbabilities');
  return record as unknown as M8_5TerminalOutcomeVectorEffect;
}

function verifyScenarioMixtureEffect(record: JsonRecord): M8_5ScenarioMixtureEffect {
  assertExactKeys(
    record,
    ['kind', 'applicationStage', 'scenarioWeights'],
    'scenario-mixture effect',
  );
  assertExact(
    record['applicationStage'],
    'shared-scenario-before-statistic-distribution',
    'scenario-mixture applicationStage',
  );
  if (!Array.isArray(record['scenarioWeights']) || record['scenarioWeights'].length === 0) {
    throw new TypeError('scenarioWeights must be a non-empty array.');
  }
  const ids: string[] = [];
  const weights: number[] = [];
  for (const [index, value] of record['scenarioWeights'].entries()) {
    const entry = asRecord(value, `scenarioWeights[${index}]`);
    assertExactKeys(entry, ['scenarioId', 'weight'], `scenarioWeights[${index}]`);
    ids.push(nonEmptyString(entry['scenarioId'], `scenarioWeights[${index}].scenarioId`));
    weights.push(probability(entry['weight'], `scenarioWeights[${index}].weight`));
  }
  assertUnique(ids, 'scenarioWeights scenario IDs');
  assertSumToOne(weights, 'scenarioWeights');
  return record as unknown as M8_5ScenarioMixtureEffect;
}

function verifyOpportunitySurvivalEffect(
  record: JsonRecord,
): M8_5OpportunitySurvivalEffect {
  assertExactKeys(
    record,
    ['kind', 'applicationStage', 'lineupSlot', 'survivalProbabilities'],
    'opportunity-survival effect',
  );
  assertExact(
    record['applicationStage'],
    'opportunity-before-count-conversion',
    'opportunity-survival applicationStage',
  );
  if (
    record['lineupSlot'] !== 'all' &&
    (!Number.isInteger(record['lineupSlot']) ||
      Number(record['lineupSlot']) < 1 ||
      Number(record['lineupSlot']) > 9)
  ) {
    throw new RangeError('opportunity-survival lineupSlot must be 1 through 9 or all.');
  }
  if (
    !Array.isArray(record['survivalProbabilities']) ||
    record['survivalProbabilities'].length === 0
  ) {
    throw new TypeError('survivalProbabilities must be a non-empty array.');
  }
  const values = record['survivalProbabilities'].map((value, index) =>
    probability(value, `survivalProbabilities[${index}]`),
  );
  for (let index = 1; index < values.length; index += 1) {
    if (values[index]! > values[index - 1]!) {
      throw new RangeError('survivalProbabilities must be monotone non-increasing.');
    }
  }
  return record as unknown as M8_5OpportunitySurvivalEffect;
}

function verifyWorkloadTransitionEffect(
  record: JsonRecord,
): M8_5WorkloadTransitionEffect {
  assertExactKeys(
    record,
    ['kind', 'applicationStage', 'teamSide', 'transitionRows'],
    'workload-transition effect',
  );
  assertExact(
    record['applicationStage'],
    'workload-before-shared-scenario-mixing',
    'workload-transition applicationStage',
  );
  if (!['home', 'away', 'both'].includes(String(record['teamSide']))) {
    throw new Error('workload-transition teamSide is unsupported.');
  }
  if (!Array.isArray(record['transitionRows']) || record['transitionRows'].length === 0) {
    throw new TypeError('workload-transition transitionRows must be non-empty.');
  }
  const fromStates: string[] = [];
  for (const [rowIndex, value] of record['transitionRows'].entries()) {
    const row = asRecord(value, `transitionRows[${rowIndex}]`);
    assertExactKeys(row, ['fromState', 'destinations'], `transitionRows[${rowIndex}]`);
    fromStates.push(nonEmptyString(row['fromState'], `transitionRows[${rowIndex}].fromState`));
    if (!Array.isArray(row['destinations']) || row['destinations'].length === 0) {
      throw new TypeError(`transitionRows[${rowIndex}].destinations must be non-empty.`);
    }
    const toStates: string[] = [];
    const probabilities: number[] = [];
    for (const [destinationIndex, destinationValue] of row['destinations'].entries()) {
      const destination = asRecord(
        destinationValue,
        `transitionRows[${rowIndex}].destinations[${destinationIndex}]`,
      );
      assertExactKeys(
        destination,
        ['toState', 'probability'],
        `transitionRows[${rowIndex}].destinations[${destinationIndex}]`,
      );
      toStates.push(
        nonEmptyString(
          destination['toState'],
          `transitionRows[${rowIndex}].destinations[${destinationIndex}].toState`,
        ),
      );
      probabilities.push(
        probability(
          destination['probability'],
          `transitionRows[${rowIndex}].destinations[${destinationIndex}].probability`,
        ),
      );
    }
    assertUnique(toStates, `transitionRows[${rowIndex}] destination states`);
    assertSumToOne(probabilities, `transitionRows[${rowIndex}] destinations`);
  }
  assertUnique(fromStates, 'workload-transition from states');
  return record as unknown as M8_5WorkloadTransitionEffect;
}

function verifyParkTransformationEffect(
  record: JsonRecord,
): M8_5ParkTransformationEffect {
  assertExactKeys(
    record,
    ['kind', 'applicationStage', 'batterHand', 'relativeRateMultipliers'],
    'park-transformation effect',
  );
  assertExact(
    record['applicationStage'],
    'terminal-outcome-before-statistic-distribution',
    'park-transformation applicationStage',
  );
  if (!['L', 'R', 'S'].includes(String(record['batterHand']))) {
    throw new Error('park-transformation batterHand is unsupported.');
  }
  if (
    !Array.isArray(record['relativeRateMultipliers']) ||
    record['relativeRateMultipliers'].length === 0
  ) {
    throw new TypeError('park relativeRateMultipliers must be non-empty.');
  }
  const categories: string[] = [];
  for (const [index, value] of record['relativeRateMultipliers'].entries()) {
    const entry = asRecord(value, `relativeRateMultipliers[${index}]`);
    assertExactKeys(entry, ['category', 'multiplier'], `relativeRateMultipliers[${index}]`);
    categories.push(
      terminalPaCategory(entry['category'], `relativeRateMultipliers[${index}].category`),
    );
    const multiplier = finiteNumber(
      entry['multiplier'],
      `relativeRateMultipliers[${index}].multiplier`,
    );
    if (multiplier <= 0) {
      throw new RangeError('park relative-rate multipliers must be greater than zero.');
    }
  }
  assertUnique(categories, 'park relativeRateMultipliers categories');
  return record as unknown as M8_5ParkTransformationEffect;
}

function verifyBattedBallTranslationEffect(
  record: JsonRecord,
): M8_5BattedBallTranslationEffect {
  assertExactKeys(
    record,
    ['kind', 'applicationStage', 'teamSide', 'transitionRows'],
    'batted-ball-translation effect',
  );
  assertExact(
    record['applicationStage'],
    'terminal-outcome-before-statistic-distribution',
    'batted-ball-translation applicationStage',
  );
  if (!['home', 'away', 'both'].includes(String(record['teamSide']))) {
    throw new Error('batted-ball-translation teamSide is unsupported.');
  }
  if (!Array.isArray(record['transitionRows']) || record['transitionRows'].length === 0) {
    throw new TypeError('batted-ball transitionRows must be non-empty.');
  }
  const fromCategories: string[] = [];
  for (const [rowIndex, value] of record['transitionRows'].entries()) {
    const row = asRecord(value, `batted-ball transitionRows[${rowIndex}]`);
    assertExactKeys(
      row,
      ['fromCategory', 'destinations'],
      `batted-ball transitionRows[${rowIndex}]`,
    );
    fromCategories.push(
      battedBallCategory(
        row['fromCategory'],
        `batted-ball transitionRows[${rowIndex}].fromCategory`,
      ),
    );
    if (!Array.isArray(row['destinations']) || row['destinations'].length === 0) {
      throw new TypeError(
        `batted-ball transitionRows[${rowIndex}].destinations must be non-empty.`,
      );
    }
    const destinationCategories: string[] = [];
    const probabilities: number[] = [];
    for (const [destinationIndex, destinationValue] of row['destinations'].entries()) {
      const destination = asRecord(
        destinationValue,
        `batted-ball transitionRows[${rowIndex}].destinations[${destinationIndex}]`,
      );
      assertExactKeys(
        destination,
        ['category', 'probability'],
        `batted-ball transitionRows[${rowIndex}].destinations[${destinationIndex}]`,
      );
      destinationCategories.push(
        battedBallCategory(
          destination['category'],
          `batted-ball transitionRows[${rowIndex}].destinations[${destinationIndex}].category`,
        ),
      );
      probabilities.push(
        probability(
          destination['probability'],
          `batted-ball transitionRows[${rowIndex}].destinations[${destinationIndex}].probability`,
        ),
      );
    }
    assertUnique(
      destinationCategories,
      `batted-ball transitionRows[${rowIndex}] destination categories`,
    );
    assertSumToOne(
      probabilities,
      `batted-ball transitionRows[${rowIndex}] destinations`,
    );
  }
  assertUnique(fromCategories, 'batted-ball transition source categories');
  return record as unknown as M8_5BattedBallTranslationEffect;
}

function verifyEffect(value: unknown): M8_5BatterHitsContextEffect {
  const record = asRecord(value, 'M8.5 context effect');
  const kind = record['kind'];
  if (!M8_5_BATTER_HITS_EFFECT_KINDS.includes(kind as M8_5BatterHitsEffectKind)) {
    throw new Error('M8.5 context effect kind is unsupported.');
  }
  switch (kind) {
    case 'identity':
      return verifyIdentityEffect(record);
    case 'terminal-outcome-vector':
      return verifyTerminalOutcomeVectorEffect(record);
    case 'scenario-mixture':
      return verifyScenarioMixtureEffect(record);
    case 'opportunity-survival':
      return verifyOpportunitySurvivalEffect(record);
    case 'workload-transition':
      return verifyWorkloadTransitionEffect(record);
    case 'park-transformation':
      return verifyParkTransformationEffect(record);
    case 'batted-ball-translation':
      return verifyBattedBallTranslationEffect(record);
    default:
      throw new Error('M8.5 context effect kind is unsupported.');
  }
}

function assertIsoDate(value: unknown, label: string): string {
  const text = nonEmptyString(value, label);
  if (!/^\d{4}-\d{2}-\d{2}$/u.test(text) || Number.isNaN(Date.parse(`${text}T00:00:00Z`))) {
    throw new TypeError(`${label} must be an ISO date.`);
  }
  if (!text.startsWith(`${M8_5_BATTER_HITS_ACTIVE_SEASON}-`)) {
    throw new Error(`${label} must be inside the active 2026 season.`);
  }
  return text;
}

function verifyPeriod(value: unknown, label: string): M8_5EvidencePeriod {
  const record = asRecord(value, label);
  assertExactKeys(record, ['start', 'end'], label);
  const start = assertIsoDate(record['start'], `${label}.start`);
  const end = assertIsoDate(record['end'], `${label}.end`);
  if (start > end) {
    throw new RangeError(`${label} start must not follow end.`);
  }
  return record as unknown as M8_5EvidencePeriod;
}

function verifyValidationEvidence(
  value: unknown,
): M8_5CurrentSeasonValidationEvidence {
  const record = asRecord(value, 'validationEvidence');
  assertExactKeys(
    record,
    [
      'fitPeriod',
      'validationPeriod',
      'walkForwardEvaluated',
      'untouchedRowsIncluded',
      'evidenceArtifactSha256',
    ],
    'validationEvidence',
  );
  const fit = verifyPeriod(record['fitPeriod'], 'validationEvidence.fitPeriod');
  const validation = verifyPeriod(
    record['validationPeriod'],
    'validationEvidence.validationPeriod',
  );
  if (fit.end >= validation.start) {
    throw new RangeError('validation period must begin after the fit period ends.');
  }
  assertExact(
    record['walkForwardEvaluated'],
    true,
    'validationEvidence.walkForwardEvaluated',
  );
  assertExact(
    record['untouchedRowsIncluded'],
    false,
    'validationEvidence.untouchedRowsIncluded',
  );
  assertSha256(
    record['evidenceArtifactSha256'],
    'validationEvidence.evidenceArtifactSha256',
  );
  return record as unknown as M8_5CurrentSeasonValidationEvidence;
}

function factorKey(value: unknown): M8_5BatterHitsFactorKey {
  if (!M8_5_BATTER_HITS_FACTOR_KEYS.includes(value as M8_5BatterHitsFactorKey)) {
    throw new Error('factorKey must be one approved M8.5 Batter Hits factor key.');
  }
  return value as M8_5BatterHitsFactorKey;
}

function stagesFor(
  effects: readonly M8_5BatterHitsContextEffect[],
): readonly M8_5BatterHitsApplicationStage[] {
  return [...new Set(effects.map((effect) => effect.applicationStage))].sort();
}

function withoutArtifactHash(record: JsonRecord): JsonRecord {
  const { artifactSha256: _ignored, ...withoutHash } = record;
  return withoutHash;
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

export function verifyM8_5BatterHitsFactorArtifactV1(
  value: unknown,
): M8_5BatterHitsFactorArtifactV1 {
  const artifact = asRecord(value, 'M8.5 Batter Hits factor artifact');
  assertExactKeys(artifact, ARTIFACT_KEYS, 'M8.5 Batter Hits factor artifact');
  assertExact(
    artifact['contractVersion'],
    M8_5_BATTER_HITS_FACTOR_CONTRACT_VERSION,
    'factor contractVersion',
  );
  factorKey(artifact['factorKey']);
  if (artifact['status'] !== 'disabled' && artifact['status'] !== 'validated') {
    throw new Error('factor status must be disabled or validated.');
  }
  nonEmptyString(artifact['modelVersion'], 'factor modelVersion');
  assertExact(artifact['productionEnabled'], false, 'factor productionEnabled');
  assertExact(
    artifact['activeSeason'],
    M8_5_BATTER_HITS_ACTIVE_SEASON,
    'factor activeSeason',
  );
  assertExact(
    artifact['selectedSideInputAllowed'],
    false,
    'factor selectedSideInputAllowed',
  );
  assertExact(
    artifact['directProbabilityEffectAllowed'],
    false,
    'factor directProbabilityEffectAllowed',
  );
  stringArray(artifact['requiredInputs'], 'factor requiredInputs');
  nonEmptyString(artifact['sourceEvidenceVersion'], 'factor sourceEvidenceVersion');
  const reservation = asRecord(
    artifact['untouchedTestReservation'],
    'factor untouchedTestReservation',
  );
  assertExactKeys(reservation, ['rowsIncluded'], 'factor untouchedTestReservation');
  assertExact(
    reservation['rowsIncluded'],
    false,
    'factor untouchedTestReservation.rowsIncluded',
  );
  if (!Array.isArray(artifact['effects']) || artifact['effects'].length === 0) {
    throw new TypeError('factor effects must be a non-empty array.');
  }
  const effects = artifact['effects'].map((effect) => verifyEffect(effect));
  const expectedStages = stagesFor(effects);
  if (!Array.isArray(artifact['applicationStages'])) {
    throw new TypeError('factor applicationStages must be an array.');
  }
  const actualStages = artifact['applicationStages'].map((stage, index) =>
    nonEmptyString(stage, `factor applicationStages[${index}]`),
  );
  if (JSON.stringify(actualStages) !== JSON.stringify(expectedStages)) {
    throw new Error('factor applicationStages must match the typed effect stages.');
  }

  if (artifact['status'] === 'disabled') {
    assertExact(
      artifact['validationStatus'],
      'not-evaluated',
      'disabled factor validationStatus',
    );
    assertExact(
      artifact['validationEvidence'],
      null,
      'disabled factor validationEvidence',
    );
    if (effects.length !== 1 || effects[0]?.kind !== 'identity') {
      throw new Error('disabled factors must contain exactly one identity effect.');
    }
  } else {
    assertExact(
      artifact['validationStatus'],
      'current-season-validated',
      'validated factor validationStatus',
    );
    verifyValidationEvidence(artifact['validationEvidence']);
    if (effects.some((effect) => effect.kind === 'identity')) {
      throw new Error('validated factors may not contain an identity effect.');
    }
  }

  const actualHash = assertSha256(artifact['artifactSha256'], 'factor artifactSha256');
  const expectedHash = sha256(withoutArtifactHash(artifact));
  if (actualHash !== expectedHash) {
    throw new Error('factor artifactSha256 does not match the artifact content.');
  }

  return deepFreeze(artifact) as unknown as M8_5BatterHitsFactorArtifactV1;
}

const IDENTITY_MODEL_VERSIONS: Readonly<Record<M8_5BatterHitsFactorKey, string>> =
  Object.freeze({
    teamSpecificBullpen: 'm8-5-team-specific-bullpen-identity-v1',
    gameSpecificOffensiveEnvironment:
      'm8-5-game-specific-offensive-environment-identity-v1',
    park: 'm8-5-park-identity-v1',
    timesThroughOrder: 'm8-5-times-through-order-identity-v1',
    defenseToBattedBall: 'm8-5-defense-to-batted-ball-identity-v1',
  });

export function createDisabledM8_5BatterHitsFactorArtifactV1(
  input: CreateDisabledM8_5BatterHitsFactorArtifactInput,
): M8_5BatterHitsFactorArtifactV1 {
  const effect: M8_5IdentityEffect = {
    kind: 'identity',
    applicationStage: 'identity',
  };
  const withoutHash = {
    contractVersion: M8_5_BATTER_HITS_FACTOR_CONTRACT_VERSION,
    factorKey: input.factorKey,
    status: 'disabled' as const,
    modelVersion: IDENTITY_MODEL_VERSIONS[input.factorKey],
    productionEnabled: false as const,
    activeSeason: M8_5_BATTER_HITS_ACTIVE_SEASON,
    validationStatus: 'not-evaluated' as const,
    applicationStages: stagesFor([effect]),
    selectedSideInputAllowed: false as const,
    directProbabilityEffectAllowed: false as const,
    requiredInputs: [...input.requiredInputs],
    sourceEvidenceVersion: input.sourceEvidenceVersion,
    validationEvidence: null,
    effects: [effect],
    untouchedTestReservation: { rowsIncluded: false as const },
  };
  return verifyM8_5BatterHitsFactorArtifactV1({
    ...withoutHash,
    artifactSha256: sha256(withoutHash),
  });
}

export function createValidatedM8_5BatterHitsFactorArtifactV1(
  input: CreateValidatedM8_5BatterHitsFactorArtifactInput,
): M8_5BatterHitsFactorArtifactV1 {
  const effects = [...input.effects];
  const withoutHash = {
    contractVersion: M8_5_BATTER_HITS_FACTOR_CONTRACT_VERSION,
    factorKey: input.factorKey,
    status: 'validated' as const,
    modelVersion: input.modelVersion,
    productionEnabled: false as const,
    activeSeason: M8_5_BATTER_HITS_ACTIVE_SEASON,
    validationStatus: 'current-season-validated' as const,
    applicationStages: stagesFor(effects),
    selectedSideInputAllowed: false as const,
    directProbabilityEffectAllowed: false as const,
    requiredInputs: [...input.requiredInputs],
    sourceEvidenceVersion: input.sourceEvidenceVersion,
    validationEvidence: input.validationEvidence,
    effects,
    untouchedTestReservation: { rowsIncluded: false as const },
  };
  return verifyM8_5BatterHitsFactorArtifactV1({
    ...withoutHash,
    artifactSha256: sha256(withoutHash),
  });
}
