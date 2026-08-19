import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

test('optional user projection path does not require a separate manual Replit instruction file', () => {
  const workflow = readFileSync('.github/workflows/m9-board-archive.yml', 'utf8');
  assert.doesNotMatch(workflow, /replit/iu);
});
