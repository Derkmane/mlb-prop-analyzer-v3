import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { sha256 } from '../scripts/provider-probe-utils.mjs';
import { auditM8ContextRowsAgainstSegments } from '../scripts/m8-context-play-signature-audit-utils.mjs';
import {
  runM8ContextPlaySignatureAudit,
  segmentVerifiedM8ContextPlaySequence,
} from '../scripts/m8-context-play-signature-audit-run-utils.mjs';

const FULL_TEST_RESERVATION = Object.freeze({
  startDate: '2026-07-06',
  endDate: '2026-07-25',
  shardCount: 20,
  gameCount: 225,
  plateAppearanceCount: 16830,
  rowsIncluded: false,
  allowedUse: 'final-evaluation-only-after-candidate-selection',
});

function play({
  gameId = 9001,
  order,
  type,
  batterId = null,
  pitcherId = null,
  inning = 1,
  inningType = 'Top',
  text = null,
}) {
  return {
    game_id: gameId,
    order,
    type,
    text,
    inning,
    inning_type: inningType,
    outs: 0,
    batter_id: batterId,
    pitcher_id: pitcherId,
  };
}

function batterSegment({
  gameId = 9001,
  startOrder,
  batterId = 10,
  pitcherId = 20,
  outcomeType = 'Batters Fielders Choice - All Runners Safe',
  resultText = 'Batter reaches first; all runners safe.',
  includeNullCaughtStealing = false,
}) {
  const rows = [
    play({
      gameId,
      order: startOrder,
      type: 'Start Batter/Pitcher',
      batterId,
      pitcherId,
    }),
    play({
      gameId,
      order: startOrder + 1,
      type: outcomeType,
      batterId,
      pitcherId,
      text: 'Pitch in play.',
    }),
  ];
  if (includeNullCaughtStealing) {
    rows.push(
      play({
        gameId,
        order: startOrder + 2,
        type: 'Caught Stealing',
        batterId: null,
        pitcherId,
        text: 'Runner caught stealing second.',
      }),
    );
  }
  rows.push(
    play({
      gameId,
      order: startOrder + (includeNullCaughtStealing ? 3 : 2),
      type: 'Play Result',
      batterId,
      pitcherId,
      text: resultText,
    }),
    play({
      gameId,
      order: startOrder + (includeNullCaughtStealing ? 4 : 3),
      type: 'End Batter/Pitcher',
      batterId,
      pitcherId,
    }),
  );
  return rows;
}

function contextRow(overrides = {}) {
  return {
    rowId: '2026-05-01:9001:4',
    observedDate: '2026-05-01',
    providerGameId: 9001,
    providerPaNumber: 4,
    providerBatterId: 10,
    providerPitcherId: 20,
    inning: 1,
    halfInning: 'top',
    rawResult: 'Fielders Choice',
    mappingStatus: 'unresolved',
    unresolvedReason: 'context-required',
    ...overrides,
  };
}

function stringify(value) {
  return `${JSON.stringify(value, null, 2)}\n`;
}

function reducedTestReservation(reservation) {
  return {
    startDate: reservation.startDate,
    endDate: reservation.endDate,
    plateAppearanceCount: reservation.plateAppearanceCount,
    rowsIncluded: reservation.rowsIncluded,
  };
}

