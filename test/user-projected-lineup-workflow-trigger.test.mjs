import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

test('user lineup commits trigger one main-branch full-slate pass while scheduled runs keep normal mode', () => {
  const workflow = readFileSync('.github/workflows/m9-board-archive.yml', 'utf8');
  assert.match(workflow, /push:\s*\n\s*branches:\s*\n\s*- main\s*\n\s*paths:\s*\n\s*- artifacts\/user-projected-lineups\/\*\.json/u);
  assert.match(
    workflow,
    /M9_CAPTURE_ALL_PREGAME: \$\{\{ github\.event_name == 'push' && '1' \|\| '0' \}\}/u,
  );
  assert.match(workflow, /- cron: '0,30 \* \* \* \*'/u);
});
