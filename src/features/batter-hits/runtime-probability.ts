import {
  createProbabilityMassFunction,
  mixBernoulliOutcomesOverCountDistribution,
  mixProbabilityMassFunctions,
  settleDiscreteStatistic,
  validateProbability,
  validateProbabilityMassFunction,
  validateProbabilityVector,
  validateUnitIntervalVector,
} from '../../core/index.js';
import type { PredictionCandidate } from '../../domain/prediction-candidate.js';
import type { ProbabilityMassFunction } from '../../domain/probability.js';
import type { JsonObject } from '../../domain/saved-prediction.js';
import {
  createHitterPASurvivalState,
  createStarterRetentionState,
  deriveLineupSlotSurvivalFromTeamBattersFaced,
  deriveNamedHitterOpportunityCountDistribution,
  hitterOpportunityCountDistribution,
  type LineupSlot,
} from '../../game/index.js';
import {
  BATTER_HITS_FEATURE_DATA_FIELD,
  BATTER_HITS_FEATURE_ID,
  BATTER_HITS_MARKET_KEY,
} from './manifest.js';
import type { NormalizedBatterHitsBoardOffer } from './normalized-board-offer.js';
import type { FrozenBatterHitsRuntimeArtifact } from './runtime-artifact.js';

const TOLERANCE = 1e-12;
const MAXIMUM_TEAM_PA = 63;
const VALID_HANDS = ['L', 'R'] as const;
const HIT_CATEGORIES = new Set(['1B', '2B', '3B', 'HR']);

export const BATTER_HITS_COMPLETE_CANDIDATE_MODEL_VERSION =
  'm8-batter-hits-complete-candidate-v1' as const;
export const BATTER_HITS_COMPLETE_CANDIDATE_SHA256 =
  '728895ca850c5481cd1f17944e38464f16396becc3622146a1384bba19ce5cde' as const;
export const BATTER_HITS_RUNTIME_DISTRIBUTION_VERSION =
  'm9-batter-hits-runtime-distribution-v1' as const;

export type BatterHitsTeamSide = 'home' | 'away';
export type BatterHitsHand = (typeof VALID_HANDS)[number];
export type BatterHitsRuntimeLineupStatus = 'projected' | 'confirmed';
type CategoryVector = Readonly<Record<string, number>>;

interface FrozenSharedScenarioSide {
  readonly meanPa: number;
  readonly sigmaPa: number;
  readonly hitProbability: number;
}

interface FrozenSharedScenario {
  readonly scenarioIndex: number;
  readonly weight: number;
  readonly home: FrozenSharedScenarioSide;
  readonly away: FrozenSharedScenarioSide;
}

export interface FrozenSharedOffensiveEnvironmentArtifact {
  readonly artifactVersion: 2;
  readonly modelVersion: 'm8-shared-offensive-environment-v2';
  readonly productionEnabled: false;
  readonly activeSeason: 2026;
  readonly scenarios: readonly FrozenSharedScenario[];
  readonly starterBullpenTransition: {
    readonly bySide: Readonly<Record<BatterHitsTeamSide, readonly number[]>>;
  };
  readonly untouchedTestReservation: Readonly<Record<string, unknown>> & {
    readonly rowsIncluded: false;
  };
  readonly artifactSha256: string;
}

export interface FrozenStarterRetentionArtifact {
  readonly artifactVersion: 1;
  readonly modelVersion: 'm8-starter-retention-v1';
  readonly productionEnabled: false;
  readonly activeSeason: 2026;
  readonly conditionalRetentionByGroup: Readonly<Record<string, readonly number[]>>;
  readonly untouchedTestReservation: Readonly<Record<string, unknown>> & {
    readonly rowsIncluded: false;
  };
  readonly artifactSha256: string;
}

interface FrozenTerminalBaseParameters {
  readonly batterCoefficient: number;
  readonly pitcherAllowedCoefficient: number;
}

interface FrozenPlatoonCandidate {
  readonly platoonCoefficient: number;
}

export interface FrozenTerminalPaOutcomeArtifact {
  readonly artifactVersion: 1;
  readonly modelVersion: 'm8-terminal-pa-outcome-v1';
  readonly productionEnabled: false;
  readonly activeSeason: 2026;
  readonly categories: readonly string[];
  readonly hitCategories: readonly string[];
  readonly baseParameters: FrozenTerminalBaseParameters;
  readonly selectedPlatoonCandidate: FrozenPlatoonCandidate;
  readonly leagueTarget: CategoryVector;
  readonly batterOverall: Readonly<Record<string, CategoryVector>>;
  readonly pitcherAllowed: Readonly<Record<string, CategoryVector>>;
  readonly leaguePlatoonByMatchup: Readonly<Record<string, CategoryVector>>;
  readonly batterSplitByMatchup: Readonly<Record<string, CategoryVector>>;
  readonly unseenBatter: CategoryVector;
  readonly unseenPitcher: CategoryVector;
  readonly untouchedTestReservation: Readonly<Record<string, unknown>> & {
    readonly rowsIncluded: false;
  };
  readonly artifactSha256: string;
}

