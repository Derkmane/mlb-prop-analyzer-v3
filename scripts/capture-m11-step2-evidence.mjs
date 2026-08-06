import { createHash } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';

const oddsKey = process.env.THE_ODDS_API_KEY?.trim();
const bdlKey = process.env.BALLDONTLIE_API_KEY?.trim();
if (!oddsKey) throw new Error('Missing THE_ODDS_API_KEY.');
if (!bdlKey) throw new Error('Missing BALLDONTLIE_API_KEY.');

const outputDirectory = path.resolve(
  'fixtures/sanitized/m11/hhr/2026-08-05',
);
await mkdir(outputDirectory, { recursive: true });
const sha256 = (value) => createHash('sha256').update(value).digest('hex');
const sleep = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));

async function fetchSnapshot(url, label, { headers = {}, bdl = false } = {}) {
  for (let attempt = 0; attempt <= 8; attempt += 1) {
    if (bdl && fetchSnapshot.lastBdlAt) {
      const elapsed = Date.now() - fetchSnapshot.lastBdlAt;
      if (elapsed < 12_500) await sleep(12_500 - elapsed);
    }
    const response = await fetch(url, { headers });
    if (bdl) fetchSnapshot.lastBdlAt = Date.now();
    const text = await response.text();
    if (response.status === 429 && attempt < 8) {
      const retrySeconds = Number(response.headers.get('retry-after'));
      await sleep(Number.isFinite(retrySeconds) ? retrySeconds * 1000 : 13_000);
      continue;
    }
    if (!response.ok) {
      throw new Error(`${label} returned HTTP ${response.status}: ${text.slice(0, 500)}`);
    }
    return {
      body: JSON.parse(text),
      rawBodySha256: sha256(text),
    };
  }
  throw new Error(`${label} exhausted retries.`);
}
fetchSnapshot.lastBdlAt = 0;

function bookmakerMarkets(body) {
  const bookmaker = Array.isArray(body?.bookmakers)
    ? body.bookmakers.find((row) => row?.key === 'underdog')
    : null;
  return Array.isArray(bookmaker?.markets) ? bookmaker.markets : [];
}

async function captureOddsBoard() {
  const eventsUrl = new URL('https://api.the-odds-api.com/v4/sports/baseball_mlb/events');
  eventsUrl.searchParams.set('apiKey', oddsKey);
  eventsUrl.searchParams.set('dateFormat', 'iso');
  const events = (await fetchSnapshot(eventsUrl, 'MLB events')).body;
  if (!Array.isArray(events)) throw new Error('MLB events must be an array.');
  const pregame = events
    .filter((event) => Number.isFinite(Date.parse(event?.commence_time)) && Date.parse(event.commence_time) > Date.now())
    .sort((left, right) => Date.parse(left.commence_time) - Date.parse(right.commence_time));

  for (const event of pregame) {
    const catalogUrl = new URL(`https://api.the-odds-api.com/v4/sports/baseball_mlb/events/${event.id}/markets`);
    catalogUrl.searchParams.set('apiKey', oddsKey);
    catalogUrl.searchParams.set('bookmakers', 'underdog');
    catalogUrl.searchParams.set('regions', 'us_dfs');
    catalogUrl.searchParams.set('dateFormat', 'iso');
    const catalog = await fetchSnapshot(catalogUrl, `market catalog ${event.id}`);
    const keys = bookmakerMarkets(catalog.body).map((market) => market.key);
    if (
      !keys.includes('batter_hits_runs_rbis') ||
      !keys.includes('batter_hits_runs_rbis_alternate')
    ) {
      continue;
    }
    const oddsUrl = new URL(`https://api.the-odds-api.com/v4/sports/baseball_mlb/events/${event.id}/odds`);
    oddsUrl.searchParams.set('apiKey', oddsKey);
    oddsUrl.searchParams.set('bookmakers', 'underdog');
    oddsUrl.searchParams.set('regions', 'us_dfs');
    oddsUrl.searchParams.set(
      'markets',
      'batter_hits_runs_rbis,batter_hits_runs_rbis_alternate',
    );
    oddsUrl.searchParams.set('dateFormat', 'iso');
    oddsUrl.searchParams.set('oddsFormat', 'american');
    oddsUrl.searchParams.set('includeMultipliers', 'true');
    oddsUrl.searchParams.set('includeSids', 'true');
    const odds = await fetchSnapshot(oddsUrl, `HHR board ${event.id}`);
    const lines = new Set(
      bookmakerMarkets(odds.body).flatMap((market) =>
        Array.isArray(market.outcomes)
          ? market.outcomes.map((outcome) => outcome.point)
          : [],
      ),
    );
    if (![0.5, 1.5, 2.5].every((line) => lines.has(line))) continue;
    const fixture = {
      captureVersion: 1,
      capturedAt: new Date().toISOString(),
      request: {
        provider: 'The Odds API',
        sport: 'baseball_mlb',
        bookmaker: 'underdog',
        region: 'us_dfs',
        marketKeys: [
          'batter_hits_runs_rbis',
          'batter_hits_runs_rbis_alternate',
        ],
        dateFormat: 'iso',
        oddsFormat: 'american',
        includeMultipliers: true,
        includeSids: true,
      },
      sourceSnapshotSha256: odds.rawBodySha256,
      response: odds.body,
    };
    await writeFile(
      path.join(outputDirectory, 'the-odds-api-underdog-hhr-v1.json'),
      `${JSON.stringify(fixture, null, 2)}\n`,
    );
    console.log(`Captured HHR board event ${event.id} with lines ${JSON.stringify([...lines].sort())}.`);
    return fixture;
  }
  throw new Error('No live Underdog HHR event contained baseline, alternate, and 0.5/1.5/2.5 evidence.');
}

