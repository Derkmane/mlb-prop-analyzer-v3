import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import path from 'node:path';

const key = process.env.BALLDONTLIE_API_KEY?.trim();
if (!key) throw new Error('Missing BALLDONTLIE_API_KEY.');
const HHR_DISPLAY_ROOT = path.resolve('artifacts/display-archives/batter-hhr/captures');
const HHR_ROOT = path.resolve(process.env.M10_HHR_ARCHIVE_ROOT?.trim() || 'artifacts/board-archives/batter-hhr');
const HITS_ROOT = path.resolve(process.env.M10_ARCHIVE_ROOT?.trim() || 'artifacts/board-archives/batter-hits');
const OUTPUT_ROOT = path.resolve('artifacts/diagnostics/m11-hhr-lineup-source-audit');
const GRADE_FILE = 'm10-hhr-final-grade-v1.json';
const D1_MERGED_AT = Date.parse('2026-08-14T14:36:07.000Z');
const CAPTURE = /^(\d{8}T\d{9}Z--[a-f0-9]{64})\.json$/u;

const readJson = async (p) => JSON.parse(await readFile(p, 'utf8'));
async function exists(p) { try { await readFile(p); return true; } catch (e) { if (e?.code === 'ENOENT') return false; throw e; } }
function completeTeams(rows, gameId) {
  const byTeam = new Map();
  for (const row of rows) {
    if (row?.game_id !== gameId || row?.is_probable_pitcher !== false || !Number.isInteger(row?.batting_order) || row.batting_order < 1 || row.batting_order > 9) continue;
    const teamId = row?.team?.id;
    const playerId = row?.player?.id;
    if (!Number.isInteger(teamId) || !Number.isInteger(playerId)) continue;
    const group = byTeam.get(teamId) ?? [];
    group.push(row);
    byTeam.set(teamId, group);
  }
  return [...byTeam.entries()].filter(([, group]) => {
    const slots = new Set(group.map((row) => row.batting_order));
    const players = new Set(group.map((row) => row.player.id));
    return group.length === 9 && slots.size === 9 && players.size === 9 && [...slots].every((slot) => slot >= 1 && slot <= 9);
  }).map(([teamId]) => teamId);
}
async function fetchFinalLineups(gameIds) {
  const all = [];
  for (let offset = 0; offset < gameIds.length; offset += 10) {
    const ids = gameIds.slice(offset, offset + 10);
    let cursor = null;
    const seen = new Set();
    do {
      const url = new URL('https://api.balldontlie.io/mlb/v1/lineups');
      for (const id of ids) url.searchParams.append('game_ids[]', String(id));
      url.searchParams.set('per_page', '100');
      if (cursor !== null) url.searchParams.set('cursor', String(cursor));
      const response = await fetch(url, { headers: { Authorization: key } });
      const text = await response.text();
      if (!response.ok) throw new Error(`BDL final lineups HTTP ${response.status}: ${text.slice(0, 500)}`);
      const body = JSON.parse(text);
      if (!Array.isArray(body?.data)) throw new Error('BDL final lineups missing data array.');
      all.push(...body.data);
      const next = body?.meta?.next_cursor ?? null;
      if (next === null || next === undefined) cursor = null;
      else { const k = String(next); if (seen.has(k)) throw new Error(`Repeated cursor ${k}.`); seen.add(k); cursor = next; }
    } while (cursor !== null);
  }
  return all;
}

const displays = new Map();
for (const entry of (await readdir(HHR_DISPLAY_ROOT, { withFileTypes: true })).filter((e) => e.isFile() && CAPTURE.test(e.name))) {
  const display = await readJson(path.join(HHR_DISPLAY_ROOT, entry.name));
  displays.set(display.captureKey, display);
}