interface FrozenBullpenModel {
  readonly modelVersion: 'm8-generic-bullpen-outcome-v1';
  readonly handWeights: Readonly<Record<BatterHitsHand, number>>;
  readonly byHand: Readonly<Record<BatterHitsHand, CategoryVector>>;
}

export interface FrozenCompleteBatterHitsCandidate {
  readonly artifactVersion: 1;
  readonly modelVersion: typeof BATTER_HITS_COMPLETE_CANDIDATE_MODEL_VERSION;
  readonly productionEnabled: false;
  readonly activeSeason: 2026;
  readonly sourceSharedEnvironmentArtifactSha256: string;
  readonly sourceStarterRetentionArtifactSha256: string;
  readonly sourceTerminalOutcomeArtifactSha256: string;
  readonly environmentEffectPolicy: {
    readonly coefficient: 1;
    readonly noEnvironmentBenchmarkCoefficient: 0;
  };
  readonly bullpenModel: FrozenBullpenModel;
  readonly untouchedTestReservation: Readonly<Record<string, unknown>> & {
    readonly rowsIncluded: false;
  };
  readonly artifactSha256: typeof BATTER_HITS_COMPLETE_CANDIDATE_SHA256;
}

export interface FrozenBatterHitsProbabilityArtifacts {
  readonly runtimeManifest: FrozenBatterHitsRuntimeArtifact;
  readonly completeCandidate: FrozenCompleteBatterHitsCandidate;
  readonly sharedEnvironment: FrozenSharedOffensiveEnvironmentArtifact;
  readonly starterRetention: FrozenStarterRetentionArtifact;
  readonly terminalOutcome: FrozenTerminalPaOutcomeArtifact;
}

export interface BatterHitsRuntimeObservation {
  readonly lineupStatus: BatterHitsRuntimeLineupStatus;
  readonly providerGameId: number;
  readonly providerPlayerId: number;
  readonly providerTeamId: number;
  readonly teamSide: BatterHitsTeamSide;
  readonly venue?: string;
  readonly lineupSlot: LineupSlot;
  readonly batterSide: BatterHitsHand;
  readonly opposingStarterPitcherId: number;
  readonly opposingStarterTeamId: number;
  readonly opposingStarterHand: BatterHitsHand;
  readonly eligibilityProbability: 1;
  readonly lineupSourceCapturedAt: string;
  readonly lineupSourceSnapshotSha256: string;
}

export interface BatterHitsRuntimeContextFactors {
  readonly bullpenOverrideByHand?: Readonly<Record<BatterHitsHand, CategoryVector>>;
  readonly teamBullpenFactorModelVersion?: string;
  readonly teamBullpenFactorArtifactSha256?: string;
}

export interface FrozenBatterHitsScenarioDistribution {
  readonly scenarioIndex: number;
  readonly weight: number;
  readonly opportunityCountDistribution: ProbabilityMassFunction;
  readonly perOpportunityHitProbabilities: readonly number[];
  readonly hitDistribution: ProbabilityMassFunction;
}

export interface FrozenBatterHitsRuntimeDistribution {
  readonly distributionBuilderVersion: typeof BATTER_HITS_RUNTIME_DISTRIBUTION_VERSION;
  readonly statisticDistribution: ProbabilityMassFunction;
  readonly opportunityDistribution: ProbabilityMassFunction;
  readonly scenarios: readonly FrozenBatterHitsScenarioDistribution[];
}

export interface FrozenBatterHitsScenarioReference {
  readonly providerGameId: number;
  readonly sharedEnvironmentModelVersion: string;
  readonly sharedEnvironmentArtifactSha256: string;
  readonly completeCandidateArtifactSha256: string;
}

export interface FrozenBatterHitsFeatureValues extends JsonObject {
  readonly [BATTER_HITS_FEATURE_DATA_FIELD]: JsonObject;
}

export type FrozenBatterHitsProbabilityCandidate = PredictionCandidate<
  FrozenBatterHitsScenarioReference,
  FrozenBatterHitsFeatureValues
>;