async function createAuditFixture({ rowsIncluded = false } = {}) {
  const root = await mkdtemp(path.join(os.tmpdir(), 'm8-context-signature-'));
  const datasetPath = path.join(root, 'dataset.json');
  const captureRoot = path.join(root, 'capture');
  const gameDirectory = path.join(captureRoot, 'games', '9001');
  const pagesDirectory = path.join(gameDirectory, 'pages');
  await mkdir(pagesDirectory, { recursive: true });

  const row = contextRow();
  const fullReservation = { ...FULL_TEST_RESERVATION, rowsIncluded };
  const periods = {
    fit: {
      startDate: '2026-03-26',
      endDate: '2026-06-21',
      rowCount: 1,
      rows: [row],
    },
    validation: {
      startDate: '2026-06-22',
      endDate: '2026-07-05',
      rowCount: 0,
      rows: [],
    },
  };
  const datasetIdentity = {
    activeSeason: 2026,
    sourcePartitionSha256: 'd'.repeat(64),
    sourceEvidenceSetSha256: 'e'.repeat(64),
    periods,
    untouchedTestReservation: fullReservation,
  };
  const dataset = {
    datasetVersion: 2,
    purpose: 'test',
    ...datasetIdentity,
    totals: { contextRequiredCount: 1 },
    datasetSha256: sha256(JSON.stringify(datasetIdentity)),
  };
  await writeFile(datasetPath, stringify(dataset), 'utf8');

  const pageBody = {
    data: [
      play({ order: 1, type: 'Start Inning', inningType: 'Top' }),
      ...batterSegment({ startOrder: 2 }),
      play({ order: 6, type: 'End Inning', inningType: 'Mid' }),
    ],
    meta: { per_page: 100 },
  };
  const pageText = stringify(pageBody);
  await writeFile(path.join(pagesDirectory, 'page-0001.json'), pageText, 'utf8');

  const gameManifest = {
    captureVersion: 1,
    provider: 'BALLDONTLIE MLB API',
    purpose: 'test',
    gameId: 9001,
    perPage: 100,
    status: 'complete',
    error: null,
    pageCount: 1,
    recordCount: pageBody.data.length,
    firstOrder: 1,
    lastOrder: 6,
    pages: [
      {
        pageNumber: 1,
        requestCursor: null,
        nextCursor: null,
        filePath: 'pages/page-0001.json',
        rawBodySha256: sha256(pageText),
        savedBodySha256: sha256(pageText),
        responseStatus: 200,
        request: {},
        recordCount: pageBody.data.length,
        firstOrder: 1,
        lastOrder: 6,
      },
    ],
  };
  const gameManifestText = stringify(gameManifest);
  await writeFile(
    path.join(gameDirectory, 'game-manifest.json'),
    gameManifestText,
    'utf8',
  );

  const gameSummary = {
    gameId: 9001,
    observedDate: '2026-05-01',
    contextRowCount: 1,
    resultCounts: { 'Fielders Choice': 1 },
    pageCount: 1,
    recordCount: pageBody.data.length,
    gameManifestSha256: sha256(gameManifestText),
  };
  const captureIdentity = {
    activeSeason: 2026,
    sourceDatasetSha256: dataset.datasetSha256,
    sourceDatasetFileSha256: sha256(await readFile(datasetPath, 'utf8')),
    sourcePlanSha256: 'b'.repeat(64),
    sourcePlanFileSha256: 'c'.repeat(64),
    contextRowCount: 1,
    gameCount: 1,
    resultCounts: { 'Fielders Choice': 1 },
    games: [gameSummary],
    totalPageCount: 1,
    totalPlayRecordCount: pageBody.data.length,
    untouchedTestReservation: reducedTestReservation(fullReservation),
  };
  const captureManifest = {
    captureVersion: 1,
    purpose: 'test',
    provider: 'BALLDONTLIE MLB API',
    status: 'complete',
    error: null,
    ...captureIdentity,
    captureSha256: sha256(JSON.stringify(captureIdentity)),
  };
  await writeFile(
    path.join(captureRoot, 'capture-manifest.json'),
    stringify(captureManifest),
    'utf8',
  );

  return {
    root,
    datasetPath,
    captureRoot,
    pagePath: path.join(pagesDirectory, 'page-0001.json'),
  };
}

