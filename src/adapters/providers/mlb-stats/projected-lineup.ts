import { createHash } from 'node:crypto';

export const MLB_STATS_PROJECTED_LINEUP_PROVIDER = 'MLB Stats API' as const;
export const MLB_STATS_PROJECTED_LINEUP_SOURCE_VERSION =
  'mlb-stats-schedule-lineups-v1' as const;

export type MlbStatsLineupSlot = 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9;

export interface MlbStatsProjectedLineupPlayer {
  readonly mlbPlayerId: number;
  readonly playerName: string;
  readonly teamName: string;
  readonly lineupSlot: MlbStatsLineupSlot;
}

export interface MlbStatsProjectedLineupAvailable {
  readonly status: 'available';
  readonly sourceVersion: typeof MLB_STATS_PROJECTED_LINEUP_SOURCE_VERSION;
  readonly provider: typeof MLB_STATS_PROJECTED_LINEUP_PROVIDER;
  readonly providerGamePk: number;
  readonly gameDateUtc: string;
  readonly homeTeamName: string;
  readonly awayTeamName: string;
  readonly players: readonly MlbStatsProjectedLineupPlayer[];
  readonly sourceCapturedAt: string;
  readonly sourceSnapshotSha256: string;
  readonly requestUrl: string;
}

export interface MlbStatsProjectedLineupUnavailable {
  readonly status: 'unavailable' | 'no-match';
  readonly sourceVersion: typeof MLB_STATS_PROJECTED_LINEUP_SOURCE_VERSION;
  readonly provider: typeof MLB_STATS_PROJECTED_LINEUP_PROVIDER;
  readonly sourceCapturedAt: string;
  readonly sourceSnapshotSha256: string;
  readonly requestUrl: string;
}

export type MlbStatsProjectedLineupResult =
  | MlbStatsProjectedLineupAvailable
  | MlbStatsProjectedLineupUnavailable;

export interface FetchMlbStatsProjectedLineupInput {
  readonly gameDateUtc: string;
  readonly homeTeamName: string;
  readonly awayTeamName: string;
  readonly maximumStartDifferenceMilliseconds: number;
  readonly fetchImpl?: typeof fetch;
  readonly now?: () => Date;
}

function object(value: unknown, label: string): Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new TypeError(`${label} must be an object.`);
  }
  return value as Record<string, unknown>;
}

function array(value: unknown, label: string): readonly unknown[] {
  if (!Array.isArray(value)) {
    throw new TypeError(`${label} must be an array.`);
  }
  return value;
}

function nonemptyString(value: unknown, label: string): string {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new TypeError(`${label} must be a nonempty string.`);
  }
  return value.trim().replace(/\s+/gu, ' ');
}

function positiveInteger(value: unknown, label: string): number {
  if (!Number.isSafeInteger(value) || Number(value) <= 0) {
    throw new TypeError(`${label} must be a positive integer.`);
  }
  return Number(value);
}

function finiteTimestamp(value: string, label: string): number {
  const timestamp = Date.parse(value);
  if (!Number.isFinite(timestamp)) {
    throw new TypeError(`${label} must be an ISO timestamp.`);
  }
  return timestamp;
}

