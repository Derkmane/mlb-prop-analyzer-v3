import assert from 'node:assert/strict';
import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';

import {
  persistImmutableSavedRunV1,
  readImmutableSavedRunV1,
  savedRunFilePath,
} from '../src/adapters/index.js';
import {
  createSavedRunSnapshotV1,
  SAVED_RUN_CATEGORY_IDS,
  SAVED_RUN_SCHEMA_VERSION,
  serializeSavedRunSnapshotV1,
  type SavedRunCategoryId,
  type SavedRunPickSnapshotV1,
  type SavedRunSnapshotV1,
} from '../src/domain/saved-run.js';

type DeepMutable<T> = T extends readonly (infer TItem)[]
  ? DeepMutable<TItem>[]
  : T extends object
    ? { -readonly [TKey in keyof T]: DeepMutable<T[TKey]> }
    : T;

const SNAPSHOT_ID = 'odds-archive-20260805';
const SNAPSHOT_SHA = 'a'.repeat(64);

function pick(
  categoryId: SavedRunCategoryId,
  categoryRank: number,
  identity: number,
): DeepMutable<SavedRunPickSnapshotV1> {
  const baseFinal = 0.58 + identity * 0.001;
  const final = baseFinal + 0.01;
  return {
    snapshotId: `${categoryId}-${identity}`,
    categoryId,
    categoryRank,
    eventId: `event-${identity}`,
    gameId: String(5059000 + identity),
    providerEventId: `provider-event-${identity}`,
    providerGameId: 5059000 + identity,
    playerId: String(1000 + identity),
    providerPlayerId: 1000 + identity,
    playerName: `Player ${identity}`,
    baseMarketKey: 'batter-hits',
    marketLabel: 'Batter Hits',
    offerType:
      categoryId === 'high-probability-baseline-props'
        ? 'baseline'
        : 'alternate',
    line: 0.5,
    selectedSide: identity % 2 === 0 ? 'lower' : 'higher',
    settlementStatistic: 'hits',
    marketTimestamp: '2026-08-05T16:00:00.000Z',
    generatedAt: '2026-08-05T16:02:17.812Z',
    eligibilityProbability: 1,
    pWin: final,
    pLoss: 1 - final,
    pVoid: 0,
    pWinGivenGrades: final,
    modelVersion: 'm8-5-batter-hits-successor-freeze-v1',
    distributionBuilderVersion: 'm9-batter-hits-runtime-distribution-v1',
    settlementRuleVersion: 'batter-hits-settlement-v1',
    modelArtifactVersions: {
      batterHitsBase: 'm8-batter-hits-complete-candidate-v1',
      gameContext: 'm8-5-game-offensive-environment-v1',
    },
    providerSnapshotIds: [SNAPSHOT_ID],
    scenarioWeights: [{ scenarioId: 'scenario-1', weight: 1 }],
    opportunityDistribution: { probabilities: [0, 0, 0, 1] },
    baseStatisticDistribution: {
      probabilities: [1 - baseFinal, baseFinal],
    },
    baseProbabilities: {
      pWin: baseFinal,
      pLoss: 1 - baseFinal,
      pVoid: 0,
      pWinGivenGrades: baseFinal,
    },
    discovery: null,
    finalStatisticDistribution: {
      probabilities: [1 - final, final],
    },
    context: {
      modelVersion: 'm8-5-game-offensive-environment-v1',
      factorArtifactVersions: {
        park: 'm8-5-park-frozen-artifact-v1',
        bullpen: 'm8-5-team-bullpen-frozen-artifact-v1',
      },
      probabilityDelta: 0.01,
    },
    priceDiagnostics: {
      label: 'DIAGNOSTIC ONLY',
      americanPrice: -110,
      multiplier: 1,
      postedImpliedProbability: 110 / 210,
      priceEdge: final - 110 / 210,
    },
    featureData: {
      featureId: 'batter-hits',
      schemaVersion: 2,
      values: {
        preservedOnlyForHistory: true,
        exactProviderGameId: 5059000 + identity,
      },
    },
  };
}

function run(
  runId = 'm10-run-20260805-160217812',
): DeepMutable<SavedRunSnapshotV1> {
  return {
    schemaVersion: SAVED_RUN_SCHEMA_VERSION,
    runId,
    savedAt: '2026-08-05T16:02:18.000Z',
    generatedAt: '2026-08-05T16:02:17.812Z',
    slateDate: '2026-08-05',
    projectRulesVersion: '2.9',
    mathSpecVersion: '1.7',
    normalizedDataVersion: 'm9-normalized-board-v1',
    configurationVersion: 'm10-category-configuration-v1',
    settlementRegistryVersion: 'settlement-registry-v1',
    productionEnabled: false,
    rankingEnabled: false,
    providerSnapshots: [
      {
        provider: 'the-odds-api',
        snapshotId: SNAPSHOT_ID,
        sha256: SNAPSHOT_SHA,
      },
    ],
    categories: SAVED_RUN_CATEGORY_IDS.map((categoryId, index) => ({
      categoryId,
      picks: [pick(categoryId, 1, index + 1)],
    })),
  };
}

