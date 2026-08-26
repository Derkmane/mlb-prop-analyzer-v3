import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import {
  createProductCategoryPerformanceRepository,
} from '../src/adapters/index.js';
import {
  HIGH_PROBABILITY_ALTLINE_CATEGORY_ID,
  HIGH_PROBABILITY_BASELINE_CATEGORY_ID,
  OPPORTUNITY_MINER_CATEGORY_ID,
} from '../src/categories/index.js';

const SOURCE_SHA = 'a'.repeat(64);

function summary(wins: number, losses: number, voids: number) {
  const decidedPicks = wins + losses;
  return {
    gradedPicks: decidedPicks + voids,
    wins,
    losses,
    voids,
    decidedPicks,
    winRate: decidedPicks === 0 ? null : wins / decidedPicks,
  };
}

function report() {
  return {
    reportVersion: 1,
    reportType: 'product-category-performance-v1',
    generatedAt: '2026-08-26T09:05:00.000Z',
    productDisplayBoardVersion: 'three-category-research-product-v4',
    sourceSetSha256: SOURCE_SHA,
    pairedCapturesIncluded: 4,
    firstCaptureAt: '2026-08-24T18:00:00.000Z',
    lastCaptureAt: '2026-08-25T22:00:00.000Z',
    categories: {
      [OPPORTUNITY_MINER_CATEGORY_ID]: summary(5, 2, 0),
      [HIGH_PROBABILITY_BASELINE_CATEGORY_ID]: summary(7, 3, 1),
      [HIGH_PROBABILITY_ALTLINE_CATEGORY_ID]: summary(4, 4, 0),
    },
    safety: {
      evidenceOnly: true,
      archivesModified: false,
      probabilitiesModified: false,
      rankingModified: false,
    },
  };
}

test('category performance repository returns one validated W-L-V summary for every product category', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'category-performance-'));
  try {
    await writeFile(
      path.join(root, `product-category-performance-v1--${SOURCE_SHA}.json`),
      `${JSON.stringify(report(), null, 2)}\n`,
      'utf8',
    );
    const repository = createProductCategoryPerformanceRepository({ rootDirectory: root });
    const evidence = await repository.readLatest();
    assert.ok(evidence);
    assert.deepEqual(evidence.categories[OPPORTUNITY_MINER_CATEGORY_ID], summary(5, 2, 0));
    assert.deepEqual(evidence.categories[HIGH_PROBABILITY_BASELINE_CATEGORY_ID], summary(7, 3, 1));
    assert.deepEqual(evidence.categories[HIGH_PROBABILITY_ALTLINE_CATEGORY_ID], summary(4, 4, 0));
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('category performance repository rejects a win rate or W-L-V total that does not reconcile', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'category-performance-invalid-'));
  try {
    const invalid = report();
    invalid.categories[HIGH_PROBABILITY_ALTLINE_CATEGORY_ID] = {
      gradedPicks: 8,
      wins: 4,
      losses: 4,
      voids: 0,
      decidedPicks: 7,
      winRate: 0.5,
    };
    await writeFile(
      path.join(root, `product-category-performance-v1--${SOURCE_SHA}.json`),
      `${JSON.stringify(invalid, null, 2)}\n`,
      'utf8',
    );
    const repository = createProductCategoryPerformanceRepository({ rootDirectory: root });
    await assert.rejects(repository.readLatest(), /count totals do not reconcile/u);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
