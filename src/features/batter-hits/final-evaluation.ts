import { createHash } from 'node:crypto';

import {
  settleDiscreteStatistic,
  validateProbability,
  validateProbabilityMassFunction,
  validateProbabilityVector,
} from '../../core/index.js';
import {
  settleM8BatterHitsBaseOffer,
  verifyM8BatterHitsBaseDistribution,
  type M8BatterHitsBaseDistributionV1,
  type M8BatterHitsBaseEvaluationV1,
} from './base-evaluation.js';
import {
  M8_5_BATTER_HITS_FACTOR_KEYS,
  verifyM8_5BatterHitsFactorArtifactV1,
  type M8_5BatterHitsApplicationStage,
  type M8_5BatterHitsFactorArtifactV1,
  type M8_5BatterHitsFactorKey,
} from './context-factor-contract.js';
import type { NormalizedBatterHitsBoardOffer } from './normalized-board-offer.js';
import type { FrozenBatterHitsRuntimeDistribution } from './runtime-probability.js';

export const M8_5_BATTER_HITS_FINAL_DISTRIBUTION_CONTRACT =
  'm8-5-batter-hits-final-distribution-v1' as const;
export const M8_5_BATTER_HITS_FINAL_EVALUATION_CONTRACT =
  'm8-5-batter-hits-final-evaluation-v1' as const;

const VALID_APPLICATION_STAGES = new Set<M8_5BatterHitsApplicationStage>([
  'identity',
  'terminal-outcome-before-statistic-distribution',
  'shared-scenario-before-statistic-distribution',
  'opportunity-before-count-conversion',
  'workload-before-shared-scenario-mixing',
]);
const VALID_RUNTIME_DISPOSITIONS = new Set<M8_5FactorRuntimeDispositionV1>([
  'applied',
  'identity',
  'not-applied',
]);

export type M8_5FactorRuntimeDispositionV1 =
  | 'applied'
  | 'identity'
  | 'not-applied';

export interface M8_5AppliedFactorReferenceV1 {
  readonly factorKey: M8_5BatterHitsFactorKey;
  readonly modelVersion: string;
  readonly artifactSha256: string;
  readonly applicationStages: readonly M8_5BatterHitsApplicationStage[];
}

export interface M8_5FactorRuntimeDecisionV1 {
  readonly factorKey: M8_5BatterHitsFactorKey;
  readonly runtimeDisposition: M8_5FactorRuntimeDispositionV1;
  readonly reason: string | null;
  readonly evidenceSha256: string;
}

export interface M8_5FinalDistributionV1 {
  readonly finalDistributionContract:
    typeof M8_5_BATTER_HITS_FINAL_DISTRIBUTION_CONTRACT;
  readonly productionEnabled: false;
  readonly hardDiscoveryFilterEnabled: false;
  readonly sourceBaseDistribution: M8BatterHitsBaseDistributionV1;
  readonly sourceBaseDistributionSha256: string;
  readonly sharedScenarioIdentity: string;
  readonly contextModelVersion: string;
  readonly factorReferences: readonly M8_5AppliedFactorReferenceV1[];
  readonly factorRuntimeDecisions: readonly M8_5FactorRuntimeDecisionV1[];
  readonly settlementRuleVersion: string;
  readonly dFinal: FrozenBatterHitsRuntimeDistribution;
  readonly finalDistributionSha256: string;
}

export interface M8_5FinalEvaluationProbabilitiesV1 {
  readonly pWin: number;
  readonly pLoss: number;
  readonly pVoid: number;
  readonly pBase: number | null;
  readonly pFinal: number | null;
  readonly contextProbabilityDelta: number | null;
}

