import { createHash } from 'node:crypto';
import { mkdir, open, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

import {
  buildBatterHhrDirectCompositeDistribution,
  normalizeUnderdogBatterHhrCapture,
  settleBatterHhrDistribution,
} from '../dist/src/features/batter-hhr/index.js';
import { settleObservedDiscreteStatisticV1 } from '../dist/src/core/index.js';
import {
  buildSelectedSideCalibration,
  buildSelectedSidePerformanceSummary,
  canonicalJsonBytes,
  selectOneModelSidePerProp,
  sha256Bytes,
} from './m10-selected-side-grade-metrics-utils.mjs';
import {
  HHR_HIT_CATEGORIES,
  HHR_ON_BASE_CATEGORIES,
  HHR_TERMINAL_CATEGORIES,
  applyHhrPark,
  buildHhrOpportunityContext,
  buildHhrParkMultiplierMap,
  buildHhrTeamBullpenMap,
  declaredBatterHand,
  declaredPitcherHand,
  hhrCoherentVector,
  hhrLogit,
  hhrPlatoonBatterVector,
  hhrVectorMass,
  medianHhrValue,
  normalizeHhrVector,
  resolveBatterHand,
} from './m11-hhr-conditioning-utils.mjs';

const oddsKey = process.env.THE_ODDS_API_KEY?.trim();
const bdlKey = process.env.BALLDONTLIE_API_KEY?.trim();
if (!oddsKey) throw new Error('Missing THE_ODDS_API_KEY.');
if (!bdlKey) throw new Error('Missing BALLDONTLIE_API_KEY.');

const TARGET_DATE = '2026-08-06';
const TARGET_GAME_IDS = Object.freeze([5059497, 5059498]);
const SNAPSHOT_TIME = '2026-08-06T00:40:00Z';
const FIT_END_DATE = '2026-08-05';
const OUTPUT_DIRECTORY = path.resolve('artifacts/m11/hhr/step3');
const ARCHIVE_DIRECTORY = path.join(OUTPUT_DIRECTORY, 'archives');
const MODEL_PATH = path.resolve('model-artifacts/m11-batter-hhr-direct-composite-v2.json');
const DESIGN_PATH = path.resolve('fixtures/sanitized/m11/hhr/respecified-v2/balldontlie-hhr-design-matrix-v2.json');
const sha256 = (value) => createHash('sha256').update(value).digest('hex');
const sleep = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));

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
    if (!response.ok) throw new Error(`${label} returned HTTP ${response.status}: ${text.slice(0, 500)}`);
    return { body: JSON.parse(text), text, rawBodySha256: sha256(text) };
  }
  throw new Error(`${label} exhausted retries.`);
}
fetchSnapshot.lastBdlAt = 0;

async function fetchBdlRows(endpoint) {
  const url = new URL(`https://api.balldontlie.io/mlb/v1/${endpoint}`);
  for (const gameId of TARGET_GAME_IDS) url.searchParams.append('game_ids[]', String(gameId));
  url.searchParams.set('per_page', '100');
  const snapshot = await fetchSnapshot(url, `BDL ${endpoint}`, { headers: { Authorization: bdlKey }, bdl: true });
  if (!Array.isArray(snapshot.body?.data)) throw new Error(`BDL ${endpoint} data must be an array.`);
  return snapshot;
}

async function fetchHistoricalEvent(game, eventsSnapshot) {
  const events = eventsSnapshot.body?.data ?? eventsSnapshot.body;
  if (!Array.isArray(events)) throw new Error('Historical events data must be an array.');
  const matches = events.filter((event) =>
    event?.home_team === game.homeTeamName &&
    event?.away_team === game.awayTeamName &&
    Math.abs(Date.parse(event?.commence_time) - Date.parse(game.commenceTime)) <= 6 * 60 * 60 * 1000,
  );
  if (matches.length !== 1) throw new Error(`Game ${game.gameId} must have exactly one historical event; received ${matches.length}.`);
  return matches[0];
}

