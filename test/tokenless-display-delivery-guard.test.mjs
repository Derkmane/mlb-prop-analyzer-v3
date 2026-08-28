import assert from 'node:assert/strict';
import { access, readFile } from 'node:fs/promises';
import test from 'node:test';

test('deployed display refresh has no private-GitHub token or tree-fetch implementation', async () => {
  const server = await readFile('src/composition/hhr-display-server.ts', 'utf8');
  const adapters = await readFile('src/adapters/index.ts', 'utf8');
  const deliveryWorkflow = await readFile('.github/workflows/m9-display-delivery.yml', 'utf8');
  const deliveryScript = await readFile('scripts/deliver-m9-display-bundle.mjs', 'utf8');

  assert.doesNotMatch(server, /GITHUB_TOKEN|api\.github\.com|raw\.githubusercontent\.com|createCommittedDisplayArchiveRefresher/u);
  assert.doesNotMatch(adapters, /refresh-committed-display-archives/u);
  assert.doesNotMatch(deliveryWorkflow, /GITHUB_TOKEN/u);
  assert.match(deliveryWorkflow, /id-token:\s*write/u);
  assert.doesNotMatch(deliveryScript, /GITHUB_TOKEN/u);

  await assert.rejects(
    access('src/adapters/display-archives/refresh-committed-display-archives.ts'),
    (error) => error !== null && typeof error === 'object' && error.code === 'ENOENT',
  );
});
