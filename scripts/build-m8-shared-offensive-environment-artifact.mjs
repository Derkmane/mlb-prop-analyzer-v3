import { createHash } from 'node:crypto';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import path from 'node:path';

import {
  buildM8SharedOffensiveEnvironmentArtifact,
  verifyM8SharedOffensiveEnvironmentArtifact,
} from './m8-shared-offensive-environment-artifact-utils.mjs';

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

const datasetPath = requiredPath('M8_TEAM_OFFENSIVE_ENVIRONMENT_DATASET_PATH');
const evaluationPath = requiredPath('M8_SHARED_OFFENSIVE_ENVIRONMENT_EVALUATION_PATH');
const walkForwardPath = requiredPath('M8_SHARED_OFFENSIVE_ENVIRONMENT_WALK_FORWARD_PATH');
const outputPath = requiredPath(
  'M8_SHARED_OFFENSIVE_ENVIRONMENT_BENCHMARK_ARTIFACT_OUTPUT_PATH',
);

const [datasetText, evaluationText, walkForwardText] = await Promise.all([
  readFile(datasetPath, 'utf8'),
  readFile(evaluationPath, 'utf8'),
  readFile(walkForwardPath, 'utf8'),
]);

const artifact = buildM8SharedOffensiveEnvironmentArtifact({
  rawDataset: JSON.parse(datasetText),
  datasetFileSha256: sha256(datasetText),
  rawEvaluation: JSON.parse(evaluationText),
  evaluationFileSha256: sha256(evaluationText),
  rawWalkForward: JSON.parse(walkForwardText),
  walkForwardFileSha256: sha256(walkForwardText),
});
verifyM8SharedOffensiveEnvironmentArtifact(artifact);

const outputText = `${JSON.stringify(artifact, null, 2)}\n`;
const outputDirectory = path.dirname(outputPath);
const temporaryPath = `${outputPath}.tmp`;
await mkdir(outputDirectory, { recursive: true });
await writeFile(temporaryPath, outputText, 'utf8');
await rename(temporaryPath, outputPath);

console.log('=== M8 SHARED OFFENSIVE-ENVIRONMENT BENCHMARK ARTIFACT COMPLETE ===');
console.log(`Active season: ${artifact.activeSeason}`);
console.log(`Status: ${artifact.status}`);
console.log(`Selected candidate: ${artifact.selectedCandidateId}`);
console.log(`Scenario count: ${artifact.scenarioCount}`);
console.log(`Scenario count permanently fixed: ${artifact.scenarioCountPolicy.permanentFixedCount}`);
console.log(`Frozen scenarios: ${artifact.scenarios.length}`);
console.log(
  `Holdout validation games: ${artifact.validationEvidence.holdout.selected.gameCount}`,
);
console.log(
  `Walk-forward validation games: ${artifact.validationEvidence.walkForward.validationGameCount}`,
);
console.log(`Walk-forward folds: ${artifact.validationEvidence.walkForward.foldCount}`);
console.log(
  `Walk-forward relative improvement vs K=1: ${artifact.validationEvidence.walkForward.relativeJointLogLossImprovement}`,
);
console.log(`Artifact SHA-256: ${artifact.artifactSha256}`);
console.log(`Output: ${outputPath}`);
console.log('Production enabled: false');
console.log('Untouched-test rows accessed: false');