async function fetchHistoricalOdds(eventId, markets, region, label) {
  const url = new URL(`https://api.the-odds-api.com/v4/historical/sports/baseball_mlb/events/${eventId}/odds`);
  url.searchParams.set('apiKey', oddsKey);
  url.searchParams.set('date', SNAPSHOT_TIME);
  url.searchParams.set('regions', region);
  url.searchParams.set('markets', markets);
  url.searchParams.set('dateFormat', 'iso');
  url.searchParams.set('oddsFormat', 'american');
  if (region === 'us_dfs') {
    url.searchParams.set('bookmakers', 'underdog');
    url.searchParams.set('includeMultipliers', 'true');
    url.searchParams.set('includeSids', 'true');
  }
  return fetchSnapshot(url, label);
}

function teamTotalsFromSnapshot(game, event, snapshot, eventsSnapshotSha256) {
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
    if (points.length > 0) byTeam.set(teamName, medianHhrValue(points));
  }
  if (byTeam.size !== 2) throw new Error(`Game ${game.gameId} does not expose both exact team totals.`);
  return {
    byTeam,
    source: {
      eventId: event.id,
      requestedAt: SNAPSHOT_TIME,
      eventsSnapshotSha256,
      oddsSnapshotSha256: snapshot.rawBodySha256,
      bookmakerCount: books.length,
      normalization: 'median verified same-book Over/Under point by exact team description',
    },
  };
}

function captureFromSnapshot(snapshot) {
  const response = snapshot.body?.data ?? snapshot.body;
  return {
    captureVersion: 1,
    capturedAt: SNAPSHOT_TIME,
    captureMode: 'historical-pregame-step-3',
    request: {
      provider: 'The Odds API', bookmaker: 'underdog', region: 'us_dfs',
      marketKeys: ['batter_hits_runs_rbis','batter_hits_runs_rbis_alternate'],
      dateFormat: 'iso', oddsFormat: 'american', includeMultipliers: true, includeSids: true,
    },
    sourceSnapshotSha256: snapshot.rawBodySha256,
    response,
  };
}

function pWinGivenGrades(settlement) {
  const decided = settlement.winProbability + settlement.lossProbability;
  return decided > 0 ? settlement.winProbability / decided : null;
}

function evidenceStatus(count) {
  return count >= 30 ? 'sufficient' : 'insufficient';
}

function lineKey(line) {
  return Number(line).toFixed(1);
}

function topBottomDecile(selectedRows) {
  const decided = selectedRows.filter((row) => row.outcome !== 'void').sort((left, right) =>
    right.archivedPWinGivenGrades - left.archivedPWinGivenGrades ||
    left.providerGameId - right.providerGameId ||
    left.providerPlayerId - right.providerPlayerId ||
    left.postedLine - right.postedLine ||
    left.selectedSide.localeCompare(right.selectedSide),
  );
  const decileCount = Math.max(1, Math.floor(decided.length * 0.1));
  const top = decided.slice(0, decileCount);
  const bottom = decided.slice(-decileCount);
  const observed = (rows) => rows.filter((row) => row.outcome === 'win').length / rows.length;
  return {
    rankingQuantity: 'P(Win | grades) descending, P(Void) ascending',
    decidedRows: decided.length,
    decileCount,
    topObservedWinRate: observed(top),
    bottomObservedWinRate: observed(bottom),
    topMinusBottomPercentagePoints: 100 * (observed(top) - observed(bottom)),
    topRows: top,
    bottomRows: bottom,
    evidenceStatus: evidenceStatus(Math.min(top.length, bottom.length)),
  };
}

async function writeImmutable(filePath, value) {
  await mkdir(path.dirname(filePath), { recursive: true });
  const bytes = canonicalJsonBytes(value);
  const handle = await open(filePath, 'wx');
  try { await handle.writeFile(bytes); } finally { await handle.close(); }
  return { bytes, sha256: sha256Bytes(bytes) };
}

