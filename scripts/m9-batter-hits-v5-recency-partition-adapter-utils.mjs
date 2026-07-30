import { sha256 } from './provider-probe-utils.mjs';
import { verifyM9BatterHitsV5RefitPartition } from './m9-batter-hits-v5-refit-partition-utils.mjs';

const ACTIVE_SEASON = 2026;
const PERIOD_IDS = Object.freeze(['fit', 'validation']);
const SHA256_PATTERN = /^[a-f0-9]{64}$/;

function object(value, label) {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new TypeError(`${label} must be an object.`);
  }
  return value;
}

function array(value, label) {
  if (!Array.isArray(value)) {
    throw new TypeError(`${label} must be an array.`);
  }
  return value;
}

function string(value, label) {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new TypeError(`${label} must be a non-empty string.`);
  }
  return value.trim();
}

function integer(value, label) {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new TypeError(`${label} must be a non-negative integer.`);
  }
  return value;
}

function digest(value, label) {
  const normalized = string(value, label);
  if (!SHA256_PATTERN.test(normalized)) {
    throw new TypeError(`${label} must be a lowercase SHA-256 digest.`);
  }
  return normalized;
}

function shardIdentity(rawShard, label) {
  const shard = object(rawShard, label);
  return Object.freeze({
    date: string(shard.date, `${label}.date`),
    captureManifestPath: string(
      shard.captureManifestPath,
      `${label}.captureManifestPath`,
    ),
    captureManifestSha256: digest(
      shard.captureManifestSha256,
      `${label}.captureManifestSha256`,
    ),
    gameCount: integer(shard.gameCount, `${label}.gameCount`),
    plateAppearanceCount: integer(
      shard.plateAppearanceCount,
      `${label}.plateAppearanceCount`,
    ),
  });
}

function sourceShardMap(rawSourcePartition) {
  const source = object(rawSourcePartition, 'source M8 partition');
  if (source.partitionVersion !== 1 || source.activeSeason !== ACTIVE_SEASON) {
    throw new Error('source partition must be the active-season M8 partition v1.');
  }
  const evidenceSetSha256 = digest(
    source.evidenceSetSha256,
    'source partition evidenceSetSha256',
  );
  const shardCollectionRoot = string(
    source.shardCollectionRoot,
    'source partition shardCollectionRoot',
  );
  const byDate = new Map();
  for (const periodId of ['fit', 'validation', 'test']) {
    const period = object(source.periods?.[periodId], `source ${periodId} period`);
    for (const [index, rawShard] of array(
      period.shards,
      `source ${periodId} shards`,
    ).entries()) {
      const shard = shardIdentity(rawShard, `source ${periodId} shard ${index}`);
      if (byDate.has(shard.date)) {
        throw new Error(`source partition repeats shard date ${shard.date}.`);
      }
      byDate.set(shard.date, shard);
    }
  }
  return Object.freeze({ source, evidenceSetSha256, shardCollectionRoot, byDate });
}

function assertExactSourceShard(v5Shard, sourceByDate, label) {
  const sourceShard = sourceByDate.get(v5Shard.date);
  if (!sourceShard) {
    throw new Error(`${label} date ${v5Shard.date} is absent from the source partition.`);
  }
  if (JSON.stringify(v5Shard) !== JSON.stringify(sourceShard)) {
    throw new Error(`${label} ${v5Shard.date} drifted from the verified source shard.`);
  }
}

function copyPeriod(rawPeriod, sourceByDate, label) {
  const period = object(rawPeriod, label);
  const shards = array(period.shards, `${label}.shards`).map((rawShard, index) => {
    const shard = shardIdentity(rawShard, `${label}.shards[${index}]`);
    assertExactSourceShard(shard, sourceByDate, label);
    return shard;
  });
  const result = Object.freeze({
    startDate: string(period.startDate, `${label}.startDate`),
    endDate: string(period.endDate, `${label}.endDate`),
    allowedUse: string(period.allowedUse, `${label}.allowedUse`),
    shardCount: integer(period.shardCount, `${label}.shardCount`),
    gameCount: integer(period.gameCount, `${label}.gameCount`),
    plateAppearanceCount: integer(
      period.plateAppearanceCount,
      `${label}.plateAppearanceCount`,
    ),
    shards: Object.freeze(shards),
  });
  if (result.shardCount !== shards.length) {
    throw new Error(`${label}.shardCount does not match its shard list.`);
  }
  if (result.gameCount !== shards.reduce((sum, shard) => sum + shard.gameCount, 0)) {
    throw new Error(`${label}.gameCount does not match its shard list.`);
  }
  if (
    result.plateAppearanceCount !==
    shards.reduce((sum, shard) => sum + shard.plateAppearanceCount, 0)
  ) {
    throw new Error(`${label}.plateAppearanceCount does not match its shard list.`);
  }
  return result;
}

function adapterIdentity(value) {
  return {
    adapterVersion: value.adapterVersion,
    modelVersion: value.modelVersion,
    productionEnabled: value.productionEnabled,
    activeSeason: value.activeSeason,
    sourceM8EvidenceSetSha256: value.sourceM8EvidenceSetSha256,
    sourceV5PartitionSha256: value.sourceV5PartitionSha256,
    shardCollectionRoot: value.shardCollectionRoot,
    periods: value.periods,
    untouchedTestReservation: value.untouchedTestReservation,
    evidenceSetSha256: value.evidenceSetSha256,
    compatibilityManifest: value.compatibilityManifest,
  };
}

