import {
  settleObservedDiscreteStatisticV1,
  type ObservedSettlementOutcome,
} from '../core/index.js';
import {
  emptyProductCategorySectionsV1,
  PRODUCT_DISPLAY_BOARD_VERSION,
  type ProductCategoryDisplaySection,
} from './product-display-contract.js';
import type { ResearchDisplayArchiveRepository } from './research-display-archive.js';
import { readResearchProductBoardV2 } from './research-product-board.js';
import {
  readLatestHhrDisplayBoard,
  type HhrDisplayArchiveRepository,
  type HhrDisplayBoard,
  type HhrDisplayBoardPick,
  type HhrDisplayLastFiveGame,
} from './hhr-display-board.js';

export interface HhrDisplayUiLastFiveGame extends HhrDisplayLastFiveGame {
  readonly selectedSideOutcome: ObservedSettlementOutcome;
}

export interface HhrDisplayUiPick extends HhrDisplayBoardPick {
  readonly lastFiveGames: readonly HhrDisplayUiLastFiveGame[];
}

export interface HhrCumulativePerformanceSummary {
  readonly picksGraded: number;
  readonly wins: number;
  readonly losses: number;
  readonly voids: number;
  readonly decidedPicks: number;
  readonly observedWinRate: number | null;
  readonly predictedMeanWinProbability: number | null;
  readonly observedMinusPredicted: number | null;
  readonly expectedWins: number;
  readonly actualMinusExpectedWins: number;
  readonly binaryBrier: number | null;
  readonly binaryLogLoss: number | null;
}

export interface HhrCumulativeCalibrationBand extends HhrCumulativePerformanceSummary {
  readonly label: string;
  readonly lowerInclusive: number;
  readonly upperExclusive: number | null;
  readonly evidenceStatus: 'sufficient' | 'insufficient';
}

export interface HhrCumulativeLineEvidence {
  readonly lineCohort: '0.5' | '1.5' | '2.5+';
  readonly selectedSideRowsBeforeDedup: number;
  readonly supersededSelectedSideRows: number;
  readonly calibrationEligiblePicksBeforeDedup: number;
  readonly summary: HhrCumulativePerformanceSummary;
  readonly calibrationEligiblePicks: number;
  readonly calibration: readonly HhrCumulativeCalibrationBand[];
  readonly evidenceStatus: 'sufficient' | 'insufficient';
  readonly minimumCountGatePassed: boolean;
  readonly ownerDecisionRequired: true;
  readonly productionEnabled: false;
  readonly rankingEnabled: false;
}

export interface HhrCumulativeDisplayEvidence {
  readonly displayEvidenceVersion: 1;
  readonly displayEvidenceContract: 'phase3-hhr-cumulative-display-v1';
  readonly sourceReportVersion: 1;
  readonly sourceReportType: 'm10-hhr-cumulative-selected-side-v1';
  readonly generatedAt: string;
  readonly sourceSetSha256: string;
  readonly archivesIncluded: number;
  readonly selectedSide: Readonly<{
    deduplicationVersion: string;
    deduplicationIdentity: readonly [
      'providerGameId',
      'providerPlayerId',
      'providerMarketKey',
      'offerType',
      'postedLine',
    ];
    deduplicationWinnerRule: 'most-recent-capture-timestamp-only';
    selectedSideRowsBeforeDedup: number;
    retainedSelectedSideRows: number;
    supersededSelectedSideRows: number;
    calibrationEligiblePicksBeforeDedup: number;
    summary: HhrCumulativePerformanceSummary;
    calibrationEligiblePicks: number;
    calibration: readonly HhrCumulativeCalibrationBand[];
    perLine: Readonly<Record<'0.5' | '1.5' | '2.5+', HhrCumulativeLineEvidence>>;
  }>;
  readonly safety: Readonly<{
    productionEnabled: false;
    rankingEnabled: false;
    evidenceOnly: true;
    ownerDecisionRequired: true;
    archivesModified: false;
    deepLineCohort: '2.5+';
    minimumCalibrationBucketCount: number;
  }>;
}

export interface HhrCumulativeDisplayEvidenceRepository {
  readLatest(): Promise<HhrCumulativeDisplayEvidence | null>;
}

export type HhrDisplayCumulativeEvidence =
  | Readonly<{
      available: false;
      unavailableReason:
        | 'no-hhr-cumulative-display-evidence'
        | 'invalid-hhr-cumulative-display-evidence';
    }>
  | Readonly<HhrCumulativeDisplayEvidence & {
      available: true;
      unavailableReason: null;
    }>;

