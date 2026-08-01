import { access, readFile } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

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
  ARCHIVE_CONTRACT,
  chicagoDate,
} from './archive-m9-batter-hits-board.mjs';

export const GRADE_VERSION = 2;
export const GRADE_CONTRACT = 'm9-batter-hits-prospective-board-grade-v2';
export const GRADING_VERSION = 'm9-batter-hits-official-hits-grading-v2';
export const PROJECT_RULES_VERSION = '2.3';
export const MATH_SPEC_VERSION = '1.5';

const SHA256_PATTERN = /^[a-f0-9]{64}$/u;
const GRADE_RESULTS = new Set(['WIN', 'LOSS', 'VOID']);

function object(value, label) {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new TypeError(`${label} must be an object.`);
  }
  return value;
}

function array(value, label) {
  if (!Array.isArray(value)) {
    throw new TypeError(`${label} must be an array.`);
  }
  return value;
}

function string(value, label) {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new TypeError(`${label} must be a non-empty string.`);
  }
  return value.trim();
}

function positiveInteger(value, label) {
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new TypeError(`${label} must be a positive integer.`);
  }
  return value;
}

function nonNegativeInteger(value, label) {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new TypeError(`${label} must be a non-negative integer.`);
  }
  return value;
}

function finiteNumber(value, label) {
  if (!Number.isFinite(value)) {
    throw new TypeError(`${label} must be finite.`);
  }
  return value;
}

function timestamp(value, label) {
  const parsed = string(value, label);
  if (!Number.isFinite(Date.parse(parsed))) {
    throw new TypeError(`${label} must be an ISO timestamp.`);
  }
  return parsed;
}

function sha256Value(value, label) {
  const parsed = string(value, label);
  if (!SHA256_PATTERN.test(parsed)) {
    throw new TypeError(`${label} must be a lowercase SHA-256 digest.`);
  }
  return parsed;
}

function playerId(row) {
  return row?.player?.id;
}

function teamId(row) {
  return row?.team?.id;
}

function archiveIdentity(archive) {
  const { archiveSha256: ignored, ...identity } = archive;
  return identity;
}

export function verifyProspectiveArchive(archiveValue, hash = sha256) {
  const archive = object(archiveValue, 'prospective archive');
  if (archive.archiveContract !== ARCHIVE_CONTRACT) {
    throw new Error(`Unsupported archive contract: ${String(archive.archiveContract)}.`);
  }
  if (archive.productionEnabled !== false) {
    throw new Error('Prospective archive must remain production-disabled.');
  }
  if (archive.productionRankingAuthorized !== false) {
    throw new Error('Prospective archive must not authorize ranking.');
  }
  if (archive.gradingPerformed !== false) {
    throw new Error('Source prospective archive must be ungraded.');
  }
  if (archive.untouchedTestAccessed !== false) {
    throw new Error('Prospective archive must not access untouched-test rows.');
  }
  const expected = hash(JSON.stringify(archiveIdentity(archive)));
  if (sha256Value(archive.archiveSha256, 'archive.archiveSha256') !== expected) {
    throw new Error('Prospective archive SHA-256 verification failed.');
  }
  array(archive.rows, 'archive.rows');
  return Object.freeze(archive);
}

export function settleOfficialHits({ selectedSide, line, actualHits }) {
  const side = string(selectedSide, 'selectedSide');
  const postedLine = finiteNumber(line, 'line');
  const hits = nonNegativeInteger(actualHits, 'actualHits');
  if (side !== 'higher' && side !== 'lower') {
    throw new Error(`Unsupported selected side: ${side}.`);
  }
  if (hits === postedLine) return 'VOID';
  if (side === 'higher') return hits > postedLine ? 'WIN' : 'LOSS';
  return hits < postedLine ? 'WIN' : 'LOSS';
}

