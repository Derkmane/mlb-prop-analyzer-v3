import path from 'node:path';

import {
  fetchJsonSnapshot,
  requireSecret,
  sanitizeText,
  sha256,
  timestampForPath,
  writeJsonAtomic,
  writeTextAtomic,
} from './provider-probe-utils.mjs';
import {
  activeUtcSeason,
  parseNonNegativeInteger,
  sanitizeFileSegment,
} from './provider-capability-utils.mjs';
import {
  countPlateAppearances,
  enumerateCurrentSeasonDates,
  selectFinalGamesForDate,
} from './m8-recency-weighting-utils.mjs';

function requireEnvironmentValue(name) {
  const value = process.env[name]?.trim();
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

function parseSnapshotJson(snapshot, label) {
  try {
    return JSON.parse(snapshot.sanitizedBodyText);
  } catch {
    throw new Error(`${label} did not return valid JSON.`);
  }
}

const startedAt = new Date();
const activeSeason = activeUtcSeason(startedAt);
const startDate = requireEnvironmentValue('M8_CAPTURE_START_DATE');
const endDate = requireEnvironmentValue('M8_CAPTURE_END_DATE');
const dates = enumerateCurrentSeasonDates({
  startDate,
  endDate,
  activeSeason,
});
const delayMs = parseNonNegativeInteger(
  process.env.BDL_CAPTURE_DELAY_MS,
  'BDL_CAPTURE_DELAY_MS',
  13_000,
);
const maxGames = parseNonNegativeInteger(
  process.env.M8_CAPTURE_MAX_GAMES,
  'M8_CAPTURE_MAX_GAMES',
  0,
);
const outputRoot =
  process.env.M8_CAPTURE_OUTPUT_DIR?.trim() ||
  path.join('artifacts', 'm8-current-season-pa', timestampForPath(startedAt));
const apiKey = requireSecret('BALLDONTLIE_API_KEY');
const headers = { Authorization: apiKey };
const secrets = [apiKey];

let lastRequestAt = 0;
async function waitForProviderInterval() {
  const elapsed = Date.now() - lastRequestAt;
  if (lastRequestAt > 0 && elapsed < delayMs) {
    await new Promise((resolve) => setTimeout(resolve, delayMs - elapsed));
  }
}

async function captureBdl({ label, filePath, url }) {
  await waitForProviderInterval();
  const snapshot = await fetchJsonSnapshot({
    label,
    url,
    headers,
    secrets,
  });
  lastRequestAt = Date.now();
  await writeTextAtomic(filePath, snapshot.sanitizedBodyText);
  if (!snapshot.ok) {
    throw new Error(
      `${label} returned HTTP ${snapshot.response.status} ${snapshot.response.statusText}.`,
    );
  }
  return snapshot;
}

const manifest = {
  captureVersion: 1,
  purpose:
    'Preserve dated active-season regular-season game and plate-appearance evidence for offline M8 recency fitting.',
  provider: 'BALLDONTLIE MLB API',
  capturedAt: startedAt.toISOString(),
  activeSeason,
  requestedStartDate: startDate,
  requestedEndDate: endDate,
  requiredFinalStatus: 'STATUS_FINAL',
  maxGames: maxGames === 0 ? null : maxGames,
  delayMs,
  status: 'in-progress',
  truncated: false,
  capturedGameCount: 0,
  capturedPlateAppearanceCount: 0,
  dateCaptures: [],
  error: null,
};

const manifestPath = path.join(outputRoot, 'capture-manifest.json');
let failure = null;

console.log('=== M8 CURRENT-SEASON PA CAPTURE ===');
console.log(`Active season: ${activeSeason}`);
console.log(`Date range: ${startDate} through ${endDate}`);
console.log(`Output: ${outputRoot}`);

try {
  dateLoop: for (const date of dates) {
    const safeDate = sanitizeFileSegment(date);
    const gamesUrl = new URL('https://api.balldontlie.io/mlb/v1/games');
    gamesUrl.searchParams.append('dates[]', date);
    gamesUrl.searchParams.set('season_type', 'regular');
    gamesUrl.searchParams.set('per_page', '100');

    const gamesPath = path.join(
      outputRoot,
      'games',
      `balldontlie-games-${safeDate}.json`,
    );
    console.log(`Capturing final-game candidates for ${date}...`);
    const gamesSnapshot = await captureBdl({
      label: `m8-games-${date}`,
      filePath: gamesPath,
      url: gamesUrl,
    });
    const gamesBody = parseSnapshotJson(gamesSnapshot, `games ${date}`);
    const finalGames = selectFinalGamesForDate(
      gamesBody,
      date,
      activeSeason,
    );

    const dateCapture = {
      date,
      gamesSnapshot: {
        filePath: path.relative(outputRoot, gamesPath),
        rawBodySha256: gamesSnapshot.response.rawBodySha256,
        savedBodySha256: sha256(gamesSnapshot.sanitizedBodyText),
        request: gamesSnapshot.request,
        responseStatus: gamesSnapshot.response.status,
      },
      finalGameCount: finalGames.length,
      games: [],
    };
    manifest.dateCaptures.push(dateCapture);

    for (const game of finalGames) {
      if (maxGames > 0 && manifest.capturedGameCount >= maxGames) {
        manifest.truncated = true;
        break dateLoop;
      }

      const plateAppearancesUrl = new URL(
        'https://api.balldontlie.io/mlb/v1/plate_appearances',
      );
      plateAppearancesUrl.searchParams.set('game_id', String(game.id));
      const plateAppearancesPath = path.join(
        outputRoot,
        'plate-appearances',
        `balldontlie-plate-appearances-${game.id}.json`,
      );

      console.log(`Capturing plate appearances for final game ${game.id}...`);
      const plateAppearancesSnapshot = await captureBdl({
        label: `m8-plate-appearances-${game.id}`,
        filePath: plateAppearancesPath,
        url: plateAppearancesUrl,
      });
      const plateAppearancesBody = parseSnapshotJson(
        plateAppearancesSnapshot,
        `plate appearances ${game.id}`,
      );
      const plateAppearanceCount = countPlateAppearances(
        plateAppearancesBody,
      );

      dateCapture.games.push({
        gameId: game.id,
        gameDate: game.date,
        status: game.status,
        plateAppearancesSnapshot: {
          filePath: path.relative(outputRoot, plateAppearancesPath),
          rawBodySha256: plateAppearancesSnapshot.response.rawBodySha256,
          savedBodySha256: sha256(
            plateAppearancesSnapshot.sanitizedBodyText,
          ),
          request: plateAppearancesSnapshot.request,
          responseStatus: plateAppearancesSnapshot.response.status,
          recordCount: plateAppearanceCount,
        },
      });
      manifest.capturedGameCount += 1;
      manifest.capturedPlateAppearanceCount += plateAppearanceCount;
    }
  }

  manifest.status = 'complete';
} catch (error) {
  failure = error;
  manifest.status = 'failed';
  manifest.error = sanitizeText(
    error instanceof Error ? error.message : String(error),
    secrets,
  );
} finally {
  await writeJsonAtomic(manifestPath, manifest);
}

console.log(`Manifest: ${manifestPath}`);
console.log(`Games captured: ${manifest.capturedGameCount}`);
console.log(
  `Plate appearances captured: ${manifest.capturedPlateAppearanceCount}`,
);
console.log(`Truncated: ${manifest.truncated ? 'YES' : 'NO'}`);

if (failure !== null) {
  throw failure;
}

if (manifest.truncated) {
  console.log(
    'Capture completed as an explicit pilot only; truncated evidence is not sufficient for production fitting.',
  );
} else {
  console.log(
    'Capture completed for the requested date range; promotion and fixture verification remain separate required steps.',
  );
}
