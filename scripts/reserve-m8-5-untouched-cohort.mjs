import { createHash } from 'node:crypto';
import { mkdir, readFile, readdir, rename, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ACTIVE_SEASON = 2026;
const COHORT_VERSION = 'm8-5-untouched-current-season-cohort-v1';
const EXPECTED_FREEZE_MODEL_VERSION = 'm8-5-batter-hits-successor-freeze-v1';
const EXPECTED_FREEZE_SHA256 =
  'a296c384397315832b39d322a7d061ca73e542d94a886087f743f0774199cd17';
const SHA256_PATTERN = /^[a-f0-9]{64}$/;
const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const ISO_DATE_TIME_PATTERN =
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;

function stableJson(value) {
  if (
    value === null ||
    typeof value === 'boolean' ||
    typeof value === 'number' ||
    typeof value === 'string'
  ) {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map((entry) => stableJson(entry)).join(',')}]`;
  }
  if (typeof value === 'object') {
    return `{${Object.keys(value)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${stableJson(value[key])}`)
      .join(',')}}`;
  }
  throw new TypeError('Reservation values must be JSON-compatible.');
}

function sha256Text(text) {
  return createHash('sha256').update(text).digest('hex');
}

function sha256Value(value) {
  return sha256Text(stableJson(value));
}

function assertObject(value, label) {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new TypeError(`${label} must be an object.`);
  }
  return value;
}

function assertString(value, label) {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new TypeError(`${label} must be a non-empty string.`);
  }
  return value.trim();
}

function assertDate(value, label) {
  const date = assertString(value, label);
  if (!DATE_PATTERN.test(date) || Number.isNaN(Date.parse(`${date}T00:00:00Z`))) {
    throw new TypeError(`${label} must be an ISO calendar date.`);
  }
  return date;
}

function assertIsoDateTime(value, label) {
  if (typeof value !== 'string' || value.length === 0) {
    throw new TypeError(`${label} must be a non-empty ISO date-time string.`);
  }
  if (!ISO_DATE_TIME_PATTERN.test(value)) {
    throw new TypeError(`${label} must be a 24-character UTC ISO date-time.`);
  }
  const parsed = Date.parse(value);
  if (Number.isNaN(parsed) || new Date(parsed).toISOString() !== value) {
    throw new TypeError(`${label} must be a valid UTC ISO date-time.`);
  }
  return value;
}

function utcCalendarDate(isoDateTime) {
  return new Date(Date.parse(isoDateTime)).toISOString().slice(0, 10);
}

function assertSha256(value, label) {
  const digest = assertString(value, label);
  if (!SHA256_PATTERN.test(digest)) {
    throw new TypeError(`${label} must be a lowercase SHA-256 digest.`);
  }
  return digest;
}

function assertNonNegativeInteger(value, label) {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new TypeError(`${label} must be a non-negative integer.`);
  }
  return value;
}

function addUtcDays(date, days) {
  const instant = new Date(`${assertDate(date, 'date')}T00:00:00Z`);
  instant.setUTCDate(instant.getUTCDate() + days);
  return instant.toISOString().slice(0, 10);
}

function enumerateDates(startDate, endDate) {
  const start = assertDate(startDate, 'startDate');
  const end = assertDate(endDate, 'endDate');
  if (start > end) throw new RangeError('startDate must not follow endDate.');
  const dates = [];
  for (let date = start; date <= end; date = addUtcDays(date, 1)) {
    dates.push(date);
  }
  return dates;
}

async function readJsonWithText(filePath, label) {
  const text = await readFile(filePath, 'utf8');
  try {
    return { text, value: JSON.parse(text) };
  } catch {
    throw new Error(`${label} is not valid JSON: ${filePath}`);
  }
}

