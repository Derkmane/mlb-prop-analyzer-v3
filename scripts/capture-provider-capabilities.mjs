import path from 'node:path';

import {
  fetchJsonSnapshot,
  requireSecret,
  sanitizeText,
  timestampForPath,
  writeJsonAtomic,
  writeTextAtomic,
} from './provider-probe-utils.mjs';
import {
  activeUtcSeason,
  extractBookmakerMarketKeys,
  observedTargetMarkets,
  parseNonNegativeInteger,
  parseOptionalPositiveInteger,
  previousUtcDate,
  sanitizeFileSegment,
  selectPregameEvents,
  summarizeBdlGames,
} from './provider-capability-utils.mjs';

const startedAt = new Date();
const outputRoot =
  process.env.PROVIDER_CAPABILITY_OUTPUT_DIR?.trim() ||
  path.join('artifacts', 'provider-capabilities', timestampForPath(startedAt));

const oddsApiKey = requireSecret('THE_ODDS_API_KEY');
const balldontlieApiKey = requireSecret('BALLDONTLIE_API_KEY');
const secrets = [oddsApiKey, balldontlieApiKey];
const maxOddsEvents = parseNonNegativeInteger(
  process.env.ODDS_PROBE_MAX_EVENTS,
  'ODDS_PROBE_MAX_EVENTS',
  10,
);
const bdlDelayMs = parseNonNegativeInteger(
  process.env.BDL_PROBE_DELAY_MS,
  'BDL_PROBE_DELAY_MS',
  13_000,
);
const bdlGameId = parseOptionalPositiveInteger(
  process.env.BDL_GAME_ID,
  'BDL_GAME_ID',
);
const bdlPlayerId =
  parseOptionalPositiveInteger(process.env.BDL_PLAYER_ID, 'BDL_PLAYER_ID') ?? 208;
const bdlSeason = activeUtcSeason(startedAt);
const bdlProbeDate =
  process.env.BDL_PROBE_DATE?.trim() || previousUtcDate(startedAt);

if (!/^\d{4}-\d{2}-\d{2}$/.test(bdlProbeDate)) {
  throw new Error('BDL_PROBE_DATE must use YYYY-MM-DD when provided.');
}

function parseSnapshotBody(snapshot) {
  try {
    return JSON.parse(snapshot.sanitizedBodyText);
  } catch {
    return null;
  }
}

async function capture({ label, fileName, url, headers = {} }) {
  try {
    const snapshot = await fetchJsonSnapshot({
      label,
      url,
      headers,
      secrets,
    });
    const bodyPath = path.join(outputRoot, fileName);
    await writeTextAtomic(bodyPath, snapshot.sanitizedBodyText);

    return {
      report: {
        label: snapshot.label,
        ok: snapshot.ok,
        request: snapshot.request,
        response: snapshot.response,
        sanitizedBodyPath: bodyPath,
        error: snapshot.ok
          ? null
          : `Provider returned HTTP ${snapshot.response.status}.`,
      },
      body: parseSnapshotBody(snapshot),
    };
  } catch (error) {
    const message = sanitizeText(
      error instanceof Error ? error.message : String(error),
      secrets,
    );

    return {
      report: {
        label,
        ok: false,
        request: {
          origin: url.origin,
          pathname: url.pathname,
          queryKeys: [...url.searchParams.keys()].sort(),
          headerNames: Object.keys(headers).sort(),
        },
        response: null,
        sanitizedBodyPath: null,
        error: message,
      },
      body: null,
    };
  }
}

const sleep = (milliseconds) =>
  new Promise((resolve) => setTimeout(resolve, milliseconds));

let lastBdlRequestAt = 0;
async function captureBdl(request) {
  const elapsed = Date.now() - lastBdlRequestAt;
  if (lastBdlRequestAt > 0 && elapsed < bdlDelayMs) {
    await sleep(bdlDelayMs - elapsed);
  }

  const result = await capture(request);
  lastBdlRequestAt = Date.now();
  return result;
}

console.log('=== V3 PROVIDER CAPABILITY CAPTURE ===');
console.log(`Output: ${outputRoot}`);

const oddsEventsUrl = new URL(
  'https://api.the-odds-api.com/v4/sports/baseball_mlb/events',
);
oddsEventsUrl.searchParams.set('apiKey', oddsApiKey);
oddsEventsUrl.searchParams.set('dateFormat', 'iso');

console.log('Capturing The Odds API MLB events...');
const oddsEvents = await capture({
  label: 'the-odds-api-mlb-events-capability',
  fileName: 'the-odds-api-mlb-events.json',
  url: oddsEventsUrl,
});

