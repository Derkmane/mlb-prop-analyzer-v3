import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import {
  captureFirstBoardSnapshot,
  REPLAY_CONTRACT,
  sha256Bytes,
  SNAPSHOT_CONTRACT,
} from './m9-board-snapshot-preload.mjs';

export const NORMAL_WINDOW_MINUTES = 40;
export const NORMAL_WINDOW_MAX_MINUTES = 110;
export const BOARD_RUN_CONTRACT = 'm9-schedule-aware-board-run-v1';
export const COVERAGE_CONTRACT = 'm9-game-coverage-receipt-v2';
const LEGACY_COVERAGE_CONTRACT = 'm9-game-coverage-receipt-v1';
const COVERAGE_CONTRACTS = new Set([
  LEGACY_COVERAGE_CONTRACT,
  COVERAGE_CONTRACT,
]);

const iso = (value) => new Date(value).toISOString();
const gameKey = (event) => `${event.eventId}@${event.commenceTimeUtc}`;

export function normalizeScheduleEvents(raw) {
  if (!Array.isArray(raw)) {
    throw new Error('The Odds API events response must be an array.');
  }
  return Object.freeze(
    raw
      .map((event, index) => {
        if (
          typeof event?.id !== 'string' ||
          event.id.length === 0 ||
          typeof event?.commence_time !== 'string' ||
          typeof event?.home_team !== 'string' ||
          typeof event?.away_team !== 'string'
        ) {
          throw new Error(`Malformed The Odds API event at index ${index}.`);
        }
        return Object.freeze({
          eventId: event.id,
          commenceTimeUtc: iso(event.commence_time),
          homeTeamName: event.home_team,
          awayTeamName: event.away_team,
        });
      })
      .sort(
        (a, b) =>
          a.commenceTimeUtc.localeCompare(b.commenceTimeUtc) ||
          a.eventId.localeCompare(b.eventId),
      ),
  );
}

export function decideBoardRun({
  events,
  coveredGameIdentities = [],
  runStartedAt,
}) {
  const startMs = Date.parse(runStartedAt);
  if (!Number.isFinite(startMs)) throw new Error('runStartedAt must be ISO time.');
  const covered = new Set(coveredGameIdentities);
  const claimedGames = [];
  const evaluations = events.map((event) => {
    const gameIdentity = gameKey(event);
    const minutesToFirstPitch =
      (Date.parse(event.commenceTimeUtc) - startMs) / 60_000;
    let classification = 'OUTSIDE_WINDOW';
    if (minutesToFirstPitch <= 0) classification = 'STARTED';
    else if (covered.has(gameIdentity)) classification = 'COVERED';
    else if (
      minutesToFirstPitch >= NORMAL_WINDOW_MINUTES &&
      minutesToFirstPitch <= NORMAL_WINDOW_MAX_MINUTES
    ) {
      classification = 'NORMAL';
    } else if (minutesToFirstPitch < NORMAL_WINDOW_MINUTES) {
      classification = 'RECOVERY';
    }
    const row = Object.freeze({
      ...event,
      gameIdentity,
      minutesToFirstPitch,
      classification,
    });
    if (classification === 'NORMAL' || classification === 'RECOVERY') {
      claimedGames.push(row);
    }
    return row;
  });
  return Object.freeze({
    decision: claimedGames.length > 0 ? 'CAPTURE' : 'NOOP',
    claimedGames: Object.freeze(claimedGames),
    evaluations: Object.freeze(evaluations),
  });
}

export function assertBoardSnapshotBeforeClaimedGames(
  boardSnapshotCompletedAt,
  claimedGames,
) {
  const completedMs = Date.parse(boardSnapshotCompletedAt);
  if (!Number.isFinite(completedMs)) {
    throw new Error('boardSnapshotCompletedAt must be ISO time.');
  }
  for (const game of claimedGames) {
    if (completedMs >= Date.parse(game.commenceTimeUtc)) {
      throw new Error(
        `Board snapshot completed at or after first pitch for ${game.gameIdentity}.`,
      );
    }
  }
}

async function readJson(filePath) {
  return JSON.parse((await readFile(filePath)).toString('utf8'));
}

async function exactWrite(filePath, bytes) {
  await mkdir(path.dirname(filePath), { recursive: true });
  try {
    await writeFile(filePath, bytes, { flag: 'wx' });
  } catch (error) {
    if (error?.code !== 'EEXIST') throw error;
    const existing = await readFile(filePath);
    if (!existing.equals(bytes)) {
      throw new Error(`Immutable coverage receipt drift: ${filePath}`);
    }
  }
}

