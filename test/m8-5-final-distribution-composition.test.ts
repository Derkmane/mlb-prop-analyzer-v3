import assert from 'node:assert/strict';
import test from 'node:test';

import {
  M8_5_BATTER_HITS_CONTEXT_MODEL_VERSION,
  M8_5_BATTER_HITS_VALIDATED_COMPOSITION_ORDER,
  M8_5_PARK_NOT_APPLIED_REASON,
  M8_5_TIMES_THROUGH_ORDER_EVALUATION_SHA256,
  M8_5_TIMES_THROUGH_ORDER_IDENTITY_REASON,
  buildFrozenBatterHitsRuntimeDistribution,
  buildM8_5GameOffensiveEnvironmentRuntimeV1,
  buildM8_5ValidatedFinalDistributionV1,
  createDisabledM8_5BatterHitsFactorArtifactV1,
  createM8_5FinalDistributionV1,
  resolveM8_5TeamBullpenOutcomeV1,
  settleM8BatterHitsBaseOffer,
  settleM8_5FinalOfferV1,
  verifyM8_5BatterHitsFactorArtifactV1,
  verifyM8_5FinalDistributionV1,
  verifyM8_5ParkFactorArtifactV1,
  type M8_5BatterHitsFactorArtifactV1,
} from '../src/features/batter-hits/index.js';
import {
  loadFinalEvaluationFixture,
  offerAt,
  probabilityMass,
} from './helpers/m8-5-final-evaluation-fixture.js';

type Hand = 'L' | 'R';

type CategoryVector = Readonly<Record<string, number>>;

function bullpenOverride(
  artifact: M8_5BatterHitsFactorArtifactV1,
  teamId: number,
  modeledCategories: readonly string[],
): Readonly<Record<Hand, CategoryVector>> {
  const modeled = new Set<string>(modeledCategories);
  const vectors = {} as Record<Hand, CategoryVector>;
  for (const hand of ['L', 'R'] as const) {
    const resolution = resolveM8_5TeamBullpenOutcomeV1(artifact, {
      opposingPitchingTeamId: teamId,
      bullpenPitcherHand: hand,
    });
    assert.equal(resolution.status, 'validated');
    if (resolution.status !== 'validated') {
      throw new Error('fixture bullpen resolution must be validated');
    }
    const byCategory = new Map<string, number>(
      resolution.categoryProbabilities.map((entry) => [
        entry.category,
        entry.probability,
      ]),
    );
    for (const entry of resolution.categoryProbabilities) {
      if (!modeled.has(entry.category)) {
        assert.equal(entry.probability, 0);
      }
    }
    vectors[hand] = Object.freeze(
      Object.fromEntries(
        modeledCategories.map((category) => {
          const probability = byCategory.get(category);
          assert.notEqual(probability, undefined);
          return [category, probability!];
        }),
      ),
    );
  }
  return Object.freeze(vectors);
}

function requiredEvidenceSha256(
  artifact: M8_5BatterHitsFactorArtifactV1,
): string {
  const value = artifact.validationEvidence?.evidenceArtifactSha256;
  assert.ok(value);
  return value;
}

function identityAndParkMetadata(rawParkArtifact: unknown) {
  const parkArtifact = verifyM8_5ParkFactorArtifactV1(rawParkArtifact);
  const timesThroughOrderArtifact =
    createDisabledM8_5BatterHitsFactorArtifactV1({
      factorKey: 'timesThroughOrder',
      requiredInputs: ['starter-exposure-index'],
      sourceEvidenceVersion:
        `m8-5-times-through-order-evaluation-v1:${M8_5_TIMES_THROUGH_ORDER_EVALUATION_SHA256}`,
    });
  return Object.freeze({
    parkArtifact,
    timesThroughOrderArtifact,
    decisions: Object.freeze([
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
        evidenceSha256: requiredEvidenceSha256(
          parkArtifact.typedFactorArtifact,
        ),
      }),
    ]),
  });
}

