import { readFile } from 'node:fs/promises';
import path from 'node:path';

import { sha256, writeJsonAtomic } from './provider-probe-utils.mjs';
import {
  buildM8StarterRetentionDataset,
  verifyM8StarterRetentionDataset,
} from './m8-starter-retention-dataset-utils.mjs';

function requireEnvironmentValue(name) {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`Missing required environment variable: ${name}`);
  return value;
}

async function readJson(filePath, label = filePath) {
  let text;
  try {
    text = await readFile(filePath, 'utf8');
  } catch (error) {
    throw new Error(
      `${label} could not be read: ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
  }
  try {
    return { text, value: JSON.parse(text) };
  } catch {
    throw new Error(`${label} is not valid JSON.`);
  }
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

function verifyUntouchedReservation(value, label) {
  if (value?.rowsIncluded !== false || Object.hasOwn(value ?? {}, 'rows')) {
    throw new Error(`${label} exposes untouched-test rows.`);
  }
}

const captureRoot = requireEnvironmentValue('M8_STATS_LINEUP_CAPTURE_DIR');
const resolvedDatasetPath = requireEnvironmentValue(
  'M8_RESOLVED_CATEGORICAL_DATASET_PATH',
);
const outputPath = requireEnvironmentValue(
  'M8_STARTER_RETENTION_DATASET_OUTPUT_PATH',
);

const manifestRead = await readJson(
  path.join(captureRoot, 'capture-manifest.json'),
  'stats-lineup capture manifest',
);
const manifest = manifestRead.value;
verifyUntouchedReservation(manifest.untouchedTestReservation, 'capture manifest');
if (
  manifest.manifestSha256 !==
  sha256(JSON.stringify(captureManifestIdentity(manifest)))
) {
  throw new Error('stats-lineup capture manifest SHA-256 is invalid.');
}

const captures = [];
for (const [index, manifestGame] of manifest.games.entries()) {
  const gameId = manifestGame.gameId;
  const captureRead = await readJson(
    path.join(captureRoot, 'games', String(gameId), 'capture.json'),
    `stats-lineup capture game ${gameId}`,
  );
  const capture = captureRead.value;
  verifyUntouchedReservation(
    capture.untouchedTestReservation,
    `capture game ${gameId}`,
  );
  if (
    capture.sourcePlanSha256 !== manifest.sourcePlanSha256 ||
    capture.plannedGame?.gameId !== gameId
  ) {
    throw new Error(`stats-lineup capture identity mismatch for game ${gameId}.`);
  }
  if (capture.captureSha256 !== sha256(JSON.stringify(captureIdentity(capture)))) {
    throw new Error(`stats-lineup capture SHA-256 mismatch for game ${gameId}.`);
  }
  captures.push(capture);
  if ((index + 1) % 200 === 0 || index + 1 === manifest.gameCount) {
    console.log(`Verified captures: ${index + 1}/${manifest.gameCount}`);
  }
}

const resolvedRead = await readJson(
  resolvedDatasetPath,
  'resolved categorical dataset',
);
const dataset = buildM8StarterRetentionDataset({
  captureManifest: manifest,
  captures,
  resolvedDataset: resolvedRead.value,
  sourceResolvedDatasetFileSha256: sha256(resolvedRead.text),
});
await writeJsonAtomic(outputPath, dataset);
const written = await readJson(outputPath, 'written starter retention dataset');
verifyM8StarterRetentionDataset(written.value);
if (written.value.datasetSha256 !== dataset.datasetSha256) {
  throw new Error('written starter retention dataset changed after persistence.');
}

console.log('=== M8 STARTER RETENTION DATASET COMPLETE ===');
console.log(`Active season: ${dataset.activeSeason}`);
console.log(`Included team games: ${dataset.totals.includedTeamGameCount}`);
console.log(`Excluded team games: ${dataset.totals.excludedTeamGameCount}`);
console.log(`Included slot observations: ${dataset.totals.includedSlotObservationCount}`);
console.log(`Substituted slot observations: ${dataset.totals.substitutedSlotObservationCount}`);
console.log(`Terminal PA rows: ${dataset.totals.terminalPlateAppearanceCount}`);
console.log(`Ignored baserunning-only rows: ${dataset.totals.ignoredBaserunningRowCount}`);
console.log(`Fit rows: ${dataset.periods.fit.rowCount}`);
console.log(`Validation rows: ${dataset.periods.validation.rowCount}`);
console.log(`Dataset SHA-256: ${dataset.datasetSha256}`);
console.log(`Output: ${outputPath}`);
console.log('Untouched-test rows accessed: false');
