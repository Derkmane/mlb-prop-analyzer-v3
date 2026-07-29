import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';

async function readJson(filePath) {
  const text = await readFile(filePath, 'utf8');
  return JSON.parse(text);
}

async function findNamedFiles(root, targetName) {
  const matches = [];
  async function visit(directory) {
    let entries;
    try {
      entries = await readdir(directory, { withFileTypes: true });
    } catch (error) {
      if (error?.code === 'ENOENT') return;
      throw error;
    }
    for (const entry of entries) {
      const filePath = path.join(directory, entry.name);
      if (entry.isDirectory()) {
        await visit(filePath);
      } else if (entry.isFile() && entry.name === targetName) {
        matches.push(filePath);
      }
    }
  }
  await visit(root);
  return matches.sort();
}

function nonEmptyString(value) {
  return typeof value === 'string' && value.trim().length > 0
    ? value.trim()
    : null;
}

function hasCompleteVenueLineage(report) {
  return (
    report.declaredGameCount === report.manifestGameCount &&
    report.uniqueGameCount === report.manifestGameCount &&
    report.missingCaptureGameCount === 0 &&
    report.missingVenueGameCount === 0 &&
    report.identityMismatchGameCount === 0 &&
    report.unsupportedPeriodGameCount === 0 &&
    report.untouchedTestRowsIncluded === false &&
    report.seasonCounts['2026'] === report.manifestGameCount &&
    report.statusCounts.STATUS_FINAL === report.manifestGameCount
  );
}

const manifestPaths = await findNamedFiles('artifacts', 'capture-manifest.json');
const candidates = [];

for (const manifestPath of manifestPaths) {
  let manifest;
  try {
    manifest = await readJson(manifestPath);
  } catch {
    continue;
  }
  if (
    manifest?.provider !== 'BALLDONTLIE MLB API' ||
    !Array.isArray(manifest.games) ||
    typeof manifest.sourceResolvedDatasetSha256 !== 'string'
  ) {
    continue;
  }
  candidates.push({ manifestPath, manifest });
}

if (candidates.length === 0) {
  throw new Error(
    'No M8 stats-lineup capture manifest was found under artifacts/.',
  );
}

const reports = [];
for (const { manifestPath, manifest } of candidates) {
  const captureRoot = path.dirname(manifestPath);
  const seenGameIds = new Set();
  const venueCounts = new Map();
  const missingCaptureGameIds = [];
  const missingVenueGameIds = [];
  const identityMismatchGameIds = [];
  const unsupportedPeriodGameIds = [];
  const seasonCounts = new Map();
  const statusCounts = new Map();

  for (const manifestGame of manifest.games) {
    const gameId = manifestGame?.gameId;
    if (!Number.isSafeInteger(gameId) || gameId <= 0 || seenGameIds.has(gameId)) {
      identityMismatchGameIds.push(gameId ?? null);
      continue;
    }
    seenGameIds.add(gameId);
    const capturePath = path.join(
      captureRoot,
      'games',
      String(gameId),
      'capture.json',
    );
    let capture;
    try {
      capture = await readJson(capturePath);
    } catch (error) {
      if (error?.code === 'ENOENT') {
        missingCaptureGameIds.push(gameId);
        continue;
      }
      throw error;
    }
    const plannedGame = capture?.plannedGame;
    const game = capture?.gameSnapshot?.body?.data;
    if (
      plannedGame?.gameId !== gameId ||
      game?.id !== gameId ||
      plannedGame?.observedDate !== manifestGame?.observedDate ||
      plannedGame?.periodId !== manifestGame?.periodId
    ) {
      identityMismatchGameIds.push(gameId);
      continue;
    }
    if (!['fit', 'validation'].includes(plannedGame.periodId)) {
      unsupportedPeriodGameIds.push(gameId);
    }
    const venue = nonEmptyString(game.venue);
    if (venue === null) {
      missingVenueGameIds.push(gameId);
    } else {
      venueCounts.set(venue, (venueCounts.get(venue) ?? 0) + 1);
    }
    const season = String(game.season ?? capture?.summary?.season ?? 'missing');
    const status = String(game.status ?? capture?.summary?.status ?? 'missing');
    seasonCounts.set(season, (seasonCounts.get(season) ?? 0) + 1);
    statusCounts.set(status, (statusCounts.get(status) ?? 0) + 1);
  }

  const report = {
    manifestPath,
    sourceResolvedDatasetSha256: manifest.sourceResolvedDatasetSha256,
    declaredGameCount: manifest.gameCount,
    manifestGameCount: manifest.games.length,
    uniqueGameCount: seenGameIds.size,
    uniqueVenueCount: venueCounts.size,
    missingCaptureGameCount: missingCaptureGameIds.length,
    missingVenueGameCount: missingVenueGameIds.length,
    identityMismatchGameCount: identityMismatchGameIds.length,
    unsupportedPeriodGameCount: unsupportedPeriodGameIds.length,
    untouchedTestRowsIncluded: manifest?.untouchedTestReservation?.rowsIncluded,
    seasonCounts: Object.fromEntries([...seasonCounts].sort()),
    statusCounts: Object.fromEntries([...statusCounts].sort()),
    venueCounts: Object.fromEntries(
      [...venueCounts].sort(([left], [right]) => left.localeCompare(right)),
    ),
    missingCaptureGameIds: missingCaptureGameIds.slice(0, 20),
    missingVenueGameIds: missingVenueGameIds.slice(0, 20),
    identityMismatchGameIds: identityMismatchGameIds.slice(0, 20),
    unsupportedPeriodGameIds: unsupportedPeriodGameIds.slice(0, 20),
  };
  reports.push(report);
}

reports.sort(
  (left, right) =>
    right.manifestGameCount - left.manifestGameCount ||
    left.manifestPath.localeCompare(right.manifestPath),
);

console.log('=== M8 PARK VENUE LINEAGE DIAGNOSTIC ===');
for (const report of reports) {
  console.log(JSON.stringify(report, null, 2));
}

const eligibleReports = reports.filter(hasCompleteVenueLineage);
if (eligibleReports.length !== 1) {
  throw new Error(
    `Expected exactly one stats-lineup capture with complete verified 2026 final-game venue lineage; found ${eligibleReports.length}.`,
  );
}
const [selected] = eligibleReports;

console.log('Selected manifest:', selected.manifestPath);
console.log('Venue lineage ready for dataset implementation: true');
console.log('Untouched-test rows accessed: false');