function sha256(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

function lineupPlayers(
  value: unknown,
  label: string,
  teamName: string,
): readonly MlbStatsProjectedLineupPlayer[] {
  if (value === undefined || value === null) return Object.freeze([]);
  const rows = array(value, label);
  if (rows.length > 9) {
    throw new Error(`${label} may contain at most nine batting-order players.`);
  }
  return Object.freeze(
    rows.map((raw, index) => {
      const player = object(raw, `${label}[${index}]`);
      return Object.freeze({
        mlbPlayerId: positiveInteger(player['id'], `${label}[${index}].id`),
        playerName: nonemptyString(
          player['fullName'],
          `${label}[${index}].fullName`,
        ),
        teamName,
        lineupSlot: (index + 1) as MlbStatsLineupSlot,
      });
    }),
  );
}

function buildRequestUrl(gameDateUtc: string): URL {
  const url = new URL('https://statsapi.mlb.com/api/v1/schedule');
  url.searchParams.set('sportId', '1');
  url.searchParams.set('date', gameDateUtc.slice(0, 10));
  url.searchParams.set('hydrate', 'lineups');
  return url;
}

export async function fetchMlbStatsProjectedLineup(
  input: Readonly<FetchMlbStatsProjectedLineupInput>,
): Promise<MlbStatsProjectedLineupResult> {
  const targetTimestamp = finiteTimestamp(input.gameDateUtc, 'gameDateUtc');
  const homeTeamName = nonemptyString(input.homeTeamName, 'homeTeamName');
  const awayTeamName = nonemptyString(input.awayTeamName, 'awayTeamName');
  if (
    !Number.isSafeInteger(input.maximumStartDifferenceMilliseconds) ||
    input.maximumStartDifferenceMilliseconds < 0
  ) {
    throw new RangeError(
      'maximumStartDifferenceMilliseconds must be a nonnegative safe integer.',
    );
  }

  const url = buildRequestUrl(new Date(targetTimestamp).toISOString());
  const fetchImpl = input.fetchImpl ?? fetch;
  const response = await fetchImpl(url);
  const rawText = await response.text();
  if (!response.ok) {
    throw new Error(
      `MLB Stats projected lineup returned HTTP ${response.status} ${response.statusText}.`,
    );
  }
  let body: unknown;
  try {
    body = JSON.parse(rawText);
  } catch {
    throw new Error('MLB Stats projected lineup returned malformed JSON.');
  }
  const sourceCapturedAt = (input.now ?? (() => new Date()))().toISOString();
  const sourceSnapshotSha256 = sha256(rawText);
  const common = Object.freeze({
    sourceVersion: MLB_STATS_PROJECTED_LINEUP_SOURCE_VERSION,
    provider: MLB_STATS_PROJECTED_LINEUP_PROVIDER,
    sourceCapturedAt,
    sourceSnapshotSha256,
    requestUrl: url.toString(),
  });

  const schedule = object(body, 'MLB Stats schedule');
  const dates = array(schedule['dates'], 'MLB Stats schedule.dates');
  const candidates: Array<{
    readonly providerGamePk: number;
    readonly gameDateUtc: string;
    readonly homeTeamName: string;
    readonly awayTeamName: string;
    readonly lineups: Record<string, unknown> | null;
    readonly differenceMilliseconds: number;
  }> = [];

  for (const [dateIndex, rawDate] of dates.entries()) {
    const date = object(rawDate, `dates[${dateIndex}]`);
    const games = array(date['games'], `dates[${dateIndex}].games`);
    for (const [gameIndex, rawGame] of games.entries()) {
      const label = `dates[${dateIndex}].games[${gameIndex}]`;
      const game = object(rawGame, label);
      const teams = object(game['teams'], `${label}.teams`);
      const homeSide = object(teams['home'], `${label}.teams.home`);
      const awaySide = object(teams['away'], `${label}.teams.away`);
      const home = object(homeSide['team'], `${label}.teams.home.team`);
      const away = object(awaySide['team'], `${label}.teams.away.team`);
      const candidateHome = nonemptyString(
        home['name'],
        `${label}.teams.home.team.name`,
      );
      const candidateAway = nonemptyString(
        away['name'],
        `${label}.teams.away.team.name`,
      );
      if (candidateHome !== homeTeamName || candidateAway !== awayTeamName) continue;
      const gameDateUtc = new Date(
        finiteTimestamp(
          nonemptyString(game['gameDate'], `${label}.gameDate`),
          `${label}.gameDate`,
        ),
      ).toISOString();
      const differenceMilliseconds = Math.abs(
        Date.parse(gameDateUtc) - targetTimestamp,
      );
      if (differenceMilliseconds > input.maximumStartDifferenceMilliseconds) {
        continue;
      }
      const rawLineups = game['lineups'];
      candidates.push(
        Object.freeze({
          providerGamePk: positiveInteger(game['gamePk'], `${label}.gamePk`),
          gameDateUtc,
          homeTeamName: candidateHome,
          awayTeamName: candidateAway,
          lineups:
            rawLineups === undefined || rawLineups === null
              ? null
              : object(rawLineups, `${label}.lineups`),
          differenceMilliseconds,
        }),
      );
    }
  }

  const uniqueGamePks = [...new Set(candidates.map((candidate) => candidate.providerGamePk))];
  if (uniqueGamePks.length === 0) {
    return Object.freeze({ ...common, status: 'no-match' });
  }
  if (uniqueGamePks.length > 1) {
    throw new Error(
      `MLB Stats projected lineup game match is ambiguous across gamePk values ${uniqueGamePks.join(', ')}.`,
    );
  }
  candidates.sort(
    (left, right) =>
      left.differenceMilliseconds - right.differenceMilliseconds ||
      left.providerGamePk - right.providerGamePk,
  );
  const selected = candidates[0];
  if (selected === undefined) {
    return Object.freeze({ ...common, status: 'no-match' });
  }
  if (selected.lineups === null) {
    return Object.freeze({ ...common, status: 'unavailable' });
  }
  const homePlayers = lineupPlayers(
    selected.lineups['homePlayers'],
    'lineups.homePlayers',
    selected.homeTeamName,
  );
  const awayPlayers = lineupPlayers(
    selected.lineups['awayPlayers'],
    'lineups.awayPlayers',
    selected.awayTeamName,
  );
  const players = Object.freeze([...homePlayers, ...awayPlayers]);
  if (players.length === 0) {
    return Object.freeze({ ...common, status: 'unavailable' });
  }

  return Object.freeze({
    ...common,
    status: 'available',
    providerGamePk: selected.providerGamePk,
    gameDateUtc: selected.gameDateUtc,
    homeTeamName: selected.homeTeamName,
    awayTeamName: selected.awayTeamName,
    players,
  });
}