export interface FrozenBatterHitsProbabilityResult {
  readonly distribution: FrozenBatterHitsRuntimeDistribution;
  readonly candidate: FrozenBatterHitsProbabilityCandidate;
  readonly productionEnabled: false;
}

function asRecord(value: unknown, label: string): Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new TypeError(`${label} must be an object.`);
  }
  return value as Record<string, unknown>;
}

function assertExact(value: unknown, expected: unknown, label: string): void {
  if (value !== expected) {
    throw new Error(`${label} must equal ${String(expected)}.`);
  }
}

function assertLineupStatus(
  value: BatterHitsRuntimeLineupStatus,
): BatterHitsRuntimeLineupStatus {
  if (value !== 'projected' && value !== 'confirmed') {
    throw new RangeError(
      'runtime observation lineupStatus must be projected or confirmed.',
    );
  }
  return value;
}

function assertPositiveInteger(value: number, label: string): number {
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new RangeError(`${label} must be a positive integer.`);
  }
  return value;
}

function assertLineupSlot(value: number): asserts value is LineupSlot {
  if (!Number.isInteger(value) || value < 1 || value > 9) {
    throw new RangeError('lineupSlot must be an integer from 1 through 9.');
  }
}

function assertSha256(value: string, label: string): void {
  if (!/^[a-f0-9]{64}$/u.test(value)) {
    throw new Error(`${label} must be a lowercase SHA-256 value.`);
  }
}

function assertTimestamp(value: string, label: string): void {
  if (!Number.isFinite(Date.parse(value))) {
    throw new Error(`${label} must be an ISO timestamp.`);
  }
}

function assertOptionalVenue(value: unknown): void {
  if (value === undefined) return;
  if (
    typeof value !== 'string' ||
    value.length === 0 ||
    value.trim() !== value ||
    value.includes('\0')
  ) {
    throw new TypeError(
      'runtime observation venue must be a non-empty trimmed string without null bytes when present.',
    );
  }
}

function validateCategoryVector(
  vector: CategoryVector,
  categories: readonly string[],
  label: string,
): CategoryVector {
  const keys = Object.keys(vector).sort();
  const expected = [...categories].sort();
  if (JSON.stringify(keys) !== JSON.stringify(expected)) {
    throw new Error(`${label} must contain every and only modeled category.`);
  }
  const values = categories.map((category) => vector[category] ?? Number.NaN);
  validateProbabilityVector(values, label);
  return vector;
}

function validateArtifactSeal(value: { readonly productionEnabled: false; readonly activeSeason: 2026; readonly untouchedTestReservation: { readonly rowsIncluded: false } }, label: string): void {
  assertExact(value.productionEnabled, false, `${label}.productionEnabled`);
  assertExact(value.activeSeason, 2026, `${label}.activeSeason`);
  assertExact(
    value.untouchedTestReservation.rowsIncluded,
    false,
    `${label}.untouchedTestReservation.rowsIncluded`,
  );
}

