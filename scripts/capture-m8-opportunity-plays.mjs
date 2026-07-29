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
  fetchJsonSnapshot,
  requireSecret,
  sha256,
  writeJsonAtomic,
} from './provider-probe-utils.mjs';
import {
  parseNonNegativeInteger,
} from './provider-capability-utils.mjs';
import {
  selectM8ContextPlayCaptureBatch,
} from './m8-context-play-batch-utils.mjs';
import {
  collectCompleteM8PlayPages,
} from './m8-context-play-capture-utils.mjs';
import {
  buildM8OpportunityPlayCapturePlan,
} from './m8-opportunity-play-capture-plan-utils.mjs';
import {
  buildM8OpportunityPlayCaptureManifest,
  buildM8OpportunityPlayCaptureProgress,
  ensureM8OpportunityCapturePlan,
  promoteM8OpportunityPlayGameCapture,
  summarizeM8OpportunityCapturedGame,
  verifyM8OpportunityPlayGameCapture,
} from './m8-opportunity-play-capture-run-utils.mjs';

function requireEnvironmentValue(
  name,
) {
  const value =
    process.env[name]?.trim();

  if (!value) {
    throw new Error(
      `Missing required environment variable: ${name}`,
    );
  }

  return value;
}

function parseJson(
  text,
  label,
) {
  try {
    return JSON.parse(text);
  } catch {
    throw new Error(
      `${label} is not valid JSON.`,
    );
  }
}

async function pathExists(
  value,
) {
  try {
    await access(value);
    return true;
  } catch (error) {
    if (
      error?.code === 'ENOENT'
    ) {
      return false;
    }

    throw error;
  }
}

const datasetPath =
  requireEnvironmentValue(
    'M8_RESOLVED_CATEGORICAL_DATASET_PATH',
  );

const outputRoot =
  requireEnvironmentValue(
    'M8_OPPORTUNITY_PLAY_OUTPUT_DIR',
  );

const fallbackDelayMs =
  parseNonNegativeInteger(
    process.env
      .BDL_CAPTURE_DELAY_MS,
    'BDL_CAPTURE_DELAY_MS',
    13_000,
  );

if (
  fallbackDelayMs === 0
) {
  throw new RangeError(
    'BDL_CAPTURE_DELAY_MS fallback must be positive.',
  );
}

const max429Retries =
  parseNonNegativeInteger(
    process.env
      .BDL_CAPTURE_MAX_429_RETRIES,
    'BDL_CAPTURE_MAX_429_RETRIES',
    8,
  );

const maxNewGames =
  parseNonNegativeInteger(
    process.env
      .M8_OPPORTUNITY_PLAY_MAX_NEW_GAMES,
    'M8_OPPORTUNITY_PLAY_MAX_NEW_GAMES',
    0,
  );

const apiKey =
  requireSecret(
    'BALLDONTLIE_API_KEY',
  );

const secrets = [
  apiKey,
];

const headers = {
  Authorization:
    apiKey,
};

const plan =
  await buildM8OpportunityPlayCapturePlan({
    datasetPath,
  });

await mkdir(
  path.join(
    outputRoot,
    'games',
  ),
  {
    recursive: true,
  },
);

const savedPlan =
  await ensureM8OpportunityCapturePlan({
    outputRoot,
    plan,
  });

if (
  secrets.some(
    (secret) =>
      savedPlan.planText.includes(
        secret,
      ),
  )
) {
  throw new Error(
    'opportunity capture plan contains the provider secret.',
  );
}

const rateLimiter =
  createBdlAdaptiveRateLimiter({
    fallbackDelayMs,
    utilization: 0.9,
  });

let latestRateState =
  rateLimiter.snapshot();

let persistedRateProfile =
  null;

async function persistRateLimitEvidence({
  gameId,
  pageNumber,
  status,
  force = false,
}) {
  const profile =
    JSON.stringify({
      source:
        latestRateState.source,
      limitPerMinute:
        latestRateState
          .limitPerMinute,
      intervalMs:
        latestRateState.intervalMs,
    });

  if (
    !force &&
    profile ===
      persistedRateProfile
  ) {
    return;
  }

  const identity = {
    provider:
      'BALLDONTLIE MLB API',
    sourceResolvedDatasetSha256:
      plan
        .sourceResolvedDatasetSha256,
    sourcePlanSha256:
      plan.planSha256,
    gameId,
    pageNumber,
    status,
    source:
      latestRateState.source,
    limitPerMinute:
      latestRateState
        .limitPerMinute,
    remaining:
      latestRateState.remaining,
    resetAtMs:
      latestRateState.resetAtMs,
    intervalMs:
      latestRateState.intervalMs,
    utilization:
      latestRateState.utilization,
    fallbackDelayMs:
      latestRateState
        .fallbackDelayMs,
    responseHeaders:
      latestRateState.headers,
    untouchedTestReservation:
      plan
        .untouchedTestReservation,
  };

  const evidence = {
    evidenceVersion: 1,
    purpose:
      'Preserve the latest response-derived BALLDONTLIE rate-limit evidence used by the resumable M8 opportunity-play capture.',
    ...identity,
    evidenceSha256:
      sha256(
        JSON.stringify(
          identity,
        ),
      ),
  };

  await writeJsonAtomic(
    path.join(
      outputRoot,
      'rate-limit-evidence.json',
    ),
    evidence,
  );

  persistedRateProfile =
    profile;
}

