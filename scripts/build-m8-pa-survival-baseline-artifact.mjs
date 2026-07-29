import { createHash } from 'node:crypto';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import path from 'node:path';

import {
  buildM8PaSurvivalBaselineArtifact,
  verifyM8PaSurvivalBaselineArtifact,
} from './m8-pa-survival-baseline-artifact-utils.mjs';

function sha256(value) {
  return createHash('sha256').update(value).digest('hex');
}

function requiredPath(name) {
  const value = process.env[name];
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new Error(`${name} must be set.`);
  }
  return value.trim();
}

const datasetPath = requiredPath('M8_PA_SURVIVAL_DATASET_PATH');
const evaluationPath = requiredPath('M8_PA_SURVIVAL_EVALUATION_PATH');
const walkForwardPath = requiredPath('M8_PA_SURVIVAL_WALK_FORWARD_PATH');
const outputPath = requiredPath('M8_PA_SURVIVAL_BASELINE_ARTIFACT_OUTPUT_PATH');

const [datasetText, evaluationText, walkForwardText] = await Promise.all([
  readFile(datasetPath, 'utf8'),
  readFile(evaluationPath, 'utf8'),
  readFile(walkForwardPath, 'utf8'),
]);

const artifact = buildM8PaSurvivalBaselineArtifact({
  rawDataset: JSON.parse(datasetText),
  datasetFileSha256: sha256(datasetText),
  rawEvaluation: JSON.parse(evaluationText),
  evaluationFileSha256: sha256(evaluationText),
  rawWalkForward: JSON.parse(walkForwardText),
  walkForwardFileSha256: sha256(walkForwardText),
});
verifyM8PaSurvivalBaselineArtifact(artifact);

const outputText = `${JSON.stringify(artifact, null, 2)}\n`;
const outputDirectory = path.dirname(outputPath);
const temporaryPath = `${outputPath}.tmp`;
await mkdir(outputDirectory, { recursive: true });
await writeFile(temporaryPath, outputText, 'utf8');
await rename(temporaryPath, outputPath);

console.log('=== M8 HITTER PA-SURVIVAL BASELINE ARTIFACT COMPLETE ===');
console.log(`Active season: ${artifact.activeSeason}`);
console.log(`Status: ${artifact.status}`);
console.log(`Selected candidate: ${artifact.selectedCandidateId}`);
console.log(`Grouping: ${artifact.grouping}`);
console.log(`League-equivalent observations: ${artifact.leagueEquivalentObservations}`);
console.log(
  `PA-count support: ${artifact.countSupport.minimum} through ${artifact.countSupport.maximum}`,
);
console.log(`Frozen groups: ${artifact.groups.length}`);
console.log(
  `Holdout validation observations: ${artifact.validationEvidence.holdoutValidationObservationCount}`,
);
console.log(
  `Walk-forward validation observations: ${artifact.validationEvidence.walkForwardValidationObservationCount}`,
);
console.log(`Artifact SHA-256: ${artifact.artifactSha256}`);
console.log(`Output: ${outputPath}`);
console.log('Production enabled: false');
console.log('Untouched-test rows accessed: false');
