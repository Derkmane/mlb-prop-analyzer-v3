import { access, mkdir, readFile, readdir } from 'node:fs/promises';
import path from 'node:path';

import { persistImmutableJson } from './m10-grade-saved-archive-utils.mjs';
import {
  buildM10HhrCumulativeSelectedSideReport,
  buildM10HhrFinalGradeReport,
  classifyHhrArchiveGameStatuses,
  HhrCaptureEvidenceError,
  hhrCumulativeInputDiagnostics,
  M10_HHR_CUMULATIVE_VERSION,
  M10_HHR_GRADE_VERSION,
  verifyM10HhrArchiveBytes,
  verifyM10HhrGradeReport,
} from './m10-hhr-evidence-utils.mjs';

const bdlKey = process.env.BALLDONTLIE_API_KEY?.trim();
if (!bdlKey) throw new Error('Missing BALLDONTLIE_API_KEY.');

const ARCHIVE_ROOT = path.resolve(
  process.env.M10_HHR_ARCHIVE_ROOT?.trim() || 'artifacts/board-archives/batter-hhr',
);
const STEP3_ARCHIVE_PATH = path.resolve(
  'artifacts/m11/hhr/step3/archives/20260806T004000Z--2c2e9c408a2226dfea2bcc42b009203d26bc2a307e08caed05f3b31e361aabdf.json',
);
const CAPTURE_PATTERN = /^(\d{8}T\d{9}Z--[a-f0-9]{64})\.json$/u;
const ATTEMPT_ID = process.env.M10_GRADE_ATTEMPT_ID?.trim() || `local-${Date.now()}`;
const MIN_REQUEST_INTERVAL_MS = Number(
  process.env.M10_BDL_MIN_REQUEST_INTERVAL_MS?.trim() || '13000',
);
const sleep = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));

async function exists(filePath) {
  try {
    await access(filePath);
    return true;
  } catch (error) {
    if (error && typeof error === 'object' && error.code === 'ENOENT') return false;
    throw error;
  }
}

async function fetchBdl(url, label) {
  if (fetchBdl.lastAt) {
    const elapsed = Date.now() - fetchBdl.lastAt;
    if (elapsed < MIN_REQUEST_INTERVAL_MS) await sleep(MIN_REQUEST_INTERVAL_MS - elapsed);
  }
  for (let attempt = 0; attempt <= 8; attempt += 1) {
    const response = await fetch(url, { headers: { Authorization: bdlKey } });
    fetchBdl.lastAt = Date.now();
    const text = await response.text();
    if (response.status === 429 && attempt < 8) {
      const retrySeconds = Number(response.headers.get('retry-after'));
      await sleep(Number.isFinite(retrySeconds) ? retrySeconds * 1000 : MIN_REQUEST_INTERVAL_MS);
      continue;
    }
    if (!response.ok) throw new Error(`${label} returned HTTP ${response.status}: ${text.slice(0, 500)}`);
    return Object.freeze({ body: JSON.parse(text), capturedAt: new Date().toISOString() });
  }
  throw new Error(`${label} exhausted retries.`);
}
fetchBdl.lastAt = 0;

function providerMeta(snapshot, label) {
  const meta = snapshot.body?.meta;
  if (meta === null || typeof meta !== 'object' || Array.isArray(meta)) {
    throw new Error(`${label} meta must be an object.`);
  }
  return Object.freeze({ ...meta });
}

async function fetchGames(gameIds) {
  const rows = [];
  let capturedAt;
  for (const gameId of gameIds) {
    const snapshot = await fetchBdl(
      new URL(`https://api.balldontlie.io/mlb/v1/games/${gameId}`),
      `BDL HHR game status ${gameId}`,
    );
    const game = snapshot.body?.data;
    if (!game || typeof game !== 'object' || Array.isArray(game)) {
      throw new Error(`BDL HHR game status ${gameId} data must be an object.`);
    }
    rows.push(game);
    capturedAt = snapshot.capturedAt;
  }
  if (capturedAt === undefined) {
    throw new Error('BDL HHR game status requires at least one game ID.');
  }
  return Object.freeze({
    body: Object.freeze({ data: Object.freeze(rows) }),
    capturedAt,
  });
}

