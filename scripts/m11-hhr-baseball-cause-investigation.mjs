import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

import { createBdlAdaptiveRateLimiter } from './bdl-adaptive-rate-limit-utils.mjs';

const SOURCE_ROOT = path.resolve(process.env.HHR_CAUSE_SOURCE_ROOT || 'artifacts/source/batter-hhr');
const OUTPUT_ROOT = path.resolve(process.env.HHR_CAUSE_OUTPUT_ROOT || 'artifacts/m11/hhr/baseball-cause-investigation');
const REPORT_SHA = '8aabb3dc7403093eb6152378aa7784a909e0c3b4826f8d7334dd7d70113375de';
const CUMULATIVE_PATH = path.join(SOURCE_ROOT, 'cumulative', `m10-hhr-cumulative-selected-side-v1--${REPORT_SHA}.json`);
const SEED_CAPTURE_KEY = '20260806T004000Z--2c2e9c408a2226dfea2bcc42b009203d26bc2a307e08caed05f3b31e361aabdf';
const SEED_ARCHIVE_PATH = path.resolve('artifacts/m11/hhr/step3/archives', `${SEED_CAPTURE_KEY}.json`);
const ACTIVE_SEASON_START = '2026-03-26';
const ACTIVE_SEASON_END = '2026-08-11';

const bdlKey = process.env.BALLDONTLIE_API_KEY?.trim();
if (!bdlKey) throw new Error('Missing BALLDONTLIE_API_KEY.');

const limiter = createBdlAdaptiveRateLimiter({ fallbackDelayMs: 13_000, utilization: 0.9 });
const requestCounts = { total: 0, games: 0, stats: 0, lineups: 0, plays: 0, seasonStats: 0 };

function requestKind(pathname) {
  if (/^\/mlb\/v1\/games(?:\/\d+)?$/u.test(pathname)) return 'games';
  if (pathname === '/mlb/v1/stats') return 'stats';
  if (pathname === '/mlb/v1/lineups') return 'lineups';
  if (pathname === '/mlb/v1/plays') return 'plays';
  if (pathname === '/mlb/v1/season_stats') return 'seasonStats';
  return null;
}

async function fetchBdl(url, label) {
  for (let attempt = 0; attempt <= 8; attempt += 1) {
    await limiter.beforeRequest();
    requestCounts.total += 1;
    const kind = requestKind(url.pathname);
    if (kind) requestCounts[kind] += 1;
    const response = await fetch(url, { headers: { Authorization: bdlKey } });
    limiter.afterResponse({ status: response.status, headers: response.headers });
    const text = await response.text();
    if (response.status === 429 && attempt < 8) {
      await limiter.waitForRetry();
      continue;
    }
    if (!response.ok) throw new Error(`${label} returned HTTP ${response.status}: ${text.slice(0, 500)}`);
    return JSON.parse(text);
  }
  throw new Error(`${label} exhausted retries.`);
}

async function fetchPaged(endpoint, parameterEntries, label) {
  const rows = [];
  const pages = [];
  const seen = new Set();
  let cursor = null;
  do {
    const url = new URL(`https://api.balldontlie.io/mlb/v1/${endpoint}`);
    for (const [name, values] of Object.entries(parameterEntries)) {
      for (const value of values) url.searchParams.append(name, String(value));
    }
    url.searchParams.set('per_page', '100');
    if (cursor !== null) url.searchParams.set('cursor', String(cursor));
    const body = await fetchBdl(url, `${label} cursor ${cursor ?? 'first'}`);
    if (!Array.isArray(body?.data)) throw new Error(`${label} response has no data array.`);
    rows.push(...body.data);
    pages.push({ rowCount: body.data.length, meta: body.meta ?? null });
    cursor = body?.meta?.next_cursor ?? null;
    if (cursor !== null) {
      const key = String(cursor);
      if (seen.has(key)) throw new Error(`${label} repeated cursor ${key}.`);
      seen.add(key);
    }
  } while (cursor !== null);
  return { rows, pages };
}

function chunks(values, size) {
  const result = [];
  for (let i = 0; i < values.length; i += size) result.push(values.slice(i, i + size));
  return result;
}

function utcDates(startDate, endDate) {
  const start = new Date(`${startDate}T00:00:00.000Z`);
  const end = new Date(`${endDate}T00:00:00.000Z`);
  const values = [];
  for (let cursor = start; cursor <= end; cursor = new Date(cursor.getTime() + 86_400_000)) {
    values.push(cursor.toISOString().slice(0, 10));
  }
  return values;
}

function exactIdentity(row) {
  return JSON.stringify([
    row.providerEventId,
    row.providerGameId,
    row.providerPlayerId,
    row.providerMarketKey,
    row.offerType,
    row.selectedSide,
    row.postedLine,
  ]);
}

