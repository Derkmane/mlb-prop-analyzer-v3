import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import test from 'node:test';

import {
  captureFirstBoardSnapshot,
} from '../scripts/m9-board-snapshot-preload.mjs';
import {
  finalizeCoverage,
} from '../scripts/m9-capture-controller.mjs';

const sha256 = (bytes) =>
  createHash('sha256').update(bytes).digest('hex');

const WORKFLOW = '.github/workflows/m9-board-archive.yml';
const PRELOAD = 'scripts/m9-board-snapshot-preload.mjs';

function checkSyntax(filePath) {
  const result = spawnSync(process.execPath, ['--check', filePath], {
    encoding: 'utf8',
  });
  assert.equal(result.status, 0, result.stderr);
}

test('unified first-snapshot preload preserves workflow guards with exact active source contracts', async () => {
  const [workflow, source, packageText] = await Promise.all([
    readFile(WORKFLOW, 'utf8'),
    readFile(PRELOAD, 'utf8'),
    readFile('package.json', 'utf8'),
  ]);

  checkSyntax(PRELOAD);

  assert.match(workflow, /cron: '0,30 \* \* \* \*'/u);

  const planAt = workflow.indexOf(
    'name: Plan capture and take first board snapshot',
  );

  for (const later of [
    'name: Install dependencies',
    'name: Build project',
    'name: Restore verified current-season shards',
    'name: Capture or resume verified historical shards',
    'name: Run immutable M9 Batter Hits board archiver',
  ]) {
    assert.ok(
      planAt >= 0 && workflow.indexOf(later) > planAt,
      `${later} must follow the first snapshot.`,
    );
  }

  assert.match(
    workflow,
    /node --import \.\/scripts\/m9-board-snapshot-preload\.mjs scripts\/archive-m9-batter-hits-board\.mjs/u,
  );
  assert.match(
    workflow,
    /node --import \.\/scripts\/m9-board-snapshot-preload\.mjs scripts\/archive-m10-batter-hhr-board\.mjs/u,
  );
  assert.doesNotMatch(workflow, /m10-hhr-raw-board-preload/u);

  assert.match(
    workflow,
    /artifacts\/board-archives\/batter-hhr\/\*\*/u,
  );
  assert.match(
    workflow,
    /name: Upload full archives and diagnostics[\s\S]*if: always\(\)[\s\S]*artifacts\/board-archives\/batter-hhr\/\*\*/u,
  );

  const stepOrder = [
    'name: Identify new immutable HHR capture',
    'name: Build immutable trimmed display archives',
    'name: Upload full archives and diagnostics before repository persistence',
    'name: Persist trimmed display archives to repository',
    'name: Verify capture prerequisites before coverage',
    'name: Finalize game coverage',
    'name: Save immutable HHR archive ledger',
    'name: Save immutable Batter Hits archive ledger',
  ];
  const positions = stepOrder.map((label) => {
    const at = workflow.indexOf(label);
    assert.ok(at >= 0, `missing workflow step: ${label}`);
    return at;
  });
  for (let i = 1; i < positions.length; i += 1) {
    assert.ok(
      positions[i] > positions[i - 1],
      `${stepOrder[i]} must follow ${stepOrder[i - 1]}`,
    );
  }

  assert.doesNotMatch(
    workflow,
    /id: build-display-archives\n\s+if:[^\n]*finalize-coverage/u,
  );
  assert.match(
    workflow,
    /id: persist-display-archives\n\s+if:[^\n]*build-display-archives\.outcome == .success.[^\n]*upload-full-archives\.outcome == .success./u,
  );
  assert.match(
    workflow,
    /id: finalize-coverage\n\s+if:[^\n]*verify-precoverage\.outcome == .success./u,
  );
  assert.doesNotMatch(
    workflow,
    /id: finalize-coverage\n\s+if: always\(\)/u,
  );
  assert.match(
    workflow,
    /id: save-hhr-board-archives\n\s+if:[^\n]*finalize-coverage\.outcome == .success./u,
  );
  assert.match(
    workflow,
    /id: save-hits-board-archives\n\s+if:[^\n]*finalize-coverage\.outcome == .success.[^\n]*save-hhr-board-archives\.outcome == .success./u,
  );
  assert.match(workflow, /name: Verify archive run status/u);

  assert.match(source, /response\.clone\(\)\.arrayBuffer\(\)/u);
  assert.match(
    source,
    /createHash\('sha256'\)\.update\(bytes\)\.digest\('hex'\)/u,
  );
  assert.match(
    source,
    /writeFile\(filePath, bytes, \{ flag: 'wx' \}\)/u,
  );
  assert.match(source, /existing\.equals\(bytes\)/u);
  assert.match(source, /boardSource: 'pick6'[\s\S]*bookmaker: 'pick6'[\s\S]*region: 'us_dfs'/u);
  assert.match(source, /boardSource: 'draftkings'[\s\S]*bookmaker: 'draftkings'[\s\S]*region: 'us'/u);
  assert.match(source, /batter_hits,batter_hits_alternate|HITS_MARKETS/u);
  assert.match(source, /batter_hits_runs_rbis/u);
  assert.match(source, /batter_hits_runs_rbis_alternate/u);
  assert.doesNotMatch(source, /bookmakers', 'underdog'/u);
  assert.doesNotMatch(source, /hits-standard/u);
  assert.doesNotMatch(source, /apiKey/u);

  const pkg = JSON.parse(packageText);
  assert.match(
    pkg.scripts['check:scripts'],
    /m9-capture-controller\.mjs/u,
  );
  assert.match(
    pkg.scripts['check:scripts'],
    /m9-board-snapshot-preload\.mjs/u,
  );
});

test('first snapshot replays source-qualified SHA-256 byte-identical payloads to both archivers and refuses one-sided coverage finalization', async (t) => {
  const root = await mkdtemp(
    path.join(os.tmpdir(), 'm9-first-snapshot-'),
  );
  t.after(() => rm(root, { recursive: true, force: true }));

  const eventId = 'event-1';
  const event = Object.freeze({
    eventId,
    commenceTimeUtc: '2026-08-13T18:00:00.000Z',
    homeTeamName: 'Home Club',
    awayTeamName: 'Away Club',
  });

  const scheduleBytes = Buffer.from(
    JSON.stringify([
      {
        id: eventId,
        commence_time: event.commenceTimeUtc,
        home_team: event.homeTeamName,
        away_team: event.awayTeamName,
      },
    ]),
  );

  const hitsPick6Bytes = Buffer.from('{"kind":"hits-pick6","bytes":"exact"}');
  const hitsDraftKingsBytes = Buffer.from('{"kind":"hits-draftkings","bytes":"exact"}');
  const hhrPick6Bytes = Buffer.from('{"kind":"hhr-pick6","bytes":"exact"}');
  const hhrDraftKingsBytes = Buffer.from('{"kind":"hhr-draftkings","bytes":"exact"}');

  const scheduleUrl = new URL(
    'https://api.the-odds-api.com/v4/sports/baseball_mlb/events?secret=dummy&dateFormat=iso',
  );

  const fakeFetch = async (input) => {
    const url = new URL(input);
    const markets = url.searchParams.get('markets') ?? '';
    const bookmaker = url.searchParams.get('bookmakers');
    const hhr = markets.includes('batter_hits_runs_rbis');
    const bytes = hhr
      ? bookmaker === 'pick6'
        ? hhrPick6Bytes
        : hhrDraftKingsBytes
      : bookmaker === 'pick6'
        ? hitsPick6Bytes
        : hitsDraftKingsBytes;

    return new Response(bytes, {
      status: 200,
      headers: {
        'content-type': 'application/json',
      },
    });
  };

  const stamps = [
    '2026-08-13T16:00:01.000Z',
    '2026-08-13T16:00:02.000Z',
    '2026-08-13T16:00:03.000Z',
    '2026-08-13T16:00:04.000Z',
    '2026-08-13T16:00:05.000Z',
  ];

  const snapshot = await captureFirstBoardSnapshot({
    fetchImpl: fakeFetch,
    archiveRoot: root,
    runStartedAt: '2026-08-13T16:00:00.000Z',
    snapshotStartedAt: '2026-08-13T16:00:00.000Z',
    scheduleUrl,
    scheduleResponse: new Response(scheduleBytes, {
      status: 200,
      headers: {
        'content-type': 'application/json',
      },
    }),
    scheduleBytes,
    scheduleCapturedAt: '2026-08-13T16:00:00.500Z',
    events: [event],
    claimedGames: [
      {
        ...event,
        gameIdentity: `${eventId}@${event.commenceTimeUtc}`,
        classification: 'NORMAL',
      },
    ],
    now: () =>
      stamps.shift() ?? '2026-08-13T16:00:05.000Z',
  });

  assert.equal(snapshot.manifest.version, 3);
  assert.equal(
    snapshot.manifest.runStartToSnapshotElapsedMs,
    5000,
  );

  const request = (consumer, receiptPath, code) => {
    const result = spawnSync(
      process.execPath,
      [
        '--import',
        `./${PRELOAD}`,
        '--input-type=module',
        '-e',
        code,
      ],
      {
        encoding: 'utf8',
        env: {
          ...process.env,
          M9_BOARD_SNAPSHOT_MANIFEST:
            snapshot.manifestPath,
          M9_BOARD_SNAPSHOT_CONSUMER: consumer,
          M9_BOARD_REPLAY_RECEIPT: receiptPath,
        },
      },
    );

    assert.equal(result.status, 0, result.stderr);
    return result.stdout.trim().split(/\r?\n/u);
  };

  const hitsReceipt = path.join(
    root,
    'hits-receipt.json',
  );
  const hhrReceipt = path.join(
    root,
    'hhr-receipt.json',
  );

  const hitsOutput = request(
    'hits',
    hitsReceipt,
    `const e=await fetch('https://api.the-odds-api.com/v4/sports/baseball_mlb/events?secret=dummy&dateFormat=iso');console.log(Buffer.from(await e.arrayBuffer()).toString('hex'));const p=await fetch('https://api.the-odds-api.com/v4/sports/baseball_mlb/events/${eventId}/odds?secret=dummy&regions=us_dfs&bookmakers=pick6&markets=batter_hits,batter_hits_alternate&dateFormat=iso&oddsFormat=american&includeMultipliers=true&includeSids=true');console.log(Buffer.from(await p.arrayBuffer()).toString('hex'));const d=await fetch('https://api.the-odds-api.com/v4/sports/baseball_mlb/events/${eventId}/odds?secret=dummy&regions=us&bookmakers=draftkings&markets=batter_hits,batter_hits_alternate&dateFormat=iso&oddsFormat=american&includeMultipliers=true&includeSids=true');console.log(Buffer.from(await d.arrayBuffer()).toString('hex'));`,
  );

  assert.equal(Buffer.from(hitsOutput[0], 'hex').compare(scheduleBytes), 0);
  assert.equal(Buffer.from(hitsOutput[1], 'hex').compare(hitsPick6Bytes), 0);
  assert.equal(Buffer.from(hitsOutput[2], 'hex').compare(hitsDraftKingsBytes), 0);

  const planPath = path.join(root, 'plan.json');

  await writeFile(
    planPath,
    JSON.stringify({
      version: 1,
      contract: 'm9-schedule-aware-board-run-v1',
      decision: 'CAPTURE',
      runStartedAt: '2026-08-13T16:00:00.000Z',
      claimedGames: [
        {
          ...event,
          gameIdentity:
            `${eventId}@${event.commenceTimeUtc}`,
          classification: 'NORMAL',
        },
      ],
      snapshotSetSha256:
        snapshot.manifest.snapshotSetSha256,
      snapshotManifestPath: snapshot.manifestPath,
    }),
  );

  await assert.rejects(
    finalizeCoverage({
      planPath,
      hitsReceiptPath: hitsReceipt,
      hhrReceiptPath: path.join(
        root,
        'missing-hhr-receipt.json',
      ),
      root,
    }),
    /ENOENT/u,
  );

  await assert.rejects(
    readFile(
      path.join(
        root,
        'capture-controller',
        'coverage-receipts',
        `${snapshot.manifest.snapshotId}.json`,
      ),
    ),
    /ENOENT/u,
  );

  const hhrOutput = request(
    'hhr',
    hhrReceipt,
    `const p=await fetch('https://api.the-odds-api.com/v4/sports/baseball_mlb/events/${eventId}/odds?secret=dummy&regions=us_dfs&bookmakers=pick6&markets=batter_hits_runs_rbis,batter_hits_runs_rbis_alternate&dateFormat=iso&oddsFormat=american&includeMultipliers=true&includeSids=true');console.log(Buffer.from(await p.arrayBuffer()).toString('hex'));const d=await fetch('https://api.the-odds-api.com/v4/sports/baseball_mlb/events/${eventId}/odds?secret=dummy&regions=us&bookmakers=draftkings&markets=batter_hits_runs_rbis,batter_hits_runs_rbis_alternate&dateFormat=iso&oddsFormat=american&includeMultipliers=true&includeSids=true');console.log(Buffer.from(await d.arrayBuffer()).toString('hex'));`,
  );

  assert.equal(Buffer.from(hhrOutput[0], 'hex').compare(hhrPick6Bytes), 0);
  assert.equal(Buffer.from(hhrOutput[1], 'hex').compare(hhrDraftKingsBytes), 0);

  const hits = JSON.parse(
    await readFile(hitsReceipt, 'utf8'),
  );
  const hhr = JSON.parse(
    await readFile(hhrReceipt, 'utf8'),
  );

  assert.equal(hits.complete, true);
  assert.equal(hhr.complete, true);
  assert.equal(hits.version, 3);
  assert.equal(hhr.version, 3);

  assert.equal(
    hits.snapshotSetSha256,
    snapshot.manifest.snapshotSetSha256,
  );
  assert.equal(
    hhr.snapshotSetSha256,
    snapshot.manifest.snapshotSetSha256,
  );
  assert.equal(
    hits.snapshotSetSha256,
    hhr.snapshotSetSha256,
  );

  assert.deepEqual(
    hits.consumed
      .map((row) => row.responseSha256)
      .sort(),
    [
      sha256(scheduleBytes),
      sha256(hitsPick6Bytes),
      sha256(hitsDraftKingsBytes),
    ].sort(),
  );

  assert.deepEqual(
    hhr.consumed.map((row) => row.responseSha256).sort(),
    [sha256(hhrPick6Bytes), sha256(hhrDraftKingsBytes)].sort(),
  );
});
