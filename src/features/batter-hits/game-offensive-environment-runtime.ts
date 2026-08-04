import {
  mixProbabilityMassFunctions,
  validateProbabilityVector,
} from '../../core/index.js';
import {
  resolveM8_5GameOffensiveEnvironmentV1,
  type M8_5GameOffensiveEnvironmentResolutionV1,
  type ResolveM8_5GameOffensiveEnvironmentV1Input,
} from './game-offensive-environment.js';
import type { NormalizedBatterHitsBoardOffer } from './normalized-board-offer.js';
import {
  buildFrozenBatterHitsRuntimeDistribution,
  type BatterHitsRuntimeContextFactors,
  type BatterHitsRuntimeObservation,
  type FrozenBatterHitsProbabilityArtifacts,
  type FrozenBatterHitsRuntimeDistribution,
} from './runtime-probability.js';

export interface BuildM8_5GameOffensiveEnvironmentRuntimeV1Input {
  readonly offer: NormalizedBatterHitsBoardOffer;
  readonly observation: BatterHitsRuntimeObservation;
  readonly artifacts: FrozenBatterHitsProbabilityArtifacts;
  readonly rawModelArtifact: unknown;
  readonly resolutionInput: ResolveM8_5GameOffensiveEnvironmentV1Input;
  readonly contextFactors?: BatterHitsRuntimeContextFactors;
}

export interface M8_5GameOffensiveEnvironmentRuntimeV1 {
  readonly productionEnabled: false;
  readonly resolution: Readonly<M8_5GameOffensiveEnvironmentResolutionV1>;
  readonly distribution: FrozenBatterHitsRuntimeDistribution;
}

function assertExact(
  value: unknown,
  expected: unknown,
  label: string,
): void {
  if (value !== expected) {
    throw new Error(`${label} must equal ${String(expected)}.`);
  }
}

function resolvedWeights(
  resolution: Readonly<M8_5GameOffensiveEnvironmentResolutionV1>,
  artifacts: FrozenBatterHitsProbabilityArtifacts,
  observation: BatterHitsRuntimeObservation,
): readonly number[] {
  assertExact(
    resolution.gameId,
    String(observation.providerGameId),
    'game offensive-environment runtime game ID',
  );
  assertExact(
    resolution.sourceSharedEnvironmentModelVersion,
    artifacts.sharedEnvironment.modelVersion,
    'game offensive-environment source shared model version',
  );
  assertExact(
    resolution.sourceSharedEnvironmentArtifactSha256,
    artifacts.sharedEnvironment.artifactSha256,
    'game offensive-environment source shared artifact SHA-256',
  );

  if (
    resolution.scenarioWeights.length !==
    artifacts.sharedEnvironment.scenarios.length
  ) {
    throw new Error(
      'game offensive-environment weights must cover every shared scenario exactly once.',
    );
  }

  const weights = resolution.scenarioWeights.map((entry, index) => {
    const scenario = artifacts.sharedEnvironment.scenarios[index];
    if (scenario === undefined) {
      throw new Error(`shared scenario ${index} is missing.`);
    }
    assertExact(
      entry.scenarioId,
      `shared-environment:${scenario.scenarioIndex}`,
      `game offensive-environment scenario identity ${index}`,
    );
    return entry.weight;
  });
  validateProbabilityVector(
    weights,
    'game offensive-environment shared scenario weights',
  );
  return Object.freeze(weights);
}

export function buildM8_5GameOffensiveEnvironmentRuntimeV1(
  input: Readonly<BuildM8_5GameOffensiveEnvironmentRuntimeV1Input>,
): M8_5GameOffensiveEnvironmentRuntimeV1 {
  const resolution = resolveM8_5GameOffensiveEnvironmentV1(
    input.rawModelArtifact,
    input.resolutionInput,
  );
  const weights = resolvedWeights(
    resolution,
    input.artifacts,
    input.observation,
  );
  const baseScenarioDistribution = buildFrozenBatterHitsRuntimeDistribution(
    input.offer,
    input.observation,
    input.artifacts,
    input.contextFactors,
  );

  const scenarios = Object.freeze(
    baseScenarioDistribution.scenarios.map((scenario, index) =>
      Object.freeze({
        ...scenario,
        weight: weights[index]!,
      }),
    ),
  );

  // Replacing only the mixture weights preserves every shared-scenario
  // definition while jointly moving the opportunity and Hits mixtures.
  const distribution = Object.freeze({
    distributionBuilderVersion:
      baseScenarioDistribution.distributionBuilderVersion,
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
    scenarios,
  });

  return Object.freeze({
    productionEnabled: false as const,
    resolution,
    distribution,
  });
}
