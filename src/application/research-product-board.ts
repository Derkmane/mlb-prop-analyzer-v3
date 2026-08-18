import {
  HIGH_PROBABILITY_ALTLINE_CATEGORY_ID,
  HIGH_PROBABILITY_BASELINE_CATEGORY_ID,
  OPPORTUNITY_MINER_CATEGORY_ID,
  indicativeImpliedProbabilityFromAmericanPrice,
  selectHighProbabilityAltlinePropsV1,
  selectHighProbabilityBaselinePropsV1,
  selectOpportunityMinerFavoritesV1,
  selectTopFiveV1,
  type CategoryOfferInput,
} from '../categories/index.js';
import { settleObservedDiscreteStatisticV1 } from '../core/index.js';
import type {
  ResearchDisplayArchive,
  ResearchDisplayArchiveRepository,
  ResearchDisplayRow,
} from '../adapters/display-archives/research-display-archive-repository.js';
import {
  PRODUCT_DISPLAY_BOARD_VERSION,
  PRODUCT_RESEARCH_LABEL,
  productCategorySectionV2,
  type ProductCalibrationDisclosure,
  type ProductCategoryDisplaySection,
  type ProductDisplayPick,
  type ProductLastFiveResult,
  type ProductStarterContext,
} from './product-display-contract.js';

interface ResearchRankCandidate extends ProductDisplayPick {
  readonly playerId: string;
}

export interface ResearchProductBoardV2 {
  readonly productDisplayBoardVersion: typeof PRODUCT_DISPLAY_BOARD_VERSION;
  readonly disclosure: typeof PRODUCT_RESEARCH_LABEL;
  readonly productionCalibrated: false;
  readonly capturedAt: string | null;
  readonly sourceMarkets: readonly string[];
  readonly categories: readonly ProductCategoryDisplaySection[];
}

