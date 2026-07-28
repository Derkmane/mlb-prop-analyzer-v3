import { execFileSync } from 'node:child_process';
import { readFile, rm, writeFile } from 'node:fs/promises';

const utilityPath = 'scripts/m8-hit-benchmark-dataset-utils.mjs';
const testPath = 'test/m8-hit-benchmark-dataset.test.mjs';
const helperPath = 'scripts/apply-m8-hit-benchmark-compound-label-evidence.mjs';

function replaceExactly(text, before, after, label) {
  const first = text.indexOf(before);
  if (first === -1) {
    throw new Error(`${label}: expected source text was not found.`);
  }
  if (text.indexOf(before, first + before.length) !== -1) {
    throw new Error(`${label}: expected source text was not unique.`);
  }
  return `${text.slice(0, first)}${after}${text.slice(first + before.length)}`;
}

function run(command, args, options = {}) {
  execFileSync(command, args, {
    cwd: process.cwd(),
    env: process.env,
    stdio: 'inherit',
    ...options,
  });
}

let utility = await readFile(utilityPath, 'utf8');
utility = replaceExactly(
  utility,
  `  'Double Play',\n  'Triple Play',\n]);\nconst EXCLUDED_UNRESOLVED_REASONS`,
  `  'Double Play',\n  'Triple Play',\n  'Strikeout Double Play',\n]);\nconst CONTEXT_REQUIRED_BASERUNNING_RESULTS = new Set([\n  'Caught Stealing 2B',\n]);\nconst EXCLUDED_UNRESOLVED_REASONS`,
  'add verified compound label sets',
);
utility = replaceExactly(
  utility,
  `  if (row.mappingStatus !== 'unresolved') {\n    throw new Error(\`${'${label}'} has unsupported mappingStatus: ${'${row.mappingStatus}'}.\`);\n  }\n  const reason = assertNonEmptyString(`,
  `  if (row.mappingStatus !== 'unresolved') {\n    throw new Error(\`${'${label}'} has unsupported mappingStatus: ${'${row.mappingStatus}'}.\`);\n  }\n  if (\n    row.unresolvedReason === 'context-required' &&\n    common.rawResult !== null &&\n    CONTEXT_REQUIRED_BASERUNNING_RESULTS.has(common.rawResult)\n  ) {\n    return Object.freeze({\n      ...common,\n      exclusionReason: 'context-required-baserunning-only',\n    });\n  }\n  const reason = assertNonEmptyString(`,
  'preserve context-required caught stealing as an exclusion',
);
utility = replaceExactly(
  utility,
  `    if (\n      row.mappingStatus === 'unresolved' &&\n      row.unresolvedReason === 'context-required'\n    ) {\n      observations.push(contextualNonHitObservation(row, common, label));\n      continue;\n    }`,
  `    if (\n      row.mappingStatus === 'unresolved' &&\n      row.unresolvedReason === 'context-required'\n    ) {\n      if (\n        common.rawResult !== null &&\n        CONTEXT_REQUIRED_BASERUNNING_RESULTS.has(common.rawResult)\n      ) {\n        exclusions.push(excludedObservation(row, common, label));\n      } else {\n        observations.push(contextualNonHitObservation(row, common, label));\n      }\n      continue;\n    }`,
  'route context-required evidence by verified event layer',
);
await writeFile(utilityPath, utility, 'utf8');

let test = await readFile(testPath, 'utf8');
test = replaceExactly(
  test,
  `test('maps only the five evidence-backed contextual result labels to binary No Hit without assigning a terminal category', async () => {`,
  `test('maps every evidence-backed contextual terminal result to binary No Hit without assigning a terminal category', async () => {`,
  'rename contextual terminal-label test',
);
test = replaceExactly(
  test,
  `      'Double Play',\n      'Triple Play',\n    ];`,
  `      'Double Play',\n      'Triple Play',\n      'Strikeout Double Play',\n    ];`,
  'add strikeout-double-play fixture',
);
test = replaceExactly(
  test,
  `    assert.equal(benchmark.periods.fit.contextualNonHitCount, 5);`,
  `    assert.equal(benchmark.periods.fit.contextualNonHitCount, 6);`,
  'update contextual terminal-label count',
);
test = replaceExactly(
  test,
  `test('fails closed when a context-required label is not evidence-backed as binary No Hit', async () => {`,
  `test('excludes context-required caught stealing as baserunning-only evidence', async () => {\n  await withTempRoot(async (root) => {\n    const sourceDatasetPath = await writeSourceDataset(root, {\n      fitRows: [\n        unresolvedRow({\n          rowId: '2026-03-26:10:1',\n          observedDate: '2026-03-26',\n          paNumber: 1,\n          result: 'Caught Stealing 2B',\n          reason: 'context-required',\n        }),\n      ],\n      validationRows: [\n        classifiedRow({\n          rowId: '2026-03-27:11:1',\n          observedDate: '2026-03-27',\n          paNumber: 1,\n          result: 'Single',\n          terminalCategory: '1B',\n        }),\n      ],\n    });\n\n    const benchmark = await buildM8HitBenchmarkDataset({ sourceDatasetPath });\n    assert.equal(benchmark.periods.fit.observationCount, 0);\n    assert.equal(benchmark.periods.fit.excludedCount, 1);\n    assert.equal(\n      benchmark.periods.fit.exclusions[0]?.exclusionReason,\n      'context-required-baserunning-only',\n    );\n  });\n});\n\ntest('fails closed when a context-required label is not evidence-backed as binary No Hit', async () => {`,
  'add caught-stealing exclusion regression test',
);
await writeFile(testPath, test, 'utf8');

console.log('=== FOCUSED M8 HIT BENCHMARK TESTS ===');
run('npm', ['run', 'test:m8-hit-benchmark-dataset']);

console.log('=== REAL M8 HIT BENCHMARK BUILD ===');
run('npm', ['run', 'build:m8-hit-benchmark-dataset'], {
  env: {
    ...process.env,
    M8_RECENCY_DATASET_PATH:
      'artifacts/m8-current-season-pa/m8-recency-evaluation-dataset-v2.json',
    M8_HIT_BENCHMARK_OUTPUT_PATH:
      'artifacts/m8-current-season-pa/m8-hit-benchmark-dataset-v1.json',
  },
});

await rm(helperPath);
run('git', [
  'add',
  utilityPath,
  testPath,
  helperPath,
]);
run('git', [
  'commit',
  '-m',
  'Handle compound M8 benchmark evidence labels',
]);
run('git', ['push', 'origin', 'HEAD']);

console.log('=== COMPOUND LABEL CORRECTION COMPLETE ===');