async function findCaptureManifests(root) {
  const results = [];
  async function walk(directory) {
    let entries;
    try {
      entries = await readdir(directory, { withFileTypes: true });
    } catch (error) {
      if (error?.code === 'ENOENT') return;
      throw error;
    }
    for (const entry of entries) {
      const entryPath = path.join(directory, entry.name);
      if (entry.isDirectory()) {
        await walk(entryPath);
      } else if (entry.isFile() && entry.name === 'capture-manifest.json') {
        results.push(entryPath);
      }
    }
  }
  await walk(root);
  return results.sort();
}

function normalizedGame(rawGame, label, captureDate) {
  const game = assertObject(rawGame, label);
  const gameId = game.gameId;
  if (!Number.isSafeInteger(gameId) || gameId <= 0) {
    throw new TypeError(`${label}.gameId must be positive.`);
  }
  const gameDate = assertIsoDateTime(game.gameDate, `${label}.gameDate`);
  if (utcCalendarDate(gameDate) !== captureDate) {
    throw new Error(`${label} UTC calendar date does not match its capture date.`);
  }
  if (game.status !== 'STATUS_FINAL') {
    throw new Error(`${label} is not final.`);
  }
  const snapshot = assertObject(
    game.plateAppearancesSnapshot,
    `${label}.plateAppearancesSnapshot`,
  );
  return Object.freeze({
    gameId,
    gameDate,
    status: 'STATUS_FINAL',
    plateAppearanceCount: assertNonNegativeInteger(
      snapshot.recordCount,
      `${label}.plateAppearancesSnapshot.recordCount`,
    ),
    savedBodySha256: assertSha256(
      snapshot.savedBodySha256,
      `${label}.plateAppearancesSnapshot.savedBodySha256`,
    ),
  });
}

function normalizedDateCapture(rawDateCapture, label) {
  const dateCapture = assertObject(rawDateCapture, label);
  const date = assertDate(dateCapture.date, `${label}.date`);
  const finalGameCount = assertNonNegativeInteger(
    dateCapture.finalGameCount,
    `${label}.finalGameCount`,
  );
  const gamesSnapshot = assertObject(
    dateCapture.gamesSnapshot,
    `${label}.gamesSnapshot`,
  );
  const gamesSnapshotSha256 = assertSha256(
    gamesSnapshot.savedBodySha256,
    `${label}.gamesSnapshot.savedBodySha256`,
  );
  if (!Array.isArray(dateCapture.games)) {
    throw new TypeError(`${label}.games must be an array.`);
  }
  const gameById = new Map();
  for (let gameIndex = 0; gameIndex < dateCapture.games.length; gameIndex += 1) {
    const game = normalizedGame(
      dateCapture.games[gameIndex],
      `${label}.games[${gameIndex}]`,
      date,
    );
    const identity = stableJson(game);
    const existing = gameById.get(game.gameId);
    if (existing && existing.identity !== identity) {
      throw new Error(`${label} contains contradictory metadata for gameId ${game.gameId}.`);
    }
    if (!existing) gameById.set(game.gameId, { identity, value: game });
  }
  const games = [...gameById.values()]
    .map((entry) => entry.value)
    .sort((left, right) => left.gameId - right.gameId);
  if (games.length !== finalGameCount) {
    throw new Error(`${label}.finalGameCount does not match deduplicated games metadata.`);
  }
  return Object.freeze({ date, finalGameCount, gamesSnapshotSha256, games });
}

