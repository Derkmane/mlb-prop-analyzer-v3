import { validateProbabilityVector } from '../../core/index.js';
import { TERMINAL_PA_CATEGORIES } from '../../domain/terminal-pa.js';
import {
  createM8BatterHitsBaseDistribution,
  verifyM8BatterHitsBaseDistribution,
  type M8BatterHitsBaseDistributionV1,
} from './base-evaluation.js';
import {
  verifyM8_5BatterHitsFactorArtifactV1,
  type M8_5BatterHitsFactorArtifactV1,
} from './context-factor-contract.js';
import {
  createM8_5FinalDistributionV1,
  type M8_5FinalDistributionV1,
} from './final-evaluation.js';
import {
  verifyM8_5GameOffensiveEnvironmentModelArtifactV1,
  type M8_5GameOffensiveEnvironmentResolutionV1,
  type ResolveM8_5GameOffensiveEnvironmentV1Input,
} from './game-offensive-environment.js';
import { buildM8_5GameOffensiveEnvironmentRuntimeV1 } from './game-offensive-environment-runtime.js';
import type { NormalizedBatterHitsBoardOffer } from './normalized-board-offer.js';
import {
  resolveM8_5ParkTransformationV1,
  verifyM8_5ParkFactorArtifactV1,
  type M8_5ParkTransformationResolutionV1,
} from './park-transformation.js';
import { projectM8_5ParkMultipliersToModeledCategoriesV1 } from './park-runtime-context.js';
import {
  resolveM8_5TeamBullpenOutcomeV1,
  type M8_5BullpenPitcherHand,
  type M8_5TeamBullpenOutcomeResolutionV1,
} from './team-bullpen-outcome.js';
import type {
  BatterHitsRuntimeObservation,
  FrozenBatterHitsProbabilityArtifacts,
} from './runtime-probability.js';

export const M8_5_BATTER_HITS_CONTEXT_MODEL_VERSION =
  'm8-5-batter-hits-context-v1' as const;

export const M8_5_BATTER_HITS_VALIDATED_COMPOSITION_ORDER = Object.freeze([
  'gameSpecificOffensiveEnvironment',
  'teamSpecificBullpen',
  'park',
] as const);

type ModeledCategoryVector = Readonly<Record<string, number>>;

export interface BuildM8_5ValidatedFinalDistributionV1Input {
  readonly sourceBaseDistribution: M8BatterHitsBaseDistributionV1;
  readonly offer: NormalizedBatterHitsBoardOffer;
  readonly observation: BatterHitsRuntimeObservation;
  readonly artifacts: FrozenBatterHitsProbabilityArtifacts;
  readonly rawGameEnvironmentModelArtifact: unknown;
  readonly gameEnvironmentResolutionInput:
    ResolveM8_5GameOffensiveEnvironmentV1Input;
  readonly rawTeamBullpenFactorArtifact: unknown;
  readonly rawParkFactorArtifact: unknown;
}

export interface M8_5ValidatedFinalDistributionCompositionV1 {
  readonly productionEnabled: false;
  readonly contextModelVersion:
    typeof M8_5_BATTER_HITS_CONTEXT_MODEL_VERSION;
  readonly applicationOrder:
    typeof M8_5_BATTER_HITS_VALIDATED_COMPOSITION_ORDER;
  readonly gameEnvironmentResolution:
    Readonly<M8_5GameOffensiveEnvironmentResolutionV1>;
  readonly teamBullpenResolutions: Readonly<
    Record<M8_5BullpenPitcherHand, M8_5TeamBullpenOutcomeResolutionV1>
  >;
  readonly parkResolution: Readonly<M8_5ParkTransformationResolutionV1>;
  readonly finalDistribution: M8_5FinalDistributionV1;
}

const CANONICAL_CATEGORY_SET = new Set<string>(TERMINAL_PA_CATEGORIES);

function assertExact(
  value: unknown,
  expected: unknown,
  label: string,
): void {
  if (value !== expected) {
    throw new Error(`${label} must equal ${String(expected)}.`);
  }
}

