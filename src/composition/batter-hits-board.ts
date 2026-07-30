import {
  normalizeOddsApiBatterHitsBoard,
  type NormalizedOddsApiBatterHitsBoard,
  type OddsApiBatterHitsBoardInput,
} from '../adapters/index.js';

/**
 * Connects a captured The Odds API event snapshot to the strict normalized
 * Batter Hits board boundary. This step preserves offer identity only; it does
 * not build probabilities, authorize predictions, or rank props.
 */
export function connectNormalizedBatterHitsBoard(
  input: OddsApiBatterHitsBoardInput,
): NormalizedOddsApiBatterHitsBoard {
  return normalizeOddsApiBatterHitsBoard(input);
}
