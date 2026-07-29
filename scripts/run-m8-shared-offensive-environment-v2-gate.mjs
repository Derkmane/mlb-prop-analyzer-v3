import { access, readFile, readdir } from 'node:fs/promises';
import path from 'node:path';

import { selectUniqueArtifactCopy } from './m8-artifact-pair-selection-utils.mjs';
import {
  buildM8SharedOffensiveEnvironmentV2,
  verifyM8SharedOffensiveEnvironmentV2,
} from './m8-shared-offensive-environment-v2-utils.mjs';
import {
  buildM8StarterBullpenDataset,
  evaluateM8StarterBullpenTransition,
  verifyM8StarterBullpenEvaluation,
} from './m8-starter-bullpen-transition-utils.mjs';
import { sha256, writeJsonAtomic } from './provider-probe-utils.mjs';

const SEARCH_ROOT = process.env.M8_ARTIFACT_SEARCH_ROOT?.trim() || 'artifacts';
const OUTPUT_ROOT =
  process.env.M8_STARTER_BULLPEN_OUTPUT_ROOT?.trim() ||
  'artifacts/m8-starter-bullpen-transition';
const FINAL_ARTIFACT_PATH =
  process.env.M8_SHARED_ENVIRONMENT_V2_OUTPUT_PATH?.trim() ||
  'model-artifacts/m8-shared-offensive-environment-v2.json';

async function readJson(filePath) {
  const text = await readFile(filePath, 'utf8');
  try {
    return { path: filePath, text, value: JSON.parse(text) };
  } catch {
    throw new Error(`${filePath} is not valid JSON.`);
  }
}

async function walk(directory, results = []) {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    if (entry.name === 'node_modules' || entry.name === 'dist' || entry.name === '.git') continue;
    const fullPath = path.join(directory, entry.name);
    if (entry.isDirectory()) await walk(fullPath, results);
    else if (entry.name.endsWith('.json')) results.push(fullPath);
  }
  return results;
}

function isResolvedDataset(value) {
  return (
    value?.datasetVersion === 3 &&
    typeof value?.datasetSha256 === 'string' &&
    value?.periods?.fit?.rows !== undefined &&
    value?.periods?.validation?.rows !== undefined &&
    value?.untouchedTestReservation?.rowsIncluded === false
  );
}

function isSharedV1(value) {
  return (
    value?.artifactVersion === 1 &&
    value?.selectedCandidateId === 'shared-environment-k4' &&
    value?.scenarioCount === 4 &&
    typeof value?.artifactSha256 === 'string' &&
    value?.productionEnabled === false
  );
}

await access(SEARCH_ROOT);
const files = await walk(SEARCH_ROOT);
const datasets = [];
const sharedArtifacts = [];
for (const filePath of files) {
  const item = await readJson(filePath);
  if (isResolvedDataset(item.value)) datasets.push(item);
  if (isSharedV1(item.value)) sharedArtifacts.push(item);
}
const datasetRead = selectUniqueArtifactCopy(datasets, {
  label: 'resolved dataset',
  identityField: 'datasetSha256',
});
const sharedRead = selectUniqueArtifactCopy(sharedArtifacts, {
  label: 'shared-environment v1',
  identityField: 'artifactSha256',
});
console.log(`Resolved dataset: ${datasetRead.path}`);
console.log(`Equivalent resolved dataset copies found: ${datasets.length}`);
console.log(`Shared environment v1: ${sharedRead.path}`);
console.log(`Equivalent shared environment copies found: ${sharedArtifacts.length}`);

const transitionDataset = buildM8StarterBullpenDataset(datasetRead.value);
const transitionDatasetPath = path.join(OUTPUT_ROOT, 'starter-bullpen-dataset.json');
await writeJsonAtomic(transitionDatasetPath, transitionDataset);
const transitionEvaluation = evaluateM8StarterBullpenTransition({
  rawDataset: transitionDataset,
});
verifyM8StarterBullpenEvaluation(transitionEvaluation);
const transitionEvaluationPath = path.join(
  OUTPUT_ROOT,
  'starter-bullpen-evaluation.json',
);
await writeJsonAtomic(transitionEvaluationPath, transitionEvaluation);
const transitionEvaluationRead = await readJson(transitionEvaluationPath);
verifyM8StarterBullpenEvaluation(transitionEvaluationRead.value);

const artifact = buildM8SharedOffensiveEnvironmentV2({
  rawSharedEnvironmentArtifact: sharedRead.value,
  sharedEnvironmentArtifactFileSha256: sha256(sharedRead.text),
  rawStarterBullpenEvaluation: transitionEvaluationRead.value,
  starterBullpenEvaluationFileSha256: sha256(transitionEvaluationRead.text),
});
verifyM8SharedOffensiveEnvironmentV2(artifact);
await writeJsonAtomic(FINAL_ARTIFACT_PATH, artifact);
const persisted = await readJson(FINAL_ARTIFACT_PATH);
verifyM8SharedOffensiveEnvironmentV2(persisted.value);
if (persisted.value.artifactSha256 !== artifact.artifactSha256) {
  throw new Error('persisted shared environment v2 identity changed after writing.');
}

const selected = transitionEvaluation.fixedResults.find(
  (result) =>
    result.candidate.candidateId === transitionEvaluation.fixedSelectedCandidateId,
);
console.log('=== M8 SHARED OFFENSIVE ENVIRONMENT V2 REAL-DATA GATE PASSED ===');
console.log(`Included team games: ${transitionDataset.totals.includedTeamGameCount}`);
console.log(`Excluded team games: ${transitionDataset.totals.excludedTeamGameCount}`);
console.log(`Selected starter workload: ${transitionEvaluation.fixedSelectedCandidateId}`);
console.log(`Walk-forward selected: ${transitionEvaluation.walkForward.selectedCandidateId}`);
console.log(`Walk-forward folds: ${transitionEvaluation.walkForward.foldCount}`);
console.log(`Validation log loss: ${selected.metrics.logLoss}`);
console.log(`Validation Brier: ${selected.metrics.multiclassBrier}`);
console.log(`Artifact SHA-256: ${artifact.artifactSha256}`);
console.log(`Transition dataset: ${transitionDatasetPath}`);
console.log(`Transition evaluation: ${transitionEvaluationPath}`);
console.log(`Tracked artifact: ${FINAL_ARTIFACT_PATH}`);
console.log('Production enabled: false');
console.log('Untouched-test rows accessed: false');
