import { createHash } from 'node:crypto';

export const PHASE2_DISPLAY_ENRICHMENT_VERSION = 1;
export const PHASE2_DISPLAY_ENRICHMENT_CONTRACT = 'phase2-last-five-and-opposing-starter-v1';

const key = (gameId, playerId) => `${gameId}:${playerId}`;

function integer(value) {
  return Number.isSafeInteger(value) && value >= 0 ? value : null;
}

function exactTeamName(value) {
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : null;
}

function gameDate(game) {
  const value = game?.date;
  return typeof value === 'string' && Number.isFinite(Date.parse(value)) ? value : null;
}

function baseballInnings(outs) {
  return `${Math.floor(outs / 3)}.${outs % 3}`;
}

function pitchingBlock(rows) {
  const totals = rows.reduce(
    (sum, row) => ({
      outs: sum.outs + row.pitching_outs,
      earnedRuns: sum.earnedRuns + row.er,
      strikeouts: sum.strikeouts + row.p_k,
      hits: sum.hits + row.p_hits,
      walks: sum.walks + row.p_bb,
    }),
    { outs: 0, earnedRuns: 0, strikeouts: 0, hits: 0, walks: 0 },
  );
  return Object.freeze({
    starts: rows.length,
    inningsPitched: baseballInnings(totals.outs),
    earnedRuns: totals.earnedRuns,
    strikeouts: totals.strikeouts,
    whip: totals.outs === 0 ? null : ((totals.hits + totals.walks) * 3) / totals.outs,
  });
}

function seasonPitchingBlock(row) {
  return Object.freeze({
    inningsPitched: row?.pitching_ip ?? null,
    earnedRuns: integer(row?.pitching_er),
    strikeouts: integer(row?.pitching_k),
    whip: typeof row?.pitching_whip === 'number' && Number.isFinite(row.pitching_whip) ? row.pitching_whip : null,
  });
}

function validPitchingRow(row) {
  return [row?.pitching_outs, row?.er, row?.p_k, row?.p_hits, row?.p_bb]
    .every((value) => Number.isSafeInteger(value) && value >= 0);
}

/** Build display-only data. It deliberately accepts already captured provider rows so tests and
 * archive construction never need a live API. */
export function buildPhase2DisplayEnrichment({
  captureDateUtc,
  players,
  games,
  statsRows,
  seasonStatsRows = [],
  failureReasonByPlayerId = new Map(),
}) {
  if (typeof captureDateUtc !== 'string' || !/^\d{4}-\d{2}-\d{2}$/u.test(captureDateUtc)) {
    throw new TypeError('captureDateUtc must be YYYY-MM-DD.');
  }
  const captureBoundary = Date.parse(`${captureDateUtc}T00:00:00.000Z`);
  const gameById = new Map(games.map((game) => [game?.id ?? game?.gameId, game]));
  const seasonByPlayer = new Map(seasonStatsRows.map((row) => [row?.player?.id, row]));
  const byGamePlayerKey = {};
  const reasons = {};
  const countReason = (reason) => { reasons[reason] = (reasons[reason] ?? 0) + 1; };

  for (const player of players) {
    const playerKey = key(player.providerGameId, player.providerPlayerId);
    let failureReason = failureReasonByPlayerId.get(player.providerPlayerId) ?? null;
    const batting = [];
    for (const row of statsRows) {
      if (row?.player?.id !== player.providerPlayerId || !Number.isSafeInteger(row?.game_id)) continue;
      if (!Number.isSafeInteger(row.plate_appearances) || row.plate_appearances <= 0) continue;
      const game = gameById.get(row.game_id);
      const date = gameDate(game);
      if (date === null || Date.parse(date) >= captureBoundary || game?.status !== 'STATUS_FINAL') continue;
      const teamName = exactTeamName(row.team_name);
      const homeName = exactTeamName(game.home_team_name ?? game.homeTeamName);
      const awayName = exactTeamName(game.away_team_name ?? game.awayTeamName);
      if (teamName === null || (teamName !== homeName && teamName !== awayName)) {
        failureReason = 'TEAM_NAME_MISMATCH';
        break;
      }
      const values = [row.hits, row.runs, row.rbi, row.at_bats, row.plate_appearances, row.total_bases];
      if (!values.every((value) => Number.isSafeInteger(value) && value >= 0)) {
        failureReason = 'MALFORMED_BATTING_STATS';
        break;
      }
      const home = teamName === homeName;
      batting.push(Object.freeze({
        gameDate: date.slice(0, 10),
        opponentTeamName: home ? awayName : homeName,
        opponentAbbreviation: home
          ? (game.away_team?.abbreviation ?? game.awayAbbreviation ?? null)
          : (game.home_team?.abbreviation ?? game.homeAbbreviation ?? null),
        homeOrAway: home ? 'home' : 'away',
        hits: row.hits,
        runs: row.runs,
        rbi: row.rbi,
        hrr: row.hits + row.runs + row.rbi,
        atBats: row.at_bats,
        plateAppearances: row.plate_appearances,
        totalBases: row.total_bases,
      }));
    }
    const lastFive = failureReason === null
      ? batting.sort((a, b) => a.gameDate.localeCompare(b.gameDate)).slice(-5)
      : [];
    if (failureReason !== null) countReason(failureReason);

    const starterId = player.opposingStarterPitcherId;
    const starts = statsRows
      .filter((row) => {
        const game = gameById.get(row?.game_id);
        const date = gameDate(game);
        return row?.player?.id === starterId && row?.games_started === 1 && validPitchingRow(row) &&
          date !== null && Date.parse(date) < captureBoundary && game?.status === 'STATUS_FINAL';
      })
      .sort((left, right) => gameDate(gameById.get(left.game_id)).localeCompare(gameDate(gameById.get(right.game_id))))
      .slice(-10);
    const season = seasonByPlayer.get(starterId);
    byGamePlayerKey[playerKey] = Object.freeze({
      providerGameId: player.providerGameId,
      providerPlayerId: player.providerPlayerId,
      lastFiveGames: Object.freeze({ count: lastFive.length, games: Object.freeze(lastFive), failureReason }),
      opposingStarter: Object.freeze({
        name: player.opposingStarterName ?? null,
        throwingHand: player.opposingStarterHand ?? null,
        era: typeof season?.pitching_era === 'number' && Number.isFinite(season.pitching_era) ? season.pitching_era : null,
        last10: pitchingBlock(starts),
        season: seasonPitchingBlock(season),
      }),
    });
  }
  return Object.freeze({
    version: PHASE2_DISPLAY_ENRICHMENT_VERSION,
    contract: PHASE2_DISPLAY_ENRICHMENT_CONTRACT,
    keyFormat: 'providerGameId:providerPlayerId',
    byGamePlayerKey: Object.freeze(byGamePlayerKey),
    diagnostics: Object.freeze({ playerCount: players.length, failureReasons: Object.freeze(reasons) }),
  });
}