function validateGame(game, expectedGameId) {
  const value = object(game, `game ${expectedGameId}`);
  if (value.id !== expectedGameId) {
    throw new Error(`Game endpoint identity mismatch for ${expectedGameId}.`);
  }
  if (
    value.season !== 2026 ||
    value.season_type !== 'regular' ||
    value.postseason !== false
  ) {
    throw new Error(`Game ${expectedGameId} is outside the approved 2026 regular season.`);
  }
  return value;
}

function exactStatsMatch({ row, statsRows }) {
  const gameId = positiveInteger(row.event.providerGameId, 'row.event.providerGameId');
  const providerPlayerId = positiveInteger(
    row.player.providerPlayerId,
    'row.player.providerPlayerId',
  );
  const providerTeamId = positiveInteger(
    row.player.providerTeamId,
    'row.player.providerTeamId',
  );
  return statsRows.filter(
    (statsRow) =>
      statsRow?.game_id === gameId &&
      playerId(statsRow) === providerPlayerId &&
      teamId(statsRow) === providerTeamId,
  );
}

export function gradeArchiveRow({ row: rowValue, game, statsRows }) {
  const row = object(rowValue, 'archive row');
  const event = object(row.event, 'archive row event');
  const player = object(row.player, 'archive row player');
  const market = object(row.market, 'archive row market');
  const probabilities = object(row.probabilities, 'archive row probabilities');
  const versions = object(row.versions, 'archive row versions');
  const gameId = positiveInteger(event.providerGameId, 'event.providerGameId');
  const verifiedGame = validateGame(game, gameId);

  const base = {
    event: Object.freeze({
      providerEventId: string(event.providerEventId, 'event.providerEventId'),
      providerGameId: gameId,
      homeTeamName: string(event.homeTeamName, 'event.homeTeamName'),
      awayTeamName: string(event.awayTeamName, 'event.awayTeamName'),
      commenceTime: timestamp(event.commenceTime, 'event.commenceTime'),
    }),
    player: Object.freeze({
      providerPlayerId: positiveInteger(player.providerPlayerId, 'player.providerPlayerId'),
      providerTeamId: positiveInteger(player.providerTeamId, 'player.providerTeamId'),
      playerName: string(player.playerName, 'player.playerName'),
      teamName: string(player.teamName, 'player.teamName'),
    }),
    market: Object.freeze({
      baseMarketKey: string(market.baseMarketKey, 'market.baseMarketKey'),
      providerMarketKey: string(market.providerMarketKey, 'market.providerMarketKey'),
      offerType: string(market.offerType, 'market.offerType'),
      line: finiteNumber(market.line, 'market.line'),
      selectedSide: string(market.selectedSide, 'market.selectedSide'),
      rawSide: string(market.rawSide, 'market.rawSide'),
    }),
    archivedProbabilities: Object.freeze({
      pWin: finiteNumber(probabilities.pWin, 'probabilities.pWin'),
      pLoss: finiteNumber(probabilities.pLoss, 'probabilities.pLoss'),
      pVoid: finiteNumber(probabilities.pVoid, 'probabilities.pVoid'),
      pWinGivenGrades:
        probabilities.pWinGivenGrades === null
          ? null
          : finiteNumber(
              probabilities.pWinGivenGrades,
              'probabilities.pWinGivenGrades',
            ),
    }),
    archivedVersions: Object.freeze({
      projectRulesVersion: string(
        versions.projectRulesVersion,
        'versions.projectRulesVersion',
      ),
      mathSpecVersion: string(versions.mathSpecVersion, 'versions.mathSpecVersion'),
      modelVersion: string(versions.modelVersion, 'versions.modelVersion'),
      distributionBuilderVersion: string(
        versions.distributionBuilderVersion,
        'versions.distributionBuilderVersion',
      ),
      settlementRuleVersion: string(
        versions.settlementRuleVersion,
        'versions.settlementRuleVersion',
      ),
    }),
  };

  if (verifiedGame.status !== 'STATUS_FINAL') {
    return Object.freeze({
      gradeRowVersion: 1,
      ...base,
      status: 'PENDING',
      result: null,
      actualHits: null,
      reason: 'GAME_NOT_FINAL',
    });
  }

  const matches = exactStatsMatch({ row, statsRows: array(statsRows, 'statsRows') });
  if (matches.length !== 1) {
    return Object.freeze({
      gradeRowVersion: 1,
      ...base,
      status: 'UNRESOLVED',
      result: null,
      actualHits: null,
      reason: 'OFFICIAL_STATS_ROW_NOT_UNIQUE',
      officialStatsRowCount: matches.length,
    });
  }

  const stats = object(matches[0], 'official player stats row');
  if (!Number.isSafeInteger(stats.hits) || stats.hits < 0) {
    return Object.freeze({
      gradeRowVersion: 1,
      ...base,
      status: 'UNRESOLVED',
      result: null,
      actualHits: null,
      reason: 'OFFICIAL_HITS_NOT_AVAILABLE',
      officialStatsRowCount: 1,
    });
  }

  const result = settleOfficialHits({
    selectedSide: market.selectedSide,
    line: market.line,
    actualHits: stats.hits,
  });
  if (!GRADE_RESULTS.has(result)) {
    throw new Error(`Unexpected grade result ${result}.`);
  }

  return Object.freeze({
    gradeRowVersion: 1,
    ...base,
    status: 'GRADED',
    result,
    actualHits: stats.hits,
    reason: null,
    officialStatsRowCount: 1,
  });
}