export function verifyFrozenBatterHitsProbabilityArtifacts(
  artifacts: FrozenBatterHitsProbabilityArtifacts,
): FrozenBatterHitsProbabilityArtifacts {
  const { runtimeManifest, completeCandidate, sharedEnvironment, starterRetention, terminalOutcome } = artifacts;
  assertExact(runtimeManifest.productionEnabled, false, 'runtimeManifest.productionEnabled');
  assertExact(runtimeManifest.untouchedTestAccessed, false, 'runtimeManifest.untouchedTestAccessed');
  assertExact(
    completeCandidate.modelVersion,
    BATTER_HITS_COMPLETE_CANDIDATE_MODEL_VERSION,
    'completeCandidate.modelVersion',
  );
  assertExact(
    completeCandidate.artifactSha256,
    BATTER_HITS_COMPLETE_CANDIDATE_SHA256,
    'completeCandidate.artifactSha256',
  );
  assertExact(
    completeCandidate.environmentEffectPolicy.coefficient,
    1,
    'completeCandidate.environmentEffectPolicy.coefficient',
  );
  assertExact(
    completeCandidate.environmentEffectPolicy.noEnvironmentBenchmarkCoefficient,
    0,
    'completeCandidate.environmentEffectPolicy.noEnvironmentBenchmarkCoefficient',
  );
  validateArtifactSeal(completeCandidate, 'completeCandidate');
  validateArtifactSeal(sharedEnvironment, 'sharedEnvironment');
  validateArtifactSeal(starterRetention, 'starterRetention');
  validateArtifactSeal(terminalOutcome, 'terminalOutcome');
  assertExact(
    completeCandidate.sourceSharedEnvironmentArtifactSha256,
    sharedEnvironment.artifactSha256,
    'completeCandidate source shared environment',
  );
  assertExact(
    completeCandidate.sourceStarterRetentionArtifactSha256,
    starterRetention.artifactSha256,
    'completeCandidate source starter retention',
  );
  assertExact(
    completeCandidate.sourceTerminalOutcomeArtifactSha256,
    terminalOutcome.artifactSha256,
    'completeCandidate source terminal outcome',
  );
  assertExact(sharedEnvironment.modelVersion, 'm8-shared-offensive-environment-v2', 'sharedEnvironment.modelVersion');
  assertExact(starterRetention.modelVersion, 'm8-starter-retention-v1', 'starterRetention.modelVersion');
  assertExact(terminalOutcome.modelVersion, 'm8-terminal-pa-outcome-v1', 'terminalOutcome.modelVersion');
  if (sharedEnvironment.scenarios.length === 0) {
    throw new Error('sharedEnvironment.scenarios must not be empty.');
  }
  validateProbabilityVector(
    sharedEnvironment.scenarios.map((scenario) => scenario.weight),
    'shared environment scenario weights',
  );
  const categories = terminalOutcome.categories;
  if (categories.length === 0 || terminalOutcome.hitCategories.length === 0) {
    throw new Error('terminal outcome categories and hit categories must not be empty.');
  }
  for (const hitCategory of terminalOutcome.hitCategories) {
    if (!HIT_CATEGORIES.has(hitCategory) || !categories.includes(hitCategory)) {
      throw new Error(`unsupported Batter Hits hit category ${hitCategory}.`);
    }
  }
  validateCategoryVector(terminalOutcome.leagueTarget, categories, 'terminalOutcome.leagueTarget');
  validateCategoryVector(terminalOutcome.unseenBatter, categories, 'terminalOutcome.unseenBatter');
  validateCategoryVector(terminalOutcome.unseenPitcher, categories, 'terminalOutcome.unseenPitcher');
  for (const [label, collection] of [
    ['terminalOutcome.batterOverall', terminalOutcome.batterOverall],
    ['terminalOutcome.pitcherAllowed', terminalOutcome.pitcherAllowed],
    ['terminalOutcome.leaguePlatoonByMatchup', terminalOutcome.leaguePlatoonByMatchup],
    ['terminalOutcome.batterSplitByMatchup', terminalOutcome.batterSplitByMatchup],
  ] as const) {
    for (const [key, vector] of Object.entries(collection)) {
      validateCategoryVector(vector, categories, `${label}.${key}`);
    }
  }
  for (const hand of VALID_HANDS) {
    validateProbability(completeCandidate.bullpenModel.handWeights[hand], `bullpen hand weight ${hand}`);
    validateCategoryVector(
      completeCandidate.bullpenModel.byHand[hand],
      categories,
      `bullpen vector ${hand}`,
    );
  }
  if (
    Math.abs(
      completeCandidate.bullpenModel.handWeights.L +
        completeCandidate.bullpenModel.handWeights.R -
        1,
    ) > TOLERANCE
  ) {
    throw new Error('bullpen hand weights must sum to one.');
  }
  return Object.freeze(artifacts);
}

function normalizeCategoryVector(
  raw: Readonly<Record<string, number>>,
  categories: readonly string[],
  label: string,
): CategoryVector {
  const values = categories.map((category) => raw[category] ?? Number.NaN);
  if (values.some((value) => !Number.isFinite(value) || value <= 0)) {
    throw new RangeError(`${label} contains invalid positive mass.`);
  }
  const total = values.reduce((sum, value) => sum + value, 0);
  const normalized = values.map((value) => value / total);
  validateProbabilityVector(normalized, label);
  const result: Record<string, number> = {};
  categories.forEach((category, index) => {
    const value = normalized[index];
    if (value === undefined) {
      throw new RangeError(`${label} is missing normalized category ${category}.`);
    }
    result[category] = value;
  });
  return Object.freeze(result);
}

function stableSoftmax(
  scores: Readonly<Record<string, number>>,
  categories: readonly string[],
): CategoryVector {
  const maximum = Math.max(...categories.map((category) => scores[category] ?? Number.NEGATIVE_INFINITY));
  return normalizeCategoryVector(
    Object.fromEntries(
      categories.map((category) => [category, Math.exp((scores[category] ?? Number.NEGATIVE_INFINITY) - maximum)]),
    ),
    categories,
    'runtime categorical softmax',
  );
}

