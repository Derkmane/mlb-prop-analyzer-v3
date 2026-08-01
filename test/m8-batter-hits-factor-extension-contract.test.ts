import assert from 'node:assert/strict';
import test from 'node:test';

import {
  BATTER_HITS_COMPLETE_CANDIDATE_SHA256,
  BATTER_HITS_FACTOR_EXTENSION_MODEL_VERSION,
  verifyBatterHitsFactorExtensionArtifactV1,
} from '../src/features/batter-hits/index.js';

const EXTENSION_SHA256 = 'a'.repeat(64);
const FITTED_SHA256 = 'b'.repeat(64);

function identityFactor() {
  return {
    status: 'identity',
    coefficient: 0,
    modelVersion: 'identity',
    artifactSha256: null,
    validationStatus: 'deferred',
    currentSeasonOnly: true,
    applicationStage: 'statistic-distribution-before-settlement',
    selectedSideInputForbidden: true,
  } as const;
}

function baseArtifact() {
  return {
    artifactVersion: 1,
    modelVersion: BATTER_HITS_FACTOR_EXTENSION_MODEL_VERSION,
    productionEnabled: false,
    activeSeason: 2026,
    sourceCompleteCandidateArtifactSha256:
      BATTER_HITS_COMPLETE_CANDIDATE_SHA256,
    factors: {
      teamSpecificBullpen: identityFactor(),
      gameSpecificOffensiveEnvironment: identityFactor(),
      park: identityFactor(),
      timesThroughOrder: identityFactor(),
      defenseToBattedBall: identityFactor(),
    },
    untouchedTestReservation: { rowsIncluded: false },
    artifactSha256: EXTENSION_SHA256,
  } as const;
}

test('current factor extension remains identity-only, disabled, and side-independent', () => {
  const artifact = verifyBatterHitsFactorExtensionArtifactV1(baseArtifact());

  assert.equal(artifact.productionEnabled, false);
  for (const factor of Object.values(artifact.factors)) {
    assert.equal(factor.status, 'identity');
    assert.equal(factor.coefficient, 0);
    assert.equal(factor.selectedSideInputForbidden, true);
    assert.equal(
      factor.applicationStage,
      'statistic-distribution-before-settlement',
    );
  }
});

test('one future fitted factor requires versioned current-season evidence without weakening the frozen candidate seal', () => {
  const raw = baseArtifact();
  const artifact = verifyBatterHitsFactorExtensionArtifactV1({
    ...raw,
    factors: {
      ...raw.factors,
      teamSpecificBullpen: {
        status: 'fitted',
        coefficient: 0.25,
        modelVersion: 'm8-team-specific-bullpen-v1',
        artifactSha256: FITTED_SHA256,
        validationStatus: 'production-validation-passed',
        currentSeasonOnly: true,
        applicationStage: 'statistic-distribution-before-settlement',
        selectedSideInputForbidden: true,
      },
    },
  });

  assert.equal(
    artifact.sourceCompleteCandidateArtifactSha256,
    BATTER_HITS_COMPLETE_CANDIDATE_SHA256,
  );
  assert.equal(artifact.factors.teamSpecificBullpen.status, 'fitted');
  assert.equal(artifact.factors.teamSpecificBullpen.coefficient, 0.25);
  assert.equal(artifact.productionEnabled, false);
});

test('silent coefficients, side-aware booster inputs, missing evidence, and unknown factor keys fail closed', () => {
  const raw = baseArtifact();

  assert.throws(
    () =>
      verifyBatterHitsFactorExtensionArtifactV1({
        ...raw,
        factors: {
          ...raw.factors,
          park: { ...identityFactor(), coefficient: 0.2 },
        },
      }),
    /park\.coefficient/u,
  );

  assert.throws(
    () =>
      verifyBatterHitsFactorExtensionArtifactV1({
        ...raw,
        factors: {
          ...raw.factors,
          timesThroughOrder: {
            ...identityFactor(),
            selectedSideInputForbidden: false,
          },
        },
      }),
    /selectedSideInputForbidden/u,
  );

  assert.throws(
    () =>
      verifyBatterHitsFactorExtensionArtifactV1({
        ...raw,
        factors: {
          ...raw.factors,
          defenseToBattedBall: {
            status: 'fitted',
            coefficient: 0.1,
            modelVersion: 'm8-defense-v1',
            artifactSha256: null,
            validationStatus: 'production-validation-passed',
            currentSeasonOnly: true,
            applicationStage: 'statistic-distribution-before-settlement',
            selectedSideInputForbidden: true,
          },
        },
      }),
    /artifactSha256/u,
  );

  assert.throws(
    () =>
      verifyBatterHitsFactorExtensionArtifactV1({
        ...raw,
        factors: {
          ...raw.factors,
          unversionedBooster: identityFactor(),
        },
      }),
    /every and only/u,
  );
});