function verifiedBaseParity(
  input: Readonly<BuildM8_5ValidatedFinalDistributionV1Input>,
): M8BatterHitsBaseDistributionV1 {
  const sourceBaseDistribution = verifyM8BatterHitsBaseDistribution(
    input.sourceBaseDistribution,
  );
  const rebuiltBaseDistribution = createM8BatterHitsBaseDistribution(
    input.offer,
    input.observation,
    input.artifacts,
    sourceBaseDistribution.evaluatedAt,
  );
  assertExact(
    rebuiltBaseDistribution.baseDistributionSha256,
    sourceBaseDistribution.baseDistributionSha256,
    'M8.5 composition source D_base SHA-256',
  );
  assertExact(
    rebuiltBaseDistribution.sharedScenarioIdentity,
    sourceBaseDistribution.sharedScenarioIdentity,
    'M8.5 composition shared scenario identity',
  );
  return sourceBaseDistribution;
}

function validatedTeamBullpenArtifact(
  rawArtifact: unknown,
): M8_5BatterHitsFactorArtifactV1 {
  const artifact = verifyM8_5BatterHitsFactorArtifactV1(rawArtifact);
  if (
    artifact.factorKey !== 'teamSpecificBullpen' ||
    artifact.status !== 'validated'
  ) {
    throw new Error(
      'M8.5 final composition requires the validated teamSpecificBullpen factor.',
    );
  }
  if (
    artifact.applicationStages.length !== 1 ||
    artifact.applicationStages[0] !==
      'terminal-outcome-before-statistic-distribution'
  ) {
    throw new Error(
      'teamSpecificBullpen must apply at terminal-outcome-before-statistic-distribution.',
    );
  }
  return artifact;
}

function validateModeledCategories(
  modeledCategories: readonly string[],
): ReadonlySet<string> {
  if (modeledCategories.length === 0) {
    throw new Error('modeled terminal categories must not be empty.');
  }
  const modeled = new Set<string>();
  for (const category of modeledCategories) {
    if (!CANONICAL_CATEGORY_SET.has(category)) {
      throw new Error(`modeled terminal category ${category} is not canonical.`);
    }
    if (modeled.has(category)) {
      throw new Error(`duplicate modeled terminal category ${category}.`);
    }
    modeled.add(category);
  }
  return modeled;
}

function projectTeamBullpenResolution(
  resolution: M8_5TeamBullpenOutcomeResolutionV1,
  modeledCategories: readonly string[],
): ModeledCategoryVector {
  if (resolution.status !== 'validated') {
    throw new Error('team-specific bullpen resolution must be validated.');
  }
  const modeled = validateModeledCategories(modeledCategories);
  const byCategory = new Map<string, number>();
  for (const entry of resolution.categoryProbabilities) {
    if (!CANONICAL_CATEGORY_SET.has(entry.category)) {
      throw new Error(
        `team-specific bullpen resolution contains unknown category ${entry.category}.`,
      );
    }
    if (byCategory.has(entry.category)) {
      throw new Error(
        `duplicate team-specific bullpen category ${entry.category}.`,
      );
    }
    byCategory.set(entry.category, entry.probability);
  }
  if (byCategory.size !== TERMINAL_PA_CATEGORIES.length) {
    throw new Error(
      'team-specific bullpen resolution must contain every canonical terminal category.',
    );
  }
  for (const category of TERMINAL_PA_CATEGORIES) {
    const probability = byCategory.get(category);
    if (probability === undefined) {
      throw new Error(
        `team-specific bullpen resolution is missing category ${category}.`,
      );
    }
    if (!modeled.has(category) && probability !== 0) {
      throw new Error(
        `team-specific bullpen effect on omitted category ${category} must be exactly zero.`,
      );
    }
  }

  const values = modeledCategories.map(
    (category) => byCategory.get(category) ?? Number.NaN,
  );
  validateProbabilityVector(
    values,
    `team-specific bullpen ${resolution.bullpenPitcherHand} vector`,
  );
  return Object.freeze(
    Object.fromEntries(
      modeledCategories.map((category, index) => [category, values[index]!]),
    ),
  );
}

