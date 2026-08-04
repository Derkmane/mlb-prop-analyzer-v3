import type { PredictionCandidate } from '../../domain/prediction-candidate.js';
import type { JsonObject } from '../../domain/saved-prediction.js';
import {
  verifyM8_5FinalEvaluationV1,
  type M8_5FinalEvaluationV1,
} from './final-evaluation.js';
import {
  BATTER_HITS_FEATURE_DATA_FIELD,
  BATTER_HITS_FEATURE_ID,
  BATTER_HITS_MARKET_KEY,
} from './manifest.js';
import type { M8_5BatterHitsSuccessorFreezeV1 } from './m8-5-successor-freeze.js';
import type { FrozenBatterHitsRuntimeDistribution } from './runtime-probability.js';

export interface M8_5BatterHitsFinalScenarioReferenceV1 {
  readonly providerGameId: number;
  readonly sharedScenarioIdentity: string;
  readonly baseDistributionSha256: string;
  readonly finalDistributionSha256: string;
  readonly contextModelVersion: string;
  readonly successorFreezeArtifactSha256: string;
}

export interface M8_5BatterHitsFinalFeatureValuesV1 extends JsonObject {
  readonly [BATTER_HITS_FEATURE_DATA_FIELD]: JsonObject;
}

export type M8_5BatterHitsFinalProbabilityCandidateV1 = PredictionCandidate<
  M8_5BatterHitsFinalScenarioReferenceV1,
  M8_5BatterHitsFinalFeatureValuesV1
>;

export interface M8_5BatterHitsFinalProbabilityResultV1 {
  readonly distribution: FrozenBatterHitsRuntimeDistribution;
  readonly baseEvaluation: M8_5FinalEvaluationV1['sourceM8Evaluation'];
  readonly finalEvaluation: M8_5FinalEvaluationV1;
  readonly candidate: M8_5BatterHitsFinalProbabilityCandidateV1;
  readonly productionEnabled: false;
  readonly rankingEnabled: false;
  readonly hardDiscoveryFilterEnabled: false;
}

