import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import path from 'node:path';

const bdlKey = process.env.BALLDONTLIE_API_KEY?.trim();
if (!bdlKey) throw new Error('Missing BALLDONTLIE_API_KEY.');

const DISPLAY_ROOT = path.resolve('artifacts/display-archives/batter-hhr/captures');
const LEDGER_ROOT = path.resolve(process.env.M10_HHR_ARCHIVE_ROOT?.trim() || 'artifacts/board-archives/batter-hhr');
const OUTPUT_ROOT = path.resolve('artifacts/diagnostics/m11-hhr-scratch-rate');
const CAPTURE_PATTERN = /^(\d{8}T\d{9}Z--[a-f0-9]{64})\.json$/u;
const GRADE_FILE = 'm10-hhr-final-grade-v1.json';

function finiteDate(value, label) {
  const ms = Date.parse(value);
  if (!Number.isFinite(ms)) throw new Error(`${label} must be an ISO timestamp.`);
  return ms;
}
function mean(values) {
  return values.length === 0 ? null : values.reduce((sum, value) => sum + value, 0) / values.length;
}
function median(values) {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
}
function pct(numerator, denominator) {
  return denominator === 0 ? null : numerator / denominator;
}
function groupSummary(rows, keyFn) {
  const groups = new Map();
  for (const row of rows) {
    const key = String(keyFn(row));
    const group = groups.get(key) ?? [];
    group.push(row);
    groups.set(key, group);
  }
  return Object.fromEntries([...groups.entries()].sort(([a], [b]) => a.localeCompare(b, undefined, { numeric: true })).map(([key, group]) => {
    const scratched = group.filter((row) => row.scratched).length;
    return [key, Object.freeze({ total: group.length, scratched, scratchRate: pct(scratched, group.length) })];
  }));
}
async function exists(filePath) {
  try {
    await readFile(filePath);
    return true;
  } catch (error) {
    if (error && typeof error === 'object' && error.code === 'ENOENT') return false;
    throw error;
  }
}
async function fetchJson(url, label) {
  const response = await fetch(url, { headers: { Authorization: bdlKey } });
  const text = await response.text();
  if (!response.ok) throw new Error(`${label} returned HTTP ${response.status}: ${text.slice(0, 500)}`);
  return JSON.parse(text);
}
async function fetchFinalLineups(gameIds) {
  const rows = [];
  let requests = 0;
  for (let offset = 0; offset < gameIds.length; offset += 10) {
    const batch = gameIds.slice(offset, offset + 10);
    let cursor = null;
    const seenCursors = new Set();
    do {
      const url = new URL('https://api.balldontlie.io/mlb/v1/lineups');
      for (const gameId of batch) url.searchParams.append('game_ids[]', String(gameId));
      url.searchParams.set('per_page', '100');
      if (cursor !== null) url.searchParams.set('cursor', String(cursor));
      requests += 1;
      const body = await fetchJson(url, `BALLDONTLIE final lineups batch ${offset / 10 + 1}`);
      if (!Array.isArray(body?.data)) throw new Error('BALLDONTLIE lineups response must contain data array.');
      rows.push(...body.data);
      const nextCursor = body?.meta?.next_cursor ?? null;
      if (nextCursor === null || nextCursor === undefined) {
        cursor = null;
      } else {
        const key = String(nextCursor);
        if (seenCursors.has(key)) throw new Error(`BALLDONTLIE lineups repeated cursor ${key}.`);
        seenCursors.add(key);
        cursor = nextCursor;
      }
    } while (cursor !== null);
  }
  return Object.freeze({ rows: Object.freeze(rows), requests });
}

const displayEntries = (await readdir(DISPLAY_ROOT, { withFileTypes: true }))
  .filter((entry) => entry.isFile() && CAPTURE_PATTERN.test(entry.name))
  .map((entry) => entry.name)
  .sort();
if (displayEntries.length === 0) throw new Error('No committed HHR display captures found.');

