import {
  settleObservedDiscreteStatisticV1,
  type ObservedSettlementOutcome,
} from '../core/index.js';
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

export interface HhrDisplayUiBoard extends HhrDisplayBoard {
  readonly hhr25LowerAlternates: readonly HhrDisplayUiPick[];
  readonly hhr05HigherAlternates: readonly HhrDisplayUiPick[];
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

/** Presentation-only enrichment; probabilities and persisted order are copied unchanged. */
export async function readLatestHhrDisplayUiBoard(
  repository: HhrDisplayArchiveRepository,
): Promise<HhrDisplayUiBoard> {
  const board = await readLatestHhrDisplayBoard(repository);
  return Object.freeze({
    ...board,
    hhr25LowerAlternates: Object.freeze(board.hhr25LowerAlternates.map(toUiPick)),
    hhr05HigherAlternates: Object.freeze(board.hhr05HigherAlternates.map(toUiPick)),
  });
}
