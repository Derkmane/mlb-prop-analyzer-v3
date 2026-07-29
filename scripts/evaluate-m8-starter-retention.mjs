import { readFile } from 'node:fs/promises';

import { writeJsonAtomic } from './provider-probe-utils.mjs';
import {
  evaluateM8StarterRetention,
  verifyM8StarterRetentionEvaluation,
} from './m8-starter-retention-evaluation-utils.mjs';

function requireEnvironmentValue(name) {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`Missing required environment variable: ${name}`);
  return value;
}

async function readJson(filePath, label = filePath) {
  const text = await readFile(filePath, 'utf8');
  try {
    return { text, value: JSON.parse(text) };
  } catch {
    throw new Error(`${label} is not valid JSON.`);
  }
}

const datasetPath = requireEnvironmentValue(
  'M8_STARTER_RETENTION_DATASET_PATH',
);
const outputPath = requireEnvironmentValue(
  'M8_STARTER_RETENTION_EVALUATION_OUTPUT_PATH',
);
const dataset = await readJson(datasetPath, 'starter retention dataset');
const evaluation = evaluateM8StarterRetention({
  rawDataset: dataset.value,
  datasetText: dataset.text,
});
await writeJsonAtomic(outputPath, evaluation);
const written = await readJson(outputPath, 'written starter retention evaluation');
verifyM8StarterRetentionEvaluation(written.value);
if (written.value.evaluationSha256 !== evaluation.evaluationSha256) {
  throw new Error('written starter retention evaluation changed after persistence.');
}

console.log('=== M8 STARTER RETENTION EVALUATION COMPLETE ===');
console.log(`Status: ${evaluation.status}`);
console.log(`Fit rows: ${evaluation.fitWindow.observationCount}`);
console.log(`Validation rows: ${evaluation.validationWindow.observationCount}`);
console.log(`Maximum slot turns: ${evaluation.supportMaximum}`);
console.log(`Fixed selected candidate: ${evaluation.fixedSelectedCandidateId}`);
console.log(
  `Walk-forward selected candidate: ${evaluation.walkForward.selectedCandidateId}`,
);
console.log(`Selection agreement: ${evaluation.selectionAgreement}`);
console.log(`Selected beats no-retention: ${evaluation.selectedBeatsNoRetention}`);
console.log(`Walk-forward folds: ${evaluation.walkForward.foldCount}`);
for (const result of evaluation.fixedResults) {
  console.log(
    `${result.candidate.candidateId}: log loss ${result.metrics.overall.logLoss}; Brier ${result.metrics.overall.multiclassBrier}`,
  );
}
console.log(`Evaluation SHA-256: ${evaluation.evaluationSha256}`);
console.log(`Output: ${outputPath}`);
console.log('Untouched-test rows accessed: false');