async function fetchStatsForGames(gameIds) {
  const rows = [];
  const snapshots = [];
  for (const gameId of gameIds) {
    const url = new URL('https://api.balldontlie.io/mlb/v1/stats');
    url.searchParams.append('game_ids[]', String(gameId));
    url.searchParams.set('per_page', '100');
    const snapshot = await fetchBdl(url, `BDL HHR stats game ${gameId}`);
    const data = snapshot.body?.data;
    if (!Array.isArray(data)) throw new Error(`BDL HHR stats game ${gameId} data must be an array.`);
    const meta = providerMeta(snapshot, `BDL HHR stats game ${gameId}`);
    rows.push(...data);
    snapshots.push(Object.freeze({
      gameId,
      capturedAt: snapshot.capturedAt,
      rowCount: data.length,
      meta,
    }));
  }
  return Object.freeze({ rows: Object.freeze(rows), snapshots: Object.freeze(snapshots) });
}

async function fetchLineupsForGames(gameIds) {
  const rows = [];
  const snapshots = [];
  for (const gameId of gameIds) {
    const url = new URL('https://api.balldontlie.io/mlb/v1/lineups');
    url.searchParams.append('game_ids[]', String(gameId));
    url.searchParams.set('per_page', '100');
    const snapshot = await fetchBdl(url, `BDL HHR lineups game ${gameId}`);
    const data = snapshot.body?.data;
    if (!Array.isArray(data)) throw new Error(`BDL HHR lineups game ${gameId} data must be an array.`);
    const meta = providerMeta(snapshot, `BDL HHR lineups game ${gameId}`);
    rows.push(...data);
    snapshots.push(Object.freeze({
      gameId,
      capturedAt: snapshot.capturedAt,
      rowCount: data.length,
      meta,
    }));
  }
  return Object.freeze({ rows: Object.freeze(rows), snapshots: Object.freeze(snapshots) });
}

const capturesDirectory = path.join(ARCHIVE_ROOT, 'captures');
await mkdir(capturesDirectory, { recursive: true });
const captureEntries = await readdir(capturesDirectory, { withFileTypes: true });
const captures = captureEntries
  .filter((entry) => entry.isFile() && CAPTURE_PATTERN.test(entry.name))
  .map((entry) => ({ captureKey: CAPTURE_PATTERN.exec(entry.name)[1], filePath: path.join(capturesDirectory, entry.name) }))
  .sort((left, right) => left.captureKey.localeCompare(right.captureKey));

console.log('--- M10 HHR FINAL-ONLY GRADING ---');
console.log(`ARCHIVE ROOT\t${ARCHIVE_ROOT}`);
console.log(`CAPTURES DISCOVERED\t${captures.length}`);