async function appendOutputs(values) {
  if (!process.env.GITHUB_OUTPUT) return;
  const text = `${Object.entries(values)
    .map(([key, value]) => `${key}=${value ?? ''}`)
    .join('\n')}\n`;
  await writeFile(process.env.GITHUB_OUTPUT, text, { flag: 'a' });
}

async function coveredGames(root) {
  const directory = path.join(
    root,
    'capture-controller',
    'coverage-receipts',
  );
  let entries;
  try {
    entries = await readdir(directory, { withFileTypes: true });
  } catch (error) {
    if (error?.code === 'ENOENT') return [];
    throw error;
  }
  const covered = new Set();
  for (const entry of entries
    .filter((item) => item.isFile() && item.name.endsWith('.json'))
    .sort((a, b) => a.name.localeCompare(b.name))) {
    const receipt = await readJson(path.join(directory, entry.name));
    if (!COVERAGE_CONTRACTS.has(receipt.contract)) {
      throw new Error(`Unknown coverage receipt contract: ${entry.name}`);
    }
    if (!Array.isArray(receipt.coveredGames)) {
      throw new Error(`Coverage receipt has no coveredGames array: ${entry.name}`);
    }
    for (const game of receipt.coveredGames) covered.add(game.gameIdentity);
  }
  return [...covered].sort();
}

function scheduleUrl(key) {
  const url = new URL(
    'https://api.the-odds-api.com/v4/sports/baseball_mlb/events',
  );
  url.searchParams.set('apiKey', key);
  url.searchParams.set('dateFormat', 'iso');
  return url;
}

export async function planBoardRun({
  now = () => new Date().toISOString(),
  fetchImpl = globalThis.fetch,
  root = path.resolve(
    process.env.M10_ARCHIVE_ROOT?.trim() ||
      'artifacts/board-archives/batter-hits',
  ),
  planPath = path.resolve(
    process.env.M9_CAPTURE_CONTROLLER_PLAN?.trim() ||
      'artifacts/workflow-logs/m9-capture-controller-plan.json',
  ),
  key = process.env.THE_ODDS_API_KEY?.trim(),
  output = process.stdout,
} = {}) {
  if (!key) throw new Error('Missing THE_ODDS_API_KEY.');
  const runStartedAt = iso(now());
  const priorCoverage = await coveredGames(root);
  const snapshotStartedAt = iso(now());
  const url = scheduleUrl(key);
  const response = await fetchImpl(url);
  const bytes = Buffer.from(await response.clone().arrayBuffer());
  const scheduleCapturedAt = iso(now());
  if (!response.ok) {
    throw new Error(`The Odds API MLB events returned HTTP ${response.status}.`);
  }
  const events = normalizeScheduleEvents(JSON.parse(bytes.toString('utf8')));
  const decision = decideBoardRun({
    events,
    coveredGameIdentities: priorCoverage,
    runStartedAt,
  });
  await mkdir(path.dirname(planPath), { recursive: true });

  if (decision.decision === 'NOOP') {
    const plan = Object.freeze({
      version: 1,
      contract: BOARD_RUN_CONTRACT,
      decision: 'NOOP',
      runStartedAt,
      scheduleSha256: sha256Bytes(bytes),
      claimedGames: Object.freeze([]),
      evaluations: decision.evaluations,
    });
    await writeFile(planPath, `${JSON.stringify(plan, null, 2)}\n`);
    await appendOutputs({ decision: 'NOOP', plan_path: planPath });
    output.write(`M9 BOARD RUN CONTROLLER\tNOOP\tproviderEvents=${events.length}\n`);
    return plan;
  }

  const snapshot = await captureFirstBoardSnapshot({
    fetchImpl,
    archiveRoot: root,
    runStartedAt,
    snapshotStartedAt,
    scheduleUrl: url,
    scheduleResponse: response,
    scheduleBytes: bytes,
    scheduleCapturedAt,
    events,
    claimedGames: decision.claimedGames,
    now,
  });
  assertBoardSnapshotBeforeClaimedGames(
    snapshot.manifest.boardSnapshotCompletedAt,
    decision.claimedGames,
  );
  const plan = Object.freeze({
    version: 1,
    contract: BOARD_RUN_CONTRACT,
    decision: 'CAPTURE',
    runStartedAt,
    claimedGames: decision.claimedGames,
    evaluations: decision.evaluations,
    snapshotId: snapshot.manifest.snapshotId,
    snapshotSetSha256: snapshot.manifest.snapshotSetSha256,
    snapshotManifestPath: snapshot.manifestPath,
    boardSnapshotCompletedAt: snapshot.manifest.boardSnapshotCompletedAt,
    runStartToSnapshotElapsedMs: snapshot.manifest.runStartToSnapshotElapsedMs,
  });
  await writeFile(planPath, `${JSON.stringify(plan, null, 2)}\n`);
  await appendOutputs({
    decision: 'CAPTURE',
    plan_path: planPath,
    snapshot_manifest: snapshot.manifestPath,
    snapshot_id: plan.snapshotId,
    snapshot_set_sha256: plan.snapshotSetSha256,
    snapshot_completed_at: plan.boardSnapshotCompletedAt,
  });
  output.write(
    `M9 BOARD RUN CONTROLLER\tCAPTURE\tclaimed=${plan.claimedGames.length}\tsnapshotSetSha256=${plan.snapshotSetSha256}\telapsedMs=${plan.runStartToSnapshotElapsedMs}\n`,
  );
  return plan;
}

