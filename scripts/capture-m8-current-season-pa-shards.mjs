import { execFileSync } from 'node:child_process';
import { mkdir, mkdtemp, rename } from 'node:fs/promises';
import path from 'node:path';

import { activeUtcSeason } from './provider-capability-utils.mjs';
import { requireSecret } from './provider-probe-utils.mjs';
import {
  buildM8ShardPlan,
  inspectM8Shard,
  verifyM8ShardCollection,
} from './m8-sharded-capture-utils.mjs';
import { verifyM8CaptureDirectory } from './m8-capture-verification-utils.mjs';

function requireEnvironmentValue(name) {
  const value = process.env[name]?.trim();
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

const activeSeason = activeUtcSeason(new Date());
const startDate = requireEnvironmentValue('M8_CAPTURE_START_DATE');
const endDate = requireEnvironmentValue('M8_CAPTURE_END_DATE');
const outputRoot = requireEnvironmentValue('M8_SHARD_OUTPUT_DIR');
const apiKey = requireSecret('BALLDONTLIE_API_KEY');
const plan = buildM8ShardPlan({
  startDate,
  endDate,
  activeSeason,
  outputRoot,
});

await mkdir(outputRoot, { recursive: true });

console.log('=== M8 RESUMABLE DATE-SHARDED CAPTURE ===');
console.log(`Active season: ${activeSeason}`);
console.log(`Date range: ${startDate} through ${endDate}`);
console.log(`Shard root: ${outputRoot}`);
console.log(`Planned shards: ${plan.length}`);

for (const shard of plan) {
  const existing = await inspectM8Shard({
    shardRoot: shard.finalDirectory,
    date: shard.date,
    activeSeason,
    secret: apiKey,
  });

  if (existing.status === 'verified') {
    console.log(
      `Skipping verified shard ${shard.date}: ${existing.gameCount} games, ${existing.plateAppearanceCount} plate appearances.`,
    );
    continue;
  }

  const temporaryDirectory = await mkdtemp(shard.temporaryPrefix);
  console.log(`Capturing missing shard ${shard.date}...`);
  console.log(`Temporary directory: ${temporaryDirectory}`);

  try {
    execFileSync(process.execPath, ['scripts/capture-m8-current-season-pa.mjs'], {
      stdio: 'inherit',
      env: {
        ...process.env,
        M8_CAPTURE_START_DATE: shard.date,
        M8_CAPTURE_END_DATE: shard.date,
        M8_CAPTURE_MAX_GAMES: '0',
        M8_CAPTURE_OUTPUT_DIR: temporaryDirectory,
      },
    });

    const verified = await verifyM8CaptureDirectory({
      captureRoot: temporaryDirectory,
      expectedActiveSeason: activeSeason,
      secret: apiKey,
    });
    if (verified.startDate !== shard.date || verified.endDate !== shard.date) {
      throw new Error(
        `Captured shard ${shard.date} verified with the wrong date range.`,
      );
    }

    await rename(temporaryDirectory, shard.finalDirectory);
    console.log(
      `Promoted verified shard ${shard.date}: ${verified.gameCount} games, ${verified.plateAppearanceCount} plate appearances.`,
    );
  } catch (error) {
    console.error(
      `Shard ${shard.date} was not promoted. Preserved temporary evidence at ${temporaryDirectory}.`,
    );
    throw error;
  }
}

const collection = await verifyM8ShardCollection({
  startDate,
  endDate,
  activeSeason,
  outputRoot,
  secret: apiKey,
});

console.log('=== M8 SHARD COLLECTION VERIFIED ===');
console.log(`Shards verified: ${collection.shardCount}`);
console.log(`Games verified: ${collection.gameCount}`);
console.log(`Plate appearances verified: ${collection.plateAppearanceCount}`);
