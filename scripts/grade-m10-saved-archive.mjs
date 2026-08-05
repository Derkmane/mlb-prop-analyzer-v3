import { readFile } from 'node:fs/promises';
import path from 'node:path';

import {
  buildM10RealArchiveGradeReportV1,
  buildM10RealArchiveStatusReportV1,
  canonicalJsonBytes,
  M10_REAL_ARCHIVE_CAPTURE_KEY,
  M10_REAL_ARCHIVE_GRADING_VERSION,
  M10_REAL_ARCHIVE_PROJECTION_PATH,
  parseM10RealArchiveProjection,
  persistImmutableJson,
  playersByGame,
  sha256Bytes,
} from './m10-grade-saved-archive-utils.mjs';
import { requireSecret } from './provider-probe-utils.mjs';

const API_ORIGIN = 'https://api.balldontlie.io';
const DEFAULT_MINIMUM_REQUEST_INTERVAL_MS = 13_000;
const MAXIMUM_RETRIES = 3;
const REQUEST_TIMEOUT_MS = 30_000;

function nonemptyEnvironment(name, fallback = null) {
  const raw = process.env[name]?.trim();
  if (raw) return raw;
  if (fallback !== null) return fallback;
  throw new Error(`${name} is required.`);
}

function safeAttemptId(value) {
  if (!/^[A-Za-z0-9._-]+$/u.test(value)) {
    throw new Error('M10_GRADE_ATTEMPT_ID contains unsupported characters.');
  }
  return value;
}

function parseInterval(value) {
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 0) {
    throw new Error('M10_BDL_MIN_REQUEST_INTERVAL_MS must be a non-negative integer.');
  }
  return parsed;
}