function playerAdjustedTarget(
  batterOverall: CategoryVector,
  leagueMatchup: CategoryVector,
  leagueTarget: CategoryVector,
  categories: readonly string[],
): CategoryVector {
  return normalizeCategoryVector(
    Object.fromEntries(
      categories.map((category) => [
        category,
        (batterOverall[category] ?? 0) *
          ((leagueMatchup[category] ?? 0) / (leagueTarget[category] ?? Number.NaN)),
      ]),
    ),
    categories,
    'runtime player platoon target',
  );
}

function platoonBatterVector(
  terminal: FrozenTerminalPaOutcomeArtifact,
  batterId: number,
  batterSide: BatterHitsHand,
  pitcherHand: BatterHitsHand,
): CategoryVector {
  const categories = terminal.categories;
  const batterKey = String(batterId);
  const overall = terminal.batterOverall[batterKey] ?? terminal.unseenBatter;
  if (terminal.selectedPlatoonCandidate.platoonCoefficient === 0) return overall;
  const matchup = `${batterSide}-vs-${pitcherHand}`;
  const leagueMatchup = terminal.leaguePlatoonByMatchup[matchup];
  if (leagueMatchup === undefined) {
    throw new Error(`terminal outcome artifact is missing league platoon ${matchup}.`);
  }
  const split =
    terminal.batterSplitByMatchup[`${batterKey}|${matchup}`] ??
    playerAdjustedTarget(overall, leagueMatchup, terminal.leagueTarget, categories);
  const coefficient = terminal.selectedPlatoonCandidate.platoonCoefficient;
  return stableSoftmax(
    Object.fromEntries(
      categories.map((category) => [
        category,
        Math.log(overall[category] ?? Number.NaN) +
          coefficient *
            (Math.log(split[category] ?? Number.NaN) -
              Math.log(overall[category] ?? Number.NaN)),
      ]),
    ),
    categories,
  );
}

function coherentVector(
  terminal: FrozenTerminalPaOutcomeArtifact,
  batterVector: CategoryVector,
  pitcherVector: CategoryVector,
): CategoryVector {
  return stableSoftmax(
    Object.fromEntries(
      terminal.categories.map((category) => {
        const leagueLog = Math.log(terminal.leagueTarget[category] ?? Number.NaN);
        return [
          category,
          leagueLog +
            terminal.baseParameters.batterCoefficient *
              (Math.log(batterVector[category] ?? Number.NaN) - leagueLog) +
            terminal.baseParameters.pitcherAllowedCoefficient *
              (Math.log(pitcherVector[category] ?? Number.NaN) - leagueLog),
        ];
      }),
    ),
    terminal.categories,
  );
}

function hitProbability(
  vector: CategoryVector,
  hitCategories: readonly string[],
): number {
  return validateProbability(
    hitCategories.reduce((sum, category) => sum + (vector[category] ?? 0), 0),
    'Batter Hits per-opportunity probability',
  );
}

function terminalHitProbability(
  terminal: FrozenTerminalPaOutcomeArtifact,
  batterId: number,
  pitcherId: number,
  batterSide: BatterHitsHand,
  pitcherHand: BatterHitsHand,
): number {
  const batter = platoonBatterVector(terminal, batterId, batterSide, pitcherHand);
  const pitcher = terminal.pitcherAllowed[String(pitcherId)] ?? terminal.unseenPitcher;
  return hitProbability(
    coherentVector(terminal, batter, pitcher),
    terminal.hitCategories,
  );
}

function bullpenHitProbability(
  terminal: FrozenTerminalPaOutcomeArtifact,
  completeCandidate: FrozenCompleteBatterHitsCandidate,
  batterId: number,
  batterSide: BatterHitsHand,
  bullpenOverrideByHand?: Readonly<Record<BatterHitsHand, CategoryVector>>,
): number {
  let result = 0;
  for (const hand of VALID_HANDS) {
    const batter = platoonBatterVector(terminal, batterId, batterSide, hand);
    const pitcherVector =
      bullpenOverrideByHand?.[hand] ?? completeCandidate.bullpenModel.byHand[hand];
    validateCategoryVector(
      pitcherVector,
      terminal.categories,
      `bullpen pitcher vector `,
    );
    const coherent = coherentVector(terminal, batter, pitcherVector);
    result +=
      completeCandidate.bullpenModel.handWeights[hand] *
      hitProbability(coherent, terminal.hitCategories);
  }
  return validateProbability(result, 'generic bullpen hit probability');
}

function logit(value: number): number {
  const probability = Math.min(1 - 1e-12, Math.max(1e-12, value));
  return Math.log(probability / (1 - probability));
}

function logistic(value: number): number {
  if (value >= 0) {
    const exponential = Math.exp(-value);
    return 1 / (1 + exponential);
  }
  const exponential = Math.exp(value);
  return exponential / (1 + exponential);
}

