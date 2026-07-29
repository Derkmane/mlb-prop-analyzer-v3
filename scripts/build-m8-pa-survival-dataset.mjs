import { readFile } from 'node:fs/promises';
import path from 'node:path';

import {
  sha256,
  writeJsonAtomic,
} from './provider-probe-utils.mjs';
import {
  buildM8PaSurvivalDataset,
  verifyM8PaSurvivalDataset,
} from './m8-pa-survival-dataset-utils.mjs';

function requireEnvironmentValue(name) {
  const value = process.env[name]?.trim();
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
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
    return {
      text,
      value: JSON.parse(text),
    };
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
  if (
    value?.rowsIncluded !== false ||
    Object.hasOwn(value ?? {}, 'rows')
  ) {
    throw new Error(`${label} exposes untouched-test rows.`);
  }
}

const captureRoot = requireEnvironmentValue(
  'M8_STATS_LINEUP_CAPTURE_DIR',
);
const outputPath = requireEnvironmentValue(
  'M8_PA_SURVIVAL_DATASET_OUTPUT_PATH',
);

const manifestPath = path.join(
  captureRoot,
  'capture-manifest.json',
);
const manifestRead = await readJson(
  manifestPath,
  'stats-lineup capture manifest',
);
const manifest = manifestRead.value;

verifyUntouchedReservation(
  manifest.untouchedTestReservation,
  'capture manifest',
);

const expectedManifestSha256 = sha256(
  JSON.stringify(captureManifestIdentity(manifest)),
);
if (manifest.manifestSha256 !== expectedManifestSha256) {
  throw new Error('stats-lineup capture manifest SHA-256 is invalid.');
}

const captures = [];
for (const [index, manifestGame] of manifest.games.entries()) {
  const gameId = manifestGame.gameId;
  const capturePath = path.join(
    captureRoot,
    'games',
    String(gameId),
    'capture.json',
  );
  const captureRead = await readJson(
    capturePath,
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

  const expectedCaptureSha256 = sha256(
    JSON.stringify(captureIdentity(capture)),
  );
  if (capture.captureSha256 !== expectedCaptureSha256) {
    throw new Error(`stats-lineup capture SHA-256 mismatch for game ${gameId}.`);
  }

  captures.push(capture);

  if (
    (index + 1) % 200 === 0 ||
    index + 1 === manifest.gameCount
  ) {
    console.log(`Verified captures: ${index + 1}/${manifest.gameCount}`);
  }
}

const dataset = buildM8PaSurvivalDataset({
  captureManifest: manifest,
  captures,
});

await writeJsonAtomic(outputPath, dataset);

const written = await readJson(
  outputPath,
  'written PA-survival dataset',
);
verifyM8PaSurvivalDataset(written.value);

if (written.value.datasetSha256 !== dataset.datasetSha256) {
  throw new Error('written PA-survival dataset identity changed after persistence.');
}

console.log('=== M8 HITTER PA-SURVIVAL DATASET COMPLETE ===');
console.log(`Active season: ${dataset.activeSeason}`);
console.log(`Captured games: ${dataset.totals.capturedGameCount}`);
console.log(`Complete-lineup games included: ${dataset.totals.completeLineupGameCount}`);
console.log(`Incomplete-lineup games excluded: ${dataset.totals.incompleteLineupGameCount}`);
console.log(`Official starter slots: ${dataset.totals.officialStarterSlotCount}`);
console.log(`Included PA observations: ${dataset.totals.includedObservationCount}`);
console.log(`Excluded missing stats rows: ${dataset.totals.excludedMissingStatsCount}`);
console.log(`Excluded duplicate stats rows: ${dataset.totals.excludedDuplicateStatsCount}`);
console.log(`Excluded null direct PA rows: ${dataset.totals.excludedNullDirectPaCount}`);
console.log(`Component arithmetic exact: ${dataset.totals.componentAuditExactCount}`);
console.log(`Component arithmetic mismatches retained: ${dataset.totals.componentAuditMismatchCount}`);
console.log(`Component arithmetic unavailable: ${dataset.totals.componentAuditUnavailableCount}`);
console.log(`Fit observations: ${dataset.periods.fit.rowCount}`);
console.log(`Validation observations: ${dataset.periods.validation.rowCount}`);
console.log(`Dataset SHA-256: ${dataset.datasetSha256}`);
console.log(`Output: ${outputPath}`);
console.log('Component arithmetic fallback used: false');
console.log('Untouched-test rows accessed: false');
