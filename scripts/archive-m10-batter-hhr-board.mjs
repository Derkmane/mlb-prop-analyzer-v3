import { createHash } from 'node:crypto';
import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import path from 'node:path';

import {
  buildBatterHhrDirectCompositeDistribution,
  normalizeUnderdogBatterHhrCapture,
  settleBatterHhrDistribution,
} from '../dist/src/features/batter-hhr/index.js';
import {
  capturePlayerIdentityLookups,
  captureProjectedLineupHistory,
  resolveExactBallDontLieGameMatch,
  resolveProjectedLineupIdentity,
} from './archive-m9-batter-hits-board.mjs';
import { createBdlAdaptiveRateLimiter } from './bdl-adaptive-rate-limit-utils.mjs';
import {
  attachPhase2DisplayEnrichment,
  capturePhase2DisplayEnrichment,
} from './phase2-display-enrichment-utils.mjs';
import { classifyHhrUnderdogBookmakerAvailability } from './m10-hhr-board-availability-utils.mjs';
import { persistImmutableJson } from './m10-grade-saved-archive-utils.mjs';
import { buildM10HhrProspectiveArchive } from './m10-hhr-evidence-utils.mjs';
import {
  HHR_HIT_CATEGORIES,
  HHR_ON_BASE_CATEGORIES,
  HHR_TERMINAL_CATEGORIES,
  applyHhrPark,
  buildHhrOpportunityContext,
  buildHhrParkMultiplierMap,
  buildHhrTeamBullpenMap,
  declaredBatterHand,
  declaredPitcherHand,
  hhrCoherentVector,
  hhrLogit,
  hhrPlatoonBatterVector,
  hhrVectorMass,
  medianHhrValue,
  normalizeHhrVector,
  resolveBatterHand,
} from './m11-hhr-conditioning-utils.mjs';

const oddsKey = process.env.THE_ODDS_API_KEY?.trim();
const bdlKey = process.env.BALLDONTLIE_API_KEY?.trim();
if (!oddsKey) throw new Error('Missing THE_ODDS_API_KEY.');
if (!bdlKey) throw new Error('Missing BALLDONTLIE_API_KEY.');

const HITS_ARCHIVE_ROOT = path.resolve(
  process.env.M10_ARCHIVE_ROOT?.trim() || 'artifacts/board-archives/batter-hits',
);
const HHR_ARCHIVE_ROOT = path.resolve(
  process.env.M10_HHR_ARCHIVE_ROOT?.trim() || 'artifacts/board-archives/batter-hhr',
);
const HITS_CAPTURE_PATTERN = /^(\d{8}T\d{9}Z--[a-f0-9]{64})\.json$/u;
const MODEL_PATH = path.resolve('model-artifacts/m11-batter-hhr-direct-composite-v2.json');
const sha256 = (value) => createHash('sha256').update(value).digest('hex');
const sleep = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));
const bdlRateLimiter = createBdlAdaptiveRateLimiter({
  fallbackDelayMs: 13_000,
  utilization: 0.9,
});

