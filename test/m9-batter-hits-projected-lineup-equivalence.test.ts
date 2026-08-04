import assert from 'node:assert/strict';
import test from 'node:test';

import {
  connectFrozenBatterHitsProbabilityOutput,
  connectM8BatterHitsBaseDistribution,
  connectM8BatterHitsBaseEvaluationFromDistribution,
} from '../src/composition/index.js';
import type { NormalizedBatterHitsBoardOffer } from '../src/features/batter-hits/index.js';
import {
  M9_SOURCE_CAPTURED_AT,
  m9FinalProbabilityInput,
  m9ObservationFor,
  m9Offer,
  m9PregameBoard,
  m9SyntheticOffer,
} from './helpers/m9-batter-hits-final-runtime-fixture.js';

function lineupStatusFromCandidate(
  result: Awaited<ReturnType<typeof connectFrozenBatterHitsProbabilityOutput>>,
): unknown {
  return result.candidate.featureData.values.batterHits?.['lineupStatus'];
}

test('projected and confirmed versions of one active lineup produce identical final probabilities', async () => {
  const board = m9PregameBoard();
  const offer = m9Offer(board, 'Gavin Sheets', 'baseline', 0.5, 'higher');
  const projected = await connectFrozenBatterHitsProbabilityOutput(
    await m9FinalProbabilityInput(board, offer, 'projected'),
  );
  const confirmed = await connectFrozenBatterHitsProbabilityOutput(
    await m9FinalProbabilityInput(board, offer, 'confirmed'),
  );

  assert.deepEqual(projected.distribution, confirmed.distribution);
  assert.deepEqual(
    projected.candidate.statisticDistribution,
    confirmed.candidate.statisticDistribution,
  );
  assert.equal(projected.candidate.eligibilityProbability, 1);
  assert.equal(projected.candidate.pWin, confirmed.candidate.pWin);
  assert.equal(projected.candidate.pLoss, confirmed.candidate.pLoss);
  assert.equal(projected.candidate.pVoid, confirmed.candidate.pVoid);
  assert.equal(
    projected.candidate.pWinGivenGrades,
    confirmed.candidate.pWinGivenGrades,
  );
  assert.equal(lineupStatusFromCandidate(projected), 'projected');
  assert.equal(lineupStatusFromCandidate(confirmed), 'confirmed');
});