function compareGradeRows(left, right) {
  return JSON.stringify([
    left.event.commenceTime,
    left.event.providerEventId,
    left.player.playerName,
    left.market.providerMarketKey,
    left.market.line,
    left.market.selectedSide,
  ]).localeCompare(
    JSON.stringify([
      right.event.commenceTime,
      right.event.providerEventId,
      right.player.playerName,
      right.market.providerMarketKey,
      right.market.line,
      right.market.selectedSide,
    ]),
  );
}

export function buildProspectiveGradeReport({
  archive,
  archivePath,
  gradedAt,
  gameEvidenceById,
  hash = sha256,
}) {
  const verifiedArchive = verifyProspectiveArchive(archive, hash);
  const evidence = gameEvidenceById instanceof Map
    ? gameEvidenceById
    : new Map(Object.entries(object(gameEvidenceById, 'gameEvidenceById')));
  const rows = verifiedArchive.rows
    .map((row) => {
      const gameId = positiveInteger(
        row?.event?.providerGameId,
        'archive row providerGameId',
      );
      const gameEvidence = evidence.get(gameId) ?? evidence.get(String(gameId));
      if (!gameEvidence) {
        return Object.freeze({
          gradeRowVersion: 1,
          event: row.event,
          player: row.player,
          market: row.market,
          archivedProbabilities: row.probabilities,
          archivedVersions: row.versions,
          status: 'UNRESOLVED',
          result: null,
          actualHits: null,
          reason: 'GAME_EVIDENCE_MISSING',
        });
      }
      return gradeArchiveRow({
        row,
        game: gameEvidence.game,
        statsRows: gameEvidence.statsRows,
      });
    })
    .sort(compareGradeRows);

  const counts = rows.reduce(
    (result, row) => {
      result.total += 1;
      if (row.status === 'PENDING') result.pending += 1;
      if (row.status === 'UNRESOLVED') result.unresolved += 1;
      if (row.status === 'GRADED') {
        result.graded += 1;
        if (row.result === 'WIN') result.wins += 1;
        if (row.result === 'LOSS') result.losses += 1;
        if (row.result === 'VOID') result.voids += 1;
      }
      return result;
    },
    { total: 0, graded: 0, pending: 0, unresolved: 0, wins: 0, losses: 0, voids: 0 },
  );
  const complete = counts.total > 0 && counts.pending === 0 && counts.unresolved === 0;
  const observedAt = timestamp(gradedAt, 'gradedAt');
  const identity = {
    gradeVersion: GRADE_VERSION,
    gradeContract: GRADE_CONTRACT,
    gradingVersion: GRADING_VERSION,
    archiveDate: string(verifiedArchive.archiveDate, 'archive.archiveDate'),
    sourceArchivePath: string(archivePath, 'archivePath'),
    sourceArchiveSha256: sha256Value(
      verifiedArchive.archiveSha256,
      'archive.archiveSha256',
    ),
    sourceArchiveProjectRulesVersion: string(
      verifiedArchive.projectRulesVersion,
      'archive.projectRulesVersion',
    ),
    projectRulesVersion: PROJECT_RULES_VERSION,
    mathSpecVersion: MATH_SPEC_VERSION,
    productionEnabled: false,
    productionRankingAuthorized: false,
    untouchedTestAccessed: false,
    complete,
    counts: Object.freeze(counts),
    rows: Object.freeze(rows),
  };
  return Object.freeze({
    ...identity,
    gradedAt: observedAt,
    gradeSha256: hash(JSON.stringify(identity)),
  });
}