function sleep(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

function retryAfterMilliseconds(response) {
  const raw = response.headers.get('retry-after');
  if (raw === null) return 60_000;
  const seconds = Number(raw);
  if (Number.isFinite(seconds) && seconds >= 0) {
    return Math.ceil(seconds * 1_000);
  }
  const timestamp = Date.parse(raw);
  if (Number.isFinite(timestamp)) {
    return Math.max(0, timestamp - Date.now());
  }
  return 60_000;
}

function createRequestPacer(minimumIntervalMilliseconds) {
  let lastStartedAt = 0;
  return async () => {
    const remaining =
      lastStartedAt + minimumIntervalMilliseconds - Date.now();
    if (remaining > 0) await sleep(remaining);
    lastStartedAt = Date.now();
  };
}

async function fetchProviderJson({ url, apiKey, pace, label }) {
  for (let attempt = 1; attempt <= MAXIMUM_RETRIES; attempt += 1) {
    await pace();
    const capturedAt = new Date().toISOString();
    const response = await fetch(url, {
      headers: { Authorization: apiKey },
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
    const bodyText = await response.text();
    if (response.status === 429 && attempt < MAXIMUM_RETRIES) {
      const waitMilliseconds = retryAfterMilliseconds(response);
      console.log(
        `RATE LIMIT\t${label}\tattempt=${attempt}\twait_ms=${waitMilliseconds}`,
      );
      await sleep(waitMilliseconds);
      continue;
    }
    if (!response.ok) {
      throw new Error(
        `${label} returned HTTP ${response.status}; response body SHA-256 ${sha256Bytes(Buffer.from(bodyText, 'utf8'))}.`,
      );
    }
    let parsed;
    try {
      parsed = JSON.parse(bodyText);
    } catch (error) {
      throw new Error(
        `${label} returned invalid JSON: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
    return Object.freeze({
      capturedAt,
      status: response.status,
      bodySha256: sha256Bytes(Buffer.from(bodyText, 'utf8')),
      response: parsed,
      request: Object.freeze({
        origin: url.origin,
        pathname: url.pathname,
        queryKeys: Object.freeze([...url.searchParams.keys()].sort()),
      }),
    });
  }
  throw new Error(`${label} exhausted retries.`);
}

function exactGameFromSpecificResponse(response, expectedGameId) {
  if (
    response === null ||
    typeof response !== 'object' ||
    Array.isArray(response) ||
    response.data === null ||
    typeof response.data !== 'object' ||
    Array.isArray(response.data)
  ) {
    throw new Error(
      `BALLDONTLIE game ${expectedGameId} response must contain one data object.`,
    );
  }
  if (response.data.id !== expectedGameId) {
    throw new Error(
      `BALLDONTLIE game response identity drift: expected ${expectedGameId}, received ${String(response.data.id)}.`,
    );
  }
  return response.data;
}

async function fetchStatsPages({ gameId, playerIds, apiKey, pace }) {
  const pages = [];
  let cursor = null;
  const seenCursors = new Set();
  do {
    const url = new URL('/mlb/v1/stats', API_ORIGIN);
    url.searchParams.set('per_page', '100');
    url.searchParams.append('game_ids[]', String(gameId));
    for (const playerId of playerIds) {
      url.searchParams.append('player_ids[]', String(playerId));
    }
    if (cursor !== null) url.searchParams.set('cursor', String(cursor));
    const page = await fetchProviderJson({
      url,
      apiKey,
      pace,
      label: `BALLDONTLIE stats game ${gameId}`,
    });
    pages.push(page);
    const response = page.response;
    if (
      response === null ||
      typeof response !== 'object' ||
      Array.isArray(response) ||
      !Array.isArray(response.data) ||
      response.meta === null ||
      typeof response.meta !== 'object' ||
      Array.isArray(response.meta)
    ) {
      throw new Error(
        `BALLDONTLIE stats game ${gameId} response shape is malformed.`,
      );
    }
    const nextCursor = response.meta.next_cursor;
    if (nextCursor === undefined || nextCursor === null) {
      cursor = null;
    } else {
      if (!Number.isSafeInteger(nextCursor)) {
        throw new Error(
          `BALLDONTLIE stats game ${gameId} next_cursor is malformed.`,
        );
      }
      if (seenCursors.has(nextCursor)) {
        throw new Error(
          `BALLDONTLIE stats game ${gameId} cursor loop detected.`,
        );
      }
      seenCursors.add(nextCursor);
      cursor = nextCursor;
    }
  } while (cursor !== null);
  return Object.freeze(pages);
}

function aggregateSnapshot({ attemptId, label, capturedAt, response }) {
  const bytes = canonicalJsonBytes(response);
  return Object.freeze({
    snapshotId: `${attemptId}-${label}`,
    sha256: sha256Bytes(bytes),
    capturedAt,
    response,
  });
}

function reportRoot(captureKey) {
  return path.join('artifacts', 'board-archives', 'batter-hits', captureKey);
}

function printLiteralGradeReport(report, persistence) {
  console.log('--- M10 REAL AUGUST 5 ARCHIVE GRADE OUTPUT ---');
  console.log(`CAPTURE: ${report.source.captureKey}`);
  console.log(`SOURCE ARCHIVE SHA-256: ${report.source.archiveSha256}`);
  console.log(`SOURCE ARCHIVE FILE SHA-256: ${report.source.archiveFileSha256}`);
  console.log(`PROJECTION SHA-256: ${report.source.projectionSha256}`);
  console.log(`ARCHIVE MODIFIED: ${report.source.archiveModified ? 'YES' : 'NO'}`);
  console.log(`GRADE REPORT: ${persistence.filePath}`);
  console.log(`GRADE REPORT SHA-256: ${persistence.sha256}`);
  console.log(`PICKS GRADED: ${report.summary.picksGraded}`);
  console.log(`WINS: ${report.summary.wins}`);
  console.log(`LOSSES: ${report.summary.losses}`);
  console.log(`VOIDS: ${report.summary.voids}`);
  console.log(`OBSERVED WIN RATE: ${String(report.summary.observedWinRate)}`);
  console.log(
    `PREDICTED MEAN P(WIN|GRADES): ${String(report.summary.predictedMeanWinProbability)}`,
  );
  console.log(
    `OBSERVED MINUS PREDICTED: ${String(report.summary.observedMinusPredicted)}`,
  );
  console.log(`EXPECTED WINS: ${report.summary.expectedWins}`);
  console.log(
    `ACTUAL MINUS EXPECTED WINS: ${report.summary.actualMinusExpectedWins}`,
  );
  console.log(`BINARY BRIER: ${String(report.summary.binaryBrier)}`);
  for (const pick of report.opportunityMinerPicks) {
    console.log(
      `OPPORTUNITY MINER\t${pick.playerName}\t${pick.selectedSide}\t${pick.postedLine}\thits=${pick.officialHits}\t${pick.outcome}\tp=${pick.archivedPWinGivenGrades}`,
    );
  }
  console.log('PRODUCTION: DISABLED');
  console.log('RANKING: DISABLED');
  console.log('--- END M10 REAL AUGUST 5 ARCHIVE GRADE OUTPUT ---');
}

const captureKey = nonemptyEnvironment(
  'M10_CAPTURE_KEY',
  M10_REAL_ARCHIVE_CAPTURE_KEY,
);
if (captureKey !== M10_REAL_ARCHIVE_CAPTURE_KEY) {
  throw new Error(
    `This version is pinned to capture ${M10_REAL_ARCHIVE_CAPTURE_KEY}; received ${captureKey}.`,
  );
}
const attemptId = safeAttemptId(
  nonemptyEnvironment('M10_GRADE_ATTEMPT_ID', `local-${Date.now()}`),
);
const apiKey = requireSecret('BALLDONTLIE_API_KEY');
const minimumIntervalMilliseconds = parseInterval(
  nonemptyEnvironment(
    'M10_BDL_MIN_REQUEST_INTERVAL_MS',
    String(DEFAULT_MINIMUM_REQUEST_INTERVAL_MS),
  ),
);
const pace = createRequestPacer(minimumIntervalMilliseconds);
const projectionBytes = await readFile(M10_REAL_ARCHIVE_PROJECTION_PATH);
const projection = parseM10RealArchiveProjection(projectionBytes);
const byGame = playersByGame(projection);
const root = reportRoot(captureKey);
const gamePages = [];
const games = [];

console.log('--- M10 REAL ARCHIVE GRADING ATTEMPT ---');
console.log(`GRADING VERSION: ${M10_REAL_ARCHIVE_GRADING_VERSION}`);
console.log(`CAPTURE: ${captureKey}`);
console.log(`ARCHIVED CANDIDATES: ${projection.rows.length}`);
console.log(`UNIQUE GAMES: ${byGame.size}`);
console.log(`ATTEMPT ID: ${attemptId}`);
console.log('REQUIRED GAME STATUS: STATUS_FINAL');
console.log('JOIN: EXACT providerGameId + providerPlayerId');

for (const gameId of byGame.keys()) {
  const url = new URL(`/mlb/v1/games/${gameId}`, API_ORIGIN);
  const page = await fetchProviderJson({
    url,
    apiKey,
    pace,
    label: `BALLDONTLIE game ${gameId}`,
  });
  const game = exactGameFromSpecificResponse(page.response, gameId);
  gamePages.push(page);
  games.push(game);
  console.log(`GAME STATUS\t${game.id}\t${game.status}\t${game.date}`);
}

const gameCapturedAt = new Date().toISOString();
const combinedGameResponse = Object.freeze({
  data: Object.freeze(games),
  meta: Object.freeze({ per_page: games.length }),
});
const gameSnapshot = aggregateSnapshot({
  attemptId,
  label: 'games',
  capturedAt: gameCapturedAt,
  response: combinedGameResponse,
});
const gameEvidencePath = path.join(
  root,
  'provider-evidence',
  attemptId,
  'games.json',
);
await persistImmutableJson(gameEvidencePath, {
  snapshot: {
    snapshotId: gameSnapshot.snapshotId,
    sha256: gameSnapshot.sha256,
    capturedAt: gameSnapshot.capturedAt,
  },
  pages: gamePages,
  combinedResponse: combinedGameResponse,
});

const nonFinalGames = games.filter((game) => game.status !== 'STATUS_FINAL');
if (nonFinalGames.length > 0) {
  const detail = nonFinalGames
    .map((game) => `${game.id}:${game.status}`)
    .join(', ');
  const statusReport = buildM10RealArchiveStatusReportV1({
    projection,
    checkedAt: new Date().toISOString(),
    attemptId,
    games,
    outcome: 'fail-closed-nonfinal-game',
    detail: `Required STATUS_FINAL for every archived game; non-final games: ${detail}.`,
  });
  const statusPath = path.join(
    root,
    'grading-attempts',
    `${attemptId}.json`,
  );
  const persisted = await persistImmutableJson(statusPath, statusReport);
  console.log(`GRADING STATUS: FAIL_CLOSED_NONFINAL_GAME`);
  console.log(`PICKS GRADED: 0`);
  console.log(`STATUS REPORT: ${persisted.filePath}`);
  console.log(`STATUS REPORT SHA-256: ${persisted.sha256}`);
  console.log('PRODUCTION: DISABLED');
  console.log('RANKING: DISABLED');
  throw new Error(
    `Real archive grading failed closed because ${detail}; no grade report was written.`,
  );
}

const statsPages = [];
const combinedStatsRows = [];
for (const [gameId, playerIds] of byGame) {
  const pages = await fetchStatsPages({
    gameId,
    playerIds,
    apiKey,
    pace,
  });
  statsPages.push(...pages);
  for (const page of pages) {
    combinedStatsRows.push(...page.response.data);
  }
  console.log(
    `STATS EVIDENCE\tgame=${gameId}\texpected_players=${playerIds.length}\tpages=${pages.length}`,
  );
}
const statsCapturedAt = new Date().toISOString();
const combinedStatsResponse = Object.freeze({
  data: Object.freeze(combinedStatsRows),
  meta: Object.freeze({ per_page: 100 }),
});
const statsSnapshot = aggregateSnapshot({
  attemptId,
  label: 'stats',
  capturedAt: statsCapturedAt,
  response: combinedStatsResponse,
});
const statsEvidencePath = path.join(
  root,
  'provider-evidence',
  attemptId,
  'stats.json',
);
await persistImmutableJson(statsEvidencePath, {
  snapshot: {
    snapshotId: statsSnapshot.snapshotId,
    sha256: statsSnapshot.sha256,
    capturedAt: statsSnapshot.capturedAt,
  },
  pages: statsPages,
  combinedResponse: combinedStatsResponse,
});

const report = buildM10RealArchiveGradeReportV1({
  projection,
  projectionPath: M10_REAL_ARCHIVE_PROJECTION_PATH,
  gradedAt: new Date().toISOString(),
  gameSnapshot,
  statsSnapshot,
});
const gradeReportPath = path.join(
  root,
  'grades',
  `${M10_REAL_ARCHIVE_GRADING_VERSION}.json`,
);
const gradePersistence = await persistImmutableJson(gradeReportPath, report);
const statusReport = buildM10RealArchiveStatusReportV1({
  projection,
  checkedAt: new Date().toISOString(),
  attemptId,
  games,
  outcome: 'graded',
  detail: `All ${games.length} exact archived games were STATUS_FINAL; immutable grade report ${gradeReportPath} was written without modifying the archive.`,
});
await persistImmutableJson(
  path.join(root, 'grading-attempts', `${attemptId}.json`),
  statusReport,
);
printLiteralGradeReport(report, gradePersistence);