function adjustForEnvironment(
  baseProbability: number,
  scenarioProbability: number,
  baselineProbability: number,
  coefficient: number,
): number {
  if (coefficient === 0) return baseProbability;
  return validateProbability(
    logistic(
      logit(baseProbability) +
        coefficient * (logit(scenarioProbability) - logit(baselineProbability)),
    ),
    'environment-adjusted hit probability',
  );
}

function erf(value: number): number {
  const sign = value < 0 ? -1 : 1;
  const x = Math.abs(value);
  const t = 1 / (1 + 0.3275911 * x);
  const polynomial =
    (((((1.061405429 * t - 1.453152027) * t + 1.421413741) * t -
      0.284496736) *
      t +
      0.254829592) *
      t);
  return sign * (1 - polynomial * Math.exp(-x * x));
}

function normalCdf(value: number): number {
  return 0.5 * (1 + erf(value / Math.sqrt(2)));
}

function discreteNormalTeamPaDistribution(
  mean: number,
  sigma: number,
): ProbabilityMassFunction {
  if (!Number.isFinite(mean) || mean <= 0 || !Number.isFinite(sigma) || sigma < 0) {
    throw new RangeError('shared scenario PA parameters are invalid.');
  }
  if (sigma === 0) {
    const values = Array<number>(MAXIMUM_TEAM_PA + 1).fill(0);
    values[Math.max(0, Math.min(MAXIMUM_TEAM_PA, Math.round(mean)))] = 1;
    return createProbabilityMassFunction(values, 'discrete normal team PA PMF');
  }
  const values = Array<number>(MAXIMUM_TEAM_PA + 1).fill(0);
  for (let count = 0; count < MAXIMUM_TEAM_PA; count += 1) {
    values[count] = Math.max(
      0,
      normalCdf((count + 0.5 - mean) / sigma) -
        normalCdf((count - 0.5 - mean) / sigma),
    );
  }
  values[MAXIMUM_TEAM_PA] = Math.max(
    0,
    1 - normalCdf((MAXIMUM_TEAM_PA - 0.5 - mean) / sigma),
  );
  const total = values.reduce((sum, value) => sum + value, 0);
  return createProbabilityMassFunction(
    values.map((value) => value / total),
    'discrete normal team PA PMF',
  );
}

function starterSurvival(
  starterBattersFaced: readonly number[],
  requiredTeamPaIndex: number,
): number {
  if (requiredTeamPaIndex <= 0) return 1;
  return validateProbability(
    starterBattersFaced
      .slice(requiredTeamPaIndex)
      .reduce((sum, probability) => sum + probability, 0),
    'opposing starter survival probability',
  );
}

function validateObservation(
  offer: NormalizedBatterHitsBoardOffer,
  observation: BatterHitsRuntimeObservation,
): void {
  assertLineupStatus(observation.lineupStatus);
  assertPositiveInteger(observation.providerGameId, 'runtime observation game ID');
  assertPositiveInteger(observation.providerPlayerId, 'runtime observation player ID');
  assertPositiveInteger(observation.providerTeamId, 'runtime observation team ID');
  assertOptionalVenue(observation.venue);
  assertPositiveInteger(
    observation.opposingStarterPitcherId,
    'runtime observation opposing starter ID',
  );
  assertPositiveInteger(
    observation.opposingStarterTeamId,
    'runtime observation opposing starter team ID',
  );
  assertLineupSlot(observation.lineupSlot);
  assertExact(observation.eligibilityProbability, 1, 'active lineup eligibilityProbability');
  assertSha256(observation.lineupSourceSnapshotSha256, 'lineup source snapshot SHA-256');
  assertTimestamp(observation.lineupSourceCapturedAt, 'lineup source capturedAt');
  assertExact(observation.providerGameId, offer.providerGameId, 'offer/runtime game ID');
  assertExact(observation.providerPlayerId, offer.providerPlayerId, 'offer/runtime player ID');
  assertExact(observation.providerTeamId, offer.providerTeamId, 'offer/runtime team ID');
  if (observation.opposingStarterTeamId === observation.providerTeamId) {
    throw new Error('opposing starter team must differ from the hitter team.');
  }
}

