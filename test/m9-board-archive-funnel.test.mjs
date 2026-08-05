import assert from 'node:assert/strict';
import { access, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import {
  createM9ArchiveFunnel,
  formatM9ArchiveFunnelReport,
  persistM9ArchiveForMode,
} from '../scripts/m9-board-archive-funnel-utils.mjs';

function emptyFunnel(dryRun = false) {
  return createM9ArchiveFunnel({
    archiveDate: '2026-08-04',
    dryRun,
  });
}

async function pathExists(filePath) {
  try {
    await access(filePath);
    return true;
  } catch (error) {
    if (error?.code === 'ENOENT') return false;
    throw error;
  }
}

test('the funnel report prints on the failure path', () => {
  const funnel = emptyFunnel(true);
  funnel.add('providerEvents', { entered: 15, survived: 15 });
  funnel.add('pregameEvents', { entered: 15, survived: 0 });
  funnel.drop('pregameEvents', 'game already in progress', 15);

  const output = formatM9ArchiveFunnelReport({
    funnel,
    status: 'FAILED CLOSED',
  });

  assert.match(output, /M9 BOARD ARCHIVE FUNNEL/u);
  assert.match(output, /STATUS: FAILED CLOSED/u);
  assert.match(
    output,
    /pregame events surviving the started-game gate: entering 15 events; surviving 0; dropped 15/u,
  );
  assert.match(output, /dropped: 15 \(game already in progress\)/u);
});

test('the funnel report prints on the success path', () => {
  const funnel = emptyFunnel(false);
  funnel.add('providerEvents', { entered: 2, survived: 2 });
  funnel.add('pregameEvents', { entered: 2, survived: 2 });
  funnel.add('rawOffers', { entered: 8, survived: 8 });
  funnel.add('resolvedIdentityOffers', { entered: 8, survived: 8 });
  funnel.add('matchedGameOffers', { entered: 8, survived: 8 });
  funnel.add('lineupEvidenceOffers', { entered: 8, survived: 8 });
  funnel.add('verifiedStarterOffers', { entered: 8, survived: 8 });
  funnel.add('historyOffers', { entered: 8, survived: 8 });
  funnel.add('composedCandidates', { entered: 8, survived: 8 });
  funnel.add('rankedCandidates', { entered: 8, survived: 8 });

  const output = formatM9ArchiveFunnelReport({
    funnel,
    status: 'SUCCESS',
  });

  assert.match(output, /STATUS: SUCCESS/u);
  assert.match(output, /MODE: IMMUTABLE ARCHIVE/u);
  assert.match(
    output,
    /candidates ranked: entering 8 candidates; surviving 8; dropped 0/u,
  );
});

test('--dry-run writes no archive file', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'm9-funnel-dry-run-'));
  const filePath = path.join(root, '2026-08-04.json');
  let persistCalls = 0;
  try {
    const result = await persistM9ArchiveForMode({
      dryRun: true,
      filePath,
      archive: Object.freeze({ archiveSha256: 'fixture' }),
      persist: async () => {
        persistCalls += 1;
        await writeFile(filePath, 'unexpected');
      },
    });
    assert.equal(result, null);
    assert.equal(persistCalls, 0);
    assert.equal(await pathExists(filePath), false);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('--dry-run on a date with an existing archive writes nothing and does not fail on immutability', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'm9-funnel-existing-'));
  const filePath = path.join(root, '2026-08-04.json');
  const original = Buffer.from('{"immutable":true}\n');
  try {
    await writeFile(filePath, original);
    const result = await persistM9ArchiveForMode({
      dryRun: true,
      filePath,
      archive: Object.freeze({ archiveSha256: 'different' }),
      persist: async () => {
        throw new Error('dry-run must never call persistence');
      },
    });
    assert.equal(result, null);
    assert.deepEqual(await readFile(filePath), original);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('drop reasons are attributed to the correct stage', () => {
  const funnel = emptyFunnel(true);
  funnel.add('resolvedIdentityOffers', { entered: 4, survived: 0 });
  funnel.drop('resolvedIdentityOffers', 'zero matches', 3);
  funnel.drop('resolvedIdentityOffers', 'multiple matches', 1);

  const snapshot = funnel.snapshot();
  const identity = snapshot.stages.find(
    (stage) => stage.key === 'resolvedIdentityOffers',
  );
  assert.ok(identity);
  assert.deepEqual(identity.drops, [
    { reason: 'multiple matches', count: 1 },
    { reason: 'zero matches', count: 3 },
  ]);
});

test('no secret value appears in funnel output', () => {
  const secret = 'the-odds-secret-never-print';
  const funnel = emptyFunnel(true);
  funnel.add('providerEvents', { entered: 1, survived: 0 });
  funnel.drop('providerEvents', 'provider request failed closed', 1);
  const output = formatM9ArchiveFunnelReport({
    funnel,
    status: 'FAILED CLOSED',
  });
  assert.doesNotMatch(output, new RegExp(secret, 'u'));
  assert.doesNotMatch(output, /apiKey=/u);
  assert.doesNotMatch(output, /Authorization:/u);
});

test('the live archive CLI wires dry-run and prints the funnel before either outcome', async () => {
  const source = await readFile(
    'scripts/archive-m9-batter-hits-board.mjs',
    'utf8',
  );
  assert.match(source, /--dry-run/u);
  assert.match(source, /printM9ArchiveFunnelReport/u);
  assert.match(source, /persistM9ArchiveForMode/u);
  assert.match(source, /if \(!dryRun\)\s*await assertArchiveAbsent/u);
  assert.match(source, /status: 'FAILED CLOSED'/u);
  assert.match(source, /status: 'SUCCESS'/u);
});