async function fetchBdlCursor(endpoint, gameIds) {
  const pages = [];
  let cursor = null;
  const seen = new Set();
  do {
    const url = new URL(`https://api.balldontlie.io/mlb/v1/${endpoint}`);
    for (const gameId of gameIds) url.searchParams.append('game_ids[]', String(gameId));
    url.searchParams.set('per_page', '100');
    if (cursor !== null) url.searchParams.set('cursor', String(cursor));
    const snapshot = await fetchSnapshot(url, `${endpoint} batch`, {
      headers: { Authorization: bdlKey },
      bdl: true,
    });
    if (!Array.isArray(snapshot.body?.data)) {
      throw new Error(`${endpoint} response data must be an array.`);
    }
    pages.push(snapshot);
    const next = snapshot.body?.meta?.next_cursor ?? null;
    if (next === null || next === undefined) break;
    if (seen.has(String(next))) throw new Error(`${endpoint} repeated cursor ${next}.`);
    seen.add(String(next));
    cursor = next;
  } while (true);
  return pages;
}

function chunks(values, size) {
  const result = [];
  for (let index = 0; index < values.length; index += size) {
    result.push(values.slice(index, index + size));
  }
  return result;
}

async function captureBdlFitFixture() {
  const dates = [
    '2026-07-20',
    '2026-07-21',
    '2026-07-22',
    '2026-07-23',
    '2026-07-24',
    '2026-07-25',
  ];
  const gamesUrl = new URL('https://api.balldontlie.io/mlb/v1/games');
  for (const date of dates) gamesUrl.searchParams.append('dates[]', date);
  gamesUrl.searchParams.set('season_type', 'regular');
  gamesUrl.searchParams.set('per_page', '100');
  const gamesSnapshot = await fetchSnapshot(gamesUrl, 'BDL HHR fit games', {
    headers: { Authorization: bdlKey },
    bdl: true,
  });
  if (!Array.isArray(gamesSnapshot.body?.data)) {
    throw new Error('BDL fit games data must be an array.');
  }
  const games = gamesSnapshot.body.data
    .filter((game) => game?.status === 'STATUS_FINAL')
    .map((game) => ({
      gameId: game.id,
      date: String(game.date ?? game.datetime ?? '').slice(0, 10),
    }))
    .filter((game) => Number.isInteger(game.gameId) && dates.includes(game.date))
    .sort((left, right) => left.date.localeCompare(right.date) || left.gameId - right.gameId);
  if (games.length < 20) throw new Error(`BDL HHR fit requires at least 20 final games; received ${games.length}.`);

  const stats = [];
  const lineups = [];
  const sourceSnapshots = [
    { endpoint: 'games', rawBodySha256: gamesSnapshot.rawBodySha256 },
  ];
  for (const batch of chunks(games.map((game) => game.gameId), 10)) {
    const statsPages = await fetchBdlCursor('stats', batch);
    const lineupPages = await fetchBdlCursor('lineups', batch);
    stats.push(...statsPages.flatMap((page) => page.body.data));
    lineups.push(...lineupPages.flatMap((page) => page.body.data));
    sourceSnapshots.push(
      ...statsPages.map((page) => ({
        endpoint: 'stats',
        gameIds: batch,
        rawBodySha256: page.rawBodySha256,
      })),
      ...lineupPages.map((page) => ({
        endpoint: 'lineups',
        gameIds: batch,
        rawBodySha256: page.rawBodySha256,
      })),
    );
  }

  const gameDate = new Map(games.map((game) => [game.gameId, game.date]));
  const lineupByGamePlayer = new Map();
  for (const row of lineups) {
    if (
      Number.isInteger(row?.game_id) &&
      Number.isInteger(row?.player?.id) &&
      Number.isInteger(row?.batting_order) &&
      row.batting_order >= 1 &&
      row.batting_order <= 9
    ) {
      lineupByGamePlayer.set(`${row.game_id}:${row.player.id}`, row.batting_order);
    }
  }

  const rawRows = [];
  let excludedRowCount = 0;
  for (const row of stats) {
    const date = gameDate.get(row?.game_id);
    const playerId = row?.player?.id;
    const lineupSlot = lineupByGamePlayer.get(`${row?.game_id}:${playerId}`);
    const hits = Number(row?.hits);
    const runs = Number(row?.runs);
    const rbi = Number(row?.rbi);
    const plateAppearances = Number(row?.plate_appearances);
    if (
      !date ||
      !Number.isInteger(playerId) ||
      !Number.isInteger(lineupSlot) ||
      !Number.isInteger(hits) || hits < 0 ||
      !Number.isInteger(runs) || runs < 0 ||
      !Number.isInteger(rbi) || rbi < 0 ||
      !Number.isInteger(plateAppearances) || plateAppearances <= 0
    ) {
      excludedRowCount += 1;
      continue;
    }
    rawRows.push({
      date,
      gameId: row.game_id,
      playerId,
      teamId: row?.team?.id ?? null,
      lineupSlot,
      hits,
      runs,
      rbi,
      plateAppearances,
    });
  }
  rawRows.sort((left, right) =>
    left.date.localeCompare(right.date) ||
    left.gameId - right.gameId ||
    left.playerId - right.playerId,
  );

  const playerHistory = new Map();
  const slotHistory = new Map();
  const fittedRows = [];
  for (const date of dates) {
    const dayRows = rawRows.filter((row) => row.date === date);
    for (const row of dayRows) {
      const player = playerHistory.get(row.playerId);
      const slot = slotHistory.get(row.lineupSlot);
      if (!player || player.plateAppearances <= 0 || !slot || slot.games <= 0) {
        excludedRowCount += 1;
        continue;
      }
      fittedRows.push({
        date: row.date,
        gameId: row.gameId,
        playerId: row.playerId,
        lineupSlot: row.lineupSlot,
        expectedPlateAppearances: slot.plateAppearances / slot.games,
        terminalHitProbability: player.hits / player.plateAppearances,
        targetT: row.hits + row.runs + row.rbi,
      });
    }
    for (const row of dayRows) {
      const player = playerHistory.get(row.playerId) ?? { hits: 0, plateAppearances: 0 };
      player.hits += row.hits;
      player.plateAppearances += row.plateAppearances;
      playerHistory.set(row.playerId, player);
      const slot = slotHistory.get(row.lineupSlot) ?? { plateAppearances: 0, games: 0 };
      slot.plateAppearances += row.plateAppearances;
      slot.games += 1;
      slotHistory.set(row.lineupSlot, slot);
    }
  }
  if (fittedRows.length < 100) {
    throw new Error(`BDL HHR chronological fit requires at least 100 rows; received ${fittedRows.length}.`);
  }

  const fixture = {
    schemaVersion: 1,
    provider: 'BALLDONTLIE MLB API',
    activeSeason: 2026,
    seasonType: 'regular',
    startDate: dates[0],
    endDate: dates.at(-1),
    chronology: 'strictly-earlier-date-predictors',
    gameCount: games.length,
    excludedRowCount,
    sourceSnapshots,
    rows: fittedRows,
  };
  await writeFile(
    path.join(outputDirectory, 'balldontlie-hhr-fit-v1.json'),
    `${JSON.stringify(fixture, null, 2)}\n`,
  );
  console.log(`Captured BDL HHR fit fixture: ${games.length} games, ${fittedRows.length} rows, ${excludedRowCount} excluded.`);
  return fixture;
}

await captureOddsBoard();
await captureBdlFitFixture();
