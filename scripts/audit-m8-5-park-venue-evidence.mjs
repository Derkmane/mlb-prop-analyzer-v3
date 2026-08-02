import { readFile } from 'node:fs/promises';
import path from 'node:path';

import {
  sha256,
  writeJsonAtomic,
} from './provider-probe-utils.mjs';
import {
  buildM8_5ParkVenueEvidenceAudit,
  verifyM8_5ParkVenueEvidenceAudit,
} from './m8-5-park-venue-evidence-utils.mjs';

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
    return { text, value: JSON.parse(text) };
  } catch {
    throw new Error(`${label} is not valid JSON.`);
  }
}

function verifyUntouchedReservation(value, label) {
  if (value?.rowsIncluded !== false || Object.hasOwn(value ?? {}, 'rows')) {
    throw new Error(`${label} exposes untouched-test rows.`);
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

const captureRoot = requireEnvironmentValue('M8_STATS_LINEUP_CAPTURE_DIR');
const outputPath = requireEnvironmentValue(
  'M8_5_PARK_VENUE_AUDIT_OUTPUT_PATH',
);
const manifestPath = path.join(captureRoot, 'capture-manifest.json');
const manifest = (
  await readJson(manifestPath, 'stats-lineup capture manifest')
).value;

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
    `stats-lineup capture game ${gameId}`,
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

const audit = buildM8_5ParkVenueEvidenceAudit({
  captureManifest: manifest,
  captures,
});
await writeJsonAtomic(outputPath, audit);
const written = (
  await readJson(outputPath, 'written M8.5 park venue evidence audit')
).value;
verifyM8_5ParkVenueEvidenceAudit(written);
if (written.auditSha256 !== audit.auditSha256) {
  throw new Error('written M8.5 park venue evidence identity changed.');
}

console.log('=== M8.5 PARK VENUE EVIDENCE AUDIT COMPLETE ===');
console.log(`Decision: ${audit.decision}`);
console.log(`Active season: ${audit.activeSeason}`);
console.log(`Captured games: ${audit.totals.capturedGameCount}`);
console.log(`Eligible venue games: ${audit.totals.eligibleVenueGameCount}`);
console.log(`Excluded venue games: ${audit.totals.excludedVenueGameCount}`);
console.log(`Unique exact venues: ${audit.totals.uniqueVenueCount}`);
console.log(`Home teams: ${audit.totals.homeTeamCount}`);
console.log(`Multi-venue home teams: ${audit.totals.multiVenueHomeTeamCount}`);
console.log(`Decision reasons: ${JSON.stringify(audit.decisionReasons)}`);
console.log(`Audit SHA-256: ${audit.auditSha256}`);
console.log(`Output: ${outputPath}`);
console.log('Provider venue text preserved exactly: true');
console.log('Home-team venue inference used: false');
console.log('Venue alias merging used: false');
console.log('Park coefficients fitted: false');
console.log('Selected-side input used: false');
console.log('Direct probability adjustment used: false');
console.log('Production enabled: false');
console.log('Ranking enabled: false');
console.log('Untouched-test rows accessed: false');

if (audit.decision !== 'VENUE_IDENTITY_AVAILABLE') {
  process.exitCode = 2;
}
