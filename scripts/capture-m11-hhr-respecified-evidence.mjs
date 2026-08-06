import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

import { recoverM8ActualStarterFromOrderedPitcherAppearances } from './m8-starter-bullpen-transition-utils.mjs';

const oddsKey = process.env.THE_ODDS_API_KEY?.trim();
const bdlKey = process.env.BALLDONTLIE_API_KEY?.trim();
if (!oddsKey) throw new Error('Missing THE_ODDS_API_KEY.');
if (!bdlKey) throw new Error('Missing BALLDONTLIE_API_KEY.');

const FROZEN_HISTORY_START_DATE = '2026-03-26';
const FROZEN_HISTORY_END_DATE = '2026-07-05';
const FIT_START_DATE = '2026-07-06';
const FIT_SCAN_END_DATE = '2026-08-05';
const ATTEMPT_1_ROW_COUNT = 783;
function enumerateIsoDates(startDate, endDate) {
  const dates = [];
  for (let value = Date.parse(`${startDate}T00:00:00Z`); value <= Date.parse(`${endDate}T00:00:00Z`); value += 86_400_000) {
    dates.push(new Date(value).toISOString().slice(0, 10));
  }
  return Object.freeze(dates);
}
const FIT_SCAN_DATES = enumerateIsoDates(FIT_START_DATE, FIT_SCAN_END_DATE);
let FIT_DATES = Object.freeze([]);
const OUTPUT_DIRECTORY = path.resolve('fixtures/sanitized/m11/hhr/respecified-v2');
const DESIGN_PATH = path.join(OUTPUT_DIRECTORY, 'balldontlie-hhr-design-matrix-v2.json');
const BOARD_PATH = path.join(OUTPUT_DIRECTORY, 'the-odds-api-underdog-hhr-board-v2.json');
const sha256 = (value) => createHash('sha256').update(value).digest('hex');
const sleep = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));
const TERMINAL_CATEGORIES = Object.freeze([
  'K','UBB','IBB','HBP','1B','2B','3B','HR','ROE','FC','SF','SH','BIP_OUT','CATCHER_INTERFERENCE',
]);
const HIT_CATEGORIES = new Set(['1B','2B','3B','HR']);
const ON_BASE_CATEGORIES = new Set(['UBB','IBB','HBP','1B','2B','3B','HR','ROE','FC','CATCHER_INTERFERENCE']);

async function readJson(relativePath) {
  const text = await readFile(path.resolve(relativePath), 'utf8');
  return { value: JSON.parse(text), text, sha256: sha256(text) };
}

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
    return { body: JSON.parse(text), rawBodySha256: sha256(text) };
  }
  throw new Error(`${label} exhausted retries.`);
}
fetchSnapshot.lastBdlAt = 0;

function chunks(values, size) {
  const result = [];
  for (let index = 0; index < values.length; index += size) result.push(values.slice(index, index + size));
  return result;
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
      headers: { Authorization: bdlKey }, bdl: true,
    });
    if (!Array.isArray(snapshot.body?.data)) throw new Error(`${endpoint} response data must be an array.`);
    pages.push(snapshot);
    const next = snapshot.body?.meta?.next_cursor ?? null;
    if (next === null || next === undefined) break;
    if (seen.has(String(next))) throw new Error(`${endpoint} repeated cursor ${next}.`);
    seen.add(String(next));
    cursor = next;
  } while (true);
  return pages;
}

async function fetchBdlGamePlateAppearances(gameId) {
  const url = new URL('https://api.balldontlie.io/mlb/v1/plate_appearances');
  url.searchParams.set('game_id', String(gameId));
  const snapshot = await fetchSnapshot(url, `plate appearances game ${gameId}`, {
    headers: { Authorization: bdlKey }, bdl: true,
  });
  if (!Array.isArray(snapshot.body?.data)) {
    throw new Error(`plate appearances game ${gameId} response data must be an array.`);
  }
  return snapshot;
}

function normalizeVector(raw, label) {
  const values = TERMINAL_CATEGORIES.map((category) => Number(raw?.[category]));
  if (values.some((value) => !Number.isFinite(value) || value <= 0)) throw new Error(`${label} has invalid positive mass.`);
  const total = values.reduce((sum, value) => sum + value, 0);
  return Object.freeze(Object.fromEntries(TERMINAL_CATEGORIES.map((category, index) => [category, values[index] / total])));
}

function stableSoftmax(scores) {
  const maximum = Math.max(...TERMINAL_CATEGORIES.map((category) => scores[category]));
  return normalizeVector(Object.fromEntries(TERMINAL_CATEGORIES.map((category) => [category, Math.exp(scores[category] - maximum)])), 'softmax vector');
}

function vectorMass(vector, categories) {
  return TERMINAL_CATEGORIES.reduce((sum, category) => sum + (categories.has(category) ? vector[category] : 0), 0);
}

function logit(value) {
  const p = Math.min(1 - 1e-12, Math.max(1e-12, value));
  return Math.log(p / (1 - p));
}

function declaredHand(raw) {
  const hand = typeof raw === 'string' ? raw.split('/')[0] : null;
  return hand === 'L' || hand === 'R' || hand === 'B' ? hand : null;
}

function throwingHand(raw) {
  const hand = typeof raw === 'string' ? raw.split('/')[1] : null;
  return hand === 'L' || hand === 'R' ? hand : null;
}

function resolvedBatterHand(declared, pitcherHand) {
  if (declared === 'B') return pitcherHand === 'R' ? 'L' : 'R';
  return declared;
}

