import assert from 'node:assert/strict';
import test from 'node:test';

import {
  CATEGORY_MIN_WIN_PROBABILITY_EXCLUSIVE,
  CATEGORY_OUTPUT_LIMIT,
  selectCategoryOutputV1,
  type CategoryRankableCandidate,
} from '../src/categories/index.js';

type TestCandidate = CategoryRankableCandidate & Readonly<{ identity: string }>;

function candidate(identity: string, pWinGivenGrades: number): TestCandidate {
  return Object.freeze({
    identity,
    playerId: `player-${identity}`,
    line: 0.5,
    selectedSide: 'higher' as const,
    pVoid: 0,
    pWinGivenGrades,
  });
}

test('category output keeps all already-ranked qualifying picks when fewer than 20 exist', () => {
  const ranked = Object.freeze(
    Array.from({ length: 12 }, (_, index) =>
      candidate(String(index + 1), 0.72 - index * 0.01),
    ),
  );

  const result = selectCategoryOutputV1(ranked);

  assert.equal(CATEGORY_MIN_WIN_PROBABILITY_EXCLUSIVE, 0.5);
  assert.equal(CATEGORY_OUTPUT_LIMIT, 20);
  assert.equal(result.length, 12);
  assert.deepEqual(result, ranked);
});

test('category output caps at 20 without reordering or altering candidate identity', () => {
  const ranked = Object.freeze(
    Array.from({ length: 25 }, (_, index) =>
      candidate(String(index + 1), 0.9 - index * 0.01),
    ),
  );

  const result = selectCategoryOutputV1(ranked);

  assert.equal(result.length, 20);
  assert.deepEqual(
    result.map((entry) => entry.identity),
    ranked.slice(0, 20).map((entry) => entry.identity),
  );
  result.forEach((entry, index) => assert.equal(entry, ranked[index]));
});

test('category output excludes exactly 50 percent and anything below it and never pads', () => {
  const ranked = Object.freeze([
    candidate('above-a', 0.61),
    candidate('above-b', 0.5000001),
    candidate('exactly-half', 0.5),
    candidate('below', 0.49),
  ]);

  const result = selectCategoryOutputV1(ranked);

  assert.deepEqual(
    result.map((entry) => entry.identity),
    ['above-a', 'above-b'],
  );
  assert.ok(result.every((entry) => entry.pWinGivenGrades! > 0.5));
});
