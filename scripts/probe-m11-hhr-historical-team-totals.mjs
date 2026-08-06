import { createHash } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';

const apiKey = process.env.THE_ODDS_API_KEY?.trim();
if (!apiKey) throw new Error('Missing THE_ODDS_API_KEY.');

const requestedAt = '2026-07-20T17:00:00Z';
const outputPath = path.resolve(
  'fixtures/sanitized/m11/hhr/provider-contracts/historical-team-totals-probe.json',
);
const sha256 = (value) => createHash('sha256').update(value).digest('hex');

async function fetchJson(url, label) {
  const response = await fetch(url);
  const text = await response.text();
  if (!response.ok) {
    throw new Error(`${label} returned HTTP ${response.status}: ${text.slice(0, 500)}`);
  }
  return {
    body: JSON.parse(text),
    rawBodySha256: sha256(text),
    requestCost: response.headers.get('x-requests-last'),
    requestsRemaining: response.headers.get('x-requests-remaining'),
  };
}

const eventsUrl = new URL(
  'https://api.the-odds-api.com/v4/historical/sports/baseball_mlb/events',
);
eventsUrl.searchParams.set('apiKey', apiKey);
eventsUrl.searchParams.set('date', requestedAt);
eventsUrl.searchParams.set('dateFormat', 'iso');
const eventsSnapshot = await fetchJson(eventsUrl, 'historical MLB events');
const events = Array.isArray(eventsSnapshot.body?.data)
  ? eventsSnapshot.body.data
  : Array.isArray(eventsSnapshot.body)
    ? eventsSnapshot.body
    : null;
if (!events) throw new Error('Historical MLB events response data must be an array.');
const requestedTimestamp = Date.parse(requestedAt);
const candidates = events
  .filter((event) => {
    const commence = Date.parse(event?.commence_time);
    return Number.isFinite(commence) && commence > requestedTimestamp && commence <= requestedTimestamp + 36 * 60 * 60 * 1000;
  })
  .sort((left, right) => Date.parse(left.commence_time) - Date.parse(right.commence_time));
if (candidates.length === 0) {
  throw new Error('Historical MLB events contained no future event within 36 hours of the probe snapshot.');
}

let selected = null;
let oddsSnapshot = null;
for (const event of candidates.slice(0, 12)) {
  const oddsUrl = new URL(
    `https://api.the-odds-api.com/v4/historical/sports/baseball_mlb/events/${event.id}/odds`,
  );
  oddsUrl.searchParams.set('apiKey', apiKey);
  oddsUrl.searchParams.set('date', requestedAt);
  oddsUrl.searchParams.set('regions', 'us');
  oddsUrl.searchParams.set('markets', 'team_totals');
  oddsUrl.searchParams.set('dateFormat', 'iso');
  oddsUrl.searchParams.set('oddsFormat', 'american');
  const snapshot = await fetchJson(oddsUrl, `historical team totals ${event.id}`);
  const payload = snapshot.body?.data ?? snapshot.body;
  const books = Array.isArray(payload?.bookmakers) ? payload.bookmakers : [];
  const teamTotalBooks = books.filter((bookmaker) =>
    Array.isArray(bookmaker?.markets) &&
    bookmaker.markets.some((market) => market?.key === 'team_totals'),
  );
  if (teamTotalBooks.length === 0) continue;
  selected = event;
  oddsSnapshot = snapshot;
  break;
}
if (!selected || !oddsSnapshot) {
  throw new Error('Historical MLB event odds returned no verified team_totals market for the probed pregame snapshot.');
}

const payload = oddsSnapshot.body?.data ?? oddsSnapshot.body;
const normalizedBooks = payload.bookmakers
  .filter((bookmaker) =>
    Array.isArray(bookmaker?.markets) &&
    bookmaker.markets.some((market) => market?.key === 'team_totals'),
  )
  .map((bookmaker) => ({
    key: bookmaker.key,
    title: bookmaker.title,
    markets: bookmaker.markets
      .filter((market) => market?.key === 'team_totals')
      .map((market) => ({
        key: market.key,
        lastUpdate: market.last_update,
        outcomes: Array.isArray(market.outcomes)
          ? market.outcomes.map((outcome) => ({
              name: outcome.name,
              description: outcome.description,
              point: outcome.point,
              price: outcome.price,
            }))
          : [],
      })),
  }));

const teamNames = new Set([selected.home_team, selected.away_team]);
const validOutcomes = normalizedBooks.flatMap((bookmaker) =>
  bookmaker.markets.flatMap((market) => market.outcomes),
);
if (
  validOutcomes.length === 0 ||
  validOutcomes.some((outcome) =>
    (outcome.name !== 'Over' && outcome.name !== 'Under') ||
    !teamNames.has(outcome.description) ||
    typeof outcome.point !== 'number' ||
    !Number.isFinite(outcome.point) ||
    outcome.point < 0 ||
    !Number.isInteger(outcome.price),
  )
) {
  throw new Error('Historical team_totals outcomes did not satisfy the required team-description, point, and price contract.');
}
for (const team of teamNames) {
  const sides = new Set(
    validOutcomes
      .filter((outcome) => outcome.description === team)
      .map((outcome) => outcome.name),
  );
  if (!sides.has('Over') || !sides.has('Under')) {
    throw new Error(`Historical team_totals omitted Over or Under for ${team}.`);
  }
}

const fixture = {
  schemaVersion: 1,
  purpose: 'Verified historical The Odds API team_totals provider contract for M11 HHR conditioning.',
  provider: 'The Odds API',
  sport: 'baseball_mlb',
  requestedAt,
  returnedAt: oddsSnapshot.body?.timestamp ?? null,
  event: {
    id: selected.id,
    commenceTime: selected.commence_time,
    homeTeam: selected.home_team,
    awayTeam: selected.away_team,
  },
  request: {
    endpoint: '/v4/historical/sports/baseball_mlb/events/{eventId}/odds',
    region: 'us',
    market: 'team_totals',
    dateFormat: 'iso',
    oddsFormat: 'american',
  },
  sourceEvidence: {
    historicalEventsRawBodySha256: eventsSnapshot.rawBodySha256,
    historicalEventOddsRawBodySha256: oddsSnapshot.rawBodySha256,
  },
  responseContract: {
    marketKey: 'team_totals',
    teamIdentityField: 'outcome.description',
    postedTeamRunTotalField: 'outcome.point',
    selectedSideField: 'outcome.name',
    priceField: 'outcome.price',
  },
  bookmakers: normalizedBooks,
};
await mkdir(path.dirname(outputPath), { recursive: true });
await writeFile(outputPath, `${JSON.stringify(fixture, null, 2)}\n`);
console.log('=== M11 HISTORICAL TEAM TOTALS PROBE ===');
console.log(`EVENT: ${selected.id}`);
console.log(`MATCHUP: ${selected.away_team} at ${selected.home_team}`);
console.log(`COMMENCE: ${selected.commence_time}`);
console.log(`BOOKMAKERS: ${normalizedBooks.length}`);
console.log(`OUTCOMES: ${validOutcomes.length}`);
console.log('MARKET: team_totals');
console.log('TEAM IDENTITY: outcome.description');
console.log('POSTED TEAM RUN TOTAL: outcome.point');
console.log(`REQUEST COST: ${oddsSnapshot.requestCost ?? 'unknown'}`);
console.log(`REQUESTS REMAINING: ${oddsSnapshot.requestsRemaining ?? 'unknown'}`);
console.log('SECRETS PRESERVED: true');
console.log('=== END M11 HISTORICAL TEAM TOTALS PROBE ===');
