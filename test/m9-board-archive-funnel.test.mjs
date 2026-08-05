import assert from 'node:assert/strict';
import { access, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import {
  createM9ArchiveFunnel,
  formatM9ArchiveFunnelReport,
  persistM9ArchiveForMode,
  selectM9PregameEventsForCapture,
} from '../scripts/m9-board-archive-funnel-utils.mjs';

const CAPTURED_AT = '2026-08-04T23:00:00.000Z';

function emptyFunnel(dryRun = false) {
  return createM9ArchiveFunnel({ captureTimestamp: CAPTURED_AT, dryRun });
}

function rawEvent({ id, commenceTime, sportKey = 'baseball_mlb' }) {
  return Object.freeze({
    id,
    sport_key: sportKey,
    commence_time: commenceTime,
    home_team: 'Home Club',
    away_team: 'Away Club',
  });
}

async function pathExists(filePath) {
  try { await access(filePath); return true; } catch (error) { if (error?.code === 'ENOENT') return false; throw error; }
}

test('a pregame event with a commence time on a later calendar date is included, not dropped', () => {
  const selection = selectM9PregameEventsForCapture({
    capturedAt: CAPTURED_AT,
    rawEvents: [rawEvent({ id: 'tomorrow', commenceTime: '2026-08-05T18:10:00Z' })],
  });
  assert.equal(selection.events.length, 1);
  assert.equal(selection.events[0].eventId, 'tomorrow');
  assert.equal(selection.events[0].commenceTimeUtc, '2026-08-05T18:10:00.000Z');
  assert.deepEqual(selection.drops, []);
});

test('an event whose commence time has passed is excluded as started', () => {
  const selection = selectM9PregameEventsForCapture({
    capturedAt: CAPTURED_AT,
    rawEvents: [rawEvent({ id: 'started', commenceTime: '2026-08-04T22:10:00Z' })],
  });
  assert.deepEqual(selection.events, []);
  assert.deepEqual(selection.drops, [{
    eventId: 'started',
    commenceTimeUtc: '2026-08-04T22:10:00.000Z',
    reason: 'game already in progress',
  }]);
});

test('the funnel report prints per-event drop detail on the failure path', () => {
  const funnel = emptyFunnel(true);
  funnel.add('providerEvents', { entered: 1, survived: 1 });
  funnel.add('pregameEvents', { entered: 1, survived: 0 });
  funnel.dropEvent('pregameEvents', {
    eventId: 'started',
    commenceTimeUtc: '2026-08-04T22:10:00Z',
    reason: 'game already in progress',
  });
  const output = formatM9ArchiveFunnelReport({ funnel, status: 'FAILED CLOSED' });
  assert.match(output, /STATUS: FAILED CLOSED/u);
  assert.match(output, /dropped: 1 \(game already in progress\)/u);
  assert.match(output, /event drop: started \| 2026-08-04T22:10:00.000Z \| game already in progress/u);
});

test('the funnel report prints on the success path', () => {
  const funnel = emptyFunnel(false);
  for (const key of ['providerEvents', 'pregameEvents']) funnel.add(key, { entered: 2, survived: 2 });
  for (const key of ['rawOffers', 'resolvedIdentityOffers', 'matchedGameOffers', 'lineupEvidenceOffers', 'verifiedStarterOffers', 'historyOffers']) funnel.add(key, { entered: 8, survived: 8 });
  funnel.add('composedCandidates', { entered: 8, survived: 8 });
  funnel.add('rankedCandidates', { entered: 8, survived: 8 });
  const output = formatM9ArchiveFunnelReport({ funnel, status: 'SUCCESS' });
  assert.match(output, /STATUS: SUCCESS/u);
  assert.match(output, /MODE: IMMUTABLE CAPTURE SNAPSHOT/u);
  assert.match(output, /CAPTURE TIMESTAMP: 2026-08-04T23:00:00.000Z/u);
  assert.match(output, /candidates ranked: entering 8 candidates; surviving 8; dropped 0/u);
});

test('--dry-run writes no archive file', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'm9-funnel-dry-run-'));
  const filePath = path.join(root, 'capture.json');
  let persistCalls = 0;
  try {
    const result = await persistM9ArchiveForMode({ dryRun: true, filePath, archive: Object.freeze({ archiveSha256: 'fixture' }), persist: async () => { persistCalls += 1; await writeFile(filePath, 'unexpected'); } });
    assert.equal(result, null);
    assert.equal(persistCalls, 0);
    assert.equal(await pathExists(filePath), false);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('--dry-run with an existing capture writes nothing and does not fail on immutability', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'm9-funnel-existing-'));
  const filePath = path.join(root, 'capture.json');
  const original = Buffer.from('{"immutable":true}\n');
  try {
    await writeFile(filePath, original);
    const result = await persistM9ArchiveForMode({ dryRun: true, filePath, archive: Object.freeze({ archiveSha256: 'different' }), persist: async () => { throw new Error('dry-run must never call persistence'); } });
    assert.equal(result, null);
    assert.deepEqual(await readFile(filePath), original);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('drop reasons are attributed to the correct stage', () => {
  const funnel = emptyFunnel(true);
  funnel.add('resolvedIdentityOffers', { entered: 4, survived: 0 });
  funnel.drop('resolvedIdentityOffers', 'zero matches', 3);
  funnel.drop('resolvedIdentityOffers', 'multiple matches', 1);
  const identity = funnel.snapshot().stages.find((stage) => stage.key === 'resolvedIdentityOffers');
  assert.deepEqual(identity.drops, [{ reason: 'multiple matches', count: 1 }, { reason: 'zero matches', count: 3 }]);
});

test('no secret value appears in any funnel output', () => {
  const secret = 'the-odds-secret-never-print';
  const funnel = emptyFunnel(true);
  funnel.add('providerEvents', { entered: 1, survived: 0 });
  funnel.drop('providerEvents', 'provider request failed closed', 1);
  const output = formatM9ArchiveFunnelReport({ funnel, status: 'FAILED CLOSED' });
  assert.doesNotMatch(output, new RegExp(secret, 'u'));
  assert.doesNotMatch(output, /apiKey=/u);
  assert.doesNotMatch(output, /Authorization:/u);
});

test('the live archive CLI wires capture identity, dry-run, and funnel output before either outcome', async () => {
  const source = await readFile('scripts/archive-m9-batter-hits-board.mjs', 'utf8');
  assert.match(source, /--dry-run/u);
  assert.match(source, /createM9CaptureIdentity/u);
  assert.match(source, /selectM9PregameEventsForCapture/u);
  assert.match(source, /funnel\.dropEvent\('pregameEvents'/u);
  assert.match(source, /persistM9ArchiveForMode/u);
  assert.match(source, /if \(!dryRun\) await assertArchiveAbsent/u);
  assert.match(source, /status: 'FAILED CLOSED'/u);
  assert.match(source, /printFunnel\('SUCCESS'\)/u);
});
