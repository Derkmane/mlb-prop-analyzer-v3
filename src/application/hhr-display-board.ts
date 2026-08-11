export const HHR_DISPLAY_BOARD_VERSION = 'phase3-hhr-display-board-v1' as const;

export interface HhrDisplayLastFiveGame {
  readonly gameDate: string;
  readonly opponentTeamName: string;
  readonly opponentAbbreviation: string | null;
  readonly homeOrAway: 'home' | 'away';
  readonly hits: number;
  readonly runs: number;
  readonly rbi: number;
  readonly hrr: number;
  readonly atBats: number;
  readonly plateAppearances: number;
  readonly totalBases: number;
}

export interface HhrDisplayOpposingStarter {
  readonly name: string | null;
  readonly throwingHand: string | null;
  readonly era: number | null;
  readonly last10: Readonly<{
    starts: number;
    inningsPitched: string;
    earnedRuns: number;
    strikeouts: number;
    whip: number | null;
  }>;
  readonly season: Readonly<{
    inningsPitched: string | number | null;
    earnedRuns: number | null;
    strikeouts: number | null;
    whip: number | null;
  }>;
}

export interface HhrDisplayArchiveEnrichmentRecord {
  readonly providerGameId: number;
  readonly providerPlayerId: number;
  readonly lastFiveGames: Readonly<{
    count: number;
    games: readonly HhrDisplayLastFiveGame[];
    failureReason: string | null;
  }>;
  readonly opposingStarter:
    | HhrDisplayOpposingStarter
    | Readonly<{ failureReason: string }>;
}

export interface HhrDisplayArchiveRow {
  readonly rank: number;
  readonly providerEventId: string;
  readonly providerGameId: number;
  readonly providerPlayerId: number;
  readonly providerTeamId: number;
  readonly playerName: string;
  readonly teamName: string;
  readonly homeTeamName: string;
  readonly awayTeamName: string;
  readonly eventCommenceTime: string;
  readonly baseMarketKey: string;
  readonly providerMarketKey: string;
  readonly marketLabel: string;
  readonly offerType: 'baseline' | 'alternate';
  readonly settlementStatistic: string;
  readonly selectedSide: 'higher' | 'lower';
  readonly postedLine: number;
  readonly americanPrice: number | null;
  readonly multiplier: number | null;
  readonly pWin: number;
  readonly pLoss: number;
  readonly pVoid: number;
  readonly pWinGivenGrades: number;
  readonly lineupStatus: string;
}

export interface HhrDisplayArchive {
  readonly captureKey: string;
  readonly capturedAt: string;
  readonly modelVersion: string;
  readonly distributionBuilderVersion: string;
  readonly rows: readonly HhrDisplayArchiveRow[];
  readonly enrichmentByGamePlayerKey: Readonly<Record<string, HhrDisplayArchiveEnrichmentRecord>>;
}

export interface HhrDisplayArchiveRepository {
  readLatest(): Promise<HhrDisplayArchive>;
}

export interface HhrDisplayBoardPick {
  readonly persistedRank: number;
  readonly player: string;
  readonly team: string;
  readonly opponent: string;
  readonly gameTime: string;
  readonly opposingStarter: HhrDisplayOpposingStarter | null;
  readonly opposingStarterFailureReason: string | null;
  readonly postedLine: number;
  readonly selectedSide: 'higher' | 'lower';
  readonly pWinGivenGrades: number;
  readonly pVoid: number;
  readonly lineupStatus: string;
  readonly multiplier: number | null;
  readonly americanPrice: number | null;
  readonly lastFiveGames: readonly HhrDisplayLastFiveGame[];
  readonly lastFiveGamesFailureReason: string | null;
}

export interface HhrDisplayBoard {
  readonly boardVersion: typeof HHR_DISPLAY_BOARD_VERSION;
  readonly captureKey: string;
  readonly capturedAt: string;
  readonly modelVersion: string;
  readonly distributionBuilderVersion: string;
  readonly hhr25LowerAlternates: readonly HhrDisplayBoardPick[];
  readonly hhr05HigherAlternates: readonly HhrDisplayBoardPick[];
}

function opponent(row: HhrDisplayArchiveRow): string {
  if (row.teamName === row.homeTeamName) return row.awayTeamName;
  if (row.teamName === row.awayTeamName) return row.homeTeamName;
  throw new Error('HHR display row team does not agree with its home/away teams.');
}

function toPick(
  row: HhrDisplayArchiveRow,
  enrichmentByKey: HhrDisplayArchive['enrichmentByGamePlayerKey'],
): HhrDisplayBoardPick {
  const key = `${row.providerGameId}:${row.providerPlayerId}`;
  const enrichment = enrichmentByKey[key];
  const exactEnrichment = enrichment?.providerGameId === row.providerGameId &&
    enrichment.providerPlayerId === row.providerPlayerId ? enrichment : undefined;
  const starter = exactEnrichment?.opposingStarter;
  const starterFailure = starter !== undefined && 'failureReason' in starter
    ? starter.failureReason
    : null;
  return Object.freeze({
    persistedRank: row.rank,
    player: row.playerName,
    team: row.teamName,
    opponent: opponent(row),
    gameTime: row.eventCommenceTime,
    opposingStarter: starter !== undefined && !('failureReason' in starter) ? starter : null,
    opposingStarterFailureReason: starterFailure,
    postedLine: row.postedLine,
    selectedSide: row.selectedSide,
    pWinGivenGrades: row.pWinGivenGrades,
    pVoid: row.pVoid,
    lineupStatus: row.lineupStatus,
    multiplier: row.multiplier,
    americanPrice: row.americanPrice,
    lastFiveGames: exactEnrichment?.lastFiveGames.games ?? Object.freeze([]),
    lastFiveGamesFailureReason: exactEnrichment?.lastFiveGames.failureReason ?? 'missing-player-enrichment',
  });
}

function exactList(
  archive: HhrDisplayArchive,
  postedLine: 2.5 | 0.5,
  selectedSide: 'lower' | 'higher',
): readonly HhrDisplayBoardPick[] {
  const persistedOrder = archive.rows
    .filter((row) => row.offerType === 'alternate' && row.postedLine === postedLine &&
      row.selectedSide === selectedSide)
    .sort((left, right) => left.rank - right.rank);
  const seenPlayers = new Set<number>();
  const selected: HhrDisplayBoardPick[] = [];
  for (const row of persistedOrder) {
    if (seenPlayers.has(row.providerPlayerId)) continue;
    seenPlayers.add(row.providerPlayerId);
    selected.push(toPick(row, archive.enrichmentByGamePlayerKey));
    if (selected.length === 20) break;
  }
  return Object.freeze(selected);
}

/** Reads already-ranked evidence only; it cannot call providers or probability code. */
export async function readLatestHhrDisplayBoard(
  repository: HhrDisplayArchiveRepository,
): Promise<HhrDisplayBoard> {
  const archive = await repository.readLatest();
  return Object.freeze({
    boardVersion: HHR_DISPLAY_BOARD_VERSION,
    captureKey: archive.captureKey,
    capturedAt: archive.capturedAt,
    modelVersion: archive.modelVersion,
    distributionBuilderVersion: archive.distributionBuilderVersion,
    hhr25LowerAlternates: exactList(archive, 2.5, 'lower'),
    hhr05HigherAlternates: exactList(archive, 0.5, 'higher'),
  });
}
