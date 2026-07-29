import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

test('starter retention gate hashes the exact persisted dataset bytes', () => {
  const source = readFileSync(
    'scripts/run-m8-starter-retention-gate.mjs',
    'utf8',
  );

  assert.match(
    source,
    /const datasetText = JSON\.stringify\(dataset, null, 2\);/,
  );
  assert.match(
    source,
    /await writeTextAtomic\(datasetPath, datasetText\);/,
  );
  assert.match(
    source,
    /if \(persistedDataset\.text !== datasetText\)/,
  );
  assert.match(
    source,
    /datasetText: persistedDataset\.text/,
  );
  assert.match(
    source,
    /datasetFileSha256: sha256\(persistedDataset\.text\)/,
  );
  assert.doesNotMatch(
    source,
    /writeJsonAtomic\(datasetPath, dataset\)/,
  );
});
