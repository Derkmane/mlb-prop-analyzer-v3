import { access, readFile } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

export const ARCHIVE_VERSION = 1;
export const ARCHIVE_CONTRACT = 'm9-batter-hits-prospective-board-archive-v1';
export const NORMALIZATION_VERSION = 'm9-batter-hits-board-normalization-v1';
export const CONFIGURATION_VERSION = 'm9-batter-hits-prospective-archive-config-v1';
export const PROJECT_RULES_VERSION = '2.3';
export const MATH_SPEC_VERSION = '1.5';
export const ARCHIVE_TIME_ZONE = 'America/Chicago';
export const TARGET_MARKETS = Object.freeze([
  'batter_hits',
  'batter_hits_alternate',
]);

const SHA256_PATTERN = /^[a-f0-9]{64}$/u;
const VALID_HANDS = new Set(['L', 'R']);

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

function integer(value, label) {
  if (!Number.isSafeInteger(value)) {
    throw new TypeError(`${label} must be a safe integer.`);
  }
  return value;
}

function positiveInteger(value, label) {
  const parsed = integer(value, label);
  if (parsed <= 0) throw new RangeError(`${label} must be positive.`);
  return parsed;
}

function sha256Value(value, label) {
  const parsed = string(value, label);
  if (!SHA256_PATTERN.test(parsed)) {
    throw new TypeError(`${label} must be a lowercase SHA-256 digest.`);
  }
  return parsed;
}

function timestamp(value, label) {
  const parsed = string(value, label);
  if (!Number.isFinite(Date.parse(parsed))) {
    throw new TypeError(`${label} must be an ISO timestamp.`);
  }
  return parsed;
}