console.log(
  '=== M8 OPPORTUNITY PLAY CAPTURE ===',
);

console.log(
  `Source resolved dataset SHA-256: ${
    plan
      .sourceResolvedDatasetSha256
  }`,
);

console.log(
  `Source rows: ${plan.sourceRowCount}`,
);

console.log(
  `Planned games: ${plan.gameCount}`,
);

console.log(
  `Output root: ${outputRoot}`,
);

console.log(
  `Capture plan reused: ${savedPlan.reused}`,
);

console.log(
  `Maximum new games this run: ${
    maxNewGames === 0
      ? 'all missing games'
      : maxNewGames
  }`,
);

console.log(
  `Adaptive rate limiting: 90% of the response-derived account limit; ${fallbackDelayMs} ms fallback only when no recognized limit headers are present.`,
);

console.log(
  `Maximum automatic HTTP 429 retries per page: ${max429Retries}`,
);

console.log(
  `Untouched test sealed: ${
    plan
      .untouchedTestReservation
      .startDate
  } through ${
    plan
      .untouchedTestReservation
      .endDate
  } — ${
    plan
      .untouchedTestReservation
      .plateAppearanceCount
  } rows excluded`,
);

async function fetchPlayPage({
  gameId,
  sortOrder,
  perPage,
  cursor,
  pageNumber,
}) {
  const url =
    new URL(
      'https://api.balldontlie.io/mlb/v1/plays',
    );

  url.searchParams.set(
    'game_id',
    String(gameId),
  );

  url.searchParams.set(
    'sort_order',
    sortOrder,
  );

  url.searchParams.set(
    'per_page',
    String(perPage),
  );

  if (
    cursor !== null
  ) {
    url.searchParams.set(
      'cursor',
      String(cursor),
    );
  }

  for (
    let attempt = 0;
    attempt <=
      max429Retries;
    attempt += 1
  ) {
    await rateLimiter.beforeRequest();

    const snapshot =
      await fetchJsonSnapshot({
        label:
          `m8-opportunity-plays-${gameId}-page-${pageNumber}`,
        url,
        headers,
        secrets,
      });

    latestRateState =
      rateLimiter.afterResponse({
        status:
          snapshot.response.status,
        headers:
          snapshot.response.headers,
      });

    await persistRateLimitEvidence({
      gameId,
      pageNumber,
      status:
        snapshot.response.status,
      force:
        snapshot.response.status ===
        429,
    });

    if (
      snapshot.response.status ===
      429
    ) {
      if (
        attempt >=
        max429Retries
      ) {
        throw new Error(
          `plays game ${gameId} page ${pageNumber} exceeded ${max429Retries} automatic HTTP 429 retries.`,
        );
      }

      const waitedMs =
        await rateLimiter
          .waitForRetry();

      console.log(
        `Rate limited on game ${gameId} page ${pageNumber}; waited ${waitedMs} ms before retry ${attempt + 1}/${max429Retries}.`,
      );

      continue;
    }

    if (!snapshot.ok) {
      throw new Error(
        `plays game ${gameId} page ${pageNumber} returned HTTP ${snapshot.response.status} ${snapshot.response.statusText}.`,
      );
    }

    return {
      body:
        parseJson(
          snapshot
            .sanitizedBodyText,
          `plays game ${gameId} page ${pageNumber}`,
        ),
      snapshot: {
        rawBodySha256:
          snapshot.response
            .rawBodySha256,
        responseStatus:
          snapshot.response.status,
        request:
          snapshot.request,
      },
    };
  }

  throw new Error(
    `unreachable rate-limit retry state for game ${gameId}.`,
  );
}

const capturedByGameId =
  new Map();

const verifiedGameIds = [];

for (
  const [index, game] of
  plan.games.entries()
) {
  const gameDirectory =
    path.join(
      outputRoot,
      'games',
      String(game.gameId),
    );

  if (
    !(await pathExists(
      gameDirectory,
    ))
  ) {
    continue;
  }

  const verified =
    await verifyM8OpportunityPlayGameCapture({
      gameDirectory,
      expectedGameId:
        game.gameId,
      secret:
        apiKey,
    });

  const summary =
    summarizeM8OpportunityCapturedGame({
      game,
      verified,
    });

  capturedByGameId.set(
    game.gameId,
    summary,
  );

  verifiedGameIds.push(
    game.gameId,
  );

  console.log(
    `[${index + 1}/${plan.gameCount}] Reused verified game ${game.gameId}: ${verified.pageCount} pages, ${verified.recordCount} plays.`,
  );
}