function playerAdjustedTarget(overall, leagueMatchup, leagueTarget) {
  return normalizeVector(Object.fromEntries(TERMINAL_CATEGORIES.map((category) => [
    category, overall[category] * leagueMatchup[category] / leagueTarget[category],
  ])), 'player platoon target');
}

function platoonBatterVector(terminal, batterId, declared, batterSide, pitcherHand) {
  const overall = terminal.batterOverall[String(batterId)] ?? terminal.unseenBatter;
  if (declared === 'B' || terminal.selectedPlatoonCandidate.platoonCoefficient === 0) return overall;
  const matchup = `${batterSide}-vs-${pitcherHand}`;
  const leagueMatchup = terminal.leaguePlatoonByMatchup[matchup];
  if (!leagueMatchup) throw new Error(`missing league platoon ${matchup}`);
  const split = terminal.batterSplitByMatchup[`${batterId}|${matchup}`] ??
    playerAdjustedTarget(overall, leagueMatchup, terminal.leagueTarget);
  const coefficient = terminal.selectedPlatoonCandidate.platoonCoefficient;
  return stableSoftmax(Object.fromEntries(TERMINAL_CATEGORIES.map((category) => [
    category,
    Math.log(overall[category]) + coefficient * (Math.log(split[category]) - Math.log(overall[category])),
  ])));
}

function coherentVector(terminal, batterVector, pitcherVector) {
  return stableSoftmax(Object.fromEntries(TERMINAL_CATEGORIES.map((category) => {
    const leagueLog = Math.log(terminal.leagueTarget[category]);
    return [category, leagueLog +
      terminal.baseParameters.batterCoefficient * (Math.log(batterVector[category]) - leagueLog) +
      terminal.baseParameters.pitcherAllowedCoefficient * (Math.log(pitcherVector[category]) - leagueLog)];
  })));
}

function parkMultiplierMap(parkArtifact) {
  const effects = parkArtifact.typedFactorArtifact?.effects;
  const identities = parkArtifact.effectIdentities;
  if (!Array.isArray(effects) || !Array.isArray(identities)) throw new Error('park artifact identity contract is missing.');
  const result = new Map();
  for (const identity of identities) {
    const effect = effects[identity.effectIndex];
    if (!effect || effect.kind !== 'park-transformation' || effect.batterHand !== identity.batterHand) {
      throw new Error('park effect identity drift.');
    }
    result.set(`${identity.venue}\u0000${identity.batterHand}`, Object.freeze(Object.fromEntries(
      effect.relativeRateMultipliers
        .filter((entry) => TERMINAL_CATEGORIES.includes(entry.category))
        .map((entry) => [entry.category, entry.multiplier]),
    )));
  }
  return result;
}

function applyPark(vector, multipliers) {
  if (!multipliers || TERMINAL_CATEGORIES.some((category) => !Number.isFinite(multipliers[category]) || multipliers[category] <= 0)) {
    throw new Error('missing or invalid exact park multipliers.');
  }
  return normalizeVector(Object.fromEntries(TERMINAL_CATEGORIES.map((category) => [category, vector[category] * multipliers[category]])), 'park transformed vector');
}

function teamBullpenMap(artifact) {
  const result = new Map();
  if (!Array.isArray(artifact.effects)) throw new Error('team bullpen artifact effects are missing.');
  for (const effect of artifact.effects) {
    if (effect.kind !== 'terminal-outcome-vector' || effect.scope !== 'bullpen') continue;
    result.set(effect.matchupKey, normalizeVector(Object.fromEntries(
      effect.categoryProbabilities
        .filter((entry) => TERMINAL_CATEGORIES.includes(entry.category))
        .map((entry) => [entry.category, entry.probability]),
    ), `team bullpen ${effect.matchupKey}`));
  }
  return result;
}