function objectOrNull(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function finiteOrNull(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function stringOrNull(value: unknown): string | null {
  return typeof value === 'string' && value.length > 0 ? value : null;
}

function scalarText(value: unknown): string | null {
  if (typeof value === 'string' && value.length > 0) return value;
  if (typeof value === 'number' && Number.isFinite(value)) return String(value);
  return null;
}

function opponent(row: ResearchDisplayRow): string {
  if (row.teamName === row.homeTeamName) return row.awayTeamName;
  if (row.teamName === row.awayTeamName) return row.homeTeamName;
  return `${row.awayTeamName} @ ${row.homeTeamName}`;
}

function starterContext(row: ResearchDisplayRow): ProductStarterContext {
  const enrichment = row.enrichment;
  const starter = objectOrNull(enrichment?.['opposingStarter']);
  const last10 = objectOrNull(starter?.['last10']);
  const starts = finiteOrNull(last10?.['starts']);
  const innings = scalarText(last10?.['inningsPitched']);
  const strikeouts = finiteOrNull(last10?.['strikeouts']);
  const whip = finiteOrNull(last10?.['whip']);
  const workloadParts = [
    starts === null ? null : `${starts} starts`,
    innings === null ? null : `${innings} IP`,
    strikeouts === null ? null : `${strikeouts} K`,
    whip === null ? null : `WHIP ${whip.toFixed(2)}`,
  ].filter((value): value is string => value !== null);

  return Object.freeze({
    name: stringOrNull(starter?.['name']),
    hand:
      stringOrNull(starter?.['throwingHand']) ??
      row.analysisContext.opposingStarterHand,
    era: finiteOrNull(starter?.['era']),
    kRate: null,
    recentWorkload: workloadParts.length === 0 ? null : workloadParts.join(' · '),
  });
}

function lastFive(row: ResearchDisplayRow): readonly ProductLastFiveResult[] {
  const lastFiveEnvelope = objectOrNull(row.enrichment?.['lastFiveGames']);
  const gamesValue = lastFiveEnvelope?.['games'];
  const games = Array.isArray(gamesValue) ? gamesValue : [];
  return Object.freeze(
    games.flatMap((raw) => {
      const game = objectOrNull(raw);
      if (game === null) return [];
      const actual = finiteOrNull(
        row.market === 'batter-hits' ? game['hits'] : game['hrr'],
      );
      const gameDate = stringOrNull(game['gameDate']);
      const gameOpponent =
        stringOrNull(game['opponentAbbreviation']) ??
        stringOrNull(game['opponentTeamName']);
      if (
        actual === null ||
        !Number.isInteger(actual) ||
        actual < 0 ||
        gameDate === null ||
        gameOpponent === null
      ) {
        return [];
      }
      const settlement = settleObservedDiscreteStatisticV1({
        observedStatistic: actual,
        line: row.postedLine,
        selectedSide: row.selectedSide,
      });
      return [
        Object.freeze({
          gameDate,
          opponent: gameOpponent,
          actual,
          outcome:
            settlement.outcome === 'win'
              ? ('cash' as const)
              : settlement.outcome === 'loss'
                ? ('miss' as const)
                : ('void' as const),
        }),
      ];
    }),
  );
}

function hhrCalibration(row: ResearchDisplayRow): ProductCalibrationDisclosure {
  if (row.postedLine === 0.5 && row.selectedSide === 'higher') {
    return Object.freeze({
      status: 'failed',
      cohort: '0.5 Higher',
      predicted: 0.6554,
      observed: 0.5412,
      decidedPicks: 85,
      message: 'Calibration agreement failed: model 65.5%, actual 54.1% (46/85).',
    });
  }
  if (row.postedLine === 1.5) {
    return Object.freeze({
      status: 'passed',
      cohort: '1.5 selected-side cohort',
      predicted: 0.555,
      observed: 0.559,
      decidedPicks: 322,
      message: 'Prospective cohort: model 55.5%, actual 55.9% (180/322).',
    });
  }
  if (row.postedLine >= 2.5 && row.selectedSide === 'lower') {
    return Object.freeze({
      status: 'failed',
      cohort: '2.5+ Lower',
      predicted: 0.6723,
      observed: 0.2727,
      decidedPicks: 11,
      message: 'Sample is insufficient and calibration agreement failed: model 67.2%, actual 27.3% (3/11).',
    });
  }
  return Object.freeze({
    status: 'pending',
    cohort: `${row.postedLine} ${row.selectedSide}`,
    predicted: null,
    observed: null,
    decidedPicks: null,
    message: 'No matching committed prospective calibration cohort is available yet.',
  });
}

function calibration(row: ResearchDisplayRow): ProductCalibrationDisclosure {
  if (row.market === 'batter-hhr') return hhrCalibration(row);
  return Object.freeze({
    status: 'pending',
    cohort: `Hits ${row.postedLine} ${row.selectedSide}`,
    predicted: null,
    observed: null,
    decidedPicks: null,
    message: 'Batter Hits prospective calibration evidence is still pending.',
  });
}

function productPick(row: ResearchDisplayRow): ResearchRankCandidate {
  const starter = starterContext(row);
  const batterSide = row.analysisContext.batterSide;
  return Object.freeze({
    playerId: String(row.providerPlayerId),
    player: row.playerName,
    team: row.teamName,
    opponent: opponent(row),
    gameTime: row.eventCommenceTime,
    market: row.market === 'batter-hits' ? 'Hits' : 'Hits + Runs + RBIs',
    postedLine: row.postedLine,
    selectedSide: row.selectedSide,
    pWin: row.pWin,
    pLoss: row.pLoss,
    pVoid: row.pVoid,
    pWinGivenGrades: row.pWinGivenGrades,
    probabilityLabel: PRODUCT_RESEARCH_LABEL,
    offerType: row.offerType,
    lineupStatus: row.lineupStatus,
    capturedAt: row.capturedAt,
    expectedPlateAppearances: row.analysisContext.expectedPlateAppearances,
    lineupSlot: row.analysisContext.lineupSlot,
    opposingStarter: starter,
    platoon:
      batterSide === null || starter.hand === null
        ? null
        : `${batterSide} batter vs ${starter.hand} starter`,
    teamImpliedRunTotal: row.analysisContext.teamImpliedRunTotal,
    park: row.analysisContext.venue,
    lastFive: lastFive(row),
    calibration: calibration(row),
  });
}

function offerInput(
  row: ResearchDisplayRow,
  candidate: ResearchRankCandidate,
): CategoryOfferInput<ResearchRankCandidate> {
  const postedImpliedProbability =
    row.americanPrice !== null && Number.isInteger(row.americanPrice) && row.americanPrice !== 0
      ? indicativeImpliedProbabilityFromAmericanPrice(row.americanPrice)
      : null;
  return Object.freeze({
    candidate,
    offerType: row.offerType,
    americanPrice: row.americanPrice,
    multiplier: row.multiplier,
    postedImpliedProbability,
    priceEdge:
      postedImpliedProbability === null
        ? null
        : row.pWinGivenGrades - postedImpliedProbability,
  });
}

function newestTimestamp(archives: readonly ResearchDisplayArchive[]): string | null {
  let newest: string | null = null;
  for (const archive of archives) {
    if (newest === null || archive.capturedAt > newest) newest = archive.capturedAt;
  }
  return newest;
}

export async function readResearchProductBoardV2(
  repository: ResearchDisplayArchiveRepository,
): Promise<ResearchProductBoardV2> {
  const archives = (
    await Promise.all([
      repository.readLatest('batter-hits'),
      repository.readLatest('batter-hhr'),
    ])
  ).filter((archive): archive is ResearchDisplayArchive => archive !== null);

  const rows = archives.flatMap((archive) => archive.rows);
  const candidateByRow = new Map(
    rows.map((row) => [row, productPick(row)] as const),
  );
  const offerInputs = rows.map((row) =>
    offerInput(row, candidateByRow.get(row) as ResearchRankCandidate),
  );

  const baseline = selectHighProbabilityBaselinePropsV1(offerInputs);
  const altline = selectHighProbabilityAltlinePropsV1(offerInputs);
  const minerInputs = rows.flatMap((row) => {
    if (
      row.americanPrice === null ||
      !Number.isInteger(row.americanPrice) ||
      row.americanPrice === 0 ||
      row.multiplier === null ||
      row.multiplier <= 0
    ) {
      return [];
    }
    return [
      Object.freeze({
        candidate: candidateByRow.get(row) as ResearchRankCandidate,
        americanPrice: row.americanPrice,
        multiplier: row.multiplier,
      }),
    ];
  });
  const opportunity = selectOpportunityMinerFavoritesV1(minerInputs);

  const opportunityPicks = selectTopFiveV1(opportunity.eligibleCandidates).map(
    (candidate) => candidate as ProductDisplayPick,
  );
  const baselinePicks = selectTopFiveV1(baseline.eligibleCandidates).map(
    (input) => input.candidate,
  );
  const altlinePicks = selectTopFiveV1(altline.eligibleCandidates).map(
    (input) => input.candidate,
  );

  return Object.freeze({
    productDisplayBoardVersion: PRODUCT_DISPLAY_BOARD_VERSION,
    disclosure: PRODUCT_RESEARCH_LABEL,
    productionCalibrated: false,
    capturedAt: newestTimestamp(archives),
    sourceMarkets: Object.freeze(archives.map((archive) => archive.market)),
    categories: Object.freeze([
      productCategorySectionV2(OPPORTUNITY_MINER_CATEGORY_ID, opportunityPicks),
      productCategorySectionV2(HIGH_PROBABILITY_BASELINE_CATEGORY_ID, baselinePicks),
      productCategorySectionV2(HIGH_PROBABILITY_ALTLINE_CATEGORY_ID, altlinePicks),
    ]),
  });
}
