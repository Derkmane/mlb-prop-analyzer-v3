import assert from 'node:assert/strict';
import test from 'node:test';

import { verifyM8FrozenBatterHitsCandidate } from '../scripts/m8-batter-hits-frozen-candidate-utils.mjs';
import { sha256 } from '../scripts/provider-probe-utils.mjs';

function candidateIdentity(value) {
  return {
    artifactVersion: value.artifactVersion,
    modelVersion: value.modelVersion,
    status: value.status,
    productionEnabled: value.productionEnabled,
    activeSeason: value.activeSeason,
    sourceSharedEnvironmentArtifactSha256:
      value.sourceSharedEnvironmentArtifactSha256,
    sourceStarterRetentionArtifactSha256:
      value.sourceStarterRetentionArtifactSha256,
    sourceTerminalOutcomeArtifactSha256:
      value.sourceTerminalOutcomeArtifactSha256,
    environmentEffectPolicy: value.environmentEffectPolicy,
    bullpenModel: value.bullpenModel,
    untouchedTestReservation: value.untouchedTestReservation,
  };
}

function candidate() {
  const value = {
    artifactVersion: 1,
    modelVersion: 'm8-batter-hits-complete-candidate-v1',
    status: 'frozen-complete-current-season-candidate-before-untouched-test',
    productionEnabled: false,
    activeSeason: 2026,
    sourceSharedEnvironmentArtifactSha256: 'a'.repeat(64),
    sourceStarterRetentionArtifactSha256: 'b'.repeat(64),
    sourceTerminalOutcomeArtifactSha256: 'c'.repeat(64),
    environmentEffectPolicy: {
      coefficient: 1,
      selectionMethod:
        'predeclared full application of the already-selected shared offensive environment; not retuned on validation or test rows',
      noEnvironmentBenchmarkCoefficient: 0,
      testUse: 'acceptance-comparison-only-never-candidate-selection',
    },
    bullpenModel: {
      modelVersion: 'm8-generic-bullpen-outcome-v1',
      countsByHand: {
        L: { K: 10, '1B': 2, HR: 1 },
        R: { K: 10, '1B': 2, HR: 1 },
      },
      handCounts: { L: 13, R: 13 },
      handWeights: { L: 0.5, R: 0.5 },
      byHand: {
        L: { K: 0.7, '1B': 0.2, HR: 0.1 },
        R: { K: 0.7, '1B': 0.2, HR: 0.1 },
      },
    },
    untouchedTestReservation: {
      startDate: '2026-07-06',
      endDate: '2026-07-25',
      rowsIncluded: false,
    },
  };
  return {
    purpose: 'synthetic frozen complete candidate',
    ...value,
    artifactSha256: sha256(JSON.stringify(candidateIdentity(value))),
  };
}

test('accepts only the predeclared environment effect and sealed test boundary', () => {
  const frozen = candidate();
  assert.equal(verifyM8FrozenBatterHitsCandidate(frozen), frozen);
  assert.equal(frozen.environmentEffectPolicy.coefficient, 1);
  assert.equal(frozen.environmentEffectPolicy.noEnvironmentBenchmarkCoefficient, 0);
  assert.equal(frozen.untouchedTestReservation.rowsIncluded, false);
  assert.equal(frozen.productionEnabled, false);
});

test('rejects post-freeze coefficient or hash changes', () => {
  const changedCoefficient = structuredClone(candidate());
  changedCoefficient.environmentEffectPolicy.coefficient = 0.75;
  assert.throws(
    () => verifyM8FrozenBatterHitsCandidate(changedCoefficient),
    /environment policy drifted/,
  );

  const changedBullpen = structuredClone(candidate());
  changedBullpen.bullpenModel.handWeights.L = 0.6;
  assert.throws(
    () => verifyM8FrozenBatterHitsCandidate(changedBullpen),
    /hand weights|SHA-256/,
  );
});
