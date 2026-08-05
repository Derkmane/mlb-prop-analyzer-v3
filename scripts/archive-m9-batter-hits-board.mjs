import { access, readFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

import { rankPredictionCandidates } from '../dist/src/application/index.js';
import { loadFrozenBatterHitsProbabilityArtifactsFromFiles } from '../dist/src/adapters/index.js';
import { classifyBallDontLieTerminalPa } from '../dist/src/adapters/providers/balldontlie/index.js';
import {
  connectFrozenBatterHitsProbabilityOutput,
  connectPregameBatterHitsBoard,
  PRODUCTION_REGISTRIES,
} from '../dist/src/composition/index.js';
import {
  BATTER_HITS_FEATURE_ID,
  BATTER_HITS_MARKET_KEY,
  resolveBatterSideAgainstVerifiedStarter,
  verifyM8_5GameOffensiveEnvironmentModelArtifactV1,
} from '../dist/src/features/batter-hits/index.js';
import { createBdlAdaptiveRateLimiter } from './bdl-adaptive-rate-limit-utils.mjs';
import { gradeM8UntouchedPlateAppearance } from './m8-untouched-hit-observation-utils.mjs';
import {
  buildM9ProspectiveBoardArchive,
  createM9CaptureIdentity,
  createM9RawProviderSnapshot,
  m9ArchiveFilePath,
  persistImmutableM9BoardArchive,
  sha256Bytes,
} from './m9-board-archive-utils.mjs';
import {
  createM9ArchiveFunnel,
  persistM9ArchiveForMode,
  printM9ArchiveFunnelReport,
  selectM9PregameEventsForCapture,
} from './m9-board-archive-funnel-utils.mjs';
import { requireSecret } from './provider-probe-utils.mjs';
import { testOnlyRankingAuthorization } from './print-m9-ranked-batter-hits-fixture.mjs';

const ACTIVE_SEASON = 2026;
const TARGET_MARKETS = Object.freeze([
  'batter_hits',
  'batter_hits_alternate',
]);
const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/u;
const SAFE_RESPONSE_HEADERS = Object.freeze([
  'content-type',
  'retry-after',
  'x-ratelimit-limit',
  'x-ratelimit-remaining',
  'x-ratelimit-reset',
  'x-requests-last',
  'x-requests-remaining',
  'x-requests-used',
]);

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

function nonemptyString(value, label) {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new TypeError(`${label} must be a nonempty string.`);
  }
  return value.trim();
}

function positiveInteger(value, label) {
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new TypeError(`${label} must be a positive integer.`);
  }
  return value;
}

function exactName(value, label) {
  return nonemptyString(value, label).replace(/\s+/gu, ' ');
}

function selectedResponseHeaders(headers) {
  return Object.freeze(
    Object.fromEntries(
      SAFE_RESPONSE_HEADERS.map((name) => [name, headers.get(name)]).filter(
        ([, value]) => value !== null,
      ),
    ),
  );
}

async function fetchExactJsonSnapshot({
  provider,
  label,
  url,
  capturedAt,
  headers = {},
  requireNonemptyRecords = false,
  beforeRequest,
  afterResponse,
  allowNonOk = false,
}) {
  if (beforeRequest) await beforeRequest();
  const snapshotCapturedAt = capturedAt ?? new Date().toISOString();
  const response = await fetch(url, { headers });
  const rawBodyBytes = Buffer.from(await response.arrayBuffer());
  if (afterResponse) {
    afterResponse({ status: response.status, headers: response.headers });
  }
  const snapshot = createM9RawProviderSnapshot({
    provider,
    label,
    capturedAt: snapshotCapturedAt,
    request: {
      method: 'GET',
      origin: url.origin,
      pathname: url.pathname,
      queryKeys: [...url.searchParams.keys()],
      headerNames: Object.keys(headers),
    },
    response: {
      status: response.status,
      statusText: response.statusText,
      headers: selectedResponseHeaders(response.headers),
    },
    rawBodyBytes,
    requireNonemptyRecords,
  });
  if (!response.ok && !allowNonOk) {
    throw new Error(
      `${label} returned HTTP ${response.status} ${response.statusText}.`,
    );
  }
  return snapshot;
}

function normalizedGameDateUtc(game, label) {
  const value = nonemptyString(game.date, `${label}.date`);
  const milliseconds = Date.parse(value);
  if (!Number.isFinite(milliseconds)) {
    throw new TypeError(`${label}.date must be an ISO timestamp.`);
  }
  return new Date(milliseconds).toISOString();
}

function exactGameIdentityMatch(event, raw, label) {
  const game = object(raw, label);
  return (
    game.season === ACTIVE_SEASON &&
    game.season_type === 'regular' &&
    game.postseason === false &&
    exactName(game.home_team_name, `${label}.home_team_name`) ===
      event.homeTeamName &&
    exactName(game.away_team_name, `${label}.away_team_name`) ===
      event.awayTeamName
  );
}

