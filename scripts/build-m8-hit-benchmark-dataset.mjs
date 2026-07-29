import { buildM8HitBenchmarkDataset } from './m8-hit-benchmark-dataset-utils.mjs';
import { writeJsonAtomic } from './provider-probe-utils.mjs';

function requireEnvironmentValue(name) {
  const value = process.env[name]?.trim();
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

const sourceDatasetPath = requireEnvironmentValue('M8_RECENCY_DATASET_PATH');
const outputPath = requireEnvironmentValue('M8_HIT_BENCHMARK_OUTPUT_PATH');

const benchmark = await buildM8HitBenchmarkDataset({ sourceDatasetPath });
await writeJsonAtomic(outputPath, benchmark);

console.log('=== M8 HIT/NO-HIT BENCHMARK DATASET ===');
console.log(`Output: ${outputPath}`);
console.log(
  `Fit: ${benchmark.periods.fit.startDate} through ${benchmark.periods.fit.endDate} — ${benchmark.periods.fit.observationCount} benchmark observations`,
);
console.log(
  `Validation: ${benchmark.periods.validation.startDate} through ${benchmark.periods.validation.endDate} — ${benchmark.periods.validation.observationCount} benchmark observations`,
);
console.log(`Source rows conserved: ${benchmark.totals.sourceRowCount}`);
console.log(`Benchmark observations: ${benchmark.totals.observationCount}`);
console.log(`Hit observations: ${benchmark.totals.hitCount}`);
console.log(`No-Hit observations: ${benchmark.totals.noHitCount}`);
console.log(
  `Contextual No-Hit observations: ${benchmark.totals.contextualNonHitCount}`,
);
console.log(
  `Platoon-eligible benchmark observations: ${benchmark.totals.platoonEligibleCount}`,
);
console.log(`Explicitly excluded rows: ${benchmark.totals.excludedCount}`);
console.log(
  `Untouched test sealed: ${benchmark.untouchedTestReservation.startDate} through ${benchmark.untouchedTestReservation.endDate} — ${benchmark.untouchedTestReservation.plateAppearanceCount} rows excluded`,
);
console.log(`Benchmark SHA-256: ${benchmark.benchmarkSha256}`);
console.log(
  'This benchmark does not assign contextual rows to FC or BIP_OUT and does not select a recency candidate.',
);