export interface ProductArchivedEvidenceGroup {
  readonly title: string;
  readonly market: 'Hits + Runs + RBIs';
  readonly offerType: 'alternate';
  readonly picks: readonly HhrDisplayUiPick[];
}

export interface ProductArchivedEvidence {
  readonly market: 'Hits + Runs + RBIs';
  readonly productionValidated: false;
  readonly rankingEnabled: false;
  readonly notice: string;
  readonly capturedAt: string;
  readonly groups: readonly ProductArchivedEvidenceGroup[];
}

export interface HhrDisplayUiBoard extends HhrDisplayBoard {
  readonly productBoardVersion: typeof PRODUCT_DISPLAY_BOARD_VERSION;
  readonly categories: readonly ProductCategoryDisplaySection[];
  readonly archivedEvidence: ProductArchivedEvidence;
  readonly hhr25LowerAlternates: readonly HhrDisplayUiPick[];
  readonly hhr05HigherAlternates: readonly HhrDisplayUiPick[];
  readonly cumulativeEvidence: HhrDisplayCumulativeEvidence;
}

function toUiPick(pick: HhrDisplayBoardPick): HhrDisplayUiPick {
  const lastFiveGames = Object.freeze(pick.lastFiveGames.map((game) => Object.freeze({
    ...game,
    selectedSideOutcome: settleObservedDiscreteStatisticV1({
      observedStatistic: game.hrr,
      line: pick.postedLine,
      selectedSide: pick.selectedSide,
    }).outcome,
  })));
  return Object.freeze({ ...pick, lastFiveGames });
}

async function readCumulativeEvidence(
  repository: HhrCumulativeDisplayEvidenceRepository | undefined,
): Promise<HhrDisplayCumulativeEvidence> {
  if (repository === undefined) {
    return Object.freeze({
      available: false,
      unavailableReason: 'no-hhr-cumulative-display-evidence',
    });
  }
  try {
    const evidence = await repository.readLatest();
    if (evidence === null) {
      return Object.freeze({
        available: false,
        unavailableReason: 'no-hhr-cumulative-display-evidence',
      });
    }
    return Object.freeze({
      ...evidence,
      available: true,
      unavailableReason: null,
    });
  } catch {
    return Object.freeze({
      available: false,
      unavailableReason: 'invalid-hhr-cumulative-display-evidence',
    });
  }
}

function archivedEvidence(
  capturedAt: string,
  lower: readonly HhrDisplayUiPick[],
  higher: readonly HhrDisplayUiPick[],
): ProductArchivedEvidence {
  return Object.freeze({
    market: 'Hits + Runs + RBIs',
    productionValidated: false,
    rankingEnabled: false,
    notice:
      'Archived model evidence — probabilities are not production-calibrated.',
    capturedAt,
    groups: Object.freeze([
      Object.freeze({
        title: '2.5 Lower alternate evidence',
        market: 'Hits + Runs + RBIs' as const,
        offerType: 'alternate' as const,
        picks: lower,
      }),
      Object.freeze({
        title: '0.5 Higher alternate evidence',
        market: 'Hits + Runs + RBIs' as const,
        offerType: 'alternate' as const,
        picks: higher,
      }),
    ]),
  });
}

export async function readLatestHhrDisplayUiBoard(
  repository: HhrDisplayArchiveRepository,
  cumulativeRepository?: HhrCumulativeDisplayEvidenceRepository,
  researchRepository?: ResearchDisplayArchiveRepository,
): Promise<HhrDisplayUiBoard> {
  const board = await readLatestHhrDisplayBoard(repository);
  const cumulativeEvidence = await readCumulativeEvidence(cumulativeRepository);
  const hhr25LowerAlternates = Object.freeze(board.hhr25LowerAlternates.map(toUiPick));
  const hhr05HigherAlternates = Object.freeze(board.hhr05HigherAlternates.map(toUiPick));
  const categories =
    researchRepository === undefined
      ? emptyProductCategorySectionsV1()
      : (await readResearchProductBoardV2(researchRepository)).categories;
  return Object.freeze({
    ...board,
    productBoardVersion: PRODUCT_DISPLAY_BOARD_VERSION,
    categories,
    archivedEvidence: archivedEvidence(
      board.capturedAt,
      hhr25LowerAlternates,
      hhr05HigherAlternates,
    ),
    hhr25LowerAlternates,
    hhr05HigherAlternates,
    cumulativeEvidence,
  });
}
