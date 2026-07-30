import { access, readFile, readdir } from 'node:fs/promises';
import path from 'node:path';

import { selectBestArtifactPair } from './m8-artifact-pair-selection-utils.mjs';
import {
  evaluateM8ParkEffect,
  verifyM8ParkEffectEvaluation,
} from './m8-park-effect-evaluation-utils.mjs';
import { verifyM8ParkVenueLineage } from './m8-park-venue-lineage-utils.mjs';
import { sha256, writeJsonAtomic } from './provider-probe-utils.mjs';

const SEARCH_ROOT = process.env.M8_ARTIFACT_SEARCH_ROOT?.trim() || 'artifacts';
const VENUE_LINEAGE_PATH =
  process.env.M8_PARK_VENUE_LINEAGE_PATH?.trim() ||
  'artifacts/m8-park-venue-lineage/m8-park-venue-lineage-v1.json';
const OUTPUT_PATH =
  process.env.M8_PARK_EFFECT_EVALUATION_OUTPUT_PATH?.trim() ||
  'artifacts/m8-park-effect/m8-park-effect-evaluation-v1.json';

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
const venueLineage = await readJson(VENUE_LINEAGE_PATH);
verifyM8ParkVenueLineage(venueLineage.value);

const files = await walk(SEARCH_ROOT);
const datasets = [];
const evaluations = [];
for (const filePath of files) {
  if (path.resolve(filePath) === path.resolve(VENUE_LINEAGE_PATH)) continue;
  const item = await readJson(filePath);
  if (isDataset(item.value)) datasets.push(item);
  if (isPlatoonEvaluation(item.value)) evaluations.push(item);
}

const matches = [];
for (const dataset of datasets) {
  if (dataset.value.datasetSha256 !== venueLineage.value.sourceResolvedDatasetSha256) continue;
  for (const evaluation of evaluations) {
    if (evaluation.value.sourceDatasetSha256 === dataset.value.datasetSha256) {
      matches.push({ dataset, evaluation });
    }
  }
}
const boundaryMatches = matches.filter((match) => {
  const normalized = match.evaluation.path.toLowerCase();
  return normalized.includes('platoon') && normalized.includes('boundary');
});
const selectedMatches = boundaryMatches.length > 0 ? boundaryMatches : matches;
const selection = selectBestArtifactPair(selectedMatches);
const match = selection.selectedMatch;

console.log('=== M8 PARK EFFECT EVALUATION ===');
console.log(`Resolved dataset: ${match.dataset.path}`);
console.log(`Venue lineage: ${venueLineage.path}`);
console.log(`Platoon evaluation: ${match.evaluation.path}`);
console.log(`Platoon candidate: ${match.evaluation.value.selection.selectedCandidate.candidateId}`);

const evaluation = evaluateM8ParkEffect({
  rawDataset: match.dataset.value,
  datasetFileSha256: sha256(match.dataset.text),
  rawVenueLineage: venueLineage.value,
  venueLineageFileSha256: sha256(venueLineage.text),
  rawPlatoonEvaluation: match.evaluation.value,
  platoonEvaluationFileSha256: sha256(match.evaluation.text),
});
verifyM8ParkEffectEvaluation(evaluation);
await writeJsonAtomic(OUTPUT_PATH, evaluation);
const persisted = await readJson(OUTPUT_PATH);
verifyM8ParkEffectEvaluation(persisted.value);
if (persisted.value.evaluationSha256 !== evaluation.evaluationSha256) {
  throw new Error('persisted park evaluation identity changed after writing.');
}

console.log(`Fit observations: ${evaluation.cohorts.fitObservationCount}`);
console.log(`Validation observations: ${evaluation.cohorts.validationObservationCount}`);
console.log(`Fit venue-hand cells: ${evaluation.cohorts.fitVenueHandCellCount}`);
console.log(`Validation venue-hand cells: ${evaluation.cohorts.validationVenueHandCellCount}`);
console.log(`Walk-forward folds: ${evaluation.walkForward.foldCount}`);
console.log(
  `Fixed nondominated: ${evaluation.selection.fixedNondominatedCandidateIds.join(', ')}`,
);
console.log(
  `Walk-forward nondominated: ${evaluation.selection.walkForwardNondominatedCandidateIds.join(', ')}`,
);
console.log(`Stable candidates: ${evaluation.selection.stableCandidateIds.join(', ') || 'none'}`);
console.log(
  `Selected park candidate: ${evaluation.selection.selectedCandidate?.candidateId ?? 'none'}`,
);
console.log(`Selection status: ${evaluation.selection.status}`);
for (const result of evaluation.fixedValidation.results) {
  console.log(
    `Fixed ${result.candidate.candidateId}: categorical log loss=${result.categoricalLogLoss}, categorical Brier=${result.categoricalBrierScore}, Hit log loss=${result.hitLogLoss}, Hit Brier=${result.hitBrierScore}`,
  );
}
for (const result of evaluation.walkForward.aggregateResults) {
  console.log(
    `Walk ${result.candidate.candidateId}: categorical log loss=${result.categoricalLogLoss}, categorical Brier=${result.categoricalBrierScore}, Hit log loss=${result.hitLogLoss}, Hit Brier=${result.hitBrierScore}`,
  );
}
console.log(`Evaluation SHA-256: ${evaluation.evaluationSha256}`);
console.log(`Output: ${OUTPUT_PATH}`);
console.log('Production enabled: false');
console.log('Untouched-test rows accessed: false');
