import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { createCommittedDisplayArchiveRefresher } from '../src/adapters/index.js';

const HITS_NAME = '20260822T163841701Z--23da0de677b09f9b17d0889373f5ef64500fb1e816fdb0223db4a57050d73595.json';
const HHR_NAME = '20260822T163841701Z--3b90f841132d603f4e7437b041864b1c12ff39fdcaba3a484ae436c705060093.json';

function archiveBytes(market: 'batter-hits' | 'batter-hhr', filename: string): string {
  return JSON.stringify({
    market,
    captureKey: filename.slice(0, -'.json'.length),
    productionEnabled: false,
    productionRankingEnabled: false,
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

test('live display refresh pulls the newest committed Hits and HHR captures into the local read cache', async () => {
  const rootDirectory = await mkdtemp(path.join(os.tmpdir(), 'mlb-display-refresh-'));
  const requests: string[] = [];
  const tree = {
    tree: [
      { path: `artifacts/display-archives/batter-hits/captures/${HITS_NAME}` },
      { path: `artifacts/display-archives/batter-hhr/captures/${HHR_NAME}` },
    ],
  };
  const fetchImpl = async (url: string) => {
    requests.push(url);
    if (url.startsWith('https://api.github.com/')) return response(tree);
    if (url.endsWith(HITS_NAME)) return response(archiveBytes('batter-hits', HITS_NAME));
    if (url.endsWith(HHR_NAME)) return response(archiveBytes('batter-hhr', HHR_NAME));
    return response('not found', 404);
  };

  try {
    const refresh = createCommittedDisplayArchiveRefresher({
      rootDirectory,
      refreshIntervalMs: 60_000,
      fetchImpl,
    });
    await refresh();
    await refresh();

    assert.equal(requests.filter((url) => url.startsWith('https://api.github.com/')).length, 1);
    assert.equal(requests.length, 3);
    assert.equal(
      JSON.parse(await readFile(path.join(rootDirectory, 'batter-hits', 'captures', HITS_NAME), 'utf8')).market,
      'batter-hits',
    );
    assert.equal(
      JSON.parse(await readFile(path.join(rootDirectory, 'batter-hhr', 'captures', HHR_NAME), 'utf8')).market,
      'batter-hhr',
    );
  } finally {
    await rm(rootDirectory, { recursive: true, force: true });
  }
});

test('live display refresh fails closed instead of serving an invented or wrong-market capture', async () => {
  const rootDirectory = await mkdtemp(path.join(os.tmpdir(), 'mlb-display-refresh-fail-'));
  const tree = {
    tree: [
      { path: `artifacts/display-archives/batter-hits/captures/${HITS_NAME}` },
      { path: `artifacts/display-archives/batter-hhr/captures/${HHR_NAME}` },
    ],
  };
  const fetchImpl = async (url: string) => {
    if (url.startsWith('https://api.github.com/')) return response(tree);
    if (url.endsWith(HITS_NAME)) return response(archiveBytes('batter-hhr', HITS_NAME));
    if (url.endsWith(HHR_NAME)) return response(archiveBytes('batter-hhr', HHR_NAME));
    return response('not found', 404);
  };

  try {
    const refresh = createCommittedDisplayArchiveRefresher({
      rootDirectory,
      refreshIntervalMs: 0,
      fetchImpl,
    });
    await assert.rejects(
      refresh(),
      /Newest committed batter-hits display archive has the wrong market identity/u,
    );
  } finally {
    await rm(rootDirectory, { recursive: true, force: true });
  }
});
