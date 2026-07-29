import {
  access,
  mkdir,
  readFile,
  rm,
} from 'node:fs/promises';
import path from 'node:path';

import {
  createBdlAdaptiveRateLimiter,
} from './bdl-adaptive-rate-limit-utils.mjs';
import {
  parseNonNegativeInteger,
} from './provider-capability-utils.mjs';
import {
  fetchJsonSnapshot,
  requireSecret,
  sha256,
  writeJsonAtomic,
} from './provider-probe-utils.mjs';
import {
  buildM8OpportunityPlayCapturePlan,
} from './m8-opportunity-play-capture-plan-utils.mjs';
import {
  buildM8StatsLineupCaptureManifest,
  summarizeM8StatsLineupGame,
} from './m8-stats-lineup-capture-utils.mjs';

function requireEnvironmentValue(name) {
  const value = process.env[name]?.trim();
  if (!value) {
    throw new Error(
      `Missing required environment variable: ${name}`,
    );
  }
  return value;
}

async function pathExists(value) {
  try {
    await access(value);
    return true;
  } catch (error) {
    if (error?.code === 'ENOENT') {
      return false;
    }
    throw error;
  }
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

const datasetPath = requireEnvironmentValue(
  'M8_RESOLVED_CATEGORICAL_DATASET_PATH',
);
const outputRoot = requireEnvironmentValue(
  'M8_STATS_LINEUP_OUTPUT_DIR',
);
const fallbackDelayMs = parseNonNegativeInteger(
  process.env.BDL_CAPTURE_DELAY_MS,
  'BDL_CAPTURE_DELAY_MS',
  13_000,
);
if (fallbackDelayMs === 0) {
  throw new RangeError(
    'BDL_CAPTURE_DELAY_MS fallback must be positive.',
  );
}
const max429Retries = parseNonNegativeInteger(
  process.env.BDL_CAPTURE_MAX_429_RETRIES,
  'BDL_CAPTURE_MAX_429_RETRIES',
  8,
);
const maxNewGames = parseNonNegativeInteger(
  process.env.M8_STATS_LINEUP_MAX_NEW_GAMES,
  'M8_STATS_LINEUP_MAX_NEW_GAMES',
  0,
);
const apiKey = requireSecret('BALLDONTLIE_API_KEY');
const secrets = [apiKey];
const headers = {
  Authorization: apiKey,
};

const sourcePlan =
  await buildM8OpportunityPlayCapturePlan({
    datasetPath,
  });
const planIdentity = {
  captureKind: 'm8-stats-lineups-v1',
  activeSeason: sourcePlan.activeSeason,
  sourceResolvedDatasetSha256:
    sourcePlan.sourceResolvedDatasetSha256,
  sourceResolvedDatasetFileSha256:
    sourcePlan.sourceResolvedDatasetFileSha256,
  includedPeriods: sourcePlan.includedPeriods,
  sourceRowCount: sourcePlan.sourceRowCount,
  gameCount: sourcePlan.gameCount,
  games: sourcePlan.games,
  untouchedTestReservation:
    sourcePlan.untouchedTestReservation,
};
const plan = Object.freeze({
  planVersion: 1,
  purpose:
    'Capture immutable BALLDONTLIE per-game stats, official pregame lineups, and game identity for every current-season fit-validation game used by hitter PA-survival research.',
  ...planIdentity,
  planSha256: sha256(JSON.stringify(planIdentity)),
});

await mkdir(path.join(outputRoot, 'games'), {
  recursive: true,
});

const planPath = path.join(
  outputRoot,
  'capture-plan.json',
);
if (await pathExists(planPath)) {
  const existing = await readJson(
    planPath,
    'saved stats-lineup capture plan',
  );
  if (
    JSON.stringify(existing.value) !==
    JSON.stringify(plan)
  ) {
    throw new Error(
      'Saved stats-lineup capture plan differs from the current frozen-dataset plan.',
    );
  }
} else {
  await writeJsonAtomic(planPath, plan);
}

const rateLimiter = createBdlAdaptiveRateLimiter({
  fallbackDelayMs,
  utilization: 0.9,
});
let latestRateState = rateLimiter.snapshot();

async function fetchBody({
  label,
  url,
}) {
  for (
    let attempt = 0;
    attempt <= max429Retries;
    attempt += 1
  ) {
    await rateLimiter.beforeRequest();
    const snapshot = await fetchJsonSnapshot({
      label,
      url,
      headers,
      secrets,
    });
    latestRateState = rateLimiter.afterResponse({
      status: snapshot.response.status,
      headers: snapshot.response.headers,
    });

    if (snapshot.response.status === 429) {
      if (attempt >= max429Retries) {
        throw new Error(
          `${label} exceeded ${max429Retries} automatic HTTP 429 retries.`,
        );
      }
      const waitedMs =
        await rateLimiter.waitForRetry();
      console.log(
        `Rate limited during ${label}; waited ${waitedMs} ms before retry ${
          attempt + 1
        }/${max429Retries}.`,
      );
      continue;
    }

    if (!snapshot.ok) {
      throw new Error(
        `${label} returned HTTP ${snapshot.response.status} ${snapshot.response.statusText}.`,
      );
    }

    let body;
    try {
      body = JSON.parse(snapshot.sanitizedBodyText);
    } catch {
      throw new Error(`${label} returned invalid JSON.`);
    }

    return {
      body,
      rawBodySha256:
        snapshot.response.rawBodySha256,
      responseStatus: snapshot.response.status,
      responseHeaders:
        snapshot.response.headers,
    };
  }

  throw new Error(
    `unreachable retry state for ${label}.`,
  );
}

async function fetchCursorPages({
  endpoint,
  gameId,
}) {
  const pages = [];
  const seen = new Set();
  let cursor = null;
  let pageNumber = 1;

  while (true) {
    const url = new URL(
      `https://api.balldontlie.io/mlb/v1/${endpoint}`,
    );
    url.searchParams.append(
      'game_ids[]',
      String(gameId),
    );
    url.searchParams.set('per_page', '100');
    if (cursor !== null) {
      url.searchParams.set(
        'cursor',
        String(cursor),
      );
    }

    const snapshot = await fetchBody({
      label:
        `${endpoint} game ${gameId} page ${pageNumber}`,
      url,
    });
    if (!Array.isArray(snapshot.body?.data)) {
      throw new Error(
        `${endpoint} game ${gameId} page ${pageNumber} data must be an array.`,
      );
    }
    pages.push({
      pageNumber,
      cursor,
      rawBodySha256: snapshot.rawBodySha256,
      responseStatus: snapshot.responseStatus,
      responseHeaders: snapshot.responseHeaders,
      body: snapshot.body,
    });

    const nextCursor =
      snapshot.body?.meta?.next_cursor ?? null;
    if (
      nextCursor === null ||
      nextCursor === undefined
    ) {
      break;
    }

    const key = String(nextCursor);
    if (seen.has(key)) {
      throw new Error(
        `${endpoint} game ${gameId} repeated cursor ${key}.`,
      );
    }
    seen.add(key);
    cursor = nextCursor;
    pageNumber += 1;
  }

  return pages;
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
    untouchedTestReservation:
      value.untouchedTestReservation,
  };
}

