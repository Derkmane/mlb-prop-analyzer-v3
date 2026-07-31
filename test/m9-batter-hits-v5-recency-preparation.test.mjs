import assert from 'node:assert/strict';
import test from 'node:test';

import {
  ensureM9BatterHitsV5RecencyArtifacts,
} from '../scripts/m9-batter-hits-v5-recency-preparation-utils.mjs';

const ROOT = 'artifacts/m9-batter-hits-v5-refit';
const DATASET = `${ROOT}/m9-batter-hits-v5-recency-evaluation-dataset-v1.json`;
const BENCHMARK = `${ROOT}/m9-batter-hits-v5-hit-benchmark-dataset-v1.json`;
const FIXED = `${ROOT}/m9-batter-hits-v5-hit-recency-evaluation-v1.json`;
const WALK = `${ROOT}/m9-batter-hits-v5-hit-recency-walk-forward-v1.json`;
const BENCHMARK_SHA = 'a'.repeat(64);

function reservation() {
  return {
    startDate: '2026-07-30',
    endDate: '2026-08-04',
    rowsIncluded: false,
  };
}

function benchmark() {
  return {
    benchmarkVersion: 1,
    benchmarkSha256: BENCHMARK_SHA,
    untouchedTestReservation: reservation(),
  };
}

function fixed(candidateId = 'uniform') {
  return {
    sourceBenchmarkSha256: BENCHMARK_SHA,
    selection: {
      selectedCandidate: { candidateId },
    },
    untouchedTestReservation: reservation(),
  };
}

function walkForward(candidateId = 'uniform') {
  return {
    sourceBenchmarkSha256: BENCHMARK_SHA,
    selection: {
      selectedCandidate: { candidateId },
    },
    folds: [{ validationDate: '2026-07-16' }, { validationDate: '2026-07-17' }],
    untouchedTestReservation: reservation(),
  };
}

test('generates the missing benchmark and both recency evaluations from the V5 recency dataset', async () => {
  const writes = [];
  let sourcePath = null;
  let fixedBenchmarkPath = null;
  let walkBenchmarkPath = null;

  const result = await ensureM9BatterHitsV5RecencyArtifacts({
    rootPath: ROOT,
    files: [DATASET],
    buildBenchmark: async ({ sourceDatasetPath }) => {
      sourcePath = sourceDatasetPath;
      return benchmark();
    },
    evaluateFixed: async ({ benchmarkPath }) => {
      fixedBenchmarkPath = benchmarkPath;
      return fixed();
    },
    evaluateWalkForward: async ({ benchmarkPath }) => {
      walkBenchmarkPath = benchmarkPath;
      return walkForward();
    },
    writeArtifact: async (outputPath, value) => {
      writes.push({ outputPath, value });
    },
  });

  assert.equal(result.generated, true);
  assert.equal(sourcePath, DATASET);
  assert.equal(fixedBenchmarkPath, BENCHMARK);
  assert.equal(walkBenchmarkPath, BENCHMARK);
  assert.deepEqual(
    writes.map((write) => write.outputPath).sort(),
    [BENCHMARK, FIXED, WALK].sort(),
  );
  assert.equal(result.selectedCandidateId, 'uniform');
  assert.equal(result.foldCount, 2);
});

test('reuses an already complete fixed and walk-forward recency pair', async () => {
  let called = false;

  const result = await ensureM9BatterHitsV5RecencyArtifacts({
    rootPath: ROOT,
    files: [BENCHMARK, FIXED, WALK],
    buildBenchmark: async () => {
      called = true;
      return benchmark();
    },
  });

  assert.equal(result.generated, false);
  assert.equal(result.benchmarkPath, BENCHMARK);
  assert.equal(result.fixedPath, FIXED);
  assert.equal(result.walkForwardPath, WALK);
  assert.equal(called, false);
});

test('fails closed when the V5 recency source dataset is unavailable', async () => {
  await assert.rejects(
    ensureM9BatterHitsV5RecencyArtifacts({
      rootPath: ROOT,
      files: [],
    }),
    /V5 recency evaluation dataset requires exactly one file/,
  );
});

test('rejects generated evidence that does not retain uniform recency', async () => {
  await assert.rejects(
    ensureM9BatterHitsV5RecencyArtifacts({
      rootPath: ROOT,
      files: [DATASET],
      buildBenchmark: async () => benchmark(),
      evaluateFixed: async () => fixed('half-life-30'),
      evaluateWalkForward: async () => walkForward('half-life-30'),
      writeArtifact: async () => {},
    }),
    /must select uniform/,
  );
});

test('rejects duplicate recency artifacts instead of selecting one arbitrarily', async () => {
  await assert.rejects(
    ensureM9BatterHitsV5RecencyArtifacts({
      rootPath: ROOT,
      files: [
        FIXED,
        `${ROOT}/duplicate-hit-recency-evaluation-v1.json`,
        WALK,
      ],
    }),
    /found 2/,
  );
});