test('canonical D_final applies environment and bullpen while recording TTO identity and park not applied', async () => {
  const inputs = await loadFinalEvaluationFixture();
  const composed = buildM8_5ValidatedFinalDistributionV1({
    sourceBaseDistribution: inputs.sourceBaseDistribution,
    offer: inputs.offer,
    observation: inputs.observation,
    artifacts: inputs.artifacts,
    rawGameEnvironmentModelArtifact: inputs.gameModel,
    gameEnvironmentResolutionInput: inputs.gameResolutionInput,
    rawTeamBullpenFactorArtifact: inputs.teamArtifact,
    rawParkFactorArtifact: inputs.parkArtifact,
  });
  const composedAgain = buildM8_5ValidatedFinalDistributionV1({
    sourceBaseDistribution: inputs.sourceBaseDistribution,
    offer: inputs.offer,
    observation: inputs.observation,
    artifacts: inputs.artifacts,
    rawGameEnvironmentModelArtifact: inputs.gameModel,
    gameEnvironmentResolutionInput: inputs.gameResolutionInput,
    rawTeamBullpenFactorArtifact: inputs.teamArtifact,
    rawParkFactorArtifact: inputs.parkArtifact,
  });

  const teamArtifact = verifyM8_5BatterHitsFactorArtifactV1(
    inputs.teamArtifact,
  );
  const manual = buildM8_5GameOffensiveEnvironmentRuntimeV1({
    offer: inputs.offer,
    observation: inputs.observation,
    artifacts: inputs.artifacts,
    rawModelArtifact: inputs.gameModel,
    resolutionInput: inputs.gameResolutionInput,
    contextFactors: {
      bullpenOverrideByHand: bullpenOverride(
        teamArtifact,
        inputs.observation.opposingStarterTeamId,
        inputs.artifacts.terminalOutcome.categories,
      ),
      teamBullpenFactorModelVersion: teamArtifact.modelVersion,
      teamBullpenFactorArtifactSha256: teamArtifact.artifactSha256,
    },
  });

  assert.deepEqual(
    composed.applicationOrder,
    M8_5_BATTER_HITS_VALIDATED_COMPOSITION_ORDER,
  );
  assert.equal(
    composed.contextModelVersion,
    M8_5_BATTER_HITS_CONTEXT_MODEL_VERSION,
  );
  assert.deepEqual(composed.finalDistribution.dFinal, manual.distribution);
  assert.deepEqual(composed, composedAgain);
  assert.notDeepEqual(
    composed.finalDistribution.dFinal,
    inputs.sourceBaseDistribution.dBase,
  );
  assert.ok(
    Math.abs(
      probabilityMass(
        composed.finalDistribution.dFinal.statisticDistribution,
      ) - 1,
    ) <= 1e-12,
  );
  assert.ok(
    Math.abs(
      probabilityMass(
        composed.finalDistribution.dFinal.opportunityDistribution,
      ) - 1,
    ) <= 1e-12,
  );

  const decisions = new Map(
    composed.finalDistribution.factorRuntimeDecisions.map((decision) => [
      decision.factorKey,
      decision,
    ]),
  );
  assert.equal(
    decisions.get('gameSpecificOffensiveEnvironment')?.runtimeDisposition,
    'applied',
  );
  assert.equal(
    decisions.get('teamSpecificBullpen')?.runtimeDisposition,
    'applied',
  );
  assert.deepEqual(decisions.get('timesThroughOrder'), {
    factorKey: 'timesThroughOrder',
    runtimeDisposition: 'identity',
    reason: M8_5_TIMES_THROUGH_ORDER_IDENTITY_REASON,
    evidenceSha256: M8_5_TIMES_THROUGH_ORDER_EVALUATION_SHA256,
  });
  assert.equal(
    decisions.get('park')?.runtimeDisposition,
    'not-applied',
  );
  assert.equal(decisions.get('park')?.reason, M8_5_PARK_NOT_APPLIED_REASON);
  assert.deepEqual(
    verifyM8_5FinalDistributionV1(composed.finalDistribution),
    composed.finalDistribution,
  );
});

