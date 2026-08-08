import assert from 'node:assert/strict';
import test from 'node:test';

import { rankPredictionCandidates } from '../dist/src/application/index.js';
import { connectFrozenBatterHitsProbabilityOutput } from '../dist/src/composition/index.js';
import { testOnlyRankingAuthorization } from '../scripts/print-m9-ranked-batter-hits-fixture.mjs';
import {
  m9FinalProbabilityInput,
  m9Offer,
  m9PregameBoard,
} from '../dist/test/helpers/m9-batter-hits-final-runtime-fixture.js';

test('lineupStatus is display-only: projected and confirmed candidates have identical probabilities and rank', async () => {
  const board = m9PregameBoard();
  const targetOffer = m9Offer(board, 'Gavin Sheets', 'baseline', 0.5, 'higher');
  const controlOffer = m9Offer(board, 'Fernando Tatis Jr.', 'alternate', 0.5, 'higher');

  const projected = await connectFrozenBatterHitsProbabilityOutput(
    await m9FinalProbabilityInput(board, targetOffer, 'projected'),
  );
  const confirmed = await connectFrozenBatterHitsProbabilityOutput(
    await m9FinalProbabilityInput(board, targetOffer, 'confirmed'),
  );
  const control = await connectFrozenBatterHitsProbabilityOutput(
    await m9FinalProbabilityInput(board, controlOffer, 'confirmed'),
  );

  assert.deepEqual(projected.distribution, confirmed.distribution);
  assert.equal(projected.candidate.pWin, confirmed.candidate.pWin);
  assert.equal(projected.candidate.pLoss, confirmed.candidate.pLoss);
  assert.equal(projected.candidate.pVoid, confirmed.candidate.pVoid);
  assert.equal(
    projected.candidate.pWinGivenGrades,
    confirmed.candidate.pWinGivenGrades,
  );
  assert.equal(
    projected.candidate.eligibilityProbability,
    confirmed.candidate.eligibilityProbability,
  );

  const projectedCandidates = [projected.candidate, control.candidate];
  const confirmedCandidates = [confirmed.candidate, control.candidate];
  const projectedRanking = rankPredictionCandidates({
    candidates: projectedCandidates,
    registries: testOnlyRankingAuthorization(projectedCandidates),
  });
  const confirmedRanking = rankPredictionCandidates({
    candidates: confirmedCandidates,
    registries: testOnlyRankingAuthorization(confirmedCandidates),
  });

  assert.deepEqual(
    projectedRanking.rankedCandidates.map((candidate) => candidate.playerId),
    confirmedRanking.rankedCandidates.map((candidate) => candidate.playerId),
  );
  assert.equal(
    projectedRanking.rankedCandidates.findIndex(
      (candidate) => candidate.playerId === projected.candidate.playerId,
    ),
    confirmedRanking.rankedCandidates.findIndex(
      (candidate) => candidate.playerId === confirmed.candidate.playerId,
    ),
  );

  process.stdout.write('\n--- LINEUP STATUS INVARIANCE ---\n');
  process.stdout.write(`PROJECTED P(WIN): ${projected.candidate.pWin}\n`);
  process.stdout.write(`CONFIRMED P(WIN): ${confirmed.candidate.pWin}\n`);
  process.stdout.write(`PROJECTED P(VOID): ${projected.candidate.pVoid}\n`);
  process.stdout.write(`CONFIRMED P(VOID): ${confirmed.candidate.pVoid}\n`);
  process.stdout.write(
    `PROJECTED RANK: ${projectedRanking.rankedCandidates.findIndex((candidate) => candidate.playerId === projected.candidate.playerId) + 1}\n`,
  );
  process.stdout.write(
    `CONFIRMED RANK: ${confirmedRanking.rankedCandidates.findIndex((candidate) => candidate.playerId === confirmed.candidate.playerId) + 1}\n`,
  );
  process.stdout.write('IDENTICAL PROBABILITIES: true\n');
  process.stdout.write('IDENTICAL RANK: true\n');
  process.stdout.write('--- END LINEUP STATUS INVARIANCE ---\n');
});