function verifyCapture(value, plannedGame) {
  if (
    value?.sourcePlanSha256 !== plan.planSha256 ||
    value?.plannedGame?.gameId !==
      plannedGame.gameId
  ) {
    throw new Error(
      `saved stats-lineup capture identity mismatch for game ${plannedGame.gameId}.`,
    );
  }
  if (
    value?.untouchedTestReservation
      ?.rowsIncluded !== false ||
    Object.hasOwn(
      value?.untouchedTestReservation ?? {},
      'rows',
    )
  ) {
    throw new Error(
      `saved stats-lineup capture exposes untouched-test rows for game ${plannedGame.gameId}.`,
    );
  }
  const expected = sha256(
    JSON.stringify(captureIdentity(value)),
  );
  if (value.captureSha256 !== expected) {
    throw new Error(
      `saved stats-lineup capture SHA-256 mismatch for game ${plannedGame.gameId}.`,
    );
  }
  return value;
}

async function captureGame(plannedGame) {
  const gameUrl = new URL(
    `https://api.balldontlie.io/mlb/v1/games/${plannedGame.gameId}`,
  );
  const gameSnapshot = await fetchBody({
    label: `game ${plannedGame.gameId}`,
    url: gameUrl,
  });
  if (
    gameSnapshot.body?.data?.id !==
    plannedGame.gameId
  ) {
    throw new Error(
      `game endpoint identity mismatch for ${plannedGame.gameId}.`,
    );
  }

  const statsPages = await fetchCursorPages({
    endpoint: 'stats',
    gameId: plannedGame.gameId,
  });
  const lineupPages = await fetchCursorPages({
    endpoint: 'lineups',
    gameId: plannedGame.gameId,
  });
  const statsRows = statsPages.flatMap(
    (page) => page.body.data,
  );
  const lineupRows = lineupPages.flatMap(
    (page) => page.body.data,
  );
  const summary = summarizeM8StatsLineupGame({
    plannedGame,
    gameBody: gameSnapshot.body.data,
    statsRows,
    lineupRows,
    snapshots: {
      gameRawBodySha256:
        gameSnapshot.rawBodySha256,
      statsRawBodySha256s: statsPages.map(
        (page) => page.rawBodySha256,
      ),
      lineupRawBodySha256s: lineupPages.map(
        (page) => page.rawBodySha256,
      ),
    },
  });
  const identity = {
    captureVersion: 1,
    provider: 'BALLDONTLIE MLB API',
    sourcePlanSha256: plan.planSha256,
    plannedGame,
    gameSnapshot: {
      rawBodySha256:
        gameSnapshot.rawBodySha256,
      responseStatus:
        gameSnapshot.responseStatus,
      body: gameSnapshot.body,
    },
    statsPages,
    lineupPages,
    summary,
    untouchedTestReservation:
      plan.untouchedTestReservation,
  };

  return Object.freeze({
    ...identity,
    captureSha256: sha256(
      JSON.stringify(identity),
    ),
  });
}

