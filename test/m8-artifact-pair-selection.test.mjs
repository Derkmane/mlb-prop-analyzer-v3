import assert from 'node:assert/strict';
import test from 'node:test';

import {
  selectBestArtifactPair,
  selectUniqueArtifactCopy,
  selectUniqueArtifactPair,
} from '../scripts/m8-artifact-pair-selection-utils.mjs';

function pair({
  datasetSha = 'a'.repeat(64),
  evaluationSha = 'b'.repeat(64),
  candidateId = 'approved',
  validationCohortSha = 'c'.repeat(64),
  validationCategoricalLogLoss = 1,
  suffix,
}) {
  return {
    dataset: {
      path: `artifacts/dataset-${suffix}.json`,
      value: { datasetSha256: datasetSha },
    },
    evaluation: {
      path: `artifacts/platoon-boundary-${suffix}.json`,
      value: {
        platoonEvaluationSha256: evaluationSha,
        cohorts: { validationObservationIdsSha256: validationCohortSha },
        selection: {
          selectedCandidate: { candidateId },
          validationCategoricalLogLoss,
        },
      },
    },
  };
}

test('keeps the boundary evaluation with lower categorical log loss and marks the other stale', () => {
  const worse = pair({
    suffix: 'old',
    evaluationSha: 'd'.repeat(64),
    candidateId: 'older-model',
    validationCategoricalLogLoss: 1.25,
  });
  const better = pair({
    suffix: 'new',
    evaluationSha: 'e'.repeat(64),
    candidateId: 'better-model',
    validationCategoricalLogLoss: 1.2,
  });

  const selection = selectBestArtifactPair([worse, better]);

  assert.equal(
    selection.selectedMatch.evaluation.path,
    'artifacts/platoon-boundary-new.json',
  );
  assert.deepEqual(selection.staleEvaluationPaths, [
    'artifacts/platoon-boundary-old.json',
  ]);
  assert.equal(
    selectUniqueArtifactPair([worse, better]).evaluation.path,
    'artifacts/platoon-boundary-new.json',
  );
});

test('rejects boundary evaluations from different validation cohorts', () => {
  const first = pair({ suffix: 'a' });
  const second = pair({
    suffix: 'b',
    validationCohortSha: 'f'.repeat(64),
  });

  assert.throws(
    () => selectBestArtifactPair([first, second]),
    /do not share one validation cohort/,
  );
});

test('accepts duplicate files that contain one identical artifact hash', () => {
  const selected = selectUniqueArtifactCopy(
    [
      { path: 'artifacts/z.json', value: { artifactSha256: 'd'.repeat(64) } },
      { path: 'artifacts/a.json', value: { artifactSha256: 'd'.repeat(64) } },
    ],
    { label: 'shared-environment', identityField: 'artifactSha256' },
  );

  assert.equal(selected.path, 'artifacts/a.json');
});

test('rejects duplicate-looking files with different internal identities', () => {
  assert.throws(
    () =>
      selectUniqueArtifactCopy(
        [
          { path: 'artifacts/a.json', value: { datasetSha256: 'e'.repeat(64) } },
          { path: 'artifacts/b.json', value: { datasetSha256: 'f'.repeat(64) } },
        ],
        { label: 'resolved dataset', identityField: 'datasetSha256' },
      ),
    /exactly one resolved dataset identity; found 2/,
  );
});