test('M8 base evaluation remains audit-only while public output preserves it beside D_final', async () => {
  const originalBoard = m9PregameBoard();
  const baselineOffer = m9Offer(
    originalBoard,
    'Gavin Sheets',
    'baseline',
    0.5,
    'higher',
  );
  const alternateOffer = m9SyntheticOffer(baselineOffer, 'lower', 1.5);
  const integerHigher: NormalizedBatterHitsBoardOffer = Object.freeze({
    ...baselineOffer,
    line: 1,
    selectedSide: 'higher',
    rawSide: 'Over',
  });
  const integerLower: NormalizedBatterHitsBoardOffer = Object.freeze({
    ...baselineOffer,
    line: 1,
    selectedSide: 'lower',
    rawSide: 'Under',
  });
  const board = Object.freeze({
    ...originalBoard,
    offers: Object.freeze([
      ...originalBoard.offers,
      alternateOffer,
      integerHigher,
      integerLower,
    ]),
  });
  const observation = m9ObservationFor(baselineOffer);

  const finalResult = await connectFrozenBatterHitsProbabilityOutput(
    await m9FinalProbabilityInput(board, baselineOffer),
  );
  const baseDistribution = await connectM8BatterHitsBaseDistribution({
    pregameBoard: board,
    offer: baselineOffer,
    observation,
    evaluatedAt: M9_SOURCE_CAPTURED_AT,
  });
  const baselineEvaluation =
    connectM8BatterHitsBaseEvaluationFromDistribution({
      pregameBoard: board,
      offer: baselineOffer,
      baseDistribution,
    });
  const alternateEvaluation =
    connectM8BatterHitsBaseEvaluationFromDistribution({
      pregameBoard: board,
      offer: alternateOffer,
      baseDistribution,
    });
  const integerHigherEvaluation =
    connectM8BatterHitsBaseEvaluationFromDistribution({
      pregameBoard: board,
      offer: integerHigher,
      baseDistribution,
    });
  const integerLowerEvaluation =
    connectM8BatterHitsBaseEvaluationFromDistribution({
      pregameBoard: board,
      offer: integerLower,
      baseDistribution,
    });

  assert.deepEqual(baseDistribution, finalResult.baseEvaluation.baseDistribution);
  assert.deepEqual(baselineEvaluation, finalResult.baseEvaluation);
  assert.notDeepEqual(
    finalResult.candidate.statisticDistribution,
    baseDistribution.dBase.statisticDistribution,
  );
  assert.notEqual(
    finalResult.candidate.pWinGivenGrades,
    baselineEvaluation.probabilities.pBase,
  );
  assert.strictEqual(alternateEvaluation.dBase, baseDistribution.dBase);
  assert.equal(alternateEvaluation.offer.selectedSide, 'lower');
  assert.equal(alternateEvaluation.offer.line, 1.5);
  assert.equal(integerHigherEvaluation.probabilities.pVoid > 0, true);
  assert.equal(
    integerHigherEvaluation.probabilities.pVoid,
    integerLowerEvaluation.probabilities.pVoid,
  );
  assert.equal(
    integerHigherEvaluation.probabilities.pWin,
    integerLowerEvaluation.probabilities.pLoss,
  );
  assert.equal(
    integerHigherEvaluation.probabilities.pLoss,
    integerLowerEvaluation.probabilities.pWin,
  );
  assert.equal(baselineEvaluation.discoveryDecision, 'AUDIT_ONLY_UNTHRESHOLDED');
  assert.equal(baselineEvaluation.tauSoft, null);
  assert.equal(baselineEvaluation.softnessMargin, null);
});

test('M8 base distribution is projected-status invariant and rejects contract tampering', async () => {
  const board = m9PregameBoard();
  const offer = m9Offer(board, 'Gavin Sheets', 'baseline', 0.5, 'higher');

  const projected = await connectM8BatterHitsBaseDistribution({
    pregameBoard: board,
    offer,
    observation: m9ObservationFor(offer, 'projected'),
    evaluatedAt: M9_SOURCE_CAPTURED_AT,
  });
  const confirmed = await connectM8BatterHitsBaseDistribution({
    pregameBoard: board,
    offer,
    observation: m9ObservationFor(offer, 'confirmed'),
    evaluatedAt: M9_SOURCE_CAPTURED_AT,
  });
  const confirmedAgain = await connectM8BatterHitsBaseDistribution({
    pregameBoard: board,
    offer,
    observation: m9ObservationFor(offer, 'confirmed'),
    evaluatedAt: M9_SOURCE_CAPTURED_AT,
  });

  assert.deepEqual(projected.dBase, confirmed.dBase);
  assert.equal(projected.baseballInputs.lineupStatus, 'projected');
  assert.equal(confirmed.baseballInputs.lineupStatus, 'confirmed');
  assert.equal(projected.sharedScenarioIdentity, confirmed.sharedScenarioIdentity);
  assert.deepEqual(confirmedAgain, confirmed);
  assert.match(confirmed.baseDistributionSha256, /^[a-f0-9]{64}$/u);

  const tampered = Object.freeze({
    ...confirmed,
    baseDistributionContract: 'tampered-contract',
  }) as unknown as typeof confirmed;
  assert.throws(
    () =>
      connectM8BatterHitsBaseEvaluationFromDistribution({
        pregameBoard: board,
        offer,
        baseDistribution: tampered,
      }),
    /base distribution contract/u,
  );
});
