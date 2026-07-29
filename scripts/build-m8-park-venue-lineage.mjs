import { readFile } from 'node:fs/promises';
import path from 'node:path';

import {
  sha256,
  writeJsonAtomic,
} from './provider-probe-utils.mjs';
import {
  buildM8ParkVenueLineage,
  verifyM8ParkVenueLineage,
} from './m8-park-venue-lineage-utils.mjs';

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

function manifestIdentity(value) {
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

const captureRoot =
  process.env.M8_STATS_LINEUP_CAPTURE_DIR?.trim() ||
  'artifacts/m8-current-season-pa/m8-stats-lineups-v1';
const outputPath =
  process.env.M8_PARK_VENUE_LINEAGE_OUTPUT_PATH?.trim() ||
  'artifacts/m8-park-venue-lineage/m8-park-venue-lineage-v1.json';
const manifestPath = path.join(captureRoot, 'capture-manifest.json');
const manifest = (await readJson(manifestPath, 'stats-lineup capture manifest')).value;

verifyUntouchedReservation(
  manifest.untouchedTestReservation,
  'stats-lineup capture manifest',
);
if (manifest.manifestSha256 !== sha256(JSON.stringify(manifestIdentity(manifest)))) {
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
  const capture = (
    await readJson(capturePath, `stats-lineup capture game ${gameId}`)
  ).value;
  verifyUntouchedReservation(
    capture.untouchedTestReservation,
    `game ${gameId} untouchedTestReservation`,
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

const lineage = buildM8ParkVenueLineage({
  captureManifest: manifest,
  captures,
});
verifyM8ParkVenueLineage(lineage);
await writeJsonAtomic(outputPath, lineage);
const persisted = (
  await readJson(outputPath, 'written park venue lineage')
).value;
verifyM8ParkVenueLineage(persisted);
if (persisted.lineageSha256 !== lineage.lineageSha256) {
  throw new Error('written park venue lineage identity changed.');
}

console.log('=== M8 PARK VENUE LINEAGE COMPLETE ===');
console.log(`Active season: ${lineage.activeSeason}`);
console.log(`Games: ${lineage.totals.gameCount}`);
console.log(`Fit games: ${lineage.totals.fitGameCount}`);
console.log(`Validation games: ${lineage.totals.validationGameCount}`);
console.log(`Unique venues: ${lineage.totals.uniqueVenueCount}`);
console.log(`Source resolved dataset SHA-256: ${lineage.sourceResolvedDatasetSha256}`);
console.log(`Lineage SHA-256: ${lineage.lineageSha256}`);
console.log(`Output: ${outputPath}`);
console.log('Park coefficient fitted or applied: false');
console.log('Untouched-test rows accessed: false');