function canonicalDateParts(date, timeZone = ARCHIVE_TIME_ZONE) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(date);
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${values.year}-${values.month}-${values.day}`;
}

export function chicagoDate(value = new Date()) {
  const date = value instanceof Date ? value : new Date(value);
  if (!Number.isFinite(date.getTime())) {
    throw new TypeError('archive date input must be a valid date.');
  }
  return canonicalDateParts(date);
}

function exactName(value) {
  return string(value, 'provider name').replace(/\s+/gu, ' ');
}

function parseJsonText(text, label) {
  try {
    return JSON.parse(text);
  } catch {
    throw new Error(`${label} returned invalid JSON.`);
  }
}

function eventShape(raw, index) {
  const event = object(raw, `events[${index}]`);
  return Object.freeze({
    id: string(event.id, `events[${index}].id`),
    sportKey: string(event.sport_key, `events[${index}].sport_key`),
    commenceTime: timestamp(
      event.commence_time,
      `events[${index}].commence_time`,
    ),
    homeTeam: exactName(event.home_team),
    awayTeam: exactName(event.away_team),
  });
}

export function selectProspectiveEvents({
  rawEvents,
  archiveDate,
  asOf,
}) {
  const date = string(archiveDate, 'archiveDate');
  const asOfTime = Date.parse(timestamp(asOf, 'asOf'));
  return Object.freeze(
    array(rawEvents, 'The Odds API events')
      .map(eventShape)
      .filter(
        (event) =>
          event.sportKey === 'baseball_mlb' &&
          chicagoDate(event.commenceTime) === date &&
          Date.parse(event.commenceTime) > asOfTime,
      )
      .sort(
        (left, right) =>
          left.commenceTime.localeCompare(right.commenceTime) ||
          left.id.localeCompare(right.id),
      ),
  );
}

function rawGames(rawSnapshot) {
  return array(object(rawSnapshot, 'BALLDONTLIE games snapshot').data, 'games.data');
}

export function matchExactEventGame({ event, rawGamesSnapshot }) {
  const matches = rawGames(rawGamesSnapshot).filter((raw) => {
    const game = object(raw, 'BALLDONTLIE game');
    return (
      game.season === 2026 &&
      game.season_type === 'regular' &&
      game.postseason === false &&
      exactName(game.home_team_name) === event.homeTeam &&
      exactName(game.away_team_name) === event.awayTeam
    );
  });
  if (matches.length !== 1) {
    throw new Error(
      `Event ${event.id} requires exactly one exact BALLDONTLIE team-pair match; found ${matches.length}.`,
    );
  }
  return object(matches[0], `matched game for ${event.id}`);
}

function underdogBookmaker(rawEventOdds) {
  const event = object(rawEventOdds, 'The Odds API event odds');
  const bookmakers = array(event.bookmakers, 'event.bookmakers').filter(
    (bookmaker) => object(bookmaker, 'bookmaker').key === 'underdog',
  );
  if (bookmakers.length !== 1) {
    throw new Error(
      `Event ${String(event.id)} requires exactly one Underdog bookmaker; found ${bookmakers.length}.`,
    );
  }
  return object(bookmakers[0], 'Underdog bookmaker');
}

export function targetMarketsFromCatalog(rawCatalog) {
  const bookmaker = underdogBookmaker(rawCatalog);
  const keys = array(bookmaker.markets, 'Underdog markets')
    .map((market) => string(object(market, 'market').key, 'market.key'))
    .filter((key) => TARGET_MARKETS.includes(key));
  return Object.freeze([...new Set(keys)].sort());
}

export function offerPlayerNames(rawEventOdds) {
  const bookmaker = underdogBookmaker(rawEventOdds);
  const names = [];
  for (const rawMarket of array(bookmaker.markets, 'Underdog markets')) {
    const market = object(rawMarket, 'market');
    const key = string(market.key, 'market.key');
    if (!TARGET_MARKETS.includes(key)) continue;
    for (const rawOutcome of array(market.outcomes, `${key}.outcomes`)) {
      const outcome = object(rawOutcome, 'outcome');
      names.push(exactName(outcome.description));
    }
  }
  return Object.freeze([...new Set(names)].sort());
}

function lineupRows(rawLineupsSnapshot) {
  return array(
    object(rawLineupsSnapshot, 'BALLDONTLIE lineups snapshot').data,
    'lineups.data',
  );
}

function teamRecord(row, label) {
  const team = object(row.team, `${label}.team`);
  return {
    id: positiveInteger(team.id, `${label}.team.id`),
    displayName: exactName(team.display_name),
  };
}

function playerRecord(row, label) {
  const player = object(row.player, `${label}.player`);
  return {
    id: positiveInteger(player.id, `${label}.player.id`),
    fullName: exactName(player.full_name),
    batsThrows: string(player.bats_throws, `${label}.player.bats_throws`),
  };
}

function battingOrder(row) {
  return Number.isSafeInteger(row.batting_order) &&
    row.batting_order >= 1 &&
    row.batting_order <= 9
    ? row.batting_order
    : null;
}

export function buildEventScopedPlayerIdentities({
  event,
  game,
  rawLineupsSnapshot,
  playerNames,
}) {
  const rows = lineupRows(rawLineupsSnapshot);
  const gameId = positiveInteger(game.id, 'game.id');
  const identities = [];
  const unresolved = [];

  for (const name of playerNames) {
    const matches = rows.filter((raw, index) => {
      const row = object(raw, `lineups.data[${index}]`);
      if (row.game_id !== gameId || row.is_probable_pitcher !== false) return false;
      if (battingOrder(row) === null) return false;
      return playerRecord(row, `lineups.data[${index}]`).fullName === name;
    });

    if (matches.length !== 1) {
      unresolved.push(
        Object.freeze({
          offerPlayerName: name,
          matchCount: matches.length,
          reason: 'CONFIRMED_LINEUP_PLAYER_IDENTITY_UNRESOLVED',
        }),
      );
      continue;
    }

    const row = object(matches[0], `lineup match ${name}`);
    const player = playerRecord(row, `lineup match ${name}`);
    const team = teamRecord(row, `lineup match ${name}`);
    identities.push(
      Object.freeze({
        providerEventId: event.id,
        offerPlayerName: name,
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
    unresolved: Object.freeze(unresolved),
  });
}

function explicitHand(value, position, label) {
  const parts = string(value, label).split('/');
  const hand = parts[position]?.trim();
  if (!VALID_HANDS.has(hand)) {
    throw new Error(`${label} does not provide an approved explicit L/R hand.`);
  }
  return hand;
}

export function buildConfirmedRuntimeObservation({
  offer,
  game,
  rawLineupsSnapshot,
  lineupCapturedAt,
  lineupSnapshotSha256,
}) {
  const rows = lineupRows(rawLineupsSnapshot);
  const gameId = positiveInteger(game.id, 'game.id');
  const hitterMatches = rows.filter((raw, index) => {
    const row = object(raw, `lineups.data[${index}]`);
    const player = playerRecord(row, `lineups.data[${index}]`);
    const team = teamRecord(row, `lineups.data[${index}]`);
    return (
      row.game_id === gameId &&
      row.is_probable_pitcher === false &&
      battingOrder(row) !== null &&
      player.id === offer.providerPlayerId &&
      team.id === offer.providerTeamId
    );
  });
  if (hitterMatches.length !== 1) {
    throw new Error(
      `Offer ${offer.playerName} requires exactly one confirmed lineup row; found ${hitterMatches.length}.`,
    );
  }
  const hitter = object(hitterMatches[0], `confirmed hitter ${offer.playerName}`);
  const hitterPlayer = playerRecord(hitter, `confirmed hitter ${offer.playerName}`);
  const hitterTeam = teamRecord(hitter, `confirmed hitter ${offer.playerName}`);

  const starterMatches = rows.filter((raw, index) => {
    const row = object(raw, `lineups.data[${index}]`);
    if (row.game_id !== gameId || row.is_probable_pitcher !== true) return false;
    const team = teamRecord(row, `lineups.data[${index}]`);
    return team.id !== hitterTeam.id;
  });
  if (starterMatches.length !== 1) {
    throw new Error(
      `Offer ${offer.playerName} requires exactly one opposing probable starter; found ${starterMatches.length}.`,
    );
  }
  const starter = object(
    starterMatches[0],
    `opposing starter for ${offer.playerName}`,
  );
  const starterPlayer = playerRecord(
    starter,
    `opposing starter for ${offer.playerName}`,
  );
  const starterTeam = teamRecord(
    starter,
    `opposing starter for ${offer.playerName}`,
  );

  const homeTeamId = positiveInteger(
    object(game.home_team, 'game.home_team').id,
    'game.home_team.id',
  );
  const awayTeamId = positiveInteger(
    object(game.away_team, 'game.away_team').id,
    'game.away_team.id',
  );
  const teamSide =
    hitterTeam.id === homeTeamId
      ? 'home'
      : hitterTeam.id === awayTeamId
        ? 'away'
        : null;
  if (teamSide === null) {
    throw new Error(`Offer ${offer.playerName} team is not part of the matched game.`);
  }

  return Object.freeze({
    lineupStatus: 'confirmed',
    providerGameId: offer.providerGameId,
    providerPlayerId: offer.providerPlayerId,
    providerTeamId: offer.providerTeamId,
    teamSide,
    lineupSlot: battingOrder(hitter),
    batterSide: explicitHand(
      hitterPlayer.batsThrows,
      0,
      `${offer.playerName} bats_throws`,
    ),
    opposingStarterPitcherId: starterPlayer.id,
    opposingStarterTeamId: starterTeam.id,
    opposingStarterHand: explicitHand(
      starterPlayer.batsThrows,
      1,
      `${starterPlayer.fullName} bats_throws`,
    ),
    eligibilityProbability: 1,
    lineupSourceCapturedAt: timestamp(lineupCapturedAt, 'lineupCapturedAt'),
    lineupSourceSnapshotSha256: sha256Value(
      lineupSnapshotSha256,
      'lineupSnapshotSha256',
    ),
  });
}

function rowIdentity(row) {
  return [
    row.event.commenceTime,
    row.event.providerEventId,
    row.player.playerName,
    row.market.providerMarketKey,
    row.market.line,
    row.market.selectedSide,
  ];
}

export function compareArchiveRows(left, right) {
  return JSON.stringify(rowIdentity(left)).localeCompare(
    JSON.stringify(rowIdentity(right)),
  );
}

export function buildArchiveRow({
  offer,
  probabilityResult,
  lineupSnapshotSha256,
}) {
  const candidate = object(probabilityResult.candidate, 'probability candidate');
  const distribution = object(probabilityResult.distribution, 'runtime distribution');
  if (probabilityResult.productionEnabled !== false) {
    throw new Error('Prospective archive requires productionEnabled=false.');
  }
  if (
    candidate.line !== offer.line ||
    candidate.selectedSide !== offer.selectedSide
  ) {
    throw new Error('Probability output changed the exact posted side or line.');
  }

  return Object.freeze({
    archiveRowVersion: 1,
    event: Object.freeze({
      providerEventId: offer.providerEventId,
      providerGameId: offer.providerGameId,
      homeTeamName: offer.homeTeamName,
      awayTeamName: offer.awayTeamName,
      commenceTime: offer.eventCommenceTime,
    }),
    player: Object.freeze({
      providerPlayerId: offer.providerPlayerId,
      providerTeamId: offer.providerTeamId,
      playerName: offer.playerName,
      teamName: offer.teamName,
    }),
    market: Object.freeze({
      baseMarketKey: offer.baseMarketKey,
      providerMarketKey: offer.providerMarketKey,
      offerType: offer.offerType,
      line: offer.line,
      selectedSide: offer.selectedSide,
      rawSide: offer.rawSide,
      americanPrice: offer.americanPrice,
      multiplier: offer.multiplier,
      marketLastUpdate: offer.marketLastUpdate,
    }),
    probabilities: Object.freeze({
      pWin: candidate.pWin,
      pLoss: candidate.pLoss,
      pVoid: candidate.pVoid,
      pWinGivenGrades: candidate.pWinGivenGrades,
    }),
    versions: Object.freeze({
      projectRulesVersion: PROJECT_RULES_VERSION,
      mathSpecVersion: MATH_SPEC_VERSION,
      normalizationVersion: NORMALIZATION_VERSION,
      modelVersion: candidate.modelVersion,
      distributionBuilderVersion: candidate.distributionBuilderVersion,
      settlementRuleVersion: candidate.settlementRuleVersion,
    }),
    source: Object.freeze({
      boardCapturedAt: offer.sourceCapturedAt,
      boardSnapshotSha256: offer.sourceSnapshotSha256,
      lineupSnapshotSha256: sha256Value(
        lineupSnapshotSha256,
        'lineupSnapshotSha256',
      ),
    }),
    productionRank: null,
    rankStatus: 'NOT_AUTHORIZED_UNTIL_ACCEPTANCE_GATES_PASS',
    candidate,
    distribution,
  });
}

function archiveIdentity(input) {
  return {
    archiveVersion: ARCHIVE_VERSION,
    archiveContract: ARCHIVE_CONTRACT,
    archiveDate: input.archiveDate,
    archivedAt: input.archivedAt,
    asOf: input.asOf,
    timeZone: ARCHIVE_TIME_ZONE,
    projectRulesVersion: PROJECT_RULES_VERSION,
    mathSpecVersion: MATH_SPEC_VERSION,
    normalizationVersion: NORMALIZATION_VERSION,
    configurationVersion: CONFIGURATION_VERSION,
    connectedArtifacts: input.connectedArtifacts,
    productionEnabled: false,
    productionRankingAuthorized: false,
    gradingPerformed: false,
    untouchedTestAccessed: false,
    providerSnapshots: input.providerSnapshots,
    counts: input.counts,
    excludedEvents: input.excludedEvents,
    excludedOffers: input.excludedOffers,
    rows: input.rows,
  };
}

export function buildProspectiveArchive(input, hash) {
  const rows = Object.freeze([...input.rows].sort(compareArchiveRows));
  const identity = archiveIdentity({ ...input, rows });
  return Object.freeze({
    ...identity,
    archiveSha256: hash(JSON.stringify(identity)),
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

export async function persistImmutableArchive({
  filePath,
  archive,
  writeJson,
}) {
  if (await exists(filePath)) {
    const existing = JSON.parse(await readFile(filePath, 'utf8'));
    if (existing.archiveSha256 === archive.archiveSha256) {
      return Object.freeze({ filePath, reused: true });
    }
    throw new Error(
      `Immutable board archive already exists with different identity: ${filePath}`,
    );
  }
  await writeJson(filePath, archive);
  return Object.freeze({ filePath, reused: false });
}

async function connectedM8ArtifactIdentities() {
  const paths = [
    'model-artifacts/m8-batter-hits-runtime-freeze-v1.json',
    'model-artifacts/m8-batter-hits-complete-candidate-v1.json',
    'model-artifacts/m8-shared-offensive-environment-v2.json',
    'model-artifacts/m8-starter-retention-v1.json',
    'model-artifacts/m8-terminal-pa-outcome-v1.json',
  ];
  return Object.freeze(
    await Promise.all(
      paths.map(async (filePath) => {
        const value = object(
          JSON.parse(await readFile(filePath, 'utf8')),
          `connected artifact ${filePath}`,
        );
        return Object.freeze({
          filePath,
          modelVersion: string(value.modelVersion, `${filePath}.modelVersion`),
          artifactSha256: sha256Value(
            value.artifactSha256,
            `${filePath}.artifactSha256`,
          ),
          productionEnabled: value.productionEnabled,
        });
      }),
    ),
  );
}

async function captureBody({
  label,
  url,
  headers,
  secrets,
  fetchSnapshot,
  beforeRequest,
  afterResponse,
}) {
  if (beforeRequest) await beforeRequest();
  const capturedAt = new Date().toISOString();
  const snapshot = await fetchSnapshot({
    label,
    url,
    headers,
    secrets,
  });
  if (afterResponse) {
    afterResponse({
      status: snapshot.response.status,
      headers: snapshot.response.headers,
    });
  }
  if (!snapshot.ok) {
    throw new Error(
      `${label} returned HTTP ${snapshot.response.status} ${snapshot.response.statusText}.`,
    );
  }
  return Object.freeze({
    label,
    capturedAt,
    rawBodySha256: sha256Value(
      snapshot.response.rawBodySha256,
      `${label} rawBodySha256`,
    ),
    body: parseJsonText(snapshot.sanitizedBodyText, label),
  });
}

async function captureLineups({
  gameId,
  fetchBdl,
}) {
  const pages = [];
  const seen = new Set();
  let cursor = null;
  let pageNumber = 1;
  while (true) {
    const url = new URL('https://api.balldontlie.io/mlb/v1/lineups');
    url.searchParams.append('game_ids[]', String(gameId));
    url.searchParams.set('per_page', '100');
    if (cursor !== null) url.searchParams.set('cursor', String(cursor));
    const page = await fetchBdl({
      label: `BALLDONTLIE lineups game ${gameId} page ${pageNumber}`,
      url,
    });
    array(object(page.body, 'lineup page').data, 'lineup page data');
    pages.push(page);
    const nextCursor = page.body?.meta?.next_cursor ?? null;
    if (nextCursor === null || nextCursor === undefined) break;
    const key = String(nextCursor);
    if (seen.has(key)) {
      throw new Error(`BALLDONTLIE lineups repeated cursor ${key}.`);
    }
    seen.add(key);
    cursor = nextCursor;
    pageNumber += 1;
  }
  return Object.freeze({
    capturedAt: pages.at(-1)?.capturedAt ?? new Date().toISOString(),
    rawBodySha256s: Object.freeze(pages.map((page) => page.rawBodySha256)),
    body: Object.freeze({
      data: Object.freeze(pages.flatMap((page) => page.body.data)),
    }),
  });
}

function snapshotRecord(capture) {
  return Object.freeze({
    label: capture.label,
    capturedAt: capture.capturedAt,
    rawBodySha256: capture.rawBodySha256,
    body: capture.body,
  });
}

export async function runLiveProspectiveArchive({
  now = new Date(),
  outputRoot = path.join('artifacts', 'board-archives', 'batter-hits'),
} = {}) {
  const [probe, limiterModule, composition] = await Promise.all([
    import('./provider-probe-utils.mjs'),
    import('./bdl-adaptive-rate-limit-utils.mjs'),
    import('../dist/src/composition/index.js'),
  ]);

  const oddsKey = probe.requireSecret('THE_ODDS_API_KEY');
  const bdlKey = probe.requireSecret('BALLDONTLIE_API_KEY');
  const secrets = [oddsKey, bdlKey];
  const asOf = now.toISOString();
  const archiveDate = chicagoDate(now);
  const rateLimiter = limiterModule.createBdlAdaptiveRateLimiter({
    fallbackDelayMs: 13_000,
    utilization: 0.9,
  });

  const fetchOdds = (request) =>
    captureBody({
      ...request,
      headers: {},
      secrets,
      fetchSnapshot: probe.fetchJsonSnapshot,
    });
  const fetchBdl = async (request) => {
    for (let attempt = 0; attempt <= 8; attempt += 1) {
      await rateLimiter.beforeRequest();
      const capturedAt = new Date().toISOString();
      const snapshot = await probe.fetchJsonSnapshot({
        ...request,
        headers: { Authorization: bdlKey },
        secrets,
      });
      rateLimiter.afterResponse({
        status: snapshot.response.status,
        headers: snapshot.response.headers,
      });
      if (snapshot.response.status === 429) {
        if (attempt >= 8) {
          throw new Error(`${request.label} exceeded 8 automatic HTTP 429 retries.`);
        }
        await rateLimiter.waitForRetry();
        continue;
      }
      if (!snapshot.ok) {
        throw new Error(
          `${request.label} returned HTTP ${snapshot.response.status} ${snapshot.response.statusText}.`,
        );
      }
      return Object.freeze({
        label: request.label,
        capturedAt,
        rawBodySha256: sha256Value(
          snapshot.response.rawBodySha256,
          `${request.label} rawBodySha256`,
        ),
        body: parseJsonText(snapshot.sanitizedBodyText, request.label),
      });
    }
    throw new Error(`Unreachable BALLDONTLIE retry state for ${request.label}.`);
  };

  const eventsUrl = new URL(
    'https://api.the-odds-api.com/v4/sports/baseball_mlb/events',
  );
  eventsUrl.searchParams.set('apiKey', oddsKey);
  eventsUrl.searchParams.set('dateFormat', 'iso');
  const eventsCapture = await fetchOdds({
    label: 'The Odds API MLB events',
    url: eventsUrl,
  });
  const events = selectProspectiveEvents({
    rawEvents: eventsCapture.body,
    archiveDate,
    asOf,
  });

  const gamesUrl = new URL('https://api.balldontlie.io/mlb/v1/games');
  gamesUrl.searchParams.append('dates[]', archiveDate);
  gamesUrl.searchParams.set('season_type', 'regular');
  gamesUrl.searchParams.set('per_page', '100');
  const gamesCapture = await fetchBdl({
    label: `BALLDONTLIE games ${archiveDate}`,
    url: gamesUrl,
  });

  const connectedArtifacts = await connectedM8ArtifactIdentities();
  const providerSnapshots = [snapshotRecord(eventsCapture), snapshotRecord(gamesCapture)];
  const rows = [];
  const excludedEvents = [];
  const excludedOffers = [];

  for (const event of events) {
    try {
      const game = matchExactEventGame({
        event,
        rawGamesSnapshot: gamesCapture.body,
      });
      const catalogUrl = new URL(
        `https://api.the-odds-api.com/v4/sports/baseball_mlb/events/${event.id}/markets`,
      );
      catalogUrl.searchParams.set('apiKey', oddsKey);
      catalogUrl.searchParams.set('bookmakers', 'underdog');
      catalogUrl.searchParams.set('dateFormat', 'iso');
      const catalogCapture = await fetchOdds({
        label: `Underdog market catalog ${event.id}`,
        url: catalogUrl,
      });
      providerSnapshots.push(snapshotRecord(catalogCapture));
      const targetMarkets = targetMarketsFromCatalog(catalogCapture.body);
      if (targetMarkets.length === 0) {
        excludedEvents.push({
          providerEventId: event.id,
          reason: 'NO_VERIFIED_BATTER_HITS_MARKETS',
        });
        continue;
      }

      const oddsUrl = new URL(
        `https://api.the-odds-api.com/v4/sports/baseball_mlb/events/${event.id}/odds`,
      );
      oddsUrl.searchParams.set('apiKey', oddsKey);
      oddsUrl.searchParams.set('bookmakers', 'underdog');
      oddsUrl.searchParams.set('markets', targetMarkets.join(','));
      oddsUrl.searchParams.set('dateFormat', 'iso');
      oddsUrl.searchParams.set('oddsFormat', 'american');
      oddsUrl.searchParams.set('includeMultipliers', 'true');
      oddsUrl.searchParams.set('includeSids', 'true');
      const oddsCapture = await fetchOdds({
        label: `Underdog Batter Hits ${event.id}`,
        url: oddsUrl,
      });
      providerSnapshots.push(snapshotRecord(oddsCapture));

      const lineups = await captureLineups({ gameId: game.id, fetchBdl });
      const lineupSnapshotSha256 = probe.sha256(
        JSON.stringify(lineups.rawBodySha256s),
      );
      providerSnapshots.push(
        Object.freeze({
          label: `BALLDONTLIE lineups game ${game.id}`,
          capturedAt: lineups.capturedAt,
          rawBodySha256: lineupSnapshotSha256,
          body: lineups.body,
        }),
      );

      const identities = buildEventScopedPlayerIdentities({
        event,
        game,
        rawLineupsSnapshot: lineups.body,
        playerNames: offerPlayerNames(oddsCapture.body),
      });
      for (const unresolved of identities.unresolved) {
        excludedOffers.push({
          providerEventId: event.id,
          ...unresolved,
        });
      }

      const pregameBoard = composition.connectPregameBatterHitsBoard({
        rawEventSnapshot: oddsCapture.body,
        sourceSnapshotSha256: oddsCapture.rawBodySha256,
        sourceCapturedAt: oddsCapture.capturedAt,
        playerIdentities: identities.identities,
        rawGamesSnapshot: gamesCapture.body,
        gameSourceSnapshotSha256: gamesCapture.rawBodySha256,
        gameSourceCapturedAt: gamesCapture.capturedAt,
        asOf,
      });

      for (const rejected of pregameBoard.rejectedOffers) {
        excludedOffers.push({
          providerEventId: event.id,
          reason: rejected.reason,
          playerName: rejected.playerDescription,
          line: rejected.line,
          side: rejected.rawSide,
          matchCount: rejected.matchCount,
        });
      }
      for (const excluded of pregameBoard.excludedOffers) {
        excludedOffers.push({
          providerEventId: event.id,
          reason: excluded.reason,
          playerName: excluded.offer.playerName,
          line: excluded.offer.line,
          side: excluded.offer.selectedSide,
        });
      }

      for (const offer of pregameBoard.offers) {
        try {
          const observation = buildConfirmedRuntimeObservation({
            offer,
            game,
            rawLineupsSnapshot: lineups.body,
            lineupCapturedAt: lineups.capturedAt,
            lineupSnapshotSha256,
          });
          const result = await composition.connectFrozenBatterHitsProbabilityOutput({
            pregameBoard,
            offer,
            observation,
          });
          rows.push(
            buildArchiveRow({
              offer,
              probabilityResult: result,
              lineupSnapshotSha256,
            }),
          );
        } catch (error) {
          excludedOffers.push({
            providerEventId: event.id,
            playerName: offer.playerName,
            line: offer.line,
            side: offer.selectedSide,
            reason: 'PROBABILITY_INPUT_FAILED_CLOSED',
            detail: error instanceof Error ? error.message : String(error),
          });
        }
      }
    } catch (error) {
      excludedEvents.push({
        providerEventId: event.id,
        homeTeamName: event.homeTeam,
        awayTeamName: event.awayTeam,
        reason: 'EVENT_FAILED_CLOSED',
        detail: error instanceof Error ? error.message : String(error),
      });
    }
  }

  const archivedAt = new Date().toISOString();
  const archive = buildProspectiveArchive(
    {
      archiveDate,
      archivedAt,
      asOf,
      providerSnapshots: Object.freeze(providerSnapshots),
      connectedArtifacts,
      counts: Object.freeze({
        prospectiveEventCount: events.length,
        archivedRowCount: rows.length,
        excludedEventCount: excludedEvents.length,
        excludedOfferCount: excludedOffers.length,
      }),
      excludedEvents: Object.freeze(excludedEvents),
      excludedOffers: Object.freeze(excludedOffers),
      rows: Object.freeze(rows),
    },
    probe.sha256,
  );
  const filePath = path.join(outputRoot, `${archiveDate}.json`);
  const persistence = await persistImmutableArchive({
    filePath,
    archive,
    writeJson: probe.writeJsonAtomic,
  });

  console.log('=== M9 BATTER HITS PROSPECTIVE BOARD ARCHIVE ===');
  console.log(`Archive: ${filePath}`);
  console.log(`Archive SHA-256: ${archive.archiveSha256}`);
  console.log(`Row count: ${archive.rows.length}`);
  console.log('First five rows:');
  console.log(JSON.stringify(archive.rows.slice(0, 5), null, 2));
  console.log(`Archive reused: ${persistence.reused}`);
  console.log('Production enabled: false');
  console.log('Production ranking authorized: false');
  console.log('Grading performed: false');
  console.log('Untouched-test rows accessed: false');
  return archive;
}

const invokedUrl = process.argv[1]
  ? pathToFileURL(path.resolve(process.argv[1])).href
  : null;
if (invokedUrl === import.meta.url) {
  runLiveProspectiveArchive().catch((error) => {
    console.error(error instanceof Error ? error.stack : String(error));
    process.exitCode = 1;
  });
}
