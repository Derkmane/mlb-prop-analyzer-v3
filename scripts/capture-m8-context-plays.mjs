import { access, mkdir, readFile } from 'node:fs/promises';
import path from 'node:path';

import {
  fetchJsonSnapshot,
  requireSecret,
  sha256,
  writeJsonAtomic,
} from './provider-probe-utils.mjs';
import { parseNonNegativeInteger } from './provider-capability-utils.mjs';
import {
  buildM8ContextPlayCapturePlan,
  collectCompleteM8PlayPages,
  promoteM8ContextPlayGameCapture,
  verifyM8ContextPlayGameCapture,
} from './m8-context-play-capture-utils.mjs';

function requireEnvironmentValue(name) {
  const value = process.env[name]?.trim();
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

function parseJson(text, label) {
  try {
    return JSON.parse(text);
  } catch {
    throw new Error(`${label} is not valid JSON.`);
  }
}

async function pathExists(value) {
  try {
    await access(value);
    return true;
  } catch (error) {
    if (error?.code === 'ENOENT') return false;
    throw error;
  }
}

const datasetPath = requireEnvironmentValue('M8_RECENCY_DATASET_PATH');
const outputRoot = requireEnvironmentValue('M8_CONTEXT_PLAY_OUTPUT_DIR');
const delayMs = parseNonNegativeInteger(
  process.env.BDL_CAPTURE_DELAY_MS,
  'BDL_CAPTURE_DELAY_MS',
  13_000,
);
const apiKey = requireSecret('BALLDONTLIE_API_KEY');
const secrets = [apiKey];
const headers = { Authorization: apiKey };
const plan = await buildM8ContextPlayCapturePlan({ datasetPath });

await mkdir(path.join(outputRoot, 'games'), { recursive: true });
await writeJsonAtomic(path.join(outputRoot, 'capture-plan.json'), plan);

console.log('=== M8 CONTEXT PLAY CAPTURE ===');
console.log(`Source dataset SHA-256: ${plan.sourceDatasetSha256}`);
console.log(`Output root: ${outputRoot}`);
console.log(`Context-required rows: ${plan.contextRowCount}`);
console.log(`Games requiring complete plays: ${plan.gameCount}`);
console.log(
  `Untouched test sealed: ${plan.untouchedTestReservation.startDate} through ${plan.untouchedTestReservation.endDate} — ${plan.untouchedTestReservation.plateAppearanceCount} rows excluded`,
);

let lastRequestAt = 0;
async function waitForProviderInterval() {
  const elapsed = Date.now() - lastRequestAt;
  if (lastRequestAt > 0 && elapsed < delayMs) {
    await new Promise((resolve) => setTimeout(resolve, delayMs - elapsed));
  }
}

async function fetchPlayPage({ gameId, sortOrder, perPage, cursor, pageNumber }) {
  await waitForProviderInterval();
  const url = new URL('https://api.balldontlie.io/mlb/v1/plays');
  url.searchParams.set('game_id', String(gameId));
  url.searchParams.set('sort_order', sortOrder);
  url.searchParams.set('per_page', String(perPage));
  if (cursor !== null) {
    url.searchParams.set('cursor', String(cursor));
  }

  const snapshot = await fetchJsonSnapshot({
    label: `m8-context-plays-${gameId}-page-${pageNumber}`,
    url,
    headers,
    secrets,
  });
  lastRequestAt = Date.now();
  if (!snapshot.ok) {
    throw new Error(
      `plays game ${gameId} page ${pageNumber} returned HTTP ${snapshot.response.status} ${snapshot.response.statusText}.`,
    );
  }
  return {
    body: parseJson(
      snapshot.sanitizedBodyText,
      `plays game ${gameId} page ${pageNumber}`,
    ),
    snapshot: {
      rawBodySha256: snapshot.response.rawBodySha256,
      responseStatus: snapshot.response.status,
      request: snapshot.request,
    },
  };
}

const capturedGames = [];
for (const [index, game] of plan.games.entries()) {
  const gameDirectory = path.join(outputRoot, 'games', String(game.gameId));
  if (await pathExists(gameDirectory)) {
    const verified = await verifyM8ContextPlayGameCapture({
      gameDirectory,
      expectedGameId: game.gameId,
      secret: apiKey,
    });
    capturedGames.push({
      gameId: game.gameId,
      observedDate: game.observedDate,
      contextRowCount: game.contextRowCount,
      resultCounts: game.resultCounts,
      pageCount: verified.pageCount,
      recordCount: verified.recordCount,
      gameManifestSha256: verified.gameManifestSha256,
    });
    console.log(
      `[${index + 1}/${plan.gameCount}] Reused verified game ${game.gameId}: ${verified.pageCount} pages, ${verified.recordCount} plays.`,
    );
    continue;
  }

  console.log(
    `[${index + 1}/${plan.gameCount}] Capturing complete plays for game ${game.gameId} (${game.contextRowCount} context rows).`,
  );
  const collected = await collectCompleteM8PlayPages({
    gameId: game.gameId,
    fetchPage: fetchPlayPage,
  });
  await promoteM8ContextPlayGameCapture({
    outputRoot,
    gameId: game.gameId,
    collected,
  });
  const verified = await verifyM8ContextPlayGameCapture({
    gameDirectory,
    expectedGameId: game.gameId,
    secret: apiKey,
  });
  capturedGames.push({
    gameId: game.gameId,
    observedDate: game.observedDate,
    contextRowCount: game.contextRowCount,
    resultCounts: game.resultCounts,
    pageCount: verified.pageCount,
    recordCount: verified.recordCount,
    gameManifestSha256: verified.gameManifestSha256,
  });
  console.log(
    `Captured game ${game.gameId}: ${verified.pageCount} pages, ${verified.recordCount} plays.`,
  );
}

const planText = await readFile(path.join(outputRoot, 'capture-plan.json'), 'utf8');
if (secrets.some((secret) => planText.includes(secret))) {
  throw new Error('context play capture plan contains the provider secret.');
}
const captureIdentity = {
  activeSeason: plan.activeSeason,
  sourceDatasetSha256: plan.sourceDatasetSha256,
  sourceDatasetFileSha256: plan.sourceDatasetFileSha256,
  sourcePlanSha256: plan.planSha256,
  sourcePlanFileSha256: sha256(planText),
  contextRowCount: plan.contextRowCount,
  gameCount: plan.gameCount,
  resultCounts: plan.resultCounts,
  games: capturedGames,
  totalPageCount: capturedGames.reduce((sum, game) => sum + game.pageCount, 0),
  totalPlayRecordCount: capturedGames.reduce(
    (sum, game) => sum + game.recordCount,
    0,
  ),
  untouchedTestReservation: plan.untouchedTestReservation,
};
const manifest = {
  captureVersion: 1,
  purpose:
    'Preserve complete paginated BALLDONTLIE play evidence for every fit-validation game containing context-required terminal PA rows.',
  provider: 'BALLDONTLIE MLB API',
  status: 'complete',
  error: null,
  ...captureIdentity,
  captureSha256: sha256(JSON.stringify(captureIdentity)),
};
await writeJsonAtomic(path.join(outputRoot, 'capture-manifest.json'), manifest);

console.log('=== M8 CONTEXT PLAY CAPTURE COMPLETE ===');
console.log(`Games captured or reused: ${manifest.gameCount}`);
console.log(`Total pages: ${manifest.totalPageCount}`);
console.log(`Total plays: ${manifest.totalPlayRecordCount}`);
console.log(`Capture SHA-256: ${manifest.captureSha256}`);
console.log(
  'No terminal-category mapping was inferred during capture; play signatures remain raw evidence for the next audit.',
);
