import type { ProbabilityMassFunction } from './probability.js';
import type {
  FeatureDataEnvelope,
  ProviderSnapshotReference,
  ScenarioWeightSnapshot,
} from './saved-prediction.js';
import type { SelectedSide } from './selected-side.js';

export const SAVED_RUN_SCHEMA_VERSION = 1 as const;

export const SAVED_RUN_CATEGORY_IDS = Object.freeze([
  'opportunity-miner-favorites',
  'high-probability-baseline-props',
  'high-probability-altline-props',
] as const);

export type SavedRunCategoryId = (typeof SAVED_RUN_CATEGORY_IDS)[number];

export interface SideProbabilitySnapshot {
  readonly pWin: number;
  readonly pLoss: number;
  readonly pVoid: number;
  readonly pWinGivenGrades: number | null;
}

export interface DiscoveryLineageSnapshot {
  readonly modelVersion: string;
  readonly artifactVersions: Readonly<Record<string, string>>;
  readonly statisticDistribution: ProbabilityMassFunction;
  readonly probabilities: SideProbabilitySnapshot;
}

export interface ContextLineageSnapshot {
  readonly modelVersion: string;
  readonly factorArtifactVersions: Readonly<Record<string, string>>;
  readonly probabilityDelta: number;
}

export interface SavedRunPriceDiagnostics {
  readonly label: 'DIAGNOSTIC ONLY';
  readonly americanPrice: number;
  readonly multiplier: number;
  readonly postedImpliedProbability: number;
  readonly priceEdge: number;
}

export interface SavedRunPickSnapshotV1 {
  readonly snapshotId: string;
  readonly categoryId: SavedRunCategoryId;
  readonly categoryRank: number;
  readonly eventId: string;
  readonly gameId: string;
  readonly providerEventId: string;
  readonly providerGameId: number;
  readonly playerId: string;
  readonly providerPlayerId: number;
  readonly playerName: string;
  readonly baseMarketKey: string;
  readonly marketLabel: string;
  readonly offerType: 'baseline' | 'alternate';
  readonly line: number;
  readonly selectedSide: SelectedSide;
  readonly settlementStatistic: string;
  readonly marketTimestamp: string;
  readonly generatedAt: string;
  readonly eligibilityProbability: number;
  readonly pWin: number;
  readonly pLoss: number;
  readonly pVoid: number;
  readonly pWinGivenGrades: number | null;
  readonly modelVersion: string;
  readonly distributionBuilderVersion: string;
  readonly settlementRuleVersion: string;
  readonly modelArtifactVersions: Readonly<Record<string, string>>;
  readonly providerSnapshotIds: readonly string[];
  readonly scenarioWeights: readonly ScenarioWeightSnapshot[];
  readonly opportunityDistribution: ProbabilityMassFunction;
  readonly baseStatisticDistribution: ProbabilityMassFunction;
  readonly baseProbabilities: SideProbabilitySnapshot;
  readonly discovery: DiscoveryLineageSnapshot | null;
  readonly finalStatisticDistribution: ProbabilityMassFunction;
  readonly context: ContextLineageSnapshot;
  readonly priceDiagnostics: SavedRunPriceDiagnostics;
  readonly featureData: FeatureDataEnvelope;
}

export interface SavedRunCategorySnapshotV1 {
  readonly categoryId: SavedRunCategoryId;
  readonly picks: readonly SavedRunPickSnapshotV1[];
}

export interface SavedRunSnapshotV1 {
  readonly schemaVersion: typeof SAVED_RUN_SCHEMA_VERSION;
  readonly runId: string;
  readonly savedAt: string;
  readonly generatedAt: string;
  readonly slateDate: string;
  readonly projectRulesVersion: string;
  readonly mathSpecVersion: string;
  readonly normalizedDataVersion: string;
  readonly configurationVersion: string;
  readonly settlementRegistryVersion: string;
  readonly productionEnabled: false;
  readonly rankingEnabled: false;
  readonly providerSnapshots: readonly ProviderSnapshotReference[];
  readonly categories: readonly SavedRunCategorySnapshotV1[];
}

const SHA256_PATTERN = /^[a-f0-9]{64}$/u;
const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/u;
const EPSILON = 1e-12;

function object(value: unknown, label: string): Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new TypeError(`${label} must be an object.`);
  }
  return value as Record<string, unknown>;
}

function array(value: unknown, label: string): readonly unknown[] {
  if (!Array.isArray(value)) throw new TypeError(`${label} must be an array.`);
  return value;
}

function nonemptyString(value: unknown, label: string): string {
  if (typeof value !== 'string' || value.length === 0) {
    throw new TypeError(`${label} must be a nonempty string.`);
  }
  return value;
}

function finiteNumber(value: unknown, label: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new TypeError(`${label} must be a finite number.`);
  }
  return value;
}