export function resolveExactBallDontLieGameMatch({
  event,
  gameQuerySnapshots,
}) {
  const eventValue = object(event, 'event');
  const matches = [];
  array(gameQuerySnapshots, 'gameQuerySnapshots').forEach(
    (rawQuery, queryIndex) => {
      const query = object(rawQuery, `gameQuerySnapshots[${queryIndex}]`);
      const queryDateUtc = nonemptyString(
        query.queryDateUtc,
        `gameQuerySnapshots[${queryIndex}].queryDateUtc`,
      );
      if (!DATE_PATTERN.test(queryDateUtc)) {
        throw new TypeError(
          `gameQuerySnapshots[${queryIndex}].queryDateUtc must be YYYY-MM-DD.`,
        );
      }
      const snapshot = object(
        query.snapshot,
        `gameQuerySnapshots[${queryIndex}].snapshot`,
      );
      const rows = array(
        object(
          snapshot.parsedBody,
          `gameQuerySnapshots[${queryIndex}].snapshot.parsedBody`,
        ).data,
        `gameQuerySnapshots[${queryIndex}].snapshot.parsedBody.data`,
      );
      rows.forEach((raw, gameIndex) => {
        const label = `gameQuerySnapshots[${queryIndex}].games[${gameIndex}]`;
        if (!exactGameIdentityMatch(eventValue, raw, label)) return;
        const game = object(raw, label);
        matches.push(
          Object.freeze({
            providerGameId: positiveInteger(game.id, `${label}.id`),
            gameDateUtc: normalizedGameDateUtc(game, label),
            queryDateUtc,
            game,
            snapshot,
          }),
        );
      });
    },
  );

  matches.sort(
    (left, right) =>
      left.providerGameId - right.providerGameId ||
      left.gameDateUtc.localeCompare(right.gameDateUtc) ||
      left.queryDateUtc.localeCompare(right.queryDateUtc),
  );
  const uniqueProviderGameIds = Object.freeze(
    [...new Set(matches.map((match) => match.providerGameId))].sort(
      (left, right) => left - right,
    ),
  );
  const publicMatches = Object.freeze(
    matches.map(({ providerGameId, gameDateUtc, queryDateUtc }) =>
      Object.freeze({ providerGameId, gameDateUtc, queryDateUtc }),
    ),
  );

  if (uniqueProviderGameIds.length === 0) {
    return Object.freeze({
      status: 'no-match',
      matches: publicMatches,
      uniqueProviderGameIds,
      game: null,
      sourceSnapshot: null,
    });
  }
  if (uniqueProviderGameIds.length > 1) {
    return Object.freeze({
      status: 'genuine-ambiguity',
      matches: publicMatches,
      uniqueProviderGameIds,
      game: null,
      sourceSnapshot: null,
    });
  }

  const eventDateUtc = nonemptyString(
    eventValue.commenceTimeUtc,
    'event.commenceTimeUtc',
  ).slice(0, 10);
  const selected =
    matches.find((match) => match.queryDateUtc === eventDateUtc) ??
    matches[0];
  return Object.freeze({
    status:
      matches.length === 1
        ? 'exact'
        : 'duplicate-fetch-artifact',
    matches: publicMatches,
    uniqueProviderGameIds,
    game: selected.game,
    sourceSnapshot: selected.snapshot,
  });
}

export function formatBallDontLieGameMatchDiagnostic({
  event,
  rawOfferCount,
  resolution,
}) {
  const eventValue = object(event, 'event');
  const value = object(resolution, 'resolution');
  if (!Number.isSafeInteger(rawOfferCount) || rawOfferCount < 0) {
    throw new TypeError('rawOfferCount must be a nonnegative integer.');
  }
  const lines = [
    'M9 BALLDONTLIE GAME MATCH DIAGNOSTIC',
    `EVENT: ${eventValue.id} | ${eventValue.awayTeamName} at ${eventValue.homeTeamName} | ${eventValue.commenceTimeUtc}`,
    `RAW OFFERS: ${rawOfferCount}`,
    `RAW EXACT MATCHES: ${array(value.matches, 'resolution.matches').length}`,
    `UNIQUE PROVIDER GAME IDS: ${array(
      value.uniqueProviderGameIds,
      'resolution.uniqueProviderGameIds',
    ).length}`,
  ];
  for (const match of value.matches) {
    lines.push(
      `MATCH: providerGameId=${match.providerGameId} | gameDate=${match.gameDateUtc} | queryDate=${match.queryDateUtc}`,
    );
  }
  if (value.status === 'duplicate-fetch-artifact') {
    lines.push(
      'RESOLUTION: DUPLICATE FETCH ARTIFACT — deduplicated by exact provider game ID before the join',
    );
  } else if (value.status === 'genuine-ambiguity') {
    lines.push(
      'RESOLUTION: GENUINE AMBIGUITY — no deduplication or arbitrary selection',
    );
  } else if (value.status === 'no-match') {
    lines.push('RESOLUTION: NO EXACT CURRENT-SEASON GAME MATCH');
  } else {
    lines.push('RESOLUTION: ONE EXACT PROVIDER GAME MATCH');
  }
  lines.push('');
  return `${lines.join('\n')}\n`;
}

function underdogMarkets(rawOdds) {
  const event = object(rawOdds, 'The Odds API event odds');
  const bookmakers = array(event.bookmakers, 'event.bookmakers').filter(
    (raw) => object(raw, 'bookmaker').key === 'underdog',
  );
  if (bookmakers.length !== 1) {
    throw new Error(
      `Event ${String(event.id)} requires exactly one Underdog bookmaker; found ${bookmakers.length}.`,
    );
  }
  return array(object(bookmakers[0], 'Underdog bookmaker').markets, 'markets')
    .filter((raw) => TARGET_MARKETS.includes(object(raw, 'market').key));
}

function rawOfferSummary(rawOdds) {
  const countsByPlayer = new Map();
  let count = 0;
  for (const rawMarket of underdogMarkets(rawOdds)) {
    const market = object(rawMarket, 'market');
    for (const rawOutcome of array(market.outcomes, `${market.key}.outcomes`)) {
      const playerName = exactName(
        object(rawOutcome, 'outcome').description,
        'outcome.description',
      );
      count += 1;
      countsByPlayer.set(
        playerName,
        (countsByPlayer.get(playerName) ?? 0) + 1,
      );
    }
  }
  return Object.freeze({
    count,
    playerNames: Object.freeze([...countsByPlayer.keys()].sort()),
    countsByPlayer,
  });
}

function offerCountForNames(summary, playerNames) {
  return playerNames.reduce(
    (total, playerName) => total + (summary.countsByPlayer.get(playerName) ?? 0),
    0,
  );
}

function lineupRows(snapshot) {
  return array(object(snapshot, 'lineups snapshot').data, 'lineups.data');
}

function lineupPlayer(row, label) {
  const player = object(row.player, `${label}.player`);
  return Object.freeze({
    id: positiveInteger(player.id, `${label}.player.id`),
    fullName: exactName(player.full_name, `${label}.player.full_name`),
    batsThrows: nonemptyString(
      player.bats_throws,
      `${label}.player.bats_throws`,
    ),
  });
}

function lineupTeam(row, label) {
  const team = object(row.team, `${label}.team`);
  return Object.freeze({
    id: positiveInteger(team.id, `${label}.team.id`),
    displayName: exactName(team.display_name, `${label}.team.display_name`),
  });
}

function battingOrder(row) {
  return Number.isSafeInteger(row.batting_order) &&
    row.batting_order >= 1 &&
    row.batting_order <= 9
    ? row.batting_order
    : null;
}

