export type ResearchDisplayMarket = 'batter-hits' | 'batter-hhr';
export type ResearchOfferType = 'baseline' | 'alternate';
export type ResearchSelectedSide = 'higher' | 'lower';

export interface ResearchAnalysisContext {
  readonly expectedPlateAppearances: number | null;
  readonly lineupSlot: number | null;
  readonly batterSide: string | null;
  readonly opposingStarterHand: string | null;
  readonly venue: string | null;
  readonly teamImpliedRunTotal: number | null;
}

export interface ResearchDisplayRow {
  readonly market: ResearchDisplayMarket;
  readonly captureKey: string;
  readonly capturedAt: string;
  readonly modelVersion: string;
  readonly distributionBuilderVersion: string;
  readonly providerEventId: string;
  readonly providerGameId: number;
  readonly providerPlayerId: number;
  readonly playerName: string;
  readonly teamName: string;
  readonly homeTeamName: string;
  readonly awayTeamName: string;
  readonly eventCommenceTime: string;
  readonly providerMarketKey: string;
  readonly offerType: ResearchOfferType;
  readonly selectedSide: ResearchSelectedSide;
  readonly postedLine: number;
  readonly americanPrice: number | null;
  readonly multiplier: number | null;
  readonly pWin: number;
  readonly pLoss: number;
  readonly pVoid: number;
  readonly pWinGivenGrades: number;
  readonly lineupStatus: 'confirmed' | 'projected' | null;
  readonly analysisContext: ResearchAnalysisContext;
  readonly enrichment: Readonly<Record<string, unknown>> | null;
}

export interface ResearchDisplayArchive {
  readonly market: ResearchDisplayMarket;
  readonly captureKey: string;
  readonly capturedAt: string;
  readonly modelVersion: string;
  readonly distributionBuilderVersion: string;
  readonly rows: readonly ResearchDisplayRow[];
}

export interface ResearchDisplayArchiveRepository {
  readonly readLatest: (
    market: ResearchDisplayMarket,
  ) => Promise<ResearchDisplayArchive | null>;
}