const completeAtCapture = new Set();
const completeEvidence = [];
for (const [captureKey, display] of displays) {
  if (Date.parse(display.capturedAt) < D1_MERGED_AT) continue;
  const hhrPath = path.join(HHR_ROOT, 'captures', `${captureKey}.json`);
  if (!(await exists(hhrPath))) continue;
  const hhr = await readJson(hhrPath);
  const sourceHitsCaptureKey = hhr?.source?.sourceHitsCaptureKey;
  if (typeof sourceHitsCaptureKey !== 'string') continue;
  const hitsPath = path.join(HITS_ROOT, 'captures', `${sourceHitsCaptureKey}.json`);
  if (!(await exists(hitsPath))) continue;
  const hits = await readJson(hitsPath);
  const targetGameIds = new Set((hhr.games ?? []).map((game) => game?.gameId).filter(Number.isInteger));
  for (const snapshot of hits.providerSnapshots ?? []) {
    if (snapshot?.request?.pathname !== '/mlb/v1/lineups' || !Array.isArray(snapshot?.parsedBody?.data)) continue;
    for (const gameId of targetGameIds) {
      for (const teamId of completeTeams(snapshot.parsedBody.data, gameId)) {
        const id = `${captureKey}:${gameId}:${teamId}`;
        if (completeAtCapture.has(id)) continue;
        completeAtCapture.add(id);
        completeEvidence.push({ captureKey, providerGameId: gameId, providerTeamId: teamId, snapshotCapturedAt: snapshot.capturedAt });
      }
    }
  }
}

const observations = [];
const hhrDirs = await readdir(HHR_ROOT, { withFileTypes: true });
for (const dir of hhrDirs) {
  if (!dir.isDirectory()) continue;
  const display = displays.get(dir.name);
  if (!display || Date.parse(display.capturedAt) < D1_MERGED_AT) continue;
  const gradePath = path.join(HHR_ROOT, dir.name, 'grades', GRADE_FILE);
  if (!(await exists(gradePath))) continue;
  const grade = await readJson(gradePath);
  if (grade?.source?.archiveSha256 !== display.fullArchiveSha256 || grade?.source?.archiveFileSha256 !== display.fullArchiveFileSha256) throw new Error(`Lineage mismatch ${dir.name}.`);
  const unique = new Map();
  for (const row of grade.rows ?? []) {
    const k = `${row.providerGameId}:${row.providerPlayerId}`;
    if (!unique.has(k)) unique.set(k, row);
  }
  for (const row of unique.values()) {
    observations.push({
      captureKey: dir.name,
      capturedAt: display.capturedAt,
      providerGameId: row.providerGameId,
      providerPlayerId: row.providerPlayerId,
      providerTeamId: row.providerTeamId,
      playerName: row.playerName,
      lineupStatus: row.lineupStatus,
      teamCompleteAtCapture: completeAtCapture.has(`${dir.name}:${row.providerGameId}:${row.providerTeamId}`),
    });
  }
}
const gameIds = [...new Set(observations.map((row) => row.providerGameId))].sort((a, b) => a - b);
const finals = await fetchFinalLineups(gameIds);
const starters = new Map(gameIds.map((id) => [id, new Set()]));
for (const row of finals) {
  if (!starters.has(row?.game_id) || row?.is_probable_pitcher !== false || !Number.isInteger(row?.batting_order) || row.batting_order < 1 || row.batting_order > 9) continue;
  starters.get(row.game_id).add(row?.player?.id);
}
for (const id of gameIds) if (starters.get(id)?.size !== 18) throw new Error(`Final game ${id} has ${starters.get(id)?.size ?? 0} starters.`);
for (const row of observations) row.scratched = !starters.get(row.providerGameId).has(row.providerPlayerId);

const directObservationRows = observations.filter((row) => row.lineupStatus === 'projected' && row.teamCompleteAtCapture);
if (directObservationRows.some((row) => !row.scratched)) throw new Error('A projected player absent from a preserved complete current-team nine unexpectedly started.');

const byPlayerGame = new Map();
for (const row of observations) {
  const k = `${row.providerGameId}:${row.providerPlayerId}`;
  const group = byPlayerGame.get(k) ?? [];
  group.push(row);
  byPlayerGame.set(k, group);
}
const firstRows = [];
for (const [k, group] of byPlayerGame) {
  group.sort((a, b) => Date.parse(a.capturedAt) - Date.parse(b.capturedAt) || a.captureKey.localeCompare(b.captureKey));
  if (group.some((row) => row.scratched !== group[0].scratched)) throw new Error(`Scratch drift ${k}.`);
  firstRows.push(group[0]);
}
const directFirstRows = firstRows.filter((row) => row.lineupStatus === 'projected' && row.teamCompleteAtCapture);

