import { mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';

import { selectUniqueArtifactCopy } from './m8-artifact-pair-selection-utils.mjs';
import { assertM8UntouchedAccessOpen } from './m8-untouched-access-gate-utils.mjs';

const accessGate = assertM8UntouchedAccessOpen();
console.log(`Untouched acceptance access opened: ${accessGate.openedAt}`);

const ORIGINAL_SEARCH_ROOT =
  process.env.M8_ARTIFACT_SEARCH_ROOT?.trim() || 'artifacts';
const SELECTION_ROOT =
  process.env.M8_UNTOUCHED_PARTITION_SELECTION_ROOT?.trim() ||
  'artifacts/m8-untouched-partition-selection';

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
    if (entry.name === 'node_modules' || entry.name === 'dist' || entry.name === '.git') {
      continue;
    }
    const fullPath = path.join(directory, entry.name);
    if (entry.isDirectory()) await walk(fullPath, results);
    else if (entry.name.endsWith('.json')) results.push(fullPath);
  }
  return results;
}

function isPartitionManifest(value) {
  return (
    value?.partitionVersion === 1 &&
    typeof value?.evidenceSetSha256 === 'string' &&
    Array.isArray(value?.periods?.test?.shards) &&
    value?.selectionBoundary?.testMetricsForbiddenDuringCandidateSelection === true
  );
}

const partitions = [];
for (const filePath of await walk(ORIGINAL_SEARCH_ROOT)) {
  const item = await readJson(filePath);
  if (isPartitionManifest(item.value)) partitions.push(item);
}
const selected = selectUniqueArtifactCopy(partitions, {
  label: 'chronological partition',
  identityField: 'evidenceSetSha256',
});

await rm(SELECTION_ROOT, { recursive: true, force: true });
await mkdir(SELECTION_ROOT, { recursive: true });
const selectedPath = path.join(SELECTION_ROOT, 'partition-manifest.json');
await writeFile(selectedPath, selected.text, 'utf8');
process.env.M8_ARTIFACT_SEARCH_ROOT = SELECTION_ROOT;

console.log(`Selected chronological partition: ${selected.path}`);
console.log(`Equivalent partition copies found: ${partitions.length}`);
console.log(`Isolated partition manifest: ${selectedPath}`);

await import('./run-m8-batter-hits-untouched-test.mjs');
