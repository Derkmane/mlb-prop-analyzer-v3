import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';

import {
  parseSavedRunSnapshotV1,
  serializeSavedRunSnapshotV1,
} from '../src/domain/saved-run.js';
import { renderHistoricalSavedRunV1 } from '../src/historical/index.js';
import { createM10SavedRunFixture } from './helpers/m10-saved-run-fixture.js';

test('a complete saved run renders after its active feature implementation is absent', () => {
  const source = readFileSync(
    path.resolve('src/historical/render-saved-run.ts'),
    'utf8',
  );
  assert.doesNotMatch(source, /src\/features|\.\.\/features|features\//u);
  assert.doesNotMatch(source, /batter-hits\/index|featureData\.values/u);

  const saved = createM10SavedRunFixture();
  const loaded = parseSavedRunSnapshotV1(
    serializeSavedRunSnapshotV1(saved),
  );
  const view = renderHistoricalSavedRunV1(loaded);

  assert.equal(view.status, 'historical');
  assert.equal(view.runId, 'm10-historical-run-20260805');
  assert.equal(view.productionEnabled, false);
  assert.equal(view.rankingEnabled, false);
  assert.deepEqual(
    view.categories.map((category) => category.categoryId),
    [
      'opportunity-miner-favorites',
      'high-probability-baseline-props',
      'high-probability-altline-props',
    ],
  );
  assert.ok(
    view.categories.every(
      (category) => category.picks[0]!.status === 'historical',
    ),
  );
  assert.ok(
    view.categories.every(
      (category) =>
        category.picks[0]!.featureId ===
          'removed-batter-hits-feature-v99' &&
        category.picks[0]!.featureSchemaVersion === 99,
    ),
  );
  assert.equal(
    view.categories[0]!.picks[0]!.providerPlayerId,
    view.categories[1]!.picks[0]!.providerPlayerId,
  );
  assert.ok(Object.isFrozen(view));
  assert.ok(Object.isFrozen(view.categories));
  assert.ok(Object.isFrozen(view.categories[0]!.picks));
});

test('historical rendering preserves exact identities, sides, probabilities, and diagnostic labels', () => {
  const saved = createM10SavedRunFixture();
  const view = renderHistoricalSavedRunV1(saved);

  view.categories.forEach((category, categoryIndex) => {
    const sourceCategory = saved.categories[categoryIndex];
    assert.ok(sourceCategory);
    category.picks.forEach((pick, pickIndex) => {
      const sourcePick = sourceCategory.picks[pickIndex];
      assert.ok(sourcePick);
      assert.equal(pick.snapshotId, sourcePick.snapshotId);
      assert.equal(pick.providerEventId, sourcePick.providerEventId);
      assert.equal(pick.providerGameId, sourcePick.providerGameId);
      assert.equal(pick.providerPlayerId, sourcePick.providerPlayerId);
      assert.equal(pick.selectedSide, sourcePick.selectedSide);
      assert.equal(pick.line, sourcePick.line);
      assert.equal(pick.pWin, sourcePick.pWin);
      assert.equal(pick.pLoss, sourcePick.pLoss);
      assert.equal(pick.pVoid, sourcePick.pVoid);
      assert.equal(pick.pWinGivenGrades, sourcePick.pWinGivenGrades);
      assert.equal(
        pick.pBaseWinGivenGrades,
        sourcePick.baseProbabilities.pWinGivenGrades,
      );
      assert.equal(
        pick.contextProbabilityDelta,
        sourcePick.context.probabilityDelta,
      );
      assert.equal(pick.priceEdgeLabel, 'DIAGNOSTIC ONLY');
      assert.equal(pick.priceEdge, sourcePick.priceDiagnostics.priceEdge);
    });
  });

  process.stdout.write('\n--- M10 HISTORICAL SAVED RUN OUTPUT ---\n');
  process.stdout.write(`RUN ID: ${view.runId}\n`);
  process.stdout.write(`STATUS: ${view.status}\n`);
  process.stdout.write('ACTIVE FEATURE IMPORTS: 0\n');
  process.stdout.write(`FEATURE ID: ${view.categories[0]!.picks[0]!.featureId}\n`);
  process.stdout.write(`FEATURE SCHEMA: ${view.categories[0]!.picks[0]!.featureSchemaVersion}\n`);
  for (const category of view.categories) {
    for (const pick of category.picks) {
      process.stdout.write(
        `${category.categoryId}\t${pick.categoryRank}\t${pick.playerName}\t${pick.selectedSide}\t${pick.line}\t${pick.pWinGivenGrades}\t${pick.pVoid}\n`,
      );
    }
  }
  process.stdout.write('PRODUCTION: DISABLED\n');
  process.stdout.write('RANKING: DISABLED\n');
  process.stdout.write('--- END M10 HISTORICAL SAVED RUN OUTPUT ---\n');
});
