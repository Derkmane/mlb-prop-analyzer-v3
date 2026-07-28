import { buildM8RecencyEvaluationDataset } from './m8-recency-evaluation-dataset-utils.mjs';
import { writeJsonAtomic } from './provider-probe-utils.mjs';

function requireEnvironmentValue(name) {
  const value = process.env[name]?.trim();
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

const partitionManifestPath = requireEnvironmentValue(
  'M8_RECENCY_PARTITION_MANIFEST_PATH',
);
const outputPath = requireEnvironmentValue('M8_RECENCY_DATASET_OUTPUT_PATH');
const { normalizeBallDontLieTerminalPa } = await import(
  new URL(
    '../dist/src/adapters/providers/balldontlie/index.js',
    import.meta.url,
  )
);

const dataset = await buildM8RecencyEvaluationDataset({
  partitionManifestPath,
  secret: process.env.BALLDONTLIE_API_KEY?.trim() || null,
  normalizeTerminalPa: normalizeBallDontLieTerminalPa,
});

await writeJsonAtomic(outputPath, dataset);

console.log('=== M8 RECENCY EVALUATION DATASET ===');
console.log(`Output: ${outputPath}`);
console.log(
  `Fit: ${dataset.periods.fit.startDate} through ${dataset.periods.fit.endDate} — ${dataset.periods.fit.rowCount} rows`,
);
console.log(
  `Validation: ${dataset.periods.validation.startDate} through ${dataset.periods.validation.endDate} — ${dataset.periods.validation.rowCount} rows`,
);
console.log(`Normalized rows: ${dataset.totals.normalizedCount}`);
console.log(`Context-required rows: ${dataset.totals.contextRequiredCount}`);
console.log(`Baserunning-only rows: ${dataset.totals.baserunningOnlyCount}`);
console.log(
  `Untouched test sealed: ${dataset.untouchedTestReservation.startDate} through ${dataset.untouchedTestReservation.endDate} — ${dataset.untouchedTestReservation.plateAppearanceCount} rows excluded`,
);
console.log(`Dataset SHA-256: ${dataset.datasetSha256}`);
console.log(
  'No recency candidate has been selected; context-required rows remain unresolved rather than guessed.',
);