async function exists(filePath) {
  try {
    await access(filePath);
    return true;
  } catch (error) {
    if (error?.code === 'ENOENT') return false;
    throw error;
  }
}

export async function persistCompleteGrade({ filePath, report, writeJson = writeJsonAtomic }) {
  if (report.complete !== true) {
    return Object.freeze({ filePath, persisted: false, reused: false });
  }
  if (await exists(filePath)) {
    const existing = JSON.parse(await readFile(filePath, 'utf8'));
    if (existing.gradeSha256 === report.gradeSha256) {
      return Object.freeze({ filePath, persisted: true, reused: true });
    }
    throw new Error(`Immutable grade already exists with different identity: ${filePath}`);
  }
  await writeJson(filePath, report);
  return Object.freeze({ filePath, persisted: true, reused: false });
}

async function captureBdlJson({ label, url, apiKey, limiter }) {
  for (let attempt = 0; attempt <= 8; attempt += 1) {
    await limiter.beforeRequest();
    const capturedAt = new Date().toISOString();
    const snapshot = await fetchJsonSnapshot({
      label,
      url,
      headers: { Authorization: apiKey },
      secrets: [apiKey],
    });
    limiter.afterResponse({
      status: snapshot.response.status,
      headers: snapshot.response.headers,
    });
    if (snapshot.response.status === 429) {
      if (attempt >= 8) {
        throw new Error(`${label} exceeded 8 automatic HTTP 429 retries.`);
      }
      await limiter.waitForRetry();
      continue;
    }
    if (!snapshot.ok) {
      throw new Error(`${label} returned HTTP ${snapshot.response.status} ${snapshot.response.statusText}.`);
    }
    let body;
    try {
      body = JSON.parse(snapshot.sanitizedBodyText);
    } catch {
      throw new Error(`${label} returned invalid JSON.`);
    }
    return Object.freeze({
      label,
      capturedAt,
      rawBodySha256: snapshot.response.rawBodySha256,
      body,
    });
  }
  throw new Error(`Unreachable retry state for ${label}.`);
}

async function captureStatsPages({ gameId, apiKey, limiter }) {
  const rows = [];
  const snapshots = [];
  const seen = new Set();
  let cursor = null;
  let pageNumber = 1;
  while (true) {
    const url = new URL('https://api.balldontlie.io/mlb/v1/stats');
    url.searchParams.append('game_ids[]', String(gameId));
    url.searchParams.set('per_page', '100');
    if (cursor !== null) url.searchParams.set('cursor', String(cursor));
    const capture = await captureBdlJson({
      label: `BALLDONTLIE stats game ${gameId} page ${pageNumber}`,
      url,
      apiKey,
      limiter,
    });
    const data = array(object(capture.body, 'stats response').data, 'stats response data');
    rows.push(...data);
    snapshots.push(capture);
    const nextCursor = capture.body?.meta?.next_cursor ?? null;
    if (nextCursor === null || nextCursor === undefined) break;
    const key = String(nextCursor);
    if (seen.has(key)) throw new Error(`BALLDONTLIE stats repeated cursor ${key}.`);
    seen.add(key);
    cursor = nextCursor;
    pageNumber += 1;
  }
  return Object.freeze({ rows: Object.freeze(rows), snapshots: Object.freeze(snapshots) });
}