function validateCompleteManifest(rawManifest, manifestPath) {
  const manifest = assertObject(rawManifest, `capture manifest ${manifestPath}`);
  if (!Array.isArray(manifest.dateCaptures)) return null;
  if (
    manifest.captureVersion !== 1 ||
    manifest.provider !== 'BALLDONTLIE MLB API' ||
    manifest.activeSeason !== ACTIVE_SEASON ||
    manifest.status !== 'complete' ||
    manifest.truncated !== false ||
    manifest.error !== null ||
    manifest.requiredFinalStatus !== 'STATUS_FINAL'
  ) {
    throw new Error(`Capture manifest is not complete approved 2026 evidence: ${manifestPath}`);
  }
  const startDate = assertDate(manifest.requestedStartDate, 'requestedStartDate');
  const endDate = assertDate(manifest.requestedEndDate, 'requestedEndDate');
  const dates = manifest.dateCaptures.map((entry, index) =>
    normalizedDateCapture(entry, `dateCaptures[${index}]`),
  );
  const expectedDates = enumerateDates(startDate, endDate);
  if (stableJson(dates.map((entry) => entry.date)) !== stableJson(expectedDates)) {
    throw new Error(`Capture manifest does not contain its exact requested date sequence: ${manifestPath}`);
  }
  return Object.freeze({ startDate, endDate, dates });
}

function mergeDateCapture(dateByKey, dateCapture) {
  let merged = dateByKey.get(dateCapture.date);
  if (!merged) {
    merged = {
      date: dateCapture.date,
      gamesSnapshotSha256: dateCapture.gamesSnapshotSha256,
      gameById: new Map(),
    };
    dateByKey.set(dateCapture.date, merged);
  }
  for (const game of dateCapture.games) {
    const identity = stableJson(game);
    const existing = merged.gameById.get(game.gameId);
    if (existing && existing.identity !== identity) {
      throw new Error(
        `Contradictory complete capture metadata exists for gameId ${game.gameId}.`,
      );
    }
    if (!existing) merged.gameById.set(game.gameId, { identity, value: game });
  }
}

function finalizedDateCapture(merged) {
  const games = [...merged.gameById.values()]
    .map((entry) => entry.value)
    .sort((left, right) => left.gameId - right.gameId);
  return Object.freeze({
    date: merged.date,
    finalGameCount: games.length,
    gamesSnapshotSha256: merged.gamesSnapshotSha256,
    games: Object.freeze(games),
  });
}

function deriveBoundaries({ freeze, originalM8Candidate, factorArtifacts }) {
  const frozen = assertObject(freeze, 'M8.5 successor freeze');
  if (
    frozen.modelVersion !== EXPECTED_FREEZE_MODEL_VERSION ||
    frozen.artifactSha256 !== EXPECTED_FREEZE_SHA256 ||
    frozen.untouchedTestAccessed !== false ||
    frozen.newUntouchedTestReservation?.reserved !== false ||
    frozen.newUntouchedTestReservation?.rowsIncluded !== false
  ) {
    throw new Error('The exact sealed M8.5 successor freeze is not present.');
  }
  const original = assertObject(originalM8Candidate, 'original M8 candidate');
  const originalReservation = assertObject(
    original.untouchedTestReservation,
    'original M8 untouched reservation',
  );
  const originalStartDate = assertDate(
    originalReservation.startDate,
    'original M8 untouched start date',
  );
  const originalEndDate = assertDate(
    originalReservation.endDate,
    'original M8 untouched end date',
  );
  const validationPeriods = factorArtifacts.map((rawArtifact, index) => {
    const artifact = assertObject(rawArtifact, `factor artifact ${index}`);
    const evidence = artifact.typedFactorArtifact?.validationEvidence ?? artifact.validationEvidence;
    const validation = assertObject(evidence, `factor artifact ${index} validation evidence`);
    if (validation.untouchedRowsIncluded !== false) {
      throw new Error(`factor artifact ${index} exposed untouched rows.`);
    }
    const period = assertObject(validation.validationPeriod, `factor artifact ${index} validation period`);
    return Object.freeze({
      startDate: assertDate(period.start, `factor artifact ${index} validation start`),
      endDate: assertDate(period.end, `factor artifact ${index} validation end`),
    });
  });
  const latestValidationEndDate = validationPeriods
    .map((period) => period.endDate)
    .sort()
    .at(-1);
  const latestPreviouslyUsedDate = [originalEndDate, latestValidationEndDate]
    .sort()
    .at(-1);
  return Object.freeze({
    originalM8UntouchedPeriod: Object.freeze({
      startDate: originalStartDate,
      endDate: originalEndDate,
    }),
    validationPeriods: Object.freeze(validationPeriods),
    latestValidationEndDate,
    latestPreviouslyUsedDate,
    eligibleStartDate: addUtcDays(latestPreviouslyUsedDate, 1),
  });
}

