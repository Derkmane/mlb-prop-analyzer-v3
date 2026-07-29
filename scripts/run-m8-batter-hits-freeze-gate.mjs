import { access, readFile, readdir } from 'node:fs/promises';
import path from 'node:path';

import { selectUniqueArtifactCopy } from './m8-artifact-pair-selection-utils.mjs';
import {
  buildM8FrozenBatterHitsCandidate,
  verifyM8FrozenBatterHitsCandidate,
} from './m8-batter-hits-frozen-candidate-utils.mjs';
import { buildM8StarterBullpenDataset } from './m8-starter-bullpen-transition-utils.mjs';
import { writeJsonAtomic } from './provider-probe-utils.mjs';

const SEARCH_ROOT = process.env.M8_ARTIFACT_SEARCH_ROOT?.trim() || 'artifacts';
const SHARED_PATH =
  process.env.M8_SHARED_ENVIRONMENT_V2_PATH?.trim() ||
  'model-artifacts/m8-shared-offensive-environment-v2.json';
const RETENTION_PATH =
  process.env.M8_STARTER_RETENTION_ARTIFACT_PATH?.trim() ||
  'model-artifacts/m8-starter-retention-v1.json';
const TERMINAL_PATH =
  process.env.M8_TERMINAL_PA_OUTCOME_ARTIFACT_PATH?.trim() ||
  'model-artifacts/m8-terminal-pa-outcome-v1.json';
const OUTPUT_PATH =
  process.env.M8_BATTER_HITS_COMPLETE_CANDIDATE_OUTPUT_PATH?.trim() ||
  'model-artifacts/m8-batter-hits-complete-candidate-v1.json';

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

await Promise.all([
  access(SEARCH_ROOT),
  access(SHARED_PATH),
  access(RETENTION_PATH),
  access(TERMINAL_PATH),
]);
const [shared, retention, terminal] = await Promise.all([
  readJson(SHARED_PATH),
  readJson(RETENTION_PATH),
  readJson(TERMINAL_PATH),
]);
const files = await walk(SEARCH_ROOT);
const resolvedDatasets = [];
for (const filePath of files) {
  const item = await readJson(filePath);
  if (isResolvedDataset(item.value)) resolvedDatasets.push(item);
}
const resolved = selectUniqueArtifactCopy(resolvedDatasets, {
  label: 'resolved dataset',
  identityField: 'datasetSha256',
});
const transitionDataset = buildM8StarterBullpenDataset(resolved.value);
const fitBullpenRows = transitionDataset.periods.fit.rows.flatMap((row) =>
  row.bullpenRows
    .filter(
      (bullpenRow) =>
        bullpenRow.normalizedPitcherHand === 'L' ||
        bullpenRow.normalizedPitcherHand === 'R',
    )
    .map((bullpenRow) => ({
      pitcherHand: bullpenRow.normalizedPitcherHand,
      terminalCategory: bullpenRow.terminalCategory,
    })),
);
if (fitBullpenRows.length === 0) {
  throw new Error('fit period contains no usable bullpen terminal PA rows.');
}

const candidate = buildM8FrozenBatterHitsCandidate({
  sharedEnvironmentArtifact: shared.value,
  starterRetentionArtifact: retention.value,
  terminalOutcomeArtifact: terminal.value,
  fitBullpenRows,
});
verifyM8FrozenBatterHitsCandidate(candidate);
await writeJsonAtomic(OUTPUT_PATH, candidate);
const persisted = await readJson(OUTPUT_PATH);
verifyM8FrozenBatterHitsCandidate(persisted.value);
if (persisted.value.artifactSha256 !== candidate.artifactSha256) {
  throw new Error('persisted complete Batter Hits candidate changed after writing.');
}

console.log('=== M8 COMPLETE BATTER HITS CANDIDATE FROZEN ===');
console.log(`Resolved fit-validation dataset: ${resolved.path}`);
console.log(`Equivalent resolved dataset copies found: ${resolvedDatasets.length}`);
console.log(`Shared environment: ${SHARED_PATH}`);
console.log(`Starter retention: ${RETENTION_PATH}`);
console.log(`Terminal outcome: ${TERMINAL_PATH}`);
console.log(`Fit bullpen terminal rows: ${fitBullpenRows.length}`);
console.log(`Bullpen L-hand weight: ${candidate.bullpenModel.handWeights.L}`);
console.log(`Bullpen R-hand weight: ${candidate.bullpenModel.handWeights.R}`);
console.log(`Environment coefficient fixed before test: ${candidate.environmentEffectPolicy.coefficient}`);
console.log(`Artifact SHA-256: ${candidate.artifactSha256}`);
console.log(`Tracked artifact: ${OUTPUT_PATH}`);
console.log('Production enabled: false');
console.log('Untouched-test rows accessed: false');