console.log('=== M8 STATS + LINEUPS CAPTURE ===');
console.log(`Plan SHA-256: ${plan.planSha256}`);
console.log(`Games: ${plan.gameCount}`);
console.log(`Source rows: ${plan.sourceRowCount}`);
console.log(`Output root: ${outputRoot}`);
console.log(
  `Maximum new games: ${
    maxNewGames === 0
      ? 'all missing games'
      : maxNewGames
  }`,
);
console.log(
  `Untouched test sealed: ${
    plan.untouchedTestReservation.startDate
  } through ${
    plan.untouchedTestReservation.endDate
  }; rows included false.`,
);

const capturedById = new Map();
for (
  const [index, plannedGame] of
  plan.games.entries()
) {
  const capturePath = path.join(
    outputRoot,
    'games',
    String(plannedGame.gameId),
    'capture.json',
  );
  if (!(await pathExists(capturePath))) {
    continue;
  }

  const saved = await readJson(
    capturePath,
    `saved game ${plannedGame.gameId}`,
  );
  const verified = verifyCapture(
    saved.value,
    plannedGame,
  );
  capturedById.set(
    plannedGame.gameId,
    verified.summary,
  );
  console.log(
    `[${index + 1}/${plan.gameCount}] Reused game ${plannedGame.gameId}.`,
  );
}