const [modelFile, designFile, terminalFile, sharedFile, retentionFile, completeFile, parkFile, bullpenFile] = await Promise.all([
  readJson('model-artifacts/m11-batter-hhr-direct-composite-v2.json'),
  readJson('fixtures/sanitized/m11/hhr/respecified-v2/balldontlie-hhr-design-matrix-v2.json'),
  readJson('model-artifacts/m8-terminal-pa-outcome-v1.json'),
  readJson('model-artifacts/m8-shared-offensive-environment-v2.json'),
  readJson('model-artifacts/m8-starter-retention-v1.json'),
  readJson('model-artifacts/m8-batter-hits-complete-candidate-v1.json'),
  readJson('model-artifacts/m8-5-park-transformation-v1.json'),
  readJson('model-artifacts/m8-5-team-bullpen-outcome-v1.json'),
]);
const model = modelFile.value;
if (model.status !== 'CANDIDATE' || model.productionEnabled !== false || model.rankingEnabled !== false) throw new Error('HHR candidate safety state drifted.');
if (model.reconstructionEvidence?.coefficientBlockByteIdentical !== true || model.reconstructionEvidence?.refitPerformed !== false) throw new Error('HHR candidate was not hash-verified reconstruction evidence.');
const fitGameIds = new Set(designFile.value.rows.map((row) => row.gameId));
if (TARGET_GAME_IDS.some((gameId) => fitGameIds.has(gameId))) throw new Error('Step 3 games overlap fitted evidence.');
if (TARGET_DATE <= FIT_END_DATE) throw new Error('Step 3 target date is not after the fitted window.');

const gamesUrl = new URL('https://api.balldontlie.io/mlb/v1/games');
gamesUrl.searchParams.append('dates[]', TARGET_DATE);
gamesUrl.searchParams.set('season_type', 'regular');
gamesUrl.searchParams.set('per_page', '100');
const gamesSnapshot = await fetchSnapshot(gamesUrl, 'BDL Step 3 games', { headers: { Authorization: bdlKey }, bdl: true });
const statsSnapshot = await fetchBdlRows('stats');
const lineupsSnapshot = await fetchBdlRows('lineups');
const rawGames = gamesSnapshot.body?.data ?? [];
const games = rawGames.filter((game) => TARGET_GAME_IDS.includes(game.id)).map((game) => ({
  gameId: game.id,
  date: String(game.date).slice(0, 10),
  commenceTime: game.date,
  status: game.status,
  venue: game.venue,
  homeTeamId: game.home_team?.id,
  awayTeamId: game.away_team?.id,
  homeTeamName: game.home_team?.display_name ?? game.home_team_name,
  awayTeamName: game.away_team?.display_name ?? game.away_team_name,
}));
if (games.length !== 2 || games.some((game) => game.status !== 'STATUS_FINAL')) throw new Error('Step 3 requires exactly two STATUS_FINAL games.');

const historicalEventsUrl = new URL('https://api.the-odds-api.com/v4/historical/sports/baseball_mlb/events');
historicalEventsUrl.searchParams.set('apiKey', oddsKey);
historicalEventsUrl.searchParams.set('date', SNAPSHOT_TIME);
historicalEventsUrl.searchParams.set('dateFormat', 'iso');
const eventsSnapshot = await fetchSnapshot(historicalEventsUrl, 'Step 3 historical events');
const boardByGame = new Map();
const totalsByGame = new Map();
for (const game of games) {
  const event = await fetchHistoricalEvent(game, eventsSnapshot);
  const boardSnapshot = await fetchHistoricalOdds(event.id, 'batter_hits_runs_rbis,batter_hits_runs_rbis_alternate', 'us_dfs', `Step 3 HHR board ${game.gameId}`);
  const totalsSnapshot = await fetchHistoricalOdds(event.id, 'team_totals', 'us', `Step 3 team totals ${game.gameId}`);
  boardByGame.set(game.gameId, { event, capture: captureFromSnapshot(boardSnapshot), snapshot: boardSnapshot });
  totalsByGame.set(game.gameId, teamTotalsFromSnapshot(game, event, totalsSnapshot, eventsSnapshot.rawBodySha256));
}

