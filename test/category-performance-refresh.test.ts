import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { createCommittedDisplayArchiveRefresher } from '../src/adapters/index.js';

const HITS_NAME = '20260825T220000000Z--1111111111111111111111111111111111111111111111111111111111111111.json';
const HHR_NAME = '20260825T220000000Z--2222222222222222222222222222222222222222222222222222222222222222.json';
const SOURCE_SHA = '3'.repeat(64);
const PERFORMANCE_NAME = `product-category-performance-v1--${SOURCE_SHA}.json`;

function captureBytes(market: 'batter-hits' | 'batter-hhr', filename: string): string {
  return JSON.stringify({
    market,
    captureKey: filename.slice(0, -'.json'.length),
    productionEnabled: false,
    productionRankingEnabled: false,
  });
}

function performanceBytes(): string {
  return JSON.stringify({
    reportVersion: 1,
    reportType: 'product-category-performance-v1',
    sourceSetSha256: SOURCE_SHA,
    safety: {
      evidenceOnly: true,
      archivesModified: false,
      probabilitiesModified: false,
      rankingModified: false,
    },
  });
}

function response(body: unknown, status = 200) {
  const text = typeof body === 'string' ? body : JSON.stringify(body);
  return Object.freeze({
    ok: status >= 200 && status < 300,
    status,
    async json() { return JSON.parse(text) as unknown; },
    async text() { return text; },
  });
}

test('live display refresh also pulls the single active category W-L-V evidence report', async () => {
  const rootDirectory = await mkdtemp(path.join(os.tmpdir(), 'mlb-category-performance-refresh-'));
  const tree = {
    tree: [
      { path: `artifacts/display-archives/batter-hits/captures/${HITS_NAME}` },
      { path: `artifacts/display-archives/batter-hhr/captures/${HHR_NAME}` },
      { path: `artifacts/display-archives/category-performance/${PERFORMANCE_NAME}` },
    ],
  };
  const fetchImpl = async (url: string) => {
    if (url.startsWith('https://api.github.com/')) return response(tree);
    if (url.endsWith(HITS_NAME)) return response(captureBytes('batter-hits', HITS_NAME));
    if (url.endsWith(HHR_NAME)) return response(captureBytes('batter-hhr', HHR_NAME));
    if (url.endsWith(PERFORMANCE_NAME)) return response(performanceBytes());
    return response('not found', 404);
  };

  try {
    const refresh = createCommittedDisplayArchiveRefresher({
      rootDirectory,
      refreshIntervalMs: 0,
      fetchImpl,
    });
    await refresh();
    const persisted = JSON.parse(
      await readFile(path.join(rootDirectory, 'category-performance', PERFORMANCE_NAME), 'utf8'),
    ) as { sourceSetSha256: string };
    assert.equal(persisted.sourceSetSha256, SOURCE_SHA);
  } finally {
    await rm(rootDirectory, { recursive: true, force: true });
  }
});
