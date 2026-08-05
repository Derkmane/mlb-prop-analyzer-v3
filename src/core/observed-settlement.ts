import type { SelectedSide } from '../domain/selected-side.js';
import type { SettlementResult } from '../domain/settlement.js';
import { settleDiscreteStatistic } from './settlement.js';

export const OBSERVED_DISCRETE_SETTLEMENT_VERSION =
  'observed-discrete-statistic-settlement-v1' as const;

export type ObservedSettlementOutcome = 'win' | 'loss' | 'void';

export interface ObservedDiscreteSettlementV1 {
  readonly version: typeof OBSERVED_DISCRETE_SETTLEMENT_VERSION;
  readonly observedStatistic: number;
  readonly line: number;
  readonly selectedSide: SelectedSide;
  readonly outcome: ObservedSettlementOutcome;
  readonly settlement: SettlementResult;
}

/**
 * Grades one observed non-negative integer through the canonical discrete
 * settlement engine by supplying a degenerate probability distribution.
 */
export function settleObservedDiscreteStatisticV1(input: Readonly<{
  observedStatistic: number;
  line: number;
  selectedSide: SelectedSide;
}>): ObservedDiscreteSettlementV1 {
  if (
    !Number.isInteger(input.observedStatistic) ||
    input.observedStatistic < 0
  ) {
    throw new RangeError(
      'observed statistic must be a non-negative integer',
    );
  }
  const probabilities = Array.from(
    { length: input.observedStatistic + 1 },
    (_, index) => (index === input.observedStatistic ? 1 : 0),
  );
  const settlement = settleDiscreteStatistic({
    eligibilityProbability: 1,
    line: input.line,
    selectedSide: input.selectedSide,
    statisticDistribution: Object.freeze({
      probabilities: Object.freeze(probabilities),
    }),
  });
  const outcome: ObservedSettlementOutcome =
    settlement.winProbability === 1
      ? 'win'
      : settlement.lossProbability === 1
        ? 'loss'
        : 'void';

  return Object.freeze({
    version: OBSERVED_DISCRETE_SETTLEMENT_VERSION,
    observedStatistic: input.observedStatistic,
    line: settlement.line,
    selectedSide: settlement.selectedSide,
    outcome,
    settlement,
  });
}
