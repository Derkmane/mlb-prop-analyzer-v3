import { activeUtcSeason } from './provider-capability-utils.mjs';
import { writeJsonAtomic } from './provider-probe-utils.mjs';
import { buildM8ChronologicalPartitionManifest } from './m8-partition-manifest-utils.mjs';

function requireEnvironmentValue(name) {
  const value = process.env[name]?.trim();
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

function parseActiveSeason(value) {
  if (!/^\d{4}$/.test(value)) {
    throw new TypeError('M8_ACTIVE_SEASON must be a four-digit year.');
  }
  const season = Number(value);
  if (season !== activeUtcSeason(new Date())) {
    throw new RangeError(
      `M8_ACTIVE_SEASON must equal the active UTC season ${activeUtcSeason(new Date())}.`,
    );
  }
  return season;
}

const activeSeason = parseActiveSeason(
  requireEnvironmentValue('M8_ACTIVE_SEASON'),
);
const shardCollectionRoot = requireEnvironmentValue('M8_PARTITION_SHARD_ROOT');
const outputPath = requireEnvironmentValue('M8_PARTITION_OUTPUT_PATH');

const manifest = await buildM8ChronologicalPartitionManifest({
  shardCollectionRoot,
  activeSeason,
  windows: {
    fitStartDate: requireEnvironmentValue('M8_FIT_START_DATE'),
    fitEndDate: requireEnvironmentValue('M8_FIT_END_DATE'),
    validationStartDate: requireEnvironmentValue('M8_VALIDATION_START_DATE'),
    validationEndDate: requireEnvironmentValue('M8_VALIDATION_END_DATE'),
    testStartDate: requireEnvironmentValue('M8_TEST_START_DATE'),
    testEndDate: requireEnvironmentValue('M8_TEST_END_DATE'),
  },
  secret: process.env.BALLDONTLIE_API_KEY?.trim() || null,
});

await writeJsonAtomic(outputPath, manifest);

console.log('=== M8 CHRONOLOGICAL PARTITION MANIFEST ===');
console.log(`Output: ${outputPath}`);
console.log(
  `Fit: ${manifest.periods.fit.startDate} through ${manifest.periods.fit.endDate} — ${manifest.periods.fit.gameCount} games, ${manifest.periods.fit.plateAppearanceCount} plate appearances`,
);
console.log(
  `Validation: ${manifest.periods.validation.startDate} through ${manifest.periods.validation.endDate} — ${manifest.periods.validation.gameCount} games, ${manifest.periods.validation.plateAppearanceCount} plate appearances`,
);
console.log(
  `Untouched test: ${manifest.periods.test.startDate} through ${manifest.periods.test.endDate} — ${manifest.periods.test.gameCount} games, ${manifest.periods.test.plateAppearanceCount} plate appearances`,
);
console.log(`Shards verified: ${manifest.totals.shardCount}`);
console.log(`Games verified: ${manifest.totals.gameCount}`);
console.log(
  `Plate appearances verified: ${manifest.totals.plateAppearanceCount}`,
);
console.log(`Evidence set SHA-256: ${manifest.evidenceSetSha256}`);
console.log('Test metrics remain reserved for final evaluation only.');