const batch =
  selectM8ContextPlayCaptureBatch({
    plannedGames:
      plan.games,
    verifiedGameIds,
    maxNewGames,
  });

console.log(
  `Verified before this run: ${batch.verifiedBeforeCount}`,
);

console.log(
  `Missing before this run: ${batch.missingBeforeCount}`,
);

console.log(
  `New games selected: ${batch.selectedNewGameCount}`,
);

console.log(
  `Expected remaining after this batch: ${batch.remainingAfterBatchCount}`,
);

const planIndexByGameId =
  new Map(
    plan.games.map(
      (game, index) => [
        game.gameId,
        index,
      ],
    ),
  );

for (
  const game of
  batch.selectedGames
) {
  const index =
    planIndexByGameId.get(
      game.gameId,
    );

  const gameDirectory =
    path.join(
      outputRoot,
      'games',
      String(game.gameId),
    );

  console.log(
    `[${index + 1}/${plan.gameCount}] Capturing complete plays for game ${game.gameId} (${game.sourceRowCount} source PA rows, ${game.periodId}).`,
  );

  const collected =
    await collectCompleteM8PlayPages({
      gameId:
        game.gameId,
      fetchPage:
        fetchPlayPage,
    });

  await promoteM8OpportunityPlayGameCapture({
    outputRoot,
    gameId:
      game.gameId,
    collected,
  });

  const verified =
    await verifyM8OpportunityPlayGameCapture({
      gameDirectory,
      expectedGameId:
        game.gameId,
      secret:
        apiKey,
    });

  const summary =
    summarizeM8OpportunityCapturedGame({
      game,
      verified,
    });

  capturedByGameId.set(
    game.gameId,
    summary,
  );

  await persistRateLimitEvidence({
    gameId:
      game.gameId,
    pageNumber:
      collected.pageCount,
    status: 200,
    force: true,
  });

  console.log(
    `Captured game ${game.gameId}: ${verified.pageCount} pages, ${verified.recordCount} plays. Rate source=${latestRateState.source}, limit=${latestRateState.limitPerMinute ?? 'unknown'}/min, interval=${latestRateState.intervalMs} ms.`,
  );
}

const capturedGames =
  plan.games
    .map(
      (game) =>
        capturedByGameId.get(
          game.gameId,
        ),
    )
    .filter(
      (game) =>
        game !== undefined,
    );

const progressPath =
  path.join(
    outputRoot,
    'capture-progress.json',
  );

const manifestPath =
  path.join(
    outputRoot,
    'capture-manifest.json',
  );

if (
  !batch.completesPlan
) {
  const progress =
    buildM8OpportunityPlayCaptureProgress({
      plan,
      capturedGames,
      selectedNewGameCount:
        batch.selectedNewGameCount,
      remainingGameCount:
        batch.remainingAfterBatchCount,
      maxNewGames,
    });

  await writeJsonAtomic(
    progressPath,
    progress,
  );

  await rm(
    manifestPath,
    {
      force: true,
    },
  );

  console.log(
    '=== M8 OPPORTUNITY PLAY CAPTURE BATCH COMPLETE ===',
  );

  console.log(
    `Verified games: ${progress.verifiedGameCount}/${progress.plannedGameCount}`,
  );

  console.log(
    `Remaining games: ${progress.remainingGameCount}`,
  );

  console.log(
    `Progress SHA-256: ${progress.progressSha256}`,
  );

  console.log(
    'Complete capture manifest not written because planned games remain.',
  );

  process.exit(0);
}

const manifest =
  buildM8OpportunityPlayCaptureManifest({
    plan,
    planText:
      savedPlan.planText,
    capturedGames,
  });

await writeJsonAtomic(
  manifestPath,
  manifest,
);

await rm(
  progressPath,
  {
    force: true,
  },
);

console.log(
  '=== M8 OPPORTUNITY PLAY CAPTURE COMPLETE ===',
);

console.log(
  `Games captured or reused: ${manifest.gameCount}`,
);

console.log(
  `Source PA rows represented: ${manifest.sourceRowCount}`,
);

console.log(
  `Total pages: ${manifest.totalPageCount}`,
);

console.log(
  `Total plays: ${manifest.totalPlayRecordCount}`,
);

console.log(
  `Capture SHA-256: ${manifest.captureSha256}`,
);

console.log(
  'No opportunity model was fitted and no untouched-test rows were accessed.',
);
