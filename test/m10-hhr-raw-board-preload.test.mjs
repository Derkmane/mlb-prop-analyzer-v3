import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import test from 'node:test';

test('raw HHR board preload is wired into the existing HHR archive command before normalization', async () => {
  const workflow = await readFile('.github/workflows/m9-board-archive.yml', 'utf8');
  assert.match(
    workflow,
    /set -euo pipefail[\s\S]*node --import \.\/scripts\/m10-hhr-raw-board-preload\.mjs scripts\/archive-m10-batter-hhr-board\.mjs 2>&1 \| tee/u,
  );
  assert.match(workflow, /artifacts\/board-archives\/batter-hhr\/\*\*/u);
  assert.match(workflow, /if:\s*always\(\)[\s\S]*artifacts\/board-archives\/batter-hhr\/\*\*/u);
});

test('raw HHR board preload is restricted to exact Underdog us_dfs HHR board requests and content-addressed persistence', async () => {
  const source = await readFile('scripts/m10-hhr-raw-board-preload.mjs', 'utf8');
  assert.match(source, /url\.searchParams\.get\('regions'\) !== 'us_dfs'/u);
  assert.match(source, /url\.searchParams\.get\('bookmakers'\) !== 'underdog'/u);
  assert.match(source, /batter_hits_runs_rbis/u);
  assert.match(source, /batter_hits_runs_rbis_alternate/u);
  assert.match(source, /response\.clone\(\)\.arrayBuffer\(\)/u);
  assert.match(source, /createHash\('sha256'\)\.update\(bytes\)\.digest\('hex'\)/u);
  assert.match(source, /writeFile\(filePath, bytes, \{ flag: 'wx' \}\)/u);
  assert.match(source, /existing\.equals\(bytes\)/u);
  assert.doesNotMatch(source, /apiKey/u);
});

test('raw HHR board preload passes Node syntax checking', () => {
  const result = spawnSync(process.execPath, ['--check', 'scripts/m10-hhr-raw-board-preload.mjs'], {
    encoding: 'utf8',
  });
  assert.equal(result.status, 0, result.stderr);
});