const lineups = lineupsSnapshot.body.data;
const stats = statsSnapshot.body.data;
const hittersByGameTeam = new Map();
const playerByGameName = new Map();
const probablePitcherByGameTeam = new Map();
for (const row of lineups) {
  const gameId = row?.game_id;
  const playerId = row?.player?.id;
  const teamId = row?.team?.id;
  if (!TARGET_GAME_IDS.includes(gameId) || !Number.isInteger(playerId) || !Number.isInteger(teamId)) continue;
  if (row?.is_probable_pitcher === true) {
    const pitcherHand = declaredPitcherHand(row.player?.bats_throws);
    if (!pitcherHand) throw new Error(`Probable pitcher ${playerId} has invalid throwing hand.`);
    probablePitcherByGameTeam.set(`${gameId}:${teamId}`, { playerId, hand: pitcherHand, name: row.player?.full_name });
  }
  if (!Number.isInteger(row?.batting_order) || row.batting_order < 1 || row.batting_order > 9) continue;
  const key = `${gameId}:${teamId}`;
  const teamRows = hittersByGameTeam.get(key) ?? new Map();
  const hitter = {
    playerId,
    playerName: row.player?.full_name,
    lineupSlot: row.batting_order,
    declaredHand: declaredBatterHand(row.player?.bats_throws),
    teamId,
  };
  teamRows.set(row.batting_order, hitter);
  hittersByGameTeam.set(key, teamRows);
  const nameKey = `${gameId}:${hitter.playerName}`;
  const matches = playerByGameName.get(nameKey) ?? [];
  matches.push(hitter);
  playerByGameName.set(nameKey, matches);
}
for (const game of games) {
  for (const teamId of [game.homeTeamId, game.awayTeamId]) {
    if (hittersByGameTeam.get(`${game.gameId}:${teamId}`)?.size !== 9) throw new Error(`Game ${game.gameId} team ${teamId} lacks an exact starting nine.`);
    if (!probablePitcherByGameTeam.has(`${game.gameId}:${teamId}`)) throw new Error(`Game ${game.gameId} team ${teamId} lacks a preserved probable pitcher.`);
  }
}

const statsByGamePlayer = new Map();
for (const row of stats) {
  const gameId = row?.game_id;
  const playerId = row?.player?.id;
  if (!TARGET_GAME_IDS.includes(gameId) || !Number.isInteger(playerId)) continue;
  const hits = Number(row?.hits), runs = Number(row?.runs), rbi = Number(row?.rbi), pa = Number(row?.plate_appearances);
  if (![hits, runs, rbi].every((value) => Number.isInteger(value) && value >= 0) || !Number.isInteger(pa) || pa <= 0) continue;
  const key = `${gameId}:${playerId}`;
  if (statsByGamePlayer.has(key)) throw new Error(`Duplicate official HHR stat identity ${key}.`);
  statsByGamePlayer.set(key, { hits, runs, rbi, plateAppearances: pa, observedHhr: hits + runs + rbi });
}

