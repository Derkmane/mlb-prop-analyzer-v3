import assert from 'node:assert/strict';
import test from 'node:test';

import { selectUniqueArtifactPair } from '../scripts/m8-artifact-pair-selection-utils.mjs';

function pair({ datasetSha = 'a'.repeat(64), evaluationSha = 'b'.repeat(64), candidateId = 'approved', suffix }) {
  return {
    dataset: {
      path: `artifacts/dataset-${suffix}.json`,
      value: { datasetSha256: datasetSha },
    },
    evaluation: {
      path: `artifacts/evaluation-${suffix}.json`,
      value: {
        platoonEvaluationSha256: evaluationSha,
        selection: { selectedCandidate: { candidateId } },
      },
    },
  };
}

test('accepts duplicate paths that contain one identical approved artifact identity', () => {
  const later = pair({ suffix: 'z' });
  const earlier = pair({ suffix: 'a' });

  const selected = selectUniqueArtifactPair([later, earlier]);

  assert.equal(selected.evaluation.path, 'artifacts/evaluation-a.json');
});

test('rejects genuinely different approved model identities', () => {
  const first = pair({ suffix: 'a' });
  const second = pair({ evaluationSha: 'c'.repeat(64), suffix: 'b' });

  assert.throws(
    () => selectUniqueArtifactPair([first, second]),
    /exactly one boundary-approved model identity; found 2/,
  );
});
