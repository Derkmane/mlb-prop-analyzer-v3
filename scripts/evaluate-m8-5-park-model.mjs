import { readFile } from 'node:fs/promises';

import { writeJsonAtomic } from './provider-probe-utils.mjs';
import {
  buildM8_5ParkEvaluationDataset,
  evaluateM8_5ParkCandidates,
} from './m8-5-park-model-utils.mjs';

function requireEnvironmentValue(name) {
  const value = process.env[name]?.trim();
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

async function readJson(path, label) {
  const text = await readFile(path, 'utf8');
  try {
    return { path, text, value: JSON.parse(text) };
  } catch {
    throw new Error(`${label} is not valid JSON.`);
  }
}

const resolvedPath = requireEnvironmentValue(
  'M8_RESOLVED_CATEGORICAL_DATASET_PATH',
);
const venueAuditPath = requireEnvironmentValue(
  'M8_5_PARK_VENUE_AUDIT_PATH',
);
const frozenBaseParityPath = requireEnvironmentValue(
  'M8_5_PARK_FROZEN_BASE_PREDICTIONS_PATH',
);
const datasetOutputPath = requireEnvironmentValue(
  'M8_5_PARK_EVALUATION_DATASET_OUTPUT_PATH',
);
const evaluationOutputPath = requireEnvironmentValue(
  'M8_5_PARK_EVALUATION_OUTPUT_PATH',
);

const [resolved, venueAudit, frozenBaseParity] = await Promise.all([
  readJson(resolvedPath, 'resolved categorical dataset'),
  readJson(venueAuditPath, 'park venue audit'),
  readJson(frozenBaseParityPath, 'park frozen-base parity'),
]);

const dataset = buildM8_5ParkEvaluationDataset({
  resolvedDataset: resolved.value,
  venueAudit: venueAudit.value,
  frozenBaseParity: frozenBaseParity.value,
});
const evaluation = evaluateM8_5ParkCandidates({ dataset });

await writeJsonAtomic(datasetOutputPath, dataset);
await writeJsonAtomic(evaluationOutputPath, evaluation);

const [writtenDataset, writtenEvaluation] = await Promise.all([
  readJson(datasetOutputPath, 'written park evaluation dataset'),
  readJson(evaluationOutputPath, 'written park evaluation'),
]);
if (writtenDataset.value.datasetSha256 !== dataset.datasetSha256) {
  throw new Error('written park evaluation dataset identity changed.');
}
if (writtenEvaluation.value.evaluationSha256 !== evaluation.evaluationSha256) {
  throw new Error('written park evaluation identity changed.');
}

console.log('=== M8.5 PARK MODEL EVALUATION COMPLETE ===');
console.log(`Resolved dataset: ${resolvedPath}`);
console.log(`Venue audit: ${venueAuditPath}`);
console.log(`Frozen-base parity: ${frozenBaseParityPath}`);
console.log(`Park fit observations: ${dataset.periods.fit.rowCount}`);
console.log(`Park validation observations: ${dataset.periods.validation.rowCount}`);
console.log(`Exact venues: ${dataset.venues.length}`);
console.log(`Excluded missing-hand rows: ${dataset.exclusions.length}`);
console.log(`Decision: ${evaluation.decision}`);
console.log(`Selected candidate: ${evaluation.selectedCandidateId ?? 'none'}`);
console.log(
  `Identity fixed categorical log loss: ${evaluation.identityFixedMetrics.categoricalLogLoss}`,
);
console.log(
  `Identity fixed Hit log loss: ${evaluation.identityFixedMetrics.hitLogLoss}`,
);
console.log(
  `Identity walk-forward categorical log loss: ${evaluation.identityWalkForwardMetrics.categoricalLogLoss}`,
);
console.log(
  `Identity walk-forward Hit log loss: ${evaluation.identityWalkForwardMetrics.hitLogLoss}`,
);
if (evaluation.selectedFixedMetrics !== null) {
  console.log(
    `Selected fixed categorical log loss: ${evaluation.selectedFixedMetrics.categoricalLogLoss}`,
  );
  console.log(
    `Selected fixed Hit log loss: ${evaluation.selectedFixedMetrics.hitLogLoss}`,
  );
  console.log(
    `Selected walk-forward categorical log loss: ${evaluation.selectedWalkForwardMetrics.categoricalLogLoss}`,
  );
  console.log(
    `Selected walk-forward Hit log loss: ${evaluation.selectedWalkForwardMetrics.hitLogLoss}`,
  );
}
console.log(`Dataset SHA-256: ${dataset.datasetSha256}`);
console.log(`Evaluation SHA-256: ${evaluation.evaluationSha256}`);
console.log(`Dataset output: ${datasetOutputPath}`);
console.log(`Evaluation output: ${evaluationOutputPath}`);
console.log('Park transformation applied to validation scoring: true');
console.log('Selected-side input used: false');
console.log('Direct probability adjustment used: false');
console.log('Prior-season rows used: false');
console.log('Production enabled: false');
console.log('Ranking enabled: false');
console.log('Untouched-test rows accessed: false');
