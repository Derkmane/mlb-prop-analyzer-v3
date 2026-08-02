import assert from 'node:assert/strict';
import test from 'node:test';

import {
  createM8_5GameOffensiveEnvironmentModelArtifactV1,
  resolveM8_5GameOffensiveEnvironmentV1,
  verifyM8_5BatterHitsFactorArtifactV1,
  verifyM8_5GameOffensiveEnvironmentModelArtifactV1,
} from '../src/features/batter-hits/index.js';

const SHARED_ENVIRONMENT_SHA256 =
  'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';

const EVIDENCE = Object.freeze({
  fitPeriod: Object.freeze({ start: '2026-03-26', end: '2026-06-21' }),
  validationPeriod: Object.freeze({ start: '2026-06-22', end: '2026-07-05' }),
  walkForwardEvaluated: true as const,
  untouchedRowsIncluded: false as const,
  evidenceArtifactSha256:
    'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
});

function modelArtifact() {
  return createM8_5GameOffensiveEnvironmentModelArtifactV1({
    modelVersion: 'm8-5-game-offensive-environment-synthetic-v1',
    sourceSharedEnvironmentModelVersion: 'm8-shared-offensive-environment-v2',
    sourceSharedEnvironmentArtifactSha256: SHARED_ENVIRONMENT_SHA256,
    scenarioIds: ['shared-environment:0', 'shared-environment:1'],
    featureNames: ['awayRollingPaRate', 'homeRollingHitRate'],
    featureNormalization: [
      { featureName: 'awayRollingPaRate', mean: 36, scale: 2 },
      { featureName: 'homeRollingHitRate', mean: 0.22, scale: 0.03 },
    ],
    scenarioLogits: [
      {
        scenarioId: 'shared-environment:0',
        intercept: 0,
        coefficients: [
          { featureName: 'awayRollingPaRate', coefficient: -0.5 },
          { featureName: 'homeRollingHitRate', coefficient: -0.25 },
        ],
      },
      {
        scenarioId: 'shared-environment:1',
        intercept: 0,
        coefficients: [
          { featureName: 'awayRollingPaRate', coefficient: 0.5 },
          { featureName: 'homeRollingHitRate', coefficient: 0.25 },
        ],
      },
    ],
    validationEvidence: EVIDENCE,
  });
}

function resolutionInput() {
  return {
    gameId: '2026-07-06:away-100:home-200',
    sourceSharedEnvironmentModelVersion: 'm8-shared-offensive-environment-v2',
    sourceSharedEnvironmentArtifactSha256: SHARED_ENVIRONMENT_SHA256,
    scenarioIds: ['shared-environment:0', 'shared-environment:1'],
    features: {
      awayRollingPaRate: 38,
      homeRollingHitRate: 0.25,
    },
  };
}

test('resolves one deterministic game-specific mixture over the exact shared scenario set', () => {
  const artifact = modelArtifact();
  const first = resolveM8_5GameOffensiveEnvironmentV1(
    artifact,
    resolutionInput(),
  );
  const second = resolveM8_5GameOffensiveEnvironmentV1(
    artifact,
    resolutionInput(),
  );

  assert.deepEqual(first, second);
  assert.equal(first.factorKey, 'gameSpecificOffensiveEnvironment');
  assert.equal(first.modelArtifactSha256, artifact.artifactSha256);
  assert.match(first.inputSha256, /^[a-f0-9]{64}$/u);
  assert.deepEqual(
    first.scenarioWeights.map((entry) => entry.scenarioId),
    artifact.scenarioIds,
  );
  assert.ok(
    Math.abs(
      first.scenarioWeights.reduce((sum, entry) => sum + entry.weight, 0) - 1,
    ) < 1e-12,
  );
  assert.ok(first.scenarioWeights[1]!.weight > first.scenarioWeights[0]!.weight);

  const factor = verifyM8_5BatterHitsFactorArtifactV1(first.factorArtifact);
  assert.equal(factor.status, 'validated');
  assert.equal(factor.productionEnabled, false);
  assert.equal(factor.selectedSideInputAllowed, false);
  assert.equal(factor.directProbabilityEffectAllowed, false);
  assert.equal(factor.effects.length, 1);
  assert.equal(factor.effects[0]?.kind, 'scenario-mixture');
  assert.equal(
    factor.effects[0]?.applicationStage,
    'shared-scenario-before-statistic-distribution',
  );
  assert.equal(Object.hasOwn(first.factorArtifact, 'selectedSide'), false);
  assert.equal(Object.hasOwn(first.factorArtifact, 'probabilityDelta'), false);
});