const pregameEvents = selectPregameEvents(oddsEvents.body, startedAt).slice(
  0,
  maxOddsEvents,
);
const oddsMarketCatalogs = [];
const oddsBatterHitsCaptures = [];
const observedOddsMarkets = new Set();

for (const event of pregameEvents) {
  const eventId = event.id;
  const marketsUrl = new URL(
    `https://api.the-odds-api.com/v4/sports/baseball_mlb/events/${eventId}/markets`,
  );
  marketsUrl.searchParams.set('apiKey', oddsApiKey);
  marketsUrl.searchParams.set('bookmakers', 'underdog');
  marketsUrl.searchParams.set('dateFormat', 'iso');

  console.log(`Capturing Underdog market catalog for event ${eventId}...`);
  const catalog = await capture({
    label: `the-odds-api-underdog-markets-${eventId}`,
    fileName: `the-odds-api-${sanitizeFileSegment(eventId)}-underdog-markets.json`,
    url: marketsUrl,
  });
  const marketKeys = extractBookmakerMarketKeys(catalog.body, 'underdog');
  const targets = observedTargetMarkets(marketKeys);
  targets.forEach((marketKey) => observedOddsMarkets.add(marketKey));

  oddsMarketCatalogs.push({
    eventId,
    commenceTime: event.commence_time,
    homeTeam: event.home_team ?? null,
    awayTeam: event.away_team ?? null,
    marketKeys,
    observedTargetMarkets: targets,
    capture: catalog.report,
  });

  if (targets.length === 0) {
    continue;
  }

  const eventOddsUrl = new URL(
    `https://api.the-odds-api.com/v4/sports/baseball_mlb/events/${eventId}/odds`,
  );
  eventOddsUrl.searchParams.set('apiKey', oddsApiKey);
  eventOddsUrl.searchParams.set('bookmakers', 'underdog');
  eventOddsUrl.searchParams.set('markets', targets.join(','));
  eventOddsUrl.searchParams.set('dateFormat', 'iso');
  eventOddsUrl.searchParams.set('oddsFormat', 'american');
  eventOddsUrl.searchParams.set('includeMultipliers', 'true');
  eventOddsUrl.searchParams.set('includeSids', 'true');

  console.log(`Capturing Underdog Batter Hits offers for event ${eventId}...`);
  const eventOdds = await capture({
    label: `the-odds-api-underdog-batter-hits-${eventId}`,
    fileName: `the-odds-api-${sanitizeFileSegment(eventId)}-underdog-batter-hits.json`,
    url: eventOddsUrl,
  });

  oddsBatterHitsCaptures.push({
    eventId,
    requestedMarkets: targets,
    capture: eventOdds.report,
  });
}

const bdlHeaders = { Authorization: balldontlieApiKey };
const bdlGamesUrl = new URL('https://api.balldontlie.io/mlb/v1/games');
bdlGamesUrl.searchParams.append('dates[]', bdlProbeDate);
bdlGamesUrl.searchParams.set('season_type', 'regular');
bdlGamesUrl.searchParams.set('per_page', '100');

console.log(`Capturing BALLDONTLIE games for ${bdlProbeDate}...`);
const bdlGames = await captureBdl({
  label: `balldontlie-games-${bdlProbeDate}`,
  fileName: `balldontlie-games-${sanitizeFileSegment(bdlProbeDate)}.json`,
  url: bdlGamesUrl,
  headers: bdlHeaders,
});
const bdlGameCandidates = summarizeBdlGames(bdlGames.body);

const bdlSeasonStatsUrl = new URL(
  'https://api.balldontlie.io/mlb/v1/season_stats',
);
bdlSeasonStatsUrl.searchParams.set('season', String(bdlSeason));
bdlSeasonStatsUrl.searchParams.append('player_ids[]', String(bdlPlayerId));
bdlSeasonStatsUrl.searchParams.set('season_type', 'regular');
bdlSeasonStatsUrl.searchParams.set('per_page', '100');

console.log(
  `Capturing BALLDONTLIE ${bdlSeason} season stats for player ${bdlPlayerId}...`,
);
const bdlSeasonStats = await captureBdl({
  label: `balldontlie-season-stats-${bdlSeason}-player-${bdlPlayerId}`,
  fileName: `balldontlie-season-stats-${bdlSeason}-player-${bdlPlayerId}.json`,
  url: bdlSeasonStatsUrl,
  headers: bdlHeaders,
});