function batsThrowsPair(value, label) {
  const parts = nonemptyString(value, label).split('/');
  if (parts.length !== 2) {
    throw new Error(`${label} must preserve the provider bats_throws pair.`);
  }
  return Object.freeze(parts.map((entry) => entry.trim()));
}

function explicitPitcherHand(value, label) {
  const hand = batsThrowsPair(value, label)[1];
  if (hand !== 'L' && hand !== 'R') {
    throw new Error(`${label} must provide an explicit L/R throwing hand.`);
  }
  return hand;
}

function declaredBatterHand(value, label) {
  const hand = batsThrowsPair(value, label)[0];
  if (hand !== 'L' && hand !== 'R' && hand !== 'B') {
    throw new Error(`${label} must provide an explicit L/R/B batting hand.`);
  }
  return hand;
}

function buildPlayerIdentities({ event, game, lineupsSnapshot, playerNames }) {
  const gameId = positiveInteger(game.id, 'game.id');
  const rows = lineupRows(lineupsSnapshot);
  const identities = [];
  const identityExclusions = [];
  const lineupExclusions = [];
  const identityResolvedPlayerNames = [];
  const lineupResolvedPlayerNames = [];

  for (const playerName of playerNames) {
    const matches = rows.filter((raw, index) => {
      const row = object(raw, `lineups[${index}]`);
      return (
        row.game_id === gameId &&
        row.is_probable_pitcher === false &&
        lineupPlayer(row, `lineups[${index}]`).fullName === playerName
      );
    });
    if (matches.length !== 1) {
      identityExclusions.push(
        Object.freeze({
          providerEventId: event.id,
          playerName,
          reason: matches.length === 0 ? 'ZERO_MATCHES' : 'MULTIPLE_MATCHES',
          matchCount: matches.length,
        }),
      );
      continue;
    }

    identityResolvedPlayerNames.push(playerName);
    const row = object(matches[0], `lineup identity ${playerName}`);
    if (battingOrder(row) === null) {
      lineupExclusions.push(
        Object.freeze({
          providerEventId: event.id,
          playerName,
          reason: 'NO_ACTIVE_LINEUP_EVIDENCE',
        }),
      );
      continue;
    }

    const player = lineupPlayer(row, `lineup identity ${playerName}`);
    const team = lineupTeam(row, `lineup identity ${playerName}`);
    lineupResolvedPlayerNames.push(playerName);
    identities.push(
      Object.freeze({
        providerEventId: event.id,
        offerPlayerName: playerName,
        providerGameId: gameId,
        providerPlayerId: player.id,
        providerTeamId: team.id,
        playerName: player.fullName,
        teamName: team.displayName,
      }),
    );
  }
  return Object.freeze({
    identities: Object.freeze(identities),
    identityExclusions: Object.freeze(identityExclusions),
    lineupExclusions: Object.freeze(lineupExclusions),
    identityResolvedPlayerNames: Object.freeze(identityResolvedPlayerNames),
    lineupResolvedPlayerNames: Object.freeze(lineupResolvedPlayerNames),
  });
}

function runtimeObservation({ offer, game, lineupsSnapshot, lineupSnapshot }) {
  const gameId = positiveInteger(game.id, 'game.id');
  const rows = lineupRows(lineupsSnapshot);
  const hitters = rows.filter((raw, index) => {
    const row = object(raw, `lineups[${index}]`);
    return (
      row.game_id === gameId &&
      row.is_probable_pitcher === false &&
      battingOrder(row) !== null &&
      lineupPlayer(row, `lineups[${index}]`).id === offer.providerPlayerId &&
      lineupTeam(row, `lineups[${index}]`).id === offer.providerTeamId
    );
  });
  if (hitters.length !== 1) {
    throw new Error(
      `Offer ${offer.playerName} requires exactly one active lineup row; found ${hitters.length}.`,
    );
  }
  const hitter = object(hitters[0], `hitter ${offer.playerName}`);
  const hitterPlayer = lineupPlayer(hitter, `hitter ${offer.playerName}`);
  const hitterTeam = lineupTeam(hitter, `hitter ${offer.playerName}`);
  const starters = rows.filter((raw, index) => {
    const row = object(raw, `lineups[${index}]`);
    return (
      row.game_id === gameId &&
      row.is_probable_pitcher === true &&
      lineupTeam(row, `lineups[${index}]`).id !== hitterTeam.id
    );
  });
  if (starters.length !== 1) {
    throw new Error(
      `Offer ${offer.playerName} requires exactly one verified opposing starter; found ${starters.length}.`,
    );
  }
  const starter = object(starters[0], `starter for ${offer.playerName}`);
  const starterPlayer = lineupPlayer(starter, `starter for ${offer.playerName}`);
  const starterTeam = lineupTeam(starter, `starter for ${offer.playerName}`);
  const opposingStarterHand = explicitPitcherHand(
    starterPlayer.batsThrows,
    `${starterPlayer.fullName} bats_throws`,
  );
  const declaredHand = declaredBatterHand(
    hitterPlayer.batsThrows,
    `${hitterPlayer.fullName} bats_throws`,
  );
  const homeTeamId = positiveInteger(game.home_team?.id, 'game.home_team.id');
  const awayTeamId = positiveInteger(game.away_team?.id, 'game.away_team.id');
  const teamSide =
    hitterTeam.id === homeTeamId
      ? 'home'
      : hitterTeam.id === awayTeamId
        ? 'away'
        : null;
  if (teamSide === null) {
    throw new Error(`${offer.playerName} team does not belong to the matched game.`);
  }
  return Object.freeze({
    lineupStatus: 'confirmed',
    providerGameId: offer.providerGameId,
    providerPlayerId: offer.providerPlayerId,
    providerTeamId: offer.providerTeamId,
    teamSide,
    ...(typeof game.venue === 'string' ? { venue: game.venue } : {}),
    lineupSlot: battingOrder(hitter),
    rawBatterBatsThrows: hitterPlayer.batsThrows,
    declaredBatterHand: declaredHand,
    batterSide: resolveBatterSideAgainstVerifiedStarter(
      declaredHand,
      opposingStarterHand,
    ),
    opposingStarterPitcherId: starterPlayer.id,
    opposingStarterTeamId: starterTeam.id,
    opposingStarterHand,
    eligibilityProbability: 1,
    lineupSourceCapturedAt: lineupSnapshot.capturedAt,
    lineupSourceSnapshotSha256: lineupSnapshot.combinedSha256,
  });
}