function teamBullpenResolutions(
  artifact: M8_5BatterHitsFactorArtifactV1,
  opposingPitchingTeamId: number,
): Readonly<
  Record<M8_5BullpenPitcherHand, M8_5TeamBullpenOutcomeResolutionV1>
> {
  return Object.freeze({
    L: resolveM8_5TeamBullpenOutcomeV1(artifact, {
      opposingPitchingTeamId,
      bullpenPitcherHand: 'L',
    }),
    R: resolveM8_5TeamBullpenOutcomeV1(artifact, {
      opposingPitchingTeamId,
      bullpenPitcherHand: 'R',
    }),
  });
}

export function buildM8_5ValidatedFinalDistributionV1(
  input: Readonly<BuildM8_5ValidatedFinalDistributionV1Input>,
): M8_5ValidatedFinalDistributionCompositionV1 {
  const sourceBaseDistribution = verifiedBaseParity(input);

  // Validate the shared-scenario factor first, before resolving either
  // terminal-outcome factor, matching Canonical Math Spec Section 11.2.
  const gameEnvironmentModel =
    verifyM8_5GameOffensiveEnvironmentModelArtifactV1(
      input.rawGameEnvironmentModelArtifact,
    );

  const teamBullpenArtifact = validatedTeamBullpenArtifact(
    input.rawTeamBullpenFactorArtifact,
  );
  const bullpenResolutions = teamBullpenResolutions(
    teamBullpenArtifact,
    input.observation.opposingStarterTeamId,
  );
  const bullpenOverrideByHand = Object.freeze({
    L: projectTeamBullpenResolution(
      bullpenResolutions.L,
      input.artifacts.terminalOutcome.categories,
    ),
    R: projectTeamBullpenResolution(
      bullpenResolutions.R,
      input.artifacts.terminalOutcome.categories,
    ),
  });

  const parkArtifact = verifyM8_5ParkFactorArtifactV1(
    input.rawParkFactorArtifact,
  );
  const parkResolution = resolveM8_5ParkTransformationV1(parkArtifact, {
    venue: input.observation.venue,
    batterHand: input.observation.batterSide,
  });
  const parkMultipliersByCategory =
    projectM8_5ParkMultipliersToModeledCategoriesV1(
      parkResolution,
      input.artifacts.terminalOutcome.categories,
    );

  // The runtime builder applies the bullpen replacement as the pitcher
  // input to coherentVector, then applies park to coherentVector output.
  // The game wrapper resolves and installs the shared-scenario weights
  // before recomputing the final opportunity and Hits mixtures.
  const gameRuntime = buildM8_5GameOffensiveEnvironmentRuntimeV1({
    offer: input.offer,
    observation: input.observation,
    artifacts: input.artifacts,
    rawModelArtifact: gameEnvironmentModel,
    resolutionInput: input.gameEnvironmentResolutionInput,
    contextFactors: {
      bullpenOverrideByHand,
      teamBullpenFactorModelVersion: teamBullpenArtifact.modelVersion,
      teamBullpenFactorArtifactSha256:
        teamBullpenArtifact.artifactSha256,
      parkMultipliersByCategory,
    },
  });

  const finalDistribution = createM8_5FinalDistributionV1({
    sourceBaseDistribution,
    dFinal: gameRuntime.distribution,
    contextModelVersion: M8_5_BATTER_HITS_CONTEXT_MODEL_VERSION,
    factorArtifacts: [
      gameRuntime.resolution.factorArtifact,
      teamBullpenArtifact,
      parkArtifact.typedFactorArtifact,
    ],
  });

  return Object.freeze({
    productionEnabled: false as const,
    contextModelVersion: M8_5_BATTER_HITS_CONTEXT_MODEL_VERSION,
    applicationOrder: M8_5_BATTER_HITS_VALIDATED_COMPOSITION_ORDER,
    gameEnvironmentResolution: gameRuntime.resolution,
    teamBullpenResolutions: bullpenResolutions,
    parkResolution,
    finalDistribution,
  });
}
