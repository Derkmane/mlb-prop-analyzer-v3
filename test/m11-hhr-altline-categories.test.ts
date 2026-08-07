import assert from 'node:assert/strict';
import test from 'node:test';

import {
  HHR_05_HIGHER_ALT_CATEGORY_ID,
  HHR_25_LOWER_ALT_CATEGORY_ID,
  HHR_ALTLINE_CATEGORY_LIMIT,
  selectHhr05HigherAltV1,
  selectHhr25LowerAltV1,
  type CategoryRankableCandidate,
  type HhrAltlineCategoryOfferInput,
} from '../src/categories/index.js';

interface TestCandidate extends CategoryRankableCandidate {
  readonly identity: string;
}

interface DisplayOnlyInput extends HhrAltlineCategoryOfferInput<TestCandidate> {
  readonly lineupStatus: 'projected' | 'confirmed';
  readonly multiplier: number | null;
}

function candidate({
  identity,
  line,
  selectedSide,
  pFinal,
  pVoid = 0,
  playerId = `player-${identity}`,
}: Readonly<{
  identity: string;
  line: number;
  selectedSide: 'higher' | 'lower';
  pFinal: number | null;
  pVoid?: number;
  playerId?: string;
}>): TestCandidate {
  const gradeMass = 1 - pVoid;
  const pWin = pFinal === null ? 0 : pFinal * gradeMass;
  const pLoss = pFinal === null ? 0 : (1 - pFinal) * gradeMass;
  return Object.freeze({
    identity,
    playerId,
    eligibilityProbability: gradeMass,
    line,
    selectedSide,
    pWin,
    pLoss,
    pVoid: pFinal === null ? 1 : pVoid,
    pWinGivenGrades: pFinal,
  });
}

function input(
  value: TestCandidate,
  offerType: 'baseline' | 'alternate' = 'alternate',
): HhrAltlineCategoryOfferInput<TestCandidate> {
  return Object.freeze({ candidate: value, offerType });
}

test('HHR categories admit only their exact posted alternate line and side', () => {
  const rows = [
    input(candidate({ identity: 'a-match', line: 2.5, selectedSide: 'lower', pFinal: 0.72 })),
    input(candidate({ identity: 'a-wrong-side', line: 2.5, selectedSide: 'higher', pFinal: 0.99 })),
    input(candidate({ identity: 'a-wrong-line', line: 1.5, selectedSide: 'lower', pFinal: 0.99 })),
    input(candidate({ identity: 'a-baseline', line: 2.5, selectedSide: 'lower', pFinal: 0.99 }), 'baseline'),
    input(candidate({ identity: 'b-match', line: 0.5, selectedSide: 'higher', pFinal: 0.69 })),
    input(candidate({ identity: 'b-wrong-side', line: 0.5, selectedSide: 'lower', pFinal: 0.99 })),
  ];

  const lower25 = selectHhr25LowerAltV1(rows);
  assert.equal(lower25.categoryId, HHR_25_LOWER_ALT_CATEGORY_ID);
  assert.equal(lower25.postedExactOfferCount, 1);
  assert.equal(lower25.availableOfferCount, 1);
  assert.deepEqual(lower25.selectedCandidates.map((row) => row.candidate.identity), ['a-match']);
  assert.deepEqual(lower25.exclusionCounts, {
    notAlternate: 1,
    lineMismatch: 3,
    sideMismatch: 1,
    unrankableProbability: 0,
    duplicatePlayer: 0,
    top20Cut: 0,
  });

  const higher05 = selectHhr05HigherAltV1(rows);
  assert.equal(higher05.categoryId, HHR_05_HIGHER_ALT_CATEGORY_ID);
  assert.equal(higher05.postedExactOfferCount, 1);
  assert.equal(higher05.availableOfferCount, 1);
  assert.deepEqual(higher05.selectedCandidates.map((row) => row.candidate.identity), ['b-match']);
});

test('HHR categories sort only by P(Win | grades), then P(Void)', () => {
  const result = selectHhr25LowerAltV1([
    input(candidate({ identity: 'lower', line: 2.5, selectedSide: 'lower', pFinal: 0.61, pVoid: 0.01 })),
    input(candidate({ identity: 'tie-more-void', line: 2.5, selectedSide: 'lower', pFinal: 0.64, pVoid: 0.08 })),
    input(candidate({ identity: 'tie-less-void', line: 2.5, selectedSide: 'lower', pFinal: 0.64, pVoid: 0.02 })),
  ]);

  assert.deepEqual(
    result.selectedCandidates.map((row) => row.candidate.identity),
    ['tie-less-void', 'tie-more-void', 'lower'],
  );
});

