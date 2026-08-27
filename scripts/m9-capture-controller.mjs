import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import {
  captureFirstBoardSnapshot,
  REPLAY_CONTRACT,
  sha256Bytes,
  SNAPSHOT_CONTRACT,
} from './m9-board-snapshot-preload.mjs';
import { chicagoDateKey } from './chicago-slate-date-utils.mjs';

export const NORMAL_WINDOW_MINUTES = 40;
export const NORMAL_WINDOW_MAX_MINUTES = 110;
export const BOARD_RUN_CONTRACT = 'm9-schedule-aware-board-run-v1';
export const COVERAGE_CONTRACT = 'm9-game-coverage-receipt-v2';
export const CURRENT_SLATE_BOOTSTRAP_MODE = 'CURRENT_SLATE_BOOTSTRAP';
const LEGACY_COVERAGE_CONTRACT = 'm9-game-coverage-receipt-v1';
const COVERAGE_CONTRACTS = new Set([
  LEGACY_COVERAGE_CONTRACT,
  COVERAGE_CONTRACT,
]);
const DISPLAY_CAPTURE_PATTERN = /^\d{8}T\d{9}Z--[a-f0-9]{64}\.json$/u;

const iso = (value) => new Date(value).toISOString();
const gameKey = (event) => `${event.eventId}@${event.commenceTimeUtc}`;

function configuredBinaryFlag(name) {
  const raw = process.env[name]?.trim();
  if (raw === undefined || raw === '' || raw === '0') return false;
  if (raw === '1') return true;
  throw new Error(`${name} must be 0 or 1.`);
}

function configuredCaptureAllPregame() {
  return configuredBinaryFlag('M9_CAPTURE_ALL_PREGAME');
}