function stableJson(value) {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`;
  return `{${Object.keys(value).sort().map((name) => `${JSON.stringify(name)}:${stableJson(value[name])}`).join(',')}}`;
}

export function attachPhase2DisplayEnrichment(archive, displayEnrichment) {
  const { archiveSha256: ignored, ...identity } = archive;
  const enrichedIdentity = { ...identity, displayEnrichment };
  return Object.freeze({
    ...enrichedIdentity,
    archiveSha256: createHash('sha256').update(stableJson(enrichedIdentity)).digest('hex'),
  });
}

async function pagedRows({ endpoint, ids, idParameter, fetchPage }) {
  const rows = [];
  for (let offset = 0; offset < ids.length; offset += 100) {
    const batch = ids.slice(offset, offset + 100);
    let cursor = null;
    do {
      const url = new URL(`https://api.balldontlie.io/mlb/v1/${endpoint}`);
      for (const id of batch) url.searchParams.append(idParameter, String(id));
      url.searchParams.set('per_page', '100');
      if (cursor !== null) url.searchParams.set('cursor', String(cursor));
      const body = await fetchPage(url, `Phase 2 ${endpoint} batch ${Math.floor(offset / 100) + 1}`);
      if (!Array.isArray(body?.data)) throw new Error(`Phase 2 ${endpoint} response has no data array.`);
      rows.push(...body.data);
      cursor = body?.meta?.next_cursor ?? null;
    } while (cursor !== null);
  }
  return rows;
}

export async function capturePhase2DisplayEnrichment({ captureDateUtc, players, fetchPage }) {
  const playerIds = [...new Set(players.flatMap((player) => [
    player.providerPlayerId, player.opposingStarterPitcherId,
  ]))].filter(Number.isSafeInteger);
  let statsRows;
  try {
    statsRows = await pagedRows({ endpoint: 'stats', ids: playerIds, idParameter: 'player_ids[]', fetchPage });
  } catch {
    return buildPhase2DisplayEnrichment({
      captureDateUtc, players, games: [], statsRows: [], seasonStatsRows: [],
      failureReasonByPlayerId: new Map(players.map((player) => [player.providerPlayerId, 'STATS_UNAVAILABLE'])),
    });
  }
  const gameIds = [...new Set(statsRows.map((row) => row?.game_id))].filter(Number.isSafeInteger);
  let games;
  try {
    games = await pagedRows({ endpoint: 'games', ids: gameIds, idParameter: 'game_ids[]', fetchPage });
  } catch {
    return buildPhase2DisplayEnrichment({
      captureDateUtc, players, games: [], statsRows, seasonStatsRows: [],
      failureReasonByPlayerId: new Map(players.map((player) => [player.providerPlayerId, 'GAMES_UNAVAILABLE'])),
    });
  }
  const starterIds = [...new Set(players.map((player) => player.opposingStarterPitcherId))].filter(Number.isSafeInteger);
  let seasonStatsRows = [];
  try {
    seasonStatsRows = await pagedRows({
      endpoint: 'season_stats', ids: starterIds, idParameter: 'player_ids[]', fetchPage,
    });
  } catch {
    // A season summary failure must not remove the player or a valid last-five log.
  }
  return buildPhase2DisplayEnrichment({ captureDateUtc, players, games, statsRows, seasonStatsRows });
}
