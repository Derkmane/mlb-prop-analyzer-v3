import { readFile } from 'node:fs/promises';

import { sha256, writeJsonAtomic } from './provider-probe-utils.mjs';
import {
  buildM8StarterRetentionArtifact,
  verifyM8StarterRetentionArtifact,
} from './m8-starter-retention-artifact-utils.mjs';

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
const evaluationPath = requireEnvironmentValue(
  'M8_STARTER_RETENTION_EVALUATION_PATH',
);
const outputPath = requireEnvironmentValue(
  'M8_STARTER_RETENTION_ARTIFACT_OUTPUT_PATH',
);
const dataset = await readJson(datasetPath, 'starter retention dataset');
const evaluation = await readJson(
  evaluationPath,
  'starter retention evaluation',
);
const artifact = buildM8StarterRetentionArtifact({
  rawDataset: dataset.value,
  datasetFileSha256: sha256(dataset.text),
  rawEvaluation: evaluation.value,
  evaluationFileSha256: sha256(evaluation.text),
});
await writeJsonAtomic(outputPath, artifact);
const written = await readJson(outputPath, 'written starter retention artifact');
verifyM8StarterRetentionArtifact(written.value);
if (written.value.artifactSha256 !== artifact.artifactSha256) {
  throw new Error('written starter retention artifact changed after persistence.');
}

console.log('=== M8 STARTER RETENTION ARTIFACT COMPLETE ===');
console.log(`Model version: ${artifact.modelVersion}`);
console.log(`Status: ${artifact.status}`);
console.log(`Production enabled: ${artifact.productionEnabled}`);
console.log(`Selected candidate: ${artifact.selectedCandidate.candidateId}`);
console.log(`Grouping: ${artifact.selectedCandidate.grouping}`);
console.log(`Maximum turn: ${artifact.turnMaximum}`);
console.log(
  `Frozen groups: ${Object.keys(artifact.conditionalRetentionByGroup).length}`,
);
console.log(`Artifact SHA-256: ${artifact.artifactSha256}`);
console.log(`Output: ${outputPath}`);
console.log('Untouched-test rows accessed: false');
