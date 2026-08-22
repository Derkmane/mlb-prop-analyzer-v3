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

test('HHR replay keeps the Underdog board frozen while standard-book HHR stays auxiliary/live', async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'm9-hhr-standard-replay-'));
  t.after(() => rm(root, { recursive: true, force: true }));

  const eventId = 'event-1';
  const snapshotDirectory = path.join(root, 'snapshot');
  const rawDirectory = path.join(snapshotDirectory, 'raw');
  await mkdir(rawDirectory, { recursive: true });

  const hhrBytes = Buffer.from('{"source":"frozen-underdog-hhr"}', 'utf8');
  const hhrSha256 = sha256(hhrBytes);
  await writeFile(path.join(rawDirectory, `${hhrSha256}.json`), hhrBytes);

  const manifestPath = path.join(snapshotDirectory, 'manifest.json');
  await writeFile(
    manifestPath,
    `${JSON.stringify({
      version: 2,
      contract: 'm9-first-board-snapshot-v2',
      snapshotId: 'snapshot-1',
      snapshotSetSha256: 'snapshot-set-sha',
      claimedGames: [{ eventId }],
      replayEligibleEvents: [{ eventId }],
      requests: [
        {
          requestKey: `hhr:${eventId}`,
          consumer: 'hhr',
          capturedAt: '2026-08-22T14:32:06.201Z',
          response: {
            status: 200,
            statusText: 'OK',
            contentType: 'application/json',
            sha256: hhrSha256,
            byteLength: hhrBytes.length,
            bodyFile: `raw/${hhrSha256}.json`,
          },
        },
      ],
    })}\n`,
  );

  const stubPath = path.join(root, 'stub-live-fetch.mjs');
  await writeFile(
    stubPath,
    `globalThis.fetch = async (input) => {\n  const url = new URL(typeof input === 'string' || input instanceof URL ? input : input.url);\n  return new Response(JSON.stringify({ source: 'live-aux', markets: url.searchParams.get('markets'), regions: url.searchParams.get('regions') }), { status: 200, headers: { 'content-type': 'application/json' } });\n};\n`,
  );

  const receiptPath = path.join(root, 'hhr-receipt.json');
  const code = `
    const frozen = await fetch('https://api.the-odds-api.com/v4/sports/baseball_mlb/events/${eventId}/odds?apiKey=dummy&regions=us_dfs&bookmakers=underdog&markets=batter_hits_runs_rbis,batter_hits_runs_rbis_alternate&dateFormat=iso&oddsFormat=american&includeMultipliers=true&includeSids=true');
    console.log('FROZEN', await frozen.text());
    const auxiliary = await fetch('https://api.the-odds-api.com/v4/sports/baseball_mlb/events/${eventId}/odds?apiKey=dummy&regions=us&markets=batter_hits_runs_rbis&dateFormat=iso&oddsFormat=american');
    console.log('AUX', await auxiliary.text());
  `;

  const result = spawnSync(
    process.execPath,
    [
      '--import',
      stubPath,
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
  assert.match(result.stdout, /FROZEN \{"source":"frozen-underdog-hhr"\}/u);
  assert.match(
    result.stdout,
    /AUX \{"source":"live-aux","markets":"batter_hits_runs_rbis","regions":"us"\}/u,
  );

  const receipt = JSON.parse(await readFile(receiptPath, 'utf8'));
  assert.equal(receipt.complete, true);
  assert.deepEqual(receipt.expectedRequestKeys, [`hhr:${eventId}`]);
  assert.deepEqual(receipt.optionalRequestKeys, []);
  assert.deepEqual(
    receipt.consumed.map((row) => row.requestKey),
    [`hhr:${eventId}`],
  );
  assert.equal(receipt.consumed[0].responseSha256, hhrSha256);
});
