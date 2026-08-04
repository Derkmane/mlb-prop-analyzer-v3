import fs from 'node:fs';
import path from 'node:path';

import {
  buildM8_5TimesThroughOrderDataset,
  evaluateM8_5TimesThroughOrderCandidates,
} from './m8-5-times-through-order-utils.mjs';

const RESOLVED_DATASET_PATH = path.resolve(
  process.env.M8_RESOLVED_CATEGORICAL_DATASET_PATH ??
    'artifacts/m8-resolved-categorical-dataset-v3.json',
);
const TERMINAL_ARTIFACT_PATH = path.resolve(
  process.env.M8_TERMINAL_PA_OUTCOME_ARTIFACT_PATH ??
    'model-artifacts/m8-terminal-pa-outcome-v1.json',
);
const OUTPUT_DATASET_PATH = path.resolve(
  process.env.M8_5_TTO_DATASET_OUTPUT_PATH ??
    'artifacts/m8-5-times-through-order-dataset-v1.json',
);
const OUTPUT_EVALUATION_PATH = path.resolve(
  process.env.M8_5_TTO_EVALUATION_OUTPUT_PATH ??
    'model-artifacts/m8-5-times-through-order-evaluation-v1.json',
);

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function requiredSha256Environment(name) {
  const value = process.env[name];
  if (typeof value !== 'string' || !/^[a-f0-9]{64}$/u.test(value)) {
    throw new Error(`${name} must be set to the frozen lowercase SHA-256 value.`);
  }
  return value;
}

function writeJson(filePath, value) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
}

const dataset = buildM8_5TimesThroughOrderDataset({
  resolvedDataset: readJson(RESOLVED_DATASET_PATH),
  starterBullpenTransitionSha256: requiredSha256Environment(
    'M8_STARTER_BULLPEN_TRANSITION_SHA256',
  ),
});
const evaluation = evaluateM8_5TimesThroughOrderCandidates({
  dataset,
  terminalArtifact: readJson(TERMINAL_ARTIFACT_PATH),
});

writeJson(OUTPUT_DATASET_PATH, dataset);
writeJson(OUTPUT_EVALUATION_PATH, evaluation);

console.log(
  JSON.stringify(
    {
      datasetPath: OUTPUT_DATASET_PATH,
      evaluationPath: OUTPUT_EVALUATION_PATH,
      datasetSha256: dataset.datasetSha256,
      evaluationSha256: evaluation.evaluationSha256,
      decision: evaluation.decision,
      selectedCandidateId: evaluation.selectedCandidateId,
      fitObservationCount: evaluation.fitWindow.observationCount,
      validationObservationCount: evaluation.validationWindow.observationCount,
      untouchedTestRowsIncluded:
        evaluation.untouchedTestReservation.rowsIncluded,
    },
    null,
    2,
  ),
);