function verifyReplay(receipt, consumer, manifest) {
  if (
    receipt.contract !== REPLAY_CONTRACT ||
    receipt.version !== 2 ||
    receipt.consumer !== consumer ||
    receipt.complete !== true
  ) {
    throw new Error(`${consumer} replay receipt is incomplete.`);
  }
  if (
    receipt.snapshotId !== manifest.snapshotId ||
    receipt.snapshotSetSha256 !== manifest.snapshotSetSha256
  ) {
    throw new Error(`${consumer} replay used a different snapshot.`);
  }
  const expectedByKey = new Map(
    manifest.requests.map((entry) => [entry.requestKey, entry]),
  );
  for (const row of receipt.consumed) {
    const expected = expectedByKey.get(row.requestKey);
    if (!expected || row.responseSha256 !== expected.response.sha256) {
      throw new Error(`${consumer} replay bytes differ at ${row.requestKey}.`);
    }
  }
}

function eventId(value, label) {
  if (typeof value !== 'string' || value.length === 0) {
    throw new Error(`${label} must be a nonempty event ID.`);
  }
  return value;
}

function safeArray(value) {
  return Array.isArray(value) ? value : [];
}

function hhrEventByGameId(hhrArchive) {
  const result = new Map();
  for (const game of safeArray(hhrArchive.games)) {
    if (
      Number.isSafeInteger(game?.gameId) &&
      typeof game?.providerEventId === 'string' &&
      game.providerEventId.length > 0
    ) {
      result.set(game.gameId, game.providerEventId);
    }
  }
  return result;
}

function hhrExclusionEventId(exclusion, byGameId) {
  if (
    typeof exclusion?.providerEventId === 'string' &&
    exclusion.providerEventId.length > 0
  ) {
    return exclusion.providerEventId;
  }
  if (Number.isSafeInteger(exclusion?.gameId)) {
    return byGameId.get(exclusion.gameId) ?? null;
  }
  return null;
}

