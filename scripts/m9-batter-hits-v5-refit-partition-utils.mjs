import { sha256 } from './provider-probe-utils.mjs';
import { enumerateCurrentSeasonDates } from './m8-recency-weighting-utils.mjs';

const ACTIVE_SEASON = 2026;
const FIT_END_DATE = '2026-07-15';
const VALIDATION_START_DATE = '2026-07-16';
const VALIDATION_END_DATE = '2026-07-25';
const EXCLUDED_CAPTURED_DATES = Object.freeze([
  '2026-07-26',
  '2026-07-27',
  '2026-07-28',
  '2026-07-29',
]);
const UNTOUCHED_START_DATE = '2026-07-30';
const UNTOUCHED_END_DATE = '2026-08-04';
const SHA256_PATTERN = /^[a-f0-9]{64}$/;

function object(value, label) {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new TypeError(`${label} must be an object.`);
  }
  return value;
}

function array(value, label) {
  if (!Array.isArray(value)) throw new TypeError(`${label} must be an array.`);
  return value;
}

function string(value, label) {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new TypeError(`${label} must be a non-empty string.`);
  }
  return value.trim();
}

function nonNegativeInteger(value, label) {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new TypeError(`${label} must be a non-negative integer.`);
  }
  return value;
}

function sha(value, label) {
  const normalized = string(value, label);
  if (!SHA256_PATTERN.test(normalized)) {
    throw new TypeError(`${label} must be a lowercase SHA-256 digest.`);
  }
  return normalized;
}

function periodShards(sourcePartition) {
  const periods = object(sourcePartition.periods, 'source partition periods');
  const rows = [];
  for (const periodId of ['fit', 'validation', 'test']) {
    const period = object(periods[periodId], `source partition ${periodId}`);
    for (const rawShard of array(period.shards, `${periodId} shards`)) {
      const shard = object(rawShard, `${periodId} shard`);
      rows.push(
        Object.freeze({
          date: string(shard.date, 'shard date'),
          captureManifestPath: string(
            shard.captureManifestPath,
            'capture manifest path',
          ),
          captureManifestSha256: sha(
            shard.captureManifestSha256,
            'capture manifest SHA-256',
          ),
          gameCount: nonNegativeInteger(shard.gameCount, 'shard game count'),
          plateAppearanceCount: nonNegativeInteger(
            shard.plateAppearanceCount,
            'shard plate-appearance count',
          ),
        }),
      );
    }
  }
  return rows;
}

function summarizePeriod({ startDate, endDate, allowedUse, shards }) {
  return Object.freeze({
    startDate,
    endDate,
    allowedUse,
    shardCount: shards.length,
    gameCount: shards.reduce((sum, shard) => sum + shard.gameCount, 0),
    plateAppearanceCount: shards.reduce(
      (sum, shard) => sum + shard.plateAppearanceCount,
      0,
    ),
    shards: Object.freeze([...shards]),
  });
}

function partitionIdentity(value) {
  return {
    partitionVersion: value.partitionVersion,
    modelVersion: value.modelVersion,
    status: value.status,
    productionEnabled: value.productionEnabled,
    activeSeason: value.activeSeason,
    sourcePartitionEvidenceSetSha256: value.sourcePartitionEvidenceSetSha256,
    sourceWindow: value.sourceWindow,
    periods: value.periods,
    excludedCapturedDates: value.excludedCapturedDates,
    untouchedTestReservation: value.untouchedTestReservation,
    selectionBoundary: value.selectionBoundary,
    totals: value.totals,
  };
}

function validateSourcePartition(rawSourcePartition) {
  const source = object(rawSourcePartition, 'source partition');
  if (source.partitionVersion !== 1 || source.activeSeason !== ACTIVE_SEASON) {
    throw new Error('source partition must be the active-season M8 partition v1.');
  }
  const sourceEvidenceSetSha256 = sha(
    source.evidenceSetSha256,
    'source partition evidenceSetSha256',
  );
  const shards = periodShards(source).sort((left, right) =>
    left.date.localeCompare(right.date),
  );
  if (shards.length === 0) throw new Error('source partition contains no shards.');

  const fitStartDate = string(
    source.periods?.fit?.startDate,
    'source fit startDate',
  );
  const expectedDates = enumerateCurrentSeasonDates({
    startDate: fitStartDate,
    endDate: VALIDATION_END_DATE,
    activeSeason: ACTIVE_SEASON,
  });
  const actualDates = shards.map((shard) => shard.date);
  if (JSON.stringify(actualDates) !== JSON.stringify(expectedDates)) {
    throw new Error(
      'source partition must contain each date exactly once from fit start through 2026-07-25.',
    );
  }
  if (new Set(actualDates).size !== actualDates.length) {
    throw new Error('source partition contains duplicate shard dates.');
  }
  return Object.freeze({ source, sourceEvidenceSetSha256, fitStartDate, shards });
}

