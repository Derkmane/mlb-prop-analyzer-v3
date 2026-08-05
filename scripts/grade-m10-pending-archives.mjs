import { access, mkdir, readFile, readdir } from 'node:fs/promises';
import path from 'node:path';

import {
  canonicalJsonBytes,
  persistImmutableJson,
} from './m10-grade-saved-archive-utils.mjs';
import {
  buildScheduledArchiveGradeReportV1,
  buildScheduledArchiveStatusReportV1,
  classifyArchiveGameStatuses,
  M10_SCHEDULED_ARCHIVE_GRADING_VERSION,
  playersByGame,
  sha256Bytes,
  verifyAndProjectM9ArchiveBytes,
} from './m10-scheduled-archive-grading-utils.mjs';
import { requireSecret } from './provider-probe-utils.mjs';

const API_ORIGIN = 'https://api.balldontlie.io';
const DEFAULT_ARCHIVE_ROOT = path.join(
  'artifacts',
  'board-archives',
  'batter-hits',
);
const DEFAULT_MINIMUM_REQUEST_INTERVAL_MS = 13_000;
const MAXIMUM_RETRIES = 3;
const REQUEST_TIMEOUT_MS = 30_000;
const CAPTURE_FILE_PATTERN = /^(\d{8}T\d{9}Z--[a-f0-9]{64})\.json$/u;

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
    throw new Error(
      'M10_BDL_MIN_REQUEST_INTERVAL_MS must be a non-negative integer.',
    );
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

function aggregateSnapshot({ attemptId, captureKey, label, capturedAt, response }) {
  const bytes = canonicalJsonBytes(response);
  return Object.freeze({
    snapshotId: `${attemptId}-${captureKey.slice(0, 17)}-${label}`,
    sha256: sha256Bytes(bytes),
    capturedAt,
    response,
  });
}

async function pathExists(filePath) {
  try {
    await access(filePath);
    return true;
  } catch (error) {
    if (error && typeof error === 'object' && error.code === 'ENOENT') {
      return false;
    }
    throw error;
  }
}

function printCalibration(report) {
  console.log('CALIBRATION\tBUCKET\tCOUNT\tPREDICTED\tOBSERVED');
  for (const bucket of report.calibration) {
    console.log(
      `CALIBRATION\t${bucket.label}\t${bucket.totalPicks}\t${String(bucket.predictedMeanProbability)}\t${String(bucket.observedWinRate)}`,
    );
  }
}

const archiveRoot = nonemptyEnvironment('M10_ARCHIVE_ROOT', DEFAULT_ARCHIVE_ROOT);
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
const capturesDirectory = path.join(archiveRoot, 'captures');
await mkdir(capturesDirectory, { recursive: true });
const entries = await readdir(capturesDirectory, { withFileTypes: true });
const captures = entries
  .filter((entry) => entry.isFile() && CAPTURE_FILE_PATTERN.test(entry.name))
  .map((entry) => ({
    fileName: entry.name,
    captureKey: CAPTURE_FILE_PATTERN.exec(entry.name)[1],
    filePath: path.join(capturesDirectory, entry.name),
  }))
  .sort((left, right) => left.captureKey.localeCompare(right.captureKey));

console.log('--- M10 SCHEDULED ARCHIVE GRADING ---');
console.log(`GRADING VERSION: ${M10_SCHEDULED_ARCHIVE_GRADING_VERSION}`);
console.log(`ARCHIVE ROOT: ${archiveRoot}`);
console.log(`CAPTURES FOUND: ${captures.length}`);
console.log(`ATTEMPT ID: ${attemptId}`);
console.log('REQUIRED GAME STATUS: STATUS_FINAL');
console.log('JOIN: EXACT providerGameId + providerPlayerId');
console.log('NON-FINAL POLICY: SKIP WITH IMMUTABLE STATUS EVIDENCE');

let alreadyGraded = 0;
let skippedNonFinal = 0;
let graded = 0;
let gradedPicks = 0;

