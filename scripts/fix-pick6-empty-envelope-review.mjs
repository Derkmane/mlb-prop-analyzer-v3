import { readFileSync, writeFileSync, rmSync } from 'node:fs';
import { execFileSync } from 'node:child_process';

const branch = 'codex/fix-hits-replay-empty-source';
const hitsPath = 'scripts/archive-m9-batter-hits-board.mjs';
const testPath = 'test/m9-hits-empty-source-replay.test.mjs';

function replaceOnce(text, oldText, newText, label) {
  const first = text.indexOf(oldText);
  if (first < 0) throw new Error(`${label}: expected source anchor was not found.`);
  if (text.indexOf(oldText, first + oldText.length) >= 0) {
    throw new Error(`${label}: source anchor was not unique.`);
  }
  return text.slice(0, first) + newText + text.slice(first + oldText.length);
}

function run(command, args) {
  process.stdout.write(`\n$ ${command} ${args.join(' ')}\n`);
  execFileSync(command, args, { stdio: 'inherit' });
}

let hits = readFileSync(hitsPath, 'utf8');

hits = replaceOnce(
  hits,
  `function sourceMarkets(rawOdds, source) {\n  const event = object(rawOdds, 'The Odds API event odds');\n  const bookmakers = array(event.bookmakers, 'event.bookmakers').filter(\n`,
  `function sourceMarkets(rawOdds, source, expectedEventId) {\n  const event = object(rawOdds, 'The Odds API event odds');\n  const eventId = nonemptyString(event.id, 'event.id');\n  const expectedId = nonemptyString(expectedEventId, 'expectedEventId');\n  if (eventId !== expectedId) {\n    throw new Error(\n      \`The Odds API event odds id \${eventId} does not match requested event \${expectedId}.\`,\n    );\n  }\n  const commenceTime = nonemptyString(event.commence_time, 'event.commence_time');\n  if (!Number.isFinite(Date.parse(commenceTime))) {\n    throw new TypeError('event.commence_time must be an ISO timestamp.');\n  }\n  exactName(event.home_team, 'event.home_team');\n  exactName(event.away_team, 'event.away_team');\n  const bookmakers = array(event.bookmakers, 'event.bookmakers').filter(\n`,
  'sourceMarkets envelope validation',
);

hits = replaceOnce(
  hits,
  `function rawOfferSummary(rawOdds, source) {\n`,
  `function rawOfferSummary(rawOdds, source, expectedEventId) {\n`,
  'rawOfferSummary signature',
);

hits = replaceOnce(
  hits,
  `  for (const rawMarket of sourceMarkets(rawOdds, source)) {\n`,
  `  for (const rawMarket of sourceMarkets(rawOdds, source, expectedEventId)) {\n`,
  'sourceMarkets caller',
);

hits = replaceOnce(
  hits,
  `          rawOffers: rawOfferSummary(oddsSnapshot.parsedBody, source),\n`,
  `          rawOffers: rawOfferSummary(oddsSnapshot.parsedBody, source, id),\n`,
  'capture rawOfferSummary caller',
);

writeFileSync(hitsPath, hits);

let testSource = readFileSync(testPath, 'utf8');
const newTest = `\n\ntest('Hits replay rejects a malformed empty Pick6 event envelope before treating it as no offers', async () => {\n  const providerSnapshots = [];\n  const funnel = createM9ArchiveFunnel({\n    captureTimestamp: CAPTURED_AT,\n    dryRun: false,\n  });\n  const calls = [];\n\n  const result = await captureM9BatterHitsEventOdds({\n    eventId: EVENT_ID,\n    oddsApiKey: 'test-secret',\n    providerSnapshots,\n    funnel,\n    fetchOdds: async (request) => {\n      const bookmaker = request.url.searchParams.get('bookmakers');\n      calls.push(bookmaker);\n      if (bookmaker !== 'pick6') {\n        throw new Error('DraftKings must not be consumed after malformed Pick6 evidence.');\n      }\n      return Object.freeze({\n        capturedAt: CAPTURED_AT,\n        rawBody: Object.freeze({ sha256: 'c'.repeat(64) }),\n        parsedBody: Object.freeze({ bookmakers: Object.freeze([]) }),\n      });\n    },\n  });\n\n  assert.equal(result.status, 'failed-closed');\n  assert.equal(result.exclusion.reason, 'EVENT_ODDS_FAILED_CLOSED');\n  assert.equal(result.exclusion.boardSource, 'pick6');\n  assert.match(result.exclusion.detail, /event\\.id must be a nonempty string/u);\n  assert.deepEqual(calls, ['pick6']);\n});\n`;

if (testSource.includes("Hits replay rejects a malformed empty Pick6 event envelope")) {
  throw new Error('focused malformed-envelope regression already exists unexpectedly.');
}
testSource += newTest;
writeFileSync(testPath, testSource);

run('git', ['diff', '--check']);
run('npm', ['run', 'build']);
run('node', ['--test', testPath, 'test/active-source-settlement-authorization.test.mjs', 'test/m10-hhr-daily-evidence.test.mjs', 'dist/test/pick6-settlement-source-verified.test.js']);
run('npm', ['run', 'verify']);

// Transport-only repair helpers must not survive into the implementation PR.
rmSync('scripts/finish-pick6-ladder-repair.mjs', { force: true });
rmSync('scripts/fix-pick6-empty-envelope-review.mjs', { force: true });

run('git', ['add', '-A']);
run('git', ['diff', '--cached', '--check']);
run('git', ['commit', '-m', 'fix: validate empty source event envelope [skip ci]']);
run('git', ['push', 'origin', branch]);

process.stdout.write('\nLOCAL REVIEW CORRECTION PASSED\n');
run('git', ['rev-parse', 'HEAD']);
run('git', ['status', '--short', '--branch']);
