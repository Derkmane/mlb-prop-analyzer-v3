import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const ARTIFACT_PATH =
  'model-artifacts/m8-5-game-offensive-environment-model-v1.json';
const EXPECTED_FILE_SHA256 =
  'b149943ae56f586f312b703def10ce6203cfa63bdf11909762edd50f653b534b';
const EXPECTED_ARTIFACT_SHA256 =
  '6530a40baeed55d6c20ac9a45cb511974853137bac88b731d621bfd9d7ab4bce';
const EXPECTED_EVIDENCE_SHA256 =
  '81c853f8545e4a40afa865a4cb648817fd53780c5e6a5222033a65d65cdebef4';
const EXPECTED_SHARED_ARTIFACT_SHA256 =
  'b7e1936b2e8cd1b1f5553281f946fc8d3b4f68f056f6b60bbd6f868f6c1453e7';
const EXPECTED_SCENARIO_IDS = Object.freeze([
  'shared-environment:0',
  'shared-environment:1',
  'shared-environment:2',
  'shared-environment:3',
]);
const EXPECTED_FEATURE_NAMES = Object.freeze([
  'awayOpponentPaAllowedPerGame',
  'awayOpponentHitRateAllowed',
  'homeOpponentPaAllowedPerGame',
  'homeOpponentHitRateAllowed',
]);

function sha256(value) {
  return createHash('sha256').update(value).digest('hex');
}

test('locks the validated real M8.5 game offensive-environment artifact and safety boundary', async () => {
  const text = await readFile(ARTIFACT_PATH, 'utf8');
  assert.equal(sha256(text), EXPECTED_FILE_SHA256);

  const artifact = JSON.parse(text);
  assert.equal(artifact.artifactSha256, EXPECTED_ARTIFACT_SHA256);
  assert.equal(artifact.artifactVersion, 1);
  assert.equal(artifact.factorKey, 'gameSpecificOffensiveEnvironment');
  assert.equal(artifact.status, 'validated');
  assert.equal(
    artifact.modelVersion,
    'm8-5-game-offensive-environment-opponent-only-l2-0.01-v1',
  );
  assert.equal(artifact.productionEnabled, false);
  assert.equal(artifact.activeSeason, 2026);
  assert.equal(
    artifact.applicationStage,
    'shared-scenario-before-statistic-distribution',
  );
  assert.equal(artifact.selectedSideInputAllowed, false);
  assert.equal(artifact.directProbabilityEffectAllowed, false);
  assert.equal(
    artifact.sourceSharedEnvironmentModelVersion,
    'm8-shared-offensive-environment-v2',
  );
  assert.equal(
    artifact.sourceSharedEnvironmentArtifactSha256,
    EXPECTED_SHARED_ARTIFACT_SHA256,
  );
  assert.deepEqual(artifact.scenarioIds, EXPECTED_SCENARIO_IDS);
  assert.deepEqual(artifact.featureNames, EXPECTED_FEATURE_NAMES);

  assert.equal(artifact.validationEvidence?.walkForwardEvaluated, true);
  assert.equal(artifact.validationEvidence?.untouchedRowsIncluded, false);
  assert.equal(
    artifact.validationEvidence?.evidenceArtifactSha256,
    EXPECTED_EVIDENCE_SHA256,
  );
  assert.deepEqual(artifact.validationEvidence?.fitPeriod, {
    start: '2026-03-27',
    end: '2026-06-21',
  });
  assert.deepEqual(artifact.validationEvidence?.validationPeriod, {
    start: '2026-06-22',
    end: '2026-07-05',
  });
  assert.equal(artifact.untouchedTestReservation?.rowsIncluded, false);

  assert.equal(artifact.featureNormalization.length, EXPECTED_FEATURE_NAMES.length);
  assert.deepEqual(
    artifact.featureNormalization.map((entry) => entry.featureName),
    EXPECTED_FEATURE_NAMES,
  );
  for (const entry of artifact.featureNormalization) {
    assert.equal(Number.isFinite(entry.mean), true);
    assert.equal(Number.isFinite(entry.scale), true);
    assert.equal(entry.scale > 0, true);
  }

  assert.equal(artifact.scenarioLogits.length, EXPECTED_SCENARIO_IDS.length);
  assert.deepEqual(
    artifact.scenarioLogits.map((entry) => entry.scenarioId),
    EXPECTED_SCENARIO_IDS,
  );
  for (const scenario of artifact.scenarioLogits) {
    assert.equal(Number.isFinite(scenario.intercept), true);
    assert.deepEqual(
      scenario.coefficients.map((entry) => entry.featureName),
      EXPECTED_FEATURE_NAMES,
    );
    for (const coefficient of scenario.coefficients) {
      assert.equal(Number.isFinite(coefficient.coefficient), true);
    }
  }

  assert.equal(Object.hasOwn(artifact, 'selectedSide'), false);
  assert.equal(Object.hasOwn(artifact, 'probabilityDelta'), false);
  assert.equal(Object.hasOwn(artifact, 'directProbabilityAdjustment'), false);
  assert.equal(Object.hasOwn(artifact, 'parkEffect'), false);
  assert.equal(Object.hasOwn(artifact, 'weatherEffect'), false);
  assert.equal(Object.hasOwn(artifact, 'offensiveRuns'), false);
});
