import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import {
  createReplitDisplayDeliveryService,
  type TextObjectStore,
} from '../src/adapters/index.js';

const CAPTURED_AT = '2026-08-28T22:00:00.000Z';
const PREFIX = '20260828T220000000Z';
const SOURCE_SHA = '3'.repeat(64);
const PERFORMANCE_NAME = `product-category-performance-v1--${SOURCE_SHA}.json`;

function archiveEnvelope(market: 'batter-hits' | 'batter-hhr', hashCharacter: string) {
  const filename = `${PREFIX}--${hashCharacter.repeat(64)}.json`;
  const bytes = Buffer.from(JSON.stringify({
    displayArchiveVersion: 1,
    displayArchiveContract: 'phase1-trimmed-board-display-v1',
    market,
    captureKey: filename.slice(0, -'.json'.length),
    capturedAt: CAPTURED_AT,
    captureDateUtc: '2026-08-28',
    productionEnabled: false,
    productionRankingEnabled: false,
    rows: [{ rank: 1 }],
  }));
  return Object.freeze({
    market,
    filename,
    sha256: createHash('sha256').update(bytes).digest('hex'),
    bytesBase64: bytes.toString('base64'),
  });
}

function performanceEnvelope() {
  const bytes = Buffer.from(JSON.stringify({
    reportVersion: 1,
    reportType: 'product-category-performance-v1',
    generatedAt: '2026-08-28T22:05:00.000Z',
    sourceSetSha256: SOURCE_SHA,
    safety: {
      evidenceOnly: true,
      archivesModified: false,
      probabilitiesModified: false,
      rankingModified: false,
    },
  }));
  return Object.freeze({
    filename: PERFORMANCE_NAME,
    sha256: createHash('sha256').update(bytes).digest('hex'),
    bytesBase64: bytes.toString('base64'),
  });
}

test('persistent display refresh also materializes the active category W-L-V evidence report', async () => {
  const rootDirectory = await mkdtemp(path.join(os.tmpdir(), 'mlb-category-performance-refresh-'));
  const bundle = {
    deliveryVersion: 1,
    displayDateUtc: '2026-08-28',
    capturedAt: CAPTURED_AT,
    archives: [archiveEnvelope('batter-hits', '1'), archiveEnvelope('batter-hhr', '2')],
    categoryPerformance: performanceEnvelope(),
  };
  const store: TextObjectStore = Object.freeze({
    async downloadAsText() { return Object.freeze({ ok: true as const, value: JSON.stringify(bundle) }); },
    async uploadFromText() { return Object.freeze({ ok: true as const, value: null }); },
  });
  try {
    await createReplitDisplayDeliveryService({ rootDirectory, store }).refreshFromStore();
    const persisted = JSON.parse(
      await readFile(path.join(rootDirectory, 'category-performance', PERFORMANCE_NAME), 'utf8'),
    ) as { sourceSetSha256: string };
    assert.equal(persisted.sourceSetSha256, SOURCE_SHA);
  } finally {
    await rm(rootDirectory, { recursive: true, force: true });
  }
});
