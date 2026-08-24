import { readFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const DISPLAY_MARKETS = Object.freeze(['batter-hits', 'batter-hhr']);
const CAPTURE_PATTERN = /^\d{8}T\d{9}Z--[a-f0-9]{64}\.json$/u;
export const DEPLOYMENT_DISPLAY_TIME_ZONE = 'America/Chicago';

function chicagoDateKey(value, timeZone = DEPLOYMENT_DISPLAY_TIME_ZONE) {
  const date = value instanceof Date ? value : new Date(value);
  if (!Number.isFinite(date.getTime())) {
    throw new TypeError('deployment freshness timestamp must be valid.');
  }
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(date);
  const byType = new Map(parts.map((part) => [part.type, part.value]));
  return `${byType.get('year')}-${byType.get('month')}-${byType.get('day')}`;
}

async function newestArchive(rootDirectory, market) {
  const directory = path.join(rootDirectory, market, 'captures');
  let entries;
  try {
    entries = await readdir(directory, { withFileTypes: true });
  } catch (error) {
    if (
      error !== null &&
      typeof error === 'object' &&
      'code' in error &&
      error.code === 'ENOENT'
    ) {
      throw new Error(`Deployment blocked: no shipped ${market} capture directory.`);
    }
    throw error;
  }

  const names = entries
    .filter((entry) => entry.isFile() && CAPTURE_PATTERN.test(entry.name))
    .map((entry) => entry.name)
    .sort()
    .reverse();
  if (names.length === 0) {
    throw new Error(`Deployment blocked: no shipped ${market} display archive.`);
  }

  const name = names[0];
  const archivePath = path.join(directory, name);
  const source = JSON.parse(await readFile(archivePath, 'utf8'));
  if (source === null || typeof source !== 'object' || Array.isArray(source)) {
    throw new Error(`Deployment blocked: ${market} display archive is not an object.`);
  }
  if (
    source.displayArchiveVersion !== 1 ||
    source.displayArchiveContract !== 'phase1-trimmed-board-display-v1' ||
    source.market !== market ||
    source.productionEnabled !== false ||
    source.productionRankingEnabled !== false
  ) {
    throw new Error(`Deployment blocked: ${market} display archive contract is invalid.`);
  }
  if (!Array.isArray(source.rows) || source.rows.length === 0) {
    throw new Error(`Deployment blocked: ${market} display archive has no rows.`);
  }
  if (typeof source.capturedAt !== 'string' || !Number.isFinite(Date.parse(source.capturedAt))) {
    throw new Error(`Deployment blocked: ${market} display archive capturedAt is invalid.`);
  }

  return Object.freeze({
    market,
    name,
    archivePath,
    capturedAt: source.capturedAt,
    rows: source.rows.length,
  });
}

export async function verifyDeploymentDisplayFreshness(options = {}) {
  const rootDirectory = path.resolve(
    options.rootDirectory ?? 'artifacts/display-archives',
  );
  const now = options.now ?? new Date();
  const timeZone = options.timeZone ?? DEPLOYMENT_DISPLAY_TIME_ZONE;
  const expectedSlateDate = chicagoDateKey(now, timeZone);
  const archives = await Promise.all(
    DISPLAY_MARKETS.map((market) => newestArchive(rootDirectory, market)),
  );

  for (const archive of archives) {
    const captureSlateDate = chicagoDateKey(archive.capturedAt, timeZone);
    if (captureSlateDate > expectedSlateDate) {
      throw new Error(
        `Deployment blocked: newest shipped ${archive.market} display archive is future-dated ` +
          `(${captureSlateDate}; current slate date ${expectedSlateDate}).`,
      );
    }
  }

  const captureTimes = new Set(archives.map((archive) => archive.capturedAt));
  if (captureTimes.size !== 1) {
    throw new Error(
      'Deployment blocked: newest shipped Batter Hits and HHR display archives do not share one capture timestamp.',
    );
  }

  return Object.freeze({
    slateDate: expectedSlateDate,
    capturedAt: archives[0].capturedAt,
    archives: Object.freeze(archives),
  });
}

async function main() {
  const result = await verifyDeploymentDisplayFreshness();
  console.log('DEPLOYMENT DISPLAY FRESHNESS PASS');
  console.log(`SLATE DATE\t${result.slateDate}`);
  console.log(`CAPTURED AT\t${result.capturedAt}`);
  for (const archive of result.archives) {
    console.log(`${archive.market}\t${archive.name}\trows=${archive.rows}`);
  }
}

const invokedPath = process.argv[1] ? path.resolve(process.argv[1]) : null;
if (invokedPath !== null && invokedPath === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
