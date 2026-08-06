const apiKey = process.env.THE_ODDS_API_KEY?.trim();
if (!apiKey) throw new Error('Missing THE_ODDS_API_KEY.');

async function fetchJson(url, label) {
  const response = await fetch(url);
  const text = await response.text();
  if (!response.ok) {
    throw new Error(`${label} returned HTTP ${response.status}: ${text.slice(0, 500)}`);
  }
  return JSON.parse(text);
}

function bookmakerMarkets(body) {
  const bookmaker = Array.isArray(body?.bookmakers)
    ? body.bookmakers.find((row) => row?.key === 'underdog')
    : null;
  return Array.isArray(bookmaker?.markets) ? bookmaker.markets : [];
}

const eventsUrl = new URL('https://api.the-odds-api.com/v4/sports/baseball_mlb/events');
eventsUrl.searchParams.set('apiKey', apiKey);
eventsUrl.searchParams.set('dateFormat', 'iso');
const events = await fetchJson(eventsUrl, 'MLB events');
if (!Array.isArray(events)) throw new Error('MLB events must be an array.');

const now = Date.now();
const pregame = events
  .filter((event) => Number.isFinite(Date.parse(event?.commence_time)) && Date.parse(event.commence_time) > now)
  .sort((a, b) => Date.parse(a.commence_time) - Date.parse(b.commence_time))
  .slice(0, 30);

const catalogs = [];
const allKeys = new Set();
for (const event of pregame) {
  const url = new URL(`https://api.the-odds-api.com/v4/sports/baseball_mlb/events/${event.id}/markets`);
  url.searchParams.set('apiKey', apiKey);
  url.searchParams.set('bookmakers', 'underdog');
  url.searchParams.set('regions', 'us_dfs');
  url.searchParams.set('dateFormat', 'iso');
  const body = await fetchJson(url, `market catalog ${event.id}`);
  const keys = bookmakerMarkets(body).map((market) => market.key).filter((key) => typeof key === 'string').sort();
  keys.forEach((key) => allKeys.add(key));
  catalogs.push({
    eventId: event.id,
    commenceTime: event.commence_time,
    homeTeam: event.home_team ?? null,
    awayTeam: event.away_team ?? null,
    marketKeys: keys,
  });
}

const hhrKeys = [...allKeys].filter((key) => {
  const normalized = key.toLowerCase();
  return (
    normalized.includes('hits_runs_rbis') ||
    normalized.includes('hits_runs_rbi') ||
    (normalized.includes('hits') && normalized.includes('runs') && normalized.includes('rbi'))
  );
}).sort();

const offerEvidence = [];
for (const catalog of catalogs) {
  const requested = catalog.marketKeys.filter((key) => hhrKeys.includes(key));
  if (requested.length === 0) continue;
  const url = new URL(`https://api.the-odds-api.com/v4/sports/baseball_mlb/events/${catalog.eventId}/odds`);
  url.searchParams.set('apiKey', apiKey);
  url.searchParams.set('bookmakers', 'underdog');
  url.searchParams.set('regions', 'us_dfs');
  url.searchParams.set('markets', requested.join(','));
  url.searchParams.set('dateFormat', 'iso');
  url.searchParams.set('oddsFormat', 'american');
  url.searchParams.set('includeMultipliers', 'true');
  url.searchParams.set('includeSids', 'true');
  const body = await fetchJson(url, `HHR offers ${catalog.eventId}`);
  const markets = bookmakerMarkets(body).map((market) => ({
    key: market.key,
    lastUpdate: market.last_update ?? null,
    outcomes: Array.isArray(market.outcomes)
      ? market.outcomes.map((outcome) => ({
          name: outcome.name ?? null,
          description: outcome.description ?? null,
          point: outcome.point ?? null,
          price: outcome.price ?? null,
          multiplier: outcome.multiplier ?? null,
          sid: outcome.sid ?? null,
        }))
      : [],
  }));
  offerEvidence.push({ eventId: catalog.eventId, requested, markets });
}

console.log('=== M11 HHR UNDERDOG MARKET PROBE ===');
console.log(`Pregame events inspected: ${pregame.length}`);
console.log(`All observed Underdog keys: ${JSON.stringify([...allKeys].sort())}`);
console.log(`HHR candidate keys: ${JSON.stringify(hhrKeys)}`);
console.log(`Catalogs: ${JSON.stringify(catalogs)}`);
console.log(`HHR offer evidence: ${JSON.stringify(offerEvidence)}`);
console.log('=== END M11 HHR UNDERDOG MARKET PROBE ===');

if (hhrKeys.length === 0) {
  throw new Error('No live Underdog HHR market key was observed.');
}