function assertProductionDisabled() {
  const market = PRODUCTION_REGISTRIES.implementedMarkets.find(
    (entry) => entry.baseMarketKey === BATTER_HITS_MARKET_KEY,
  );
  const feature = PRODUCTION_REGISTRIES.features.find(
    (entry) => entry.featureId === BATTER_HITS_FEATURE_ID,
  );
  if (
    market === undefined ||
    feature === undefined ||
    market.status === 'production-enabled' ||
    market.distributionBuilderValidated ||
    feature.enabled ||
    feature.status === 'production-enabled'
  ) {
    throw new Error(
      'Prospective archive requires Batter Hits production and ranking to remain disabled.',
    );
  }
}

async function captureLineups({ gameId, fetchBdl }) {
  const snapshots = [];
  const rows = [];
  const seenCursors = new Set();
  let cursor = null;
  let page = 1;
  while (true) {
    const url = new URL('https://api.balldontlie.io/mlb/v1/lineups');
    url.searchParams.append('game_ids[]', String(gameId));
    url.searchParams.set('per_page', '100');
    if (cursor !== null) url.searchParams.set('cursor', String(cursor));
    const snapshot = await fetchBdl({
      label: `BALLDONTLIE lineups game ${gameId} page ${page}`,
      url,
      requireNonemptyRecords: true,
    });
    snapshots.push(snapshot);
    rows.push(...array(object(snapshot.parsedBody, 'lineup page').data, 'lineup page.data'));
    const nextCursor = snapshot.parsedBody?.meta?.next_cursor ?? null;
    if (nextCursor === null || nextCursor === undefined) break;
    const key = String(nextCursor);
    if (seenCursors.has(key)) {
      throw new Error(`BALLDONTLIE lineup pagination repeated cursor ${key}.`);
    }
    seenCursors.add(key);
    cursor = nextCursor;
    page += 1;
  }
  const combinedBytes = Buffer.concat(
    snapshots.flatMap((snapshot) => {
      const body = Buffer.from(snapshot.rawBody.base64, 'base64');
      const length = Buffer.allocUnsafe(8);
      length.writeBigUInt64BE(BigInt(body.length));
      return [length, body];
    }),
  );
  return Object.freeze({
    snapshots: Object.freeze(snapshots),
    body: Object.freeze({ data: Object.freeze(rows) }),
    capturedAt: snapshots.at(-1).capturedAt,
    combinedSha256: sha256Bytes(combinedBytes),
  });
}

async function readJsonVerified(filePath, expectedSha256, label) {
  const bytes = await readFile(filePath);
  if (expectedSha256 !== undefined && sha256Bytes(bytes) !== expectedSha256) {
    throw new Error(`${label} SHA-256 drifted: ${filePath}`);
  }
  try {
    return Object.freeze({ bytes, value: JSON.parse(bytes.toString('utf8')) });
  } catch {
    throw new Error(`${label} is malformed JSON: ${filePath}`);
  }
}

function sideTotals(gradedRows, halfInning) {
  const rows = gradedRows.filter((row) => row.halfInning === halfInning);
  if (rows.some((row) => row.kind === 'reject')) return null;
  const terminal = rows.filter((row) => row.kind === 'terminal');
  if (terminal.length === 0) return null;
  return Object.freeze({
    plateAppearances: terminal.length,
    hits: terminal.reduce((sum, row) => sum + (row.hit ? 1 : 0), 0),
  });
}

function emptyHistory() {
  return {
    defenseGames: 0,
    plateAppearancesAllowed: 0,
    hitsAllowed: 0,
  };
}

function historyFor(histories, teamId) {
  return histories.get(teamId) ?? emptyHistory();
}

function updateHistory(histories, game) {
  const away = { ...historyFor(histories, game.awayTeamId) };
  const home = { ...historyFor(histories, game.homeTeamId) };
  away.defenseGames += 1;
  away.plateAppearancesAllowed += game.homePlateAppearances;
  away.hitsAllowed += game.homeHits;
  home.defenseGames += 1;
  home.plateAppearancesAllowed += game.awayPlateAppearances;
  home.hitsAllowed += game.awayHits;
  histories.set(game.awayTeamId, away);
  histories.set(game.homeTeamId, home);
}

