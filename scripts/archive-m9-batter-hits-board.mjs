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
  createM9RawProviderSnapshot,
  m9ArchiveFilePath,
  persistImmutableM9BoardArchive,
  sha256Bytes,
} from './m9-board-archive-utils.mjs';
import { requireSecret } from './provider-probe-utils.mjs';
import { testOnlyRankingAuthorization } from './print-m9-ranked-batter-hits-fixture.mjs';

const ACTIVE_SEASON = 2026;
const ARCHIVE_TIME_ZONE = 'America/Chicago';
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

function chicagoDate(value) {
  const date = value instanceof Date ? value : new Date(value);
  if (!Number.isFinite(date.getTime())) {
    throw new TypeError('Archive clock must be a valid date.');
  }
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: ARCHIVE_TIME_ZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(date);
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${values.year}-${values.month}-${values.day}`;
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
  headers = {},
  requireNonemptyRecords = false,
  beforeRequest,
  afterResponse,
}) {
  if (beforeRequest) await beforeRequest();
  const capturedAt = new Date().toISOString();
  const response = await fetch(url, { headers });
  const rawBodyBytes = Buffer.from(await response.arrayBuffer());
  if (afterResponse) {
    afterResponse({ status: response.status, headers: response.headers });
  }
  const snapshot = createM9RawProviderSnapshot({
    provider,
    label,
    capturedAt,
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
  if (!response.ok) {
    throw new Error(
      `${label} returned HTTP ${response.status} ${response.statusText}.`,
    );
  }
  return snapshot;
}

function prospectiveEvents(rawEvents, archiveDate, asOf) {
  const asOfMilliseconds = Date.parse(asOf);
  const selected = array(rawEvents, 'The Odds API events')
    .map((raw, index) => {
      const event = object(raw, `events[${index}]`);
      return Object.freeze({
        id: nonemptyString(event.id, `events[${index}].id`),
        sportKey: nonemptyString(
          event.sport_key,
          `events[${index}].sport_key`,
        ),
        commenceTime: nonemptyString(
          event.commence_time,
          `events[${index}].commence_time`,
        ),
        homeTeamName: exactName(
          event.home_team,
          `events[${index}].home_team`,
        ),
        awayTeamName: exactName(
          event.away_team,
          `events[${index}].away_team`,
        ),
      });
    })
    .filter(
      (event) =>
        event.sportKey === 'baseball_mlb' &&
        chicagoDate(event.commenceTime) === archiveDate &&
        Date.parse(event.commenceTime) > asOfMilliseconds,
    )
    .sort(
      (left, right) =>
        left.commenceTime.localeCompare(right.commenceTime) ||
        left.id.localeCompare(right.id),
    );
  if (selected.length === 0) {
    throw new Error(
      `The Odds API returned no still-pregame MLB events for ${archiveDate}.`,
    );
  }
  return Object.freeze(selected);
}

function matchGame(event, rawGamesSnapshot) {
  const rows = array(
    object(rawGamesSnapshot, 'BALLDONTLIE games').data,
    'BALLDONTLIE games.data',
  );
  const matches = rows.filter((raw) => {
    const game = object(raw, 'BALLDONTLIE game');
    return (
      game.season === ACTIVE_SEASON &&
      game.season_type === 'regular' &&
      game.postseason === false &&
      exactName(game.home_team_name, 'game.home_team_name') ===
        event.homeTeamName &&
      exactName(game.away_team_name, 'game.away_team_name') ===
        event.awayTeamName
    );
  });
  if (matches.length !== 1) {
    throw new Error(
      `Event ${event.id} requires exactly one exact BALLDONTLIE game match; found ${matches.length}.`,
    );
  }
  return object(matches[0], `matched game ${event.id}`);
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

function offerPlayerNames(rawOdds) {
  const names = [];
  for (const rawMarket of underdogMarkets(rawOdds)) {
    const market = object(rawMarket, 'market');
    for (const rawOutcome of array(market.outcomes, `${market.key}.outcomes`)) {
      names.push(exactName(object(rawOutcome, 'outcome').description, 'outcome.description'));
    }
  }
  return Object.freeze([...new Set(names)].sort());
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
  const exclusions = [];
  for (const playerName of playerNames) {
    const matches = rows.filter((raw, index) => {
      const row = object(raw, `lineups[${index}]`);
      return (
        row.game_id === gameId &&
        row.is_probable_pitcher === false &&
        battingOrder(row) !== null &&
        lineupPlayer(row, `lineups[${index}]`).fullName === playerName
      );
    });
    if (matches.length !== 1) {
      exclusions.push(
        Object.freeze({
          providerEventId: event.id,
          playerName,
          reason: 'LINEUP_PLAYER_IDENTITY_UNRESOLVED',
          matchCount: matches.length,
        }),
      );
      continue;
    }
    const row = object(matches[0], `lineup identity ${playerName}`);
    const player = lineupPlayer(row, `lineup identity ${playerName}`);
    const team = lineupTeam(row, `lineup identity ${playerName}`);
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
    exclusions: Object.freeze(exclusions),
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

async function buildStrictlyEarlierTeamHistories({ archiveDate, shardRoot }) {
  const entries = await readdir(shardRoot, { withFileTypes: true });
  const dates = entries
    .filter(
      (entry) =>
        entry.isDirectory() &&
        DATE_PATTERN.test(entry.name) &&
        entry.name < archiveDate,
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
    `Immutable board archive already exists; live capture refused before provider calls: ${filePath}`,
  );
}

export async function runM9ProspectiveBoardArchive({
  now = new Date(),
  outputRoot = path.join('artifacts', 'board-archives', 'batter-hits'),
  shardRoot =
    process.env.M8_CURRENT_SEASON_SHARD_ROOT?.trim() ||
    'artifacts/m8-current-season-pa/shards-2026',
} = {}) {
  assertProductionDisabled();
  const registryBefore = JSON.stringify(PRODUCTION_REGISTRIES);
  const capturedAt = now.toISOString();
  const archiveDate = chicagoDate(now);
  const filePath = m9ArchiveFilePath(outputRoot, archiveDate);
  await assertArchiveAbsent(filePath);

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
      });
      if (snapshot.response.status !== 429) return snapshot;
      if (attempt === 8) {
        throw new Error(`${request.label} exceeded eight HTTP 429 retries.`);
      }
      await rateLimiter.waitForRetry();
    }
    throw new Error(`Unreachable retry state for ${request.label}.`);
  };

  const histories = await buildStrictlyEarlierTeamHistories({
    archiveDate,
    shardRoot,
  });
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
    requireNonemptyRecords: true,
  });
  providerSnapshots.push(eventsSnapshot);
  const events = prospectiveEvents(
    eventsSnapshot.parsedBody,
    archiveDate,
    capturedAt,
  );

  const gamesUrl = new URL('https://api.balldontlie.io/mlb/v1/games');
  gamesUrl.searchParams.append('dates[]', archiveDate);
  gamesUrl.searchParams.set('season_type', 'regular');
  gamesUrl.searchParams.set('per_page', '100');
  const gamesSnapshot = await fetchBdl({
    label: `BALLDONTLIE games ${archiveDate}`,
    url: gamesUrl,
    requireNonemptyRecords: true,
  });
  providerSnapshots.push(gamesSnapshot);

  for (const event of events) {
    try {
      const game = matchGame(event, gamesSnapshot.parsedBody);
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
      const oddsSnapshot = await fetchOdds({
        label: `Underdog Batter Hits ${event.id}`,
        url: oddsUrl,
        requireNonemptyRecords: true,
      });
      providerSnapshots.push(oddsSnapshot);
      const names = offerPlayerNames(oddsSnapshot.parsedBody);
      if (names.length === 0) {
        exclusions.push({
          providerEventId: event.id,
          reason: 'NO_BATTER_HITS_OFFERS',
        });
        continue;
      }
      const lineups = await captureLineups({ gameId: game.id, fetchBdl });
      providerSnapshots.push(...lineups.snapshots);
      const identities = buildPlayerIdentities({
        event,
        game,
        lineupsSnapshot: lineups.body,
        playerNames: names,
      });
      exclusions.push(...identities.exclusions);

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

      const environment = await gameEnvironmentResolutionInput(
        game,
        histories.histories,
      );
      environmentEvidence.push(
        Object.freeze({
          providerGameId: game.id,
          input: environment.input,
          evidence: environment.evidence,
        }),
      );
      for (const offer of board.offers) {
        try {
          const result = await connectFrozenBatterHitsProbabilityOutput({
            pregameBoard: board,
            offer,
            observation: runtimeObservation({
              offer,
              game,
              lineupsSnapshot: lineups.body,
              lineupSnapshot: lineups,
            }),
            gameEnvironmentResolutionInput: environment.input,
          });
          candidateEvaluations.push(Object.freeze({ offer, result }));
        } catch (error) {
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
    } catch (error) {
      exclusions.push({
        providerEventId: event.id,
        homeTeamName: event.homeTeamName,
        awayTeamName: event.awayTeamName,
        reason: 'EVENT_FAILED_CLOSED',
        detail: error instanceof Error ? error.message : String(error),
      });
    }
  }

  if (normalizedOffers.length === 0 || candidateEvaluations.length === 0) {
    throw new Error(
      'Live provider evidence produced no normalized and composed Batter Hits candidates.',
    );
  }
  const candidates = Object.freeze(
    candidateEvaluations.map((entry) => entry.result.candidate),
  );
  const ranking = rankPredictionCandidates({
    candidates,
    registries: testOnlyRankingAuthorization(candidates),
  });

  assertProductionDisabled();
  if (JSON.stringify(PRODUCTION_REGISTRIES) !== registryBefore) {
    throw new Error('Live archive execution mutated the production registries.');
  }

  const archive = buildM9ProspectiveBoardArchive({
    archiveDate,
    capturedAt,
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
  const persisted = await persistImmutableM9BoardArchive({
    filePath,
    archive,
  });

  process.stdout.write(
    [
      'M9 Prospective Batter Hits Board Archive',
      'PRODUCTION RANKING: DISABLED',
      `ARCHIVE: ${persisted.filePath}`,
      `ARCHIVE SHA-256: ${archive.archiveSha256}`,
      `FILE SHA-256: ${persisted.fileSha256}`,
      `RAW PROVIDER SNAPSHOTS: ${archive.counts.providerSnapshotCount}`,
      `NORMALIZED OFFERS: ${archive.counts.normalizedOfferCount}`,
      `RANKED CANDIDATES: ${archive.counts.rankedCandidateCount}`,
      `EXCLUSIONS: ${archive.counts.exclusionCount}`,
      '',
    ].join('\n'),
  );
  return Object.freeze({ archive, persisted });
}

export async function main(args = process.argv.slice(2)) {
  if (args.length !== 0) {
    throw new Error(
      'Usage: node scripts/archive-m9-batter-hits-board.mjs',
    );
  }
  await runM9ProspectiveBoardArchive();
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
