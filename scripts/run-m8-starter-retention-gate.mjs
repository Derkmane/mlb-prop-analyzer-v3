import { access, readFile, readdir } from 'node:fs/promises';
import path from 'node:path';

import {
  buildM8StarterRetentionArtifact,
  verifyM8StarterRetentionArtifact,
} from './m8-starter-retention-artifact-utils.mjs';
import {
  buildM8StarterRetentionDataset,
  verifyM8StarterRetentionDataset,
} from './m8-starter-retention-dataset-utils.mjs';
import {
  evaluateM8StarterRetention,
  verifyM8StarterRetentionEvaluation,
} from './m8-starter-retention-evaluation-utils.mjs';
import {
  sha256,
  writeJsonAtomic,
  writeTextAtomic,
} from './provider-probe-utils.mjs';

const SEARCH_ROOT = process.env.M8_ARTIFACT_SEARCH_ROOT?.trim() || 'artifacts';
const OUTPUT_ROOT =
  process.env.M8_STARTER_RETENTION_OUTPUT_ROOT?.trim() ||
  'artifacts/m8-starter-retention';
const FINAL_ARTIFACT_PATH =
  process.env.M8_STARTER_RETENTION_ARTIFACT_OUTPUT_PATH?.trim() ||
  'model-artifacts/m8-starter-retention-v1.json';

async function readJson(filePath, label = filePath) {
  const text = await readFile(filePath, 'utf8');
  try {
    return { path: filePath, text, value: JSON.parse(text) };
  } catch {
    throw new Error(`${label} is not valid JSON.`);
  }
}

async function walk(directory, results = []) {
  const entries = await readdir(directory, { withFileTypes: true });
  for (const entry of entries) {
    if (entry.name === 'node_modules' || entry.name === 'dist' || entry.name === '.git') {
      continue;
    }
    const fullPath = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      await walk(fullPath, results);
    } else {
      results.push(fullPath);
    }
  }
  return results;
}

function captureManifestIdentity(value) {
  return {
    manifestVersion: value.manifestVersion,
    provider: value.provider,
    sourcePlanSha256: value.sourcePlanSha256,
    sourceResolvedDatasetSha256: value.sourceResolvedDatasetSha256,
    sourceRowCount: value.sourceRowCount,
    gameCount: value.gameCount,
    includedPeriods: value.includedPeriods,
    untouchedTestReservation: value.untouchedTestReservation,
    totals: value.totals,
    games: value.games,
  };
}

function captureIdentity(value) {
  return {
    captureVersion: value.captureVersion,
    provider: value.provider,
    sourcePlanSha256: value.sourcePlanSha256,
    plannedGame: value.plannedGame,
    gameSnapshot: value.gameSnapshot,
    statsPages: value.statsPages,
    lineupPages: value.lineupPages,
    summary: value.summary,
    untouchedTestReservation: value.untouchedTestReservation,
  };
}

function isCaptureManifest(value) {
  return (
    value?.provider === 'BALLDONTLIE MLB API' &&
    Number.isSafeInteger(value?.manifestVersion) &&
    Array.isArray(value?.games) &&
    typeof value?.sourceResolvedDatasetSha256 === 'string' &&
    typeof value?.manifestSha256 === 'string'
  );
}

function isResolvedCategoricalDataset(value) {
  return (
    value?.datasetVersion === 3 &&
    typeof value?.datasetSha256 === 'string' &&
    value?.periods?.fit !== undefined &&
    value?.periods?.validation !== undefined &&
    value?.untouchedTestReservation?.rowsIncluded === false
  );
}

async function locateEvidencePair() {
  await access(SEARCH_ROOT);
  const files = await walk(SEARCH_ROOT);
  const manifestFiles = files.filter(
    (filePath) => path.basename(filePath) === 'capture-manifest.json',
  );
  const resolvedFiles = files.filter((filePath) => {
    const name = path.basename(filePath).toLowerCase();
    return (
      name.endsWith('.json') &&
      name.includes('resolved') &&
      name.includes('categorical') &&
      name.includes('dataset')
    );
  });
  const manifests = [];
  for (const filePath of manifestFiles) {
    const read = await readJson(filePath);
    if (isCaptureManifest(read.value)) manifests.push(read);
  }
  const datasets = [];
  for (const filePath of resolvedFiles) {
    const read = await readJson(filePath);
    if (isResolvedCategoricalDataset(read.value)) datasets.push(read);
  }
  const matches = [];
  for (const manifest of manifests) {
    if (
      manifest.value.manifestSha256 !==
      sha256(JSON.stringify(captureManifestIdentity(manifest.value)))
    ) {
      continue;
    }
    for (const dataset of datasets) {
      if (
        manifest.value.sourceResolvedDatasetSha256 ===
        dataset.value.datasetSha256
      ) {
        matches.push({ manifest, dataset });
      }
    }
  }
  if (matches.length !== 1) {
    throw new Error(
      `Expected exactly one matching stats-lineup manifest and resolved categorical dataset under ${SEARCH_ROOT}; found ${matches.length}.`,
    );
  }
  return matches[0];
}

