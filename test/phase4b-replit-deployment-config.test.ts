import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

test('Replit deployment explicitly targets cloudrun and launches only the password-gated HHR app', async () => {
  const [replitConfig, serverSource] = await Promise.all([
    readFile('.replit', 'utf8'),
    readFile('src/composition/hhr-display-server.ts', 'utf8'),
  ]);

  assert.match(replitConfig, /\[deployment\]/u);
  assert.match(
    replitConfig,
    /^build = "node scripts\/verify-deployment-display-freshness\.mjs && npm run build"$/mu,
  );
  assert.match(replitConfig, /^run = "node dist\/src\/composition\/hhr-display-server\.js"$/mu);
  assert.match(replitConfig, /^deploymentTarget = "cloudrun"$/mu);
  assert.match(replitConfig, /\[\[ports\]\]\nlocalPort = 3000\nexternalPort = 80/u);
  assert.doesNotMatch(replitConfig, /localPort = (?!3000$)\d+/mu);
  assert.doesNotMatch(replitConfig, /externalPort = (?!80$)\d+/mu);

  assert.match(serverSource, /DEFAULT_HHR_DISPLAY_SERVER_HOST = '0\.0\.0\.0'/u);
  assert.match(
    serverSource,
    /resolveHhrDisplayServerPassword\(process\.env\['HHR_DISPLAY_PASSWORD'\]\)/u,
  );

  const directInvocationIndex = serverSource.indexOf('if (isDirectInvocation())');
  assert.notEqual(directInvocationIndex, -1);
  const directInvocationBlock = serverSource.slice(directInvocationIndex);
  assert.match(directInvocationBlock, /startHhrDisplayAppServer\(password, port\)/u);
  assert.doesNotMatch(directInvocationBlock, /startHhrDisplayBoardServer/u);
});
