import { readFileSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';

const BRANCH = 'codex/fix-hits-replay-empty-source';

function run(command, args, options = {}) {
  process.stdout.write(`\n$ ${command} ${args.join(' ')}\n`);
  const result = spawnSync(command, args, {
    stdio: 'inherit',
    ...options,
  });
  if (result.status !== 0) {
    throw new Error(`${command} ${args.join(' ')} failed with status ${String(result.status)}`);
  }
}

function capture(command, args) {
  const result = spawnSync(command, args, { encoding: 'utf8' });
  if (result.status !== 0) {
    throw new Error(result.stderr || `${command} failed`);
  }
  return result.stdout.trim();
}

function replaceExactlyOnce(text, oldText, newText, label) {
  const first = text.indexOf(oldText);
  if (first < 0) throw new Error(`${label}: expected anchor was not found.`);
  if (text.indexOf(oldText, first + oldText.length) >= 0) {
    throw new Error(`${label}: expected exactly one anchor.`);
  }
  return text.slice(0, first) + newText + text.slice(first + oldText.length);
}

function replaceSegment(text, startAnchor, endAnchor, replacement, label) {
  const start = text.indexOf(startAnchor);
  if (start < 0) throw new Error(`${label}: start anchor was not found.`);
  const end = text.indexOf(endAnchor, start);
  if (end < 0) throw new Error(`${label}: end anchor was not found.`);
  return text.slice(0, start) + replacement + text.slice(end);
}

function patchHits() {
  const file = 'scripts/archive-m9-batter-hits-board.mjs';
  let text = readFileSync(file, 'utf8');

  const importAnchor = "import { userProjectedLineupEvidenceForIdentity } from './user-projected-lineup-utils.mjs';\n";
  const helperImport = "import { authorizeActiveSourceOfferForResearch } from './active-source-settlement-authorization.mjs';\n";
  if (!text.includes(helperImport)) {
    text = replaceExactlyOnce(text, importAnchor, importAnchor + helperImport, 'Hits helper import');
  }

  const oldPick6Block = `        if (source.boardSource === 'pick6') {\n          for (const offer of board.offers) {\n            exclusions.push(\n              Object.freeze({\n                providerEventId: event.id,\n                boardSource: 'pick6',\n                playerName: offer.playerName,\n                side: offer.selectedSide,\n                postedLine: offer.line,\n                reason: 'pick6-settlement-rule-temporal-evidence-unavailable',\n              }),\n            );\n          }\n        }\n`;
  if (text.includes(oldPick6Block)) {
    text = replaceExactlyOnce(text, oldPick6Block, '', 'Hits obsolete Pick6 blanket block');
  }

  const rankableStart = "      const draftkingsBoard = sourceBoards.find(\n";
  const observationsAnchor = "      const observations = [];\n";
  if (text.includes(rankableStart)) {
    const rankableReplacement = `      const rankableOffers = [];\n      for (const { source, board } of sourceBoards) {\n        for (const offer of board.offers) {\n          const authorization = authorizeActiveSourceOfferForResearch({\n            settlementRegistry: PRODUCTION_REGISTRIES.settlementRegistry,\n            offer,\n            evaluatedAt: capturedAt,\n          });\n          if (!authorization.authorized) {\n            exclusions.push(\n              Object.freeze({\n                providerEventId: event.id,\n                boardSource: source.boardSource,\n                playerName: offer.playerName,\n                side: offer.selectedSide,\n                postedLine: offer.line,\n                reason: authorization.reason,\n              }),\n            );\n            continue;\n          }\n          rankableOffers.push(Object.freeze({ source, board, offer }));\n        }\n      }\n\n      if (rankableOffers.length === 0) {\n        exclusions.push(\n          Object.freeze({\n            providerEventId: event.id,\n            reason: 'no-rankable-active-source-batter-hits-offers',\n          }),\n        );\n        continue;\n      }\n\n      const pregameExcludedCount = sourceBoards.reduce(\n        (total, entry) => total + entry.board.excludedOffers.length,\n        0,\n      );\n      funnel.add('matchedGameOffers', {\n        survived: Math.max(0, rawOffers.count - pregameExcludedCount),\n      });\n      for (const { board } of sourceBoards) {\n        board.excludedOffers.forEach((entry) => {\n          const reason =\n            entry.reason === 'GAME_START_REACHED'\n              ? 'game already in progress'\n              : entry.reason === 'GAME_STATUS_NOT_SCHEDULED'\n                ? 'game status not scheduled'\n                : 'game state unresolved';\n          funnel.drop('matchedGameOffers', reason, 1);\n        });\n      }\n\n`;
    text = replaceSegment(
      text,
      rankableStart,
      observationsAnchor,
      rankableReplacement,
      'Hits active-source rankable block',
    );
  }

  const observationsStart = text.indexOf(observationsAnchor);
  const candidatesAnchor = "    }\n\n    const candidates = Object.freeze(\n";
  const observationsEnd = text.indexOf(candidatesAnchor, observationsStart);
  if (observationsStart < 0 || observationsEnd < 0) {
    throw new Error('Hits observations block could not be located.');
  }
  let segment = text.slice(observationsStart, observationsEnd);

  if (segment.includes("funnel.add('verifiedStarterOffers', { entered: draftkingsBoard.offers.length });")) {
    segment = replaceExactlyOnce(
      segment,
      "funnel.add('verifiedStarterOffers', { entered: draftkingsBoard.offers.length });",
      "funnel.add('verifiedStarterOffers', { entered: rankableOffers.length });",
      'Hits verified-starter count',
    );
  }
  if (segment.includes('for (const offer of draftkingsBoard.offers) {')) {
    segment = replaceExactlyOnce(
      segment,
      'for (const offer of draftkingsBoard.offers) {',
      'for (const { source, board, offer } of rankableOffers) {',
      'Hits rankable-offer loop',
    );
  }
  if (segment.includes('Object.freeze({\n              offer,\n              observation: runtimeObservation({')) {
    segment = replaceExactlyOnce(
      segment,
      'Object.freeze({\n              offer,\n              observation: runtimeObservation({',
      'Object.freeze({\n              source,\n              board,\n              offer,\n              observation: runtimeObservation({',
      'Hits observation source identity',
    );
  }
  if (segment.includes('observations.forEach(({ offer }) =>')) {
    segment = replaceExactlyOnce(
      segment,
      'observations.forEach(({ offer }) =>',
      'observations.forEach(({ source, offer }) =>',
      'Hits history exclusion source identity',
    );
  }
  if (segment.includes('for (const { offer, observation } of observations) {')) {
    segment = replaceExactlyOnce(
      segment,
      'for (const { offer, observation } of observations) {',
      'for (const { source, board, offer, observation } of observations) {',
      'Hits composition source identity',
    );
  }
  if (segment.includes('pregameBoard: draftkingsBoard,')) {
    segment = replaceExactlyOnce(
      segment,
      'pregameBoard: draftkingsBoard,',
      'pregameBoard: board,',
      'Hits source-specific pregame board',
    );
  }
  segment = segment.replaceAll("boardSource: 'draftkings'", 'boardSource: source.boardSource');
  if (segment.includes('draftkingsBoard')) {
    throw new Error('Hits DraftKings-only candidate path still remains after patch.');
  }
  text = text.slice(0, observationsStart) + segment + text.slice(observationsEnd);

  if (text.includes("reason: 'pick6-settlement-rule-temporal-evidence-unavailable'")) {
    throw new Error('Hits obsolete blanket Pick6 exclusion remains.');
  }
  if (!text.includes('authorizeActiveSourceOfferForResearch')) {
    throw new Error('Hits shared authorization gate was not installed.');
  }
  writeFileSync(file, text);
}

function patchCandidateIdentity() {
  const file = 'scripts/m9-board-archive-utils.mjs';
  let text = readFileSync(file, 'utf8');
  const oldText = `    Number(value.playerId),\n    details.providerMarketKey,\n`;
  const newText = `    Number(value.playerId),\n    details.providerBookmakerKey,\n    details.providerMarketKey,\n`;
  if (!text.includes('details.providerBookmakerKey,\n    details.providerMarketKey,')) {
    text = replaceExactlyOnce(text, oldText, newText, 'M9 candidate source identity');
  }
  writeFileSync(file, text);
}

function patchHhr() {
  const file = 'scripts/archive-m10-batter-hhr-board.mjs';
  let text = readFileSync(file, 'utf8');

  const adapterImport = "import { fetchMlbStatsPostedLineup } from '../dist/src/adapters/index.js';\n";
  const registryImport = "import { PRODUCTION_REGISTRIES } from '../dist/src/composition/index.js';\n";
  if (!text.includes(registryImport)) {
    text = replaceExactlyOnce(text, adapterImport, adapterImport + registryImport, 'HHR registry import');
  }

  const evidenceImport = "import { buildM10HhrProspectiveArchive } from './m10-hhr-evidence-utils.mjs';\n";
  const helperImport = "import { authorizeActiveSourceOfferForResearch } from './active-source-settlement-authorization.mjs';\n";
  if (!text.includes(helperImport)) {
    text = replaceExactlyOnce(text, evidenceImport, evidenceImport + helperImport, 'HHR helper import');
  }

  const loopStart = "  const rankableOffers = [];\n";
  const offersAnchor = "  const offers = Object.freeze(rankableOffers);\n";
  const loopIndex = text.indexOf(loopStart, text.indexOf('let pick6OfferCountBlockedBySettlement'));
  const offersIndex = text.indexOf(offersAnchor, loopIndex);
  if (loopIndex < 0 || offersIndex < 0) throw new Error('HHR active-source loop could not be located.');
  const currentLoop = text.slice(loopIndex, offersIndex);
  if (currentLoop.includes("if (source.boardSource === 'pick6')")) {
    const newLoop = `  const rankableOffers = [];\n  for (const source of ACTIVE_HHR_BOARD_SOURCES) {\n    const sourceSnapshot = snapshotsBySource.get(source.boardSource);\n    const sourceOffers = normalizeOddsApiBatterHhrCapture(\n      hhrCapture(sourceSnapshot, capturedAt, source),\n    );\n    for (const offer of sourceOffers) {\n      const authorization = authorizeActiveSourceOfferForResearch({\n        settlementRegistry: PRODUCTION_REGISTRIES.settlementRegistry,\n        offer,\n        evaluatedAt: capturedAt,\n      });\n      if (!authorization.authorized) {\n        if (source.boardSource === 'pick6') {\n          pick6OfferCountBlockedBySettlement += 1;\n        }\n        exclusions.push(\n          Object.freeze({\n            gameId: game.gameId,\n            providerEventId: game.providerEventId,\n            playerName: offer.playerName,\n            boardSource: source.boardSource,\n            providerMarketKey: offer.providerMarketKey,\n            selectedSide: offer.selectedSide,\n            postedLine: offer.line,\n            reason: authorization.reason,\n          }),\n        );\n        continue;\n      }\n      rankableOffers.push(offer);\n    }\n  }\n`;
    text = text.slice(0, loopIndex) + newLoop + text.slice(offersIndex);
  }

  const oldNoRankable = "  throw new Error('HHR capture contained no rankable DraftKings offers; Pick6 is not substituted without an authorized settlement rule.');";
  if (text.includes(oldNoRankable)) {
    text = replaceExactlyOnce(
      text,
      oldNoRankable,
      "  throw new Error('HHR capture contained no rankable active-source offers after settlement and eligibility authorization.');",
      'HHR no-rankable error',
    );
  }

  const oldProbabilityGate = `      if (offer.boardSource !== 'draftkings' || offer.settlementRuleVersion === null) {\n        throw new Error('HHR probability rows require one authorized source-specific settlement rule.');\n      }\n`;
  if (text.includes(oldProbabilityGate)) {
    const newProbabilityGate = `      const authorization = authorizeActiveSourceOfferForResearch({\n        settlementRegistry: PRODUCTION_REGISTRIES.settlementRegistry,\n        offer,\n        evaluatedAt: capturedAt,\n      });\n      if (!authorization.authorized) {\n        throw new Error(\n          \`HHR probability rows require one authorized source-specific settlement rule: \${authorization.reason}.\`,\n        );\n      }\n`;
    text = replaceExactlyOnce(text, oldProbabilityGate, newProbabilityGate, 'HHR probability source gate');
  }

  const oldSort = `rows.sort((left, right) =>\n  left.providerGameId - right.providerGameId ||\n  left.providerPlayerId - right.providerPlayerId ||\n  left.providerMarketKey.localeCompare(right.providerMarketKey) ||\n`;
  const newSort = `rows.sort((left, right) =>\n  left.providerGameId - right.providerGameId ||\n  left.providerPlayerId - right.providerPlayerId ||\n  left.boardSource.localeCompare(right.boardSource) ||\n  left.providerMarketKey.localeCompare(right.providerMarketKey) ||\n`;
  if (!text.includes('left.boardSource.localeCompare(right.boardSource)')) {
    text = replaceExactlyOnce(text, oldSort, newSort, 'HHR deterministic source sort');
  }

  if (text.includes("reason: 'pick6-settlement-rule-temporal-evidence-unavailable'")) {
    throw new Error('HHR obsolete blanket Pick6 exclusion remains.');
  }
  if (!text.includes('authorizeActiveSourceOfferForResearch')) {
    throw new Error('HHR shared authorization gate was not installed.');
  }
  writeFileSync(file, text);
}

function patchHhrRegression() {
  const file = 'test/m10-hhr-daily-evidence.test.mjs';
  let text = readFileSync(file, 'utf8');
  const startAnchor = "test('HHR active sources normalize independently and Pick6 remains settlement-blocked', async () => {\n";
  if (!text.includes(startAnchor)) return;
  const start = text.indexOf(startAnchor);
  const next = text.indexOf("\ntest('HHR final grading requires exact STATUS_FINAL games", start);
  if (next < 0) throw new Error('HHR stale regression end anchor was not found.');
  const replacement = `test('HHR active sources use source-specific authorization and keep Pick6 Higher Pardon-blocked', async () => {\n  const [captureScript, authorizationScript] = await Promise.all([\n    readFile('scripts/archive-m10-batter-hhr-board.mjs', 'utf8'),\n    readFile('scripts/active-source-settlement-authorization.mjs', 'utf8'),\n  ]);\n  assert.match(\n    captureScript,\n    /ACTIVE_HHR_BOARD_SOURCES[\\s\\S]*boardSource: 'pick6'[\\s\\S]*bookmaker: 'pick6'[\\s\\S]*region: 'us_dfs'[\\s\\S]*boardSource: 'draftkings'[\\s\\S]*bookmaker: 'draftkings'[\\s\\S]*region: 'us'/u,\n  );\n  assert.match(captureScript, /authorizeActiveSourceOfferForResearch/u);\n  assert.match(\n    authorizationScript,\n    /boardSource === 'pick6' && selectedSide === 'higher'[\\s\\S]*pick6-pardon-eligibility-unmodeled/u,\n  );\n  assert.match(authorizationScript, /sourceVerifiedAt/u);\n  assert.doesNotMatch(\n    captureScript,\n    /reason: 'pick6-settlement-rule-temporal-evidence-unavailable'/u,\n  );\n  assert.match(captureScript, /reason: 'no-rankable-active-source-hhr-offers'/u);\n  assert.doesNotMatch(captureScript, /normalizeUnderdogBatterHhrCapture/u);\n  assert.doesNotMatch(captureScript, /classifyHhrUnderdogBookmakerAvailability/u);\n  assert.doesNotMatch(captureScript, /deriveStandardBookBaselineLines/u);\n});\n`;
  text = text.slice(0, start) + replacement + text.slice(next + 1);
  writeFileSync(file, text);
}

const currentBranch = capture('git', ['branch', '--show-current']);
if (currentBranch !== BRANCH) {
  throw new Error(`Expected branch ${BRANCH}; found ${currentBranch || '(detached)'}.`);
}

const dirtyBefore = capture('git', ['status', '--porcelain']);
if (dirtyBefore.length > 0) {
  throw new Error(`Workspace must be clean before repair. Current changes:\n${dirtyBefore}`);
}

patchHits();
patchCandidateIdentity();
patchHhr();
patchHhrRegression();

run('git', ['diff', '--check']);
run('npm', ['run', 'build']);
run('node', [
  '--test',
  'test/m9-hits-empty-source-replay.test.mjs',
  'test/active-source-settlement-authorization.test.mjs',
  'test/m10-hhr-daily-evidence.test.mjs',
  'dist/test/pick6-settlement-source-verified.test.js',
]);
run('npm', ['run', 'verify']);

run('git', ['add',
  'scripts/archive-m9-batter-hits-board.mjs',
  'scripts/archive-m10-batter-hhr-board.mjs',
  'scripts/m9-board-archive-utils.mjs',
  'test/m10-hhr-daily-evidence.test.mjs',
]);
run('git', ['diff', '--cached', '--check']);
const staged = capture('git', ['diff', '--cached', '--name-only']);
if (!staged) throw new Error('Repair produced no staged changes.');
process.stdout.write(`\nSTAGED FILES\n${staged}\n`);
run('git', ['commit', '-m', 'fix: route source-verified Pick6 lower ladders']);
run('git', ['push', 'origin', BRANCH]);
process.stdout.write(`\nLOCAL VERIFICATION PASSED\nHEAD ${capture('git', ['rev-parse', 'HEAD'])}\n`);