function probability(value: unknown, label: string): number {
  const result = finiteNumber(value, label);
  if (result < 0 || result > 1) {
    throw new RangeError(`${label} must be between zero and one.`);
  }
  return result;
}

function isoTimestamp(value: unknown, label: string): string {
  const result = nonemptyString(value, label);
  if (!Number.isFinite(Date.parse(result))) {
    throw new TypeError(`${label} must be an ISO timestamp.`);
  }
  return result;
}

function stringRecord(value: unknown, label: string): void {
  for (const [key, item] of Object.entries(object(value, label))) {
    nonemptyString(key, `${label} key`);
    nonemptyString(item, `${label}.${key}`);
  }
}

function validateDistribution(value: unknown, label: string): void {
  const distribution = object(value, label);
  const values = array(distribution['probabilities'], `${label}.probabilities`);
  if (values.length === 0) {
    throw new RangeError(`${label}.probabilities must not be empty.`);
  }
  let total = 0;
  for (const [index, item] of values.entries()) {
    total += probability(item, `${label}.probabilities[${index}]`);
  }
  if (Math.abs(total - 1) > EPSILON) {
    throw new RangeError(`${label} must conserve probability mass.`);
  }
}

function validateProbabilities(value: unknown, label: string): void {
  const probabilities = object(value, label);
  const pWin = probability(probabilities['pWin'], `${label}.pWin`);
  const pLoss = probability(probabilities['pLoss'], `${label}.pLoss`);
  const pVoid = probability(probabilities['pVoid'], `${label}.pVoid`);
  const conditional = probabilities['pWinGivenGrades'];
  if (conditional !== null) probability(conditional, `${label}.pWinGivenGrades`);
  if (Math.abs(pWin + pLoss + pVoid - 1) > EPSILON) {
    throw new RangeError(`${label} must conserve probability mass.`);
  }
}

function validateScenarioWeights(value: unknown, label: string): void {
  const rows = array(value, label);
  if (rows.length === 0) throw new RangeError(`${label} must not be empty.`);
  const identities = new Set<string>();
  let total = 0;
  for (const [index, item] of rows.entries()) {
    const row = object(item, `${label}[${index}]`);
    const scenarioId = nonemptyString(
      row['scenarioId'],
      `${label}[${index}].scenarioId`,
    );
    if (identities.has(scenarioId)) {
      throw new Error(`${label} contains duplicate scenario ${scenarioId}.`);
    }
    identities.add(scenarioId);
    total += probability(row['weight'], `${label}[${index}].weight`);
  }
  if (Math.abs(total - 1) > EPSILON) {
    throw new RangeError(`${label} must conserve scenario weight.`);
  }
}

function validateFeatureData(value: unknown, label: string): void {
  const feature = object(value, label);
  nonemptyString(feature['featureId'], `${label}.featureId`);
  const schemaVersion = finiteNumber(feature['schemaVersion'], `${label}.schemaVersion`);
  if (!Number.isInteger(schemaVersion) || schemaVersion < 1) {
    throw new RangeError(`${label}.schemaVersion must be a positive integer.`);
  }
  object(feature['values'], `${label}.values`);
}

