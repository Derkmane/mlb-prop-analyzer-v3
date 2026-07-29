import { access, stat } from 'node:fs/promises';
import path from 'node:path';

import { verifyM8CaptureDirectory } from './m8-capture-verification-utils.mjs';
import { enumerateCurrentSeasonDates } from './m8-recency-weighting-utils.mjs';

function assertNonEmptyString(value, label) {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new TypeError(`${label} must be a non-empty string.`);
  }
  return value.trim();
}

function assertActiveSeason(value) {
  if (!Number.isSafeInteger(value) || value < 1900) {
    throw new TypeError('activeSeason must be a four-digit integer year.');
  }
  return value;
}

export function buildM8ShardPlan({
  startDate,
  endDate,
  activeSeason,
  outputRoot,
}) {
  const season = assertActiveSeason(activeSeason);
  const root = assertNonEmptyString(outputRoot, 'outputRoot');
  const dates = enumerateCurrentSeasonDates({
    startDate,
    endDate,
    activeSeason: season,
  });

  return Object.freeze(
    dates.map((date) =>
      Object.freeze({
        date,
        finalDirectory: path.join(root, date),
        temporaryPrefix: path.join(root, `.capture-${date}-`),
      }),
    ),
  );
}

async function inspectShardPath(shardRoot) {
  let details;
  try {
    details = await stat(shardRoot);
  } catch (error) {
    if (error?.code === 'ENOENT') {
      return 'missing';
    }
    throw error;
  }

  if (!details.isDirectory()) {
    throw new Error(`Existing shard path ${shardRoot} is not a directory.`);
  }

  try {
    await access(path.join(shardRoot, 'capture-manifest.json'));
    return 'manifest-present';
  } catch (error) {
    if (error?.code === 'ENOENT') {
      return 'incomplete';
    }
    throw error;
  }
}

export async function inspectM8Shard({
  shardRoot,
  date,
  activeSeason,
  secret = null,
  verify = verifyM8CaptureDirectory,
}) {
  const root = assertNonEmptyString(shardRoot, 'shardRoot');
  const expectedDate = assertNonEmptyString(date, 'date');
  const season = assertActiveSeason(activeSeason);
  const pathState = await inspectShardPath(root);

  if (pathState === 'missing') {
    return Object.freeze({ status: 'missing', date: expectedDate, shardRoot: root });
  }
  if (pathState === 'incomplete') {
    throw new Error(
      `Existing shard ${expectedDate} has no capture manifest; refusing to overwrite it.`,
    );
  }

  let result;
  try {
    result = await verify({
      captureRoot: root,
      expectedActiveSeason: season,
      secret,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(
      `Existing shard ${expectedDate} failed verification; refusing to overwrite it: ${message}`,
    );
  }

  if (result.startDate !== expectedDate || result.endDate !== expectedDate) {
    throw new Error(
      `Existing shard ${expectedDate} covers ${result.startDate} through ${result.endDate}; refusing to reuse it.`,
    );
  }

  return Object.freeze({
    status: 'verified',
    date: expectedDate,
    shardRoot: root,
    gameCount: result.gameCount,
    plateAppearanceCount: result.plateAppearanceCount,
  });
}

export async function verifyM8ShardCollection({
  startDate,
  endDate,
  activeSeason,
  outputRoot,
  secret = null,
  verify = verifyM8CaptureDirectory,
}) {
  const plan = buildM8ShardPlan({
    startDate,
    endDate,
    activeSeason,
    outputRoot,
  });

  let gameCount = 0;
  let plateAppearanceCount = 0;

  for (const shard of plan) {
    const inspected = await inspectM8Shard({
      shardRoot: shard.finalDirectory,
      date: shard.date,
      activeSeason,
      secret,
      verify,
    });
    if (inspected.status !== 'verified') {
      throw new Error(`Required shard ${shard.date} is missing.`);
    }
    gameCount += inspected.gameCount;
    plateAppearanceCount += inspected.plateAppearanceCount;
  }

  return Object.freeze({
    status: 'verified',
    activeSeason,
    startDate,
    endDate,
    shardCount: plan.length,
    gameCount,
    plateAppearanceCount,
  });
}