const matchedCaptures = [];
const excludedCommittedCaptures = [];
for (const name of displayEntries) {
  const captureKey = CAPTURE_PATTERN.exec(name)?.[1];
  if (!captureKey) continue;
  const display = JSON.parse(await readFile(path.join(DISPLAY_ROOT, name), 'utf8'));
  if (display.captureKey !== captureKey || display.market !== 'batter-hhr') {
    throw new Error(`Committed display capture identity mismatch: ${name}`);
  }
  const gradePath = path.join(LEDGER_ROOT, captureKey, 'grades', GRADE_FILE);
  if (!(await exists(gradePath))) {
    excludedCommittedCaptures.push(Object.freeze({ captureKey, reason: 'NO_IMMUTABLE_GRADE_REPORT_IN_RESTORED_LEDGER' }));
    continue;
  }
  const grade = JSON.parse(await readFile(gradePath, 'utf8'));
  if (grade?.source?.captureKey !== captureKey) throw new Error(`Grade captureKey mismatch: ${captureKey}`);
  if (grade.source.archiveSha256 !== display.fullArchiveSha256) throw new Error(`Grade/display archiveSha256 mismatch: ${captureKey}`);
  if (grade.source.archiveFileSha256 !== display.fullArchiveFileSha256) throw new Error(`Grade/display archiveFileSha256 mismatch: ${captureKey}`);
  if (!Array.isArray(display.rows) || !Array.isArray(grade.rows)) throw new Error(`Rows missing for ${captureKey}`);
  matchedCaptures.push(Object.freeze({ captureKey, display, grade }));
}
if (matchedCaptures.length === 0) throw new Error('No committed display capture has a matching immutable grade report.');

const observations = [];
for (const matched of matchedCaptures) {
  const uniqueGradeRows = new Map();
  for (const row of matched.grade.rows) {
    const key = `${row.providerGameId}:${row.providerPlayerId}`;
    const existing = uniqueGradeRows.get(key);
    if (existing) {
      const same = existing.playerName === row.playerName &&
        existing.lineupStatus === row.lineupStatus &&
        existing.inputLineage?.lineupSlot === row.inputLineage?.lineupSlot &&
        existing.officialHhr === row.officialHhr &&
        existing.settlementReason === row.settlementReason;
      if (!same) throw new Error(`Within-grade player-game drift for ${matched.captureKey} ${key}`);
      continue;
    }
    uniqueGradeRows.set(key, row);
  }
  for (const [playerGameKey, gradeRow] of uniqueGradeRows) {
    const displayMatches = matched.display.rows.filter((row) =>
      row.providerGameId === gradeRow.providerGameId && row.providerPlayerId === gradeRow.providerPlayerId,
    );
    if (displayMatches.length === 0) throw new Error(`Committed display row missing for ${matched.captureKey} ${playerGameKey}`);
    const displayRow = displayMatches[0];
    if (displayMatches.some((row) => row.eventCommenceTime !== displayRow.eventCommenceTime || row.lineupStatus !== displayRow.lineupStatus)) {
      throw new Error(`Committed display player-game metadata drift for ${matched.captureKey} ${playerGameKey}`);
    }
    if (displayRow.lineupStatus !== gradeRow.lineupStatus) throw new Error(`Display/grade lineupStatus mismatch for ${matched.captureKey} ${playerGameKey}`);
    const captureMs = finiteDate(matched.display.capturedAt, `${matched.captureKey}.capturedAt`);
    const firstPitchMs = finiteDate(displayRow.eventCommenceTime, `${matched.captureKey}.${playerGameKey}.eventCommenceTime`);
    const leadMinutes = (firstPitchMs - captureMs) / 60_000;
    if (!(leadMinutes > 0)) throw new Error(`Non-pregame observation ${matched.captureKey} ${playerGameKey}: ${leadMinutes}`);
    const lineupSlot = gradeRow.inputLineage?.lineupSlot;
    if (!Number.isInteger(lineupSlot) || lineupSlot < 1 || lineupSlot > 9) throw new Error(`Invalid lineup slot for ${matched.captureKey} ${playerGameKey}`);
    observations.push({
      captureKey: matched.captureKey,
      capturedAt: matched.display.capturedAt,
      providerGameId: gradeRow.providerGameId,
      providerPlayerId: gradeRow.providerPlayerId,
      playerName: gradeRow.playerName,
      lineupStatus: gradeRow.lineupStatus,
      lineupSlot,
      eventCommenceTime: displayRow.eventCommenceTime,
      captureLeadMinutes: leadMinutes,
      gradeStatsRowPresent: gradeRow.officialComponents !== null,
      officialHhr: gradeRow.officialHhr,
      gradeOutcome: gradeRow.outcome,
      gradeSettlementReason: gradeRow.settlementReason ?? null,
    });
  }
}