const missing = plan.games.filter(
  (game) => !capturedById.has(game.gameId),
);
const selected =
  maxNewGames === 0
    ? missing
    : missing.slice(0, maxNewGames);

console.log(
  `Verified before run: ${capturedById.size}`,
);
console.log(`Missing before run: ${missing.length}`);
console.log(`Selected this run: ${selected.length}`);

for (const plannedGame of selected) {
  const capture = await captureGame(plannedGame);
  const capturePath = path.join(
    outputRoot,
    'games',
    String(plannedGame.gameId),
    'capture.json',
  );
  await writeJsonAtomic(capturePath, capture);
  const saved = await readJson(
    capturePath,
    `written game ${plannedGame.gameId}`,
  );
  const verified = verifyCapture(
    saved.value,
    plannedGame,
  );
  capturedById.set(
    plannedGame.gameId,
    verified.summary,
  );
  await writeJsonAtomic(
    path.join(
      outputRoot,
      'capture-progress.json',
    ),
    {
      progressVersion: 1,
      sourcePlanSha256: plan.planSha256,
      completedGameCount: capturedById.size,
      gameCount: plan.gameCount,
      remainingGameCount:
        plan.gameCount - capturedById.size,
      completedGameIds: [
        ...capturedById.keys(),
      ].sort((left, right) => left - right),
      untouchedTestReservation:
        plan.untouchedTestReservation,
    },
  );
  console.log(
    `Captured ${plannedGame.gameId}: ${
      verified.summary.stats.rowCount
    } stats rows; lineup rows ${
      verified.summary.teams.reduce(
        (sum, team) => sum + team.lineupRowCount,
        0,
      )
    }.`,
  );
}

if (capturedById.size === plan.gameCount) {
  const manifest =
    buildM8StatsLineupCaptureManifest({
      plan,
      capturedGames: plan.games.map(
        (game) => capturedById.get(game.gameId),
      ),
    });
  await writeJsonAtomic(
    path.join(
      outputRoot,
      'capture-manifest.json',
    ),
    manifest,
  );
  await rm(
    path.join(
      outputRoot,
      'capture-progress.json',
    ),
    {
      force: true,
    },
  );
  await writeJsonAtomic(
    path.join(
      outputRoot,
      'rate-limit-evidence.json',
    ),
    {
      evidenceVersion: 1,
      provider: 'BALLDONTLIE MLB API',
      sourcePlanSha256: plan.planSha256,
      source: latestRateState.source,
      limitPerMinute:
        latestRateState.limitPerMinute,
      intervalMs: latestRateState.intervalMs,
      responseHeaders: latestRateState.headers,
      untouchedTestReservation:
        plan.untouchedTestReservation,
    },
  );

  console.log(
    '=== M8 STATS + LINEUPS CAPTURE COMPLETE ===',
  );
  console.log(
    `Complete-lineup games: ${manifest.totals.completeLineupGames}`,
  );
  console.log(
    `Partial-lineup games: ${manifest.totals.partialLineupGames}`,
  );
  console.log(
    `Absent-lineup games: ${manifest.totals.absentLineupGames}`,
  );
  console.log(
    `Direct PA rows: ${manifest.totals.directPaRows}`,
  );
  console.log(
    `Null-PA batting rows: ${manifest.totals.nullPaBattingRows}`,
  );
  console.log(
    `PA arithmetic mismatches: ${manifest.totals.arithmeticMismatches}`,
  );
  console.log(
    `Manifest SHA-256: ${manifest.manifestSha256}`,
  );
  console.log(
    'Untouched-test rows accessed: false',
  );
} else {
  console.log(
    '=== M8 STATS + LINEUPS CAPTURE PARTIAL ===',
  );
  console.log(
    `Completed: ${capturedById.size}/${plan.gameCount}`,
  );
  console.log(
    `Remaining: ${
      plan.gameCount - capturedById.size
    }`,
  );
  console.log(
    'Untouched-test rows accessed: false',
  );
}