export function decideClaimedGameCoverage({
  claimedGames,
  hitsArchive,
  hhrArchive,
}) {
  if (!Array.isArray(claimedGames) || claimedGames.length === 0) {
    throw new Error('Coverage decision requires claimed games.');
  }
  const claimedIds = claimedGames.map((game, index) =>
    eventId(game?.eventId, `claimedGames[${index}].eventId`),
  );
  if (new Set(claimedIds).size !== claimedIds.length) {
    throw new Error('Coverage decision received duplicate claimed event IDs.');
  }
  const claimSet = new Set(claimedIds);

  const hitsPregameIds = new Set(
    safeArray(hitsArchive?.pregameEvents).map((event, index) =>
      eventId(event?.eventId, `hitsArchive.pregameEvents[${index}].eventId`),
    ),
  );
  if (
    hitsPregameIds.size !== claimSet.size ||
    [...claimSet].some((id) => !hitsPregameIds.has(id))
  ) {
    throw new Error('Hits archive pregame event scope differs from controller claims.');
  }

  const hitsReady = new Set(
    safeArray(hitsArchive?.rankedRows)
      .map((row) => row?.normalizedOffer?.providerEventId)
      .filter((id) => typeof id === 'string' && claimSet.has(id)),
  );
  const hitsBlocked = new Set();
  let hitsUnscopedExclusion = false;
  for (const exclusion of safeArray(hitsArchive?.exclusions)) {
    if (
      typeof exclusion?.providerEventId === 'string' &&
      claimSet.has(exclusion.providerEventId)
    ) {
      hitsBlocked.add(exclusion.providerEventId);
    } else if (
      exclusion?.providerEventId === undefined ||
      exclusion?.providerEventId === null
    ) {
      hitsUnscopedExclusion = true;
    }
  }

  const hhrByGameId = hhrEventByGameId(hhrArchive);
  const hhrResolved = new Set(
    [...hhrByGameId.values()].filter((id) => claimSet.has(id)),
  );
  const hhrReady = new Set(
    safeArray(hhrArchive?.rows)
      .map((row) => row?.providerEventId)
      .filter((id) => typeof id === 'string' && claimSet.has(id)),
  );
  const hhrBlocked = new Set();
  let hhrUnscopedExclusion = false;
  for (const exclusion of safeArray(hhrArchive?.exclusions)) {
    const id = hhrExclusionEventId(exclusion, hhrByGameId);
    if (id !== null && claimSet.has(id)) {
      hhrBlocked.add(id);
    } else if (id === null) {
      hhrUnscopedExclusion = true;
    }
  }

  const coveredEventIds = [];
  const deferredGames = [];
  for (const game of claimedGames) {
    const reasons = [];
    if (!hitsReady.has(game.eventId)) reasons.push('hits-no-ranked-candidate');
    if (hitsBlocked.has(game.eventId) || hitsUnscopedExclusion) {
      reasons.push('hits-has-unresolved-exclusion');
    }
    if (!hhrResolved.has(game.eventId)) reasons.push('hhr-game-not-resolved');
    if (!hhrReady.has(game.eventId)) reasons.push('hhr-no-evidence-row');
    if (hhrBlocked.has(game.eventId) || hhrUnscopedExclusion) {
      reasons.push('hhr-has-unresolved-exclusion');
    }
    if (reasons.length === 0) {
      coveredEventIds.push(game.eventId);
    } else {
      deferredGames.push(
        Object.freeze({
          eventId: game.eventId,
          gameIdentity: game.gameIdentity,
          reasons: Object.freeze(reasons),
        }),
      );
    }
  }

  return Object.freeze({
    coveredEventIds: Object.freeze(coveredEventIds),
    deferredGames: Object.freeze(deferredGames),
  });
}

async function archiveCapturedAt(root, capturedAt, label) {
  const directory = path.join(root, 'captures');
  const prefix = `${iso(capturedAt).replace(/[-:.]/gu, '')}--`;
  const entries = await readdir(directory, { withFileTypes: true });
  const matches = entries
    .filter(
      (entry) =>
        entry.isFile() &&
        entry.name.startsWith(prefix) &&
        entry.name.endsWith('.json'),
    )
    .map((entry) => entry.name)
    .sort();
  if (matches.length !== 1) {
    throw new Error(
      `${label} coverage finalization expected exactly one capture at ${capturedAt}; found ${matches.length}.`,
    );
  }
  const filePath = path.join(directory, matches[0]);
  const value = await readJson(filePath);
  if (iso(value.capturedAt) !== iso(capturedAt)) {
    throw new Error(`${label} capture timestamp drifted during coverage finalization.`);
  }
  return Object.freeze({ filePath, value });
}