let graded = 0;
let skippedNonFinal = 0;
let alreadyGraded = 0;
const blockedCaptures = [];
for (const capture of captures) {
  const archiveBytes = await readFile(capture.filePath);
  const archive = verifyM10HhrArchiveBytes({
    bytes: archiveBytes,
    archivePath: capture.filePath,
    expectedCaptureKey: capture.captureKey,
  });
  const gradePath = path.join(ARCHIVE_ROOT, capture.captureKey, 'grades', `${M10_HHR_GRADE_VERSION}.json`);
  if (await exists(gradePath)) {
    const existing = verifyM10HhrGradeReport(JSON.parse(await readFile(gradePath, 'utf8')));
    if (
      existing.source.captureKey !== archive.captureKey ||
      existing.source.archiveSha256 !== archive.archiveSha256 ||
      existing.source.archiveFileSha256 !== archive.archiveFileSha256
    ) {
      throw new Error(`Existing HHR grade report lineage drifted for ${capture.captureKey}.`);
    }
    alreadyGraded += 1;
    console.log(`ALREADY GRADED\t${capture.captureKey}`);
    continue;
  }

  const gameIds = [...new Set(archive.rows.map((row) => row.providerGameId))].sort((a, b) => a - b);
  const gamesSnapshot = await fetchGames(gameIds);
  const rawGames = gamesSnapshot.body?.data;
  if (!Array.isArray(rawGames)) throw new Error('BDL HHR game status data must be an array.');
  const statusEvidence = classifyHhrArchiveGameStatuses(archive, rawGames);
  const statusPath = path.join(ARCHIVE_ROOT, capture.captureKey, 'status', `${ATTEMPT_ID}.json`);
  await persistImmutableJson(statusPath, {
    statusEvidenceVersion: 1,
    statusEvidenceType: 'm10-hhr-final-status-before-gate',
    captureKey: archive.captureKey,
    checkedAt: gamesSnapshot.capturedAt,
    games: statusEvidence.games,
    readyToGradeObserved: statusEvidence.readyToGrade,
    gateEvaluatedAfterPersistence: true,
    productionEnabled: false,
    rankingEnabled: false,
  });
  console.log(`STATUS DIAGNOSTIC WRITTEN\t${capture.captureKey}\t${statusPath}`);

  if (!statusEvidence.readyToGrade) {
    skippedNonFinal += 1;
    console.log(`SKIP NON-FINAL\t${capture.captureKey}\t${statusEvidence.nonFinalGames.map((row) => `${row.gameId}:${row.status}`).join(',')}`);
    continue;
  }

  const stats = await fetchStatsForGames(statusEvidence.requiredGameIds);
  const lineups = await fetchLineupsForGames(statusEvidence.requiredGameIds);
  const providerEvidencePath = path.join(
    ARCHIVE_ROOT,
    capture.captureKey,
    'provider-evidence',
    `${ATTEMPT_ID}--stats-input.json`,
  );
  await persistImmutableJson(providerEvidencePath, {
    providerEvidenceVersion: 2,
    providerEvidenceType: 'm10-hhr-final-stats-and-lineups-before-grade',
    captureKey: archive.captureKey,
    capturedAt: new Date().toISOString(),
    provider: 'BALLDONTLIE MLB API',
    statsGameSnapshots: stats.snapshots,
    statsRowCount: stats.rows.length,
    lineupGameSnapshots: lineups.snapshots,
    lineupRowCount: lineups.rows.length,
    gradeEvaluatedAfterPersistence: true,
    productionEnabled: false,
    rankingEnabled: false,
  });

  let report;
  try {
    report = buildM10HhrFinalGradeReport({
      archive,
      statsRows: stats.rows,
      statsSnapshots: stats.snapshots,
      lineupRows: lineups.rows,
      lineupSnapshots: lineups.snapshots,
      gradedAt: new Date().toISOString(),
      gameStatusEvidence: statusEvidence,
    });
  } catch (error) {
    if (!(error instanceof HhrCaptureEvidenceError)) throw error;

    const message = error.message;
    const providerGameId = error.providerGameId;
    const providerPlayerId = error.providerPlayerId;
    const providerIdentity = error.providerIdentity;
    const blockedStatusPath = path.join(
      ARCHIVE_ROOT,
      capture.captureKey,
      'blocked-status',
      `${ATTEMPT_ID}.json`,
    );
    const blockedStatus = Object.freeze({
      blockedStatusVersion: 1,
      blockedStatusType: 'm10-hhr-capture-blocked-evidence',
      captureKey: archive.captureKey,
      blockedAt: new Date().toISOString(),
      evidenceCode: error.code,
      providerGameId,
      providerPlayerId,
      providerIdentity,
      error: message,
      gradeReportWritten: false,
      cumulativeEvidenceIncluded: false,
      productionEnabled: false,
      rankingEnabled: false,
    });
    await persistImmutableJson(blockedStatusPath, blockedStatus);
    blockedCaptures.push(blockedStatus);
    console.error(`BLOCKED\t${capture.captureKey}\t${providerIdentity}\t${message}`);
    console.error(`BLOCKED STATUS WRITTEN\t${capture.captureKey}\t${blockedStatusPath}`);
    continue;
  }

  await persistImmutableJson(gradePath, report);
  graded += 1;
  console.log(`GRADED\t${capture.captureKey}\trows=${report.rows.length}\twins=${report.summary.wins}\tlosses=${report.summary.losses}\tvoids=${report.summary.voids}`);
  console.log('ARCHIVE MODIFIED\tfalse');
}

const gradeReports = [];
const reportEntries = await readdir(ARCHIVE_ROOT, { withFileTypes: true });
for (const entry of reportEntries) {
  if (!entry.isDirectory() || !CAPTURE_PATTERN.test(`${entry.name}.json`)) continue;
  const gradePath = path.join(ARCHIVE_ROOT, entry.name, 'grades', `${M10_HHR_GRADE_VERSION}.json`);
  if (!(await exists(gradePath))) continue;
  gradeReports.push(verifyM10HhrGradeReport(JSON.parse(await readFile(gradePath, 'utf8'))));
}
gradeReports.sort((left, right) => left.source.captureKey.localeCompare(right.source.captureKey));
const step3Archive = JSON.parse(await readFile(STEP3_ARCHIVE_PATH, 'utf8'));