const gameIds = [...new Set(observations.map((row) => row.providerGameId))].sort((a, b) => a - b);
const lineupEvidence = await fetchFinalLineups(gameIds);
const startersByGame = new Map();
for (const gameId of gameIds) startersByGame.set(gameId, new Set());
for (const row of lineupEvidence.rows) {
  if (!gameIds.includes(row?.game_id)) continue;
  if (row?.is_probable_pitcher !== false) continue;
  if (!Number.isInteger(row?.batting_order) || row.batting_order < 1 || row.batting_order > 9) continue;
  const playerId = row?.player?.id;
  if (!Number.isInteger(playerId) || playerId <= 0) throw new Error(`Final lineup row has invalid player ID for game ${row?.game_id}`);
  startersByGame.get(row.game_id)?.add(playerId);
}
for (const gameId of gameIds) {
  const starters = startersByGame.get(gameId);
  if (!starters || starters.size !== 18) {
    throw new Error(`Final lineup evidence for game ${gameId} must expose exactly 18 starting hitters; found ${starters?.size ?? 0}.`);
  }
}

for (const row of observations) {
  row.scratched = !startersByGame.get(row.providerGameId).has(row.providerPlayerId);
  row.statsEvidenceClass = !row.scratched
    ? 'NOT_SCRATCHED'
    : row.gradeStatsRowPresent
      ? row.officialHhr === 0
        ? 'STATS_ROW_PRESENT_HHR_ZERO_PA_NOT_PERSISTED'
        : 'STATS_ROW_PRESENT_POSITIVE_HHR_PA_POSITIVE'
      : 'NO_STATS_ROW';
  Object.freeze(row);
}
Object.freeze(observations);

const uniquePlayerGames = new Map();
for (const row of observations) {
  const key = `${row.providerGameId}:${row.providerPlayerId}`;
  const entries = uniquePlayerGames.get(key) ?? [];
  entries.push(row);
  uniquePlayerGames.set(key, entries);
}
const firstCaptureRows = [];
for (const [key, entries] of uniquePlayerGames) {
  entries.sort((a, b) => finiteDate(a.capturedAt, `${key}.capturedAt`) - finiteDate(b.capturedAt, `${key}.capturedAt`) || a.captureKey.localeCompare(b.captureKey));
  const first = entries[0];
  if (entries.some((entry) => entry.scratched !== first.scratched)) throw new Error(`Scratch classification drift across captures for ${key}`);
  firstCaptureRows.push(Object.freeze({ ...first, captureCountForPlayerGame: entries.length, statusesObserved: Object.freeze([...new Set(entries.map((entry) => entry.lineupStatus))].sort()) }));
}
firstCaptureRows.sort((a, b) => a.providerGameId - b.providerGameId || a.providerPlayerId - b.providerPlayerId);

const uniqueScratchRows = firstCaptureRows.filter((row) => row.scratched);
const uniqueNonScratchRows = firstCaptureRows.filter((row) => !row.scratched);
const observationScratchRows = observations.filter((row) => row.scratched);
const observationNonScratchRows = observations.filter((row) => !row.scratched);

const scratchPlayerGamesByPlayer = new Map();
for (const row of uniqueScratchRows) {
  const entry = scratchPlayerGamesByPlayer.get(row.providerPlayerId) ?? { providerPlayerId: row.providerPlayerId, playerName: row.playerName, gameIds: new Set() };
  entry.gameIds.add(row.providerGameId);
  scratchPlayerGamesByPlayer.set(row.providerPlayerId, entry);
}
const repeatedScratchPlayers = [...scratchPlayerGamesByPlayer.values()]
  .map((entry) => ({ providerPlayerId: entry.providerPlayerId, playerName: entry.playerName, scratchedDistinctGames: entry.gameIds.size, gameIds: [...entry.gameIds].sort((a, b) => a - b) }))
  .filter((entry) => entry.scratchedDistinctGames > 1)
  .sort((a, b) => b.scratchedDistinctGames - a.scratchedDistinctGames || a.playerName.localeCompare(b.playerName));

