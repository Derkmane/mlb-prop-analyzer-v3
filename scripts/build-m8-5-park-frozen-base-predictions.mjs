import { createHash } from 'node:crypto';
import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';

import { writeJsonAtomic } from './provider-probe-utils.mjs';
import {
  verifyAndBuildM8_5ParkFrozenBasePredictions,
} from './m8-5-park-frozen-base-prediction-utils.mjs';

function requireEnvironmentValue(name) {
  const value = process.env[name]?.trim();
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

async function readJson(filePath, label = filePath) {
  const text = await readFile(filePath, 'utf8');
  try {
    return { path: filePath, text, value: JSON.parse(text) };
  } catch {
    throw new Error(`${label} is not valid JSON.`);
  }
}

function sha256(text) {
  return createHash('sha256').update(text).digest('hex');
}

async function discoverResolvedDataset({
  root,
  expectedDatasetSha256,
  expectedFileSha256,
}) {
  const entries = await readdir(root, { withFileTypes: true });
  const matches = [];
  for (const entry of entries) {
    if (!entry.isFile() || !entry.name.endsWith('.json')) continue;
    const candidatePath = path.join(root, entry.name);
    const text = await readFile(candidatePath, 'utf8');
    if (sha256(text) !== expectedFileSha256) continue;
    let value;
    try {
      value = JSON.parse(text);
    } catch {
      continue;
    }
    if (
      value?.datasetVersion === 3 &&
      value?.datasetSha256 === expectedDatasetSha256
    ) {
      matches.push({ path: candidatePath, text, value });
    }
  }
  if (matches.length !== 1) {
    throw new Error(
      `expected exactly one resolved categorical dataset matching frozen lineage; found ${matches.length}.`,
    );
  }
  return matches[0];
}

const outputPath = requireEnvironmentValue(
  'M8_5_PARK_FROZEN_BASE_PREDICTIONS_OUTPUT_PATH',
);
const freezePath = 'model-artifacts/m8-batter-hits-runtime-freeze-v1.json';
const freezeFile = await readJson(freezePath, 'frozen M8 runtime manifest');
const coherentComponent = freezeFile.value?.fittedComponents?.coherentMatchup;
const platoonComponent = freezeFile.value?.fittedComponents?.platoon;
if (!coherentComponent || !platoonComponent) {
  throw new Error('frozen M8 runtime manifest is missing coherent or platoon evidence.');
}

const fixedPath = coherentComponent.fixedValidation?.sourcePath;
const platoonPath = platoonComponent.fixedValidation?.sourcePath;
const platoonWalkForwardPath = platoonComponent.walkForward?.sourcePath;
for (const [label, value] of [
  ['fixed categorical evaluation path', fixedPath],
  ['platoon evaluation path', platoonPath],
  ['platoon walk-forward path', platoonWalkForwardPath],
]) {
  if (typeof value !== 'string' || value.length === 0) {
    throw new Error(`${label} is missing from the frozen M8 runtime manifest.`);
  }
}

const [fixedFile, platoonFile, platoonWalkForwardFile] = await Promise.all([
  readJson(fixedPath, 'fixed categorical evaluation'),
  readJson(platoonPath, 'platoon boundary evaluation'),
  readJson(platoonWalkForwardPath, 'platoon walk-forward evaluation'),
]);
const explicitDatasetPath =
  process.env.M8_RESOLVED_CATEGORICAL_DATASET_PATH?.trim() || null;
const datasetFile = explicitDatasetPath
  ? await readJson(explicitDatasetPath, 'resolved categorical dataset')
  : await discoverResolvedDataset({
      root: 'artifacts/m8-current-season-pa',
      expectedDatasetSha256: fixedFile.value.sourceDatasetSha256,
      expectedFileSha256: fixedFile.value.sourceDatasetFileSha256,
    });
const { TERMINAL_PA_CATEGORIES } = await import(
  new URL('../dist/src/domain/terminal-pa.js', import.meta.url),
);

const parity = verifyAndBuildM8_5ParkFrozenBasePredictions({
  dataset: datasetFile.value,
  datasetText: datasetFile.text,
  fixedEvaluation: fixedFile.value,
  fixedEvaluationText: fixedFile.text,
  platoonEvaluation: platoonFile.value,
  platoonEvaluationText: platoonFile.text,
  platoonWalkForwardEvaluation: platoonWalkForwardFile.value,
  closeoutFreeze: freezeFile.value,
  closeoutFreezeText: freezeFile.text,
  canonicalCategories: TERMINAL_PA_CATEGORIES,
  hitCategories: ['1B', '2B', '3B', 'HR'],
});
await writeJsonAtomic(outputPath, parity);
const written = await readJson(outputPath, 'written frozen base predictions');
if (
  written.value.paritySha256 !== parity.paritySha256 ||
  written.value.predictionSha256 !== parity.predictionSha256
) {
  throw new Error('written frozen base prediction identities changed.');
}

console.log('=== M8.5 PARK FROZEN-BASE PARITY COMPLETE ===');
console.log(`Resolved dataset: ${datasetFile.path}`);
console.log(`Fixed evaluation: ${fixedPath}`);
console.log(`Platoon evaluation: ${platoonPath}`);
console.log(`Platoon walk-forward: ${platoonWalkForwardPath}`);
console.log(`Validation predictions: ${parity.predictions.length}`);
console.log(
  `Coherent categorical log loss: ${parity.coherentMetrics.categoricalLogLoss}`,
);
console.log(
  `Platoon categorical log loss: ${parity.platoonMetrics.categoricalLogLoss}`,
);
console.log(
  `Final base categorical log loss: ${parity.finalBaseMetrics.categoricalLogLoss}`,
);
console.log(`Prediction SHA-256: ${parity.predictionSha256}`);
console.log(`Parity SHA-256: ${parity.paritySha256}`);
console.log(`Output: ${outputPath}`);
console.log('Frozen coherent parity matched: true');
console.log('Frozen platoon parity matched: true');
console.log('Park adjustment applied: false');
console.log('Selected-side input used: false');
console.log('Direct probability adjustment used: false');
console.log('Production enabled: false');
console.log('Ranking enabled: false');
console.log('Untouched-test rows accessed: false');