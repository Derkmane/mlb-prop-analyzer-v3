import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import test from 'node:test';

const PRELOAD = path.resolve('scripts/m9-board-snapshot-preload.mjs');

const sha256 = (bytes) =>
  createHash('sha256').update(bytes).digest('hex');

test('HHR replay preserves exact Pick6 and DraftKings source-qualified board bytes', async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'm9-hhr-active-replay-'));
  t.after(() => rm(root, { recursive: true, force: true }));

  const eventId = 'event-1';
  const snapshotDirectory = path.join(root, 'snapshot');
  const rawDirectory = path.join(snapshotDirectory, 'raw');
  await mkdir(rawDirectory, { recursive: true });

  const pick6Bytes = Buffer.from('{"source":"frozen-pick6-hhr"}', 'utf8');
  const draftkingsBytes = Buffer.from('{"source":"frozen-draftkings-hhr"}', 'utf8');
  const pick6Sha256 = sha256(pick6Bytes);
  const draftkingsSha256 = sha256(draftkingsBytes);
  await Promise.all([
    writeFile(path.join(rawDirectory, `${pick6Sha256}.json`), pick6Bytes),
    writeFile(path.join(rawDirectory, `${draftkingsSha256}.json`), draftkingsBytes),
  ]);

  const manifestPath = path.join(snapshotDirectory, 'manifest.json');
  await writeFile(
    manifestPath,
    `${JSON.stringify({
      version: 4,
      contract: 'm9-first-board-snapshot-v4',
      snapshotId: 'snapshot-1',
      snapshotSetSha256: 'snapshot-set-sha',
      claimedGames: [{ eventId }],
      replayEligibleEvents: [{ eventId }],
      requests: [
        {
          requestKey: `hhr:pick6:${eventId}`,
          consumer: 'hhr',
          capturedAt: '2026-08-22T14:32:06.201Z',
          response: {
            status: 200,
            statusText: 'OK',
            contentType: 'application/json',
            sha256: pick6Sha256,
            byteLength: pick6Bytes.length,
            bodyFile: `raw/${pick6Sha256}.json`,
          },
        },
        {
          requestKey: `hhr:draftkings:${eventId}`,
          consumer: 'hhr',
          capturedAt: '2026-08-22T14:32:06.202Z',
          response: {
            status: 200,
            statusText: 'OK',
            contentType: 'application/json',
            sha256: draftkingsSha256,
            byteLength: draftkingsBytes.length,
            bodyFile: `raw/${draftkingsSha256}.json`,
          },
        },
      ],
    })}\n`,
  );

  const receiptPath = path.join(root, 'hhr-receipt.json');
  const code = `
    const pick6 = await fetch('https://api.the-odds-api.com/v4/sports/baseball_mlb/events/${eventId}/odds?apiKey=dummy&regions=us_dfs&bookmakers=pick6&markets=batter_hits_runs_rbis,batter_hits_runs_rbis_alternate&dateFormat=iso&oddsFormat=american&includeMultipliers=true&includeSids=true');
    console.log('PICK6', await pick6.text());
    const draftkings = await fetch('https://api.the-odds-api.com/v4/sports/baseball_mlb/events/${eventId}/odds?apiKey=dummy&regions=us&bookmakers=draftkings&markets=batter_hits_runs_rbis,batter_hits_runs_rbis_alternate&dateFormat=iso&oddsFormat=american&includeMultipliers=true&includeSids=true');
    console.log('DRAFTKINGS', await draftkings.text());
  `;

  const result = spawnSync(
    process.execPath,
    [
      '--import',
      PRELOAD,
      '--input-type=module',
      '-e',
      code,
    ],
    {
      encoding: 'utf8',
      env: {
        ...process.env,
        M9_BOARD_SNAPSHOT_MANIFEST: manifestPath,
        M9_BOARD_SNAPSHOT_CONSUMER: 'hhr',
        M9_BOARD_REPLAY_RECEIPT: receiptPath,
      },
    },
  );

  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /PICK6 \{"source":"frozen-pick6-hhr"\}/u);
  assert.match(
    result.stdout,
    /DRAFTKINGS \{"source":"frozen-draftkings-hhr"\}/u,
  );

  const receipt = JSON.parse(await readFile(receiptPath, 'utf8'));
  assert.equal(receipt.version, 3);
  assert.equal(receipt.complete, true);
  assert.deepEqual(
    receipt.expectedRequestKeys,
    [`hhr:draftkings:${eventId}`, `hhr:pick6:${eventId}`],
  );
  assert.deepEqual(receipt.optionalRequestKeys, []);
  assert.deepEqual(
    receipt.consumed.map((row) => row.requestKey),
    [`hhr:draftkings:${eventId}`, `hhr:pick6:${eventId}`],
  );
  assert.deepEqual(
    receipt.consumed.map((row) => row.responseSha256),
    [draftkingsSha256, pick6Sha256],
  );
});
