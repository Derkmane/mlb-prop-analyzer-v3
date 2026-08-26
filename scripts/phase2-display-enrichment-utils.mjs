import { createHash } from 'node:crypto';

export const PHASE2_DISPLAY_ENRICHMENT_VERSION = 1;
export const PHASE2_DISPLAY_ENRICHMENT_CONTRACT = 'phase2-last-five-and-opposing-starter-v1';
const ACTIVE_SEASON = 2026;
const CENTRAL_GAME_DATE_FORMATTER = new Intl.DateTimeFormat('en-US', {
  timeZone: 'America/Chicago',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
});

export function phase2EnrichmentEnabled(value = process.env.PHASE2_ENRICHMENT) {
  const normalized = value ?? 'on';
  if (normalized !== 'on' && normalized !== 'off') {
    throw new Error('PHASE2_ENRICHMENT must be "on" or "off".');
  }
  return normalized === 'on';
}

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

function centralGameDate(value) {
  const parts = CENTRAL_GAME_DATE_FORMATTER.formatToParts(new Date(value));
  const year = parts.find((part) => part.type === 'year')?.value;
  const month = parts.find((part) => part.type === 'month')?.value;
  const day = parts.find((part) => part.type === 'day')?.value;
  if (year === undefined || month === undefined || day === undefined) {
    throw new Error(`Unable to format Central game date: ${value}`);
  }
  return `${year}-${month}-${day}`;
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
  const captureBoundaryExclusive = Date.parse(`${captureDateUtc}T00:00:00.000Z`) + 86_400_000;
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
      if (date === null || Date.parse(date) >= captureBoundaryExclusive || game?.status !== 'STATUS_FINAL') continue;
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
        sortTime: Date.parse(date),
        value: Object.freeze({
          gameDate: centralGameDate(date),
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
        }),
      }));
    }
    const lastFive = failureReason === null
      ? batting.sort((a, b) => a.sortTime - b.sortTime).slice(-5).map((entry) => entry.value)
      : [];
    if (failureReason !== null) countReason(failureReason);

    const starterId = player.opposingStarterPitcherId;
    const starts = statsRows
      .filter((row) => {
        const game = gameById.get(row?.game_id);
        const date = gameDate(game);
        return row?.player?.id === starterId && row?.games_started === 1 && validPitchingRow(row) &&
          date !== null && Date.parse(date) < captureBoundaryExclusive && game?.status === 'STATUS_FINAL';
      })
      .sort((left, right) => gameDate(gameById.get(left.game_id)).localeCompare(gameDate(gameById.get(right.game_id))))
      .slice(-10);
    const season = seasonByPlayer.get(starterId);
    byGamePlayerKey[playerKey] = Object.freeze({
      providerGameId: player.providerGameId,
      providerPlayerId: player.providerPlayerId,
      lastFiveGames: Object.freeze({ count: lastFive.length, games: Object.freeze(lastFive), failureReason }),
      opposingStarter: failureReason !== null ? Object.freeze({ failureReason }) : Object.freeze({
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

async function pagedRows({ endpoint, parameterGroups, fetchPage, signal }) {
  const rows = [];
  for (let batchIndex = 0; batchIndex < parameterGroups.length; batchIndex += 1) {
    const parameters = parameterGroups[batchIndex];
    let cursor = null;
    const seenCursors = new Set();
    do {
      const url = new URL(`https://api.balldontlie.io/mlb/v1/${endpoint}`);
      for (const [name, values] of Object.entries(parameters)) {
        for (const value of values) url.searchParams.append(name, String(value));
      }
      url.searchParams.set('per_page', '100');
      if (cursor !== null) url.searchParams.set('cursor', String(cursor));
      const body = await fetchPage(url, `Phase 2 ${endpoint} batch ${batchIndex + 1}`, { signal });
      if (!Array.isArray(body?.data)) throw new Error(`Phase 2 ${endpoint} response has no data array.`);
      rows.push(...body.data);
      cursor = body?.meta?.next_cursor ?? null;
      if (cursor !== null) {
        const cursorKey = String(cursor);
        if (seenCursors.has(cursorKey)) {
          const error = new Error(`Phase 2 ${endpoint} pagination repeated cursor ${cursorKey}.`);
          error.code = endpoint === 'stats' ? 'STATS_PAGE_TRUNCATED' : 'ENRICHMENT_PAGE_TRUNCATED';
          throw error;
        }
        seenCursors.add(cursorKey);
      }
    } while (cursor !== null);
  }
  return rows;
}

function chunks(values, size) {
  return Array.from({ length: Math.ceil(values.length / size) }, (_, index) =>
    values.slice(index * size, (index + 1) * size));
}

function utcDatesThrough(captureDateUtc) {
  const end = new Date(`${captureDateUtc}T00:00:00.000Z`);
  const start = new Date(Date.UTC(end.getUTCFullYear(), 0, 1));
  const dates = [];
  for (let cursor = start; cursor <= end; cursor = new Date(cursor.getTime() + 86_400_000)) {
    dates.push(cursor.toISOString().slice(0, 10));
  }
  return dates;
}

function emptyEnrichment(captureDateUtc, players, reason) {
  return buildPhase2DisplayEnrichment({
    captureDateUtc, players, games: [], statsRows: [], seasonStatsRows: [],
    failureReasonByPlayerId: new Map(players.map((player) => [player.providerPlayerId, reason])),
  });
}

export async function capturePhase2DisplayEnrichment({
  captureDateUtc,
  players,
  fetchPage,
  timeoutMs = 120_000,
}) {
  if (!phase2EnrichmentEnabled()) {
    const reason = 'disabled-by-flag';
    const byGamePlayerKey = Object.fromEntries(players.map((player) => [
      key(player.providerGameId, player.providerPlayerId),
      Object.freeze({
        providerGameId: player.providerGameId,
        providerPlayerId: player.providerPlayerId,
        lastFiveGames: Object.freeze({ count: 0, games: Object.freeze([]), failureReason: reason }),
        opposingStarter: Object.freeze({ failureReason: reason }),
      }),
    ]));
    return Object.freeze({
      version: PHASE2_DISPLAY_ENRICHMENT_VERSION,
      contract: PHASE2_DISPLAY_ENRICHMENT_CONTRACT,
      keyFormat: 'providerGameId:providerPlayerId',
      byGamePlayerKey: Object.freeze(byGamePlayerKey),
      diagnostics: Object.freeze({
        playerCount: players.length,
        failureReasons: Object.freeze({ [reason]: players.length }),
      }),
    });
  }
  const controller = new AbortController();
  let timer;
  const work = async () => {
    const games = await pagedRows({
      endpoint: 'games',
      parameterGroups: chunks(utcDatesThrough(captureDateUtc), 100).map((dates) => ({ 'dates[]': dates })),
      fetchPage,
      signal: controller.signal,
    });
    const gameIds = [...new Set(games.map((game) => game?.id ?? game?.gameId))].filter(Number.isSafeInteger);
    const playerIds = [...new Set(players.flatMap((player) => [
      player.providerPlayerId, player.opposingStarterPitcherId,
    ]))].filter(Number.isSafeInteger);
    const statsGroups = chunks(gameIds, 100).flatMap((gameBatch) =>
      chunks(playerIds, 100).map((playerBatch) => ({
        'game_ids[]': gameBatch,
        'player_ids[]': playerBatch,
      })));
    const statsRows = await pagedRows({
      endpoint: 'stats', parameterGroups: statsGroups, fetchPage, signal: controller.signal,
    });
    const starterIds = [...new Set(players.map((player) => player.opposingStarterPitcherId))]
      .filter(Number.isSafeInteger);
    const seasonStatsRows = await pagedRows({
      endpoint: 'season_stats',
      parameterGroups: chunks(starterIds, 100).map((ids) => ({
        'player_ids[]': ids,
        season: [ACTIVE_SEASON],
      })),
      fetchPage,
      signal: controller.signal,
    });
    const returnedPlayerIds = new Set(statsRows.map((row) => row?.player?.id));
    const failures = new Map(players
      .filter((player) => !returnedPlayerIds.has(player.providerPlayerId))
      .map((player) => [player.providerPlayerId, 'missing-player']));
    return buildPhase2DisplayEnrichment({
      captureDateUtc, players, games, statsRows, seasonStatsRows, failureReasonByPlayerId: failures,
    });
  };
  try {
    return await Promise.race([
      work(),
      new Promise((resolve) => {
        timer = setTimeout(() => {
          controller.abort();
          resolve(emptyEnrichment(captureDateUtc, players, 'enrichment-timeout'));
        }, timeoutMs);
      }),
    ]);
  } catch (error) {
    const reason = error?.code === 'STATS_PAGE_TRUNCATED'
      ? 'stats-page-truncated'
      : 'enrichment-http-error';
    return emptyEnrichment(captureDateUtc, players, reason);
  } finally {
    clearTimeout(timer);
  }
}