export interface CreateM8_5BatterHitsFinalProbabilityResultV1Input {
  readonly finalEvaluation: M8_5FinalEvaluationV1;
  readonly successorFreeze: M8_5BatterHitsSuccessorFreezeV1;
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

function assertSameStrings(
  actual: readonly string[],
  expected: readonly string[],
  label: string,
): void {
  if (
    actual.length !== expected.length ||
    actual.some((value, index) => value !== expected[index])
  ) {
    throw new Error(`${label} does not match the frozen successor.`);
  }
}

function verifySuccessorLineage(
  evaluation: M8_5FinalEvaluationV1,
  freeze: M8_5BatterHitsSuccessorFreezeV1,
): void {
  assertExact(freeze.productionEnabled, false, 'successor productionEnabled');
  assertExact(freeze.rankingEnabled, false, 'successor rankingEnabled');
  assertExact(
    freeze.hardDiscoveryFilterEnabled,
    false,
    'successor hardDiscoveryFilterEnabled',
  );
  assertExact(
    evaluation.contextModelVersion,
    freeze.dFinalDefinition.contextModelVersion,
    'final evaluation context model version',
  );
  assertExact(
    evaluation.settlementRuleVersion,
    freeze.dFinalDefinition.settlementVersion,
    'final evaluation settlement version',
  );
  assertExact(
    evaluation.sourceM8Evaluation.baseDistribution.provenance
      .runtimeManifestArtifactSha256,
    freeze.sourceM8RuntimeArtifact.artifactSha256,
    'final evaluation source M8 runtime artifact SHA-256',
  );

  const includedFactors = freeze.factors.filter(
    (factor) => factor.includedInCanonicalDFinalComposition,
  );
  if (
    evaluation.factorReferences.length !== includedFactors.length ||
    evaluation.factorRuntimeDecisions.length !== includedFactors.length
  ) {
    throw new Error(
      'final evaluation must contain exactly the frozen canonical D_final factors.',
    );
  }

  includedFactors.forEach((factor, index) => {
    const reference = evaluation.factorReferences[index];
    const decision = evaluation.factorRuntimeDecisions[index];
    if (reference === undefined || decision === undefined) {
      throw new Error(`final evaluation is missing factor ${factor.factorKey}.`);
    }
    assertExact(
      reference.factorKey,
      factor.factorKey,
      `final factor ${index} key`,
    );
    assertExact(
      reference.modelVersion,
      factor.modelVersion,
      `final factor ${factor.factorKey} model version`,
    );
    assertSameStrings(
      reference.applicationStages,
      factor.applicationStages,
      `final factor ${factor.factorKey} application stages`,
    );
    assertExact(
      decision.factorKey,
      factor.factorKey,
      `final factor ${factor.factorKey} runtime decision key`,
    );
    const expectedDisposition =
      factor.disposition === 'validated-not-applied'
        ? 'not-applied'
        : factor.disposition;
    assertExact(
      decision.runtimeDisposition,
      expectedDisposition,
      `final factor ${factor.factorKey} runtime disposition`,
    );
    assertExact(
      decision.reason,
      factor.reason,
      `final factor ${factor.factorKey} runtime reason`,
    );

    // The game-environment resolver creates one deterministic per-game typed
    // factor artifact from the exact frozen model artifact and runtime input.
    // The other canonical factors retain their frozen artifact identity.
    if (factor.factorKey !== 'gameSpecificOffensiveEnvironment') {
      assertExact(
        reference.artifactSha256,
        factor.factorArtifactSha256,
        `final factor ${factor.factorKey} artifact SHA-256`,
      );
    }
  });

  const defense = freeze.factors.find(
    (factor) => factor.factorKey === 'defenseToBattedBall',
  );
  if (
    defense === undefined ||
    defense.disposition !== 'identity' ||
    defense.includedInCanonicalDFinalComposition !== false ||
    evaluation.factorReferences.some(
      (reference) => reference.factorKey === 'defenseToBattedBall',
    )
  ) {
    throw new Error(
      'Defense must remain a frozen identity diagnostic outside canonical D_final composition.',
    );
  }
}

function factorDiagnostics(
  freeze: M8_5BatterHitsSuccessorFreezeV1,
): readonly JsonObject[] {
  return Object.freeze(
    freeze.factors.map((factor) =>
      Object.freeze({
        factorKey: factor.factorKey,
        disposition: factor.disposition,
        modelVersion: factor.modelVersion,
        factorArtifactSha256: factor.factorArtifactSha256,
        sourceArtifactPath: factor.sourceArtifactPath,
        sourceArtifactSha256: factor.sourceArtifactSha256,
        applicationStages: Object.freeze([...factor.applicationStages]),
        includedInCanonicalDFinalComposition:
          factor.includedInCanonicalDFinalComposition,
        reason: factor.reason,
      }),
    ),
  );
}

function runtimeFactorDiagnostics(
  evaluation: M8_5FinalEvaluationV1,
): readonly JsonObject[] {
  return Object.freeze(
    evaluation.factorReferences.map((reference, index) => {
      const decision = evaluation.factorRuntimeDecisions[index];
      if (decision === undefined) {
        throw new Error(`final evaluation is missing runtime decision ${index}.`);
      }
      return Object.freeze({
        factorKey: reference.factorKey,
        modelVersion: reference.modelVersion,
        artifactSha256: reference.artifactSha256,
        applicationStages: Object.freeze([...reference.applicationStages]),
        runtimeDisposition: decision.runtimeDisposition,
        reason: decision.reason,
        evidenceSha256: decision.evidenceSha256,
      });
    }),
  );
}

export function createM8_5BatterHitsFinalProbabilityResultV1(
  input: Readonly<CreateM8_5BatterHitsFinalProbabilityResultV1Input>,
): M8_5BatterHitsFinalProbabilityResultV1 {
  const finalEvaluation = verifyM8_5FinalEvaluationV1(
    input.finalEvaluation,
  );
  verifySuccessorLineage(finalEvaluation, input.successorFreeze);

  const baseEvaluation = finalEvaluation.sourceM8Evaluation;
  const baseDistribution = baseEvaluation.baseDistribution;
  const offer = finalEvaluation.offer;
  const probabilities = finalEvaluation.probabilities;
  const scenarioReference = Object.freeze({
    providerGameId: offer.providerGameId,
    sharedScenarioIdentity: finalEvaluation.sharedScenarioIdentity,
    baseDistributionSha256: finalEvaluation.baseDistributionSha256,
    finalDistributionSha256: finalEvaluation.finalDistributionSha256,
    contextModelVersion: finalEvaluation.contextModelVersion,
    successorFreezeArtifactSha256: input.successorFreeze.artifactSha256,
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
    lineupStatus: baseDistribution.baseballInputs.lineupStatus,
    lineupSlot: baseDistribution.baseballInputs.lineupSlot,
    batterSide: baseDistribution.baseballInputs.batterSide,
    opposingStarterPitcherId:
      baseDistribution.baseballInputs.opposingStarterPitcherId,
    opposingStarterTeamId:
      baseDistribution.baseballInputs.opposingStarterTeamId,
    opposingStarterHand:
      baseDistribution.baseballInputs.opposingStarterHand,
    lineupSourceSnapshotSha256:
      baseDistribution.baseballInputs.lineupSourceSnapshotSha256,
    runtimeManifestArtifactSha256:
      baseDistribution.provenance.runtimeManifestArtifactSha256,
    completeCandidateArtifactSha256:
      baseDistribution.provenance.completeCandidateArtifactSha256,
    sharedEnvironmentArtifactSha256:
      baseDistribution.provenance.sharedEnvironmentArtifactSha256,
    starterRetentionArtifactSha256:
      baseDistribution.provenance.starterRetentionArtifactSha256,
    terminalOutcomeArtifactSha256:
      baseDistribution.provenance.terminalOutcomeArtifactSha256,
    successorFreezeArtifactSha256: input.successorFreeze.artifactSha256,
    baseDistributionSha256: finalEvaluation.baseDistributionSha256,
    finalDistributionSha256: finalEvaluation.finalDistributionSha256,
    finalEvaluationSha256: finalEvaluation.finalEvaluationSha256,
    pBase: probabilities.pBase,
    pFinal: probabilities.pFinal,
    contextProbabilityDelta: probabilities.contextProbabilityDelta,
    contextModelVersion: finalEvaluation.contextModelVersion,
    settlementRuleVersion: finalEvaluation.settlementRuleVersion,
    factorDispositions: factorDiagnostics(input.successorFreeze),
    runtimeFactorReferences: runtimeFactorDiagnostics(finalEvaluation),
  });
  const featureValues = Object.freeze({
    [BATTER_HITS_FEATURE_DATA_FIELD]: details,
  }) as M8_5BatterHitsFinalFeatureValuesV1;
  const candidate: M8_5BatterHitsFinalProbabilityCandidateV1 = Object.freeze({
    eventId: offer.providerEventId,
    gameId: String(offer.providerGameId),
    playerId: String(offer.providerPlayerId),
    playerName: offer.playerName,
    baseMarketKey: BATTER_HITS_MARKET_KEY,
    marketLabel: 'Batter Hits',
    line: offer.line,
    selectedSide: offer.selectedSide,
    settlementStatistic: 'hits',
    eligibilityProbability:
      baseDistribution.baseballInputs.eligibilityProbability,
    statisticDistribution: finalEvaluation.dFinal.statisticDistribution,
    pWin: probabilities.pWin,
    pLoss: probabilities.pLoss,
    pVoid: probabilities.pVoid,
    pWinGivenGrades: probabilities.pFinal,
    modelVersion: input.successorFreeze.modelVersion,
    distributionBuilderVersion:
      finalEvaluation.dFinal.distributionBuilderVersion,
    settlementRuleVersion: finalEvaluation.settlementRuleVersion,
    sharedScenarioReference: scenarioReference,
    featureData: Object.freeze({
      featureId: BATTER_HITS_FEATURE_ID,
      schemaVersion: 2,
      values: featureValues,
    }),
  });

  return Object.freeze({
    distribution: finalEvaluation.dFinal,
    baseEvaluation,
    finalEvaluation,
    candidate,
    productionEnabled: false as const,
    rankingEnabled: false as const,
    hardDiscoveryFilterEnabled: false as const,
  });
}