export function buildFrozenBatterHitsRuntimeDistribution(
  offer: NormalizedBatterHitsBoardOffer,
  observation: BatterHitsRuntimeObservation,
  rawArtifacts: FrozenBatterHitsProbabilityArtifacts,
  contextFactors?: BatterHitsRuntimeContextFactors,
): FrozenBatterHitsRuntimeDistribution {
  validateObservation(offer, observation);
  const artifacts = verifyFrozenBatterHitsProbabilityArtifacts(rawArtifacts);
  const retention = artifacts.starterRetention.conditionalRetentionByGroup[
    `slot:${observation.lineupSlot}`
  ];
  if (retention === undefined || retention.length === 0) {
    throw new Error(`starter retention is missing lineup slot ${observation.lineupSlot}.`);
  }
  validateUnitIntervalVector(retention, 'conditional named-hitter retention');
  if (Math.abs((retention[0] ?? Number.NaN) - 1) > TOLERANCE) {
    throw new Error('conditional named-hitter retention must start at one.');
  }
  const starterBaseHit = terminalHitProbability(
    artifacts.terminalOutcome,
    observation.providerPlayerId,
    observation.opposingStarterPitcherId,
    observation.batterSide,
    observation.opposingStarterHand,
  );
  const bullpenBaseHit = bullpenHitProbability(
    artifacts.terminalOutcome,
    artifacts.completeCandidate,
    observation.providerPlayerId,
    observation.batterSide,
    contextFactors?.bullpenOverrideByHand,
  );
  const baselineEnvironmentHit = artifacts.sharedEnvironment.scenarios.reduce(
    (sum, scenario) =>
      sum + scenario.weight * scenario[observation.teamSide].hitProbability,
    0,
  );
  const starterBfDistribution =
    artifacts.sharedEnvironment.starterBullpenTransition.bySide[
      observation.teamSide
    ];
  validateProbabilityVector(starterBfDistribution, 'starter batters-faced PMF');

  const scenarios = artifacts.sharedEnvironment.scenarios.map((scenario) => {
    const state = scenario[observation.teamSide];
    const teamPaDistribution = discreteNormalTeamPaDistribution(
      state.meanPa,
      state.sigmaPa,
    );
    const slotSurvival = deriveLineupSlotSurvivalFromTeamBattersFaced(
      teamPaDistribution,
      observation.lineupSlot,
    ).slice(0, retention.length);
    if (slotSurvival.length === 0) {
      throw new Error(
        `scenario ${scenario.scenarioIndex} has no reachable batting turns for lineup slot ${observation.lineupSlot}.`,
      );
    }
    const scenarioRetention = retention.slice(0, slotSurvival.length);
    const slotState = createHitterPASurvivalState({
      lineupSlot: observation.lineupSlot,
      rawSurvival: slotSurvival,
    });
    const slotCountDistribution = hitterOpportunityCountDistribution(slotState);
    const retentionState = createStarterRetentionState({
      scenarioSetId: artifacts.sharedEnvironment.artifactSha256,
      scenarioSetVersion: artifacts.sharedEnvironment.modelVersion,
      gameId: String(observation.providerGameId),
      scenarioId: String(scenario.scenarioIndex),
      teamId: String(observation.providerTeamId),
      lineupSlot: observation.lineupSlot,
      version: artifacts.starterRetention.modelVersion,
      conditionalRetention: scenarioRetention,
    });
    const opportunityCountDistribution =
      deriveNamedHitterOpportunityCountDistribution(
        slotCountDistribution,
        retentionState,
      );
    const perOpportunityHitProbabilities: number[] = [];
    for (
      let turn = 1;
      turn < opportunityCountDistribution.probabilities.length;
      turn += 1
    ) {
      const requiredTeamPaIndex =
        observation.lineupSlot + 9 * (turn - 1);
      const starterProbability = starterSurvival(
        starterBfDistribution,
        requiredTeamPaIndex,
      );
      const starterHit = adjustForEnvironment(
        starterBaseHit,
        state.hitProbability,
        baselineEnvironmentHit,
        artifacts.completeCandidate.environmentEffectPolicy.coefficient,
      );
      const bullpenHit = adjustForEnvironment(
        bullpenBaseHit,
        state.hitProbability,
        baselineEnvironmentHit,
        artifacts.completeCandidate.environmentEffectPolicy.coefficient,
      );
      perOpportunityHitProbabilities.push(
        validateProbability(
          starterProbability * starterHit +
            (1 - starterProbability) * bullpenHit,
          `scenario ${scenario.scenarioIndex} turn ${turn} hit probability`,
        ),
      );
    }
    const hitDistribution = mixBernoulliOutcomesOverCountDistribution(
      opportunityCountDistribution,
      perOpportunityHitProbabilities,
    );
    return Object.freeze({
      scenarioIndex: scenario.scenarioIndex,
      weight: scenario.weight,
      opportunityCountDistribution,
      perOpportunityHitProbabilities: Object.freeze(
        perOpportunityHitProbabilities,
      ),
      hitDistribution,
    });
  });

  return Object.freeze({
    distributionBuilderVersion: BATTER_HITS_RUNTIME_DISTRIBUTION_VERSION,
    opportunityDistribution: mixProbabilityMassFunctions(
      scenarios.map((scenario) => ({
        weight: scenario.weight,
        distribution: scenario.opportunityCountDistribution,
      })),
    ),
    statisticDistribution: mixProbabilityMassFunctions(
      scenarios.map((scenario) => ({
        weight: scenario.weight,
        distribution: scenario.hitDistribution,
      })),
    ),
    scenarios: Object.freeze(scenarios),
  });
}