function validatePick(
  value: unknown,
  categoryId: SavedRunCategoryId,
  expectedRank: number,
  providerSnapshotIds: ReadonlySet<string>,
): void {
  const pick = object(value, `pick ${expectedRank}`);
  nonemptyString(pick['snapshotId'], 'pick.snapshotId');
  if (pick['categoryId'] !== categoryId) {
    throw new Error('Saved pick category identity drifted from its container.');
  }
  if (pick['categoryRank'] !== expectedRank) {
    throw new Error('Saved pick ranks must be contiguous and one-based.');
  }
  for (const key of [
    'eventId',
    'gameId',
    'providerEventId',
    'playerId',
    'playerName',
    'baseMarketKey',
    'marketLabel',
    'settlementStatistic',
    'modelVersion',
    'distributionBuilderVersion',
    'settlementRuleVersion',
  ]) {
    nonemptyString(pick[key], `pick.${key}`);
  }
  const providerGameId = finiteNumber(pick['providerGameId'], 'pick.providerGameId');
  const providerPlayerId = finiteNumber(
    pick['providerPlayerId'],
    'pick.providerPlayerId',
  );
  if (!Number.isInteger(providerGameId) || !Number.isInteger(providerPlayerId)) {
    throw new RangeError('Provider game and player identities must be integers.');
  }
  if (pick['offerType'] !== 'baseline' && pick['offerType'] !== 'alternate') {
    throw new RangeError('pick.offerType must be baseline or alternate.');
  }
  if (pick['selectedSide'] !== 'higher' && pick['selectedSide'] !== 'lower') {
    throw new RangeError('pick.selectedSide must be higher or lower.');
  }
  finiteNumber(pick['line'], 'pick.line');
  isoTimestamp(pick['marketTimestamp'], 'pick.marketTimestamp');
  isoTimestamp(pick['generatedAt'], 'pick.generatedAt');
  probability(pick['eligibilityProbability'], 'pick.eligibilityProbability');
  validateProbabilities(pick, 'pick final probabilities');
  stringRecord(pick['modelArtifactVersions'], 'pick.modelArtifactVersions');
  const references = array(pick['providerSnapshotIds'], 'pick.providerSnapshotIds');
  if (references.length === 0) {
    throw new Error('Each saved pick must reference provider evidence.');
  }
  const uniqueReferences = new Set<string>();
  for (const reference of references) {
    const snapshotId = nonemptyString(reference, 'pick provider snapshot reference');
    if (!providerSnapshotIds.has(snapshotId)) {
      throw new Error(`Saved pick references unknown provider snapshot ${snapshotId}.`);
    }
    if (uniqueReferences.has(snapshotId)) {
      throw new Error(`Saved pick repeats provider snapshot ${snapshotId}.`);
    }
    uniqueReferences.add(snapshotId);
  }
  validateScenarioWeights(pick['scenarioWeights'], 'pick.scenarioWeights');
  validateDistribution(pick['opportunityDistribution'], 'pick.opportunityDistribution');
  validateDistribution(pick['baseStatisticDistribution'], 'pick.baseStatisticDistribution');
  validateProbabilities(pick['baseProbabilities'], 'pick.baseProbabilities');
  const discovery = pick['discovery'];
  if (discovery !== null) {
    const discoveryValue = object(discovery, 'pick.discovery');
    nonemptyString(discoveryValue['modelVersion'], 'pick.discovery.modelVersion');
    stringRecord(
      discoveryValue['artifactVersions'],
      'pick.discovery.artifactVersions',
    );
    validateDistribution(
      discoveryValue['statisticDistribution'],
      'pick.discovery.statisticDistribution',
    );
    validateProbabilities(discoveryValue['probabilities'], 'pick.discovery.probabilities');
  }
  validateDistribution(pick['finalStatisticDistribution'], 'pick.finalStatisticDistribution');
  const context = object(pick['context'], 'pick.context');
  nonemptyString(context['modelVersion'], 'pick.context.modelVersion');
  stringRecord(
    context['factorArtifactVersions'],
    'pick.context.factorArtifactVersions',
  );
  const contextDelta = finiteNumber(
    context['probabilityDelta'],
    'pick.context.probabilityDelta',
  );
  const base = object(pick['baseProbabilities'], 'pick.baseProbabilities');
  const baseFinal = base['pWinGivenGrades'];
  const finalValue = pick['pWinGivenGrades'];
  if (baseFinal !== null && finalValue !== null) {
    const expectedDelta = finiteNumber(finalValue, 'pick.pWinGivenGrades') -
      finiteNumber(baseFinal, 'pick.baseProbabilities.pWinGivenGrades');
    if (Math.abs(expectedDelta - contextDelta) > EPSILON) {
      throw new Error('Saved context delta must equal final minus base P(Win | grades).');
    }
  }
  const diagnostics = object(pick['priceDiagnostics'], 'pick.priceDiagnostics');
  if (diagnostics['label'] !== 'DIAGNOSTIC ONLY') {
    throw new Error('Saved price diagnostics must remain labeled DIAGNOSTIC ONLY.');
  }
  finiteNumber(diagnostics['americanPrice'], 'pick.priceDiagnostics.americanPrice');
  finiteNumber(diagnostics['multiplier'], 'pick.priceDiagnostics.multiplier');
  probability(
    diagnostics['postedImpliedProbability'],
    'pick.priceDiagnostics.postedImpliedProbability',
  );
  finiteNumber(diagnostics['priceEdge'], 'pick.priceDiagnostics.priceEdge');
  validateFeatureData(pick['featureData'], 'pick.featureData');
}