test('HHR exact alt categories keep one prop per player using canonical probability order', () => {
  const result = selectHhr05HigherAltV1([
    input(candidate({ identity: 'first', playerId: 'same-player', line: 0.5, selectedSide: 'higher', pFinal: 0.61 })),
    input(candidate({ identity: 'best', playerId: 'same-player', line: 0.5, selectedSide: 'higher', pFinal: 0.66 })),
    input(candidate({ identity: 'other', line: 0.5, selectedSide: 'higher', pFinal: 0.63 })),
  ]);

  assert.equal(result.postedExactOfferCount, 3);
  assert.equal(result.availableOfferCount, 2);
  assert.equal(result.exclusionCounts.duplicatePlayer, 1);
  assert.deepEqual(result.selectedCandidates.map((row) => row.candidate.identity), ['best', 'other']);
});

test('HHR exact alt categories return top 20 without padding or substitution', () => {
  const twentyFive = Array.from({ length: 25 }, (_, index) =>
    input(candidate({
      identity: `row-${index}`,
      line: 0.5,
      selectedSide: 'higher',
      pFinal: 0.50 + index / 100,
    })),
  );
  const result = selectHhr05HigherAltV1(twentyFive);

  assert.equal(HHR_ALTLINE_CATEGORY_LIMIT, 20);
  assert.equal(result.postedExactOfferCount, 25);
  assert.equal(result.availableOfferCount, 25);
  assert.equal(result.selectedCandidates.length, 20);
  assert.equal(result.exclusionCounts.top20Cut, 5);
  assert.equal(result.selectedCandidates[0]?.candidate.identity, 'row-24');
  assert.equal(result.selectedCandidates[19]?.candidate.identity, 'row-5');

  const short = selectHhr05HigherAltV1(twentyFive.slice(0, 3));
  assert.equal(short.availableOfferCount, 3);
  assert.equal(short.selectedCandidates.length, 3);
  assert.equal(short.exclusionCounts.top20Cut, 0);
});

test('fully void/unrankable exact offers fail closed and are counted', () => {
  const result = selectHhr25LowerAltV1([
    input(candidate({ identity: 'rankable', line: 2.5, selectedSide: 'lower', pFinal: 0.62 })),
    input(candidate({ identity: 'void', line: 2.5, selectedSide: 'lower', pFinal: null })),
  ]);

  assert.equal(result.postedExactOfferCount, 2);
  assert.equal(result.availableOfferCount, 1);
  assert.equal(result.exclusionCounts.unrankableProbability, 1);
  assert.deepEqual(result.selectedCandidates.map((row) => row.candidate.identity), ['rankable']);
});

test('lineupStatus and payout multiplier are display-only and cannot alter category order', () => {
  const projectedHigh: DisplayOnlyInput = Object.freeze({
    candidate: candidate({ identity: 'projected-high', line: 0.5, selectedSide: 'higher', pFinal: 0.66 }),
    offerType: 'alternate',
    lineupStatus: 'projected',
    multiplier: 0.5,
  });
  const confirmedLow: DisplayOnlyInput = Object.freeze({
    candidate: candidate({ identity: 'confirmed-low', line: 0.5, selectedSide: 'higher', pFinal: 0.61 }),
    offerType: 'alternate',
    lineupStatus: 'confirmed',
    multiplier: 9,
  });
  const confirmedLowChanged: DisplayOnlyInput = Object.freeze({
    ...confirmedLow,
    lineupStatus: 'projected',
    multiplier: 0.01,
  });
  const projectedHighChanged: DisplayOnlyInput = Object.freeze({
    ...projectedHigh,
    lineupStatus: 'confirmed',
    multiplier: 100,
  });

  const first = selectHhr05HigherAltV1([confirmedLow, projectedHigh]);
  const second = selectHhr05HigherAltV1([
    confirmedLowChanged,
    projectedHighChanged,
  ]);

  assert.deepEqual(first.selectedCandidates.map((row) => row.candidate.identity), ['projected-high', 'confirmed-low']);
  assert.deepEqual(second.selectedCandidates.map((row) => row.candidate.identity), ['projected-high', 'confirmed-low']);
});