const cumulativeDiagnostic = hhrCumulativeInputDiagnostics({ step3Archive, gradeReports });
const cumulativeDiagnosticDirectory = path.join(ARCHIVE_ROOT, 'cumulative-input-diagnostics');
await mkdir(cumulativeDiagnosticDirectory, { recursive: true });
const cumulativeDiagnosticPath = path.join(cumulativeDiagnosticDirectory, `${ATTEMPT_ID}.json`);
await persistImmutableJson(cumulativeDiagnosticPath, {
  ...cumulativeDiagnostic,
  generatedAt: new Date().toISOString(),
  thresholdEvaluationOccursAfterThisFile: true,
});
console.log(`CUMULATIVE INPUT DIAGNOSTIC WRITTEN\t${cumulativeDiagnosticPath}`);

const cumulativeGeneratedAt = [
  step3Archive.gradedAt,
  ...gradeReports.map((report) => report.gradedAt),
]
  .filter((value) => typeof value === 'string' && Number.isFinite(Date.parse(value)))
  .sort()
  .at(-1);
if (cumulativeGeneratedAt === undefined) {
  throw new Error('HHR cumulative sources do not expose a deterministic generatedAt timestamp.');
}
const cumulative = buildM10HhrCumulativeSelectedSideReport({
  step3Archive,
  gradeReports,
  generatedAt: cumulativeGeneratedAt,
});
const cumulativePath = path.join(
  ARCHIVE_ROOT,
  'cumulative',
  `${M10_HHR_CUMULATIVE_VERSION}--${cumulative.sourceSetSha256}.json`,
);
if (await exists(cumulativePath)) {
  const existing = Buffer.from(await readFile(cumulativePath));
  const expected = Buffer.from(`${JSON.stringify(cumulative, null, 2)}\n`, 'utf8');
  if (!existing.equals(expected)) {
    throw new Error(`Immutable HHR cumulative report drifted: ${cumulativePath}`);
  }
  console.log(`VERIFIED CUMULATIVE\t${cumulative.sourceSetSha256}`);
} else {
  await persistImmutableJson(cumulativePath, cumulative);
  console.log(`CREATED CUMULATIVE\t${cumulative.sourceSetSha256}`);
}

console.log(`HHR CUMULATIVE ARCHIVES\t${cumulative.archivesIncluded}`);
console.log(`HHR CUMULATIVE SELECTED-SIDE ROWS\t${cumulative.selectedSide.summary.picksGraded}`);
for (const [cohort, value] of Object.entries(cumulative.selectedSide.perLine)) {
  console.log(`HHR LINE COHORT\t${cohort}\tn=${value.summary.picksGraded}\tstatus=${value.evidenceStatus}`);
  for (const bucket of value.calibration) {
    console.log(`HHR LINE CALIBRATION\t${cohort}\t${bucket.label}\tn=${bucket.picksGraded}\tstatus=${bucket.evidenceStatus}`);
  }
}
for (const bucket of cumulative.selectedSide.calibration) {
  console.log(`HHR OVERALL CALIBRATION\t${bucket.label}\tn=${bucket.picksGraded}\tstatus=${bucket.evidenceStatus}`);
}
console.log(`GRADED NOW\t${graded}`);
console.log(`ALREADY GRADED\t${alreadyGraded}`);
console.log(`SKIPPED NON-FINAL\t${skippedNonFinal}`);
console.log(`BLOCKED NOW\t${blockedCaptures.length}`);
for (const blocked of blockedCaptures) {
  console.log(`BLOCKED CAPTURE\t${blocked.captureKey}\t${blocked.providerIdentity}\t${blocked.error}`);
}
console.log(`CUMULATIVE PATH\t${cumulativePath}`);
console.log('PRODUCTION\tDISABLED');
console.log('RANKING\tDISABLED');
console.log('EVIDENCE ONLY\ttrue');
console.log('--- END M10 HHR FINAL-ONLY GRADING ---');

if (blockedCaptures.length > 0) {
  process.exitCode = 1;
}