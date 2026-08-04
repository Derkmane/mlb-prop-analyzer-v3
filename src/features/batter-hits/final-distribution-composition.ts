import { validateProbabilityVector } from '../../core/index.js';
import { TERMINAL_PA_CATEGORIES } from '../../domain/terminal-pa.js';
import {
  createM8BatterHitsBaseDistribution,
  verifyM8BatterHitsBaseDistribution,
  type M8BatterHitsBaseDistributionV1,
} from './base-evaluation.js';
import {
  createDisabledM8_5BatterHitsFactorArtifactV1,
  verifyM8_5BatterHitsFactorArtifactV1,
  type M8_5BatterHitsFactorArtifactV1,
} from './context-factor-contract.js';
import {
  createM8_5FinalDistributionV1,
  type M8_5FactorRuntimeDecisionV1,
  type M8_5FinalDistributionV1,
} from './final-evaluation.js';
import {
  verifyM8_5GameOffensiveEnvironmentModelArtifactV1,
  type M8_5GameOffensiveEnvironmentResolutionV1,
  type ResolveM8_5GameOffensiveEnvironmentV1Input,
} from './game-offensive-environment.js';
import { buildM8_5GameOffensiveEnvironmentRuntimeV1 } from './game-offensive-environment-runtime.js';
import type { NormalizedBatterHitsBoardOffer } from './normalized-board-offer.js';
import { verifyM8_5ParkFactorArtifactV1 } from './park-transformation.js';
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

export const M8_5_TIMES_THROUGH_ORDER_EVALUATION_SHA256 =
  '88dcfe26dde927cad3c86cb7d477f9082aadd0862e0c77ac525d730e7aaac710' as const;

export const M8_5_TIMES_THROUGH_ORDER_IDENTITY_REASON =
  'Current-season fixed and expanding walk-forward validation retained identity; no validated times-through-order signal is applied.' as const;

export const M8_5_PARK_NOT_APPLIED_REASON =
  'Validated fitting evidence is preserved, but the approximately 0.0004-nat effect does not justify a unique runtime venue dependency; no runtime park resolution is wired.' as const;

export const M8_5_BATTER_HITS_VALIDATED_COMPOSITION_ORDER = Object.freeze([
  'gameSpecificOffensiveEnvironment',
  'teamSpecificBullpen',
  'timesThroughOrder',
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
  readonly timesThroughOrderArtifact: M8_5BatterHitsFactorArtifactV1;
  readonly parkArtifact: ReturnType<typeof verifyM8_5ParkFactorArtifactV1>;
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

function evidenceSha256(
  artifact: M8_5BatterHitsFactorArtifactV1,
): string {
  const value = artifact.validationEvidence?.evidenceArtifactSha256;
  if (value === undefined) {
    throw new Error(
      `validated factor ${artifact.factorKey} is missing evidence SHA-256.`,
    );
  }
  return value;
}

function appliedDecision(
  artifact: M8_5BatterHitsFactorArtifactV1,
): M8_5FactorRuntimeDecisionV1 {
  return Object.freeze({
    factorKey: artifact.factorKey,
    runtimeDisposition: 'applied' as const,
    reason: null,
    evidenceSha256: evidenceSha256(artifact),
  });
}

export function buildM8_5ValidatedFinalDistributionV1(
  input: Readonly<BuildM8_5ValidatedFinalDistributionV1Input>,
): M8_5ValidatedFinalDistributionCompositionV1 {
  const sourceBaseDistribution = verifiedBaseParity(input);

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
  const timesThroughOrderArtifact =
    createDisabledM8_5BatterHitsFactorArtifactV1({
      factorKey: 'timesThroughOrder',
      requiredInputs: ['starter-exposure-index'],
      sourceEvidenceVersion:
        `m8-5-times-through-order-evaluation-v1:${M8_5_TIMES_THROUGH_ORDER_EVALUATION_SHA256}`,
    });

  // The only baseball effects applied to D_final are the already-validated
  // game-specific shared-scenario weights and team bullpen replacement.
  // TTO is a validated identity decision. Park is verified as preserved
  // evidence but is deliberately not resolved or passed to runtime.
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
    },
  });

  const gameEnvironmentArtifact = gameRuntime.resolution.factorArtifact;
  const parkTypedArtifact = parkArtifact.typedFactorArtifact;
  const factorArtifacts = Object.freeze([
    gameEnvironmentArtifact,
    teamBullpenArtifact,
    timesThroughOrderArtifact,
    parkTypedArtifact,
  ]);
  const factorRuntimeDecisions = Object.freeze([
    appliedDecision(gameEnvironmentArtifact),
    appliedDecision(teamBullpenArtifact),
    Object.freeze({
      factorKey: 'timesThroughOrder' as const,
      runtimeDisposition: 'identity' as const,
      reason: M8_5_TIMES_THROUGH_ORDER_IDENTITY_REASON,
      evidenceSha256: M8_5_TIMES_THROUGH_ORDER_EVALUATION_SHA256,
    }),
    Object.freeze({
      factorKey: 'park' as const,
      runtimeDisposition: 'not-applied' as const,
      reason: M8_5_PARK_NOT_APPLIED_REASON,
      evidenceSha256: evidenceSha256(parkTypedArtifact),
    }),
  ]);

  const finalDistribution = createM8_5FinalDistributionV1({
    sourceBaseDistribution,
    dFinal: gameRuntime.distribution,
    contextModelVersion: M8_5_BATTER_HITS_CONTEXT_MODEL_VERSION,
    factorArtifacts,
    factorRuntimeDecisions,
  });

  return Object.freeze({
    productionEnabled: false as const,
    contextModelVersion: M8_5_BATTER_HITS_CONTEXT_MODEL_VERSION,
    applicationOrder: M8_5_BATTER_HITS_VALIDATED_COMPOSITION_ORDER,
    gameEnvironmentResolution: gameRuntime.resolution,
    teamBullpenResolutions: bullpenResolutions,
    timesThroughOrderArtifact,
    parkArtifact,
    finalDistribution,
  });
}