async function buildStrictlyEarlierTeamHistories({ historyCutoffDate, shardRoot }) {
  const entries = await readdir(shardRoot, { withFileTypes: true });
  const dates = entries
    .filter(
      (entry) =>
        entry.isDirectory() &&
        DATE_PATTERN.test(entry.name) &&
        entry.name < historyCutoffDate,
    )
    .map((entry) => entry.name)
    .sort();
  if (dates.length === 0) {
    throw new Error(
      `No strictly earlier current-season shard evidence exists under ${shardRoot}.`,
    );
  }

  const histories = new Map();
  const manifestEvidence = [];
  let includedGames = 0;
  let excludedGames = 0;
  for (const date of dates) {
    const directory = path.join(shardRoot, date);
    const manifestPath = path.join(directory, 'capture-manifest.json');
    let manifestRead;
    try {
      manifestRead = await readJsonVerified(
        manifestPath,
        undefined,
        `capture manifest ${date}`,
      );
    } catch (error) {
      if (error?.code === 'ENOENT') continue;
      throw error;
    }
    const manifest = object(manifestRead.value, `capture manifest ${date}`);
    if (
      manifest.captureVersion !== 1 ||
      manifest.provider !== 'BALLDONTLIE MLB API' ||
      manifest.activeSeason !== ACTIVE_SEASON ||
      manifest.status !== 'complete' ||
      manifest.truncated !== false ||
      manifest.error !== null ||
      manifest.requiredFinalStatus !== 'STATUS_FINAL'
    ) {
      throw new Error(
        `Prior shard ${date} is not complete approved current-season evidence.`,
      );
    }
    const captures = array(manifest.dateCaptures, `${date}.dateCaptures`);
    if (captures.length !== 1 || captures[0].date !== date) {
      throw new Error(`Prior shard ${date} must contain exactly its own date.`);
    }
    const capture = object(captures[0], `${date}.dateCapture`);
    const gamesSnapshot = object(capture.gamesSnapshot, `${date}.gamesSnapshot`);
    const gamesPath = path.join(directory, gamesSnapshot.filePath);
    const gamesRead = await readJsonVerified(
      gamesPath,
      gamesSnapshot.savedBodySha256,
      `games snapshot ${date}`,
    );
    const gameRows = array(object(gamesRead.value, `${date} games`).data, `${date} games.data`);
    const gameById = new Map(
      gameRows.map((raw) => [positiveInteger(object(raw, 'game').id, 'game.id'), raw]),
    );

    for (const rawPlan of array(capture.games, `${date}.games`)) {
      const plan = object(rawPlan, `${date} game plan`);
      const gameId = positiveInteger(plan.gameId, `${date} gameId`);
      const game = object(gameById.get(gameId), `${date} game ${gameId}`);
      if (
        game.season !== ACTIVE_SEASON ||
        game.postseason !== false ||
        game.status !== 'STATUS_FINAL'
      ) {
        throw new Error(`Historical game ${gameId} is not a final 2026 regular-season game.`);
      }
      const paSnapshot = object(
        plan.plateAppearancesSnapshot,
        `${date} game ${gameId} plateAppearancesSnapshot`,
      );
      const paRead = await readJsonVerified(
        path.join(directory, paSnapshot.filePath),
        paSnapshot.savedBodySha256,
        `plate appearances ${gameId}`,
      );
      const rawPlateAppearances = array(
        object(paRead.value, `plate appearances ${gameId}`).data,
        `plate appearances ${gameId}.data`,
      );
      if (rawPlateAppearances.length !== paSnapshot.recordCount) {
        throw new Error(`Plate-appearance count drifted for game ${gameId}.`);
      }
      const gradedRows = rawPlateAppearances.map((rawPlateAppearance) =>
        gradeM8UntouchedPlateAppearance({
          rawPlateAppearance,
          classification: classifyBallDontLieTerminalPa({
            plateAppearance: rawPlateAppearance,
            providerGameId: gameId,
            sourceSnapshotSha256: paSnapshot.savedBodySha256,
          }),
        }),
      );
      const away = sideTotals(gradedRows, 'top');
      const home = sideTotals(gradedRows, 'bottom');
      if (away === null || home === null) {
        excludedGames += 1;
        continue;
      }
      updateHistory(histories, {
        awayTeamId: positiveInteger(game.away_team?.id, `game ${gameId} away team`),
        homeTeamId: positiveInteger(game.home_team?.id, `game ${gameId} home team`),
        awayPlateAppearances: away.plateAppearances,
        awayHits: away.hits,
        homePlateAppearances: home.plateAppearances,
        homeHits: home.hits,
      });
      includedGames += 1;
    }
    manifestEvidence.push(
      Object.freeze({
        date,
        manifestPath,
        manifestSha256: sha256Bytes(manifestRead.bytes),
        gamesSnapshotSha256: gamesSnapshot.savedBodySha256,
      }),
    );
  }
  if (histories.size === 0) {
    throw new Error('Strictly earlier current-season history produced no eligible teams.');
  }
  return Object.freeze({
    histories,
    evidence: Object.freeze({
      shardRoot,
      firstDate: manifestEvidence[0]?.date ?? null,
      latestDate: manifestEvidence.at(-1)?.date ?? null,
      manifestCount: manifestEvidence.length,
      includedGameCount: includedGames,
      excludedGameCount: excludedGames,
      manifests: Object.freeze(manifestEvidence),
    }),
  });
}

function gameEnvironmentFeatures(histories, game) {
  const awayTeamId = positiveInteger(game.away_team?.id, 'game.away_team.id');
  const homeTeamId = positiveInteger(game.home_team?.id, 'game.home_team.id');
  const awayOpponent = historyFor(histories, homeTeamId);
  const homeOpponent = historyFor(histories, awayTeamId);
  if (
    awayOpponent.defenseGames === 0 ||
    awayOpponent.plateAppearancesAllowed === 0 ||
    homeOpponent.defenseGames === 0 ||
    homeOpponent.plateAppearancesAllowed === 0
  ) {
    throw new Error(
      `Game ${game.id} lacks complete strictly earlier opponent history for D_final.`,
    );
  }
  return Object.freeze({
    awayOpponentPaAllowedPerGame:
      awayOpponent.plateAppearancesAllowed / awayOpponent.defenseGames,
    awayOpponentHitRateAllowed:
      awayOpponent.hitsAllowed / awayOpponent.plateAppearancesAllowed,
    homeOpponentPaAllowedPerGame:
      homeOpponent.plateAppearancesAllowed / homeOpponent.defenseGames,
    homeOpponentHitRateAllowed:
      homeOpponent.hitsAllowed / homeOpponent.plateAppearancesAllowed,
  });
}

async function gameEnvironmentResolutionInput(game, histories) {
  const [artifacts, modelBytes] = await Promise.all([
    loadFrozenBatterHitsProbabilityArtifactsFromFiles(),
    readFile('model-artifacts/m8-5-game-offensive-environment-model-v1.json'),
  ]);
  const model = verifyM8_5GameOffensiveEnvironmentModelArtifactV1(
    JSON.parse(modelBytes.toString('utf8')),
  );
  return Object.freeze({
    input: Object.freeze({
      gameId: String(game.id),
      sourceSharedEnvironmentModelVersion:
        artifacts.sharedEnvironment.modelVersion,
      sourceSharedEnvironmentArtifactSha256:
        artifacts.sharedEnvironment.artifactSha256,
      scenarioIds: Object.freeze([...model.scenarioIds]),
      features: gameEnvironmentFeatures(histories, game),
    }),
    evidence: Object.freeze({
      modelVersion: model.modelVersion,
      modelArtifactSha256: model.artifactSha256,
      modelFileSha256: sha256Bytes(modelBytes),
    }),
  });
}

async function assertArchiveAbsent(filePath) {
  try {
    await access(filePath);
  } catch (error) {
    if (error?.code === 'ENOENT') return;
    throw error;
  }
  throw new Error(
    `Immutable board capture already exists; capture identity rewrite refused before downstream provider calls: ${filePath}`,
  );
}