let bdlSelectedGame = null;
if (bdlGameId !== null) {
  const specificGameUrl = new URL(
    `https://api.balldontlie.io/mlb/v1/games/${bdlGameId}`,
  );
  console.log(`Capturing BALLDONTLIE game ${bdlGameId}...`);
  const game = await captureBdl({
    label: `balldontlie-game-${bdlGameId}`,
    fileName: `balldontlie-game-${bdlGameId}.json`,
    url: specificGameUrl,
    headers: bdlHeaders,
  });

  const lineupsUrl = new URL(
    'https://api.balldontlie.io/mlb/v1/lineups',
  );
  lineupsUrl.searchParams.append('game_ids[]', String(bdlGameId));
  lineupsUrl.searchParams.set('per_page', '100');
  console.log(`Capturing BALLDONTLIE lineups for game ${bdlGameId}...`);
  const lineups = await captureBdl({
    label: `balldontlie-lineups-${bdlGameId}`,
    fileName: `balldontlie-lineups-${bdlGameId}.json`,
    url: lineupsUrl,
    headers: bdlHeaders,
  });

  const plateAppearancesUrl = new URL(
    'https://api.balldontlie.io/mlb/v1/plate_appearances',
  );
  plateAppearancesUrl.searchParams.set('game_id', String(bdlGameId));
  console.log(
    `Capturing BALLDONTLIE plate appearances for game ${bdlGameId}...`,
  );
  const plateAppearances = await captureBdl({
    label: `balldontlie-plate-appearances-${bdlGameId}`,
    fileName: `balldontlie-plate-appearances-${bdlGameId}.json`,
    url: plateAppearancesUrl,
    headers: bdlHeaders,
  });

  const playsUrl = new URL('https://api.balldontlie.io/mlb/v1/plays');
  playsUrl.searchParams.set('game_id', String(bdlGameId));
  playsUrl.searchParams.set('sort_order', 'asc');
  playsUrl.searchParams.set('per_page', '100');
  console.log(`Capturing BALLDONTLIE plays for game ${bdlGameId}...`);
  const plays = await captureBdl({
    label: `balldontlie-plays-${bdlGameId}`,
    fileName: `balldontlie-plays-${bdlGameId}-page-1.json`,
    url: playsUrl,
    headers: bdlHeaders,
  });

  bdlSelectedGame = {
    gameId: bdlGameId,
    game: game.report,
    lineups: lineups.report,
    plateAppearances: plateAppearances.report,
    playsFirstPage: plays.report,
  };
}

const report = {
  probeVersion: 1,
  capturedAt: startedAt.toISOString(),
  purpose:
    'Capture real provider schemas and availability before provider-derived contracts or market implementation.',
  theOddsApi: {
    events: oddsEvents.report,
    pregameEventCount: pregameEvents.length,
    marketCatalogs: oddsMarketCatalogs,
    observedTargetMarkets: [...observedOddsMarkets].sort(),
    batterHitsOfferCaptures: oddsBatterHitsCaptures,
    interpretation: {
      batterHitsBaselineObserved: observedOddsMarkets.has('batter_hits'),
      batterHitsAlternateObserved: observedOddsMarkets.has(
        'batter_hits_alternate',
      ),
    },
  },
  balldontlie: {
    probeDate: bdlProbeDate,
    games: bdlGames.report,
    gameCandidates: bdlGameCandidates,
    seasonStats: bdlSeasonStats.report,
    selectedGame: bdlSelectedGame,
  },
  nextAction:
    bdlGameId === null
      ? 'Review gameCandidates, choose one completed regular-season game ID, then rerun with BDL_GAME_ID set.'
      : 'Review the captured lineup, plate-appearance, and play schemas before defining any normalized contract.',
};

const reportPath = path.join(outputRoot, 'provider-capability-report.json');
await writeJsonAtomic(reportPath, report);

console.log('=== CAPABILITY CAPTURE RESULT ===');
console.log(`Report: ${reportPath}`);
console.log(
  `Underdog Batter Hits baseline: ${
    report.theOddsApi.interpretation.batterHitsBaselineObserved
      ? 'OBSERVED'
      : 'NOT OBSERVED'
  }`,
);
console.log(
  `Underdog Batter Hits alternate: ${
    report.theOddsApi.interpretation.batterHitsAlternateObserved
      ? 'OBSERVED'
      : 'NOT OBSERVED'
  }`,
);
console.log(`BALLDONTLIE game candidates: ${bdlGameCandidates.length}`);
console.log(
  bdlGameId === null
    ? 'BALLDONTLIE game-detail capture: WAITING FOR BDL_GAME_ID'
    : `BALLDONTLIE game-detail capture: REQUESTED FOR ${bdlGameId}`,
);