async function loadArchive(captureKey) {
  if (captureKey === SEED_CAPTURE_KEY) return JSON.parse(await readFile(SEED_ARCHIVE_PATH, 'utf8'));
  return JSON.parse(await readFile(path.join(SOURCE_ROOT, 'captures', `${captureKey}.json`), 'utf8'));
}

const cumulative = JSON.parse(await readFile(CUMULATIVE_PATH, 'utf8'));
if (cumulative.sourceSetSha256 !== REPORT_SHA) throw new Error('Cumulative source set mismatch.');
const evidenceRows = cumulative.selectedSide?.evidenceRows;
if (!Array.isArray(evidenceRows)) throw new Error('Full cumulative report lacks evidenceRows.');
const retained = evidenceRows.filter((row) => row.calibrationDedupStatus === 'retained');
if (retained.length !== 422) throw new Error(`Expected 422 retained rows; received ${retained.length}.`);
const cohortA = retained.filter((row) => row.postedLine === 0.5 && row.selectedSide === 'higher' && (row.outcome === 'win' || row.outcome === 'loss'));
const cohortBAll = retained.filter((row) => row.postedLine >= 2.5 && row.selectedSide === 'lower' && (row.outcome === 'win' || row.outcome === 'loss'));
const cohortBLosses = cohortBAll.filter((row) => row.outcome === 'loss');
if (cohortA.length !== 85 || cohortA.filter((row) => row.outcome === 'win').length !== 46 || cohortA.filter((row) => row.outcome === 'loss').length !== 39) {
  throw new Error('0.5 Higher cohort does not reproduce 85 decided / 46 wins / 39 losses.');
}
if (cohortBAll.length !== 11 || cohortBAll.filter((row) => row.outcome === 'win').length !== 3 || cohortBLosses.length !== 8) {
  throw new Error('2.5 Lower cohort does not reproduce 11 decided / 3 wins / 8 losses.');
}

const relevantRows = [...cohortA, ...cohortBLosses];
const captureKeys = [...new Set(relevantRows.map((row) => row.captureKey))].sort();
const archiveByCapture = new Map();
for (const captureKey of captureKeys) archiveByCapture.set(captureKey, await loadArchive(captureKey));

const cohortRows = relevantRows.map((gradeRow) => {
  const archive = archiveByCapture.get(gradeRow.captureKey);
  const matches = archive.rows.filter((row) => exactIdentity(row) === exactIdentity(gradeRow));
  if (matches.length !== 1) throw new Error(`Archive join expected 1 row for ${gradeRow.captureKey} ${gradeRow.playerName}; got ${matches.length}.`);
  const archivedRow = matches[0];
  const gameMatches = archive.games.filter((game) => (game.gameId ?? game.id) === gradeRow.providerGameId);
  if (gameMatches.length !== 1) throw new Error(`Archive game join expected 1 row for ${gradeRow.providerGameId}; got ${gameMatches.length}.`);
  return {
    cohort: gradeRow.postedLine === 0.5 ? 'A-0.5-Higher' : 'B-2.5-Lower-loss',
    grade: gradeRow,
    archive: {
      captureKey: gradeRow.captureKey,
      capturedAt: archive.capturedAt ?? gradeRow.captureTimestamp,
      row: archivedRow,
      game: gameMatches[0],
    },
  };
});

const targetGameIds = [...new Set(cohortRows.map((row) => row.grade.providerGameId))].sort((a, b) => a - b);
const finalGames = [];
for (const gameId of targetGameIds) {
  const body = await fetchBdl(new URL(`https://api.balldontlie.io/mlb/v1/games/${gameId}`), `final game ${gameId}`);
  if (!body?.data || typeof body.data !== 'object' || Array.isArray(body.data)) throw new Error(`Game ${gameId} response missing data object.`);
  finalGames.push(body.data);
}

const targetStats = await fetchPaged('stats', { 'game_ids[]': targetGameIds }, 'target game stats');
const targetLineups = await fetchPaged('lineups', { 'game_ids[]': targetGameIds }, 'target game lineups');

const targetPlays = [];
for (const gameId of targetGameIds) {
  const result = await fetchPaged('plays', { game_id: [gameId], sort_order: ['asc'] }, `plays game ${gameId}`);
  targetPlays.push({ gameId, rows: result.rows, pages: result.pages });
}

function teamNameFromLineup(gameId, playerId) {
  const rows = targetLineups.rows.filter((row) => row?.game_id === gameId && row?.player?.id === playerId);
  const names = [...new Set(rows.map((row) => row?.team?.display_name).filter((value) => typeof value === 'string' && value.length > 0))];
  return names.length === 1 ? names[0] : null;
}

