import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

test('projection push trigger is limited to dated user lineup artifacts on main', () => {
  const workflow = readFileSync('.github/workflows/m9-board-archive.yml', 'utf8');
  assert.match(workflow, /branches:\s*\n\s*- main/u);
  assert.match(workflow, /paths:\s*\n\s*- artifacts\/user-projected-lineups\/\*\.json/u);
  assert.doesNotMatch(workflow, /agent\/m9-board-archiving/u);
});