function erf(value) {
  const sign = value < 0 ? -1 : 1;
  const x = Math.abs(value);
  const t = 1 / (1 + 0.3275911 * x);
  const polynomial = (((((1.061405429 * t - 1.453152027) * t + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t);
  return sign * (1 - polynomial * Math.exp(-x * x));
}
const normalCdf = (value) => 0.5 * (1 + erf(value / Math.sqrt(2)));

function discreteNormalPmf(mean, sigma, maximum = 80) {
  const values = Array(maximum + 1).fill(0);
  for (let count = 0; count < maximum; count += 1) {
    values[count] = Math.max(0, normalCdf((count + 0.5 - mean) / sigma) - normalCdf((count - 0.5 - mean) / sigma));
  }
  values[maximum] = Math.max(0, 1 - normalCdf((maximum - 0.5 - mean) / sigma));
  const total = values.reduce((sum, value) => sum + value, 0);
  return values.map((value) => value / total);
}

function lineupSlotSurvival(teamPaPmf, slot, turnMaximum) {
  const result = [];
  for (let turn = 1; turn <= turnMaximum; turn += 1) {
    const required = slot + 9 * (turn - 1);
    result.push(teamPaPmf.slice(required).reduce((sum, value) => sum + value, 0));
  }
  return result;
}

function starterSurvival(starterBfPmf, requiredTeamPaIndex) {
  return starterBfPmf.slice(requiredTeamPaIndex).reduce((sum, value) => sum + value, 0);
}

function opportunityContext(shared, retentionArtifact, teamSide, slot) {
  const retention = retentionArtifact.conditionalRetentionByGroup[`slot:${slot}`];
  if (!Array.isArray(retention) || retention.length === 0) throw new Error(`missing retention slot ${slot}`);
  const starterBf = shared.starterBullpenTransition.bySide[teamSide];
  let expectedPa = 0;
  let expectedStarterPa = 0;
  for (const scenario of shared.scenarios) {
    const state = scenario[teamSide];
    const survival = lineupSlotSurvival(discreteNormalPmf(state.meanPa, state.sigmaPa), slot, retention.length);
    for (let turnIndex = 0; turnIndex < survival.length; turnIndex += 1) {
      const occurrence = scenario.weight * survival[turnIndex] * retention[turnIndex];
      const requiredTeamPaIndex = slot + 9 * turnIndex;
      expectedPa += occurrence;
      expectedStarterPa += occurrence * starterSurvival(starterBf, requiredTeamPaIndex);
    }
  }
  if (!(expectedPa > 0) || !Number.isFinite(expectedStarterPa)) throw new Error('invalid M8 paSurvival expectation.');
  return Object.freeze({ expectedPlateAppearances: expectedPa, starterExposureShare: expectedStarterPa / expectedPa });
}

function median(values) {
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[middle - 1] + sorted[middle]) / 2 : sorted[middle];
}

function diagnosticSummary(values) {
  if (values.length === 0) {
    return Object.freeze({
      count: 0, min: null, max: null, mean: null, standardDeviation: null,
      p10: null, p50: null, p90: null,
    });
  }
  const sorted = [...values].sort((left, right) => left - right);
  const average = values.reduce((sum, value) => sum + value, 0) / values.length;
  const standardDeviation = values.length === 1
    ? 0
    : Math.sqrt(values.reduce((sum, value) => sum + (value - average) ** 2, 0) / (values.length - 1));
  const quantile = (probability) => {
    const index = (sorted.length - 1) * probability;
    const lower = Math.floor(index);
    const upper = Math.ceil(index);
    return lower === upper
      ? sorted[lower]
      : sorted[lower] + (sorted[upper] - sorted[lower]) * (index - lower);
  };
  return Object.freeze({
    count: values.length, min: sorted[0], max: sorted.at(-1), mean: average, standardDeviation,
    p10: quantile(0.10), p50: quantile(0.50), p90: quantile(0.90),
  });
}

async function historicalEvent(game) {
  const snapshotTime = new Date(Date.parse(game.commenceTime) - 60 * 60 * 1000)
    .toISOString()
    .replace(/\.\d{3}Z$/u, 'Z');
  const eventsUrl = new URL('https://api.the-odds-api.com/v4/historical/sports/baseball_mlb/events');
  eventsUrl.searchParams.set('apiKey', oddsKey);
  eventsUrl.searchParams.set('date', snapshotTime);
  eventsUrl.searchParams.set('dateFormat', 'iso');
  const eventsSnapshot = await fetchSnapshot(eventsUrl, `historical events ${game.gameId}`);
  const events = eventsSnapshot.body?.data ?? eventsSnapshot.body;
  if (!Array.isArray(events)) throw new Error('historical events data must be an array.');
  const matches = events.filter((event) =>
    event?.home_team === game.homeTeamName &&
    event?.away_team === game.awayTeamName &&
    Number.isFinite(Date.parse(event?.commence_time)) &&
    Math.abs(Date.parse(event.commence_time) - Date.parse(game.commenceTime)) <= 6 * 60 * 60 * 1000,
  );
  if (matches.length !== 1) return null;
  return { event: matches[0], snapshotTime, eventsSnapshotSha256: eventsSnapshot.rawBodySha256 };
}

async function historicalTeamTotals(game, eventEvidence) {
  const url = new URL(`https://api.the-odds-api.com/v4/historical/sports/baseball_mlb/events/${eventEvidence.event.id}/odds`);
  url.searchParams.set('apiKey', oddsKey);
  url.searchParams.set('date', eventEvidence.snapshotTime);
  url.searchParams.set('regions', 'us');
  url.searchParams.set('markets', 'team_totals');
  url.searchParams.set('dateFormat', 'iso');
  url.searchParams.set('oddsFormat', 'american');
  const snapshot = await fetchSnapshot(url, `historical team totals ${game.gameId}`);
  const payload = snapshot.body?.data ?? snapshot.body;
  const books = Array.isArray(payload?.bookmakers) ? payload.bookmakers : [];
  const byTeam = new Map();
  for (const teamName of [game.homeTeamName, game.awayTeamName]) {
    const points = [];
    for (const book of books) {
      const market = Array.isArray(book?.markets) ? book.markets.find((entry) => entry?.key === 'team_totals') : null;
      if (!market || !Array.isArray(market.outcomes)) continue;
      const teamOutcomes = market.outcomes.filter((outcome) => outcome?.description === teamName);
      const over = teamOutcomes.find((outcome) => outcome?.name === 'Over');
      const under = teamOutcomes.find((outcome) => outcome?.name === 'Under');
      if (!over || !under || !Number.isFinite(over.point) || over.point !== under.point) continue;
      points.push(over.point);
    }
    if (points.length > 0) byTeam.set(teamName, median(points));
  }
  if (byTeam.size !== 2) return null;
  return {
    byTeam,
    source: {
      eventId: eventEvidence.event.id,
      requestedAt: eventEvidence.snapshotTime,
      returnedAt: snapshot.body?.timestamp ?? null,
      eventsSnapshotSha256: eventEvidence.eventsSnapshotSha256,
      oddsSnapshotSha256: snapshot.rawBodySha256,
      bookmakerCount: books.length,
      normalization: 'median verified same-book Over/Under point by exact team description',
    },
  };
}

async function captureHistoricalHhrBoard(game, eventEvidence) {
  const url = new URL(`https://api.the-odds-api.com/v4/historical/sports/baseball_mlb/events/${eventEvidence.event.id}/odds`);
  url.searchParams.set('apiKey', oddsKey);
  url.searchParams.set('date', eventEvidence.snapshotTime);
  url.searchParams.set('bookmakers', 'underdog');
  url.searchParams.set('regions', 'us_dfs');
  url.searchParams.set('markets', 'batter_hits_runs_rbis,batter_hits_runs_rbis_alternate');
  url.searchParams.set('dateFormat', 'iso');
  url.searchParams.set('oddsFormat', 'american');
  url.searchParams.set('includeMultipliers', 'true');
  url.searchParams.set('includeSids', 'true');
  const snapshot = await fetchSnapshot(url, `historical HHR board ${game.gameId}`);
  const response = snapshot.body?.data ?? snapshot.body;
  const underdog = Array.isArray(response?.bookmakers) ? response.bookmakers.find((row) => row?.key === 'underdog') : null;
  const keys = new Set(Array.isArray(underdog?.markets) ? underdog.markets.map((market) => market.key) : []);
  if (!keys.has('batter_hits_runs_rbis') || !keys.has('batter_hits_runs_rbis_alternate')) return null;
  return {
    captureVersion: 1,
    capturedAt: eventEvidence.snapshotTime,
    captureMode: 'historical-pregame',
    request: {
      provider: 'The Odds API', bookmaker: 'underdog', region: 'us_dfs',
      marketKeys: ['batter_hits_runs_rbis','batter_hits_runs_rbis_alternate'],
      dateFormat: 'iso', oddsFormat: 'american', includeMultipliers: true, includeSids: true,
    },
    sourceSnapshotSha256: snapshot.rawBodySha256,
    response,
  };
}

const [terminalFile, sharedFile, retentionFile, completeFile, parkFile, bullpenFile] = await Promise.all([
  readJson('model-artifacts/m8-terminal-pa-outcome-v1.json'),
  readJson('model-artifacts/m8-shared-offensive-environment-v2.json'),
  readJson('model-artifacts/m8-starter-retention-v1.json'),
  readJson('model-artifacts/m8-batter-hits-complete-candidate-v1.json'),
  readJson('model-artifacts/m8-5-park-transformation-v1.json'),
  readJson('model-artifacts/m8-5-team-bullpen-outcome-v1.json'),
]);
const terminal = terminalFile.value;
const shared = sharedFile.value;
const retention = retentionFile.value;
const complete = completeFile.value;
const parkByVenueHand = parkMultiplierMap(parkFile.value);
const bullpenByTeamHand = teamBullpenMap(bullpenFile.value);
if (JSON.stringify(terminal.categories) !== JSON.stringify(TERMINAL_CATEGORIES)) throw new Error('M8 terminal categories drifted.');

const rawGameRows = [];
const gameSourceSnapshots = [];
for (const date of FIT_SCAN_DATES) {
  const gamesUrl = new URL('https://api.balldontlie.io/mlb/v1/games');
  gamesUrl.searchParams.append('dates[]', date);
  gamesUrl.searchParams.set('season_type', 'regular');
  gamesUrl.searchParams.set('per_page', '100');
  const snapshot = await fetchSnapshot(gamesUrl, `BDL HHR attempt 2 games ${date}`, {
    headers: { Authorization: bdlKey }, bdl: true,
  });
  if (!Array.isArray(snapshot.body?.data)) throw new Error(`BDL games ${date} data must be an array.`);
  rawGameRows.push(...snapshot.body.data);
  gameSourceSnapshots.push({ endpoint: 'games', dates: [date], rawBodySha256: snapshot.rawBodySha256 });
}
const rawGamesByDate = new Map();
for (const game of rawGameRows) {
  const date = String(game?.date ?? '').slice(0, 10);
  if (!FIT_SCAN_DATES.includes(date)) continue;
  const dateRows = rawGamesByDate.get(date) ?? [];
  dateRows.push(game);
  rawGamesByDate.set(date, dateRows);
}
const completeDates = [...rawGamesByDate.entries()]
  .filter(([, dateRows]) => dateRows.length > 0 && dateRows.every((game) => game?.status === 'STATUS_FINAL'))
  .map(([date]) => date)
  .sort();
const latestCompleteDate = completeDates.at(-1);
if (!latestCompleteDate || latestCompleteDate < FIT_START_DATE) {
  throw new Error('No complete HHR fitted date exists after the frozen pitcherAllowed range.');
}
FIT_DATES = Object.freeze(FIT_SCAN_DATES.filter((date) => date <= latestCompleteDate));
const lookaheadOverlap = FIT_DATES.some((date) => date <= FROZEN_HISTORY_END_DATE);
if (lookaheadOverlap) throw new Error('HHR attempt 2 lookahead overlap detected before fitting.');
const games = rawGameRows
  .filter((game) => game?.status === 'STATUS_FINAL' && FIT_DATES.includes(String(game.date).slice(0, 10)))
  .map((game) => ({
    gameId: game.id,
    date: String(game.date).slice(0, 10),
    commenceTime: game.date,
    venue: game.venue,
    homeTeamId: game.home_team?.id,
    awayTeamId: game.away_team?.id,
    homeTeamName: game.home_team?.display_name ?? game.home_team_name,
    awayTeamName: game.away_team?.display_name ?? game.away_team_name,
  }))
  .filter((game) => Number.isInteger(game.gameId))
  .sort((left, right) => left.date.localeCompare(right.date) || left.gameId - right.gameId);
if (games.length < 20) throw new Error(`HHR capture requires at least 20 final games; received ${games.length}.`);

const stats = [];
const lineups = [];
const sourceSnapshots = [...gameSourceSnapshots];
for (const batch of chunks(games.map((game) => game.gameId), 10)) {
  const statsPages = await fetchBdlCursor('stats', batch);
  const lineupPages = await fetchBdlCursor('lineups', batch);
  stats.push(...statsPages.flatMap((page) => page.body.data));
  lineups.push(...lineupPages.flatMap((page) => page.body.data));
  sourceSnapshots.push(
    ...statsPages.map((page) => ({ endpoint: 'stats', gameIds: batch, rawBodySha256: page.rawBodySha256 })),
    ...lineupPages.map((page) => ({ endpoint: 'lineups', gameIds: batch, rawBodySha256: page.rawBodySha256 })),
  );
}

const gameById = new Map(games.map((game) => [game.gameId, game]));
const hittersByGameTeam = new Map();
const teamByGamePlayer = new Map();
for (const row of lineups) {
  const gameId = row?.game_id;
  const playerId = row?.player?.id;
  const teamId = row?.team?.id;
  if (!Number.isInteger(gameId) || !Number.isInteger(playerId) || !Number.isInteger(teamId)) continue;
  teamByGamePlayer.set(`${gameId}:${playerId}`, teamId);
  if (!Number.isInteger(row?.batting_order) || row.batting_order < 1 || row.batting_order > 9) continue;
  const key = `${gameId}:${teamId}`;
  const teamRows = hittersByGameTeam.get(key) ?? new Map();
  teamRows.set(row.batting_order, {
    playerId, lineupSlot: row.batting_order, declaredHand: declaredHand(row.player?.bats_throws),
    rawBatsThrows: row.player?.bats_throws,
  });
  hittersByGameTeam.set(key, teamRows);
}

const starterByGameTeam = new Map();
const starterRecoveryExclusionByGameTeam = new Map();
for (const game of games.filter((row) => FIT_DATES.includes(row.date))) {
  const snapshot = await fetchBdlGamePlateAppearances(game.gameId);
  sourceSnapshots.push({
    endpoint: 'plate_appearances',
    gameIds: [game.gameId],
    rawBodySha256: snapshot.rawBodySha256,
  });
  const sides = [
    { halfInning: 'top', pitchingTeamId: game.homeTeamId },
    { halfInning: 'bottom', pitchingTeamId: game.awayTeamId },
  ];
  for (const side of sides) {
    const orderedAppearances = snapshot.body.data
      .filter((row) => String(row?.half_inning ?? '').trim().toLowerCase() === side.halfInning)
      .map((row) => ({
        providerPaNumber: row?.pa_number,
        providerPitcherId: row?.pitcher_id,
        normalizedPitcherHand: row?.pitcher_hand,
      }));
    const key = `${game.gameId}:${side.pitchingTeamId}`;
    const recovered = recoverM8ActualStarterFromOrderedPitcherAppearances(orderedAppearances);
    if (recovered.starter === null) {
      starterRecoveryExclusionByGameTeam.set(key, recovered.exclusion);
      continue;
    }
    starterByGameTeam.set(key, {
      playerId: recovered.starter.providerPitcherId,
      hand: recovered.starter.normalizedPitcherHand,
      recovery: {
        mechanism: 'shared-m8-pa-order-import',
        starterBattersFaced: recovered.starter.starterBattersFaced,
        bullpenBattersFaced: recovered.starter.bullpenBattersFaced,
        totalBattersFaced: recovered.starter.totalBattersFaced,
      },
    });
  }
}

const totalsByGame = new Map();
const teamTotalDiagnosticsByGame = new Map();
let boardFixture = null;
for (const game of games) {
  const event = await historicalEvent(game);
  if (!event) {
    teamTotalDiagnosticsByGame.set(game.gameId, Object.freeze({
      reason: 'historical-event-not-unique-or-missing',
      gameId: game.gameId,
      date: game.date,
      homeTeamName: game.homeTeamName,
      awayTeamName: game.awayTeamName,
    }));
    continue;
  }
  const totals = await historicalTeamTotals(game, event);
  if (totals) {
    totalsByGame.set(game.gameId, totals);
  } else {
    teamTotalDiagnosticsByGame.set(game.gameId, Object.freeze({
      reason: 'historical-team-totals-did-not-expose-both-exact-team-points',
      gameId: game.gameId,
      date: game.date,
      eventId: event.event.id,
      requestedAt: event.snapshotTime,
      homeTeamName: game.homeTeamName,
      awayTeamName: game.awayTeamName,
    }));
  }
  if (!boardFixture) boardFixture = await captureHistoricalHhrBoard(game, event);
}
if (!boardFixture) throw new Error('No historical pregame Underdog event exposed both HHR baseline and alternate markets.');

const exclusionCounts = Object.fromEntries([
  'warmup_history_only','missing_game','missing_player_identity','missing_team_identity','invalid_box_score',
  'missing_lineup_slot','missing_opposing_starter','starter_reappeared_after_bullpen',
  'starter_absent_from_pitcher_allowed','invalid_handedness','missing_park_effect','missing_team_bullpen',
  'missing_team_total','missing_preceding_lineup','duplicate_player_game','invalid_m8_conditioning',
].map((key) => [key, 0]));
const EXAMPLE_RULES = Object.freeze(['invalid_box_score','missing_lineup_slot','missing_team_total']);
const exclusionExamples = Object.fromEntries(EXAMPLE_RULES.map((key) => [key, []]));
const rows = [];
const seen = new Set();
function exclude(rule, example = null) {
  exclusionCounts[rule] += 1;
  if (example !== null && EXAMPLE_RULES.includes(rule) && exclusionExamples[rule].length < 3) {
    exclusionExamples[rule].push(Object.freeze(example));
  }
}

for (const stat of stats) {
  const game = gameById.get(stat?.game_id);
  if (!game) { exclude('missing_game'); continue; }
  const playerId = stat?.player?.id;
  if (!Number.isInteger(playerId)) { exclude('missing_player_identity'); continue; }
  const providerTeamId = stat?.team?.id;
  const lineupTeamId = teamByGamePlayer.get(`${game.gameId}:${playerId}`);
  const statTeamName = typeof stat?.team_name === 'string' ? stat.team_name.trim() : null;
  const namedTeamId = statTeamName === game.homeTeamName
    ? game.homeTeamId
    : statTeamName === game.awayTeamName
      ? game.awayTeamId
      : null;
  const teamId = Number.isInteger(providerTeamId)
    ? providerTeamId
    : Number.isInteger(lineupTeamId)
      ? lineupTeamId
      : namedTeamId;
  if (!Number.isInteger(teamId) || (teamId !== game.homeTeamId && teamId !== game.awayTeamId)) { exclude('missing_team_identity'); continue; }
  const rawBoxScore = {
    hits: stat?.hits,
    runs: stat?.runs,
    rbi: stat?.rbi,
    plateAppearances: stat?.plate_appearances,
  };
  const hits = Number(rawBoxScore.hits), runs = Number(rawBoxScore.runs), rbi = Number(rawBoxScore.rbi), pa = Number(rawBoxScore.plateAppearances);
  const invalidBoxReasons = [];
  if (!Number.isInteger(hits) || hits < 0) invalidBoxReasons.push('hits-not-nonnegative-integer');
  if (!Number.isInteger(runs) || runs < 0) invalidBoxReasons.push('runs-not-nonnegative-integer');
  if (!Number.isInteger(rbi) || rbi < 0) invalidBoxReasons.push('rbi-not-nonnegative-integer');
  if (!Number.isInteger(pa) || pa <= 0) invalidBoxReasons.push('plate-appearances-not-positive-integer');
  if (invalidBoxReasons.length > 0) {
    exclude('invalid_box_score', {
      date: game.date,
      gameId: game.gameId,
      playerId,
      playerName: stat?.player?.full_name ?? null,
      teamId,
      rawBoxScore: Object.fromEntries(Object.entries(rawBoxScore).map(([key, value]) => [key, { value: value ?? null, type: value === null ? 'null' : typeof value }])),
      parsedBoxScore: { hits, runs, rbi, plateAppearances: pa },
      reasons: invalidBoxReasons,
    });
    continue;
  }
  const identity = `${game.gameId}:${playerId}`;
  if (seen.has(identity)) { exclude('duplicate_player_game'); continue; }
  seen.add(identity);
  const teamRows = hittersByGameTeam.get(`${game.gameId}:${teamId}`);
  const hitter = teamRows ? [...teamRows.values()].find((row) => row.playerId === playerId) : null;
  if (!hitter) {
    exclude('missing_lineup_slot', {
      date: game.date,
      gameId: game.gameId,
      playerId,
      playerName: stat?.player?.full_name ?? null,
      teamId,
      lineupTeamId: teamByGamePlayer.get(`${game.gameId}:${playerId}`) ?? null,
      availableStartingLineup: teamRows ? [...teamRows.values()].map((row) => ({ playerId: row.playerId, lineupSlot: row.lineupSlot })) : [],
    });
    continue;
  }
  const opposingTeamId = teamId === game.homeTeamId ? game.awayTeamId : game.homeTeamId;
  const starterKey = `${game.gameId}:${opposingTeamId}`;
  const recoveryExclusion = starterRecoveryExclusionByGameTeam.get(starterKey);
  if (recoveryExclusion === 'starter-reappeared-after-bullpen') {
    exclude('starter_reappeared_after_bullpen');
    continue;
  }
  const starter = starterByGameTeam.get(starterKey);
  if (!starter || !Number.isInteger(starter.playerId)) { exclude('missing_opposing_starter'); continue; }
  const frozenStarterAllowed = terminal.pitcherAllowed[String(starter.playerId)];
  if (!frozenStarterAllowed) { exclude('starter_absent_from_pitcher_allowed'); continue; }
  if (!hitter.declaredHand || !starter.hand) { exclude('invalid_handedness'); continue; }
  const batterSide = resolvedBatterHand(hitter.declaredHand, starter.hand);
  const parkHand = batterSide;
  const park = parkByVenueHand.get(`${game.venue}\u0000${parkHand}`);
  if (!park) { exclude('missing_park_effect'); continue; }
  const bullpenL = bullpenByTeamHand.get(`pitching-team:${opposingTeamId}|pitcher-hand:L`);
  const bullpenR = bullpenByTeamHand.get(`pitching-team:${opposingTeamId}|pitcher-hand:R`);
  if (!bullpenL || !bullpenR) { exclude('missing_team_bullpen'); continue; }
  const totals = totalsByGame.get(game.gameId);
  const teamName = teamId === game.homeTeamId ? game.homeTeamName : game.awayTeamName;
  const teamTotal = totals?.byTeam.get(teamName);
  if (!Number.isFinite(teamTotal)) {
    exclude('missing_team_total', {
      date: game.date,
      gameId: game.gameId,
      playerId,
      playerName: stat?.player?.full_name ?? null,
      teamId,
      teamName,
      diagnostic: teamTotalDiagnosticsByGame.get(game.gameId) ?? { reason: 'team-total-map-missing-request-diagnostic' },
    });
    continue;
  }
  const precedingSlots = [1,2,3].map((distance) => ((hitter.lineupSlot - distance - 1 + 9) % 9) + 1);
  const preceding = precedingSlots.map((slot) => teamRows?.get(slot));
  if (preceding.some((row) => !row?.declaredHand)) { exclude('missing_preceding_lineup'); continue; }
  try {
    const overallBatter = terminal.batterOverall[String(playerId)] ?? terminal.unseenBatter;
    const neutralStarter = applyPark(coherentVector(terminal, overallBatter, terminal.unseenPitcher), park);
    const bullpenNeutralL = applyPark(coherentVector(terminal, overallBatter, bullpenL), park);
    const bullpenNeutralR = applyPark(coherentVector(terminal, overallBatter, bullpenR), park);
    const bullpenNeutral = normalizeVector(Object.fromEntries(TERMINAL_CATEGORIES.map((category) => [
      category,
      complete.bullpenModel.handWeights.L * bullpenNeutralL[category] + complete.bullpenModel.handWeights.R * bullpenNeutralR[category],
    ])), 'team bullpen mixed vector');
    const teamSide = teamId === game.homeTeamId ? 'home' : 'away';
    const opportunity = opportunityContext(shared, retention, teamSide, hitter.lineupSlot);
    const contextVector = normalizeVector(Object.fromEntries(TERMINAL_CATEGORIES.map((category) => [
      category,
      opportunity.starterExposureShare * neutralStarter[category] + (1 - opportunity.starterExposureShare) * bullpenNeutral[category],
    ])), 'context adjusted terminal vector');
    const platoonBatter = platoonBatterVector(terminal, playerId, hitter.declaredHand, batterSide, starter.hand);
    const platoonVector = applyPark(coherentVector(terminal, platoonBatter, terminal.unseenPitcher), park);
    const starterVector = applyPark(coherentVector(
      terminal, overallBatter, frozenStarterAllowed,
    ), park);
    const precedingQuality = preceding.reduce((sum, row) => {
      const vector = applyPark(coherentVector(
        terminal, terminal.batterOverall[String(row.playerId)] ?? terminal.unseenBatter, terminal.unseenPitcher,
      ), park);
      return sum + vectorMass(vector, ON_BASE_CATEGORIES);
    }, 0) / preceding.length;
    const contextHit = vectorMass(contextVector, HIT_CATEGORIES);
    rows.push({
      date: game.date, gameId: game.gameId, playerId, teamId, opposingTeamId,
      lineupSlot: hitter.lineupSlot,
      targetT: hits + runs + rbi,
      officialBoxScore: { hits, runs, rbi, plateAppearances: pa },
      conditioningInputs: {
        contextAdjustedTerminalOutcomeVector: contextVector,
        expectedPlateAppearances: opportunity.expectedPlateAppearances,
        lineupSlot: hitter.lineupSlot,
        platoonSplitCell: logit(vectorMass(platoonVector, HIT_CATEGORIES)) - logit(vectorMass(neutralStarter, HIT_CATEGORIES)),
        opposingStarterPooling: logit(vectorMass(starterVector, HIT_CATEGORIES)) - logit(vectorMass(neutralStarter, HIT_CATEGORIES)),
        teamImpliedRunTotal: teamTotal,
        precedingLineupSlotsOnBaseQuality: precedingQuality,
      },
      derivedPredictors: {
        contextHitQualityLogit: logit(contextHit),
        centeredLineupSlot: (hitter.lineupSlot - 5) / 4,
      },
      lineage: {
        declaredBatterHand: hitter.declaredHand, resolvedBatterSide: batterSide,
        opposingStarterPitcherId: starter.playerId, opposingStarterHand: starter.hand,
        venue: game.venue, precedingPlayerIds: preceding.map((row) => row.playerId),
        teamTotalSource: totals.source,
      },
    });
  } catch {
    exclude('invalid_m8_conditioning');
  }
}
rows.sort((left, right) => left.date.localeCompare(right.date) || left.gameId - right.gameId || left.playerId - right.playerId);
const excludedRowCount = Object.values(exclusionCounts).reduce((sum, count) => sum + count, 0);
const predictorSummaries = Object.freeze({
  contextHitQualityLogit: diagnosticSummary(rows.map((row) => row.derivedPredictors.contextHitQualityLogit)),
  centeredLineupSlot: diagnosticSummary(rows.map((row) => row.derivedPredictors.centeredLineupSlot)),
  platoonSplitCell: diagnosticSummary(rows.map((row) => row.conditioningInputs.platoonSplitCell)),
  opposingStarterPooling: diagnosticSummary(rows.map((row) => row.conditioningInputs.opposingStarterPooling)),
  teamImpliedRunTotal: diagnosticSummary(rows.map((row) => row.conditioningInputs.teamImpliedRunTotal)),
  precedingLineupSlotsOnBaseQuality: diagnosticSummary(rows.map((row) => row.conditioningInputs.precedingLineupSlotsOnBaseQuality)),
  expectedPlateAppearances: diagnosticSummary(rows.map((row) => row.conditioningInputs.expectedPlateAppearances)),
});

const fixture = {
  schemaVersion: 3,
  attempt: 2,
  starterRecoveryContract: {
    mechanism: 'extraction-and-import',
    sharedFunction: 'recoverM8ActualStarterFromOrderedPitcherAppearances',
    sharedModule: 'scripts/m8-starter-bullpen-transition-utils.mjs',
    endpoint: 'GET /mlb/v1/plate_appearances?game_id={gameId}',
    orderField: 'pa_number',
    pitcherIdField: 'pitcher_id',
    pitcherHandField: 'pitcher_hand',
    noFallbackVector: true,
  },
  lookaheadAudit: {
    pitcherAllowedDataStartDate: FROZEN_HISTORY_START_DATE,
    pitcherAllowedDataEndDate: FROZEN_HISTORY_END_DATE,
    hhrWarmupStartDate: FROZEN_HISTORY_START_DATE,
    hhrWarmupEndDate: FROZEN_HISTORY_END_DATE,
    hhrFitStartDate: FIT_DATES[0],
    hhrFitEndDate: FIT_DATES.at(-1),
    overlap: lookaheadOverlap,
    fittedRowsOnOrBeforePitcherAllowedEndDate: rows.filter((row) => row.date <= FROZEN_HISTORY_END_DATE).length,
  },
  provider: 'BALLDONTLIE MLB API',
  activeSeason: 2026,
  seasonType: 'regular',
  warmupWindow: {
    startDate: FROZEN_HISTORY_START_DATE,
    endDate: FROZEN_HISTORY_END_DATE,
    fitted: false,
    mechanism: 'frozen M8/M8.5 current-season history artifacts',
  },
  fitWindow: {
    startDate: FIT_DATES[0],
    endDate: FIT_DATES.at(-1),
    scanEndDate: FIT_SCAN_END_DATE,
    latestCompleteDate,
    fittedDateCount: FIT_DATES.length,
  },
  chronology: 'frozen pitcherAllowed history ends 2026-07-05; every fitted row is dated 2026-07-06 or later',
  conditioningInputContract: [
    'context-adjusted-terminal-outcome-vector','expected-plate-appearances','lineup-slot','platoon-split-cell',
    'opposing-starter-pooling','team-implied-run-total','preceding-lineup-slots-on-base-quality',
  ],
  expectedPaRole: 'log offset with fixed coefficient 1',
  gameCount: new Set(rows.map((row) => row.gameId)).size,
  rowCount: rows.length,
  excludedRowCount,
  exclusionCounts,
  exclusionExamples,
  exclusionCountSum: excludedRowCount,
  attempt1RowCount: ATTEMPT_1_ROW_COUNT,
  rowExpansionFactor: rows.length / ATTEMPT_1_ROW_COUNT,
  predictorSummaries,
  sourceArtifacts: {
    terminalOutcome: { path: 'model-artifacts/m8-terminal-pa-outcome-v1.json', fileSha256: terminalFile.sha256, artifactSha256: terminal.artifactSha256 },
    sharedEnvironment: { path: 'model-artifacts/m8-shared-offensive-environment-v2.json', fileSha256: sharedFile.sha256, artifactSha256: shared.artifactSha256 },
    starterRetention: { path: 'model-artifacts/m8-starter-retention-v1.json', fileSha256: retentionFile.sha256, artifactSha256: retention.artifactSha256 },
    completeCandidate: { path: 'model-artifacts/m8-batter-hits-complete-candidate-v1.json', fileSha256: completeFile.sha256, artifactSha256: complete.artifactSha256 },
    park: { path: 'model-artifacts/m8-5-park-transformation-v1.json', fileSha256: parkFile.sha256, modelVersion: parkFile.value.modelVersion },
    teamBullpen: { path: 'model-artifacts/m8-5-team-bullpen-outcome-v1.json', fileSha256: bullpenFile.sha256, modelVersion: bullpenFile.value.modelVersion },
  },
  providerSourceSnapshots: sourceSnapshots,
  rows,
};
await mkdir(OUTPUT_DIRECTORY, { recursive: true });
await writeFile(DESIGN_PATH, `${JSON.stringify(fixture, null, 2)}\n`);
await writeFile(BOARD_PATH, `${JSON.stringify(boardFixture, null, 2)}\n`);
console.log('=== M11 HHR RESPECIFIED EVIDENCE ===');
console.log(`WARMUP HISTORY: ${FROZEN_HISTORY_START_DATE} through ${FROZEN_HISTORY_END_DATE} (artifact-backed, not fitted)`);
console.log(`FIT: ${FIT_DATES[0]} through ${FIT_DATES.at(-1)}`);
console.log(`LATEST COMPLETE DATE: ${latestCompleteDate}`);
console.log(`ROW EXPANSION FACTOR VS ATTEMPT 1: ${rows.length / ATTEMPT_1_ROW_COUNT}`);
console.log(`ROWS: ${rows.length}`);
console.log(`GAMES: ${fixture.gameCount}`);
console.log(`EXCLUDED: ${excludedRowCount}`);
for (const [rule, count] of Object.entries(exclusionCounts)) console.log(`EXCLUSION ${rule}: ${count}`);
for (const rule of EXAMPLE_RULES) console.log(`EXCLUSION EXAMPLES ${rule}: ${JSON.stringify(exclusionExamples[rule])}`);
console.log(`EXCLUSION SUM: ${fixture.exclusionCountSum}`);
console.log(`DESIGN SHA-256: ${sha256(`${JSON.stringify(fixture, null, 2)}\n`)}`);
console.log(`BOARD SHA-256: ${sha256(`${JSON.stringify(boardFixture, null, 2)}\n`)}`);
console.log('ALL SEVEN CONDITIONING INPUTS: true');
console.log('RAW HITS/PA PREDICTOR: false');
console.log('PA OFFSET FIXED AT 1: true');
console.log('=== END M11 HHR RESPECIFIED EVIDENCE ===');

if (excludedRowCount + rows.length !== stats.length) {
  throw new Error(`Exclusion conservation failed after diagnostic persistence: ${excludedRowCount} + ${rows.length} != ${stats.length}.`);
}
if (rows.length <= ATTEMPT_1_ROW_COUNT) {
  throw new Error(`Attempt 2 must materially exceed attempt 1's ${ATTEMPT_1_ROW_COUNT} fitted rows; received ${rows.length}.`);
}
if (fixture.lookaheadAudit.fittedRowsOnOrBeforePitcherAllowedEndDate !== 0) {
  throw new Error('Attempt 2 fitted rows overlap the frozen pitcherAllowed source range.');
}
