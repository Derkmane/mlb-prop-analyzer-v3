import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import {
  createReplitDisplayDeliveryService,
  InvalidDisplayDeliveryBundleError,
  type TextObjectStore,
} from '../src/adapters/index.js';

const HITS_OLDER_NAME = `20260828T150000000Z--${'1'.repeat(64)}.json`;
const HITS_NAME = `20260828T163841701Z--${'2'.repeat(64)}.json`;
const HHR_OLDER_NAME = `20260828T150000000Z--${'3'.repeat(64)}.json`;
const HHR_NAME = `20260828T163841701Z--${'4'.repeat(64)}.json`;

function archiveBytes(market: 'batter-hits' | 'batter-hhr', filename: string): Buffer {
  const prefix = filename.split('--')[0]!;
  const capturedAt = `${prefix.slice(0, 4)}-${prefix.slice(4, 6)}-${prefix.slice(6, 8)}T${prefix.slice(9, 11)}:${prefix.slice(11, 13)}:${prefix.slice(13, 15)}.${prefix.slice(15, 18)}Z`;
  return Buffer.from(JSON.stringify({
    displayArchiveVersion: 1,
    displayArchiveContract: 'phase1-trimmed-board-display-v1',
    market,
    captureKey: filename.slice(0, -'.json'.length),
    capturedAt,
    captureDateUtc: '2026-08-28',
    productionEnabled: false,
    productionRankingEnabled: false,
    rows: [{ rank: 1 }],
  }));
}

function envelope(market: 'batter-hits' | 'batter-hhr', filename: string) {
  const bytes = archiveBytes(market, filename);
  return Object.freeze({
    market,
    filename,
    sha256: createHash('sha256').update(bytes).digest('hex'),
    bytesBase64: bytes.toString('base64'),
  });
}

function storeFor(value: unknown): TextObjectStore {
  return Object.freeze({
    async downloadAsText() { return Object.freeze({ ok: true as const, value: JSON.stringify(value) }); },
    async uploadFromText() { return Object.freeze({ ok: true as const, value: null }); },
  });
}

test('persistent display refresh materializes every current-day Hits and HHR capture into the local read cache', async () => {
  const rootDirectory = await mkdtemp(path.join(os.tmpdir(), 'mlb-display-refresh-'));
  const bundle = Object.freeze({
    deliveryVersion: 1,
    displayDateUtc: '2026-08-28',
    capturedAt: '2026-08-28T16:38:41.701Z',
    archives: [
      envelope('batter-hits', HITS_OLDER_NAME),
      envelope('batter-hits', HITS_NAME),
      envelope('batter-hhr', HHR_OLDER_NAME),
      envelope('batter-hhr', HHR_NAME),
    ],
    categoryPerformance: null,
  });
  try {
    const service = createReplitDisplayDeliveryService({
      rootDirectory,
      store: storeFor(bundle),
    });
    await service.refreshFromStore();
    for (const filename of [HITS_OLDER_NAME, HITS_NAME]) {
      assert.equal(
        JSON.parse(await readFile(path.join(rootDirectory, 'batter-hits', 'captures', filename), 'utf8')).market,
        'batter-hits',
      );
    }
    for (const filename of [HHR_OLDER_NAME, HHR_NAME]) {
      assert.equal(
        JSON.parse(await readFile(path.join(rootDirectory, 'batter-hhr', 'captures', filename), 'utf8')).market,
        'batter-hhr',
      );
    }
  } finally {
    await rm(rootDirectory, { recursive: true, force: true });
  }
});

test('persistent display refresh fails closed instead of materializing a wrong-market capture', async () => {
  const rootDirectory = await mkdtemp(path.join(os.tmpdir(), 'mlb-display-refresh-fail-'));
  const badHits = envelope('batter-hhr', HITS_NAME);
  const bundle = {
    deliveryVersion: 1,
    displayDateUtc: '2026-08-28',
    capturedAt: '2026-08-28T16:38:41.701Z',
    archives: [
      { ...badHits, market: 'batter-hits' },
      envelope('batter-hhr', HHR_NAME),
    ],
    categoryPerformance: null,
  };
  try {
    const service = createReplitDisplayDeliveryService({ rootDirectory, store: storeFor(bundle) });
    await assert.rejects(
      service.refreshFromStore(),
      (error: unknown) => error instanceof InvalidDisplayDeliveryBundleError,
    );
  } finally {
    await rm(rootDirectory, { recursive: true, force: true });
  }
});