function configuredAutoCurrentSlate() {
  return configuredBinaryFlag('M9_AUTO_CURRENT_SLATE');
}

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
  captureAllPregame = false,
  captureCurrentSlate = false,
}) {
  if (typeof captureAllPregame !== 'boolean') {
    throw new TypeError('captureAllPregame must be a boolean.');
  }
  if (typeof captureCurrentSlate !== 'boolean') {
    throw new TypeError('captureCurrentSlate must be a boolean.');
  }
  const startMs = Date.parse(runStartedAt);
  if (!Number.isFinite(startMs)) throw new Error('runStartedAt must be ISO time.');
  const runSlateDate = captureCurrentSlate ? chicagoDateKey(runStartedAt) : null;
  const covered = new Set(coveredGameIdentities);
  const claimedGames = [];
  const evaluations = events.map((event) => {
    const gameIdentity = gameKey(event);
    const minutesToFirstPitch =
      (Date.parse(event.commenceTimeUtc) - startMs) / 60_000;
    let classification = 'OUTSIDE_WINDOW';
    if (minutesToFirstPitch <= 0) classification = 'STARTED';
    else if (captureAllPregame) classification = 'USER_PROJECTION';
    else if (
      captureCurrentSlate &&
      chicagoDateKey(event.commenceTimeUtc) === runSlateDate
    ) {
      classification = CURRENT_SLATE_BOOTSTRAP_MODE;
    } else if (covered.has(gameIdentity)) classification = 'COVERED';
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
    if (
      classification === 'NORMAL' ||
      classification === 'RECOVERY' ||
      classification === 'USER_PROJECTION' ||
      classification === CURRENT_SLATE_BOOTSTRAP_MODE
    ) {
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
    const startMs = Date.parse(game.commenceTimeUtc);
    if (!Number.isFinite(startMs)) {
      throw new Error(`Invalid claimed game commence time for ${game.eventId}.`);
    }
    if (completedMs >= startMs) {
      throw new Error(
        `First board snapshot for ${game.eventId} completed at or after first pitch.`,
      );
    }
  }
}

function safeReadJson(filePath) {
  return readFile(filePath, 'utf8')
    .then((text) => JSON.parse(text))
    .catch((error) => {
      if (error?.code === 'ENOENT') return null;
      throw error;
    });
}

async function readJson(filePath) {
  return JSON.parse(await readFile(filePath, 'utf8'));
}

async function appendOutputs(values) {
  const outputPath = process.env.GITHUB_OUTPUT;
  if (!outputPath) return;
  const lines = Object.entries(values)
    .filter(([, value]) => value !== undefined && value !== null)
    .map(([key, value]) => `${key}=${String(value)}`)
    .join('\n');
  if (lines.length === 0) return;
  await writeFile(outputPath, `${lines}\n`, { flag: 'a' });
}

function coverageIdentity(entry) {
  if (
    typeof entry?.eventId !== 'string' ||
    entry.eventId.length === 0 ||
    typeof entry?.commenceTimeUtc !== 'string' ||
    !Number.isFinite(Date.parse(entry.commenceTimeUtc))
  ) {
    return null;
  }
  return `${entry.eventId}@${iso(entry.commenceTimeUtc)}`;
}

function coverageReceiptPaths(root) {
  return [
    path.join(root, 'capture-controller', 'coverage-receipts'),
    path.join(root, 'capture-controller', 'coverage-receipts-v1'),
  ];
}

async function readCoverageReceipts(root) {
  const receipts = [];
  for (const directory of coverageReceiptPaths(root)) {
    let entries;
    try {
      entries = await readdir(directory, { withFileTypes: true });
    } catch (error) {
      if (error?.code === 'ENOENT') continue;
      throw error;
    }
    for (const entry of entries) {
      if (!entry.isFile() || !entry.name.endsWith('.json')) continue;
      const filePath = path.join(directory, entry.name);
      const receipt = await safeReadJson(filePath);
      if (receipt === null || !COVERAGE_CONTRACTS.has(receipt.contract)) continue;
      receipts.push(receipt);
    }
  }
  return receipts;
}

async function coveredGameIdentities(root) {
  const receipts = await readCoverageReceipts(root);
  const covered = new Set();
  for (const receipt of receipts) {
    for (const game of Array.isArray(receipt.coveredGames)
      ? receipt.coveredGames
      : []) {
      const identity = coverageIdentity(game);
      if (identity !== null) covered.add(identity);
    }
  }
  return covered;
}

async function newestDisplayCapturedAt(displayRoot, market) {
  const directory = path.join(displayRoot, market, 'captures');
  let entries;
  try {
    entries = await readdir(directory, { withFileTypes: true });
  } catch (error) {
    if (error?.code === 'ENOENT') return null;
    throw error;
  }
  const names = entries
    .filter((entry) => entry.isFile() && DISPLAY_CAPTURE_PATTERN.test(entry.name))
    .map((entry) => entry.name)
    .sort()
    .reverse();
  if (names.length === 0) return null;
  const value = await readJson(path.join(directory, names[0]));
  if (typeof value?.capturedAt !== 'string' || !Number.isFinite(Date.parse(value.capturedAt))) {
    throw new Error(`Newest ${market} display capture has invalid capturedAt.`);
  }
  return iso(value.capturedAt);
}

export function shouldBootstrapCurrentSlate({
  runStartedAt,
  hitsCapturedAt,
  hhrCapturedAt,
}) {
  const currentSlateDate = chicagoDateKey(runStartedAt);
  const captures = [
    ['batter-hits', hitsCapturedAt],
    ['batter-hhr', hhrCapturedAt],
  ];
  for (const [market, capturedAt] of captures) {
    if (capturedAt === null) continue;
    if (typeof capturedAt !== 'string' || !Number.isFinite(Date.parse(capturedAt))) {
      throw new Error(`${market} display capturedAt must be valid or null.`);
    }
    const captureSlateDate = chicagoDateKey(capturedAt);
    if (captureSlateDate > currentSlateDate) {
      throw new Error(
        `${market} display capture is future-dated for the current Chicago slate.`,
      );
    }
  }
  if (hitsCapturedAt === null || hhrCapturedAt === null) return true;
  if (chicagoDateKey(hitsCapturedAt) !== currentSlateDate) return true;
  if (chicagoDateKey(hhrCapturedAt) !== currentSlateDate) return true;
  return iso(hitsCapturedAt) !== iso(hhrCapturedAt);
}

async function currentSlateBootstrapRequired(runStartedAt) {
  if (!configuredAutoCurrentSlate()) return false;
  const displayRoot = path.resolve(
    process.env.M9_DISPLAY_ARCHIVE_ROOT?.trim() || 'artifacts/display-archives',
  );
  const [hitsCapturedAt, hhrCapturedAt] = await Promise.all([
    newestDisplayCapturedAt(displayRoot, 'batter-hits'),
    newestDisplayCapturedAt(displayRoot, 'batter-hhr'),
  ]);
  return shouldBootstrapCurrentSlate({
    runStartedAt,
    hitsCapturedAt,
    hhrCapturedAt,
  });
}

function captureModeForDecision(decision) {
  const classifications = new Set(
    decision.claimedGames.map((game) => game.classification),
  );
  if (classifications.has('USER_PROJECTION')) return 'USER_PROJECTION';
  if (classifications.has(CURRENT_SLATE_BOOTSTRAP_MODE)) {
    return CURRENT_SLATE_BOOTSTRAP_MODE;
  }
  return decision.decision === 'CAPTURE' ? 'SCHEDULE_WINDOW' : 'NOOP';
}

function scheduleUrl(apiKey) {
  const url = new URL(
    'https://api.the-odds-api.com/v4/sports/baseball_mlb/events',
  );
  url.searchParams.set('apiKey', apiKey);
  url.searchParams.set('dateFormat', 'iso');
  return url;
}

export async function planBoardRun({
  root = path.resolve(
    process.env.M10_ARCHIVE_ROOT?.trim() ||
      'artifacts/board-archives/batter-hits',
  ),
  planPath = path.resolve(
    process.env.M9_CAPTURE_CONTROLLER_PLAN?.trim() ||
      'artifacts/workflow-logs/m9-capture-controller-plan.json',
  ),
  fetchImpl = globalThis.fetch,
  now = () => new Date().toISOString(),
  output = process.stdout,
} = {}) {
  const apiKey = process.env.THE_ODDS_API_KEY?.trim();
  if (!apiKey) throw new Error('Missing THE_ODDS_API_KEY.');
  const runStartedAt = iso(now());
  const url = scheduleUrl(apiKey);
  const scheduleResponse = await fetchImpl(url);
  const scheduleBytes = Buffer.from(await scheduleResponse.clone().arrayBuffer());
  if (!scheduleResponse.ok) {
    throw new Error(`The Odds API schedule returned HTTP ${scheduleResponse.status}.`);
  }
  const rawEvents = JSON.parse(scheduleBytes.toString('utf8'));
  const events = normalizeScheduleEvents(rawEvents);
  const covered = await coveredGameIdentities(root);
  const captureCurrentSlate = await currentSlateBootstrapRequired(runStartedAt);
  const decision = decideBoardRun({
    events,
    coveredGameIdentities: [...covered],
    runStartedAt,
    captureAllPregame: configuredCaptureAllPregame(),
    captureCurrentSlate,
  });
  const captureMode = captureModeForDecision(decision);
  if (decision.decision === 'NOOP') {
    const plan = Object.freeze({
      version: 1,
      contract: BOARD_RUN_CONTRACT,
      decision: 'NOOP',
      captureMode,
      runStartedAt,
      claimedGames: decision.claimedGames,
      evaluations: decision.evaluations,
    });
    await mkdir(path.dirname(planPath), { recursive: true });
    await writeFile(planPath, `${JSON.stringify(plan, null, 2)}\n`);
    await appendOutputs({
      decision: 'NOOP',
      capture_mode: captureMode,
      plan_path: planPath,
    });
    output.write('M9 BOARD RUN CONTROLLER\tNOOP\n');
    return plan;
  }

  const snapshotStartedAt = iso(now());
  const snapshot = await captureFirstBoardSnapshot({
    fetchImpl,
    archiveRoot: root,
    runStartedAt,
    snapshotStartedAt,
    scheduleUrl: url,
    scheduleResponse,
    scheduleBytes,
    scheduleCapturedAt: snapshotStartedAt,
    events,
    claimedGames: decision.claimedGames,
    now,
  });
  assertBoardSnapshotBeforeClaimedGames(
    snapshot.manifest.boardSnapshotCompletedAt,
    decision.claimedGames,
  );
  await mkdir(path.dirname(planPath), { recursive: true });
  const plan = Object.freeze({
    version: 1,
    contract: BOARD_RUN_CONTRACT,
    decision: 'CAPTURE',
    captureMode,
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
    capture_mode: captureMode,
    plan_path: planPath,
    snapshot_manifest: snapshot.manifestPath,
    snapshot_id: plan.snapshotId,
    snapshot_set_sha256: plan.snapshotSetSha256,
    snapshot_completed_at: plan.boardSnapshotCompletedAt,
  });
  output.write(
    `M9 BOARD RUN CONTROLLER\tCAPTURE\tmode=${captureMode}\tclaimed=${plan.claimedGames.length}\tsnapshotSetSha256=${plan.snapshotSetSha256}\telapsedMs=${plan.runStartToSnapshotElapsedMs}\n`,
  );
  return plan;
}

function verifyReplay(receipt, consumer, manifest) {
  if (
    receipt.contract !== REPLAY_CONTRACT ||
    receipt.version !== 3 ||
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

export function coverageReceiptDecision({
  captureMode,
  claimedGames,
  coverageDecision,
}) {
  if (captureMode !== CURRENT_SLATE_BOOTSTRAP_MODE) {
    return coverageDecision;
  }
  const deferredByEvent = new Map(
    coverageDecision.deferredGames.map((game) => [game.eventId, game.reasons]),
  );
  return Object.freeze({
    coveredEventIds: Object.freeze([]),
    deferredGames: Object.freeze(
      claimedGames.map((game) =>
        Object.freeze({
          eventId: game.eventId,
          gameIdentity: game.gameIdentity,
          reasons: Object.freeze([
            'current-slate-bootstrap-refresh',
            ...(deferredByEvent.get(game.eventId) ?? []),
          ]),
        }),
      ),
    ),
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
    manifest.version !== 3 ||
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
  const rawCoverageDecision = decideClaimedGameCoverage({
    claimedGames: plan.claimedGames,
    hitsArchive: hitsCapture.value,
    hhrArchive: hhrCapture.value,
  });
  const coverageDecision = coverageReceiptDecision({
    captureMode: plan.captureMode,
    claimedGames: plan.claimedGames,
    coverageDecision: rawCoverageDecision,
  });
  const coveredIds = new Set(coverageDecision.coveredEventIds);

  const receipt = Object.freeze({
    version: 2,
    contract: COVERAGE_CONTRACT,
    snapshotId: manifest.snapshotId,
    snapshotSetSha256: manifest.snapshotSetSha256,
    createdAt: iso(now()),
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
          }),
        ),
    ),
    deferredGames: coverageDecision.deferredGames,
    sourceArchives: Object.freeze({
      batterHits: Object.freeze({
        filePath: hitsCapture.filePath,
        captureKey: hitsCapture.value.captureIdentity?.captureKey ?? null,
      }),
      batterHhr: Object.freeze({
        filePath: hhrCapture.filePath,
        captureKey: hhrCapture.value.captureKey ?? null,
      }),
    }),
  });
  const receiptPath = path.join(
    root,
    'capture-controller',
    'coverage-receipts',
    `${manifest.snapshotId}.json`,
  );
  await mkdir(path.dirname(receiptPath), { recursive: true });
  await writeFile(receiptPath, `${JSON.stringify(receipt, null, 2)}\n`, {
    flag: 'wx',
  });
  await appendOutputs({
    coverage_receipt: receiptPath,
    covered_game_count: receipt.coveredGames.length,
    deferred_game_count: receipt.deferredGames.length,
  });
  output.write(
    `M9 COVERAGE FINALIZED\tcovered=${receipt.coveredGames.length}\tdeferred=${receipt.deferredGames.length}\treceipt=${receiptPath}\n`,
  );
  return receipt;
}

export async function main(args = process.argv.slice(2)) {
  const command = args[0] ?? 'plan';
  if (command === 'plan') {
    await planBoardRun();
    return;
  }
  if (command === 'finalize') {
    await finalizeCoverage();
    return;
  }
  throw new Error('Usage: node scripts/m9-capture-controller.mjs [plan|finalize]');
}

const invokedPath = process.argv[1];
if (
  invokedPath !== undefined &&
  import.meta.url === pathToFileURL(path.resolve(invokedPath)).href
) {
  main().catch((error) => {
    process.stderr.write(
      `${error instanceof Error ? error.stack ?? error.message : String(error)}\n`,
    );
    process.exitCode = 1;
  });
}
