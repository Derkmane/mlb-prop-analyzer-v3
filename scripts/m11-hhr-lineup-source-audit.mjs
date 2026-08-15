import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import path from 'node:path';

const bdlKey = process.env.BALLDONTLIE_API_KEY?.trim();
if (!bdlKey) throw new Error('Missing BALLDONTLIE_API_KEY.');

const HHR_DISPLAY_ROOT = path.resolve('artifacts/display-archives/batter-hhr/captures');
const HHR_LEDGER_ROOT = path.resolve(process.env.M10_HHR_ARCHIVE_ROOT?.trim() || 'artifacts/board-archives/batter-hhr');
const HITS_LEDGER_ROOT = path.resolve(process.env.M10_ARCHIVE_ROOT?.trim() || 'artifacts/board-archives/batter-hits');
const OUTPUT_ROOT = path.resolve('artifacts/diagnostics/m11-hhr-lineup-source-audit');
const CAPTURE_PATTERN = /^(\d{8}T\d{9}Z--[a-f0-9]{64})\.json$/u;
const GRADE_FILE = 'm10-hhr-final-grade-v1.json';
const D1_MERGED_AT = '2026-08-14T14:36:07.000Z';

function finiteDate(value, label) {
  const ms = Date.parse(value);
  if (!Number.isFinite(ms)) throw new Error(`${label} must be an ISO timestamp.`);
  return ms;
}
function pct(n, d) {
  return d === 0 ? null : n / d;
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
async function readJson(filePath) {
  return JSON.parse(await readFile(filePath, 'utf8'));
}
async function fetchText(url, label) {
  const response = await fetch(url, { headers: { Authorization: bdlKey } });
  const text = await response.text();
  if (!response.ok) throw new Error(`${label} returned HTTP ${response.status}: ${text.slice(0, 500)}`);
  let body;
  try {
    body = JSON.parse(text);
  } catch {
    throw new Error(`${label} returned malformed JSON.`);
  }
  return Object.freeze({ body, text, capturedAt: new Date().toISOString() });
}
function lineupUrl(gameIds) {
  const url = new URL('https://api.balldontlie.io/mlb/v1/lineups');
  for (const gameId of gameIds) url.searchParams.append('game_ids[]', String(gameId));
  url.searchParams.set('per_page', '100');
  return url;
}
async function fetchLineups(gameIds, label) {
  const rows = [];
  const rawPages = [];
  let cursor = null;
  const seen = new Set();
  do {
    const url = lineupUrl(gameIds);
    if (cursor !== null) url.searchParams.set('cursor', String(cursor));
    const page = await fetchText(url, `${label}${cursor === null ? '' : ` cursor ${cursor}`}`);
    if (!Array.isArray(page.body?.data)) throw new Error(`${label} must return data array.`);
    rows.push(...page.body.data);
    rawPages.push(page);
    const next = page.body?.meta?.next_cursor ?? null;
    if (next === null || next === undefined) {
      cursor = null;
    } else {
      const key = String(next);
      if (seen.has(key)) throw new Error(`${label} repeated cursor ${key}.`);
      seen.add(key);
      cursor = next;
    }
  } while (cursor !== null);
  return Object.freeze({ rows: Object.freeze(rows), pages: Object.freeze(rawPages) });
}
function recursiveFieldPaths(value, prefix = '', out = new Set()) {
  if (Array.isArray(value)) {
    const pathValue = `${prefix}[]`;
    out.add(pathValue);
    for (const entry of value) recursiveFieldPaths(entry, pathValue, out);
    return out;
  }
  if (value !== null && typeof value === 'object') {
    for (const [key, entry] of Object.entries(value)) {
      const child = prefix ? `${prefix}.${key}` : key;
      out.add(child);
      recursiveFieldPaths(entry, child, out);
    }
  }
  return out;
}
function lineupShape(rows, gameId) {
  const gameRows = rows.filter((row) => row?.game_id === gameId);
  const hitters = gameRows.filter((row) => row?.is_probable_pitcher === false && Number.isInteger(row?.batting_order) && row.batting_order >= 1 && row.batting_order <= 9);
  const probablePitchers = gameRows.filter((row) => row?.is_probable_pitcher === true);
  const byTeam = new Map();
  for (const row of hitters) {
    const teamId = row?.team?.id;
    if (!Number.isInteger(teamId) || teamId <= 0) continue;
    const group = byTeam.get(teamId) ?? [];
    group.push(row);
    byTeam.set(teamId, group);
  }
  const teams = [...byTeam.entries()].map(([teamId, group]) => {
    const slots = [...new Set(group.map((row) => row.batting_order))].sort((a, b) => a - b);
    const players = [...new Set(group.map((row) => row?.player?.id).filter((value) => Number.isInteger(value) && value > 0))];
    const completeNine = group.length === 9 && slots.length === 9 && slots.every((slot, index) => slot === index + 1) && players.length === 9;
    return Object.freeze({
      teamId,
      teamName: group[0]?.team?.display_name ?? null,
      hitterRowCount: group.length,
      slots: Object.freeze(slots),
      uniquePlayerCount: players.length,
      completeNine,
    });
  }).sort((a, b) => a.teamId - b.teamId);
  const completeTeamCount = teams.filter((team) => team.completeNine).length;
  return Object.freeze({
    gameId,
    totalRows: gameRows.length,
    probablePitcherRows: probablePitchers.length,
    hitterRowsWithSlots: hitters.length,
    teams: Object.freeze(teams),
    completeTeamCount,
    responseClass: gameRows.length === 0 ? 'EMPTY' : completeTeamCount === 2 ? 'COMPLETE_BOTH_TEAMS' : 'PARTIAL',
  });
}
function statusSummary(rows) {
  const groups = { confirmed: { total: 0, scratched: 0 }, projected: { total: 0, scratched: 0 } };
  for (const row of rows) {
    if (!(row.lineupStatus in groups)) continue;
    groups[row.lineupStatus].total += 1;
    if (row.scratched) groups[row.lineupStatus].scratched += 1;
  }
  return Object.freeze(Object.fromEntries(Object.entries(groups).map(([key, value]) => [key, Object.freeze({ ...value, scratchRate: pct(value.scratched, value.total) })])));
}

const displayNames = (await readdir(HHR_DISPLAY_ROOT, { withFileTypes: true }))
  .filter((entry) => entry.isFile() && CAPTURE_PATTERN.test(entry.name))
  .map((entry) => entry.name)
  .sort();
if (displayNames.length === 0) throw new Error('No committed HHR display captures found.');

const committed = [];
for (const name of displayNames) {
  const captureKey = CAPTURE_PATTERN.exec(name)?.[1];
  if (!captureKey) continue;
  const display = await readJson(path.join(HHR_DISPLAY_ROOT, name));
  if (display.captureKey !== captureKey || display.market !== 'batter-hhr') throw new Error(`Display identity mismatch ${name}.`);
  const fullPath = path.join(HHR_LEDGER_ROOT, 'captures', `${captureKey}.json`);
  committed.push(Object.freeze({ captureKey, display, fullPath, fullAvailable: await exists(fullPath) }));
}

const gradeReports = [];
const hhrEntries = await readdir(HHR_LEDGER_ROOT, { withFileTypes: true });
for (const entry of hhrEntries) {
  if (!entry.isDirectory() || !CAPTURE_PATTERN.test(`${entry.name}.json`)) continue;
  const gradePath = path.join(HHR_LEDGER_ROOT, entry.name, 'grades', GRADE_FILE);
  if (!(await exists(gradePath))) continue;
  const grade = await readJson(gradePath);
  if (grade?.source?.captureKey !== entry.name || !Array.isArray(grade.rows)) throw new Error(`Malformed grade report ${entry.name}.`);
  gradeReports.push(grade);
}
gradeReports.sort((a, b) => a.source.captureKey.localeCompare(b.source.captureKey));
if (gradeReports.length === 0) throw new Error('No immutable HHR grade reports restored.');

const schemaGameId = gradeReports.flatMap((grade) => grade.rows).map((row) => row.providerGameId).find((value) => Number.isInteger(value) && value > 0);
if (!schemaGameId) throw new Error('No final graded game identity available for schema probe.');
const schemaProbe = await fetchLineups([schemaGameId], `BDL schema lineups game ${schemaGameId}`);
if (schemaProbe.pages.length !== 1 || schemaProbe.rows.length === 0) throw new Error(`Schema probe game ${schemaGameId} must return one nonempty page.`);
const schemaRaw = schemaProbe.pages[0];
const schemaFieldPaths = [...recursiveFieldPaths(schemaRaw.body)].sort();
const suspectFieldPaths = schemaFieldPaths.filter((field) => /(project|confirm|status|confidence|posted|updated|created|timestamp)/iu.test(field));

const now = Date.now();
const utcToday = new Date(now).toISOString().slice(0, 10);
const utcTomorrow = new Date(now + 86_400_000).toISOString().slice(0, 10);
const games = [];
for (const date of [utcToday, utcTomorrow]) {
  const url = new URL('https://api.balldontlie.io/mlb/v1/games');
  url.searchParams.append('dates[]', date);
  url.searchParams.set('season_type', 'regular');
  url.searchParams.set('per_page', '100');
  const page = await fetchText(url, `BDL games ${date}`);
  if (!Array.isArray(page.body?.data)) throw new Error(`BDL games ${date} must return data array.`);
  games.push(...page.body.data);
}
const futureCandidates = games
  .map((game) => ({ game, leadMinutes: (Date.parse(game?.date) - now) / 60_000 }))
  .filter((entry) => Number.isFinite(entry.leadMinutes) && entry.leadMinutes >= 180 && entry.game?.status !== 'STATUS_FINAL')
  .sort((a, b) => a.leadMinutes - b.leadMinutes || a.game.id - b.game.id);
if (futureCandidates.length === 0) throw new Error('No game at least 180 minutes before first pitch was available for live probe.');
const future = futureCandidates[0];
const futureProbe = await fetchLineups([future.game.id], `BDL pre-official lineups game ${future.game.id}`);
if (futureProbe.pages.length !== 1) throw new Error('Future lineup probe unexpectedly paginated.');
const futureShape = lineupShape(futureProbe.rows, future.game.id);

const archivedCompleteTeams = [];
const archivedCompleteGames = [];
const archiveEvidenceExclusions = [];
for (const entry of committed) {
  if (!entry.fullAvailable) {
    archiveEvidenceExclusions.push(Object.freeze({ captureKey: entry.captureKey, reason: 'FULL_HHR_ARCHIVE_NOT_IN_RESTORED_LEDGER' }));
    continue;
  }
  const hhr = await readJson(entry.fullPath);
  if (hhr.captureKey !== entry.captureKey) throw new Error(`Full HHR identity mismatch ${entry.captureKey}.`);
  const sourceHitsCaptureKey = hhr?.source?.sourceHitsCaptureKey;
  if (typeof sourceHitsCaptureKey !== 'string' || sourceHitsCaptureKey.length === 0) {
    archiveEvidenceExclusions.push(Object.freeze({ captureKey: entry.captureKey, reason: 'SOURCE_HITS_CAPTURE_KEY_MISSING' }));
    continue;
  }
  const hitsPath = path.join(HITS_LEDGER_ROOT, 'captures', `${sourceHitsCaptureKey}.json`);
  if (!(await exists(hitsPath))) {
    archiveEvidenceExclusions.push(Object.freeze({ captureKey: entry.captureKey, sourceHitsCaptureKey, reason: 'FULL_HITS_ARCHIVE_NOT_IN_RESTORED_LEDGER' }));
    continue;
  }
  const hits = await readJson(hitsPath);
  if (hits?.captureIdentity?.captureKey !== sourceHitsCaptureKey || !Array.isArray(hits.providerSnapshots)) {
    throw new Error(`Full Hits archive malformed ${sourceHitsCaptureKey}.`);
  }
  const targetGameIds = new Set((Array.isArray(hhr.games) ? hhr.games : []).map((game) => game?.gameId).filter((value) => Number.isInteger(value) && value > 0));
  const commenceByGame = new Map();
  for (const offer of Array.isArray(hits.normalizedOffers) ? hits.normalizedOffers : []) {
    if (!targetGameIds.has(offer?.providerGameId) || !Number.isFinite(Date.parse(offer?.eventCommenceTime))) continue;
    const existing = commenceByGame.get(offer.providerGameId);
    if (existing !== undefined && existing !== offer.eventCommenceTime) throw new Error(`Commence time drift for game ${offer.providerGameId}.`);
    commenceByGame.set(offer.providerGameId, offer.eventCommenceTime);
  }
  for (const snapshot of hits.providerSnapshots) {
    if (snapshot?.request?.pathname !== '/mlb/v1/lineups' || !Array.isArray(snapshot?.parsedBody?.data)) continue;
    const snapshotAt = snapshot.capturedAt;
    const snapshotMs = Date.parse(snapshotAt);
    if (!Number.isFinite(snapshotMs)) continue;
    const gameIdsInSnapshot = [...new Set(snapshot.parsedBody.data.map((row) => row?.game_id).filter((gameId) => targetGameIds.has(gameId)))];
    for (const gameId of gameIdsInSnapshot) {
      const commence = commenceByGame.get(gameId);
      if (!commence) continue;
      const leadMinutes = (Date.parse(commence) - snapshotMs) / 60_000;
      if (!(leadMinutes > 0)) continue;
      const shape = lineupShape(snapshot.parsedBody.data, gameId);
      for (const team of shape.teams.filter((team) => team.completeNine)) {
        archivedCompleteTeams.push(Object.freeze({ captureKey: entry.captureKey, sourceHitsCaptureKey, providerGameId: gameId, providerTeamId: team.teamId, teamName: team.teamName, lineupSnapshotCapturedAt: snapshotAt, firstPitch: commence, leadMinutes }));
      }
      if (shape.completeTeamCount === 2) {
        archivedCompleteGames.push(Object.freeze({ captureKey: entry.captureKey, sourceHitsCaptureKey, providerGameId: gameId, lineupSnapshotCapturedAt: snapshotAt, firstPitch: commence, leadMinutes }));
      }
    }
  }
}
archivedCompleteTeams.sort((a, b) => b.leadMinutes - a.leadMinutes || a.providerGameId - b.providerGameId || a.providerTeamId - b.providerTeamId);
archivedCompleteGames.sort((a, b) => b.leadMinutes - a.leadMinutes || a.providerGameId - b.providerGameId);

const displayByCapture = new Map(committed.map((entry) => [entry.captureKey, entry.display]));
const postD1Observations = [];
for (const grade of gradeReports) {
  const display = displayByCapture.get(grade.source.captureKey);
  if (!display || finiteDate(display.capturedAt, `${grade.source.captureKey}.capturedAt`) < finiteDate(D1_MERGED_AT, 'D1_MERGED_AT')) continue;
  if (grade.source.archiveSha256 !== display.fullArchiveSha256 || grade.source.archiveFileSha256 !== display.fullArchiveFileSha256) throw new Error(`Post-D1 display/grade lineage mismatch ${grade.source.captureKey}.`);
  const unique = new Map();
  for (const row of grade.rows) {
    const key = `${row.providerGameId}:${row.providerPlayerId}`;
    const prior = unique.get(key);
    if (prior && (prior.lineupStatus !== row.lineupStatus || prior.playerName !== row.playerName)) throw new Error(`Post-D1 within-grade drift ${grade.source.captureKey} ${key}.`);
    if (!prior) unique.set(key, row);
  }
  for (const row of unique.values()) postD1Observations.push({ captureKey: grade.source.captureKey, capturedAt: display.capturedAt, providerGameId: row.providerGameId, providerPlayerId: row.providerPlayerId, playerName: row.playerName, lineupStatus: row.lineupStatus });
}
const postD1GameIds = [...new Set(postD1Observations.map((row) => row.providerGameId))].sort((a, b) => a - b);
let postD1FinalLineups = { rows: [], pages: [] };
if (postD1GameIds.length > 0) {
  const allRows = [];
  const allPages = [];
  for (let offset = 0; offset < postD1GameIds.length; offset += 10) {
    const fetched = await fetchLineups(postD1GameIds.slice(offset, offset + 10), `BDL post-D1 final lineups batch ${offset / 10 + 1}`);
    allRows.push(...fetched.rows);
    allPages.push(...fetched.pages);
  }
  postD1FinalLineups = { rows: allRows, pages: allPages };
}
const startersByGame = new Map();
for (const gameId of postD1GameIds) startersByGame.set(gameId, new Set());
for (const row of postD1FinalLineups.rows) {
  if (!startersByGame.has(row?.game_id) || row?.is_probable_pitcher !== false || !Number.isInteger(row?.batting_order) || row.batting_order < 1 || row.batting_order > 9) continue;
  if (!Number.isInteger(row?.player?.id) || row.player.id <= 0) throw new Error(`Post-D1 final lineup player identity malformed game ${row?.game_id}.`);
  startersByGame.get(row.game_id).add(row.player.id);
}
for (const gameId of postD1GameIds) {
  if (startersByGame.get(gameId)?.size !== 18) throw new Error(`Post-D1 final game ${gameId} must expose exactly 18 starters; found ${startersByGame.get(gameId)?.size ?? 0}.`);
}
for (const row of postD1Observations) row.scratched = !startersByGame.get(row.providerGameId)?.has(row.providerPlayerId);
const postD1Distinct = new Map();
for (const row of postD1Observations) {
  const key = `${row.providerGameId}:${row.providerPlayerId}`;
  const rows = postD1Distinct.get(key) ?? [];
  rows.push(row);
  postD1Distinct.set(key, rows);
}
const postD1FirstRows = [];
for (const [key, rows] of postD1Distinct) {
  rows.sort((a, b) => finiteDate(a.capturedAt, `${key}.capturedAt`) - finiteDate(b.capturedAt, `${key}.capturedAt`) || a.captureKey.localeCompare(b.captureKey));
  if (rows.some((row) => row.scratched !== rows[0].scratched)) throw new Error(`Post-D1 scratch drift ${key}.`);
  postD1FirstRows.push(rows[0]);
}

const report = Object.freeze({
  diagnosticVersion: 1,
  diagnosticType: 'm11-hhr-approved-lineup-source-audit',
  evidenceBoundary: Object.freeze({ repository: 'Derkmane/mlb-prop-analyzer-v3', mainAtBranchBase: '243017ff6526657c084dea1c0157c38d38539c56', committedHhrDisplayCaptures: displayNames.length, committedCapturesWithFullHhrArchive: committed.filter((entry) => entry.fullAvailable).length, archivedEvidenceExclusions: Object.freeze(archiveEvidenceExclusions), reservedCapturesRead: false, fittingPerformed: false, modelChanged: false, canonicalChanged: false, thirdPartyProviderRead: false, ballDontLieEndpointsRead: Object.freeze(['/mlb/v1/games', '/mlb/v1/lineups']) }),
  liveSchemaProbe: Object.freeze({ providerGameId: schemaGameId, capturedAt: schemaRaw.capturedAt, fieldPaths: Object.freeze(schemaFieldPaths), suspectFieldPaths: Object.freeze(suspectFieldPaths), rawResponseLiteral: schemaRaw.text, parsedResponse: schemaRaw.body }),
  liveSeveralHoursOutProbe: Object.freeze({ providerGameId: future.game.id, gameDate: future.game.date, gameStatus: future.game.status ?? null, homeTeamName: future.game.home_team_name ?? future.game.home_team?.display_name ?? null, awayTeamName: future.game.away_team_name ?? future.game.away_team?.display_name ?? null, probeCapturedAt: futureProbe.pages[0].capturedAt, leadMinutesAtProbe: (Date.parse(future.game.date) - finiteDate(futureProbe.pages[0].capturedAt, 'futureProbe.capturedAt')) / 60_000, shape: futureShape, rawResponseLiteral: futureProbe.pages[0].text, parsedResponse: futureProbe.pages[0].body }),
  committedCaptureLineupTiming: Object.freeze({ evidenceCaptureCount: committed.filter((entry) => entry.fullAvailable).length - archiveEvidenceExclusions.length, completeTeamObservations: archivedCompleteTeams.length, completeBothTeamGameObservations: archivedCompleteGames.length, earliestObservedCompleteTeam: archivedCompleteTeams[0] ?? null, earliestObservedCompleteBothTeamsGame: archivedCompleteGames[0] ?? null }),
  postD1Scratch: Object.freeze({ d1MergedAt: D1_MERGED_AT, matchingCommittedGradedCaptureCount: new Set(postD1Observations.map((row) => row.captureKey)).size, distinctPlayerGames: postD1FirstRows.length, capturePlayerGameObservations: postD1Observations.length, byFirstPostD1CaptureLineupStatus: statusSummary(postD1FirstRows), byCaptureObservationLineupStatus: statusSummary(postD1Observations) }),
});
await mkdir(OUTPUT_ROOT, { recursive: true });
const outputPath = path.join(OUTPUT_ROOT, 'report.json');
await writeFile(outputPath, `${JSON.stringify(report, null, 2)}\n`);

console.log('--- M11 HHR APPROVED LINEUP SOURCE AUDIT ---');
console.log(`COMMITTED HHR DISPLAY CAPTURES\t${report.evidenceBoundary.committedHhrDisplayCaptures}`);
console.log(`SCHEMA GAME ID\t${schemaGameId}`);
console.log(`SCHEMA FIELD PATHS\t${JSON.stringify(schemaFieldPaths)}`);
console.log(`SCHEMA SUSPECT FIELD PATHS\t${JSON.stringify(suspectFieldPaths)}`);
console.log(`SCHEMA RAW RESPONSE LITERAL\t${schemaRaw.text}`);
console.log(`FUTURE PROBE GAME\t${future.game.id}\t${future.game.date}\tstatus=${future.game.status ?? 'null'}`);
console.log(`FUTURE PROBE LEAD MINUTES\t${report.liveSeveralHoursOutProbe.leadMinutesAtProbe}`);
console.log(`FUTURE PROBE SHAPE\t${JSON.stringify(futureShape)}`);
console.log(`FUTURE PROBE RAW RESPONSE LITERAL\t${futureProbe.pages[0].text}`);
console.log(`ARCHIVED COMPLETE TEAM OBSERVATIONS\t${archivedCompleteTeams.length}`);
console.log(`EARLIEST OBSERVED COMPLETE TEAM\t${JSON.stringify(archivedCompleteTeams[0] ?? null)}`);
console.log(`EARLIEST OBSERVED COMPLETE BOTH-TEAM GAME\t${JSON.stringify(archivedCompleteGames[0] ?? null)}`);
console.log(`POST-D1 MATCHING COMMITTED+GRADED CAPTURES\t${report.postD1Scratch.matchingCommittedGradedCaptureCount}`);
console.log(`POST-D1 DISTINCT PLAYER-GAMES\t${report.postD1Scratch.distinctPlayerGames}`);
console.log(`POST-D1 BY FIRST STATUS\t${JSON.stringify(report.postD1Scratch.byFirstPostD1CaptureLineupStatus)}`);
console.log(`POST-D1 OBSERVATIONS\t${report.postD1Scratch.capturePlayerGameObservations}`);
console.log(`POST-D1 BY OBSERVATION STATUS\t${JSON.stringify(report.postD1Scratch.byCaptureObservationLineupStatus)}`);
console.log('RESERVED CAPTURES READ\tfalse');
console.log('FITTING PERFORMED\tfalse');
console.log('MODEL CHANGED\tfalse');
console.log('CANONICAL CHANGED\tfalse');
console.log(`OUTPUT\t${outputPath}`);
console.log('--- END M11 HHR APPROVED LINEUP SOURCE AUDIT ---');