export async function runLiveProspectiveGrading({
  archiveDate = process.env.M9_BATTER_HITS_ARCHIVE_DATE?.trim() || chicagoDate(),
  archiveRoot = path.join('artifacts', 'board-archives', 'batter-hits'),
  gradeRoot = path.join('artifacts', 'board-archives', 'batter-hits', 'grades'),
} = {}) {
  const archivePath = path.join(archiveRoot, `${archiveDate}.json`);
  const archive = verifyProspectiveArchive(
    JSON.parse(await readFile(archivePath, 'utf8')),
  );
  const apiKey = requireSecret('BALLDONTLIE_API_KEY');
  const limiter = createBdlAdaptiveRateLimiter({
    fallbackDelayMs: 13_000,
    utilization: 0.9,
  });
  const gameIds = [...new Set(archive.rows.map((row) => row.event.providerGameId))].sort(
    (left, right) => left - right,
  );
  const evidence = new Map();

  for (const gameId of gameIds) {
    const gameUrl = new URL(`https://api.balldontlie.io/mlb/v1/games/${gameId}`);
    const gameCapture = await captureBdlJson({
      label: `BALLDONTLIE game ${gameId}`,
      url: gameUrl,
      apiKey,
      limiter,
    });
    const game = object(gameCapture.body, `game ${gameId} response`).data;
    let statsRows = [];
    let statsSnapshots = [];
    if (game?.status === 'STATUS_FINAL') {
      const stats = await captureStatsPages({ gameId, apiKey, limiter });
      statsRows = stats.rows;
      statsSnapshots = stats.snapshots;
    }
    evidence.set(gameId, Object.freeze({
      game,
      statsRows: Object.freeze(statsRows),
      source: Object.freeze({
        game: Object.freeze({
          capturedAt: gameCapture.capturedAt,
          rawBodySha256: gameCapture.rawBodySha256,
        }),
        stats: Object.freeze(
          statsSnapshots.map((snapshot) => Object.freeze({
            capturedAt: snapshot.capturedAt,
            rawBodySha256: snapshot.rawBodySha256,
          })),
        ),
      }),
    }));
  }

  const report = buildProspectiveGradeReport({
    archive,
    archivePath,
    gradedAt: new Date().toISOString(),
    gameEvidenceById: evidence,
  });
  const gradePath = path.join(gradeRoot, `${archiveDate}.json`);
  const persistence = await persistCompleteGrade({ filePath: gradePath, report });

  console.log('=== M9 BATTER HITS PROSPECTIVE GRADING ===');
  console.log(`Archive: ${archivePath}`);
  console.log(`Archive SHA-256: ${archive.archiveSha256}`);
  console.log(`Grade path: ${gradePath}`);
  console.log(`Grade SHA-256: ${report.gradeSha256}`);
  console.log(`Rows: ${report.counts.total}`);
  console.log(`Graded: ${report.counts.graded}`);
  console.log(`Pending: ${report.counts.pending}`);
  console.log(`Unresolved: ${report.counts.unresolved}`);
  console.log(`Wins: ${report.counts.wins}`);
  console.log(`Losses: ${report.counts.losses}`);
  console.log(`Voids: ${report.counts.voids}`);
  console.log('First five grade rows:');
  console.log(JSON.stringify(report.rows.slice(0, 5), null, 2));
  console.log(`Grade complete: ${report.complete}`);
  console.log(`Grade persisted: ${persistence.persisted}`);
  console.log(`Grade reused: ${persistence.reused}`);
  console.log('Production enabled: false');
  console.log('Production ranking authorized: false');
  console.log('Untouched-test rows accessed: false');
  return report;
}

const invokedUrl = process.argv[1]
  ? pathToFileURL(path.resolve(process.argv[1])).href
  : null;
if (invokedUrl === import.meta.url) {
  runLiveProspectiveGrading().catch((error) => {
    console.error(error instanceof Error ? error.stack : String(error));
    process.exitCode = 1;
  });
}