for (const capture of captures) {
  const bytes = await readFile(capture.filePath);
  const projection = verifyAndProjectM9ArchiveBytes({
    bytes,
    archivePath: capture.filePath,
    expectedCaptureKey: capture.captureKey,
  });
  const reportRoot = path.join(archiveRoot, capture.captureKey);
  const gradeReportPath = path.join(
    reportRoot,
    'grades',
    `${M10_SCHEDULED_ARCHIVE_GRADING_VERSION}.json`,
  );
  if (await pathExists(gradeReportPath)) {
    alreadyGraded += 1;
    console.log(
      `ARCHIVE\t${capture.captureKey}\tALREADY_GRADED\tpicks=${projection.rows.length}`,
    );
    continue;
  }

  const byGame = playersByGame(projection);
  const gamePages = [];
  const games = [];
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
    console.log(
      `GAME STATUS\t${capture.captureKey}\t${game.id}\t${game.status}\t${game.date}`,
    );
  }
  const gameCapturedAt = new Date().toISOString();
  const combinedGameResponse = Object.freeze({
    data: Object.freeze(games),
    meta: Object.freeze({ per_page: games.length }),
  });
  const gameSnapshot = aggregateSnapshot({
    attemptId,
    captureKey: capture.captureKey,
    label: 'games',
    capturedAt: gameCapturedAt,
    response: combinedGameResponse,
  });
  await persistImmutableJson(
    path.join(
      reportRoot,
      'provider-evidence',
      attemptId,
      'games.json',
    ),
    {
      snapshot: {
        snapshotId: gameSnapshot.snapshotId,
        sha256: gameSnapshot.sha256,
        capturedAt: gameSnapshot.capturedAt,
      },
      pages: gamePages,
      combinedResponse: combinedGameResponse,
    },
  );

  const status = classifyArchiveGameStatuses(projection, games);
  if (!status.readyToGrade) {
    skippedNonFinal += 1;
    const detail = status.nonFinalGames
      .map((game) => `${game.providerGameId}:${game.status}`)
      .join(', ');
    const statusReport = buildScheduledArchiveStatusReportV1({
      projection,
      checkedAt: new Date().toISOString(),
      attemptId,
      games,
      outcome: 'skipped-nonfinal-game',
      detail: `Archive was not graded because these exact games were not STATUS_FINAL: ${detail}.`,
    });
    const persisted = await persistImmutableJson(
      path.join(
        reportRoot,
        'grading-attempts',
        `${attemptId}.json`,
      ),
      statusReport,
    );
    console.log(
      `ARCHIVE\t${capture.captureKey}\tSKIPPED_NONFINAL\tpicks_graded=0\tstatus_sha256=${persisted.sha256}`,
    );
    continue;
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
      `STATS EVIDENCE\t${capture.captureKey}\tgame=${gameId}\texpected_players=${playerIds.length}\tpages=${pages.length}`,
    );
  }
  const statsCapturedAt = new Date().toISOString();
  const combinedStatsResponse = Object.freeze({
    data: Object.freeze(combinedStatsRows),
    meta: Object.freeze({ per_page: 100 }),
  });
  const statsSnapshot = aggregateSnapshot({
    attemptId,
    captureKey: capture.captureKey,
    label: 'stats',
    capturedAt: statsCapturedAt,
    response: combinedStatsResponse,
  });
  await persistImmutableJson(
    path.join(
      reportRoot,
      'provider-evidence',
      attemptId,
      'stats.json',
    ),
    {
      snapshot: {
        snapshotId: statsSnapshot.snapshotId,
        sha256: statsSnapshot.sha256,
        capturedAt: statsSnapshot.capturedAt,
      },
      pages: statsPages,
      combinedResponse: combinedStatsResponse,
    },
  );

  const report = buildScheduledArchiveGradeReportV1({
    projection,
    gradedAt: new Date().toISOString(),
    gameSnapshot,
    statsSnapshot,
  });
  const gradePersistence = await persistImmutableJson(gradeReportPath, report);
  const statusReport = buildScheduledArchiveStatusReportV1({
    projection,
    checkedAt: new Date().toISOString(),
    attemptId,
    games,
    outcome: 'graded',
    detail: `All ${games.length} exact archived games were STATUS_FINAL; the immutable grade report was written separately without modifying the archive.`,
  });
  await persistImmutableJson(
    path.join(reportRoot, 'grading-attempts', `${attemptId}.json`),
    statusReport,
  );
  graded += 1;
  gradedPicks += report.summary.picksGraded;
  console.log(
    `ARCHIVE\t${capture.captureKey}\tGRADED\tpicks=${report.summary.picksGraded}\twins=${report.summary.wins}\tlosses=${report.summary.losses}\tvoids=${report.summary.voids}\tpredicted=${String(report.summary.predictedMeanWinProbability)}\tobserved=${String(report.summary.observedWinRate)}\treport_sha256=${gradePersistence.sha256}`,
  );
  printCalibration(report);
}

console.log(`ALREADY GRADED: ${alreadyGraded}`);
console.log(`SKIPPED NON-FINAL: ${skippedNonFinal}`);
console.log(`ARCHIVES GRADED: ${graded}`);
console.log(`PICKS GRADED: ${gradedPicks}`);
console.log('ARCHIVES MODIFIED: 0');
console.log('PRODUCTION: DISABLED');
console.log('RANKING: DISABLED');
console.log('--- END M10 SCHEDULED ARCHIVE GRADING ---');
