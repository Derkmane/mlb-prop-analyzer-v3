import assert from 'node:assert/strict';
import { access, readFile } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import test from 'node:test';

const LIVE_SCRIPT = 'scripts/archive-m9-batter-hits-board.mjs';
const ARCHIVE_UTILS = 'scripts/m9-board-archive-utils.mjs';
const FUNNEL_UTILS = 'scripts/m9-board-archive-funnel-utils.mjs';

function checkSyntax(filePath) {
  const result = spawnSync(process.execPath, ['--check', filePath], {
    encoding: 'utf8',
  });
  assert.equal(
    result.status,
    0,
    `${filePath} failed node --check:\n${result.stdout}\n${result.stderr}`,
  );
}

test('prospective archive scripts parse and the BDL 429 retry remains reachable without weakening other HTTP failures', async () => {
  checkSyntax(ARCHIVE_UTILS);
  checkSyntax(FUNNEL_UTILS);
  checkSyntax(LIVE_SCRIPT);

  const [source, archiveUtils, funnelUtils, packageText] = await Promise.all([
    readFile(LIVE_SCRIPT, 'utf8'),
    readFile(ARCHIVE_UTILS, 'utf8'),
    readFile(FUNNEL_UTILS, 'utf8'),
    readFile('package.json', 'utf8'),
  ]);
  const archivePathSource = `${source}\n${archiveUtils}\n${funnelUtils}`;
  assert.doesNotMatch(archivePathSource, /America\/Chicago|chicagoDate|ARCHIVE_TIME_ZONE|outside the requested Chicago archive date/u);
  assert.match(source, /eventUtcDates/u);
  assert.match(source, /createM9CaptureIdentity/u);
  assert.match(source, /allowNonOk = false/u);
  assert.match(source, /allowNonOk: true/u);
  assert.match(source, /snapshot\.response\.status === 429/u);
  assert.match(source, /await rateLimiter\.waitForRetry\(\);\s*continue;/u);
  assert.match(
    source,
    /snapshot\.response\.status < 200[\s\S]*snapshot\.response\.status >= 300/u,
  );

  const packageJson = JSON.parse(packageText);
  assert.match(
    packageJson.scripts['check:scripts'],
    /node --check scripts\/m9-board-archive-utils\.mjs/u,
  );
  assert.match(
    packageJson.scripts['check:scripts'],
    /node --check scripts\/archive-m9-batter-hits-board\.mjs/u,
  );

  await assert.rejects(
    access('scripts/__apply-m9-board-archive-runtime-fix.mjs'),
    /ENOENT/u,
  );
  await assert.rejects(
    access('.github/workflows/__apply-m9-board-archive-runtime-fix.yml'),
    /ENOENT/u,
  );
});
