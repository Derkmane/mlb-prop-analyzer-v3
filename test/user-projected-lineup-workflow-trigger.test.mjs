import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

test('user lineup commits trigger one main-branch full-slate pass while scheduled runs keep normal mode', () => {
  const workflow = readFileSync('.github/workflows/m9-board-archive.yml', 'utf8');
  assert.match(workflow, /push:\s*\n\s*branches:\s*\n\s*- main\s*\n\s*paths:\s*\n\s*- artifacts\/user-projected-lineups\/\*\.json/u);
  assert.match(
    workflow,
    /M9_CAPTURE_ALL_PREGAME: \$\{\{ \(github\.event_name == 'push' \|\| \(github\.event_name == 'workflow_dispatch' && inputs\.recapture_all_pregame == 'on'\)\) && '1' \|\| '0' \}\}/u,
  );
  assert.match(workflow, /- cron: '0,30 \* \* \* \*'/u);
});

test('manual recapture can ignore prior controller coverage without changing durable archive roots', () => {
  const workflow = readFileSync('.github/workflows/m9-board-archive.yml', 'utf8');
  assert.match(
    workflow,
    /recapture_all_pregame:\s*\n\s*description: Recapture every still-pregame game even when prior coverage exists\s*\n\s*required: true\s*\n\s*default: 'off'/u,
  );
  assert.match(
    workflow,
    /- name: Plan capture and take first board snapshot[\s\S]*?M10_ARCHIVE_ROOT: \$\{\{ github\.event_name == 'workflow_dispatch' && inputs\.recapture_all_pregame == 'on' && 'artifacts\/workflow-logs\/manual-recapture-controller-root' \|\| 'artifacts\/board-archives\/batter-hits' \}\}/u,
  );
  assert.match(
    workflow,
    /M10_ARCHIVE_ROOT: artifacts\/board-archives\/batter-hits\s*\n\s*M10_HHR_ARCHIVE_ROOT: artifacts\/board-archives\/batter-hhr/u,
  );
});
