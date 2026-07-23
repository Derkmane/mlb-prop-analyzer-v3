const TARGET_ODDS_MARKETS = Object.freeze([
  'batter_hits',
  'batter_hits_alternate',
]);

export { TARGET_ODDS_MARKETS };

export function previousUtcDate(date) {
  const value = new Date(date);
  if (Number.isNaN(value.getTime())) {
    throw new TypeError('previousUtcDate requires a valid date.');
  }

  value.setUTCDate(value.getUTCDate() - 1);
  return value.toISOString().slice(0, 10);
}

export function activeUtcSeason(date) {
  const value = new Date(date);
  if (Number.isNaN(value.getTime())) {
    throw new TypeError('activeUtcSeason requires a valid date.');
  }
  return value.getUTCFullYear();
}

export function selectPregameEvents(body, capturedAt) {
  if (!Array.isArray(body)) {
    return [];
  }

  const capturedAtMs = new Date(capturedAt).getTime();
  if (!Number.isFinite(capturedAtMs)) {
    throw new TypeError('selectPregameEvents requires a valid capture time.');
  }

  return body
    .filter((event) => event !== null && typeof event === 'object')
    .filter((event) => typeof event.id === 'string' && event.id.length > 0)
    .filter((event) => {
      const commenceTimeMs = Date.parse(event.commence_time);
      return Number.isFinite(commenceTimeMs) && commenceTimeMs > capturedAtMs;
    })
    .sort(
      (left, right) =>
        Date.parse(left.commence_time) - Date.parse(right.commence_time),
    );
}

export function extractBookmakerMarketKeys(body, bookmakerKey) {
  const bookmakers =
    body !== null && typeof body === 'object' && Array.isArray(body.bookmakers)
      ? body.bookmakers
      : [];

  const bookmaker = bookmakers.find(
    (candidate) =>
      candidate !== null &&
      typeof candidate === 'object' &&
      candidate.key === bookmakerKey,
  );

  if (!bookmaker || !Array.isArray(bookmaker.markets)) {
    return [];
  }

  return [
    ...new Set(
      bookmaker.markets
        .map((market) =>
          market !== null && typeof market === 'object' ? market.key : null,
        )
        .filter((key) => typeof key === 'string' && key.length > 0),
    ),
  ].sort();
}

export function observedTargetMarkets(marketKeys) {
  const observed = new Set(Array.isArray(marketKeys) ? marketKeys : []);
  return TARGET_ODDS_MARKETS.filter((marketKey) => observed.has(marketKey));
}

export function summarizeBdlGames(body) {
  const games =
    body !== null && typeof body === 'object' && Array.isArray(body.data)
      ? body.data
      : [];

  return games
    .filter((game) => game !== null && typeof game === 'object')
    .map((game) => ({
      id: Number.isInteger(game.id) ? game.id : null,
      status: typeof game.status === 'string' ? game.status : null,
      date: typeof game.date === 'string' ? game.date : null,
      datetime: typeof game.datetime === 'string' ? game.datetime : null,
      homeTeamName:
        typeof game.home_team_name === 'string' ? game.home_team_name : null,
      awayTeamName:
        typeof game.away_team_name === 'string' ? game.away_team_name : null,
    }));
}

export function parseOptionalPositiveInteger(value, name) {
  if (value === undefined || value === null || String(value).trim() === '') {
    return null;
  }

  const parsed = Number.parseInt(String(value), 10);
  if (!Number.isSafeInteger(parsed) || parsed <= 0 || String(parsed) !== String(value).trim()) {
    throw new Error(`${name} must be a positive integer when provided.`);
  }

  return parsed;
}

export function parseNonNegativeInteger(value, name, defaultValue) {
  if (value === undefined || value === null || String(value).trim() === '') {
    return defaultValue;
  }

  const parsed = Number.parseInt(String(value), 10);
  if (!Number.isSafeInteger(parsed) || parsed < 0 || String(parsed) !== String(value).trim()) {
    throw new Error(`${name} must be a non-negative integer when provided.`);
  }

  return parsed;
}

export function sanitizeFileSegment(value) {
  return String(value).replaceAll(/[^A-Za-z0-9._-]/g, '-');
}
