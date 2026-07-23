import assert from 'node:assert/strict';
import test from 'node:test';

import { isSelectedSide, SELECTED_SIDES } from '../src/domain/selected-side.js';

test('the domain preserves exactly Higher and Lower as selected sides', () => {
  assert.deepEqual(SELECTED_SIDES, ['higher', 'lower']);
  assert.equal(isSelectedSide('higher'), true);
  assert.equal(isSelectedSide('lower'), true);
  assert.equal(isSelectedSide('over'), false);
  assert.equal(isSelectedSide(undefined), false);
});
