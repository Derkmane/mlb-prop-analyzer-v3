import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

test('runtime lineup issue edits trigger one full-slate pass while scheduled runs reuse the same store without Git commits', () => {
  const workflow = readFileSync('.github/workflows/m9-board-archive.yml', 'utf8');
  assert.match(workflow, /issues:\s*\n\s*types:\s*\n\s*- edited/u);
  assert.doesNotMatch(workflow, /paths:\s*\n\s*- artifacts\/user-projected-lineups\/\*\.json/u);
  assert.match(
    workflow,
    /if: \$\{\{ github\.event_name != 'issues' \|\| github\.event\.issue\.number == 153 \}\}/u,
  );
  assert.match(workflow, /USER_PROJECTED_LINEUP_RUNTIME_ISSUE_NUMBER: '153'/u);
  assert.match(workflow, /USER_PROJECTED_LINEUP_ROOT: artifacts\/workflow-runtime\/user-projected-lineups/u);
  assert.match(
    workflow,
    /- name: Restore current user-projected lineup runtime payload[\s\S]*?GITHUB_TOKEN: \$\{\{ github\.token \}\}[\s\S]*?USER_PROJECTED_LINEUP_RUNTIME_REQUIRED: \$\{\{ github\.event_name == 'issues' && '1' \|\| '0' \}\}[\s\S]*?node scripts\/user-projected-lineup-runtime-store\.mjs/u,
  );
  assert.match(
    workflow,
    /M9_CAPTURE_ALL_PREGAME: \$\{\{ \(\(github\.event_name == 'issues' && github\.event\.issue\.number == 153\) \|\| \(github\.event_name == 'workflow_dispatch' && inputs\.recapture_all_pregame == 'on'\)\) && '1' \|\| '0' \}\}/u,
  );
  assert.match(workflow, /issues: read/u);
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