export function buildM9BatterHitsV5RefitPartition({ rawSourcePartition }) {
  const validated = validateSourcePartition(rawSourcePartition);
  const fitShards = validated.shards.filter((shard) => shard.date <= FIT_END_DATE);
  const validationShards = validated.shards.filter(
    (shard) =>
      shard.date >= VALIDATION_START_DATE && shard.date <= VALIDATION_END_DATE,
  );
  if (fitShards.at(-1)?.date !== FIT_END_DATE) {
    throw new Error('V5 fit evidence does not end on 2026-07-15.');
  }
  if (
    validationShards[0]?.date !== VALIDATION_START_DATE ||
    validationShards.at(-1)?.date !== VALIDATION_END_DATE
  ) {
    throw new Error('V5 validation evidence must span 2026-07-16 through 2026-07-25.');
  }

  const periods = Object.freeze({
    fit: summarizePeriod({
      startDate: validated.fitStartDate,
      endDate: FIT_END_DATE,
      allowedUse: 'unchanged-selected-structure-parameter-refit-only',
      shards: fitShards,
    }),
    validation: summarizePeriod({
      startDate: VALIDATION_START_DATE,
      endDate: VALIDATION_END_DATE,
      allowedUse: 'fixed-validation-of-v5-refit-against-original-frozen-candidate',
      shards: validationShards,
    }),
  });
  const identity = {
    partitionVersion: 1,
    modelVersion: 'm9-batter-hits-v5-refit-partition-v1',
    status: 'frozen-development-partition-before-v5-refit',
    productionEnabled: false,
    activeSeason: ACTIVE_SEASON,
    sourcePartitionEvidenceSetSha256: validated.sourceEvidenceSetSha256,
    sourceWindow: Object.freeze({
      startDate: validated.fitStartDate,
      endDate: VALIDATION_END_DATE,
    }),
    periods,
    excludedCapturedDates: EXCLUDED_CAPTURED_DATES,
    untouchedTestReservation: Object.freeze({
      startDate: UNTOUCHED_START_DATE,
      endDate: UNTOUCHED_END_DATE,
      rowsIncluded: false,
      allowedUse: 'one-time-final-evaluation-after-v5-candidate-freeze',
      minimumIncludedStarterObservations: 900,
      minimumActualHitsAbove25: 35,
    }),
    selectionBoundary: Object.freeze({
      modelFamiliesReopened: false,
      hyperparametersReopened: false,
      postHocCalibrationAllowed: false,
      fitUses: Object.freeze(['fit']),
      validationUses: Object.freeze(['validation']),
      excludedCapturedDatesForbidden: true,
      untouchedOutcomesForbiddenBeforeCandidateFreeze: true,
    }),
    totals: Object.freeze({
      shardCount: periods.fit.shardCount + periods.validation.shardCount,
      gameCount: periods.fit.gameCount + periods.validation.gameCount,
      plateAppearanceCount:
        periods.fit.plateAppearanceCount + periods.validation.plateAppearanceCount,
    }),
  };
  return Object.freeze({
    purpose:
      'Freeze the exact current-season development allocation for the M9 Batter Hits V5 unchanged-structure parameter refit while preserving the newly reserved untouched acceptance period.',
    ...identity,
    partitionSha256: sha256(JSON.stringify(identity)),
  });
}

export function verifyM9BatterHitsV5RefitPartition(rawPartition) {
  const partition = object(rawPartition, 'V5 refit partition');
  if (
    partition.partitionVersion !== 1 ||
    partition.modelVersion !== 'm9-batter-hits-v5-refit-partition-v1' ||
    partition.productionEnabled !== false
  ) {
    throw new Error('unsupported V5 refit partition contract.');
  }
  if (
    partition.periods?.fit?.endDate !== FIT_END_DATE ||
    partition.periods?.validation?.startDate !== VALIDATION_START_DATE ||
    partition.periods?.validation?.endDate !== VALIDATION_END_DATE
  ) {
    throw new Error('V5 fit-validation boundary drifted.');
  }
  if (
    JSON.stringify(partition.excludedCapturedDates) !==
    JSON.stringify(EXCLUDED_CAPTURED_DATES)
  ) {
    throw new Error('V5 excluded captured dates drifted.');
  }
  if (
    partition.untouchedTestReservation?.startDate !== UNTOUCHED_START_DATE ||
    partition.untouchedTestReservation?.endDate !== UNTOUCHED_END_DATE ||
    partition.untouchedTestReservation?.rowsIncluded !== false
  ) {
    throw new Error('V5 untouched acceptance reservation drifted or was opened.');
  }
  const developmentShards = [
    ...array(partition.periods.fit.shards, 'V5 fit shards'),
    ...array(partition.periods.validation.shards, 'V5 validation shards'),
  ];
  if (developmentShards.some((shard) => shard.date > VALIDATION_END_DATE)) {
    throw new Error('V5 development partition includes a post-validation shard.');
  }
  if (
    partition.partitionSha256 !== sha256(JSON.stringify(partitionIdentity(partition)))
  ) {
    throw new Error('V5 refit partition SHA-256 is invalid.');
  }
  return partition;
}