test('saved run preserves complete immutable lineage for every category pick', () => {
  const source = run();
  const saved = createSavedRunSnapshotV1(source);

  source.providerSnapshots[0]!.snapshotId = 'mutated';
  source.categories[0]!.picks[0]!.context.factorArtifactVersions['park'] =
    'mutated';
  source.categories[0]!.picks[0]!.featureData.values[
    'preservedOnlyForHistory'
  ] = false;

  assert.equal(saved.providerSnapshots[0]!.snapshotId, SNAPSHOT_ID);
  assert.equal(
    saved.categories[0]!.picks[0]!.context.factorArtifactVersions['park'],
    'm8-5-park-frozen-artifact-v1',
  );
  assert.equal(
    saved.categories[0]!.picks[0]!.featureData.values[
      'preservedOnlyForHistory'
    ],
    true,
  );
  assert.ok(Object.isFrozen(saved));
  assert.ok(Object.isFrozen(saved.categories));
  assert.ok(
    Object.isFrozen(
      saved.categories[0]!.picks[0]!.finalStatisticDistribution,
    ),
  );
  assert.deepEqual(
    saved.categories.map((category) => category.categoryId),
    [...SAVED_RUN_CATEGORY_IDS],
  );
});

test('saved-run validation fails closed on missing lineage, unknown evidence, and category duplicates', () => {
  const missingProvider = run('missing-provider');
  missingProvider.categories[0]!.picks[0]!.providerSnapshotIds[0] = 'unknown';
  assert.throws(
    () => createSavedRunSnapshotV1(missingProvider),
    /unknown provider snapshot/u,
  );

  const driftedDelta = run('drifted-delta');
  driftedDelta.categories[0]!.picks[0]!.context.probabilityDelta = 0.2;
  assert.throws(
    () => createSavedRunSnapshotV1(driftedDelta),
    /final minus base/u,
  );

  const duplicatePlayer = run('duplicate-player');
  const first = duplicatePlayer.categories[0]!.picks[0]!;
  duplicatePlayer.categories[0]!.picks = [
    first,
    { ...first, snapshotId: 'second', categoryRank: 2 },
  ];
  assert.throws(
    () => createSavedRunSnapshotV1(duplicatePlayer),
    /one prop per player/u,
  );
});

test('atomic persistence publishes exact bytes, refuses overwrite, and leaves no temporary file', async () => {
  const rootDirectory = await mkdtemp(path.join(tmpdir(), 'm10-saved-run-'));
  try {
    const saved = createSavedRunSnapshotV1(run());
    const result = await persistImmutableSavedRunV1({
      rootDirectory,
      run: saved,
    });
    const expectedPath = savedRunFilePath(rootDirectory, saved.runId);
    const persistedText = await readFile(expectedPath, 'utf8');
    const loaded = await readImmutableSavedRunV1(expectedPath);

    assert.equal(result.filePath, expectedPath);
    assert.equal(persistedText, serializeSavedRunSnapshotV1(saved));
    assert.deepEqual(loaded, saved);
    assert.ok(Object.isFrozen(loaded));
    await assert.rejects(
      persistImmutableSavedRunV1({ rootDirectory, run: saved }),
      /overwrite refused/u,
    );
    const names = await readdir(path.dirname(expectedPath));
    assert.deepEqual(names, [`${saved.runId}.json`]);

    process.stdout.write('\n--- M10 SAVED RUN STORAGE OUTPUT ---\n');
    process.stdout.write(`RUN ID: ${result.runId}\n`);
    process.stdout.write(`FILE: runs/${saved.runId}.json\n`);
    process.stdout.write(`BYTE LENGTH: ${result.byteLength}\n`);
    process.stdout.write(`FILE SHA-256: ${result.fileSha256}\n`);
    process.stdout.write(`CATEGORIES: ${saved.categories.length}\n`);
    process.stdout.write(
      `PICKS: ${saved.categories.reduce(
        (sum, category) => sum + category.picks.length,
        0,
      )}\n`,
    );
    process.stdout.write('LINEAGE: COMPLETE\n');
    process.stdout.write('ATOMIC OVERWRITE: REFUSED\n');
    process.stdout.write('TEMP FILES: 0\n');
    process.stdout.write('PRODUCTION: DISABLED\n');
    process.stdout.write('RANKING: DISABLED\n');
    process.stdout.write('--- END M10 SAVED RUN STORAGE OUTPUT ---\n');
  } finally {
    await rm(rootDirectory, { recursive: true, force: true });
  }
});

test('two distinct saved-run identities persist independently', async () => {
  const rootDirectory = await mkdtemp(path.join(tmpdir(), 'm10-saved-runs-'));
  try {
    const first = createSavedRunSnapshotV1(run('run-one'));
    const second = createSavedRunSnapshotV1(run('run-two'));
    await persistImmutableSavedRunV1({ rootDirectory, run: first });
    await persistImmutableSavedRunV1({ rootDirectory, run: second });
    const names = await readdir(path.join(rootDirectory, 'runs'));
    assert.deepEqual(names.sort(), ['run-one.json', 'run-two.json']);
  } finally {
    await rm(rootDirectory, { recursive: true, force: true });
  }
});