export async function reserveM8_5UntouchedCohort({
  captureRoot,
  latestDate,
  freezePath,
  originalM8CandidatePath,
  factorArtifactPaths,
  outputPath = null,
}) {
  const latestEligibleDate = assertDate(latestDate, 'latestDate');
  const [{ value: freeze }, { value: originalM8Candidate }, ...factorFiles] =
    await Promise.all([
      readJsonWithText(freezePath, 'M8.5 successor freeze'),
      readJsonWithText(originalM8CandidatePath, 'original M8 candidate'),
      ...factorArtifactPaths.map((filePath) =>
        readJsonWithText(filePath, 'M8.5 factor artifact'),
      ),
    ]);
  const boundaries = deriveBoundaries({
    freeze,
    originalM8Candidate,
    factorArtifacts: factorFiles.map((entry) => entry.value),
  });
  if (latestEligibleDate < boundaries.eligibleStartDate) {
    throw new Error('No qualifying post-M8 untouched date is available by latestDate.');
  }

  const manifestPaths = await findCaptureManifests(captureRoot);
  if (manifestPaths.length === 0) {
    throw new Error(`No capture-manifest.json files exist under ${captureRoot}.`);
  }
  const dateByKey = new Map();
  const sourceManifests = [];
  for (const manifestPath of manifestPaths) {
    const { text, value } = await readJsonWithText(manifestPath, 'capture manifest');
    const manifest = validateCompleteManifest(value, manifestPath);
    if (manifest === null) continue;
    const relativePath = path.relative(process.cwd(), manifestPath) || manifestPath;
    sourceManifests.push(
      Object.freeze({ path: relativePath, sha256: sha256Text(text) }),
    );
    for (const dateCapture of manifest.dates) {
      if (
        dateCapture.date < boundaries.eligibleStartDate ||
        dateCapture.date > latestEligibleDate
      ) {
        continue;
      }
      mergeDateCapture(dateByKey, dateCapture);
    }
  }

  if (!dateByKey.has(boundaries.eligibleStartDate)) {
    throw new Error(
      `No qualifying cohort exists: ${boundaries.eligibleStartDate} has no complete capture metadata.`,
    );
  }
  const selectedDates = [];
  for (
    let date = boundaries.eligibleStartDate;
    date <= latestEligibleDate;
    date = addUtcDays(date, 1)
  ) {
    const entry = dateByKey.get(date);
    if (!entry) break;
    selectedDates.push(finalizedDateCapture(entry));
  }
  const endDate = selectedDates.at(-1)?.date;
  if (!endDate) throw new Error('No qualifying contiguous cohort exists.');
  const games = selectedDates.flatMap((entry) => entry.games);
  const gameIds = new Set(games.map((game) => game.gameId));
  if (gameIds.size !== games.length) {
    throw new Error('The selected cohort contains a duplicate game across dates.');
  }
  const plateAppearanceCount = games.reduce(
    (total, game) => total + game.plateAppearanceCount,
    0,
  );
  if (games.length === 0 || plateAppearanceCount === 0) {
    throw new Error('The qualifying contiguous cohort has no final games or plate appearances.');
  }

  const cohortIdentity = Object.freeze({
    cohortVersion: COHORT_VERSION,
    activeSeason: ACTIVE_SEASON,
    frozenSuccessorArtifactSha256: EXPECTED_FREEZE_SHA256,
    startDate: boundaries.eligibleStartDate,
    endDate,
    dates: selectedDates,
  });
  const withoutArtifactHash = Object.freeze({
    purpose:
      'Metadata-only reservation of the new M8.5 untouched current-season acceptance cohort after the successor freeze and before any outcome read.',
    reservationVersion: 1,
    cohortVersion: COHORT_VERSION,
    activeSeason: ACTIVE_SEASON,
    status: 'reserved-before-one-time-acceptance-read',
    frozenSuccessor: Object.freeze({
      modelVersion: EXPECTED_FREEZE_MODEL_VERSION,
      artifactSha256: EXPECTED_FREEZE_SHA256,
    }),
    selectionRule:
      'Reserve every contiguous fully captured date beginning the day after all prior M8 evidence ends and stop at the latest complete captured date not later than the predeclared latestDate; no outcome payload may be opened.',
    latestDate: latestEligibleDate,
    dateRange: Object.freeze({
      startDate: boundaries.eligibleStartDate,
      endDate,
      dateCount: selectedDates.length,
    }),
    gameCount: games.length,
    plateAppearanceCount,
    cohortIdentitySha256: sha256Value(cohortIdentity),
    chronologyProof: Object.freeze({
      m8_5LatestValidationEndDate: boundaries.latestValidationEndDate,
      originalM8UntouchedPeriod: boundaries.originalM8UntouchedPeriod,
      latestPreviouslyUsedDate: boundaries.latestPreviouslyUsedDate,
      firstReservedDate: boundaries.eligibleStartDate,
      fitOrValidationOverlap: false,
      originalM8UntouchedOverlap: false,
    }),
    priorUseProof: Object.freeze({
      freezeUntouchedTestAccessed: false,
      freezeNewReservationState: 'not-reserved',
      factorUntouchedRowsIncluded: false,
      reason:
        'Every reserved date follows the original M8 untouched-test end date and every M8.5 factor validation period; the frozen successor records no new reservation and no untouched access.',
    }),
    sourceManifests: Object.freeze(sourceManifests),
    reservedDateMetadata: Object.freeze(selectedDates),
    rowsIncluded: false,
    outcomesRead: false,
    evaluationRunCount: 0,
  });
  const artifact = Object.freeze({
    ...withoutArtifactHash,
    artifactSha256: sha256Value(withoutArtifactHash),
  });

  if (outputPath) {
    await mkdir(path.dirname(outputPath), { recursive: true });
    const temporaryPath = `${outputPath}.tmp`;
    await writeFile(temporaryPath, `${JSON.stringify(artifact, null, 2)}\n`, 'utf8');
    await rename(temporaryPath, outputPath);
  }
  return artifact;
}

