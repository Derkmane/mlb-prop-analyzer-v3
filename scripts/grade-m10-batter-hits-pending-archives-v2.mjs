import { createHash } from 'node:crypto';
import { access, mkdir, readFile, readdir } from 'node:fs/promises';
import path from 'node:path';

import { createBdlAdaptiveRateLimiter } from './bdl-adaptive-rate-limit-utils.mjs';
import { persistImmutableJson } from './m10-grade-saved-archive-utils.mjs';
import {
  buildScheduledArchiveStatusReportV1,
  classifyArchiveGameStatuses,
  M10_SCHEDULED_ARCHIVE_GRADING_VERSION,
  verifyAndProjectM9ArchiveBytes,
} from './m10-scheduled-archive-grading-utils.mjs';
import {
  BatterHitsCaptureEvidenceError,
  buildBatterHitsFinalGradeReportV2,
  M10_BATTER_HITS_GRADE_VERSION_V2,
} from './m10-batter-hits-final-grade-v2-utils.mjs';

const API_ORIGIN = 'https://api.balldontlie.io';
const ARCHIVE_ROOT = path.resolve(
  process.env.M10_ARCHIVE_ROOT?.trim() || 'artifacts/board-archives/batter-hits',
);
const ATTEMPT_ID = process.env.M10_GRADE_ATTEMPT_ID?.trim() || `local-${Date.now()}`;
const CAPTURE_PATTERN = /^(\d{8}T\d{9}Z--[a-f0-9]{64})\.json$/u;
const REQUEST_TIMEOUT_MS = 30_000;
const MAXIMUM_RETRIES = 8;
const apiKey = process.env.BALLDONTLIE_API_KEY?.trim();
if (!apiKey) throw new Error('Missing BALLDONTLIE_API_KEY.');
if (!/^[A-Za-z0-9._-]+$/u.test(ATTEMPT_ID)) {
  throw new Error('M10_GRADE_ATTEMPT_ID contains unsupported characters.');
}

const sleep = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));
const bdlRateLimiter = createBdlAdaptiveRateLimiter({
  fallbackDelayMs: 13_000,
  utilization: 0.9,
});
const requestCounts = { total: 0, gameStatus: 0, stats: 0, lineups: 0 };

async function exists(filePath) {
  try {
    await access(filePath);
    return true;
  } catch (error) {
    if (error && typeof error === 'object' && error.code === 'ENOENT') return false;
    throw error;
  }
}

function sha256(value) {
  return createHash('sha256').update(value).digest('hex');
}

function canonicalBytes(value) {
  return Buffer.from(`${JSON.stringify(value, null, 2)}\n`, 'utf8');
}

function countRequest(url) {
  requestCounts.total += 1;
  if (/^\/mlb\/v1\/games\/\d+$/u.test(url.pathname)) requestCounts.gameStatus += 1;
  else if (url.pathname === '/mlb/v1/stats') requestCounts.stats += 1;
  else if (url.pathname === '/mlb/v1/lineups') requestCounts.lineups += 1;
}