const uniqueStatsClass = groupSummary(uniqueScratchRows, (row) => row.statsEvidenceClass);
const observationStatsClass = groupSummary(observationScratchRows, (row) => row.statsEvidenceClass);

const report = Object.freeze({
  diagnosticVersion: 1,
  diagnosticType: 'm11-hhr-committed-graded-scratch-rate',
  evidenceBoundary: Object.freeze({
    repository: 'Derkmane/mlb-prop-analyzer-v3',
    committedDisplayCaptureCount: displayEntries.length,
    matchingCommittedGradedCaptureCount: matchedCaptures.length,
    matchingCaptureKeys: Object.freeze(matchedCaptures.map((entry) => entry.captureKey)),
    excludedCommittedCaptures: Object.freeze(excludedCommittedCaptures),
    reservedCapturesRead: false,
    fittingPerformed: false,
    modelChanged: false,
    canonicalChanged: false,
    ballDontLieEndpointsRead: Object.freeze(['/mlb/v1/lineups']),
    ballDontLieLineupRequests: lineupEvidence.requests,
    distinctFinalGames: gameIds.length,
  }),
  denominators: Object.freeze({
    distinctPlayerGames: firstCaptureRows.length,
    capturePlayerGameObservations: observations.length,
  }),
  uniquePlayerGames: Object.freeze({
    classificationStatusRule: 'first matching committed graded pregame capture for mutually exclusive lineupStatus/slot reporting',
    scratched: uniqueScratchRows.length,
    scratchRate: pct(uniqueScratchRows.length, firstCaptureRows.length),
    byFirstCaptureLineupStatus: Object.freeze(groupSummary(firstCaptureRows, (row) => row.lineupStatus)),
    byFirstCaptureLineupSlot: Object.freeze(groupSummary(firstCaptureRows, (row) => row.lineupSlot)),
    scratchedStatsEvidence: Object.freeze(uniqueStatsClass),
    captureLeadMinutes: Object.freeze({
      scratchedMean: mean(uniqueScratchRows.map((row) => row.captureLeadMinutes)),
      scratchedMedian: median(uniqueScratchRows.map((row) => row.captureLeadMinutes)),
      nonScratchedMean: mean(uniqueNonScratchRows.map((row) => row.captureLeadMinutes)),
      nonScratchedMedian: median(uniqueNonScratchRows.map((row) => row.captureLeadMinutes)),
    }),
  }),
  captureObservations: Object.freeze({
    scratched: observationScratchRows.length,
    scratchRate: pct(observationScratchRows.length, observations.length),
    byLineupStatus: Object.freeze(groupSummary(observations, (row) => row.lineupStatus)),
    byLineupSlot: Object.freeze(groupSummary(observations, (row) => row.lineupSlot)),
    scratchedStatsEvidence: Object.freeze(observationStatsClass),
    captureLeadMinutes: Object.freeze({
      scratchedMean: mean(observationScratchRows.map((row) => row.captureLeadMinutes)),
      scratchedMedian: median(observationScratchRows.map((row) => row.captureLeadMinutes)),
      nonScratchedMean: mean(observationNonScratchRows.map((row) => row.captureLeadMinutes)),
      nonScratchedMedian: median(observationNonScratchRows.map((row) => row.captureLeadMinutes)),
    }),
  }),
  repeatScratch: Object.freeze({
    uniqueScratchedPlayers: scratchPlayerGamesByPlayer.size,
    playersScratchedInMoreThanOneDistinctGame: repeatedScratchPlayers.length,
    repeatedPlayers: Object.freeze(repeatedScratchPlayers),
  }),
  scratchedDistinctPlayerGames: Object.freeze(uniqueScratchRows.map((row) => Object.freeze({
    providerGameId: row.providerGameId,
    providerPlayerId: row.providerPlayerId,
    playerName: row.playerName,
    firstCaptureKey: row.captureKey,
    firstCaptureLineupStatus: row.lineupStatus,
    firstCaptureLineupSlot: row.lineupSlot,
    firstCaptureLeadMinutes: row.captureLeadMinutes,
    captureCountForPlayerGame: row.captureCountForPlayerGame,
    statusesObserved: row.statusesObserved,
    statsEvidenceClass: row.statsEvidenceClass,
    officialHhr: row.officialHhr,
    gradeOutcome: row.gradeOutcome,
    gradeSettlementReason: row.gradeSettlementReason,
  }))),
  limitation: 'Grade reports preserve whether a qualifying official HHR stats row existed, but do not preserve plate_appearances. Under the authorized source boundary of committed displays + grade reports + BALLDONTLIE lineups only, a scratched row with officialHhr=0 and a stats row cannot be distinguished as PA=0 versus a positive-PA 0-HHR substitute without an additional BALLDONTLIE stats read.',
});