function parseArgs(argv) {
  const values = new Map();
  for (let index = 0; index < argv.length; index += 2) {
    const key = argv[index];
    const value = argv[index + 1];
    if (!key?.startsWith('--') || value === undefined) {
      throw new Error('Arguments must be supplied as --name value pairs.');
    }
    values.set(key.slice(2), value);
  }
  return values;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const artifact = await reserveM8_5UntouchedCohort({
    captureRoot: args.get('capture-root') ?? 'artifacts/m8-current-season-pa',
    latestDate: args.get('latest-date'),
    freezePath:
      args.get('freeze') ??
      'model-artifacts/m8-5-batter-hits-successor-freeze-v1.json',
    originalM8CandidatePath:
      args.get('original-m8-candidate') ??
      'model-artifacts/m8-batter-hits-complete-candidate-v1.json',
    factorArtifactPaths: [
      'model-artifacts/m8-5-game-offensive-environment-model-v1.json',
      'model-artifacts/m8-5-team-bullpen-outcome-v1.json',
      'model-artifacts/m8-5-park-transformation-v1.json',
    ],
    outputPath:
      args.get('output') ??
      'artifacts/m8-5-untouched-acceptance/m8-5-untouched-cohort-reservation-v1.json',
  });
  console.log(JSON.stringify(artifact, null, 2));
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  main().catch((error) => {
    console.error(`Error: ${error instanceof Error ? error.message : String(error)}`);
    process.exitCode = 1;
  });
}