async function fetchBdl(url, label) {
  for (let attempt = 1; attempt <= MAXIMUM_RETRIES; attempt += 1) {
    await bdlRateLimiter.beforeRequest();
    countRequest(url);
    const response = await fetch(url, {
      headers: { Authorization: apiKey },
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
    bdlRateLimiter.afterResponse({ status: response.status, headers: response.headers });
    const text = await response.text();
    if (response.status === 429 && attempt < MAXIMUM_RETRIES) {
      const retrySeconds = Number(response.headers.get('retry-after'));
      await sleep(Number.isFinite(retrySeconds) ? retrySeconds * 1000 : 13_000);
      continue;
    }
    if (!response.ok) {
      throw new Error(`${label} returned HTTP ${response.status}; body_sha256=${sha256(Buffer.from(text, 'utf8'))}.`);
    }
    let body;
    try {
      body = JSON.parse(text);
    } catch (error) {
      throw new Error(`${label} returned invalid JSON: ${error instanceof Error ? error.message : String(error)}`);
    }
    return Object.freeze({ body, capturedAt: new Date().toISOString() });
  }
  throw new Error(`${label} exhausted retries.`);
}

async function fetchGame(gameId) {
  const snapshot = await fetchBdl(
    new URL(`/mlb/v1/games/${gameId}`, API_ORIGIN),
    `BDL Batter Hits game ${gameId}`,
  );
  const game = snapshot.body?.data;
  if (game === null || typeof game !== 'object' || Array.isArray(game) || game.id !== gameId) {
    throw new Error(`BDL Batter Hits game ${gameId} response identity is malformed.`);
  }
  return Object.freeze({ game, capturedAt: snapshot.capturedAt });
}

async function fetchCollection(gameId, pathname, label) {
  const rows = [];
  const pages = [];
  let cursor = null;
  const seenCursors = new Set();
  do {
    const url = new URL(pathname, API_ORIGIN);
    url.searchParams.append('game_ids[]', String(gameId));
    url.searchParams.set('per_page', '100');
    if (cursor !== null) url.searchParams.set('cursor', String(cursor));
    const snapshot = await fetchBdl(url, `BDL Batter Hits ${label} game ${gameId}`);
    const data = snapshot.body?.data;
    const meta = snapshot.body?.meta;
    if (!Array.isArray(data) || meta === null || typeof meta !== 'object' || Array.isArray(meta)) {
      throw new Error(`BDL Batter Hits ${label} game ${gameId} response shape is malformed.`);
    }
    rows.push(...data);
    pages.push(Object.freeze({ capturedAt: snapshot.capturedAt, rowCount: data.length, meta: Object.freeze({ ...meta }) }));
    const next = meta.next_cursor;
    if (next === undefined || next === null) {
      cursor = null;
    } else {
      if (!Number.isSafeInteger(next) || seenCursors.has(next)) {
        throw new Error(`BDL Batter Hits ${label} game ${gameId} pagination is malformed.`);
      }
      seenCursors.add(next);
      cursor = next;
    }
  } while (cursor !== null);
  return Object.freeze({
    gameId,
    rows: Object.freeze(rows),
    pages: Object.freeze(pages),
    capturedAt: pages.map((page) => page.capturedAt).sort().at(-1),
    coverage: Object.freeze({
      gameId,
      rowCount: rows.length,
      pageCount: pages.length,
      paginationComplete: true,
    }),
  });
}

function archiveGameIds(projection) {
  return [...new Set(projection.rows.map((row) => row.providerGameId))].sort((a, b) => a - b);
}

function unionGameIds(items) {
  return [...new Set(items.flatMap((item) => item.gameIds))].sort((a, b) => a - b);
}

function subsetSnapshot({ label, captureKey, gameIds, evidenceByGameId }) {
  const entries = gameIds.map((gameId) => {
    const value = evidenceByGameId.get(gameId);
    if (value === undefined) throw new Error(`${label} evidence missing game ${gameId}.`);
    return value;
  });
  const response = Object.freeze({
    data: Object.freeze(entries.flatMap((entry) => entry.rows)),
    meta: Object.freeze({ per_page: 100 }),
  });
  const gameCoverage = Object.freeze(entries.map((entry) => entry.coverage));
  const capturedAt = entries.map((entry) => entry.capturedAt).filter(Boolean).sort().at(-1);
  if (capturedAt === undefined) throw new Error(`${label} evidence has no capture timestamp.`);
  const bytes = canonicalBytes({ response, gameCoverage });
  return Object.freeze({
    snapshotId: `${ATTEMPT_ID}-${captureKey.slice(0, 17)}-${label}`,
    sha256: sha256(bytes),
    capturedAt,
    response,
    gameCoverage,
  });
}

function subsetGameSnapshot({ captureKey, gameIds, gameByGameId }) {
  const entries = gameIds.map((gameId) => {
    const value = gameByGameId.get(gameId);
    if (value === undefined) throw new Error(`game status evidence missing game ${gameId}.`);
    return value;
  });
  const response = Object.freeze({
    data: Object.freeze(entries.map((entry) => entry.game)),
    meta: Object.freeze({ per_page: entries.length }),
  });
  const capturedAt = entries.map((entry) => entry.capturedAt).sort().at(-1);
  const bytes = canonicalBytes(response);
  return Object.freeze({
    snapshotId: `${ATTEMPT_ID}-${captureKey.slice(0, 17)}-games`,
    sha256: sha256(bytes),
    capturedAt,
    response,
  });
}

const capturesDirectory = path.join(ARCHIVE_ROOT, 'captures');
await mkdir(capturesDirectory, { recursive: true });
const entries = await readdir(capturesDirectory, { withFileTypes: true });
const captures = entries
  .filter((entry) => entry.isFile() && CAPTURE_PATTERN.test(entry.name))
  .map((entry) => ({
    captureKey: CAPTURE_PATTERN.exec(entry.name)[1],
    filePath: path.join(capturesDirectory, entry.name),
  }))
  .sort((left, right) => left.captureKey.localeCompare(right.captureKey));

console.log('--- M10 BATTER HITS FINAL-ONLY GRADING V2 ---');
console.log(`ARCHIVE ROOT\t${ARCHIVE_ROOT}`);
console.log(`CAPTURES DISCOVERED\t${captures.length}`);
console.log(`ATTEMPT ID\t${ATTEMPT_ID}`);

const pending = [];
let alreadyGraded = 0;
for (const capture of captures) {
  const bytes = await readFile(capture.filePath);
  const projection = verifyAndProjectM9ArchiveBytes({
    bytes,
    archivePath: capture.filePath,
    expectedCaptureKey: capture.captureKey,
  });
  const reportRoot = path.join(ARCHIVE_ROOT, capture.captureKey, 'grades');
  const v2Path = path.join(reportRoot, `${M10_BATTER_HITS_GRADE_VERSION_V2}.json`);
  const v1Path = path.join(reportRoot, `${M10_SCHEDULED_ARCHIVE_GRADING_VERSION}.json`);
  if (await exists(v2Path) || await exists(v1Path)) {
    alreadyGraded += 1;
    console.log(`ALREADY GRADED\t${capture.captureKey}`);
    continue;
  }
  pending.push(Object.freeze({ capture, projection, v2Path, gameIds: Object.freeze(archiveGameIds(projection)) }));
}

const statusGameIds = unionGameIds(pending);
const gameByGameId = new Map();
for (const gameId of statusGameIds) gameByGameId.set(gameId, await fetchGame(gameId));

const ready = [];
let skippedNonFinal = 0;
for (const item of pending) {
  const gameSnapshot = subsetGameSnapshot({
    captureKey: item.capture.captureKey,
    gameIds: item.gameIds,
    gameByGameId,
  });
  const status = classifyArchiveGameStatuses(item.projection, gameSnapshot.response.data);
  const statusReport = buildScheduledArchiveStatusReportV1({
    projection: item.projection,
    checkedAt: gameSnapshot.capturedAt,
    attemptId: ATTEMPT_ID,
    games: gameSnapshot.response.data,
    outcome: status.readyToGrade ? 'ready-for-v2-grading' : 'skipped-nonfinal-game',
    detail: status.readyToGrade
      ? 'All exact archived games are STATUS_FINAL; v2 grading may use complete stats and lineup evidence.'
      : `Archive was not graded because these exact games were not STATUS_FINAL: ${status.nonFinalGames.map((game) => `${game.providerGameId}:${game.status}`).join(', ')}.`,
  });
  await persistImmutableJson(
    path.join(ARCHIVE_ROOT, item.capture.captureKey, 'grading-attempts', `${ATTEMPT_ID}.json`),
    statusReport,
  );
  if (!status.readyToGrade) {
    skippedNonFinal += 1;
    console.log(`SKIP NON-FINAL\t${item.capture.captureKey}`);
    continue;
  }
  ready.push(Object.freeze({ ...item, gameSnapshot }));
}

const settlementGameIds = unionGameIds(ready);
const statsByGameId = new Map();
const lineupsByGameId = new Map();
for (const gameId of settlementGameIds) {
  statsByGameId.set(gameId, await fetchCollection(gameId, '/mlb/v1/stats', 'stats'));
  lineupsByGameId.set(gameId, await fetchCollection(gameId, '/mlb/v1/lineups', 'lineups'));
}

let graded = 0;
let gradedPicks = 0;
const blocked = [];
for (const item of ready) {
  const statsSnapshot = subsetSnapshot({
    label: 'stats',
    captureKey: item.capture.captureKey,
    gameIds: item.gameIds,
    evidenceByGameId: statsByGameId,
  });
  const lineupSnapshot = subsetSnapshot({
    label: 'lineups',
    captureKey: item.capture.captureKey,
    gameIds: item.gameIds,
    evidenceByGameId: lineupsByGameId,
  });
  await persistImmutableJson(
    path.join(
      ARCHIVE_ROOT,
      item.capture.captureKey,
      'provider-evidence',
      `${ATTEMPT_ID}--batter-hits-v2-inputs.json`,
    ),
    {
      providerEvidenceVersion: 2,
      providerEvidenceType: 'm10-batter-hits-final-stats-and-lineups-before-grade',
      captureKey: item.capture.captureKey,
      gameSnapshot: item.gameSnapshot,
      statsSnapshot,
      lineupSnapshot,
      gradeEvaluatedAfterPersistence: true,
      productionEnabled: false,
      rankingEnabled: false,
    },
  );

  let report;
  try {
    report = buildBatterHitsFinalGradeReportV2({
      projection: item.projection,
      gradedAt: new Date().toISOString(),
      gameSnapshot: item.gameSnapshot,
      statsSnapshot,
      lineupSnapshot,
    });
  } catch (error) {
    if (!(error instanceof BatterHitsCaptureEvidenceError)) throw error;
    const blockedStatus = Object.freeze({
      blockedStatusVersion: 1,
      blockedStatusType: 'm10-batter-hits-v2-capture-blocked-evidence',
      captureKey: item.capture.captureKey,
      blockedAt: new Date().toISOString(),
      evidenceCode: error.code,
      providerGameId: error.providerGameId,
      providerPlayerId: error.providerPlayerId,
      providerIdentity: error.providerIdentity,
      error: error.message,
      gradeReportWritten: false,
      productionEnabled: false,
      rankingEnabled: false,
    });
    await persistImmutableJson(
      path.join(ARCHIVE_ROOT, item.capture.captureKey, 'blocked-status', `${ATTEMPT_ID}.json`),
      blockedStatus,
    );
    blocked.push(blockedStatus);
    console.error(`BLOCKED\t${item.capture.captureKey}\t${error.providerIdentity}\t${error.message}`);
    continue;
  }

  await persistImmutableJson(item.v2Path, report);
  graded += 1;
  gradedPicks += report.summary.picksGraded;
  console.log(
    `GRADED\t${item.capture.captureKey}\tpicks=${report.summary.picksGraded}\tvoids=${report.summary.voids}\tcalibration_eligible=${report.calibrationEligiblePicks}`,
  );
}

const limiter = bdlRateLimiter.snapshot();
console.log(`BDL REQUESTS GAME STATUS\t${requestCounts.gameStatus}`);
console.log(`BDL REQUESTS STATS\t${requestCounts.stats}`);
console.log(`BDL REQUESTS LINEUPS\t${requestCounts.lineups}`);
console.log(`BDL REQUESTS TOTAL\t${requestCounts.total}`);
console.log(`BDL RATE LIMIT PER MINUTE\t${limiter.limitPerMinute ?? 'unknown'}`);
console.log(`BDL INTERVAL MS\t${limiter.intervalMs}`);
console.log(`ALREADY GRADED\t${alreadyGraded}`);
console.log(`SKIPPED NON-FINAL\t${skippedNonFinal}`);
console.log(`ARCHIVES GRADED\t${graded}`);
console.log(`PICKS GRADED\t${gradedPicks}`);
console.log(`BLOCKED CAPTURES\t${blocked.length}`);
console.log('ARCHIVES MODIFIED\t0');
console.log('PRODUCTION\tDISABLED');
console.log('RANKING\tDISABLED');
console.log('--- END M10 BATTER HITS FINAL-ONLY GRADING V2 ---');
if (blocked.length > 0) process.exitCode = 1;