export interface M8_5FinalEvaluationV1 {
  readonly finalEvaluationContract:
    typeof M8_5_BATTER_HITS_FINAL_EVALUATION_CONTRACT;
  readonly productionEnabled: false;
  readonly hardDiscoveryFilterEnabled: false;
  readonly sourceM8Evaluation: M8BatterHitsBaseEvaluationV1;
  readonly sourceM8EvaluationSha256: string;
  readonly baseDistributionSha256: string;
  readonly sharedScenarioIdentity: string;
  readonly finalDistribution: M8_5FinalDistributionV1;
  readonly finalDistributionSha256: string;
  readonly dBase: FrozenBatterHitsRuntimeDistribution;
  readonly dFinal: FrozenBatterHitsRuntimeDistribution;
  readonly offer: Readonly<NormalizedBatterHitsBoardOffer>;
  readonly contextModelVersion: string;
  readonly factorReferences: readonly M8_5AppliedFactorReferenceV1[];
  readonly factorRuntimeDecisions: readonly M8_5FactorRuntimeDecisionV1[];
  readonly settlementRuleVersion: string;
  readonly probabilities: Readonly<M8_5FinalEvaluationProbabilitiesV1>;
  readonly finalEvaluationSha256: string;
}

export interface CreateM8_5FinalDistributionV1Input {
  readonly sourceBaseDistribution: M8BatterHitsBaseDistributionV1;
  readonly dFinal: FrozenBatterHitsRuntimeDistribution;
  readonly contextModelVersion: string;
  readonly factorArtifacts: readonly M8_5BatterHitsFactorArtifactV1[];
  readonly factorRuntimeDecisions?:
    | readonly M8_5FactorRuntimeDecisionV1[]
    | undefined;
}

export interface SettleM8_5FinalOfferV1Input {
  readonly sourceM8Evaluation: M8BatterHitsBaseEvaluationV1;
  readonly finalDistribution: M8_5FinalDistributionV1;
}