test('runtime venue is not resolved or applied when building D_final', async () => {
  const inputs = await loadFinalEvaluationFixture();
  const original = buildM8_5ValidatedFinalDistributionV1({
    sourceBaseDistribution: inputs.sourceBaseDistribution,
    offer: inputs.offer,
    observation: inputs.observation,
    artifacts: inputs.artifacts,
    rawGameEnvironmentModelArtifact: inputs.gameModel,
    gameEnvironmentResolutionInput: inputs.gameResolutionInput,
    rawTeamBullpenFactorArtifact: inputs.teamArtifact,
    rawParkFactorArtifact: inputs.parkArtifact,
  });
  const unknownVenue = buildM8_5ValidatedFinalDistributionV1({
    sourceBaseDistribution: inputs.sourceBaseDistribution,
    offer: inputs.offer,
    observation: Object.freeze({
      ...inputs.observation,
      venue: 'No Runtime Park Resolution',
    }),
    artifacts: inputs.artifacts,
    rawGameEnvironmentModelArtifact: inputs.gameModel,
    gameEnvironmentResolutionInput: inputs.gameResolutionInput,
    rawTeamBullpenFactorArtifact: inputs.teamArtifact,
    rawParkFactorArtifact: inputs.parkArtifact,
  });
  const { venue: _ignoredVenue, ...observationWithoutVenue } =
    inputs.observation;
  const absentVenue = buildM8_5ValidatedFinalDistributionV1({
    sourceBaseDistribution: inputs.sourceBaseDistribution,
    offer: inputs.offer,
    observation: Object.freeze(observationWithoutVenue),
    artifacts: inputs.artifacts,
    rawGameEnvironmentModelArtifact: inputs.gameModel,
    gameEnvironmentResolutionInput: inputs.gameResolutionInput,
    rawTeamBullpenFactorArtifact: inputs.teamArtifact,
    rawParkFactorArtifact: inputs.parkArtifact,
  });

  assert.equal(
    unknownVenue.finalDistribution.finalDistributionSha256,
    original.finalDistribution.finalDistributionSha256,
  );
  assert.equal(
    absentVenue.finalDistribution.finalDistributionSha256,
    original.finalDistribution.finalDistributionSha256,
  );
  assert.deepEqual(
    unknownVenue.finalDistribution.dFinal,
    original.finalDistribution.dFinal,
  );
  assert.deepEqual(
    absentVenue.finalDistribution.dFinal,
    original.finalDistribution.dFinal,
  );
});

test('D_final with no applied effects equals D_base exactly', async () => {
  const inputs = await loadFinalEvaluationFixture();
  const metadata = identityAndParkMetadata(inputs.parkArtifact);
  const finalDistribution = createM8_5FinalDistributionV1({
    sourceBaseDistribution: inputs.sourceBaseDistribution,
    dFinal: inputs.sourceBaseDistribution.dBase,
    contextModelVersion: M8_5_BATTER_HITS_CONTEXT_MODEL_VERSION,
    factorArtifacts: [
      metadata.timesThroughOrderArtifact,
      metadata.parkArtifact.typedFactorArtifact,
    ],
    factorRuntimeDecisions: metadata.decisions,
  });

  assert.deepEqual(finalDistribution.dFinal, inputs.sourceBaseDistribution.dBase);
  assert.deepEqual(
    finalDistribution.dFinal.statisticDistribution,
    inputs.sourceBaseDistribution.dBase.statisticDistribution,
  );
  assert.deepEqual(
    finalDistribution.dFinal.opportunityDistribution,
    inputs.sourceBaseDistribution.dBase.opportunityDistribution,
  );
});