await mkdir(OUTPUT_ROOT, { recursive: true });
const outputPath = path.join(OUTPUT_ROOT, 'report.json');
await writeFile(outputPath, `${JSON.stringify(report, null, 2)}\n`);

console.log('--- M11 HHR SCRATCH RATE DIAGNOSTIC ---');
console.log(`COMMITTED DISPLAY CAPTURES\t${report.evidenceBoundary.committedDisplayCaptureCount}`);
console.log(`MATCHING COMMITTED+GRADED CAPTURES\t${report.evidenceBoundary.matchingCommittedGradedCaptureCount}`);
for (const key of report.evidenceBoundary.matchingCaptureKeys) console.log(`INCLUDED CAPTURE\t${key}`);
for (const row of report.evidenceBoundary.excludedCommittedCaptures) console.log(`EXCLUDED COMMITTED CAPTURE\t${row.captureKey}\t${row.reason}`);
console.log(`DISTINCT FINAL GAMES\t${report.evidenceBoundary.distinctFinalGames}`);
console.log(`DISTINCT PLAYER-GAMES\t${report.denominators.distinctPlayerGames}`);
console.log(`CAPTURE-PLAYER-GAME OBSERVATIONS\t${report.denominators.capturePlayerGameObservations}`);
console.log(`UNIQUE SCRATCHED PLAYER-GAMES\t${report.uniquePlayerGames.scratched}`);
console.log(`UNIQUE SCRATCH RATE\t${report.uniquePlayerGames.scratchRate}`);
console.log(`UNIQUE BY FIRST STATUS\t${JSON.stringify(report.uniquePlayerGames.byFirstCaptureLineupStatus)}`);
console.log(`UNIQUE BY FIRST SLOT\t${JSON.stringify(report.uniquePlayerGames.byFirstCaptureLineupSlot)}`);
console.log(`UNIQUE SCRATCH STATS EVIDENCE\t${JSON.stringify(report.uniquePlayerGames.scratchedStatsEvidence)}`);
console.log(`UNIQUE LEAD MINUTES\t${JSON.stringify(report.uniquePlayerGames.captureLeadMinutes)}`);
console.log(`OBSERVATION SCRATCHED\t${report.captureObservations.scratched}`);
console.log(`OBSERVATION SCRATCH RATE\t${report.captureObservations.scratchRate}`);
console.log(`OBSERVATION BY STATUS\t${JSON.stringify(report.captureObservations.byLineupStatus)}`);
console.log(`OBSERVATION BY SLOT\t${JSON.stringify(report.captureObservations.byLineupSlot)}`);
console.log(`OBSERVATION SCRATCH STATS EVIDENCE\t${JSON.stringify(report.captureObservations.scratchedStatsEvidence)}`);
console.log(`OBSERVATION LEAD MINUTES\t${JSON.stringify(report.captureObservations.captureLeadMinutes)}`);
console.log(`REPEAT SCRATCH PLAYERS\t${JSON.stringify(report.repeatScratch)}`);
for (const row of report.scratchedDistinctPlayerGames) console.log(`SCRATCHED PLAYER-GAME\t${JSON.stringify(row)}`);
console.log(`BDL LINEUP REQUESTS\t${report.evidenceBoundary.ballDontLieLineupRequests}`);
console.log('BALLDONTLIE ENDPOINTS\t/mlb/v1/lineups');
console.log('RESERVED CAPTURES READ\tfalse');
console.log('FITTING PERFORMED\tfalse');
console.log('MODEL CHANGED\tfalse');
console.log('CANONICAL CHANGED\tfalse');
console.log(`OUTPUT\t${outputPath}`);
console.log('--- END M11 HHR SCRATCH RATE DIAGNOSTIC ---');
