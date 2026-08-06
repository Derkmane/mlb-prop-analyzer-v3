import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

const oddsKey = process.env.THE_ODDS_API_KEY?.trim();
const bdlKey = process.env.BALLDONTLIE_API_KEY?.trim();
if (!oddsKey) throw new Error('Missing THE_ODDS_API_KEY.');
if (!bdlKey) throw new Error('Missing BALLDONTLIE_API_KEY.');

const WARMUP_DATES = Object.freeze([
  '2026-07-13','2026-07-14','2026-07-15','2026-07-16','2026-07-17','2026-07-18','2026-07-19','2026-07-20',
]);
const FIT_DATES = Object.freeze([
  '2026-07-21','2026-07-22','2026-07-23','2026-07-24','2026-07-25',
]);
const ALL_DATES = Object.freeze([...WARMUP_DATES, ...FIT_DATES]);
const OUTPUT_DIRECTORY = path.resolve('fixtures/sanitized/m11/hhr/respecified-v1');
const DESIGN_PATH = path.join(OUTPUT_DIRECTORY, 'balldontlie-hhr-design-matrix-v1.json');
const BOARD_PATH = path.join(OUTPUT_DIRECTORY, 'the-odds-api-underdog-hhr-board-v1.json');
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

async function historicalEvent(game) {
  const snapshotTime = new Date(Date.parse(game.commenceTime) - 60 * 60 * 1000).toISOString();
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

const gamesUrl = new URL('https://api.balldontlie.io/mlb/v1/games');
for (const date of ALL_DATES) gamesUrl.searchParams.append('dates[]', date);
gamesUrl.searchParams.set('season_type', 'regular');
gamesUrl.searchParams.set('per_page', '100');
const gamesSnapshot = await fetchSnapshot(gamesUrl, 'BDL HHR respecified games', { headers: { Authorization: bdlKey }, bdl: true });
if (!Array.isArray(gamesSnapshot.body?.data)) throw new Error('BDL games data must be an array.');
const games = gamesSnapshot.body.data
  .filter((game) => game?.status === 'STATUS_FINAL' && ALL_DATES.includes(String(game.date).slice(0, 10)))
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
const sourceSnapshots = [{ endpoint: 'games', rawBodySha256: gamesSnapshot.rawBodySha256 }];
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
const starterByGameTeam = new Map();
for (const row of lineups) {
  const gameId = row?.game_id;
  const playerId = row?.player?.id;
  const teamId = row?.team?.id;
  if (!Number.isInteger(gameId) || !Number.isInteger(playerId) || !Number.isInteger(teamId)) continue;
  if (row?.is_probable_pitcher === true) {
    starterByGameTeam.set(`${gameId}:${teamId}`, {
      playerId, hand: throwingHand(row.player?.bats_throws), rawBatsThrows: row.player?.bats_throws,
    });
    continue;
  }
  if (!Number.isInteger(row?.batting_order) || row.batting_order < 1 || row.batting_order > 9) continue;
  const key = `${gameId}:${teamId}`;
  const teamRows = hittersByGameTeam.get(key) ?? new Map();
  teamRows.set(row.batting_order, {
    playerId, lineupSlot: row.batting_order, declaredHand: declaredHand(row.player?.bats_throws),
    rawBatsThrows: row.player?.bats_throws,
  });
  hittersByGameTeam.set(key, teamRows);
}

const totalsByGame = new Map();
let boardFixture = null;
for (const game of games.filter((row) => FIT_DATES.includes(row.date))) {
  const event = await historicalEvent(game);
  if (!event) continue;
  const totals = await historicalTeamTotals(game, event);
  if (totals) totalsByGame.set(game.gameId, totals);
  if (!boardFixture) boardFixture = await captureHistoricalHhrBoard(game, event);
}
if (!boardFixture) throw new Error('No historical pregame Underdog event exposed both HHR baseline and alternate markets.');

const exclusionCounts = Object.fromEntries([
  'warmup_history_only','missing_game','missing_player_identity','missing_team_identity','invalid_box_score',
  'missing_lineup_slot','missing_opposing_starter','invalid_handedness','missing_park_effect','missing_team_bullpen',
  'missing_team_total','missing_preceding_lineup','duplicate_player_game','invalid_m8_conditioning',
].map((key) => [key, 0]));
const rows = [];
const seen = new Set();
function exclude(rule) { exclusionCounts[rule] += 1; }

for (const stat of stats) {
  const game = gameById.get(stat?.game_id);
  if (!game) { exclude('missing_game'); continue; }
  if (WARMUP_DATES.includes(game.date)) { exclude('warmup_history_only'); continue; }
  const playerId = stat?.player?.id;
  if (!Number.isInteger(playerId)) { exclude('missing_player_identity'); continue; }
  const teamId = stat?.team?.id;
  if (!Number.isInteger(teamId) || (teamId !== game.homeTeamId && teamId !== game.awayTeamId)) { exclude('missing_team_identity'); continue; }
  const hits = Number(stat?.hits), runs = Number(stat?.runs), rbi = Number(stat?.rbi), pa = Number(stat?.plate_appearances);
  if (![hits,runs,rbi,pa].every(Number.isInteger) || hits < 0 || runs < 0 || rbi < 0 || pa <= 0) { exclude('invalid_box_score'); continue; }
  const identity = `${game.gameId}:${playerId}`;
  if (seen.has(identity)) { exclude('duplicate_player_game'); continue; }
  seen.add(identity);
  const teamRows = hittersByGameTeam.get(`${game.gameId}:${teamId}`);
  const hitter = teamRows ? [...teamRows.values()].find((row) => row.playerId === playerId) : null;
  if (!hitter) { exclude('missing_lineup_slot'); continue; }
  const opposingTeamId = teamId === game.homeTeamId ? game.awayTeamId : game.homeTeamId;
  const starter = starterByGameTeam.get(`${game.gameId}:${opposingTeamId}`);
  if (!starter || !Number.isInteger(starter.playerId)) { exclude('missing_opposing_starter'); continue; }
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
  if (!Number.isFinite(teamTotal)) { exclude('missing_team_total'); continue; }
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
      terminal, overallBatter, terminal.pitcherAllowed[String(starter.playerId)] ?? terminal.unseenPitcher,
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
if (rows.length < 500) throw new Error(`Respecified HHR fit requires at least 500 complete rows; received ${rows.length}.`);
const excludedRowCount = Object.values(exclusionCounts).reduce((sum, count) => sum + count, 0);
if (excludedRowCount + rows.length !== stats.length) {
  throw new Error(`Exclusion conservation failed: ${excludedRowCount} + ${rows.length} != ${stats.length}.`);
}

const fixture = {
  schemaVersion: 2,
  provider: 'BALLDONTLIE MLB API',
  activeSeason: 2026,
  seasonType: 'regular',
  warmupWindow: { startDate: WARMUP_DATES[0], endDate: WARMUP_DATES.at(-1), fitted: false },
  fitWindow: { startDate: FIT_DATES[0], endDate: FIT_DATES.at(-1) },
  chronology: 'frozen M8/M8.5 artifacts end validation 2026-07-05; HHR warmup and fit occur strictly later',
  conditioningInputContract: [
    'context-adjusted-terminal-outcome-vector','expected-plate-appearances','lineup-slot','platoon-split-cell',
    'opposing-starter-pooling','team-implied-run-total','preceding-lineup-slots-on-base-quality',
  ],
  expectedPaRole: 'log offset with fixed coefficient 1',
  gameCount: new Set(rows.map((row) => row.gameId)).size,
  rowCount: rows.length,
  excludedRowCount,
  exclusionCounts,
  exclusionCountSum: excludedRowCount,
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
console.log(`WARMUP: ${WARMUP_DATES[0]} through ${WARMUP_DATES.at(-1)}`);
console.log(`FIT: ${FIT_DATES[0]} through ${FIT_DATES.at(-1)}`);
console.log(`ROWS: ${rows.length}`);
console.log(`GAMES: ${fixture.gameCount}`);
console.log(`EXCLUDED: ${excludedRowCount}`);
for (const [rule, count] of Object.entries(exclusionCounts)) console.log(`EXCLUSION ${rule}: ${count}`);
console.log(`EXCLUSION SUM: ${fixture.exclusionCountSum}`);
console.log(`DESIGN SHA-256: ${sha256(`${JSON.stringify(fixture, null, 2)}\n`)}`);
console.log(`BOARD SHA-256: ${sha256(`${JSON.stringify(boardFixture, null, 2)}\n`)}`);
console.log('ALL SEVEN CONDITIONING INPUTS: true');
console.log('RAW HITS/PA PREDICTOR: false');
console.log('PA OFFSET FIXED AT 1: true');
console.log('=== END M11 HHR RESPECIFIED EVIDENCE ===');
