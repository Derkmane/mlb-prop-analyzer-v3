import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

test('scheduled capture mode does not enable full-slate projection mode', () => {
  const workflow = readFileSync('.github/workflows/m9-board-archive.yml', 'utf8');
  assert.match(workflow, /M9_CAPTURE_ALL_PREGAME: \$\{\{ github\.event_name == 'push' && '1' \|\| '0' \}\}/u);
});
