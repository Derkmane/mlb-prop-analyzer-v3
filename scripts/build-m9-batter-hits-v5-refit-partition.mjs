import { readFile } from 'node:fs/promises';

import {
  buildM9BatterHitsV5RefitPartition,
  verifyM9BatterHitsV5RefitPartition,
} from './m9-batter-hits-v5-refit-partition-utils.mjs';
import { writeJsonAtomic } from './provider-probe-utils.mjs';

const SOURCE_PATH =
  process.env.M9_V5_SOURCE_PARTITION_PATH?.trim() ||
  'artifacts/m8-current-season-pa/m8-chronological-partition-v1.json';
const OUTPUT_PATH =
  process.env.M9_V5_REFIT_PARTITION_OUTPUT_PATH?.trim() ||
  'artifacts/m9-batter-hits-v5-refit/m9-batter-hits-v5-refit-partition-v1.json';

async function readJson(filePath, label) {
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
    return JSON.parse(text);
  } catch {
    throw new Error(`${label} is not valid JSON.`);
  }
}

const sourcePartition = await readJson(
  SOURCE_PATH,
  'source chronological partition',
);
const partition = buildM9BatterHitsV5RefitPartition({
  rawSourcePartition: sourcePartition,
});
verifyM9BatterHitsV5RefitPartition(partition);

await writeJsonAtomic(OUTPUT_PATH, partition);
const persisted = await readJson(
  OUTPUT_PATH,
  'persisted V5 refit partition',
);
verifyM9BatterHitsV5RefitPartition(persisted);

if (persisted.partitionSha256 !== partition.partitionSha256) {
  throw new Error('persisted V5 refit partition identity changed after writing.');
}

console.log('=== M9 BATTER HITS V5 REFIT PARTITION FROZEN ===');
console.log(`Source partition: ${SOURCE_PATH}`);
console.log(`Fit: ${partition.periods.fit.startDate} through ${partition.periods.fit.endDate}`);
console.log(`Fit shards: ${partition.periods.fit.shardCount}`);
console.log(`Fit games: ${partition.periods.fit.gameCount}`);
console.log(`Fit plate appearances: ${partition.periods.fit.plateAppearanceCount}`);
console.log(
  `Validation: ${partition.periods.validation.startDate} through ${partition.periods.validation.endDate}`,
);
console.log(`Validation shards: ${partition.periods.validation.shardCount}`);
console.log(`Validation games: ${partition.periods.validation.gameCount}`);
console.log(
  `Validation plate appearances: ${partition.periods.validation.plateAppearanceCount}`,
);
console.log(
  `Excluded captured dates: ${partition.excludedCapturedDates.join(', ')}`,
);
console.log(
  `Untouched acceptance: ${partition.untouchedTestReservation.startDate} through ${partition.untouchedTestReservation.endDate}`,
);
console.log(`Partition SHA-256: ${partition.partitionSha256}`);
console.log(`Output: ${OUTPUT_PATH}`);
console.log('Production enabled: false');
console.log('Untouched acceptance rows accessed: false');