export async function runM9ProspectiveBoardArchive({
  now = new Date(),
  outputRoot = path.join('artifacts', 'board-archives', 'batter-hits'),
  shardRoot =
    process.env.M8_CURRENT_SEASON_SHARD_ROOT?.trim() ||
    'artifacts/m8-current-season-pa/shards-2026',
  dryRun = false,
  output = process.stdout,
} = {}) {
  if (typeof dryRun !== 'boolean') {
    throw new TypeError('dryRun must be a boolean.');
  }
  if (output === null || typeof output.write !== 'function') {
    throw new TypeError('output must expose write(text).');
  }

  assertProductionDisabled();
  const registryBefore = JSON.stringify(PRODUCTION_REGISTRIES);
  const capturedAt = now.toISOString();
  const captureDateUtc = capturedAt.slice(0, 10);
  let captureIdentity = null;
  let filePath = null;
  const funnel = createM9ArchiveFunnel({
    captureTimestamp: capturedAt,
    dryRun,
  });
  let reportPrinted = false;
  const write = (text) => output.write(text);
  const printFunnel = (status) => {
    if (reportPrinted) return;
    printM9ArchiveFunnelReport({ funnel, status, write });
    reportPrinted = true;
  };

  try {
    const oddsApiKey = requireSecret('THE_ODDS_API_KEY');
    const bdlApiKey = requireSecret('BALLDONTLIE_API_KEY');
    const rateLimiter = createBdlAdaptiveRateLimiter({
      fallbackDelayMs: 13_000,
      utilization: 0.9,
    });
    const fetchOdds = (request) =>
      fetchExactJsonSnapshot({
        provider: 'The Odds API',
        ...request,
      });
    const fetchBdl = async (request) => {
      for (let attempt = 0; attempt <= 8; attempt += 1) {
        const snapshot = await fetchExactJsonSnapshot({
          provider: 'BALLDONTLIE MLB API',
          ...request,
          headers: { Authorization: bdlApiKey },
          beforeRequest: () => rateLimiter.beforeRequest(),
          afterResponse: (response) => rateLimiter.afterResponse(response),
          allowNonOk: true,
        });
        if (snapshot.response.status === 429) {
          if (attempt === 8) {
            throw new Error(`${request.label} exceeded eight HTTP 429 retries.`);
          }
          await rateLimiter.waitForRetry();
          continue;
        }
        if (
          snapshot.response.status < 200 ||
          snapshot.response.status >= 300
        ) {
          throw new Error(
            `${request.label} returned HTTP ${snapshot.response.status} ${snapshot.response.statusText}.`,
          );
        }
        return snapshot;
      }
      throw new Error(`Unreachable retry state for ${request.label}.`);
    };

    const providerSnapshots = [];
    const normalizedOffers = [];
    const candidateEvaluations = [];
    const exclusions = [];
    const environmentEvidence = [];

    const eventsUrl = new URL(
      'https://api.the-odds-api.com/v4/sports/baseball_mlb/events',
    );
    eventsUrl.searchParams.set('apiKey', oddsApiKey);
    eventsUrl.searchParams.set('dateFormat', 'iso');
    const eventsSnapshot = await fetchOdds({
      label: 'The Odds API MLB events',
      url: eventsUrl,
      capturedAt,
      requireNonemptyRecords: true,
    });
    providerSnapshots.push(eventsSnapshot);
    captureIdentity = createM9CaptureIdentity({
      capturedAt,
      rawProviderSnapshotSha256: eventsSnapshot.rawBody.sha256,
    });
    filePath = m9ArchiveFilePath(outputRoot, captureIdentity);
    if (!dryRun) await assertArchiveAbsent(filePath);

    const eventSelection = selectM9PregameEventsForCapture({
      rawEvents: eventsSnapshot.parsedBody,
      capturedAt,
    });
    funnel.add('providerEvents', {
      entered: eventSelection.providerEventCount,
      survived: eventSelection.providerEventCount,
    });
    funnel.add('pregameEvents', {
      entered: eventSelection.providerEventCount,
      survived: eventSelection.events.length,
    });
    eventSelection.drops.forEach((drop) =>
      funnel.dropEvent('pregameEvents', drop),
    );
    if (eventSelection.events.length === 0) {
      throw new Error(
        `No pregame MLB events survived the started-game gate at ${capturedAt}.`,
      );
    }

    const histories = await buildStrictlyEarlierTeamHistories({
      historyCutoffDate: captureDateUtc,
      shardRoot,
    });

    const eventUtcDates = [
      ...new Set(
        eventSelection.events.map((event) => event.commenceTimeUtc.slice(0, 10)),
      ),
    ].sort();
    const gameQuerySnapshots = [];
    for (const date of eventUtcDates) {
      const gamesUrl = new URL('https://api.balldontlie.io/mlb/v1/games');
      gamesUrl.searchParams.append('dates[]', date);
      gamesUrl.searchParams.set('season_type', 'regular');
      gamesUrl.searchParams.set('per_page', '100');
      const snapshot = await fetchBdl({
        label: `BALLDONTLIE games for pregame event UTC date ${date}`,
        url: gamesUrl,
        requireNonemptyRecords: true,
      });
      providerSnapshots.push(snapshot);
      gameQuerySnapshots.push(
        Object.freeze({ queryDateUtc: date, snapshot }),
      );
    }
    let duplicateGameDiagnosticPrinted = false;

    for (const event of eventSelection.events) {
      let oddsSnapshot;
      let rawOffers;
      try {
        const oddsUrl = new URL(
          `https://api.the-odds-api.com/v4/sports/baseball_mlb/events/${event.id}/odds`,
        );
        oddsUrl.searchParams.set('apiKey', oddsApiKey);
        oddsUrl.searchParams.set('bookmakers', 'underdog');
        oddsUrl.searchParams.set('markets', TARGET_MARKETS.join(','));
        oddsUrl.searchParams.set('dateFormat', 'iso');
        oddsUrl.searchParams.set('oddsFormat', 'american');
        oddsUrl.searchParams.set('includeMultipliers', 'true');
        oddsUrl.searchParams.set('includeSids', 'true');
        oddsSnapshot = await fetchOdds({
          label: `Underdog Batter Hits ${event.id}`,
          url: oddsUrl,
          requireNonemptyRecords: true,
        });
        providerSnapshots.push(oddsSnapshot);
        rawOffers = rawOfferSummary(oddsSnapshot.parsedBody);
      } catch (error) {
        exclusions.push({
          providerEventId: event.id,
          reason: 'EVENT_ODDS_FAILED_CLOSED',
          detail: error instanceof Error ? error.message : String(error),
        });
        continue;
      }

      funnel.add('rawOffers', {
        entered: rawOffers.count,
        survived: rawOffers.count,
      });
      if (rawOffers.count === 0) {
        exclusions.push({
          providerEventId: event.id,
          reason: 'NO_BATTER_HITS_OFFERS',
        });
        continue;
      }

      funnel.add('matchedGameOffers', { entered: rawOffers.count });
      const gameResolution = resolveExactBallDontLieGameMatch({
        event,
        gameQuerySnapshots,
      });
      if (
        gameResolution.status === 'duplicate-fetch-artifact' &&
        !duplicateGameDiagnosticPrinted
      ) {
        write(
          formatBallDontLieGameMatchDiagnostic({
            event,
            rawOfferCount: rawOffers.count,
            resolution: gameResolution,
          }),
        );
        duplicateGameDiagnosticPrinted = true;
      }
      if (
        gameResolution.status === 'no-match' ||
        gameResolution.status === 'genuine-ambiguity'
      ) {
        if (gameResolution.status === 'genuine-ambiguity') {
          write(
            formatBallDontLieGameMatchDiagnostic({
              event,
              rawOfferCount: rawOffers.count,
              resolution: gameResolution,
            }),
          );
        }
        const reason =
          gameResolution.status === 'no-match'
            ? 'no exact current-season game match'
            : 'multiple exact current-season game matches';
        funnel.drop('matchedGameOffers', reason, rawOffers.count);
        exclusions.push({
          providerEventId: event.id,
          homeTeamName: event.homeTeamName,
          awayTeamName: event.awayTeamName,
          reason: 'GAME_MATCH_FAILED_CLOSED',
          detail: formatBallDontLieGameMatchDiagnostic({
            event,
            rawOfferCount: rawOffers.count,
            resolution: gameResolution,
          }).trim(),
        });
        continue;
      }
      const game = gameResolution.game;
      const gamesSnapshot = gameResolution.sourceSnapshot;

      let lineups;
      try {
        lineups = await captureLineups({ gameId: game.id, fetchBdl });
        providerSnapshots.push(...lineups.snapshots);
      } catch (error) {
        funnel.add('matchedGameOffers', { survived: rawOffers.count });
        funnel.add('resolvedIdentityOffers', {
          entered: rawOffers.count,
          survived: 0,
        });
        funnel.drop(
          'resolvedIdentityOffers',
          'lineup evidence unavailable for identity resolution',
          rawOffers.count,
        );
        exclusions.push({
          providerEventId: event.id,
          reason: 'LINEUP_EVIDENCE_FAILED_CLOSED',
          detail: error instanceof Error ? error.message : String(error),
        });
        continue;
      }

      const identities = buildPlayerIdentities({
        event,
        game,
        lineupsSnapshot: lineups.body,
        playerNames: rawOffers.playerNames,
      });
      const identitySurvived = offerCountForNames(
        rawOffers,
        identities.identityResolvedPlayerNames,
      );
      funnel.add('resolvedIdentityOffers', {
        entered: rawOffers.count,
        survived: identitySurvived,
      });
      identities.identityExclusions.forEach((entry) => {
        funnel.drop(
          'resolvedIdentityOffers',
          entry.reason === 'ZERO_MATCHES' ? 'zero matches' : 'multiple matches',
          rawOffers.countsByPlayer.get(entry.playerName) ?? 0,
        );
      });
      const lineupSurvived = offerCountForNames(
        rawOffers,
        identities.lineupResolvedPlayerNames,
      );
      funnel.add('lineupEvidenceOffers', {
        entered: identitySurvived,
        survived: lineupSurvived,
      });
      identities.lineupExclusions.forEach((entry) => {
        funnel.drop(
          'lineupEvidenceOffers',
          'no confirmed or projected active lineup evidence',
          rawOffers.countsByPlayer.get(entry.playerName) ?? 0,
        );
      });
      exclusions.push(...identities.identityExclusions, ...identities.lineupExclusions);

      const board = connectPregameBatterHitsBoard({
        rawEventSnapshot: oddsSnapshot.parsedBody,
        sourceSnapshotSha256: oddsSnapshot.rawBody.sha256,
        sourceCapturedAt: oddsSnapshot.capturedAt,
        playerIdentities: identities.identities,
        rawGamesSnapshot: gamesSnapshot.parsedBody,
        gameSourceSnapshotSha256: gamesSnapshot.rawBody.sha256,
        gameSourceCapturedAt: gamesSnapshot.capturedAt,
        asOf: capturedAt,
      });
      const pregameExcludedCount = board.excludedOffers.length;
      funnel.add('matchedGameOffers', {
        survived: rawOffers.count - pregameExcludedCount,
      });
      board.excludedOffers.forEach((entry) => {
        const reason =
          entry.reason === 'GAME_START_REACHED'
            ? 'game already in progress'
            : entry.reason === 'GAME_STATUS_NOT_SCHEDULED'
              ? 'game status not scheduled'
              : 'game state unresolved';
        funnel.drop('matchedGameOffers', reason, 1);
      });
      normalizedOffers.push(...board.offers);
      exclusions.push(
        ...board.rejectedOffers.map((entry) => ({
          providerEventId: event.id,
          reason: entry.reason,
          playerName: entry.playerDescription,
          side: entry.rawSide,
          postedLine: entry.line,
          matchCount: entry.matchCount,
        })),
        ...board.excludedOffers.map((entry) => ({
          providerEventId: event.id,
          reason: entry.reason,
          playerName: entry.offer.playerName,
          side: entry.offer.selectedSide,
          postedLine: entry.offer.line,
        })),
      );

      const observations = [];
      funnel.add('verifiedStarterOffers', { entered: board.offers.length });
      for (const offer of board.offers) {
        try {
          observations.push(
            Object.freeze({
              offer,
              observation: runtimeObservation({
                offer,
                game,
                lineupsSnapshot: lineups.body,
                lineupSnapshot: lineups,
              }),
            }),
          );
          funnel.add('verifiedStarterOffers', { survived: 1 });
        } catch (error) {
          const detail = error instanceof Error ? error.message : String(error);
          funnel.drop(
            'verifiedStarterOffers',
            /verified opposing starter/u.test(detail)
              ? 'no verified opposing starter'
              : 'runtime observation failed before starter verification',
            1,
          );
          exclusions.push({
            providerEventId: event.id,
            playerName: offer.playerName,
            side: offer.selectedSide,
            postedLine: offer.line,
            reason: 'RUNTIME_OBSERVATION_FAILED_CLOSED',
            detail,
          });
        }
      }
      if (observations.length === 0) continue;

      funnel.add('historyOffers', { entered: observations.length });
      let environment;
      try {
        environment = await gameEnvironmentResolutionInput(
          game,
          histories.histories,
        );
        funnel.add('historyOffers', { survived: observations.length });
      } catch (error) {
        funnel.drop(
          'historyOffers',
          'insufficient strictly-earlier current-season history',
          observations.length,
        );
        observations.forEach(({ offer }) =>
          exclusions.push({
            providerEventId: event.id,
            playerName: offer.playerName,
            side: offer.selectedSide,
            postedLine: offer.line,
            reason: 'HISTORY_FAILED_CLOSED',
            detail: error instanceof Error ? error.message : String(error),
          }),
        );
        continue;
      }
      environmentEvidence.push(
        Object.freeze({
          providerGameId: game.id,
          input: environment.input,
          evidence: environment.evidence,
        }),
      );

      funnel.add('composedCandidates', { entered: observations.length });
      for (const { offer, observation } of observations) {
        try {
          const result = await connectFrozenBatterHitsProbabilityOutput({
            pregameBoard: board,
            offer,
            observation,
            gameEnvironmentResolutionInput: environment.input,
          });
          candidateEvaluations.push(Object.freeze({ offer, result }));
          funnel.add('composedCandidates', { survived: 1 });
        } catch (error) {
          funnel.drop(
            'composedCandidates',
            'D_final composition failed closed',
            1,
          );
          exclusions.push({
            providerEventId: event.id,
            playerName: offer.playerName,
            side: offer.selectedSide,
            postedLine: offer.line,
            reason: 'CANDIDATE_FAILED_CLOSED',
            detail: error instanceof Error ? error.message : String(error),
          });
        }
      }
    }

    const candidates = Object.freeze(
      candidateEvaluations.map((entry) => entry.result.candidate),
    );
    let ranking = Object.freeze({
      rankedCandidates: Object.freeze([]),
      excludedCandidates: Object.freeze([]),
    });
    if (candidates.length > 0) {
      ranking = rankPredictionCandidates({
        candidates,
        registries: testOnlyRankingAuthorization(candidates),
      });
    }
    funnel.add('rankedCandidates', {
      entered: candidates.length,
      survived: ranking.rankedCandidates.length,
    });
    ranking.excludedCandidates.forEach((entry) =>
      funnel.drop('rankedCandidates', entry.reason, 1),
    );

    if (
      normalizedOffers.length === 0 ||
      candidateEvaluations.length === 0 ||
      ranking.rankedCandidates.length === 0
    ) {
      throw new Error(
        'Live provider evidence produced no rankable Batter Hits candidates; see the funnel report above.',
      );
    }

    assertProductionDisabled();
    if (JSON.stringify(PRODUCTION_REGISTRIES) !== registryBefore) {
      throw new Error('Live archive execution mutated the production registries.');
    }

    const archive = buildM9ProspectiveBoardArchive({
      capturedAt,
      captureSnapshotSha256: eventsSnapshot.rawBody.sha256,
      pregameEvents: eventSelection.events.map((event) =>
        Object.freeze({
          eventId: event.eventId,
          commenceTimeUtc: event.commenceTimeUtc,
          homeTeamName: event.homeTeamName,
          awayTeamName: event.awayTeamName,
        }),
      ),
      providerSnapshots,
      normalizedOffers,
      candidateEvaluations,
      ranking,
      exclusions,
      evidence: Object.freeze({
        liveBoard: true,
        fixtureBackedEvidence: false,
        productionRegistryUnchanged: true,
        historicalGameEnvironment: histories.evidence,
        gameEnvironmentInputs: Object.freeze(environmentEvidence),
      }),
    });
    const persisted = await persistM9ArchiveForMode({
      dryRun,
      filePath,
      archive,
      persist: persistImmutableM9BoardArchive,
    });

    printFunnel('SUCCESS');
    write(
      [
        'M9 Prospective Batter Hits Board Capture Snapshot',
        'PRODUCTION RANKING: DISABLED',
        `MODE: ${dryRun ? 'DRY RUN — NO ARCHIVE WRITTEN' : 'IMMUTABLE CAPTURE SNAPSHOT'}`,
        `CAPTURE IDENTITY: ${captureIdentity.captureKey}`,
        `CAPTURE TIMESTAMP: ${captureIdentity.capturedAt}`,
        `RAW EVENTS SNAPSHOT SHA-256: ${captureIdentity.rawProviderSnapshotSha256}`,
        `ARCHIVE: ${persisted === null ? 'NOT WRITTEN (--dry-run)' : persisted.filePath}`,
        `ARCHIVE SHA-256: ${archive.archiveSha256}`,
        ...(persisted === null
          ? []
          : [`FILE SHA-256: ${persisted.fileSha256}`]),
        `RAW PROVIDER SNAPSHOTS: ${archive.counts.providerSnapshotCount}`,
        `NORMALIZED OFFERS: ${archive.counts.normalizedOfferCount}`,
        `RANKED CANDIDATES: ${archive.counts.rankedCandidateCount}`,
        `EXCLUSIONS: ${archive.counts.exclusionCount}`,
        '',
      ].join('\n'),
    );
    return Object.freeze({
      archive,
      persisted,
      dryRun,
      funnel: funnel.snapshot(),
    });
  } catch (error) {
    printM9ArchiveFunnelReport({
      funnel,
      status: 'FAILED CLOSED',
      write,
    });
    reportPrinted = true;
    throw error;
  }
}

export async function main(args = process.argv.slice(2)) {
  const dryRun = args.length === 1 && args[0] === '--dry-run';
  if (!(args.length === 0 || dryRun)) {
    throw new Error(
      'Usage: node scripts/archive-m9-batter-hits-board.mjs [--dry-run]',
    );
  }
  await runM9ProspectiveBoardArchive({ dryRun });
}

const invokedPath = process.argv[1];
if (
  invokedPath !== undefined &&
  import.meta.url === pathToFileURL(path.resolve(invokedPath)).href
) {
  main().catch((error) => {
    process.stderr.write(
      `${error instanceof Error ? error.stack ?? error.message : String(error)}\n`,
    );
    process.exitCode = 1;
  });
}