export interface CreateM8_5FinalEvaluationV1Input {
  readonly sourceM8Evaluation: M8BatterHitsBaseEvaluationV1;
  readonly dFinal: FrozenBatterHitsRuntimeDistribution;
  readonly contextModelVersion: string;
  readonly factorArtifacts: readonly M8_5BatterHitsFactorArtifactV1[];
  readonly factorRuntimeDecisions?: readonly M8_5FactorRuntimeDecisionV1[];
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
  throw new TypeError('M8.5 final evaluation values must be JSON-compatible.');
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

function nonEmptyString(value: unknown, label: string): string {
  if (
    typeof value !== 'string' ||
    value.length === 0 ||
    value.trim() !== value
  ) {
    throw new TypeError(`${label} must be a non-empty trimmed string.`);
  }
  return value;
}

function optionalReason(value: unknown, label: string): string | null {
  if (value === null) return null;
  return nonEmptyString(value, label);
}

function assertSha256(value: unknown, label: string): string {
  const text = nonEmptyString(value, label);
  if (!/^[a-f0-9]{64}$/u.test(text)) {
    throw new Error(`${label} must be a lowercase SHA-256 value.`);
  }
  return text;
}

function assertExact(value: unknown, expected: unknown, label: string): void {
  if (value !== expected) {
    throw new Error(`${label} must equal ${String(expected)}.`);
  }
}

function verifySourceM8Evaluation(
  rawEvaluation: M8BatterHitsBaseEvaluationV1,
): M8BatterHitsBaseEvaluationV1 {
  const rebuilt = settleM8BatterHitsBaseOffer(
    rawEvaluation.baseDistribution,
    rawEvaluation.offer,
  );
  if (stableJson(rawEvaluation) !== stableJson(rebuilt)) {
    throw new Error(
      'source M8 evaluation does not match its canonical hash and settlement.',
    );
  }
  return rebuilt;
}

function factorOrder(factorKey: M8_5BatterHitsFactorKey): number {
  const index = M8_5_BATTER_HITS_FACTOR_KEYS.indexOf(factorKey);
  if (index < 0) {
    throw new Error(`unsupported M8.5 factor key ${factorKey}.`);
  }
  return index;
}

function verifiedArtifacts(
  rawArtifacts: readonly M8_5BatterHitsFactorArtifactV1[],
): readonly M8_5BatterHitsFactorArtifactV1[] {
  if (!Array.isArray(rawArtifacts) || rawArtifacts.length === 0) {
    throw new Error(
      'M8.5 final distribution requires at least one factor artifact.',
    );
  }
  const seen = new Set<M8_5BatterHitsFactorKey>();
  const artifacts = rawArtifacts.map((rawArtifact) => {
    const artifact = verifyM8_5BatterHitsFactorArtifactV1(rawArtifact);
    if (seen.has(artifact.factorKey)) {
      throw new Error(`duplicate M8.5 factor ${artifact.factorKey}.`);
    }
    seen.add(artifact.factorKey);
    return artifact;
  });
  artifacts.sort(
    (left, right) => factorOrder(left.factorKey) - factorOrder(right.factorKey),
  );
  return Object.freeze(artifacts);
}

function factorReferencesFromArtifacts(
  artifacts: readonly M8_5BatterHitsFactorArtifactV1[],
): readonly M8_5AppliedFactorReferenceV1[] {
  return Object.freeze(
    artifacts.map((artifact) =>
      Object.freeze({
        factorKey: artifact.factorKey,
        modelVersion: artifact.modelVersion,
        artifactSha256: artifact.artifactSha256,
        applicationStages: Object.freeze([...artifact.applicationStages]),
      }),
    ),
  );
}

function defaultEvidenceSha256(
  artifact: M8_5BatterHitsFactorArtifactV1,
): string {
  return (
    artifact.validationEvidence?.evidenceArtifactSha256 ??
    artifact.artifactSha256
  );
}

function validateRuntimeDecisionForArtifact(
  artifact: M8_5BatterHitsFactorArtifactV1,
  rawDecision: M8_5FactorRuntimeDecisionV1,
): M8_5FactorRuntimeDecisionV1 {
  assertExact(
    rawDecision.factorKey,
    artifact.factorKey,
    `runtime decision factor key for ${artifact.factorKey}`,
  );
  if (!VALID_RUNTIME_DISPOSITIONS.has(rawDecision.runtimeDisposition)) {
    throw new Error(
      `runtime decision for ${artifact.factorKey} has an unsupported disposition.`,
    );
  }
  const reason = optionalReason(
    rawDecision.reason,
    `runtime decision reason for ${artifact.factorKey}`,
  );
  const evidenceSha256 = assertSha256(
    rawDecision.evidenceSha256,
    `runtime decision evidence SHA-256 for ${artifact.factorKey}`,
  );
  const identityOnly =
    artifact.effects.length === 1 && artifact.effects[0]?.kind === 'identity';

  if (rawDecision.runtimeDisposition === 'applied') {
    if (artifact.status !== 'validated' || identityOnly) {
      throw new Error(
        `applied factor ${artifact.factorKey} must be a validated non-identity artifact.`,
      );
    }
    if (reason !== null) {
      throw new Error(`applied factor ${artifact.factorKey} must not have a reason.`);
    }
  } else if (rawDecision.runtimeDisposition === 'identity') {
    if (
      !identityOnly ||
      artifact.applicationStages.length !== 1 ||
      artifact.applicationStages[0] !== 'identity'
    ) {
      throw new Error(
        `identity factor ${artifact.factorKey} must contain exactly one identity effect.`,
      );
    }
    if (reason === null) {
      throw new Error(`identity factor ${artifact.factorKey} requires a reason.`);
    }
  } else if (reason === null) {
    throw new Error(`not-applied factor ${artifact.factorKey} requires a reason.`);
  }

  return Object.freeze({
    factorKey: artifact.factorKey,
    runtimeDisposition: rawDecision.runtimeDisposition,
    reason,
    evidenceSha256,
  });
}

function runtimeDecisionsFromArtifacts(
  artifacts: readonly M8_5BatterHitsFactorArtifactV1[],
  rawDecisions: readonly M8_5FactorRuntimeDecisionV1[] | undefined,
): readonly M8_5FactorRuntimeDecisionV1[] {
  if (rawDecisions === undefined) {
    return Object.freeze(
      artifacts.map((artifact) =>
        validateRuntimeDecisionForArtifact(artifact, {
          factorKey: artifact.factorKey,
          runtimeDisposition: 'applied',
          reason: null,
          evidenceSha256: defaultEvidenceSha256(artifact),
        }),
      ),
    );
  }
  if (!Array.isArray(rawDecisions) || rawDecisions.length !== artifacts.length) {
    throw new Error(
      'M8.5 runtime decisions must cover every factor artifact exactly once.',
    );
  }
  const byKey = new Map<M8_5BatterHitsFactorKey, M8_5FactorRuntimeDecisionV1>();
  for (const decision of rawDecisions) {
    if (byKey.has(decision.factorKey)) {
      throw new Error(`duplicate runtime decision for ${decision.factorKey}.`);
    }
    byKey.set(decision.factorKey, decision);
  }
  return Object.freeze(
    artifacts.map((artifact) => {
      const decision = byKey.get(artifact.factorKey);
      if (decision === undefined) {
        throw new Error(`missing runtime decision for ${artifact.factorKey}.`);
      }
      return validateRuntimeDecisionForArtifact(artifact, decision);
    }),
  );
}

function verifyStoredFactorMetadata(
  rawReferences: readonly M8_5AppliedFactorReferenceV1[],
  rawDecisions: readonly M8_5FactorRuntimeDecisionV1[],
): void {
  if (
    !Array.isArray(rawReferences) ||
    !Array.isArray(rawDecisions) ||
    rawReferences.length === 0 ||
    rawReferences.length !== rawDecisions.length
  ) {
    throw new Error(
      'M8.5 final distribution requires aligned factor references and runtime decisions.',
    );
  }
  let previousOrder = -1;
  const seen = new Set<M8_5BatterHitsFactorKey>();
  rawReferences.forEach((reference, index) => {
    const decision = rawDecisions[index];
    if (decision === undefined) {
      throw new Error(`missing runtime decision at factor index ${index}.`);
    }
    const order = factorOrder(reference.factorKey);
    if (order <= previousOrder) {
      throw new Error('M8.5 factor references must use canonical factor order.');
    }
    previousOrder = order;
    if (seen.has(reference.factorKey)) {
      throw new Error(`duplicate M8.5 factor ${reference.factorKey}.`);
    }
    seen.add(reference.factorKey);
    nonEmptyString(reference.modelVersion, `factorReferences[${index}].modelVersion`);
    assertSha256(
      reference.artifactSha256,
      `factorReferences[${index}].artifactSha256`,
    );
    if (
      !Array.isArray(reference.applicationStages) ||
      reference.applicationStages.length === 0
    ) {
      throw new Error(
        `factorReferences[${index}].applicationStages must not be empty.`,
      );
    }
    const stageSet = new Set<M8_5BatterHitsApplicationStage>();
    for (const stage of reference.applicationStages) {
      if (!VALID_APPLICATION_STAGES.has(stage) || stageSet.has(stage)) {
        throw new Error(
          `factorReferences[${index}] contains an invalid or duplicate stage ${stage}.`,
        );
      }
      stageSet.add(stage);
    }
    assertExact(
      decision.factorKey,
      reference.factorKey,
      `factorRuntimeDecisions[${index}].factorKey`,
    );
    if (!VALID_RUNTIME_DISPOSITIONS.has(decision.runtimeDisposition)) {
      throw new Error(
        `factorRuntimeDecisions[${index}] has an unsupported disposition.`,
      );
    }
    const reason = optionalReason(
      decision.reason,
      `factorRuntimeDecisions[${index}].reason`,
    );
    assertSha256(
      decision.evidenceSha256,
      `factorRuntimeDecisions[${index}].evidenceSha256`,
    );
    if (decision.runtimeDisposition === 'applied') {
      if (reason !== null || stageSet.has('identity')) {
        throw new Error(
          `applied factor ${reference.factorKey} must have non-identity stages and no reason.`,
        );
      }
    } else if (decision.runtimeDisposition === 'identity') {
      if (
        reason === null ||
        reference.applicationStages.length !== 1 ||
        reference.applicationStages[0] !== 'identity'
      ) {
        throw new Error(
          `identity factor ${reference.factorKey} must have one identity stage and a reason.`,
        );
      }
    } else if (reason === null) {
      throw new Error(
        `not-applied factor ${reference.factorKey} requires a reason.`,
      );
    }
  });
}

function verifyRuntimeDistribution(
  rawDistribution: FrozenBatterHitsRuntimeDistribution,
  sourceBaseDistribution: M8BatterHitsBaseDistributionV1,
): FrozenBatterHitsRuntimeDistribution {
  assertExact(
    rawDistribution.distributionBuilderVersion,
    sourceBaseDistribution.dBase.distributionBuilderVersion,
    'D_final distribution builder version',
  );
  validateProbabilityMassFunction(
    rawDistribution.statisticDistribution,
    'M8.5 D_final statistic distribution',
  );
  validateProbabilityMassFunction(
    rawDistribution.opportunityDistribution,
    'M8.5 D_final opportunity distribution',
  );
  if (
    rawDistribution.scenarios.length !==
    sourceBaseDistribution.dBase.scenarios.length
  ) {
    throw new Error('D_final must preserve the shared scenario count from D_base.');
  }
  validateProbabilityVector(
    rawDistribution.scenarios.map((scenario) => scenario.weight),
    'M8.5 D_final scenario weights',
  );
  const seenScenarioIndices = new Set<number>();
  rawDistribution.scenarios.forEach((scenario, index) => {
    const baseScenario = sourceBaseDistribution.dBase.scenarios[index];
    if (baseScenario === undefined) {
      throw new Error(`D_base is missing shared scenario ${index}.`);
    }
    if (!Number.isSafeInteger(scenario.scenarioIndex) || scenario.scenarioIndex < 0) {
      throw new Error(`D_final scenario ${index} has an invalid scenario index.`);
    }
    if (seenScenarioIndices.has(scenario.scenarioIndex)) {
      throw new Error(
        `D_final contains duplicate scenario index ${scenario.scenarioIndex}.`,
      );
    }
    seenScenarioIndices.add(scenario.scenarioIndex);
    assertExact(
      scenario.scenarioIndex,
      baseScenario.scenarioIndex,
      `D_final shared scenario index ${index}`,
    );
    validateProbabilityMassFunction(
      scenario.opportunityCountDistribution,
      `M8.5 D_final scenario ${scenario.scenarioIndex} opportunity distribution`,
    );
    validateProbabilityMassFunction(
      scenario.hitDistribution,
      `M8.5 D_final scenario ${scenario.scenarioIndex} hit distribution`,
    );
    if (
      scenario.perOpportunityHitProbabilities.length !==
      Math.max(0, scenario.opportunityCountDistribution.probabilities.length - 1)
    ) {
      throw new Error(
        `M8.5 D_final scenario ${scenario.scenarioIndex} must contain one hit probability per possible opportunity.`,
      );
    }
    scenario.perOpportunityHitProbabilities.forEach((probability, turnIndex) => {
      validateProbability(
        probability,
        `M8.5 D_final scenario ${scenario.scenarioIndex} turn ${turnIndex + 1} hit probability`,
      );
    });
  });
  return cloneJson(rawDistribution);
}

function finalDistributionIdentity(
  value: Omit<M8_5FinalDistributionV1, 'finalDistributionSha256'>,
): string {
  return sha256(value);
}

function finalEvaluationIdentity(
  value: Omit<M8_5FinalEvaluationV1, 'finalEvaluationSha256'>,
): string {
  return sha256(value);
}

export function createM8_5FinalDistributionV1(
  input: Readonly<CreateM8_5FinalDistributionV1Input>,
): M8_5FinalDistributionV1 {
  const sourceBaseDistribution = verifyM8BatterHitsBaseDistribution(
    input.sourceBaseDistribution,
  );
  const contextModelVersion = nonEmptyString(
    input.contextModelVersion,
    'M8.5 context model version',
  );
  const artifacts = verifiedArtifacts(input.factorArtifacts);
  const factorReferences = factorReferencesFromArtifacts(artifacts);
  const factorRuntimeDecisions = runtimeDecisionsFromArtifacts(
    artifacts,
    input.factorRuntimeDecisions,
  );
  verifyStoredFactorMetadata(factorReferences, factorRuntimeDecisions);
  const dFinal = verifyRuntimeDistribution(input.dFinal, sourceBaseDistribution);
  const withoutHash = Object.freeze({
    finalDistributionContract: M8_5_BATTER_HITS_FINAL_DISTRIBUTION_CONTRACT,
    productionEnabled: false as const,
    hardDiscoveryFilterEnabled: false as const,
    sourceBaseDistribution,
    sourceBaseDistributionSha256:
      sourceBaseDistribution.baseDistributionSha256,
    sharedScenarioIdentity: sourceBaseDistribution.sharedScenarioIdentity,
    contextModelVersion,
    factorReferences,
    factorRuntimeDecisions,
    settlementRuleVersion:
      sourceBaseDistribution.versions.settlementRuleVersion,
    dFinal,
  });
  return Object.freeze({
    ...withoutHash,
    finalDistributionSha256: finalDistributionIdentity(withoutHash),
  });
}

export function verifyM8_5FinalDistributionV1(
  rawDistribution: M8_5FinalDistributionV1,
): M8_5FinalDistributionV1 {
  assertExact(
    rawDistribution.finalDistributionContract,
    M8_5_BATTER_HITS_FINAL_DISTRIBUTION_CONTRACT,
    'M8.5 final distribution contract',
  );
  assertExact(
    rawDistribution.productionEnabled,
    false,
    'M8.5 final distribution productionEnabled',
  );
  assertExact(
    rawDistribution.hardDiscoveryFilterEnabled,
    false,
    'M8.5 final distribution hardDiscoveryFilterEnabled',
  );
  const sourceBaseDistribution = verifyM8BatterHitsBaseDistribution(
    rawDistribution.sourceBaseDistribution,
  );
  assertExact(
    rawDistribution.sourceBaseDistributionSha256,
    sourceBaseDistribution.baseDistributionSha256,
    'M8.5 final distribution source D_base SHA-256',
  );
  assertExact(
    rawDistribution.sharedScenarioIdentity,
    sourceBaseDistribution.sharedScenarioIdentity,
    'M8.5 final distribution shared scenario identity',
  );
  assertExact(
    rawDistribution.settlementRuleVersion,
    sourceBaseDistribution.versions.settlementRuleVersion,
    'M8.5 final distribution settlement rule version',
  );
  nonEmptyString(
    rawDistribution.contextModelVersion,
    'M8.5 context model version',
  );
  verifyStoredFactorMetadata(
    rawDistribution.factorReferences,
    rawDistribution.factorRuntimeDecisions,
  );
  verifyRuntimeDistribution(rawDistribution.dFinal, sourceBaseDistribution);
  const actualHash = assertSha256(
    rawDistribution.finalDistributionSha256,
    'M8.5 final distribution SHA-256',
  );
  const { finalDistributionSha256: _ignored, ...withoutHash } = rawDistribution;
  assertExact(
    actualHash,
    finalDistributionIdentity(withoutHash),
    'M8.5 final distribution SHA-256',
  );
  return rawDistribution;
}

function assertBaseMatchesFinalDistribution(
  sourceM8Evaluation: M8BatterHitsBaseEvaluationV1,
  finalDistribution: M8_5FinalDistributionV1,
): void {
  assertExact(
    sourceM8Evaluation.baseDistributionSha256,
    finalDistribution.sourceBaseDistributionSha256,
    'source M8 evaluation/final distribution D_base SHA-256',
  );
  assertExact(
    sourceM8Evaluation.sharedScenarioIdentity,
    finalDistribution.sharedScenarioIdentity,
    'source M8 evaluation/final distribution shared scenario identity',
  );
  assertExact(
    sourceM8Evaluation.baseDistribution.versions.settlementRuleVersion,
    finalDistribution.settlementRuleVersion,
    'source M8 evaluation/final distribution settlement rule version',
  );
}

export function settleM8_5FinalOfferV1(
  input: Readonly<SettleM8_5FinalOfferV1Input>,
): M8_5FinalEvaluationV1 {
  const sourceM8Evaluation = verifySourceM8Evaluation(
    input.sourceM8Evaluation,
  );
  const finalDistribution = verifyM8_5FinalDistributionV1(
    input.finalDistribution,
  );
  assertBaseMatchesFinalDistribution(sourceM8Evaluation, finalDistribution);
  const settlement = settleDiscreteStatistic({
    statisticDistribution: validateProbabilityMassFunction(
      finalDistribution.dFinal.statisticDistribution,
      'M8.5 D_final statistic distribution',
    ),
    eligibilityProbability:
      sourceM8Evaluation.baseDistribution.baseballInputs.eligibilityProbability,
    line: sourceM8Evaluation.offer.line,
    selectedSide: sourceM8Evaluation.offer.selectedSide,
  });
  const pBase = sourceM8Evaluation.probabilities.pBase;
  const pFinal = settlement.winProbabilityGivenGrades;
  const probabilities = Object.freeze({
    pWin: settlement.winProbability,
    pLoss: settlement.lossProbability,
    pVoid: settlement.voidProbability,
    pBase,
    pFinal,
    contextProbabilityDelta:
      pBase === null || pFinal === null ? null : pFinal - pBase,
  });
  const withoutHash = Object.freeze({
    finalEvaluationContract: M8_5_BATTER_HITS_FINAL_EVALUATION_CONTRACT,
    productionEnabled: false as const,
    hardDiscoveryFilterEnabled: false as const,
    sourceM8Evaluation,
    sourceM8EvaluationSha256: sourceM8Evaluation.baseEvaluationSha256,
    baseDistributionSha256: sourceM8Evaluation.baseDistributionSha256,
    sharedScenarioIdentity: sourceM8Evaluation.sharedScenarioIdentity,
    finalDistribution,
    finalDistributionSha256: finalDistribution.finalDistributionSha256,
    dBase: sourceM8Evaluation.dBase,
    dFinal: finalDistribution.dFinal,
    offer: sourceM8Evaluation.offer,
    contextModelVersion: finalDistribution.contextModelVersion,
    factorReferences: finalDistribution.factorReferences,
    factorRuntimeDecisions: finalDistribution.factorRuntimeDecisions,
    settlementRuleVersion: finalDistribution.settlementRuleVersion,
    probabilities,
  });
  return Object.freeze({
    ...withoutHash,
    finalEvaluationSha256: finalEvaluationIdentity(withoutHash),
  });
}

export function createM8_5FinalEvaluationV1(
  input: Readonly<CreateM8_5FinalEvaluationV1Input>,
): M8_5FinalEvaluationV1 {
  const sourceM8Evaluation = verifySourceM8Evaluation(
    input.sourceM8Evaluation,
  );
  return settleM8_5FinalOfferV1({
    sourceM8Evaluation,
    finalDistribution: createM8_5FinalDistributionV1({
      sourceBaseDistribution: sourceM8Evaluation.baseDistribution,
      dFinal: input.dFinal,
      contextModelVersion: input.contextModelVersion,
      factorArtifacts: input.factorArtifacts,
      factorRuntimeDecisions: input.factorRuntimeDecisions,
    }),
  });
}

export function verifyM8_5FinalEvaluationV1(
  rawEvaluation: M8_5FinalEvaluationV1,
): M8_5FinalEvaluationV1 {
  assertExact(
    rawEvaluation.finalEvaluationContract,
    M8_5_BATTER_HITS_FINAL_EVALUATION_CONTRACT,
    'M8.5 final evaluation contract',
  );
  assertExact(
    rawEvaluation.productionEnabled,
    false,
    'M8.5 final evaluation productionEnabled',
  );
  assertExact(
    rawEvaluation.hardDiscoveryFilterEnabled,
    false,
    'M8.5 final evaluation hardDiscoveryFilterEnabled',
  );
  assertSha256(
    rawEvaluation.finalEvaluationSha256,
    'M8.5 final evaluation SHA-256',
  );
  const rebuilt = settleM8_5FinalOfferV1({
    sourceM8Evaluation: rawEvaluation.sourceM8Evaluation,
    finalDistribution: rawEvaluation.finalDistribution,
  });
  if (stableJson(rawEvaluation) !== stableJson(rebuilt)) {
    throw new Error(
      'M8.5 final evaluation does not match its canonical hash and settlement.',
    );
  }
  return rawEvaluation;
}
