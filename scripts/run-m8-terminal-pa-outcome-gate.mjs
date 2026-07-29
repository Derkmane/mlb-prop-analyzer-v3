import { access, readFile, readdir } from 'node:fs/promises';
import path from 'node:path';

import {
  buildM8TerminalPaOutcomeArtifact,
  verifyM8TerminalPaOutcomeArtifact,
} from './m8-terminal-pa-outcome-artifact-utils.mjs';
import { sha256, writeJsonAtomic } from './provider-probe-utils.mjs';

const SEARCH_ROOT = process.env.M8_ARTIFACT_SEARCH_ROOT?.trim() || 'artifacts';
const OUTPUT_PATH =
  process.env.M8_TERMINAL_PA_OUTCOME_ARTIFACT_OUTPUT_PATH?.trim() ||
  'model-artifacts/m8-terminal-pa-outcome-v1.json';

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

function isDataset(value) {
  return (
    value?.datasetVersion === 3 &&
    typeof value?.datasetSha256 === 'string' &&
    value?.periods?.fit?.rows !== undefined &&
    value?.periods?.validation?.rows !== undefined &&
    value?.untouchedTestReservation?.rowsIncluded === false
  );
}

function isPlatoonEvaluation(value) {
  return (
    value?.platoonEvaluationVersion === 1 &&
    typeof value?.platoonEvaluationSha256 === 'string' &&
    typeof value?.sourceDatasetSha256 === 'string' &&
    value?.selection?.selectedCandidate !== undefined &&
    value?.untouchedTestReservation?.rowsIncluded === false
  );
}

await access(SEARCH_ROOT);
const files = await walk(SEARCH_ROOT);
const datasets = [];
const evaluations = [];
for (const filePath of files) {
  const item = await readJson(filePath);
  if (isDataset(item.value)) datasets.push(item);
  if (isPlatoonEvaluation(item.value)) evaluations.push(item);
}
const matches = [];
for (const dataset of datasets) {
  for (const evaluation of evaluations) {
    if (evaluation.value.sourceDatasetSha256 === dataset.value.datasetSha256) {
      matches.push({ dataset, evaluation });
    }
  }
}
if (matches.length !== 1) {
  throw new Error(
    `Expected exactly one resolved categorical dataset and selected platoon evaluation pair under ${SEARCH_ROOT}; found ${matches.length}.`,
  );
}
const match = matches[0];
console.log(`Resolved dataset: ${match.dataset.path}`);
console.log(`Platoon evaluation: ${match.evaluation.path}`);
const artifact = buildM8TerminalPaOutcomeArtifact({
  rawDataset: match.dataset.value,
  datasetFileSha256: sha256(match.dataset.text),
  rawPlatoonEvaluation: match.evaluation.value,
  platoonEvaluationFileSha256: sha256(match.evaluation.text),
});
verifyM8TerminalPaOutcomeArtifact(artifact);
await writeJsonAtomic(OUTPUT_PATH, artifact);
const persisted = await readJson(OUTPUT_PATH);
verifyM8TerminalPaOutcomeArtifact(persisted.value);
if (persisted.value.artifactSha256 !== artifact.artifactSha256) {
  throw new Error('persisted terminal PA artifact identity changed after writing.');
}
console.log('=== M8 TERMINAL PA OUTCOME REAL-DATA GATE PASSED ===');
console.log(`Active season: ${artifact.activeSeason}`);
console.log(`Fit rows: ${artifact.rowCounts.fit}`);
console.log(`Validation rows: ${artifact.rowCounts.validation}`);
console.log(`Frozen batters: ${Object.keys(artifact.batterOverall).length}`);
console.log(`Frozen pitchers: ${Object.keys(artifact.pitcherAllowed).length}`);
console.log(`Selected coherent model: ${match.evaluation.value.baseParameters.selectedCandidateId}`);
console.log(`Selected platoon model: ${artifact.selectedPlatoonCandidate.candidateId}`);
console.log(`Artifact SHA-256: ${artifact.artifactSha256}`);
console.log(`Tracked artifact: ${OUTPUT_PATH}`);
console.log('Production enabled: false');
console.log('Untouched-test rows accessed: false');
