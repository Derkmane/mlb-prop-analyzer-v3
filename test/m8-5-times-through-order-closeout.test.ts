import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';

import {
  M8_5_TIMES_THROUGH_ORDER_EVALUATION_SHA256,
  createDisabledM8_5BatterHitsFactorArtifactV1,
  verifyM8_5BatterHitsFactorArtifactV1,
} from '../src/features/batter-hits/index.js';

const ARTIFACT_PATH = path.resolve(
  'model-artifacts/m8-5-times-through-order-identity-v1.json',
);
const EXPECTED_ARTIFACT_SHA256 =
  '78352afd7c5bfe2ce1383aa7276e9b942826ec02271726a0a2065807c467c352';

function readJson(filePath: string): unknown {
  return JSON.parse(fs.readFileSync(filePath, 'utf8')) as unknown;
}

test('committed TTO identity artifact is deterministic and preserves the real evaluation decision', () => {
  const committed = verifyM8_5BatterHitsFactorArtifactV1(
    readJson(ARTIFACT_PATH),
  );
  const rebuilt = createDisabledM8_5BatterHitsFactorArtifactV1({
    factorKey: 'timesThroughOrder',
    requiredInputs: ['starter-exposure-index'],
    sourceEvidenceVersion:
      `m8-5-times-through-order-evaluation-v1:${M8_5_TIMES_THROUGH_ORDER_EVALUATION_SHA256}`,
  });

  assert.deepEqual(committed, rebuilt);
  assert.equal(committed.artifactSha256, EXPECTED_ARTIFACT_SHA256);
  assert.equal(committed.factorKey, 'timesThroughOrder');
  assert.equal(committed.modelVersion, 'm8-5-times-through-order-identity-v1');
  assert.equal(committed.status, 'disabled');
  assert.equal(committed.productionEnabled, false);
  assert.equal(committed.selectedSideInputAllowed, false);
  assert.equal(committed.directProbabilityEffectAllowed, false);
  assert.deepEqual(committed.applicationStages, ['identity']);
  assert.deepEqual(committed.effects, [
    { kind: 'identity', applicationStage: 'identity' },
  ]);
  assert.equal(
    committed.sourceEvidenceVersion,
    `m8-5-times-through-order-evaluation-v1:${M8_5_TIMES_THROUGH_ORDER_EVALUATION_SHA256}`,
  );
  assert.equal(committed.untouchedTestReservation.rowsIncluded, false);
});
