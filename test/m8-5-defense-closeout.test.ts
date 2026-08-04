import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';

import {
  M8_5_BATTER_HITS_BATTED_BALL_CATEGORIES,
  createDisabledM8_5BatterHitsFactorArtifactV1,
  verifyM8_5BatterHitsFactorArtifactV1,
} from '../src/features/batter-hits/index.js';

const ARTIFACT_PATH = path.resolve(
  'model-artifacts/m8-5-defense-to-batted-ball-identity-v1.json',
);
const EXPECTED_ARTIFACT_SHA256 =
  '53ae8887179f6d066dec50f62f7dac5951be54158032687a3aa162902b5375ea';
const SOURCE_EVIDENCE_VERSION =
  'm8-5-defense-pre-screen-v1:a40eca0b15e5d69c7c718e807c2ced7b007650f0628dd7761c87f9f56f1d3b59:team-dataset-prefix-eb627fae';
const REQUIRED_INPUTS = Object.freeze([
  'defending-team-id',
  ...M8_5_BATTER_HITS_BATTED_BALL_CATEGORIES.map(
    (category) => `terminal-category:${category}`,
  ),
]);

function readJson(filePath: string): unknown {
  return JSON.parse(fs.readFileSync(filePath, 'utf8')) as unknown;
}

test('committed Defense identity artifact is deterministic and restricted to approved BIP categories', () => {
  const committed = verifyM8_5BatterHitsFactorArtifactV1(
    readJson(ARTIFACT_PATH),
  );
  const rebuilt = createDisabledM8_5BatterHitsFactorArtifactV1({
    factorKey: 'defenseToBattedBall',
    requiredInputs: REQUIRED_INPUTS,
    sourceEvidenceVersion: SOURCE_EVIDENCE_VERSION,
  });

  assert.deepEqual(committed, rebuilt);
  assert.equal(committed.artifactSha256, EXPECTED_ARTIFACT_SHA256);
  assert.equal(committed.factorKey, 'defenseToBattedBall');
  assert.equal(
    committed.modelVersion,
    'm8-5-defense-to-batted-ball-identity-v1',
  );
  assert.equal(committed.status, 'disabled');
  assert.equal(committed.validationStatus, 'not-evaluated');
  assert.equal(committed.productionEnabled, false);
  assert.equal(committed.selectedSideInputAllowed, false);
  assert.equal(committed.directProbabilityEffectAllowed, false);
  assert.deepEqual(committed.applicationStages, ['identity']);
  assert.deepEqual(committed.effects, [
    { kind: 'identity', applicationStage: 'identity' },
  ]);
  assert.deepEqual(committed.requiredInputs, REQUIRED_INPUTS);
  assert.equal(committed.sourceEvidenceVersion, SOURCE_EVIDENCE_VERSION);
  assert.equal(committed.untouchedTestReservation.rowsIncluded, false);
});