export function createFrozenBatterHitsProbabilityCandidate(
  offer: NormalizedBatterHitsBoardOffer,
  observation: BatterHitsRuntimeObservation,
  artifacts: FrozenBatterHitsProbabilityArtifacts,
): FrozenBatterHitsProbabilityResult {
  const distribution = buildFrozenBatterHitsRuntimeDistribution(
    offer,
    observation,
    artifacts,
  );
  const statisticDistribution = validateProbabilityMassFunction(
    distribution.statisticDistribution,
    'frozen Batter Hits statistic distribution',
  );
  const settlement = settleDiscreteStatistic({
    statisticDistribution,
    eligibilityProbability: observation.eligibilityProbability,
    line: offer.line,
    selectedSide: offer.selectedSide,
  });
  const sharedScenarioReference = Object.freeze({
    providerGameId: offer.providerGameId,
    sharedEnvironmentModelVersion: artifacts.sharedEnvironment.modelVersion,
    sharedEnvironmentArtifactSha256:
      artifacts.sharedEnvironment.artifactSha256,
    completeCandidateArtifactSha256:
      artifacts.completeCandidate.artifactSha256,
  });
  const details: JsonObject = Object.freeze({
    offerType: offer.offerType,
    providerMarketKey: offer.providerMarketKey,
    providerBookmakerKey: offer.providerBookmakerKey,
    providerEventId: offer.providerEventId,
    providerGameId: offer.providerGameId,
    providerPlayerId: offer.providerPlayerId,
    providerTeamId: offer.providerTeamId,
    rawSide: offer.rawSide,
    sourceSnapshotSha256: offer.sourceSnapshotSha256,
    lineupStatus: observation.lineupStatus,
    lineupSlot: observation.lineupSlot,
    batterSide: observation.batterSide,
    opposingStarterPitcherId: observation.opposingStarterPitcherId,
    opposingStarterTeamId: observation.opposingStarterTeamId,
    opposingStarterHand: observation.opposingStarterHand,
    lineupSourceSnapshotSha256: observation.lineupSourceSnapshotSha256,
    runtimeManifestArtifactSha256: artifacts.runtimeManifest.artifactSha256,
    completeCandidateArtifactSha256:
      artifacts.completeCandidate.artifactSha256,
    sharedEnvironmentArtifactSha256:
      artifacts.sharedEnvironment.artifactSha256,
    starterRetentionArtifactSha256:
      artifacts.starterRetention.artifactSha256,
    terminalOutcomeArtifactSha256: artifacts.terminalOutcome.artifactSha256,
  });
  const featureValues = Object.freeze({
    [BATTER_HITS_FEATURE_DATA_FIELD]: details,
  }) as FrozenBatterHitsFeatureValues;
  const candidate: FrozenBatterHitsProbabilityCandidate = Object.freeze({
    eventId: offer.providerEventId,
    gameId: String(offer.providerGameId),
    playerId: String(offer.providerPlayerId),
    playerName: offer.playerName,
    baseMarketKey: BATTER_HITS_MARKET_KEY,
    marketLabel: 'Batter Hits',
    line: settlement.line,
    selectedSide: settlement.selectedSide,
    settlementStatistic: 'hits',
    eligibilityProbability: settlement.eligibilityProbability,
    statisticDistribution,
    pWin: settlement.winProbability,
    pLoss: settlement.lossProbability,
    pVoid: settlement.voidProbability,
    pWinGivenGrades: settlement.winProbabilityGivenGrades,
    modelVersion: artifacts.completeCandidate.modelVersion,
    distributionBuilderVersion: distribution.distributionBuilderVersion,
    settlementRuleVersion: artifacts.runtimeManifest.settlementVersion,
    sharedScenarioReference,
    featureData: Object.freeze({
      featureId: BATTER_HITS_FEATURE_ID,
      schemaVersion: 1,
      values: featureValues,
    }),
  });
  return Object.freeze({
    distribution,
    candidate,
    productionEnabled: false,
  });
}
