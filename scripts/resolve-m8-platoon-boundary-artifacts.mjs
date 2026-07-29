import { access, readFile, readdir, unlink } from 'node:fs/promises';
import path from 'node:path';

const SEARCH_ROOT = process.env.M8_ARTIFACT_SEARCH_ROOT?.trim() || 'artifacts';

async function walk(directory, results = []) {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    if (entry.name === 'node_modules' || entry.name === 'dist' || entry.name === '.git') continue;
    const fullPath = path.join(directory, entry.name);
    if (entry.isDirectory()) await walk(fullPath, results);
    else if (entry.name.endsWith('.json')) results.push(fullPath);
  }
  return results;
}

function isBoundaryEvaluation(filePath, value) {
  const normalized = filePath.toLowerCase();
  return (
    normalized.includes('platoon') &&
    normalized.includes('boundary') &&
    value?.platoonEvaluationVersion === 1 &&
    typeof value?.platoonEvaluationSha256 === 'string' &&
    typeof value?.sourceDatasetSha256 === 'string' &&
    value?.selection?.selectedCandidate &&
    Number.isFinite(value?.selection?.validationCategoricalLogLoss) &&
    typeof value?.cohorts?.validationObservationIdsSha256 === 'string' &&
    value?.untouchedTestReservation?.rowsIncluded === false
  );
}

await access(SEARCH_ROOT);
const candidates = [];
for (const filePath of await walk(SEARCH_ROOT)) {
  let value;
  try {
    value = JSON.parse(await readFile(filePath, 'utf8'));
  } catch {
    continue;
  }
  if (isBoundaryEvaluation(filePath, value)) {
    candidates.push({ filePath, value });
  }
}

if (candidates.length < 2) {
  throw new Error(`Expected at least two M8 platoon-boundary evaluations under ${SEARCH_ROOT}; found ${candidates.length}.`);
}

const datasetIds = new Set(candidates.map(({ value }) => value.sourceDatasetSha256));
const cohortIds = new Set(
  candidates.map(({ value }) => value.cohorts.validationObservationIdsSha256),
);
if (datasetIds.size !== 1 || cohortIds.size !== 1) {
  throw new Error(
    `Boundary evaluations do not share one dataset and validation cohort; datasets=${datasetIds.size}, cohorts=${cohortIds.size}.`,
  );
}

const ranked = candidates.slice().sort((left, right) => {
  const lossDifference =
    left.value.selection.validationCategoricalLogLoss -
    right.value.selection.validationCategoricalLogLoss;
  if (Math.abs(lossDifference) > 1e-12) return lossDifference;
  return left.filePath.localeCompare(right.filePath);
});
const keep = ranked[0];
const tied = ranked.filter(
  ({ value }) =>
    Math.abs(
      value.selection.validationCategoricalLogLoss -
        keep.value.selection.validationCategoricalLogLoss,
    ) <= 1e-12,
);
if (
  new Set(tied.map(({ value }) => value.selection.selectedCandidate.candidateId)).size > 1
) {
  throw new Error('Best boundary evaluations tie on validation loss but select different candidates.');
}

console.log('=== M8 PLATOON BOUNDARY CLEANUP ===');
for (const { filePath, value } of ranked) {
  console.log(
    `${filePath} | candidate=${value.selection.selectedCandidate.candidateId} | categoricalLogLoss=${value.selection.validationCategoricalLogLoss} | sha=${value.platoonEvaluationSha256}`,
  );
}
console.log(`Keeping: ${keep.filePath}`);

for (const stale of ranked.slice(1)) {
  await unlink(stale.filePath);
  console.log(`Deleted stale boundary evaluation: ${stale.filePath}`);
}

console.log('Boundary cleanup complete. Exactly one approved evaluation remains.');