test('game features move only shared scenario weights and preserve scenario identity', () => {
  const artifact = modelArtifact();
  const lower = resolveM8_5GameOffensiveEnvironmentV1(artifact, {
    ...resolutionInput(),
    features: {
      awayRollingPaRate: 34,
      homeRollingHitRate: 0.19,
    },
  });
  const higher = resolveM8_5GameOffensiveEnvironmentV1(artifact, {
    ...resolutionInput(),
    features: {
      awayRollingPaRate: 40,
      homeRollingHitRate: 0.28,
    },
  });

  assert.deepEqual(
    lower.scenarioWeights.map((entry) => entry.scenarioId),
    higher.scenarioWeights.map((entry) => entry.scenarioId),
  );
  assert.ok(
    higher.scenarioWeights[1]!.weight > lower.scenarioWeights[1]!.weight,
  );
  assert.notEqual(higher.inputSha256, lower.inputSha256);
});

test('scenario drift, feature drift, selected-side input, and source drift fail closed', () => {
  const artifact = modelArtifact();

  assert.throws(
    () =>
      resolveM8_5GameOffensiveEnvironmentV1(artifact, {
        ...resolutionInput(),
        selectedSide: 'higher',
      }),
    /unexpected field selectedSide/u,
  );
  assert.throws(
    () =>
      resolveM8_5GameOffensiveEnvironmentV1(artifact, {
        ...resolutionInput(),
        scenarioIds: ['shared-environment:1', 'shared-environment:0'],
      }),
    /scenarioIds does not match/u,
  );
  assert.throws(
    () =>
      resolveM8_5GameOffensiveEnvironmentV1(artifact, {
        ...resolutionInput(),
        features: { awayRollingPaRate: 38 },
      }),
    /resolution feature names does not match/u,
  );
  assert.throws(
    () =>
      resolveM8_5GameOffensiveEnvironmentV1(artifact, {
        ...resolutionInput(),
        features: {
          awayRollingPaRate: 38,
          homeRollingHitRate: 0.25,
          extraFeature: 1,
        },
      }),
    /resolution feature names does not match/u,
  );
  assert.throws(
    () =>
      resolveM8_5GameOffensiveEnvironmentV1(artifact, {
        ...resolutionInput(),
        sourceSharedEnvironmentArtifactSha256:
          'cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc',
      }),
    /artifact SHA-256 does not match/u,
  );
});

test('model artifact hash drift and malformed coefficient coverage fail closed', () => {
  const artifact = modelArtifact();

  assert.throws(
    () =>
      verifyM8_5GameOffensiveEnvironmentModelArtifactV1({
        ...artifact,
        modelVersion: 'tampered',
      }),
    /artifact SHA-256 is invalid/u,
  );
  assert.throws(
    () =>
      verifyM8_5GameOffensiveEnvironmentModelArtifactV1({
        ...artifact,
        selectedSide: 'lower',
      }),
    /unexpected field selectedSide/u,
  );
  assert.throws(
    () =>
      createM8_5GameOffensiveEnvironmentModelArtifactV1({
        modelVersion: artifact.modelVersion,
        sourceSharedEnvironmentModelVersion:
          artifact.sourceSharedEnvironmentModelVersion,
        sourceSharedEnvironmentArtifactSha256:
          artifact.sourceSharedEnvironmentArtifactSha256,
        scenarioIds: artifact.scenarioIds,
        featureNames: artifact.featureNames,
        featureNormalization: artifact.featureNormalization,
        scenarioLogits: [
          artifact.scenarioLogits[0]!,
          {
            ...artifact.scenarioLogits[1]!,
            coefficients: [artifact.scenarioLogits[1]!.coefficients[0]!],
          },
        ],
        validationEvidence: artifact.validationEvidence,
      }),
    /one row per featureName/u,
  );
});
