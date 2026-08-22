import assert from 'node:assert/strict';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { verifyDeploymentDisplayFreshness } from '../scripts/verify-deployment-display-freshness.mjs';

const NOW = new Date('2026-08-22T15:15:00.000Z');

function filename(capturedAt, fill) {
  const stamp = capturedAt.replace(/[-:.]/gu, '');
  return `${stamp}--${fill.repeat(64)}.json`;
}

async function writeArchive(root, market, capturedAt, fill = 'a') {
  const directory = path.join(root, market, 'captures');
  await mkdir(directory, { recursive: true });
  const name = filename(capturedAt, fill);
  const body = {
    displayArchiveVersion: 1,
    displayArchiveContract: 'phase1-trimmed-board-display-v1',
    market,
    productionEnabled: false,
    productionRankingEnabled: false,
    capturedAt,
    rows: [{ providerGameId: 1 }],
  };
  await writeFile(path.join(directory, name), `${JSON.stringify(body)}\n`);
  return name;
}

test('deployment freshness accepts one current same-capture Hits/HHR pair', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'mlb-display-freshness-'));
  try {
    const capturedAt = '2026-08-22T14:32:06.201Z';
    await writeArchive(root, 'batter-hits', capturedAt, 'a');
    await writeArchive(root, 'batter-hhr', capturedAt, 'b');

    const result = await verifyDeploymentDisplayFreshness({ rootDirectory: root, now: NOW });
    assert.equal(result.slateDate, '2026-08-22');
    assert.equal(result.capturedAt, capturedAt);
    assert.equal(result.archives.length, 2);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('deployment freshness rejects a stale shipped display pair', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'mlb-display-freshness-'));
  try {
    const capturedAt = '2026-08-19T23:46:52.710Z';
    await writeArchive(root, 'batter-hits', capturedAt, 'a');
    await writeArchive(root, 'batter-hhr', capturedAt, 'b');

    await assert.rejects(
      verifyDeploymentDisplayFreshness({ rootDirectory: root, now: NOW }),
      /Deployment blocked: newest shipped batter-hits display archive is stale/u,
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('deployment freshness rejects current Hits/HHR archives from different captures', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'mlb-display-freshness-'));
  try {
    await writeArchive(root, 'batter-hits', '2026-08-22T14:32:06.201Z', 'a');
    await writeArchive(root, 'batter-hhr', '2026-08-22T14:33:06.201Z', 'b');

    await assert.rejects(
      verifyDeploymentDisplayFreshness({ rootDirectory: root, now: NOW }),
      /do not share one capture timestamp/u,
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('deployment freshness rejects a missing shipped market', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'mlb-display-freshness-'));
  try {
    await writeArchive(root, 'batter-hits', '2026-08-22T14:32:06.201Z', 'a');

    await assert.rejects(
      verifyDeploymentDisplayFreshness({ rootDirectory: root, now: NOW }),
      /no shipped batter-hhr capture directory/u,
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
