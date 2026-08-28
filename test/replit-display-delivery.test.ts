import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';

import {
  createReplitDisplayDeliveryService,
  InvalidDisplayDeliveryBundleError,
  REPLIT_DISPLAY_BUNDLE_OBJECT,
  type DisplayDeliveryArchiveV1,
  type DisplayDeliveryBundleV1,
  type DisplayDeliveryMarket,
  type TextObjectStore,
  type TextObjectStoreResult,
} from '../src/adapters/index.js';

class MemoryTextStore implements TextObjectStore {
  public text: string | null = null;
  public lastObjectName: string | null = null;

  async downloadAsText(objectName: string): Promise<TextObjectStoreResult<string>> {
    this.lastObjectName = objectName;
    return this.text === null
      ? Object.freeze({ ok: false, error: new Error('missing object') })
      : Object.freeze({ ok: true, value: this.text });
  }

  async uploadFromText(objectName: string, contents: string): Promise<TextObjectStoreResult<null>> {
    this.lastObjectName = objectName;
    this.text = contents;
    return Object.freeze({ ok: true, value: null });
  }
}

function capturePrefix(capturedAt: string): string {
  return capturedAt.replaceAll('-', '').replaceAll(':', '').replace('.', '');
}

function archiveEnvelope(
  market: DisplayDeliveryMarket,
  capturedAt: string,
  hashCharacter: string,
): Readonly<{ envelope: DisplayDeliveryArchiveV1; bytes: Buffer }> {
  const filename = `${capturePrefix(capturedAt)}--${hashCharacter.repeat(64)}.json`;
  const captureKey = filename.slice(0, -'.json'.length);
  const bytes = Buffer.from(JSON.stringify({
    displayArchiveVersion: 1,
    displayArchiveContract: 'phase1-trimmed-board-display-v1',
    market,
    captureKey,
    capturedAt,
    captureDateUtc: capturedAt.slice(0, 10),
    productionEnabled: false,
    productionRankingEnabled: false,
    rows: [{ rank: 1 }],
  }), 'utf8');
  return Object.freeze({
    bytes,
    envelope: Object.freeze({
      market,
      filename,
      sha256: createHash('sha256').update(bytes).digest('hex'),
      bytesBase64: bytes.toString('base64'),
    }),
  });
}

function validBundle(capturedAt = '2026-08-28T18:30:00.000Z'): Readonly<{
  bundle: DisplayDeliveryBundleV1;
  hits: ReturnType<typeof archiveEnvelope>;
  hhr: ReturnType<typeof archiveEnvelope>;
}> {
  const hits = archiveEnvelope('batter-hits', capturedAt, 'a');
  const hhr = archiveEnvelope('batter-hhr', capturedAt, 'b');
  const bundle: DisplayDeliveryBundleV1 = Object.freeze({
    deliveryVersion: 1,
    displayDateUtc: capturedAt.slice(0, 10),
    capturedAt,
    archives: Object.freeze([hits.envelope, hhr.envelope]),
    categoryPerformance: null,
  });
  return Object.freeze({ hits, hhr, bundle });
}

test('persistent display delivery stores one current-day bundle and materializes exact market bytes', async () => {
  const firstRoot = await mkdtemp(path.join(tmpdir(), 'mlb-display-delivery-first-'));
  const secondRoot = await mkdtemp(path.join(tmpdir(), 'mlb-display-delivery-second-'));
  const store = new MemoryTextStore();
  const { bundle, hits, hhr } = validBundle();
  try {
    const first = createReplitDisplayDeliveryService({ store, rootDirectory: firstRoot });
    const delivered = await first.deliver(bundle);
    assert.equal(delivered.capturedAt, bundle.capturedAt);
    assert.equal(store.lastObjectName, REPLIT_DISPLAY_BUNDLE_OBJECT);
    assert.ok(store.text !== null);
    assert.deepEqual(JSON.parse(store.text) as unknown, bundle);
    assert.deepEqual(
      await readFile(path.join(firstRoot, 'batter-hits', 'captures', hits.envelope.filename)),
      hits.bytes,
    );
    assert.deepEqual(
      await readFile(path.join(firstRoot, 'batter-hhr', 'captures', hhr.envelope.filename)),
      hhr.bytes,
    );

    const second = createReplitDisplayDeliveryService({ store, rootDirectory: secondRoot });
    const refreshed = await second.refreshFromStore();
    assert.equal(refreshed.capturedAt, bundle.capturedAt);
    assert.deepEqual(
      await readFile(path.join(secondRoot, 'batter-hits', 'captures', hits.envelope.filename)),
      hits.bytes,
    );
    assert.deepEqual(
      await readFile(path.join(secondRoot, 'batter-hhr', 'captures', hhr.envelope.filename)),
      hhr.bytes,
    );
  } finally {
    await Promise.all([
      rm(firstRoot, { recursive: true, force: true }),
      rm(secondRoot, { recursive: true, force: true }),
    ]);
  }
});

test('persistent display delivery rejects a tampered archive before storage or materialization', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'mlb-display-delivery-tampered-'));
  const store = new MemoryTextStore();
  const { bundle } = validBundle();
  const tampered = {
    ...bundle,
    archives: [
      { ...bundle.archives[0]!, sha256: '0'.repeat(64) },
      bundle.archives[1],
    ],
  };
  try {
    const service = createReplitDisplayDeliveryService({ store, rootDirectory: root });
    await assert.rejects(
      service.deliver(tampered),
      (error: unknown) => error instanceof InvalidDisplayDeliveryBundleError,
    );
    assert.equal(store.text, null);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('persistent display delivery rejects missing-market and mismatched newest timestamps', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'mlb-display-delivery-identity-'));
  const store = new MemoryTextStore();
  const { bundle, hits } = validBundle();
  const other = archiveEnvelope('batter-hhr', '2026-08-28T18:31:00.000Z', 'c');
  const service = createReplitDisplayDeliveryService({ store, rootDirectory: root });
  try {
    await assert.rejects(
      service.deliver({ ...bundle, archives: [hits.envelope] }),
      (error: unknown) => error instanceof InvalidDisplayDeliveryBundleError,
    );
    await assert.rejects(
      service.deliver({ ...bundle, archives: [hits.envelope, other.envelope] }),
      (error: unknown) => error instanceof InvalidDisplayDeliveryBundleError,
    );
    assert.equal(store.text, null);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
