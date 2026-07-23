import type { SettlementInput, SettlementResult } from '../domain/settlement.js';
import { isSelectedSide } from '../domain/selected-side.js';
import {
  validateProbability,
  validateProbabilityMassFunction,
  validateProbabilityVector,
} from './probability-validation.js';

function validateLine(line: number): number {
  if (!Number.isFinite(line)) {
    throw new RangeError('line must be finite');
  }

  if (line < 0) {
    throw new RangeError('line must be non-negative');
  }

  return line;
}

export function settleDiscreteStatistic(
  input: SettlementInput,
): SettlementResult {
  const distribution = validateProbabilityMassFunction(
    input.statisticDistribution,
    'settlement statistic distribution',
  );
  const eligibilityProbability = validateProbability(
    input.eligibilityProbability,
    'eligibility probability',
  );
  const line = validateLine(input.line);

  if (!isSelectedSide(input.selectedSide)) {
    throw new RangeError('selected side must be higher or lower');
  }

  let probabilityBelowLine = 0;
  let probabilityAtLine = 0;
  let probabilityAboveLine = 0;

  for (const [statisticValue, mass] of distribution.probabilities.entries()) {
    if (statisticValue < line) {
      probabilityBelowLine += mass;
    } else if (statisticValue > line) {
      probabilityAboveLine += mass;
    } else {
      probabilityAtLine += mass;
    }
  }

  const conditionalWinProbability =
    input.selectedSide === 'higher'
      ? probabilityAboveLine
      : probabilityBelowLine;
  const conditionalLossProbability =
    input.selectedSide === 'higher'
      ? probabilityBelowLine
      : probabilityAboveLine;
  const winProbability = eligibilityProbability * conditionalWinProbability;
  const lossProbability = eligibilityProbability * conditionalLossProbability;
  const voidProbability =
    1 - eligibilityProbability + eligibilityProbability * probabilityAtLine;

  validateProbabilityVector(
    [winProbability, lossProbability, voidProbability],
    'win/loss/void probabilities',
  );

  const conditionalGradedProbability =
    conditionalWinProbability + conditionalLossProbability;
  const winProbabilityGivenGrades =
    conditionalGradedProbability === 0
      ? null
      : conditionalWinProbability / conditionalGradedProbability;

  if (winProbabilityGivenGrades !== null) {
    validateProbability(
      winProbabilityGivenGrades,
      'win probability given grades',
    );
  }

  return Object.freeze({
    eligibilityProbability,
    line,
    selectedSide: input.selectedSide,
    winProbability,
    lossProbability,
    voidProbability,
    winProbabilityGivenGrades,
  });
}