function stableJson(value) {
  if (
    value === null ||
    typeof value === 'boolean' ||
    typeof value === 'number' ||
    typeof value === 'string'
  ) {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`;
  return `{${Object.keys(value)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${stableJson(value[key])}`)
    .join(',')}}`;
}

async function readJson(filePath) {
  const bytes = await readFile(filePath);
  return Object.freeze({ value: JSON.parse(bytes.toString('utf8')), bytes, sha256: sha256(bytes) });
}

async function latestHitsCapture() {
  const directory = path.join(HITS_ARCHIVE_ROOT, 'captures');
  const entries = await readdir(directory, { withFileTypes: true });
  const matches = entries
    .filter((entry) => entry.isFile() && HITS_CAPTURE_PATTERN.test(entry.name))
    .map((entry) => entry.name)
    .sort();
  if (matches.length === 0) throw new Error('HHR capture requires the existing M9 Hits ledger to contain a prospective capture.');
  const filePath = path.join(directory, matches.at(-1));
  const file = await readJson(filePath);
  if (file.value.productionEnabled !== false || file.value.productionRankingEnabled !== false) {
    throw new Error('Source Hits archive is not production-disabled.');
  }
  if (!Array.isArray(file.value.pregameEvents)) throw new Error('Source Hits archive does not expose pregameEvents.');
  return Object.freeze({ ...file, filePath });
}

async function fetchSnapshot(url, label, { headers = {}, bdl = false, signal } = {}) {
  for (let attempt = 0; attempt <= 8; attempt += 1) {
    if (bdl) await bdlRateLimiter.beforeRequest();
    const response = await fetch(url, { headers, signal });
    if (bdl) {
      bdlRateLimiter.afterResponse({
        status: response.status,
        headers: response.headers,
      });
    }
    const text = await response.text();
    if (response.status === 429 && attempt < 8) {
      if (bdl) {
        await bdlRateLimiter.waitForRetry();
      } else {
        const retrySeconds = Number(response.headers.get('retry-after'));
        await sleep(Number.isFinite(retrySeconds) ? retrySeconds * 1000 : 13_000);
      }
      continue;
    }
    if (!response.ok) throw new Error(`${label} returned HTTP ${response.status}: ${text.slice(0, 500)}`);
    return Object.freeze({ body: JSON.parse(text), text, sha256: sha256(text) });
  }
  throw new Error(`${label} exhausted retries.`);
}

async function fetchBdlDate(queryDateUtc) {
  const url = new URL('https://api.balldontlie.io/mlb/v1/games');
  url.searchParams.append('dates[]', queryDateUtc);
  url.searchParams.set('season_type', 'regular');
  url.searchParams.set('per_page', '100');
  const response = await fetchSnapshot(url, `BDL games ${queryDateUtc}`, {
    headers: { Authorization: bdlKey },
    bdl: true,
  });
  return Object.freeze({
    queryDateUtc,
    snapshot: Object.freeze({ parsedBody: response.body, rawBodySha256: response.sha256 }),
  });
}

async function fetchBdlRows(endpoint, gameIds) {
  const snapshots = [];
  const combinedRows = [];
  const seenCursors = new Set();
  let cursor = null;
  let page = 1;
  while (true) {
    const url = new URL(`https://api.balldontlie.io/mlb/v1/${endpoint}`);
    for (const gameId of gameIds) url.searchParams.append('game_ids[]', String(gameId));
    url.searchParams.set('per_page', '100');
    if (cursor !== null) url.searchParams.set('cursor', String(cursor));
    const snapshot = await fetchSnapshot(url, `BDL ${endpoint} page ${page}`, {
      headers: { Authorization: bdlKey },
      bdl: true,
    });
    const pageRows = snapshot.body?.data;
    if (!Array.isArray(pageRows)) {
      throw new Error(`BDL ${endpoint} page ${page} did not return a data array.`);
    }
    snapshots.push(snapshot);
    combinedRows.push(...pageRows);
    const nextCursor = snapshot.body?.meta?.next_cursor ?? null;
    if (nextCursor === null || nextCursor === undefined) break;
    const cursorKey = String(nextCursor);
    if (seenCursors.has(cursorKey)) {
      throw new Error(`BDL ${endpoint} pagination repeated cursor ${cursorKey}.`);
    }
    seenCursors.add(cursorKey);
    cursor = nextCursor;
    page += 1;
  }
  const combinedBytes = Buffer.concat(
    snapshots.flatMap((snapshot) => {
      const bytes = Buffer.from(snapshot.text, 'utf8');
      const length = Buffer.allocUnsafe(8);
      length.writeBigUInt64BE(BigInt(bytes.length));
      return [length, bytes];
    }),
  );
  return Object.freeze({
    body: Object.freeze({ data: Object.freeze(combinedRows) }),
    sha256: sha256(combinedBytes),
    capturedAt: new Date().toISOString(),
    pageSha256: Object.freeze(snapshots.map((snapshot) => snapshot.sha256)),
  });
}

async function fetchBdlForProjectedLineup({ label, url, requireNonemptyRecords = false }) {
  const capturedAt = new Date().toISOString();
  const response = await fetchSnapshot(url, label, {
    headers: { Authorization: bdlKey },
    bdl: true,
  });
  const records = Array.isArray(response.body) ? response.body : response.body?.data;
  if (requireNonemptyRecords && (!Array.isArray(records) || records.length === 0)) {
    throw new Error(`${label} returned no provider records.`);
  }
  const bytes = Buffer.from(response.text, 'utf8');
  return Object.freeze({
    parsedBody: response.body,
    capturedAt,
    rawBody: Object.freeze({
      encoding: 'base64',
      byteLength: bytes.length,
      sha256: response.sha256,
      base64: bytes.toString('base64'),
    }),
  });
}

function eventFromHits(raw) {
  const eventId = raw?.eventId ?? raw?.id;
  const commenceTimeUtc = raw?.commenceTimeUtc ?? raw?.commenceTime;
  const homeTeamName = raw?.homeTeamName ?? raw?.homeTeam;
  const awayTeamName = raw?.awayTeamName ?? raw?.awayTeam;
  if (![eventId, commenceTimeUtc, homeTeamName, awayTeamName].every((value) => typeof value === 'string' && value.length > 0)) {
    throw new Error('Source Hits pregame event identity is malformed.');
  }
  return Object.freeze({ id: eventId, commenceTimeUtc, homeTeamName, awayTeamName });
}

async function fetchEventOdds(eventId, { markets, regions, bookmakers = null, includeMultipliers = false }) {
  const url = new URL(`https://api.the-odds-api.com/v4/sports/baseball_mlb/events/${eventId}/odds`);
  url.searchParams.set('apiKey', oddsKey);
  url.searchParams.set('regions', regions);
  url.searchParams.set('markets', markets);
  url.searchParams.set('dateFormat', 'iso');
  url.searchParams.set('oddsFormat', 'american');
  if (bookmakers) url.searchParams.set('bookmakers', bookmakers);
  if (includeMultipliers) {
    url.searchParams.set('includeMultipliers', 'true');
    url.searchParams.set('includeSids', 'true');
  }
  return fetchSnapshot(url, `The Odds API ${markets} ${eventId}`);
}

function hhrCapture(snapshot, capturedAt) {
  return Object.freeze({
    captureVersion: 1,
    capturedAt,
    captureMode: 'prospective-m10-daily-evidence',
    request: Object.freeze({
      provider: 'The Odds API',
      bookmaker: 'underdog',
      region: 'us_dfs',
      marketKeys: Object.freeze(['batter_hits_runs_rbis', 'batter_hits_runs_rbis_alternate']),
      dateFormat: 'iso',
      oddsFormat: 'american',
      includeMultipliers: true,
      includeSids: true,
    }),
    sourceSnapshotSha256: snapshot.sha256,
    response: snapshot.body,
  });
}

function teamTotals(game, snapshot) {
  const payload = snapshot.body?.data ?? snapshot.body;
  const books = Array.isArray(payload?.bookmakers) ? payload.bookmakers : [];
  const byTeam = new Map();
  for (const teamName of [game.homeTeamName, game.awayTeamName]) {
    const points = [];
    for (const book of books) {
      const markets = Array.isArray(book?.markets) ? book.markets : [];
      const market = markets.find((entry) => entry?.key === 'team_totals');
      if (!market || !Array.isArray(market.outcomes)) continue;
      const outcomes = market.outcomes.filter((outcome) => outcome?.description === teamName);
      const over = outcomes.find((outcome) => outcome?.name === 'Over');
      const under = outcomes.find((outcome) => outcome?.name === 'Under');
      if (!over || !under || !Number.isFinite(over.point) || over.point !== under.point) continue;
      points.push(over.point);
    }
    if (points.length > 0) byTeam.set(teamName, medianHhrValue(points));
  }
  return Object.freeze({ byTeam, bookmakerCount: books.length, sourceSha256: snapshot.sha256 });
}

function pWinGivenGrades(settlement) {
  const decided = settlement.winProbability + settlement.lossProbability;
  return decided > 0 ? settlement.winProbability / decided : null;
}

function addLineupSlotCandidate(map, candidate) {
  const teamKey = `${candidate.gameId}:${candidate.teamId}`;
  const teamRows = map.get(teamKey) ?? new Map();
  const existing = teamRows.get(candidate.lineupSlot) ?? [];
  if (
    existing.some(
      (row) =>
        row.playerId === candidate.playerId &&
        row.lineupStatus === candidate.lineupStatus &&
        row.lineupSlot === candidate.lineupSlot,
    )
  ) {
    return;
  }
  teamRows.set(candidate.lineupSlot, Object.freeze([...existing, candidate]));
  map.set(teamKey, teamRows);
}

function hhrHitterFromResolvedLineup(gameId, resolved) {
  const resolution = resolved.resolution;
  const sourceRow = resolved.row;
  if (!resolution?.resolved || !sourceRow) {
    throw new Error(`Resolved HHR lineup for ${resolved.identity?.offerPlayerName ?? 'unknown player'} is incomplete.`);
  }
  return Object.freeze({
    gameId,
    playerId: resolved.identity.providerPlayerId,
    playerName: resolved.identity.offerPlayerName,
    lineupSlot: resolution.lineupSlot,
    lineupStatus: resolution.lineupStatus,
    declaredHand: declaredBatterHand(sourceRow.player?.bats_throws),
    teamId: resolved.identity.providerTeamId,
    lineupSourceGameId: resolution.sourceGameId,
    lineupSourceGameDateUtc: resolution.sourceGameDateUtc,
    lineupSourceCapturedAt: resolution.sourceCapturedAt,
    lineupSourceSnapshotSha256: resolution.sourceSnapshotSha256,
  });
}

function normalizedIdentityExclusion(gameId, exclusion) {
  const reason =
    exclusion.reason === 'ZERO_MATCHES'
      ? 'player-identity-zero-matches'
      : exclusion.reason === 'MULTIPLE_MATCHES'
        ? 'player-identity-multiple-matches'
        : 'player-identity-lookup-failed-closed';
  return Object.freeze({
    gameId,
    providerEventId: exclusion.providerEventId,
    playerName: exclusion.playerName,
    reason,
    matchCount: exclusion.matchCount,
    ...(typeof exclusion.detail === 'string' ? { detail: exclusion.detail } : {}),
  });
}

const sourceHits = await latestHitsCapture();
const capturedAt = new Date(sourceHits.value.capturedAt).toISOString();
const pregameEvents = sourceHits.value.pregameEvents.map(eventFromHits);

const boardSnapshots = new Map();
const totalSnapshots = new Map();
for (const event of pregameEvents) {
  boardSnapshots.set(
    event.id,
    await fetchEventOdds(event.id, {
      markets: 'batter_hits_runs_rbis,batter_hits_runs_rbis_alternate',
      regions: 'us_dfs',
      bookmakers: 'underdog',
      includeMultipliers: true,
    }),
  );
  totalSnapshots.set(
    event.id,
    await fetchEventOdds(event.id, { markets: 'team_totals', regions: 'us' }),
  );
}

const diagnosticDirectory = path.join(HHR_ARCHIVE_ROOT, 'diagnostics');
await mkdir(diagnosticDirectory, { recursive: true });
const preGateDiagnosticPath = path.join(
  diagnosticDirectory,
  `${capturedAt.replace(/[-:.]/gu, '')}--provider-inputs.json`,
);
const preGateDiagnostic = {
  diagnosticVersion: 1,
  diagnosticType: 'm10-hhr-provider-inputs-before-gates',
  capturedAt,
  sourceHitsCaptureKey: sourceHits.value.captureIdentity?.captureKey ?? path.basename(sourceHits.filePath, '.json'),
  sourceHitsArchiveFileSha256: sourceHits.sha256,
  pregameEventCount: pregameEvents.length,
  events: pregameEvents.map((event) => ({
    ...event,
    hhrBoardSnapshotSha256: boardSnapshots.get(event.id).sha256,
    teamTotalsSnapshotSha256: totalSnapshots.get(event.id).sha256,
  })),
  thresholdsEvaluated: false,
};
await writeFile(preGateDiagnosticPath, `${JSON.stringify(preGateDiagnostic, null, 2)}\n`, { flag: 'wx' });

const queryDates = new Set();
for (const event of pregameEvents) {
  const date = event.commenceTimeUtc.slice(0, 10);
  const milliseconds = Date.parse(`${date}T00:00:00.000Z`);
  for (const offset of [-1, 0, 1]) {
    queryDates.add(new Date(milliseconds + offset * 86_400_000).toISOString().slice(0, 10));
  }
}
const gameQuerySnapshots = [];
for (const date of [...queryDates].sort()) gameQuerySnapshots.push(await fetchBdlDate(date));

const resolvedGames = [];
const rawGameByEventId = new Map();
const exclusions = [];
for (const event of pregameEvents) {
  const resolution = resolveExactBallDontLieGameMatch({ event, gameQuerySnapshots });
  if (resolution.status !== 'exact' && resolution.status !== 'duplicate-fetch-artifact') {
    exclusions.push(Object.freeze({ providerEventId: event.id, reason: `game-${resolution.status}` }));
    continue;
  }
  const raw = resolution.game;
  rawGameByEventId.set(event.id, raw);
  resolvedGames.push(Object.freeze({
    providerEventId: event.id,
    gameId: raw.id,
    date: raw.date,
    status: raw.status,
    venue: raw.venue,
    homeTeamId: raw.home_team?.id,
    awayTeamId: raw.away_team?.id,
    homeTeamName: raw.home_team_name ?? raw.home_team?.display_name,
    awayTeamName: raw.away_team_name ?? raw.away_team?.display_name,
  }));
}
const gameIds = [...new Set(resolvedGames.map((game) => game.gameId))].sort((a, b) => a - b);
const lineupsSnapshot =
  gameIds.length > 0
    ? await fetchBdlRows('lineups', gameIds)
    : Object.freeze({
        body: Object.freeze({ data: Object.freeze([]) }),
        sha256: sha256('[]'),
        capturedAt,
        pageSha256: Object.freeze([]),
      });
const lineupRows = Array.isArray(lineupsSnapshot.body?.data) ? lineupsSnapshot.body.data : [];
const currentLineups = Object.freeze({
  body: lineupsSnapshot.body,
  capturedAt: lineupsSnapshot.capturedAt,
  combinedSha256: lineupsSnapshot.sha256,
});

const lineupSlotCandidatesByGameTeam = new Map();
const probablePitcherByGameTeam = new Map();
for (const row of lineupRows) {
  const gameId = row?.game_id;
  const playerId = row?.player?.id;
  const teamId = row?.team?.id;
  if (!gameIds.includes(gameId) || !Number.isSafeInteger(playerId) || !Number.isSafeInteger(teamId)) continue;
  if (row?.is_probable_pitcher === true) {
    const hand = declaredPitcherHand(row.player?.bats_throws);
    if (hand) probablePitcherByGameTeam.set(`${gameId}:${teamId}`, { playerId, hand, name: row.player?.full_name });
  }
  if (
    row?.is_probable_pitcher !== false ||
    !Number.isSafeInteger(row?.batting_order) ||
    row.batting_order < 1 ||
    row.batting_order > 9
  ) {
    continue;
  }
  addLineupSlotCandidate(
    lineupSlotCandidatesByGameTeam,
    Object.freeze({
      gameId,
      playerId,
      playerName: row.player?.full_name,
      lineupSlot: row.batting_order,
      lineupStatus: 'confirmed',
      declaredHand: declaredBatterHand(row.player?.bats_throws),
      teamId,
      lineupSourceGameId: String(gameId),
      lineupSourceGameDateUtc: null,
      lineupSourceCapturedAt: currentLineups.capturedAt,
      lineupSourceSnapshotSha256: currentLineups.combinedSha256,
    }),
  );
}

const offersByEventId = new Map();
const resolvedHitterByGameName = new Map();
const playerLookupSnapshotSha256ByGame = new Map();
const projectedLineupHistorySha256ByGame = new Map();
const projectedGameSnapshotCache = new Map();
const lineupResolutionRows = [];
const identityDiagnosticState = { printed: 0 };
let zeroUnderdogHhrEventCount = 0;
for (const game of resolvedGames) {
  const rawGame = rawGameByEventId.get(game.providerEventId);
  if (!rawGame) throw new Error(`Missing raw BDL game for ${game.providerEventId}.`);
  const boardSnapshot = boardSnapshots.get(game.providerEventId);
  const capture = hhrCapture(boardSnapshot, capturedAt);
  const bookmakerAvailability = classifyHhrUnderdogBookmakerAvailability(capture);
  if (bookmakerAvailability.status === 'exclude') {
    zeroUnderdogHhrEventCount += 1;
    offersByEventId.set(game.providerEventId, Object.freeze([]));
    exclusions.push(Object.freeze({
      gameId: game.gameId,
      providerEventId: game.providerEventId,
      reason: bookmakerAvailability.reason,
    }));
    continue;
  }
  const offers = normalizeUnderdogBatterHhrCapture(capture);
  offersByEventId.set(game.providerEventId, offers);
  const offeredNames = [...new Set(offers.map((offer) => offer.playerName))];
  const identityCapture = await capturePlayerIdentityLookups({
    event: pregameEvents.find((event) => event.id === game.providerEventId),
    game: rawGame,
    playerNames: offeredNames,
    fetchBdl: fetchBdlForProjectedLineup,
    write: (message) => process.stdout.write(message),
    diagnosticState: identityDiagnosticState,
  });
  playerLookupSnapshotSha256ByGame.set(
    String(game.gameId),
    Object.freeze(identityCapture.snapshots.map((snapshot) => snapshot.rawBody.sha256)),
  );
  for (const exclusion of identityCapture.identityExclusions) {
    exclusions.push(normalizedIdentityExclusion(game.gameId, exclusion));
  }

  const resolvedCurrent = new Map();
  const identitiesNeedingHistory = [];
  for (const identity of identityCapture.identities) {
    try {
      const result = resolveProjectedLineupIdentity({
        game: rawGame,
        identity,
        currentLineups,
        historicalLineups: null,
      });
      if (result.resolution.resolved) {
        resolvedCurrent.set(identity.offerPlayerName, result);
      } else {
        identitiesNeedingHistory.push(identity);
      }
    } catch (error) {
      exclusions.push(Object.freeze({
        gameId: game.gameId,
        providerEventId: game.providerEventId,
        playerName: identity.offerPlayerName,
        reason: 'lineup-resolution-failed-closed',
        detail: error instanceof Error ? error.message : String(error),
      }));
    }
  }

  let historicalLineups = null;
  if (identitiesNeedingHistory.length > 0) {
    historicalLineups = await captureProjectedLineupHistory({
      game: rawGame,
      fetchBdl: fetchBdlForProjectedLineup,
      gameSnapshotCache: projectedGameSnapshotCache,
    });
    projectedLineupHistorySha256ByGame.set(
      String(game.gameId),
      historicalLineups.lineups.combinedSha256,
    );
  }

  for (const identity of identityCapture.identities) {
    let resolved = resolvedCurrent.get(identity.offerPlayerName);
    if (resolved === undefined && identitiesNeedingHistory.includes(identity)) {
      try {
        resolved = resolveProjectedLineupIdentity({
          game: rawGame,
          identity,
          currentLineups,
          historicalLineups,
        });
      } catch (error) {
        exclusions.push(Object.freeze({
          gameId: game.gameId,
          providerEventId: game.providerEventId,
          playerName: identity.offerPlayerName,
          reason: 'lineup-resolution-failed-closed',
          detail: error instanceof Error ? error.message : String(error),
        }));
        continue;
      }
    }
    if (resolved === undefined) continue;
    if (!resolved.resolution.resolved) {
      exclusions.push(Object.freeze({
        gameId: game.gameId,
        providerEventId: game.providerEventId,
        playerName: identity.offerPlayerName,
        reason: resolved.resolution.reason,
      }));
      continue;
    }
    const hitter = hhrHitterFromResolvedLineup(game.gameId, resolved);
    resolvedHitterByGameName.set(`${game.gameId}:${hitter.playerName}`, hitter);
    addLineupSlotCandidate(lineupSlotCandidatesByGameTeam, hitter);
    lineupResolutionRows.push(Object.freeze({
      providerEventId: game.providerEventId,
      gameId: game.gameId,
      playerId: hitter.playerId,
      playerName: hitter.playerName,
      teamId: hitter.teamId,
      lineupSlot: hitter.lineupSlot,
      lineupStatus: hitter.lineupStatus,
      sourceGameId: hitter.lineupSourceGameId,
      sourceGameDateUtc: hitter.lineupSourceGameDateUtc,
      sourceCapturedAt: hitter.lineupSourceCapturedAt,
      sourceSnapshotSha256: hitter.lineupSourceSnapshotSha256,
    }));
  }
}
if (resolvedGames.length > 0 && zeroUnderdogHhrEventCount === resolvedGames.length) {
  throw new Error('HHR capture contained no normalized offers.');
}

const projectedGameSnapshotSha256ByDate = Object.fromEntries(
  [...projectedGameSnapshotCache.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([date, snapshot]) => [date, snapshot.rawBody.sha256]),
);
const lineupStatusCountsBeforeRowGates = Object.freeze({
  confirmed: lineupResolutionRows.filter((row) => row.lineupStatus === 'confirmed').length,
  projected: lineupResolutionRows.filter((row) => row.lineupStatus === 'projected').length,
});
const resolutionDiagnosticPath = path.join(
  diagnosticDirectory,
  `${capturedAt.replace(/[-:.]/gu, '')}--resolution.json`,
);
await writeFile(
  resolutionDiagnosticPath,
  `${JSON.stringify({
    diagnosticVersion: 2,
    diagnosticType: 'm10-hhr-resolution-before-row-gates',
    capturedAt,
    resolvedGames,
    exclusions,
    lineupsSnapshotSha256: lineupsSnapshot.sha256,
    lineupsSnapshotPageSha256: lineupsSnapshot.pageSha256,
    playerLookupSnapshotSha256ByGame: Object.fromEntries(playerLookupSnapshotSha256ByGame),
    projectedLineupHistorySha256ByGame: Object.fromEntries(projectedLineupHistorySha256ByGame),
    projectedGameSnapshotSha256ByDate,
    lineupStatusCountsBeforeRowGates,
    lineupResolutions: lineupResolutionRows,
    thresholdsEvaluated: false,
  }, null, 2)}\n`,
  { flag: 'wx' },
);

const [modelFile, terminalFile, sharedFile, retentionFile, completeFile, parkFile, bullpenFile] = await Promise.all([
  readJson(MODEL_PATH),
  readJson('model-artifacts/m8-terminal-pa-outcome-v1.json'),
  readJson('model-artifacts/m8-shared-offensive-environment-v2.json'),
  readJson('model-artifacts/m8-starter-retention-v1.json'),
  readJson('model-artifacts/m8-batter-hits-complete-candidate-v1.json'),
  readJson('model-artifacts/m8-5-park-transformation-v1.json'),
  readJson('model-artifacts/m8-5-team-bullpen-outcome-v1.json'),
]);
const model = modelFile.value;
if (model.productionEnabled !== false || model.rankingEnabled !== false) {
  throw new Error('HHR candidate safety state drifted.');
}
const terminal = terminalFile.value;
if (JSON.stringify(terminal.categories) !== JSON.stringify(HHR_TERMINAL_CATEGORIES)) {
  throw new Error('HHR terminal categories drifted.');
}
const shared = sharedFile.value;
const retention = retentionFile.value;
const complete = completeFile.value;
const parkByVenueHand = buildHhrParkMultiplierMap(parkFile.value);
const bullpenByTeamHand = buildHhrTeamBullpenMap(bullpenFile.value);

const rows = [];
for (const game of resolvedGames) {
  const boardSnapshot = boardSnapshots.get(game.providerEventId);
  const offers = offersByEventId.get(game.providerEventId) ?? [];
  const totals = teamTotals(game, totalSnapshots.get(game.providerEventId));
  const offeredNames = [...new Set(offers.map((offer) => offer.playerName))];
  for (const playerName of offeredNames) {
    const hitter = resolvedHitterByGameName.get(`${game.gameId}:${playerName}`);
    if (!hitter) continue;
    const teamRows = lineupSlotCandidatesByGameTeam.get(`${game.gameId}:${hitter.teamId}`);
    const opposingTeamId = hitter.teamId === game.homeTeamId ? game.awayTeamId : game.homeTeamId;
    const starter = probablePitcherByGameTeam.get(`${game.gameId}:${opposingTeamId}`);
    const frozenStarterAllowed = starter ? terminal.pitcherAllowed[String(starter.playerId)] : null;
    if (!starter || !frozenStarterAllowed || !hitter.declaredHand) {
      exclusions.push(Object.freeze({ gameId: game.gameId, playerName, reason: 'missing-starter-or-handedness-conditioning-input' }));
      continue;
    }
    const batterSide = resolveBatterHand(hitter.declaredHand, starter.hand);
    const park = parkByVenueHand.get(`${game.venue}\u0000${batterSide}`);
    const bullpenL = bullpenByTeamHand.get(`pitching-team:${opposingTeamId}|pitcher-hand:L`);
    const bullpenR = bullpenByTeamHand.get(`pitching-team:${opposingTeamId}|pitcher-hand:R`);
    const teamName = hitter.teamId === game.homeTeamId ? game.homeTeamName : game.awayTeamName;
    const teamTotal = totals.byTeam.get(teamName);
    if (!park || !bullpenL || !bullpenR || !Number.isFinite(teamTotal)) {
      exclusions.push(Object.freeze({ gameId: game.gameId, playerName, reason: 'missing-canonical-conditioning-input' }));
      continue;
    }
    const precedingSlots = [1, 2, 3].map((distance) => ((hitter.lineupSlot - distance - 1 + 9) % 9) + 1);
    const precedingCandidates = precedingSlots.map((slot) => ({
      slot,
      candidates: teamRows instanceof Map ? teamRows.get(slot) ?? [] : [],
    }));
    const unresolvedPreceding = precedingCandidates.filter((entry) => entry.candidates.length !== 1);
    if (unresolvedPreceding.length > 0) {
      exclusions.push(Object.freeze({
        gameId: game.gameId,
        playerName,
        reason: 'preceding-slot-unresolvable',
        slots: Object.freeze(
          unresolvedPreceding.map((entry) =>
            Object.freeze({ slot: entry.slot, candidateCount: entry.candidates.length }),
          ),
        ),
      }));
      continue;
    }
    const preceding = precedingCandidates.map((entry) => entry.candidates[0]);
    const overallBatter = terminal.batterOverall[String(hitter.playerId)] ?? terminal.unseenBatter;
    const neutralStarter = applyHhrPark(hhrCoherentVector(terminal, overallBatter, terminal.unseenPitcher), park);
    const bullpenNeutralL = applyHhrPark(hhrCoherentVector(terminal, overallBatter, bullpenL), park);
    const bullpenNeutralR = applyHhrPark(hhrCoherentVector(terminal, overallBatter, bullpenR), park);
    const bullpenNeutral = normalizeHhrVector(
      Object.fromEntries(HHR_TERMINAL_CATEGORIES.map((category) => [
        category,
        complete.bullpenModel.handWeights.L * bullpenNeutralL[category] +
          complete.bullpenModel.handWeights.R * bullpenNeutralR[category],
      ])),
      'daily HHR team bullpen mixed vector',
    );
    const teamSide = hitter.teamId === game.homeTeamId ? 'home' : 'away';
    const opportunity = buildHhrOpportunityContext(shared, retention, teamSide, hitter.lineupSlot);
    const contextVector = normalizeHhrVector(
      Object.fromEntries(HHR_TERMINAL_CATEGORIES.map((category) => [
        category,
        opportunity.starterExposureShare * neutralStarter[category] +
          (1 - opportunity.starterExposureShare) * bullpenNeutral[category],
      ])),
      'daily HHR context-adjusted terminal vector',
    );
    const platoonBatter = hhrPlatoonBatterVector(
      terminal,
      hitter.playerId,
      hitter.declaredHand,
      batterSide,
      starter.hand,
    );
    const platoonVector = applyHhrPark(
      hhrCoherentVector(terminal, platoonBatter, terminal.unseenPitcher),
      park,
    );
    const starterVector = applyHhrPark(
      hhrCoherentVector(terminal, overallBatter, frozenStarterAllowed),
      park,
    );
    const precedingQuality = preceding.reduce((sum, row) => {
      const vector = applyHhrPark(
        hhrCoherentVector(
          terminal,
          terminal.batterOverall[String(row.playerId)] ?? terminal.unseenBatter,
          terminal.unseenPitcher,
        ),
        park,
      );
      return sum + hhrVectorMass(vector, HHR_ON_BASE_CATEGORIES);
    }, 0) / preceding.length;
    const input = {
      contextAdjustedTerminalOutcomeVector: contextVector,
      terminalOutcomeCategories: HHR_TERMINAL_CATEGORIES,
      expectedPlateAppearances: opportunity.expectedPlateAppearances,
      lineupSlot: hitter.lineupSlot,
      platoonSplitCell:
        hhrLogit(hhrVectorMass(platoonVector, HHR_HIT_CATEGORIES)) -
        hhrLogit(hhrVectorMass(neutralStarter, HHR_HIT_CATEGORIES)),
      opposingStarterPooling:
        hhrLogit(hhrVectorMass(starterVector, HHR_HIT_CATEGORIES)) -
        hhrLogit(hhrVectorMass(neutralStarter, HHR_HIT_CATEGORIES)),
      teamImpliedRunTotal: teamTotal,
      precedingLineupSlotsOnBaseQuality: precedingQuality,
    };
    const distribution = buildBatterHhrDirectCompositeDistribution(model, input);
    for (const offer of offers.filter((entry) => entry.playerName === playerName)) {
      const settlement = settleBatterHhrDistribution(distribution, offer.selectedSide, offer.line);
      const conditionalWin = pWinGivenGrades(settlement);
      if (conditionalWin === null) {
        exclusions.push(Object.freeze({ gameId: game.gameId, playerName, reason: 'fully-void-hhr-settlement' }));
        continue;
      }
      rows.push(Object.freeze({
        providerEventId: offer.eventId,
        providerGameId: game.gameId,
        providerPlayerId: hitter.playerId,
        providerTeamId: hitter.teamId,
        providerMarketKey: offer.providerMarketKey,
        offerType: offer.offerType,
        playerName,
        teamName,
        lineupStatus: hitter.lineupStatus,
        selectedSide: offer.selectedSide,
        postedLine: offer.line,
        americanPrice: offer.price,
        multiplier: offer.multiplier,
        archivedPWin: settlement.winProbability,
        archivedPLoss: settlement.lossProbability,
        archivedPVoid: settlement.voidProbability,
        archivedPWinGivenGrades: conditionalWin,
        distributionIdentity: Object.freeze({
          mean: distribution.mean,
          dispersionAlpha: distribution.dispersionAlpha,
          modelVersion: distribution.modelVersion,
          distributionBuilderVersion: distribution.distributionBuilderVersion,
        }),
        inputLineage: Object.freeze({
          lineupStatus: hitter.lineupStatus,
          lineupSlot: hitter.lineupSlot,
          lineupSourceGameId: hitter.lineupSourceGameId,
          lineupSourceGameDateUtc: hitter.lineupSourceGameDateUtc,
          lineupSourceCapturedAt: hitter.lineupSourceCapturedAt,
          lineupSourceSnapshotSha256: hitter.lineupSourceSnapshotSha256,
          expectedPlateAppearances: opportunity.expectedPlateAppearances,
          probableStarterPlayerId: starter.playerId,
          probableStarterName: starter.name,
          probableStarterHand: starter.hand,
          venue: game.venue,
          teamImpliedRunTotal: teamTotal,
          hhrBoardSnapshotSha256: boardSnapshot.sha256,
          teamTotalsSnapshotSha256: totals.sourceSha256,
        }),
      }));
    }
  }
}
rows.sort((left, right) =>
  left.providerGameId - right.providerGameId ||
  left.providerPlayerId - right.providerPlayerId ||
  left.providerMarketKey.localeCompare(right.providerMarketKey) ||
  left.postedLine - right.postedLine ||
  left.selectedSide.localeCompare(right.selectedSide),
);

const sourceSet = {
  sourceHitsArchiveFileSha256: sourceHits.sha256,
  boardSnapshotSha256ByEvent: Object.fromEntries([...boardSnapshots.entries()].map(([eventId, value]) => [eventId, value.sha256])),
  teamTotalsSnapshotSha256ByEvent: Object.fromEntries([...totalSnapshots.entries()].map(([eventId, value]) => [eventId, value.sha256])),
  bdlGameSnapshotSha256ByDate: Object.fromEntries(gameQuerySnapshots.map((entry) => [entry.queryDateUtc, entry.snapshot.rawBodySha256])),
  bdlLineupsSnapshotSha256: lineupsSnapshot.sha256,
  bdlLineupsPageSha256: lineupsSnapshot.pageSha256,
  bdlPlayerLookupSnapshotSha256ByGame: Object.fromEntries(playerLookupSnapshotSha256ByGame),
  bdlProjectedLineupHistorySha256ByGame: Object.fromEntries(projectedLineupHistorySha256ByGame),
  bdlProjectedGameSnapshotSha256ByDate: projectedGameSnapshotSha256ByDate,
  modelArtifactSha256: modelFile.sha256,
  terminalArtifactSha256: terminalFile.sha256,
  sharedArtifactSha256: sharedFile.sha256,
  retentionArtifactSha256: retentionFile.sha256,
  completeArtifactSha256: completeFile.sha256,
  parkArtifactSha256: parkFile.sha256,
  bullpenArtifactSha256: bullpenFile.sha256,
};
const sourceSetSha256 = sha256(stableJson(sourceSet));
const displayPlayers = [...new Map(rows.map((row) => [
  `${row.providerGameId}:${row.providerPlayerId}`,
  {
    providerGameId: row.providerGameId,
    providerPlayerId: row.providerPlayerId,
    opposingStarterPitcherId: row.inputLineage.probableStarterPlayerId,
    opposingStarterName: row.inputLineage.probableStarterName,
    opposingStarterHand: row.inputLineage.probableStarterHand,
  },
])).values()];
const displayEnrichment = await capturePhase2DisplayEnrichment({
  captureDateUtc: capturedAt.slice(0, 10),
  players: displayPlayers,
  fetchPage: async (url, label, { signal } = {}) => (await fetchSnapshot(url, label, {
    headers: { Authorization: bdlKey },
    bdl: true,
    signal,
  })).body,
});
console.log(`PHASE2 ENRICHMENT REASON COUNTS\t${JSON.stringify(displayEnrichment.diagnostics.failureReasons)}`);
const archive = buildM10HhrProspectiveArchive({
  capturedAt,
  sourceSetSha256,
  source: Object.freeze({
    theOddsApi: Object.freeze({
      provider: 'The Odds API',
      boardBookmaker: 'underdog',
      boardRegion: 'us_dfs',
      boardMarkets: Object.freeze(['batter_hits_runs_rbis', 'batter_hits_runs_rbis_alternate']),
      conditioningMarket: 'team_totals',
      conditioningRegion: 'us',
    }),
    balldontlie: Object.freeze({ provider: 'BALLDONTLIE MLB API', activeSeason: 2026 }),
    sourceHitsCaptureKey: sourceHits.value.captureIdentity?.captureKey ?? path.basename(sourceHits.filePath, '.json'),
    artifactSha256: Object.freeze(sourceSet),
  }),
  games: resolvedGames,
  rows,
  exclusions,
  diagnosticsPath: path.relative(process.cwd(), resolutionDiagnosticPath),
});
const enrichedArchive = attachPhase2DisplayEnrichment(archive, displayEnrichment);
const capturePath = path.join(HHR_ARCHIVE_ROOT, 'captures', `${enrichedArchive.captureKey}.json`);
await persistImmutableJson(capturePath, enrichedArchive);

const confirmedRows = rows.filter((row) => row.lineupStatus === 'confirmed').length;
const projectedRows = rows.filter((row) => row.lineupStatus === 'projected').length;
const confirmedPlayers = new Set(
  rows
    .filter((row) => row.lineupStatus === 'confirmed')
    .map((row) => `${row.providerGameId}:${row.providerPlayerId}`),
).size;
const projectedPlayers = new Set(
  rows
    .filter((row) => row.lineupStatus === 'projected')
    .map((row) => `${row.providerGameId}:${row.providerPlayerId}`),
).size;
const exclusionCounts = new Map();
for (const exclusion of exclusions) {
  exclusionCounts.set(exclusion.reason, (exclusionCounts.get(exclusion.reason) ?? 0) + 1);
}
const bdlRateLimitState = bdlRateLimiter.snapshot();

console.log('--- M10 HHR PROSPECTIVE EVIDENCE CAPTURE ---');
console.log(`SOURCE HITS CAPTURE\t${enrichedArchive.source.sourceHitsCaptureKey}`);
console.log(`CAPTURE KEY\t${enrichedArchive.captureKey}`);
console.log(`ARCHIVE PATH\t${capturePath}`);
console.log(`ARCHIVE SHA-256\t${enrichedArchive.archiveSha256}`);
console.log(`PREGAME EVENTS\t${pregameEvents.length}`);
console.log(`RESOLVED GAMES\t${resolvedGames.length}`);
console.log(`HHR ROWS\t${enrichedArchive.counts.rows}`);
console.log(`CANDIDATES FROM CONFIRMED SLOTS\t${confirmedRows}`);
console.log(`CANDIDATES FROM PROJECTED SLOTS\t${projectedRows}`);
console.log(`UNIQUE PLAYERS FROM CONFIRMED SLOTS\t${confirmedPlayers}`);
console.log(`UNIQUE PLAYERS FROM PROJECTED SLOTS\t${projectedPlayers}`);
console.log(`TOTAL CANDIDATES\t${enrichedArchive.counts.rows}`);
console.log('PRIOR 11 AM CANDIDATES\t78');
console.log(`DELTA VS PRIOR 11 AM\t${enrichedArchive.counts.rows - 78}`);
console.log(`BASELINE ROWS\t${enrichedArchive.counts.baselineRows}`);
console.log(`ALTERNATE ROWS\t${enrichedArchive.counts.alternateRows}`);
console.log(`EXCLUSIONS\t${enrichedArchive.counts.exclusions}`);
for (const [reason, count] of [...exclusionCounts.entries()].sort(([left], [right]) => left.localeCompare(right))) {
  console.log(`EXCLUSION ${reason}\t${count}`);
}
console.log(`BDL RATE LIMIT PER MINUTE\t${bdlRateLimitState.limitPerMinute ?? 'unknown'}`);
console.log(`BDL INTERVAL MS\t${bdlRateLimitState.intervalMs}`);
console.log(`PROVIDER DIAGNOSTICS\t${preGateDiagnosticPath}`);
console.log(`RESOLUTION DIAGNOSTICS\t${resolutionDiagnosticPath}`);
console.log('PRODUCTION\tDISABLED');
console.log('RANKING\tDISABLED');
console.log('EVIDENCE ONLY\ttrue');
console.log('--- END M10 HHR PROSPECTIVE EVIDENCE CAPTURE ---');