test('bullpen-only D_final differs from D_base, conserves mass, and one D_final settles baseline and alternate offers', async () => {
  const inputs = await loadFinalEvaluationFixture();
  const teamArtifact = verifyM8_5BatterHitsFactorArtifactV1(
    inputs.teamArtifact,
  );
  const metadata = identityAndParkMetadata(inputs.parkArtifact);
  const bullpenDistribution = buildFrozenBatterHitsRuntimeDistribution(
    inputs.offer,
    inputs.observation,
    inputs.artifacts,
    {
      bullpenOverrideByHand: bullpenOverride(
        teamArtifact,
        inputs.observation.opposingStarterTeamId,
        inputs.artifacts.terminalOutcome.categories,
      ),
      teamBullpenFactorModelVersion: teamArtifact.modelVersion,
      teamBullpenFactorArtifactSha256: teamArtifact.artifactSha256,
    },
  );
  const finalDistribution = createM8_5FinalDistributionV1({
    sourceBaseDistribution: inputs.sourceBaseDistribution,
    dFinal: bullpenDistribution,
    contextModelVersion: M8_5_BATTER_HITS_CONTEXT_MODEL_VERSION,
    factorArtifacts: [
      teamArtifact,
      metadata.timesThroughOrderArtifact,
      metadata.parkArtifact.typedFactorArtifact,
    ],
    factorRuntimeDecisions: [
      {
        factorKey: 'teamSpecificBullpen',
        runtimeDisposition: 'applied',
        reason: null,
        evidenceSha256: requiredEvidenceSha256(teamArtifact),
      },
      ...metadata.decisions,
    ],
  });

  assert.notDeepEqual(finalDistribution.dFinal, inputs.sourceBaseDistribution.dBase);
  assert.ok(
    Math.abs(probabilityMass(finalDistribution.dFinal.statisticDistribution) - 1) <=
      1e-12,
  );
  assert.ok(
    Math.abs(
      probabilityMass(finalDistribution.dFinal.opportunityDistribution) - 1,
    ) <= 1e-12,
  );

  const higherOffer = offerAt(inputs.offer, 'higher', 1.5);
  const lowerOffer = offerAt(inputs.offer, 'lower', 1.5);
  const higher = settleM8_5FinalOfferV1({
    sourceM8Evaluation: settleM8BatterHitsBaseOffer(
      inputs.sourceBaseDistribution,
      higherOffer,
    ),
    finalDistribution,
  });
  const lower = settleM8_5FinalOfferV1({
    sourceM8Evaluation: settleM8BatterHitsBaseOffer(
      inputs.sourceBaseDistribution,
      lowerOffer,
    ),
    finalDistribution,
  });
  assert.strictEqual(higher.finalDistribution, finalDistribution);
  assert.strictEqual(lower.finalDistribution, finalDistribution);
  assert.strictEqual(higher.dFinal, lower.dFinal);
  assert.equal(higher.probabilities.pWin, lower.probabilities.pLoss);
  assert.equal(higher.probabilities.pLoss, lower.probabilities.pWin);
  assert.equal(higher.probabilities.pVoid, lower.probabilities.pVoid);
});

test('factor artifact hash drift fails closed even when park is not applied', async () => {
  const inputs = await loadFinalEvaluationFixture();
  assert.throws(
    () =>
      buildM8_5ValidatedFinalDistributionV1({
        sourceBaseDistribution: inputs.sourceBaseDistribution,
        offer: inputs.offer,
        observation: inputs.observation,
        artifacts: inputs.artifacts,
        rawGameEnvironmentModelArtifact: inputs.gameModel,
        gameEnvironmentResolutionInput: inputs.gameResolutionInput,
        rawTeamBullpenFactorArtifact: inputs.teamArtifact,
        rawParkFactorArtifact: {
          ...(inputs.parkArtifact as Record<string, unknown>),
          parkArtifactSha256: '0'.repeat(64),
        },
      }),
    /parkArtifactSha256/u,
  );
});