const actualStarterIds = new Set();
for (const item of cohortRows) {
  const gameId = item.grade.providerGameId;
  const batterTeam = teamNameFromLineup(gameId, item.grade.providerPlayerId);
  if (batterTeam === null) continue;
  const game = item.archive.game;
  const home = game.homeTeamName ?? game.home_team_name ?? game.home_team?.display_name ?? null;
  const away = game.awayTeamName ?? game.away_team_name ?? game.away_team?.display_name ?? null;
  const opponent = batterTeam === home ? away : batterTeam === away ? home : null;
  if (opponent === null) continue;
  const starters = targetStats.rows.filter((row) =>
    row?.game_id === gameId &&
    row?.team_name === opponent &&
    row?.games_started === 1 &&
    Number.isSafeInteger(row?.pitching_outs) && row.pitching_outs > 0
  );
  for (const starter of starters) if (Number.isSafeInteger(starter?.player?.id)) actualStarterIds.add(starter.player.id);
}

const probableStarterIds = new Set(cohortRows.map((row) => row.grade.inputLineage?.probableStarterPlayerId).filter(Number.isSafeInteger));
const starterIds = [...new Set([...probableStarterIds, ...actualStarterIds])].sort((a, b) => a - b);

const historyGames = [];
for (const dateBatch of chunks(utcDates(ACTIVE_SEASON_START, ACTIVE_SEASON_END), 90)) {
  const result = await fetchPaged('games', { 'dates[]': dateBatch, season_type: ['regular'] }, `historical games ${dateBatch[0]}..${dateBatch.at(-1)}`);
  historyGames.push(...result.rows);
}
const historyGameIds = [...new Set(historyGames.map((game) => game?.id).filter(Number.isSafeInteger))].sort((a, b) => a - b);

const starterHistoryStats = [];
for (const gameBatch of chunks(historyGameIds, 100)) {
  for (const playerBatch of chunks(starterIds, 100)) {
    const result = await fetchPaged('stats', { 'game_ids[]': gameBatch, 'player_ids[]': playerBatch }, `starter history stats ${gameBatch[0]}..${gameBatch.at(-1)}`);
    starterHistoryStats.push(...result.rows);
  }
}

const seasonStats = [];
for (const playerBatch of chunks(starterIds, 100)) {
  const result = await fetchPaged('season_stats', { 'player_ids[]': playerBatch, season: [2026], season_type: ['regular'] }, 'starter season stats');
  seasonStats.push(...result.rows);
}

await mkdir(OUTPUT_ROOT, { recursive: true });
const output = {
  investigationVersion: 1,
  purpose: 'Read-only HHR baseball-cause evidence capture for the exact 8aabb cumulative cohort. No fitting or model changes.',
  capturedAt: new Date().toISOString(),
  source: {
    cumulativeSourceSetSha256: REPORT_SHA,
    actionsArtifactRunId: 31634804531,
    actionsArtifactName: 'm10-pending-archive-grades-31634804531-1',
    reservedCapturesRead: false,
  },
  cohortChecks: {
    retainedRows: retained.length,
    cohortA: { decided: cohortA.length, wins: cohortA.filter((row) => row.outcome === 'win').length, losses: cohortA.filter((row) => row.outcome === 'loss').length },
    cohortB: { decided: cohortBAll.length, wins: cohortBAll.filter((row) => row.outcome === 'win').length, losses: cohortBLosses.length },
  },
  requestCounts,
  cohortRows,
  providerEvidence: {
    finalGames,
    targetStats: targetStats.rows,
    targetLineups: targetLineups.rows,
    targetPlays,
    historicalGames: historyGames,
    starterHistoryStats,
    seasonStats,
  },
};
const outputPath = path.join(OUTPUT_ROOT, 'raw-evidence.json');
await writeFile(outputPath, `${JSON.stringify(output, null, 2)}\n`, 'utf8');

console.log('--- M11 HHR BASEBALL CAUSE EVIDENCE ---');
console.log(`SOURCE SET\t${REPORT_SHA}`);
console.log(`RETAINED\t${retained.length}`);
console.log(`COHORT A\t${cohortA.length}\tW=${cohortA.filter((row) => row.outcome === 'win').length}\tL=${cohortA.filter((row) => row.outcome === 'loss').length}`);
console.log(`COHORT B\t${cohortBAll.length}\tW=${cohortBAll.filter((row) => row.outcome === 'win').length}\tL=${cohortBLosses.length}`);
console.log(`TARGET GAMES\t${targetGameIds.length}`);
console.log(`STARTER IDS\t${starterIds.length}`);
console.log(`REQUESTS\t${JSON.stringify(requestCounts)}`);
console.log(`OUTPUT\t${outputPath}`);
console.log('RESERVED CAPTURES READ\tfalse');
console.log('FITTING PERFORMED\tfalse');
console.log('--- END M11 HHR BASEBALL CAUSE EVIDENCE ---');