function validateSavedRun(value: unknown): asserts value is SavedRunSnapshotV1 {
  const run = object(value, 'saved run');
  if (run['schemaVersion'] !== SAVED_RUN_SCHEMA_VERSION) {
    throw new Error('Unsupported saved-run schema version.');
  }
  nonemptyString(run['runId'], 'saved run runId');
  isoTimestamp(run['savedAt'], 'saved run savedAt');
  isoTimestamp(run['generatedAt'], 'saved run generatedAt');
  const slateDate = nonemptyString(run['slateDate'], 'saved run slateDate');
  if (!DATE_PATTERN.test(slateDate)) {
    throw new TypeError('saved run slateDate must use YYYY-MM-DD.');
  }
  for (const key of [
    'projectRulesVersion',
    'mathSpecVersion',
    'normalizedDataVersion',
    'configurationVersion',
    'settlementRegistryVersion',
  ]) {
    nonemptyString(run[key], `saved run ${key}`);
  }
  if (run['productionEnabled'] !== false || run['rankingEnabled'] !== false) {
    throw new Error('Saved-run storage cannot enable production or ranking.');
  }

  const providerSnapshots = array(run['providerSnapshots'], 'saved run providerSnapshots');
  if (providerSnapshots.length === 0) {
    throw new Error('A saved run requires provider snapshots.');
  }
  const providerSnapshotIds = new Set<string>();
  for (const [index, item] of providerSnapshots.entries()) {
    const snapshot = object(item, `providerSnapshots[${index}]`);
    nonemptyString(snapshot['provider'], `providerSnapshots[${index}].provider`);
    const snapshotId = nonemptyString(
      snapshot['snapshotId'],
      `providerSnapshots[${index}].snapshotId`,
    );
    const sha256 = nonemptyString(snapshot['sha256'], `providerSnapshots[${index}].sha256`);
    if (!SHA256_PATTERN.test(sha256)) {
      throw new TypeError('Provider snapshot SHA-256 must be lowercase hexadecimal.');
    }
    if (providerSnapshotIds.has(snapshotId)) {
      throw new Error(`Duplicate provider snapshot ${snapshotId}.`);
    }
    providerSnapshotIds.add(snapshotId);
  }

  const categories = array(run['categories'], 'saved run categories');
  if (categories.length !== SAVED_RUN_CATEGORY_IDS.length) {
    throw new Error('A saved run must preserve all three product categories.');
  }
  const seenCategories = new Set<string>();
  const seenSnapshots = new Set<string>();
  for (const item of categories) {
    const category = object(item, 'saved run category');
    const categoryId = category['categoryId'];
    if (!SAVED_RUN_CATEGORY_IDS.includes(categoryId as SavedRunCategoryId)) {
      throw new Error(`Unknown saved-run category ${String(categoryId)}.`);
    }
    if (seenCategories.has(categoryId as string)) {
      throw new Error(`Duplicate saved-run category ${String(categoryId)}.`);
    }
    seenCategories.add(categoryId as string);
    const picks = array(category['picks'], `category ${String(categoryId)} picks`);
    const players = new Set<number>();
    picks.forEach((pick, index) => {
      validatePick(
        pick,
        categoryId as SavedRunCategoryId,
        index + 1,
        providerSnapshotIds,
      );
      const pickValue = object(pick, 'saved pick');
      const snapshotId = pickValue['snapshotId'] as string;
      const providerPlayerId = pickValue['providerPlayerId'] as number;
      if (seenSnapshots.has(snapshotId)) {
        throw new Error(`Duplicate saved prediction snapshot ${snapshotId}.`);
      }
      seenSnapshots.add(snapshotId);
      if (players.has(providerPlayerId)) {
        throw new Error('A saved category may contain only one prop per player.');
      }
      players.add(providerPlayerId);
    });
  }
  for (const categoryId of SAVED_RUN_CATEGORY_IDS) {
    if (!seenCategories.has(categoryId)) {
      throw new Error(`Saved run is missing category ${categoryId}.`);
    }
  }
}

function stableJson(value: unknown): string {
  if (
    value === null ||
    typeof value === 'boolean' ||
    typeof value === 'number' ||
    typeof value === 'string'
  ) {
    if (typeof value === 'number' && !Number.isFinite(value)) {
      throw new TypeError('Saved-run values must contain only finite numbers.');
    }
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map((entry) => stableJson(entry)).join(',')}]`;
  }
  if (typeof value === 'object') {
    const source = value as Record<string, unknown>;
    return `{${Object.keys(source)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${stableJson(source[key])}`)
      .join(',')}}`;
  }
  throw new TypeError('Saved-run values must be JSON-compatible.');
}

function deepFreeze<T>(value: T): T {
  if (value !== null && typeof value === 'object') {
    for (const child of Object.values(value as Record<string, unknown>)) {
      deepFreeze(child);
    }
    Object.freeze(value);
  }
  return value;
}

export function createSavedRunSnapshotV1(input: SavedRunSnapshotV1): SavedRunSnapshotV1 {
  validateSavedRun(input);
  const clone = JSON.parse(stableJson(input)) as unknown;
  validateSavedRun(clone);
  return deepFreeze(clone);
}

export function serializeSavedRunSnapshotV1(run: SavedRunSnapshotV1): string {
  validateSavedRun(run);
  return `${stableJson(run)}\n`;
}

export function parseSavedRunSnapshotV1(text: string): SavedRunSnapshotV1 {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new Error('Saved-run file must contain valid JSON.');
  }
  validateSavedRun(parsed);
  return deepFreeze(parsed);
}