export async function finalizeCoverage({
  planPath = path.resolve(
    process.env.M9_CAPTURE_CONTROLLER_PLAN?.trim() ||
      'artifacts/workflow-logs/m9-capture-controller-plan.json',
  ),
  hitsReceiptPath = path.resolve(
    process.env.M9_HITS_REPLAY_RECEIPT?.trim() ||
      'artifacts/workflow-logs/m9-board-replay-hits.json',
  ),
  hhrReceiptPath = path.resolve(
    process.env.M9_HHR_REPLAY_RECEIPT?.trim() ||
      'artifacts/workflow-logs/m9-board-replay-hhr.json',
  ),
  root = path.resolve(
    process.env.M10_ARCHIVE_ROOT?.trim() ||
      'artifacts/board-archives/batter-hits',
  ),
  hhrRoot = path.resolve(
    process.env.M10_HHR_ARCHIVE_ROOT?.trim() ||
      'artifacts/board-archives/batter-hhr',
  ),
  now = () => new Date().toISOString(),
  output = process.stdout,
} = {}) {
  const plan = await readJson(planPath);
  if (plan.contract !== BOARD_RUN_CONTRACT || plan.decision !== 'CAPTURE') {
    throw new Error('Coverage finalization requires a CAPTURE plan.');
  }
  const manifest = await readJson(plan.snapshotManifestPath);
  if (
    manifest.contract !== SNAPSHOT_CONTRACT ||
    manifest.version !== 2 ||
    manifest.snapshotSetSha256 !== plan.snapshotSetSha256
  ) {
    throw new Error('Plan/snapshot identity mismatch.');
  }
  const hitsBytes = await readFile(hitsReceiptPath);
  const hhrBytes = await readFile(hhrReceiptPath);
  verifyReplay(JSON.parse(hitsBytes), 'hits', manifest);
  verifyReplay(JSON.parse(hhrBytes), 'hhr', manifest);
  assertBoardSnapshotBeforeClaimedGames(
    manifest.boardSnapshotCompletedAt,
    plan.claimedGames,
  );

  const [hitsCapture, hhrCapture] = await Promise.all([
    archiveCapturedAt(root, plan.boardSnapshotCompletedAt, 'Batter Hits'),
    archiveCapturedAt(hhrRoot, plan.boardSnapshotCompletedAt, 'HHR'),
  ]);
  const coverageDecision = decideClaimedGameCoverage({
    claimedGames: plan.claimedGames,
    hitsArchive: hitsCapture.value,
    hhrArchive: hhrCapture.value,
  });
  const coveredIds = new Set(coverageDecision.coveredEventIds);

  const receipt = Object.freeze({
    version: 2,
    contract: COVERAGE_CONTRACT,
    snapshotId: manifest.snapshotId,
    snapshotSetSha256: manifest.snapshotSetSha256,
    runStartedAt: plan.runStartedAt,
    boardSnapshotCompletedAt: manifest.boardSnapshotCompletedAt,
    runStartToSnapshotElapsedMs: manifest.runStartToSnapshotElapsedMs,
    finalizedAt: iso(now()),
    coveredGames: Object.freeze(
      plan.claimedGames
        .filter((game) => coveredIds.has(game.eventId))
        .map((game) =>
          Object.freeze({
            eventId: game.eventId,
            commenceTimeUtc: game.commenceTimeUtc,
            homeTeamName: game.homeTeamName,
            awayTeamName: game.awayTeamName,
            gameIdentity: game.gameIdentity,
            captureBand: game.classification,
          }),
        ),
    ),
    deferredGames: coverageDecision.deferredGames,
    archiveEvidence: Object.freeze({
      hitsCapturePath: hitsCapture.filePath,
      hhrCapturePath: hhrCapture.filePath,
    }),
    replayEvidence: Object.freeze({
      hitsReceiptSha256: sha256Bytes(hitsBytes),
      hhrReceiptSha256: sha256Bytes(hhrBytes),
    }),
  });
  const receiptPath = path.join(
    root,
    'capture-controller',
    'coverage-receipts',
    `${manifest.snapshotId}.json`,
  );
  await exactWrite(
    receiptPath,
    Buffer.from(`${JSON.stringify(receipt, null, 2)}\n`, 'utf8'),
  );
  await appendOutputs({ coverage_receipt: receiptPath });
  output.write(
    `M9 COVERAGE FINALIZED\tcovered=${receipt.coveredGames.length}\tdeferred=${receipt.deferredGames.length}\tsnapshotSetSha256=${manifest.snapshotSetSha256}\n`,
  );
  return Object.freeze({ receipt, receiptPath });
}

export async function main(args = process.argv.slice(2)) {
  if (args.length === 1 && args[0] === 'plan') return planBoardRun();
  if (args.length === 1 && args[0] === 'finalize') return finalizeCoverage();
  throw new Error(
    'Usage: node scripts/m9-capture-controller.mjs <plan|finalize>',
  );
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href
) {
  main().catch((error) => {
    process.stderr.write(
      `${error instanceof Error ? error.stack ?? error.message : String(error)}\n`,
    );
    process.exitCode = 1;
  });
}
