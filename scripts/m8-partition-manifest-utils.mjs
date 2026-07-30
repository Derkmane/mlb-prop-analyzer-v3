import { readFile } from 'node:fs/promises';
import path from 'node:path';

import { sha256 } from './provider-probe-utils.mjs';
import { verifyM8CaptureDirectory } from './m8-capture-verification-utils.mjs';
import {
  enumerateCurrentSeasonDates,
  parseUtcIsoDate,
  validateChronologicalWindows,
} from './m8-recency-weighting-utils.mjs';

const PERIOD_ORDER = Object.freeze(['fit', 'validation', 'test']);

function assertPlainObject(value, label) {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new TypeError(`${label} must be an object.`);
  }
  return value;
}

function assertNonEmptyString(value, label) {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new TypeError(`${label} must be a non-empty string.`);
  }
  return value.trim();
}

function assertNonNegativeInteger(value, label) {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new TypeError(`${label} must be a non-negative integer.`);
  }
  return value;
}

function nextUtcDate(value) {
  const date = parseUtcIsoDate(value);
  date.setUTCDate(date.getUTCDate() + 1);
  return date.toISOString().slice(0, 10);
}

function previousUtcDate(value) {
  const date = parseUtcIsoDate(value);
  date.setUTCDate(date.getUTCDate() - 1);
  return date.toISOString().slice(0, 10);
}

function portablePath(value) {
  return value.split(path.sep).join('/');
}

export function validateM8PartitionWindows({
  activeSeason,
  fitStartDate,
  fitEndDate,
  validationStartDate,
  validationEndDate,
  testStartDate,
  testEndDate,
}) {
  const windows = validateChronologicalWindows({
    activeSeason,
    fitStartDate,
    fitEndDate,
    validationStartDate,
    validationEndDate,
    testStartDate,
    testEndDate,
  });

  if (nextUtcDate(windows.fitEndDate) !== windows.validationStartDate) {
    throw new RangeError(
      'fit and validation periods must be adjacent with no omitted dates.',
    );
  }
  return windows;
}

function excludedGapDefinition({ activeSeason, windows }) {
  const startDate = nextUtcDate(windows.validationEndDate);

  if (startDate === windows.testStartDate) {
    return null;
  }

  const endDate = previousUtcDate(windows.testStartDate);
  const dates = enumerateCurrentSeasonDates({
    startDate,
    endDate,
    activeSeason,
  });

  return Object.freeze({
    startDate,
    endDate,
    allowedUse: 'excluded-from-fitting-validation-and-untouched-testing',
    dateCount: dates.length,
    dates: Object.freeze(dates),
  });
}

function periodDefinitions(windows) {
  return Object.freeze([
    Object.freeze({
      id: 'fit',
      startDate: windows.fitStartDate,
      endDate: windows.fitEndDate,
      allowedUse: 'model-fitting-and-candidate-construction',
    }),
    Object.freeze({
      id: 'validation',
      startDate: windows.validationStartDate,
      endDate: windows.validationEndDate,
      allowedUse: 'candidate-selection-by-validation-metrics-only',
    }),
    Object.freeze({
      id: 'test',
      startDate: windows.testStartDate,
      endDate: windows.testEndDate,
      allowedUse: 'untouched-final-evaluation-after-candidate-selection',
    }),
  ]);
}

async function readVerifiedShardIdentity({
  shardCollectionRoot,
  date,
  activeSeason,
  secret,
  verify,
}) {
  const shardRoot = path.join(shardCollectionRoot, date);
  const verification = await verify({
    captureRoot: shardRoot,
    expectedActiveSeason: activeSeason,
    secret,
  });

  if (
    verification.status !== 'verified' ||
    verification.activeSeason !== activeSeason ||
    verification.startDate !== date ||
    verification.endDate !== date
  ) {
    throw new Error(`shard ${date} verification identity does not match its date.`);
  }

  const manifestPath = path.join(shardRoot, 'capture-manifest.json');
  const manifestText = await readFile(manifestPath, 'utf8');
  if (secret && manifestText.includes(secret)) {
    throw new Error(`shard ${date} capture manifest contains the provider secret.`);
  }

  let manifest;
  try {
    manifest = JSON.parse(manifestText);
  } catch {
    throw new Error(`shard ${date} capture manifest is not valid JSON.`);
  }
  assertPlainObject(manifest, `shard ${date} capture manifest`);

  if (
    manifest.captureVersion !== 1 ||
    manifest.provider !== 'BALLDONTLIE MLB API' ||
    manifest.activeSeason !== activeSeason ||
    manifest.requestedStartDate !== date ||
    manifest.requestedEndDate !== date ||
    manifest.status !== 'complete' ||
    manifest.truncated !== false ||
    manifest.error !== null
  ) {
    throw new Error(`shard ${date} capture manifest identity is not promotable.`);
  }

  const manifestGameCount = assertNonNegativeInteger(
    manifest.capturedGameCount,
    `shard ${date} capturedGameCount`,
  );
  const manifestPlateAppearanceCount = assertNonNegativeInteger(
    manifest.capturedPlateAppearanceCount,
    `shard ${date} capturedPlateAppearanceCount`,
  );
  if (
    manifestGameCount !== verification.gameCount ||
    manifestPlateAppearanceCount !== verification.plateAppearanceCount
  ) {
    throw new Error(`shard ${date} manifest counts drifted from verification.`);
  }

  return Object.freeze({
    date,
    captureManifestPath: portablePath(
      path.relative(shardCollectionRoot, manifestPath),
    ),
    captureManifestSha256: sha256(manifestText),
    gameCount: verification.gameCount,
    plateAppearanceCount: verification.plateAppearanceCount,
  });
}