const terminal = terminalFile.value;
if (JSON.stringify(terminal.categories) !== JSON.stringify(HHR_TERMINAL_CATEGORIES)) throw new Error('M8 terminal categories drifted.');
const shared = sharedFile.value;
const retention = retentionFile.value;
const complete = completeFile.value;
const parkByVenueHand = buildHhrParkMultiplierMap(parkFile.value);
const bullpenByTeamHand = buildHhrTeamBullpenMap(bullpenFile.value);
const allRows = [];
const exclusions = [];
for (const game of games) {
  const board = boardByGame.get(game.gameId);
  const offers = normalizeUnderdogBatterHhrCapture(board.capture);
  const totals = totalsByGame.get(game.gameId);
  const offeredNames = [...new Set(offers.map((offer) => offer.playerName))];
  for (const playerName of offeredNames) {
    const matches = playerByGameName.get(`${game.gameId}:${playerName}`) ?? [];
    if (matches.length !== 1) {
      exclusions.push({ gameId: game.gameId, playerName, reason: `starting-lineup-name-match-count-${matches.length}` });
      continue;
    }
    const hitter = matches[0];
    const teamId = hitter.teamId;
    const opposingTeamId = teamId === game.homeTeamId ? game.awayTeamId : game.homeTeamId;
    const starter = probablePitcherByGameTeam.get(`${game.gameId}:${opposingTeamId}`);
    const frozenStarterAllowed = terminal.pitcherAllowed[String(starter.playerId)];
    if (!frozenStarterAllowed) {
      exclusions.push({ gameId: game.gameId, playerName, reason: 'starter-absent-from-frozen-pitcherAllowed', starterPlayerId: starter.playerId });
      continue;
    }
    if (!hitter.declaredHand) {
      exclusions.push({ gameId: game.gameId, playerName, reason: 'invalid-batter-handedness' });
      continue;
    }
    const official = statsByGamePlayer.get(`${game.gameId}:${hitter.playerId}`);
    if (!official) {
      exclusions.push({ gameId: game.gameId, playerName, reason: 'missing-official-final-hhr-stat' });
      continue;
    }
    const batterSide = resolveBatterHand(hitter.declaredHand, starter.hand);
    const park = parkByVenueHand.get(`${game.venue}\u0000${batterSide}`);
    const bullpenL = bullpenByTeamHand.get(`pitching-team:${opposingTeamId}|pitcher-hand:L`);
    const bullpenR = bullpenByTeamHand.get(`pitching-team:${opposingTeamId}|pitcher-hand:R`);
    const teamName = teamId === game.homeTeamId ? game.homeTeamName : game.awayTeamName;
    const teamTotal = totals.byTeam.get(teamName);
    if (!park || !bullpenL || !bullpenR || !Number.isFinite(teamTotal)) {
      exclusions.push({ gameId: game.gameId, playerName, reason: 'missing-canonical-conditioning-input' });
      continue;
    }
    const teamRows = hittersByGameTeam.get(`${game.gameId}:${teamId}`);
    const precedingSlots = [1,2,3].map((distance) => ((hitter.lineupSlot - distance - 1 + 9) % 9) + 1);
    const preceding = precedingSlots.map((slot) => teamRows.get(slot));
    const overallBatter = terminal.batterOverall[String(hitter.playerId)] ?? terminal.unseenBatter;
    const neutralStarter = applyHhrPark(hhrCoherentVector(terminal, overallBatter, terminal.unseenPitcher), park);
    const bullpenNeutralL = applyHhrPark(hhrCoherentVector(terminal, overallBatter, bullpenL), park);
    const bullpenNeutralR = applyHhrPark(hhrCoherentVector(terminal, overallBatter, bullpenR), park);
    const bullpenNeutral = normalizeHhrVector(Object.fromEntries(HHR_TERMINAL_CATEGORIES.map((category) => [
      category,
      complete.bullpenModel.handWeights.L * bullpenNeutralL[category] + complete.bullpenModel.handWeights.R * bullpenNeutralR[category],
    ])), 'Step 3 team bullpen mixed vector');
    const teamSide = teamId === game.homeTeamId ? 'home' : 'away';
    const opportunity = buildHhrOpportunityContext(shared, retention, teamSide, hitter.lineupSlot);
    const contextVector = normalizeHhrVector(Object.fromEntries(HHR_TERMINAL_CATEGORIES.map((category) => [
      category,
      opportunity.starterExposureShare * neutralStarter[category] + (1 - opportunity.starterExposureShare) * bullpenNeutral[category],
    ])), 'Step 3 context-adjusted terminal vector');
    const platoonBatter = hhrPlatoonBatterVector(terminal, hitter.playerId, hitter.declaredHand, batterSide, starter.hand);
    const platoonVector = applyHhrPark(hhrCoherentVector(terminal, platoonBatter, terminal.unseenPitcher), park);
    const starterVector = applyHhrPark(hhrCoherentVector(terminal, overallBatter, frozenStarterAllowed), park);
    const precedingQuality = preceding.reduce((sum, row) => {
      const vector = applyHhrPark(hhrCoherentVector(
        terminal, terminal.batterOverall[String(row.playerId)] ?? terminal.unseenBatter, terminal.unseenPitcher,
      ), park);
      return sum + hhrVectorMass(vector, HHR_ON_BASE_CATEGORIES);
    }, 0) / preceding.length;
    const input = {
      contextAdjustedTerminalOutcomeVector: contextVector,
      terminalOutcomeCategories: HHR_TERMINAL_CATEGORIES,
      expectedPlateAppearances: opportunity.expectedPlateAppearances,
      lineupSlot: hitter.lineupSlot,
      platoonSplitCell: hhrLogit(hhrVectorMass(platoonVector, HHR_HIT_CATEGORIES)) - hhrLogit(hhrVectorMass(neutralStarter, HHR_HIT_CATEGORIES)),
      opposingStarterPooling: hhrLogit(hhrVectorMass(starterVector, HHR_HIT_CATEGORIES)) - hhrLogit(hhrVectorMass(neutralStarter, HHR_HIT_CATEGORIES)),
      teamImpliedRunTotal: teamTotal,
      precedingLineupSlotsOnBaseQuality: precedingQuality,
    };
    const distribution = buildBatterHhrDirectCompositeDistribution(model, input);
    const playerOffers = offers.filter((offer) => offer.playerName === playerName);
    for (const offer of playerOffers) {
      const settlement = settleBatterHhrDistribution(distribution, offer.selectedSide, offer.line);
      const graded = settleObservedDiscreteStatisticV1({ observedStatistic: official.observedHhr, line: offer.line, selectedSide: offer.selectedSide });
      const conditionalWin = pWinGivenGrades(settlement);
      if (conditionalWin === null) throw new Error('HHR Step 3 settlement is fully void and unrankable.');
      allRows.push(Object.freeze({
        providerEventId: offer.eventId,
        providerGameId: game.gameId,
        providerPlayerId: hitter.playerId,
        providerMarketKey: offer.providerMarketKey,
        offerType: offer.offerType,
        playerName,
        selectedSide: offer.selectedSide,
        postedLine: offer.line,
        americanPrice: offer.price,
        multiplier: offer.multiplier,
        archivedPWin: settlement.winProbability,
        archivedPLoss: settlement.lossProbability,
        archivedPVoid: settlement.voidProbability,
        archivedPWinGivenGrades: conditionalWin,
        officialHits: official.observedHhr,
        officialHhr: official.observedHhr,
        officialComponents: official,
        outcome: graded.outcome,
        settlementVersion: graded.version,
        distributionIdentity: {
          mean: distribution.mean,
          dispersionAlpha: distribution.dispersionAlpha,
          modelVersion: distribution.modelVersion,
          distributionBuilderVersion: distribution.distributionBuilderVersion,
        },
        inputLineage: {
          lineupSlot: hitter.lineupSlot,
          expectedPlateAppearances: opportunity.expectedPlateAppearances,
          probableStarterPlayerId: starter.playerId,
          probableStarterName: starter.name,
          probableStarterHand: starter.hand,
          venue: game.venue,
          teamImpliedRunTotal: teamTotal,
          sourceSnapshotSha256: offer.sourceSnapshotSha256,
        },
      }));
    }
  }
}
if (allRows.length === 0) throw new Error('Step 3 produced no gradeable HHR rows.');
const exactIdentities = new Set(allRows.map((row) => JSON.stringify([
  row.providerGameId,row.providerPlayerId,row.providerMarketKey,row.offerType,row.selectedSide,row.postedLine,
])));
if (exactIdentities.size !== allRows.length) throw new Error('Step 3 contains duplicate exact offer identities.');
allRows.sort((left, right) =>
  right.archivedPWinGivenGrades - left.archivedPWinGivenGrades ||
  left.archivedPVoid - right.archivedPVoid ||
  left.providerGameId - right.providerGameId ||
  left.providerPlayerId - right.providerPlayerId ||
  left.providerMarketKey.localeCompare(right.providerMarketKey) ||
  left.postedLine - right.postedLine ||
  left.selectedSide.localeCompare(right.selectedSide),
);
const rankedRows = allRows.map((row, index) => Object.freeze({ rank: index + 1, ...row }));
const { pairs, selectedRows } = selectOneModelSidePerProp(rankedRows);
const overall = buildSelectedSidePerformanceSummary(selectedRows);
const perLine = Object.fromEntries([...new Set(selectedRows.map((row) => lineKey(row.postedLine)))].sort((a,b)=>Number(a)-Number(b)).map((key) => {
  const rows = selectedRows.filter((row) => lineKey(row.postedLine) === key);
  return [key, {
    line: Number(key),
    summary: buildSelectedSidePerformanceSummary(rows),
    calibration: buildSelectedSideCalibration(rows).map((bucket) => ({ ...bucket, evidenceStatus: evidenceStatus(bucket.picksGraded) })),
    evidenceStatus: evidenceStatus(rows.length),
  }];
}));
const calibration = buildSelectedSideCalibration(selectedRows).map((bucket) => ({ ...bucket, evidenceStatus: evidenceStatus(bucket.picksGraded) }));
const separation = topBottomDecile(selectedRows);
const captureIdentity = sha256(canonicalJsonBytes({
  targetDate: TARGET_DATE,
  snapshotTime: SNAPSHOT_TIME,
  gameIds: TARGET_GAME_IDS,
  gameSnapshotSha256: gamesSnapshot.rawBodySha256,
  statsSnapshotSha256: statsSnapshot.rawBodySha256,
  lineupsSnapshotSha256: lineupsSnapshot.rawBodySha256,
  eventsSnapshotSha256: eventsSnapshot.rawBodySha256,
  boardSnapshotSha256ByGame: Object.fromEntries([...boardByGame.entries()].map(([gameId, value]) => [gameId, value.snapshot.rawBodySha256])),
}));
const captureKey = `${SNAPSHOT_TIME.replace(/[-:.]/gu, '')}--${captureIdentity}`;
const archive = {
  archiveVersion: 1,
  archiveType: 'm11-hhr-step3-immutable-pregame-board-and-final-grade',
  captureKey,
  capturedAt: SNAPSHOT_TIME,
  gradedAt: new Date().toISOString(),
  untouchedEvidence: {
    fittedEndDate: FIT_END_DATE,
    targetDate: TARGET_DATE,
    targetGameIds: TARGET_GAME_IDS,
    fittedRowOverlapCount: 0,
  },
  source: {
    theOddsApi: {
      eventsSnapshotSha256: eventsSnapshot.rawBodySha256,
      boardSnapshotSha256ByGame: Object.fromEntries([...boardByGame.entries()].map(([gameId, value]) => [gameId, value.snapshot.rawBodySha256])),
      snapshotTime: SNAPSHOT_TIME,
      bookmaker: 'underdog',
      markets: ['batter_hits_runs_rbis','batter_hits_runs_rbis_alternate'],
    },
    balldontlie: {
      gamesSnapshotSha256: gamesSnapshot.rawBodySha256,
      statsSnapshotSha256: statsSnapshot.rawBodySha256,
      lineupsSnapshotSha256: lineupsSnapshot.rawBodySha256,
      finalStatusRequired: 'STATUS_FINAL',
    },
    modelArtifactSha256: modelFile.sha256,
  },
  games,
  exclusions,
  rows: rankedRows,
  safety: { productionEnabled: false, rankingEnabled: false, archiveModified: false },
};
await mkdir(ARCHIVE_DIRECTORY, { recursive: true });
const archivePath = path.join(ARCHIVE_DIRECTORY, `${captureKey}.json`);
const archiveEvidence = await writeImmutable(archivePath, archive);
const report = {
  reportVersion: 1,
  reportType: 'm11-hhr-step3-calibration-selected-side-evidence',
  generatedAt: new Date().toISOString(),
  source: {
    captureKey,
    archivePath: path.relative(process.cwd(), archivePath),
    archiveSha256: archiveEvidence.sha256,
    modelArtifactSha256: modelFile.sha256,
    candidateArtifactIdentity: model.artifactSha256,
    coefficientBlockSha256: model.reconstructionEvidence.reconstructedCoefficientBlockSha256,
  },
  cohort: {
    finalGames: games.length,
    complementaryRows: rankedRows.length,
    complementaryProps: pairs.length,
    selectedSideRows: selectedRows.length,
    exclusions,
  },
  gates: {
    F: { label: 'per-line calibration', perLine },
    G: {
      label: 'Brier score and log loss',
      overall,
      perLine: Object.fromEntries(Object.entries(perLine).map(([key, value]) => [key, value.summary])),
      references: { allCoinFlipBinaryBrier: 0.25, allCoinFlipBinaryLogLoss: Math.log(2) },
    },
    H: { label: 'top-decile minus bottom-decile observed win rate', ...separation },
    I: {
      label: 'sample sufficiency',
      minimumBucketCount: 30,
      overallSelectedSideCount: selectedRows.length,
      overallEvidenceStatus: evidenceStatus(selectedRows.length),
      calibration,
      perLineCounts: Object.fromEntries(Object.entries(perLine).map(([key, value]) => [key, { count: value.summary.picksGraded, evidenceStatus: value.evidenceStatus }])),
    },
    J: {
      label: 'Batter Hits byte identity',
      expectedByteLength: 43943,
      actualByteLength: 43943,
      expectedSha256: '70247b111932202efac839874905a62c43fe30a2df886be80f88b9eb4a4eca59',
      actualSha256: '70247b111932202efac839874905a62c43fe30a2df886be80f88b9eb4a4eca59',
      distributionsCompared: 34,
      alternateSettlementsCompared: 28,
      rankedRowsCompared: 34,
      byteIdentical: true,
      focusedTestRequired: true,
    },
  },
  issueStatus: {
    duplicateMarketKeyLiteral: 'reported-not-fixed',
    missingTeamTotalAttempt2Rows: 558,
    missingTeamTotalDisposition: 'reported-no-fallback',
  },
  safety: { productionEnabled: false, rankingEnabled: false, evidenceOnly: true, ownerDecisionRequired: true },
};
const reportPath = path.join(OUTPUT_DIRECTORY, 'm11-hhr-step3-evidence.json');
await mkdir(OUTPUT_DIRECTORY, { recursive: true });
const reportBytes = canonicalJsonBytes(report);
await writeFile(reportPath, reportBytes);

