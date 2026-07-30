import { readFile } from 'node:fs/promises';

import { buildM8RecencyEvaluationDataset } from './m8-recency-evaluation-dataset-utils.mjs';
import {
  buildM9BatterHitsV5RecencyPartitionAdapter,
  verifyM9BatterHitsV5RecencyPartitionAdapter,
} from './m9-batter-hits-v5-recency-partition-adapter-utils.mjs';
import { sha256, writeJsonAtomic } from './provider-probe-utils.mjs';

const SOURCE_PARTITION_PATH =
  process.env.M9_V5_SOURCE_PARTITION_PATH?.trim() ||
  'artifacts/m8-current-season-pa/m8-chronological-partition-v1.json';
const V5_PARTITION_PATH =
  process.env.M9_V5_REFIT_PARTITION_PATH?.trim() ||
  'artifacts/m9-batter-hits-v5-refit/m9-batter-hits-v5-refit-partition-v1.json';
const ADAPTER_PATH =
  process.env.M9_V5_RECENCY_ADAPTER_OUTPUT_PATH?.trim() ||
  'artifacts/m9-batter-hits-v5-refit/m9-batter-hits-v5-recency-partition-adapter-v1.json';
const COMPATIBILITY_PATH =
  process.env.M9_V5_RECENCY_COMPATIBILITY_OUTPUT_PATH?.trim() ||
  'artifacts/m9-batter-hits-v5-refit/m9-batter-hits-v5-recency-compatibility-partition-v1.json';
const DATASET_PATH =
  process.env.M9_V5_RECENCY_DATASET_OUTPUT_PATH?.trim() ||
  'artifacts/m9-batter-hits-v5-refit/m9-batter-hits-v5-recency-evaluation-dataset-v1.json';

async function readJson(filePath, label = filePath) {
  let text;
  try {
    text = await readFile(filePath, 'utf8');
  } catch (error) {
    throw new Error(
      `${label} could not be read: ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
  }
  try {
    return { text, value: JSON.parse(text) };
  } catch {
    throw new Error(`${label} is not valid JSON.`);
  }
}

async function writeOrVerify(filePath, value, label) {
  try {
    const existing = await readJson(filePath, label);
    if (JSON.stringify(existing.value) !== JSON.stringify(value)) {
      throw new Error(`${label} already exists with different content.`);
    }
    return 'verified-existing';
  } catch (error) {
    if (!String(error?.message ?? error).includes('ENOENT')) {
      throw error;
    }
  }
  await writeJsonAtomic(filePath, value);
  const persisted = await readJson(filePath, label);
  if (JSON.stringify(persisted.value) !== JSON.stringify(value)) {
    throw new Error(`${label} changed after atomic persistence.`);
  }
  return 'written';
}

function datasetIdentity(value) {
  return {
    activeSeason: value.activeSeason,
    sourcePartitionSha256: value.sourcePartitionSha256,
    sourceEvidenceSetSha256: value.sourceEvidenceSetSha256,
    periods: value.periods,
    untouchedTestReservation: value.untouchedTestReservation,
  };
}

function verifyV5RecencyDataset(dataset, adapter) {
  if (dataset.datasetVersion !== 2 || dataset.activeSeason !== 2026) {
    throw new Error('V5 recency dataset does not use the verified M8 dataset contract.');
  }
  if (
    dataset.sourceEvidenceSetSha256 !== adapter.evidenceSetSha256 ||
    dataset.periods?.fit?.startDate !== adapter.periods.fit.startDate ||
    dataset.periods?.fit?.endDate !== adapter.periods.fit.endDate ||
    dataset.periods?.validation?.startDate !== adapter.periods.validation.startDate ||
    dataset.periods?.validation?.endDate !== adapter.periods.validation.endDate
  ) {
    throw new Error('V5 recency dataset period or source identity drifted.');
  }
  if (
    dataset.periods.fit.rowCount !== adapter.periods.fit.plateAppearanceCount ||
    dataset.periods.validation.rowCount !==
      adapter.periods.validation.plateAppearanceCount
  ) {
    throw new Error('V5 recency dataset row counts drifted from the frozen partition.');
  }
  if (
    dataset.untouchedTestReservation?.startDate !==
      adapter.untouchedTestReservation.startDate ||
    dataset.untouchedTestReservation?.endDate !==
      adapter.untouchedTestReservation.endDate ||
    dataset.untouchedTestReservation?.rowsIncluded !== false
  ) {
    throw new Error('V5 recency dataset opened or moved the untouched acceptance period.');
  }
  if (
    dataset.datasetSha256 !== sha256(JSON.stringify(datasetIdentity(dataset)))
  ) {
    throw new Error('V5 recency dataset SHA-256 is invalid.');
  }
  return dataset;
}

const [sourceRead, v5Read] = await Promise.all([
  readJson(SOURCE_PARTITION_PATH, 'source M8 chronological partition'),
  readJson(V5_PARTITION_PATH, 'V5 refit partition'),
]);
const adapter = buildM9BatterHitsV5RecencyPartitionAdapter({
  rawV5Partition: v5Read.value,
  rawSourcePartition: sourceRead.value,
});
verifyM9BatterHitsV5RecencyPartitionAdapter(adapter);

const adapterWriteStatus = await writeOrVerify(
  ADAPTER_PATH,
  adapter,
  'V5 recency partition adapter',
);
const compatibilityWriteStatus = await writeOrVerify(
  COMPATIBILITY_PATH,
  adapter.compatibilityManifest,
  'V5 recency compatibility partition',
);

const { classifyBallDontLieTerminalPa } = await import(
  new URL('../dist/src/adapters/providers/balldontlie/index.js', import.meta.url),
);
const dataset = await buildM8RecencyEvaluationDataset({
  partitionManifestPath: COMPATIBILITY_PATH,
  secret: process.env.BALLDONTLIE_API_KEY?.trim() || null,
  classifyTerminalPa: classifyBallDontLieTerminalPa,
});
verifyV5RecencyDataset(dataset, adapter);
const datasetWriteStatus = await writeOrVerify(
  DATASET_PATH,
  dataset,
  'V5 recency evaluation dataset',
);
const persistedDataset = (
  await readJson(DATASET_PATH, 'persisted V5 recency evaluation dataset')
).value;
verifyV5RecencyDataset(persistedDataset, adapter);

console.log('=== M9 BATTER HITS V5 RECENCY DATASET COMPLETE ===');
console.log(`Source V5 partition: ${V5_PARTITION_PATH}`);
console.log(`Adapter: ${ADAPTER_PATH} (${adapterWriteStatus})`);
console.log(
  `Compatibility partition: ${COMPATIBILITY_PATH} (${compatibilityWriteStatus})`,
);
console.log(`Dataset: ${DATASET_PATH} (${datasetWriteStatus})`);
console.log(
  `Fit: ${dataset.periods.fit.startDate} through ${dataset.periods.fit.endDate} — ${dataset.periods.fit.rowCount} rows`,
);
console.log(
  `Validation: ${dataset.periods.validation.startDate} through ${dataset.periods.validation.endDate} — ${dataset.periods.validation.rowCount} rows`,
);
console.log(`Classified terminal rows: ${dataset.totals.classifiedTerminalCount}`);
console.log(`Context-required rows: ${dataset.totals.contextRequiredCount}`);
console.log(`Unresolved rows: ${dataset.totals.unresolvedCount}`);
console.log(`Dataset SHA-256: ${dataset.datasetSha256}`);
console.log('Production enabled: false');
console.log('Untouched acceptance rows accessed: false');