const projectedObs = observations.filter((row) => row.lineupStatus === 'projected');
const projectedScratchObs = projectedObs.filter((row) => row.scratched);
const projectedFirst = firstRows.filter((row) => row.lineupStatus === 'projected');
const projectedScratchFirst = projectedFirst.filter((row) => row.scratched);

const report = {
  diagnosticVersion: 1,
  diagnosticType: 'm11-hhr-current-team-complete-nine-gap',
  d1MergedAt: '2026-08-14T14:36:07.000Z',
  captureObservations: {
    projected: projectedObs.length,
    projectedScratched: projectedScratchObs.length,
    projectedScratchRate: projectedObs.length ? projectedScratchObs.length / projectedObs.length : null,
    projectedWithCompleteCurrentTeamNine: directObservationRows.length,
    shareOfProjectedScratchesWithCompleteCurrentTeamNine: projectedScratchObs.length ? directObservationRows.length / projectedScratchObs.length : null,
  },
  distinctPlayerGamesByFirstPostD1Capture: {
    projected: projectedFirst.length,
    projectedScratched: projectedScratchFirst.length,
    projectedScratchRate: projectedFirst.length ? projectedScratchFirst.length / projectedFirst.length : null,
    projectedWithCompleteCurrentTeamNine: directFirstRows.length,
    shareOfProjectedScratchesWithCompleteCurrentTeamNine: projectedScratchFirst.length ? directFirstRows.length / projectedScratchFirst.length : null,
  },
  directIgnoredSignalRows: directObservationRows,
  completeCurrentTeamEvidenceRows: completeEvidence,
  reservedCapturesRead: false,
  fittingPerformed: false,
  modelChanged: false,
  canonicalChanged: false,
};
await mkdir(OUTPUT_ROOT, { recursive: true });
const output = path.join(OUTPUT_ROOT, 'current-team-gap-report.json');
await writeFile(output, `${JSON.stringify(report, null, 2)}\n`);
console.log('--- M11 HHR CURRENT-TEAM LINEUP GAP AUDIT ---');
console.log(`POST-D1 PROJECTED OBSERVATIONS\t${projectedObs.length}`);
console.log(`POST-D1 PROJECTED SCRATCHED\t${projectedScratchObs.length}`);
console.log(`PROJECTED WITH COMPLETE CURRENT-TEAM NINE\t${directObservationRows.length}`);
console.log(`SHARE PROJECTED SCRATCHES WITH COMPLETE CURRENT-TEAM NINE\t${report.captureObservations.shareOfProjectedScratchesWithCompleteCurrentTeamNine}`);
console.log(`DISTINCT FIRST-CAPTURE PROJECTED\t${projectedFirst.length}`);
console.log(`DISTINCT FIRST-CAPTURE PROJECTED SCRATCHED\t${projectedScratchFirst.length}`);
console.log(`DISTINCT PROJECTED WITH COMPLETE CURRENT-TEAM NINE\t${directFirstRows.length}`);
console.log(`DISTINCT SHARE PROJECTED SCRATCHES WITH COMPLETE CURRENT-TEAM NINE\t${report.distinctPlayerGamesByFirstPostD1Capture.shareOfProjectedScratchesWithCompleteCurrentTeamNine}`);
for (const row of directObservationRows) console.log(`DIRECT IGNORED CURRENT-LINEUP SIGNAL\t${JSON.stringify(row)}`);
console.log('RESERVED CAPTURES READ\tfalse');
console.log('FITTING PERFORMED\tfalse');
console.log('MODEL CHANGED\tfalse');
console.log('CANONICAL CHANGED\tfalse');
console.log(`OUTPUT\t${output}`);
console.log('--- END M11 HHR CURRENT-TEAM LINEUP GAP AUDIT ---');