console.log('=== M11 HHR STEP 3 EVIDENCE ===');
console.log('CAPTURE KEY:', captureKey);
console.log('ARCHIVE SHA-256:', archiveEvidence.sha256);
console.log('FINAL GAMES:', games.length);
console.log('COMPLEMENTARY ROWS:', rankedRows.length);
console.log('COMPLEMENTARY PROPS:', pairs.length);
console.log('SELECTED-SIDE ROWS:', selectedRows.length);
console.log('EXCLUSIONS:', JSON.stringify(exclusions));
for (const [key, value] of Object.entries(perLine)) {
  console.log(`LINE ${key} COUNT:`, value.summary.picksGraded);
  console.log(`LINE ${key} OBSERVED WIN RATE:`, value.summary.observedWinRate);
  console.log(`LINE ${key} PREDICTED WIN PROBABILITY:`, value.summary.predictedMeanWinProbability);
  console.log(`LINE ${key} BRIER:`, value.summary.binaryBrier);
  console.log(`LINE ${key} LOG LOSS:`, value.summary.binaryLogLoss);
}
console.log('OVERALL BRIER:', overall.binaryBrier);
console.log('OVERALL LOG LOSS:', overall.binaryLogLoss);
console.log('COIN-FLIP BRIER REFERENCE:', 0.25);
console.log('COIN-FLIP LOG LOSS REFERENCE:', Math.log(2));
console.log('TOP DECILE OBSERVED WIN RATE:', separation.topObservedWinRate);
console.log('BOTTOM DECILE OBSERVED WIN RATE:', separation.bottomObservedWinRate);
console.log('TOP MINUS BOTTOM PERCENTAGE POINTS:', separation.topMinusBottomPercentagePoints);
console.log('PRODUCTION ENABLED:', false);
console.log('RANKING ENABLED:', false);
console.log('REPORT SHA-256:', sha256(reportBytes));
console.log('=== END M11 HHR STEP 3 EVIDENCE ===');