test('segments complete batter blocks while preserving non-batter inning markers and null-batter events', () => {
  const plays = [
    play({ order: 1, type: 'Start Inning', inningType: 'Top' }),
    ...batterSegment({ startOrder: 2, includeNullCaughtStealing: true }),
    play({ order: 7, type: 'End Inning', inningType: 'Mid' }),
  ];
  const segments = segmentVerifiedM8ContextPlaySequence({ gameId: 9001, plays });

  assert.equal(segments.length, 1);
  assert.equal(segments[0].halfInning, 'top');
  assert.equal(segments[0].startOrder, 2);
  assert.equal(segments[0].endOrder, 6);
  assert.equal(
    segments[0].plays.some(
      (value) => value.type === 'Caught Stealing' && value.batterId === null,
    ),
    true,
  );
});

test('conserves unique, multiple, and zero matches without inferring a disposition or terminal category', () => {
  const uniqueSegments = segmentVerifiedM8ContextPlaySequence({
    gameId: 9001,
    plays: batterSegment({ gameId: 9001, startOrder: 10 }),
  });
  const repeatedSegments = segmentVerifiedM8ContextPlaySequence({
    gameId: 9002,
    plays: [
      ...batterSegment({ gameId: 9002, startOrder: 20 }),
      ...batterSegment({ gameId: 9002, startOrder: 30 }),
    ],
  });
  const audit = auditM8ContextRowsAgainstSegments({
    contextRows: [
      contextRow({ rowId: 'unique' }),
      contextRow({ rowId: 'multiple', providerGameId: 9002 }),
      contextRow({ rowId: 'zero', providerGameId: 9003 }),
    ],
    segmentsByGameId: new Map([
      [9001, uniqueSegments],
      [9002, repeatedSegments],
    ]),
  });

  assert.equal(audit.contextRowCount, 3);
  assert.deepEqual(audit.matchStatusCounts, { zero: 1, unique: 1, multiple: 1 });
  for (const row of audit.rows) {
    assert.equal(row.inferredBatterDisposition, null);
    assert.equal(row.inferredTerminalCategory, null);
  }
});

test('verifies the frozen capture and produces a deterministic no-mapping audit', async (t) => {
  const fixture = await createAuditFixture();
  t.after(() => rm(fixture.root, { recursive: true, force: true }));

  const first = await runM8ContextPlaySignatureAudit({
    datasetPath: fixture.datasetPath,
    captureRoot: fixture.captureRoot,
  });
  const second = await runM8ContextPlaySignatureAudit({
    datasetPath: fixture.datasetPath,
    captureRoot: fixture.captureRoot,
  });

  assert.equal(first.auditSha256, second.auditSha256);
  assert.equal(first.contextRowCount, 1);
  assert.deepEqual(first.matchStatusCounts, { zero: 0, unique: 1, multiple: 0 });
  assert.equal(first.mappingApplied, false);
  assert.equal(first.rows[0].inferredBatterDisposition, null);
  assert.equal(first.rows[0].inferredTerminalCategory, null);
  assert.deepEqual(first.untouchedTestReservation, {
    startDate: FULL_TEST_RESERVATION.startDate,
    endDate: FULL_TEST_RESERVATION.endDate,
    plateAppearanceCount: FULL_TEST_RESERVATION.plateAppearanceCount,
    rowsIncluded: false,
  });
  assert.equal(first.untouchedTestRowsRead, false);
});

test('rejects a tampered captured play page before producing signatures', async (t) => {
  const fixture = await createAuditFixture();
  t.after(() => rm(fixture.root, { recursive: true, force: true }));
  await writeFile(fixture.pagePath, '{}\n', 'utf8');

  await assert.rejects(
    runM8ContextPlaySignatureAudit({
      datasetPath: fixture.datasetPath,
      captureRoot: fixture.captureRoot,
    }),
    /hash mismatch/,
  );
});

test('rejects any dataset or capture that exposes untouched-test rows', async (t) => {
  const fixture = await createAuditFixture({ rowsIncluded: true });
  t.after(() => rm(fixture.root, { recursive: true, force: true }));

  await assert.rejects(
    runM8ContextPlaySignatureAudit({
      datasetPath: fixture.datasetPath,
      captureRoot: fixture.captureRoot,
    }),
    /untouched-test rows must remain excluded/,
  );
});