async function loadCaptures(manifestRead) {
  const captureRoot = path.dirname(manifestRead.path);
  const captures = [];
  for (const [index, manifestGame] of manifestRead.value.games.entries()) {
    const gameId = manifestGame.gameId;
    const capture = await readJson(
      path.join(captureRoot, 'games', String(gameId), 'capture.json'),
      `capture game ${gameId}`,
    );
    if (
      capture.value.sourcePlanSha256 !==
        manifestRead.value.sourcePlanSha256 ||
      capture.value.plannedGame?.gameId !== gameId
    ) {
      throw new Error(`capture identity mismatch for game ${gameId}.`);
    }
    if (
      capture.value.captureSha256 !==
      sha256(JSON.stringify(captureIdentity(capture.value)))
    ) {
      throw new Error(`capture SHA-256 mismatch for game ${gameId}.`);
    }
    if (
      capture.value.untouchedTestReservation?.rowsIncluded !== false ||
      Object.hasOwn(capture.value.untouchedTestReservation ?? {}, 'rows')
    ) {
      throw new Error(`capture game ${gameId} exposes untouched-test rows.`);
    }
    captures.push(capture.value);
    if ((index + 1) % 200 === 0 || index + 1 === manifestRead.value.games.length) {
      console.log(`Verified captures: ${index + 1}/${manifestRead.value.games.length}`);
    }
  }
  return captures;
}

const evidence = await locateEvidencePair();
console.log(`Capture manifest: ${evidence.manifest.path}`);
console.log(`Resolved dataset: ${evidence.dataset.path}`);
const captures = await loadCaptures(evidence.manifest);

const dataset = buildM8StarterRetentionDataset({
  captureManifest: evidence.manifest.value,
  captures,
  resolvedDataset: evidence.dataset.value,
  sourceResolvedDatasetFileSha256: sha256(evidence.dataset.text),
});
const datasetPath = path.join(OUTPUT_ROOT, 'starter-retention-dataset.json');
const datasetText = JSON.stringify(dataset, null, 2);
await writeTextAtomic(datasetPath, datasetText);
const persistedDataset = await readJson(datasetPath);
verifyM8StarterRetentionDataset(persistedDataset.value);
if (persistedDataset.text !== datasetText) {
  throw new Error('persisted starter retention dataset bytes changed after atomic write.');
}

const evaluation = evaluateM8StarterRetention({
  rawDataset: persistedDataset.value,
  datasetText: persistedDataset.text,
});
const evaluationPath = path.join(
  OUTPUT_ROOT,
  'starter-retention-evaluation.json',
);
await writeJsonAtomic(evaluationPath, evaluation);
const persistedEvaluation = await readJson(evaluationPath);
verifyM8StarterRetentionEvaluation(persistedEvaluation.value);
if (evaluation.status !== 'starter-retention-candidate-selected') {
  throw new Error(
    `Starter retention gate did not select a candidate: fixed=${evaluation.fixedSelectedCandidateId}; walk-forward=${evaluation.walkForward.selectedCandidateId}; agreement=${evaluation.selectionAgreement}; beats no-retention=${evaluation.selectedBeatsNoRetention}.`,
  );
}

const artifact = buildM8StarterRetentionArtifact({
  rawDataset: persistedDataset.value,
  datasetFileSha256: sha256(persistedDataset.text),
  rawEvaluation: persistedEvaluation.value,
  evaluationFileSha256: sha256(persistedEvaluation.text),
});
await writeJsonAtomic(FINAL_ARTIFACT_PATH, artifact);
const persistedArtifact = await readJson(FINAL_ARTIFACT_PATH);
verifyM8StarterRetentionArtifact(persistedArtifact.value);

console.log('=== M8 STARTER RETENTION REAL-DATA GATE PASSED ===');
console.log(`Included team games: ${dataset.totals.includedTeamGameCount}`);
console.log(`Excluded team games: ${dataset.totals.excludedTeamGameCount}`);
console.log(`Substituted starter slots: ${dataset.totals.substitutedSlotObservationCount}`);
console.log(`Fixed selected candidate: ${evaluation.fixedSelectedCandidateId}`);
console.log(
  `Walk-forward selected candidate: ${evaluation.walkForward.selectedCandidateId}`,
);
console.log(`Walk-forward folds: ${evaluation.walkForward.foldCount}`);
console.log(`Artifact SHA-256: ${artifact.artifactSha256}`);
console.log(`Dataset: ${datasetPath}`);
console.log(`Evaluation: ${evaluationPath}`);
console.log(`Tracked artifact: ${FINAL_ARTIFACT_PATH}`);
console.log('Production enabled: false');
console.log('Untouched-test rows accessed: false');