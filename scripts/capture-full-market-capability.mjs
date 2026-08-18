import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';

const apiKey = process.env.THE_ODDS_API_KEY?.trim();
if (!apiKey) throw new Error('THE_ODDS_API_KEY is required.');

const SPORT = 'baseball_mlb';
const BOOKMAKER = 'underdog';
const TARGET_MARKETS = Object.freeze([
  'batter_total_bases',
  'batter_total_bases_alternate',
  'batter_runs_scored',
  'batter_runs_scored_alternate',
  'batter_rbis',
  'batter_rbis_alternate',
  'batter_strikeouts',
  'batter_strikeouts_alternate',
  'batter_walks',
  'batter_walks_alternate',
  'pitcher_strikeouts',
  'pitcher_strikeouts_alternate',
  'pitcher_outs',
  'pitcher_outs_alternate',
  'pitcher_hits_allowed',
  'pitcher_hits_allowed_alternate',
  'pitcher_walks',
  'pitcher_walks_alternate',
  'pitcher_earned_runs',
  'pitcher_earned_runs_alternate',
]);
const OUTPUT = path.join(
  'fixtures',
  'sanitized',
  'provider-capabilities',
  '2026-08-18',
  'full-market-underdog-capability.json',
);

function publicUrl(url) {
  const copy = new URL(url);
  copy.searchParams.delete('apiKey');
  return copy.toString();
}

async function getJson(url, label) {
  const response = await fetch(url);
  const text = await response.text();
  if (!response.ok) {
    throw new Error(`${label} returned HTTP ${response.status}: ${text.slice(0, 400)}`);
  }
  return {
    json: JSON.parse(text),
    request: publicUrl(url),
    status: response.status,
    responseHeaders: {
      requestsRemaining: response.headers.get('x-requests-remaining'),
      requestsUsed: response.headers.get('x-requests-used'),
      requestsLast: response.headers.get('x-requests-last'),
    },
  };
}

const now = new Date();
const eventsUrl = new URL(`https://api.the-odds-api.com/v4/sports/${SPORT}/events`);
eventsUrl.searchParams.set('apiKey', apiKey);
eventsUrl.searchParams.set('dateFormat', 'iso');
const eventsResult = await getJson(eventsUrl, 'MLB events');
if (!Array.isArray(eventsResult.json)) throw new Error('MLB events response must be an array.');

const upcoming = eventsResult.json
  .filter((event) => typeof event?.id === 'string')
  .filter((event) => Date.parse(event.commence_time) > now.getTime())
  .sort((a, b) => Date.parse(a.commence_time) - Date.parse(b.commence_time));

if (upcoming.length === 0) throw new Error('No future MLB events are available for capability capture.');

const observed = new Set();
const events = [];
for (const event of upcoming) {
  const marketsUrl = new URL(
    `https://api.the-odds-api.com/v4/sports/${SPORT}/events/${event.id}/markets`,
  );
  marketsUrl.searchParams.set('apiKey', apiKey);
  marketsUrl.searchParams.set('bookmakers', BOOKMAKER);
  marketsUrl.searchParams.set('dateFormat', 'iso');
  const marketsResult = await getJson(marketsUrl, `event markets ${event.id}`);
  const bookmakers = Array.isArray(marketsResult.json?.bookmakers)
    ? marketsResult.json.bookmakers
    : [];
  const underdog = bookmakers.find((bookmaker) => bookmaker?.key === BOOKMAKER);
  const marketEntries = Array.isArray(underdog?.markets) ? underdog.markets : [];
  const marketKeys = marketEntries
    .map((market) => market?.key)
    .filter((value) => typeof value === 'string')
    .sort();
  const targetKeys = marketKeys.filter((key) => TARGET_MARKETS.includes(key));
  targetKeys.forEach((key) => observed.add(key));

  let oddsEvidence = null;
  if (targetKeys.length > 0) {
    const oddsUrl = new URL(
      `https://api.the-odds-api.com/v4/sports/${SPORT}/events/${event.id}/odds`,
    );
    oddsUrl.searchParams.set('apiKey', apiKey);
    oddsUrl.searchParams.set('bookmakers', BOOKMAKER);
    oddsUrl.searchParams.set('markets', targetKeys.join(','));
    oddsUrl.searchParams.set('dateFormat', 'iso');
    oddsUrl.searchParams.set('oddsFormat', 'american');
    oddsUrl.searchParams.set('includeMultipliers', 'true');
    oddsUrl.searchParams.set('includeSids', 'true');
    const oddsResult = await getJson(oddsUrl, `event odds ${event.id}`);
    oddsEvidence = {
      request: oddsResult.request,
      status: oddsResult.status,
      responseHeaders: oddsResult.responseHeaders,
      response: oddsResult.json,
    };
  }

  events.push({
    eventId: event.id,
    commenceTime: event.commence_time,
    homeTeam: event.home_team,
    awayTeam: event.away_team,
    marketsRequest: marketsResult.request,
    marketsStatus: marketsResult.status,
    marketKeys,
    observedTargetMarketKeys: targetKeys,
    oddsEvidence,
  });

  if (observed.size === TARGET_MARKETS.length) break;
}

const observedTargetMarketKeys = [...observed].sort();
const missingTargetMarketKeys = TARGET_MARKETS.filter((key) => !observed.has(key));
const fixture = {
  fixtureVersion: 1,
  purpose: 'Live Underdog MLB player-prop capability evidence for full requested-market implementation. Candidate keys are probe inputs only; only observedTargetMarketKeys are evidence-backed.',
  capturedAt: now.toISOString(),
  bookmaker: BOOKMAKER,
  sport: SPORT,
  eventsRequest: eventsResult.request,
  targetProbeMarketKeys: TARGET_MARKETS,
  observedTargetMarketKeys,
  missingTargetMarketKeys,
  events,
};

await mkdir(path.dirname(OUTPUT), { recursive: true });
await writeFile(OUTPUT, `${JSON.stringify(fixture, null, 2)}\n`, 'utf8');
console.log(`CAPABILITY_FIXTURE\t${OUTPUT}`);
console.log(`OBSERVED_TARGET_KEYS\t${observedTargetMarketKeys.length}\t${observedTargetMarketKeys.join(',')}`);
console.log(`MISSING_TARGET_KEYS\t${missingTargetMarketKeys.length}\t${missingTargetMarketKeys.join(',')}`);