function summarizePeriod(definition, shards) {
  return Object.freeze({
    startDate: definition.startDate,
    endDate: definition.endDate,
    allowedUse: definition.allowedUse,
    shardCount: shards.length,
    gameCount: shards.reduce((sum, shard) => sum + shard.gameCount, 0),
    plateAppearanceCount: shards.reduce(
      (sum, shard) => sum + shard.plateAppearanceCount,
      0,
    ),
    shards: Object.freeze(shards),
  });
}

export async function buildM8ChronologicalPartitionManifest({
  shardCollectionRoot,
  activeSeason,
  windows,
  secret = null,
  verify = verifyM8CaptureDirectory,
}) {
  const root = assertNonEmptyString(
    shardCollectionRoot,
    'shardCollectionRoot',
  );
  if (typeof verify !== 'function') {
    throw new TypeError('verify must be a function.');
  }

  const validatedWindows = validateM8PartitionWindows({
    activeSeason,
    ...assertPlainObject(windows, 'windows'),
  });
  const excludedGap = excludedGapDefinition({
    activeSeason,
    windows: validatedWindows,
  });
  const definitions = periodDefinitions(validatedWindows);
  const periods = {};
  const seenDates = new Set();

  for (const definition of definitions) {
    const dates = enumerateCurrentSeasonDates({
      startDate: definition.startDate,
      endDate: definition.endDate,
      activeSeason,
    });
    const shards = [];
    for (const date of dates) {
      if (seenDates.has(date)) {
        throw new Error(`date ${date} appears in more than one partition period.`);
      }
      seenDates.add(date);
      shards.push(
        await readVerifiedShardIdentity({
          shardCollectionRoot: root,
          date,
          activeSeason,
          secret,
          verify,
        }),
      );
    }
    periods[definition.id] = summarizePeriod(definition, shards);
  }

  if (Object.keys(periods).join(',') !== PERIOD_ORDER.join(',')) {
    throw new Error('partition periods must remain ordered fit, validation, test.');
  }

  const totalShardCount = PERIOD_ORDER.reduce(
    (sum, id) => sum + periods[id].shardCount,
    0,
  );
  const totalGameCount = PERIOD_ORDER.reduce(
    (sum, id) => sum + periods[id].gameCount,
    0,
  );
  const totalPlateAppearanceCount = PERIOD_ORDER.reduce(
    (sum, id) => sum + periods[id].plateAppearanceCount,
    0,
  );

  const evidenceIdentity = {
    activeSeason,
    windows: validatedWindows,
    excludedGap,
    periodShardIdentities: Object.fromEntries(
      PERIOD_ORDER.map((id) => [id, periods[id].shards]),
    ),
  };

  return Object.freeze({
    partitionVersion: 1,
    purpose:
      'Freeze verified current-season evidence allocation for M8 recency fitting, validation, and untouched testing.',
    activeSeason,
    shardCollectionRoot: portablePath(root),
    sourceStartDate: validatedWindows.fitStartDate,
    sourceEndDate: validatedWindows.testEndDate,
    windows: validatedWindows,
    excludedGap,
    selectionBoundary: Object.freeze({
      fittingUses: Object.freeze(['fit']),
      candidateSelectionUses: Object.freeze(['validation']),
      untouchedTestUses: Object.freeze(['final-evaluation-only']),
      testMetricsForbiddenDuringCandidateSelection: true,
      excludedGapUsedByModelOrEvaluation: false,
    }),
    periods: Object.freeze(periods),
    totals: Object.freeze({
      shardCount: totalShardCount,
      gameCount: totalGameCount,
      plateAppearanceCount: totalPlateAppearanceCount,
    }),
    evidenceSetSha256: sha256(JSON.stringify(evidenceIdentity)),
  });
}