export function buildM9BatterHitsV5RecencyPartitionAdapter({
  rawV5Partition,
  rawSourcePartition,
}) {
  const v5 = verifyM9BatterHitsV5RefitPartition(rawV5Partition);
  const source = sourceShardMap(rawSourcePartition);
  if (v5.sourcePartitionEvidenceSetSha256 !== source.evidenceSetSha256) {
    throw new Error('V5 partition does not reference the supplied M8 source partition.');
  }

  const periods = Object.freeze(
    Object.fromEntries(
      PERIOD_IDS.map((periodId) => [
        periodId,
        copyPeriod(v5.periods?.[periodId], source.byDate, `V5 ${periodId} period`),
      ]),
    ),
  );
  const developmentDates = new Set(
    PERIOD_IDS.flatMap((periodId) => periods[periodId].shards.map((shard) => shard.date)),
  );
  if (developmentDates.size !== periods.fit.shardCount + periods.validation.shardCount) {
    throw new Error('V5 fit and validation periods overlap.');
  }
  if (
    [...developmentDates].some(
      (date) =>
        date >= v5.untouchedTestReservation.startDate ||
        v5.excludedCapturedDates.includes(date),
    )
  ) {
    throw new Error('V5 development evidence includes an excluded or untouched date.');
  }

  const untouchedTestReservation = Object.freeze({
    ...v5.untouchedTestReservation,
    shardCount: 0,
    gameCount: 0,
    plateAppearanceCount: 0,
    rowsIncluded: false,
  });
  const evidenceSetSha256 = sha256(
    JSON.stringify({
      sourceM8EvidenceSetSha256: source.evidenceSetSha256,
      sourceV5PartitionSha256: v5.partitionSha256,
      periods,
      untouchedTestReservation,
    }),
  );
  const compatibilityManifest = Object.freeze({
    partitionVersion: 1,
    purpose:
      'Compatibility view allowing the verified M8 terminal-PA dataset reader to consume the sealed M9 V5 fit and validation periods without exposing untouched outcomes.',
    activeSeason: ACTIVE_SEASON,
    shardCollectionRoot: source.shardCollectionRoot,
    evidenceSetSha256,
    selectionBoundary: Object.freeze({
      testMetricsForbiddenDuringCandidateSelection: true,
    }),
    periods: Object.freeze({
      fit: periods.fit,
      validation: periods.validation,
      test: Object.freeze({
        startDate: untouchedTestReservation.startDate,
        endDate: untouchedTestReservation.endDate,
        allowedUse: untouchedTestReservation.allowedUse,
        shardCount: 0,
        gameCount: 0,
        plateAppearanceCount: 0,
        shards: Object.freeze([]),
      }),
    }),
  });
  const identity = {
    adapterVersion: 1,
    modelVersion: 'm9-batter-hits-v5-recency-partition-adapter-v1',
    productionEnabled: false,
    activeSeason: ACTIVE_SEASON,
    sourceM8EvidenceSetSha256: source.evidenceSetSha256,
    sourceV5PartitionSha256: v5.partitionSha256,
    shardCollectionRoot: source.shardCollectionRoot,
    periods,
    untouchedTestReservation,
    evidenceSetSha256,
    compatibilityManifest,
  };

  return Object.freeze({
    ...identity,
    adapterSha256: sha256(JSON.stringify(adapterIdentity(identity))),
  });
}

export function verifyM9BatterHitsV5RecencyPartitionAdapter(rawAdapter) {
  const adapter = object(rawAdapter, 'V5 recency partition adapter');
  if (
    adapter.adapterVersion !== 1 ||
    adapter.modelVersion !== 'm9-batter-hits-v5-recency-partition-adapter-v1' ||
    adapter.productionEnabled !== false
  ) {
    throw new Error('unsupported V5 recency partition adapter contract.');
  }
  const compatibility = object(
    adapter.compatibilityManifest,
    'V5 compatibility manifest',
  );
  if (
    adapter.untouchedTestReservation?.rowsIncluded !== false ||
    compatibility.periods?.test?.shardCount !== 0 ||
    compatibility.periods?.test?.gameCount !== 0 ||
    compatibility.periods?.test?.plateAppearanceCount !== 0 ||
    compatibility.periods?.test?.shards?.length !== 0
  ) {
    throw new Error('V5 recency adapter exposes untouched-test evidence.');
  }
  if (
    compatibility.evidenceSetSha256 !== adapter.evidenceSetSha256 ||
    JSON.stringify(compatibility.periods?.fit) !== JSON.stringify(adapter.periods?.fit) ||
    JSON.stringify(compatibility.periods?.validation) !==
      JSON.stringify(adapter.periods?.validation) ||
    compatibility.periods?.test?.startDate !==
      adapter.untouchedTestReservation.startDate ||
    compatibility.periods?.test?.endDate !== adapter.untouchedTestReservation.endDate
  ) {
    throw new Error('V5 compatibility manifest drifted from the adapter identity.');
  }
  const developmentShards = [
    ...array(adapter.periods?.fit?.shards, 'adapter fit shards'),
    ...array(adapter.periods?.validation?.shards, 'adapter validation shards'),
  ];
  if (
    developmentShards.some(
      (shard) => shard.date >= adapter.untouchedTestReservation.startDate,
    )
  ) {
    throw new Error('V5 recency adapter includes an untouched development shard.');
  }
  if (adapter.adapterSha256 !== sha256(JSON.stringify(adapterIdentity(adapter)))) {
    throw new Error('V5 recency partition adapter SHA-256 is invalid.');
  }
  return adapter;
}
