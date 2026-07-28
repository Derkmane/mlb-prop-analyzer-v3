import { readFile } from 'node:fs/promises';
import path from 'node:path';

import { sha256 } from './provider-probe-utils.mjs';
import { verifyM8CaptureDirectory } from './m8-capture-verification-utils.mjs';
import { enumerateCurrentSeasonDates } from './m8-recency-weighting-utils.mjs';

const SHA256_PATTERN = /^[a-f0-9]{64}$/;
const INCLUDED_PERIODS = Object.freeze(['fit', 'validation']);

function assertPlainObject(value, label) {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new TypeError(`${label} must be an object.`);
  }
  return value;
}

function assertArray(value, label) {
  if (!Array.isArray(value)) {
    throw new TypeError(`${label} must be an array.`);
  }
  return value;
}

function assertNonEmptyString(value, label) {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new TypeError(`${label} must be a non-empty string.`);
  }
  return value.trim();
}

function assertInteger(value, label) {
  if (!Number.isSafeInteger(value)) {
    throw new TypeError(`${label} must be an integer.`);
  }
  return value;
}

function assertNonNegativeInteger(value, label) {
  const integer = assertInteger(value, label);
  if (integer < 0) {
    throw new RangeError(`${label} must be non-negative.`);
  }
  return integer;
}

function assertSha256(value, label) {
  if (typeof value !== 'string' || !SHA256_PATTERN.test(value)) {
    throw new TypeError(`${label} must be a lowercase SHA-256 digest.`);
  }
  return value;
}

function portablePath(value) {
  return value.split(path.sep).join('/');
}

async function readTextChecked(filePath, label, secret) {
  const text = await readFile(filePath, 'utf8');
  if (secret && text.includes(secret)) {
    throw new Error(`${label} contains the provider secret.`);
  }
  return text;
}

function parseJson(text, label) {
  try {
    return JSON.parse(text);
  } catch {
    throw new Error(`${label} is not valid JSON.`);
  }
}

function validatePartitionManifest(manifest) {
  const value = assertPlainObject(manifest, 'partition manifest');
  if (value.partitionVersion !== 1) {
    throw new RangeError('partitionVersion must equal 1.');
  }
  const activeSeason = assertInteger(value.activeSeason, 'activeSeason');
  const evidenceSetSha256 = assertSha256(
    value.evidenceSetSha256,
    'evidenceSetSha256',
  );
  const shardCollectionRoot = assertNonEmptyString(
    value.shardCollectionRoot,
    'shardCollectionRoot',
  );
  const periods = assertPlainObject(value.periods, 'periods');
  const selectionBoundary = assertPlainObject(
    value.selectionBoundary,
    'selectionBoundary',
  );
  if (selectionBoundary.testMetricsForbiddenDuringCandidateSelection !== true) {
    throw new RangeError(
      'partition must forbid untouched-test metrics during candidate selection.',
    );
  }

  for (const periodId of [...INCLUDED_PERIODS, 'test']) {
    const period = assertPlainObject(periods[periodId], `periods.${periodId}`);
    assertNonEmptyString(period.startDate, `periods.${periodId}.startDate`);
    assertNonEmptyString(period.endDate, `periods.${periodId}.endDate`);
    assertNonNegativeInteger(period.shardCount, `periods.${periodId}.shardCount`);
    assertNonNegativeInteger(period.gameCount, `periods.${periodId}.gameCount`);
    assertNonNegativeInteger(
      period.plateAppearanceCount,
      `periods.${periodId}.plateAppearanceCount`,
    );
    assertArray(period.shards, `periods.${periodId}.shards`);
    if (period.shards.length !== period.shardCount) {
      throw new Error(`${periodId} shardCount does not match its shard list.`);
    }
  }

  return Object.freeze({
    value,
    activeSeason,
    evidenceSetSha256,
    shardCollectionRoot,
    periods,
  });
}

function validateExpectedShardDates(periodId, period, activeSeason) {
  const expectedDates = enumerateCurrentSeasonDates({
    startDate: period.startDate,
    endDate: period.endDate,
    activeSeason,
  });
  const actualDates = period.shards.map((shard, index) =>
    assertNonEmptyString(
      assertPlainObject(shard, `${periodId}.shards[${index}]`).date,
      `${periodId}.shards[${index}].date`,
    ),
  );
  if (JSON.stringify(actualDates) !== JSON.stringify(expectedDates)) {
    throw new Error(`${periodId} shard dates are not complete and chronological.`);
  }
}

function rowIdentity(date, gameId, paNumber) {
  return `${date}:${gameId}:${paNumber}`;
}

function mapRow({
  rawPlateAppearance,
  date,
  gameId,
  snapshotPath,
  snapshotSha256,
  normalizeTerminalPa,
}) {
  const raw = assertPlainObject(rawPlateAppearance, 'raw plate appearance');
  const paNumber = assertInteger(raw.pa_number, 'raw plate appearance pa_number');
  const mapping = assertPlainObject(
    normalizeTerminalPa({
      plateAppearance: raw,
      providerGameId: gameId,
      sourceSnapshotSha256: snapshotSha256,
    }),
    'terminal PA mapping result',
  );

  const common = {
    rowId: rowIdentity(date, gameId, paNumber),
    observedDate: date,
    providerGameId: gameId,
    providerPaNumber: paNumber,
    providerBatterId: assertInteger(
      raw.batter_id,
      'raw plate appearance batter_id',
    ),
    providerPitcherId: assertInteger(
      raw.pitcher_id,
      'raw plate appearance pitcher_id',
    ),
    inning: assertInteger(raw.inning, 'raw plate appearance inning'),
    halfInning: assertNonEmptyString(
      raw.half_inning,
      'raw plate appearance half_inning',
    ),
    rawResult: assertNonEmptyString(raw.result, 'raw plate appearance result'),
    sourceSnapshotPath: portablePath(snapshotPath),
    sourceSnapshotSha256: snapshotSha256,
  };

  if (mapping.status === 'normalized') {
    const terminalPa = assertPlainObject(mapping.terminalPa, 'normalized terminal PA');
    return Object.freeze({
      ...common,
      mappingStatus: 'normalized',
      terminalCategory: assertNonEmptyString(
        terminalPa.terminalCategory,
        'terminalCategory',
      ),
      rejectionReason: null,
      includedInTerminalPaModel: true,
    });
  }

  if (mapping.status === 'baserunning-only') {
    return Object.freeze({
      ...common,
      mappingStatus: 'baserunning-only',
      terminalCategory: null,
      rejectionReason: null,
      includedInTerminalPaModel: false,
    });
  }

  if (mapping.status === 'rejected' && mapping.reason === 'context-required') {
    return Object.freeze({
      ...common,
      mappingStatus: 'context-required',
      terminalCategory: null,
      rejectionReason: 'context-required',
      includedInTerminalPaModel: false,
    });
  }

  const reason =
    mapping.status === 'rejected' && typeof mapping.reason === 'string'
      ? mapping.reason
      : 'invalid-mapping-result';
  throw new Error(
    `plate appearance ${common.rowId} failed closed during normalization: ${reason}.`,
  );
}

async function readPeriodRows({
  periodId,
  period,
  activeSeason,
  shardCollectionRoot,
  secret,
  verifyCaptureDirectory,
  normalizeTerminalPa,
}) {
  validateExpectedShardDates(periodId, period, activeSeason);
  const rows = [];
  const seenRowIds = new Set();
  let verifiedGames = 0;
  let verifiedPlateAppearances = 0;

  for (const [shardIndex, rawShard] of period.shards.entries()) {
    const shard = assertPlainObject(rawShard, `${periodId}.shards[${shardIndex}]`);
    const date = assertNonEmptyString(shard.date, `${periodId} shard date`);
    const shardRoot = path.join(shardCollectionRoot, date);
    const verification = await verifyCaptureDirectory({
      captureRoot: shardRoot,
      expectedActiveSeason: activeSeason,
      secret,
    });
    if (
      verification.status !== 'verified' ||
      verification.startDate !== date ||
      verification.endDate !== date
    ) {
      throw new Error(`shard ${date} failed recency-dataset identity verification.`);
    }

    const relativeManifestPath = assertNonEmptyString(
      shard.captureManifestPath,
      `${periodId} shard captureManifestPath`,
    );
    const manifestPath = path.join(shardCollectionRoot, relativeManifestPath);
    const manifestText = await readTextChecked(
      manifestPath,
      `shard ${date} capture manifest`,
      secret,
    );
    const actualManifestSha256 = sha256(manifestText);
    const expectedManifestSha256 = assertSha256(
      shard.captureManifestSha256,
      `${periodId} shard captureManifestSha256`,
    );
    if (actualManifestSha256 !== expectedManifestSha256) {
      throw new Error(`shard ${date} capture-manifest hash drifted from partition.`);
    }

    const captureManifest = assertPlainObject(
      parseJson(manifestText, `shard ${date} capture manifest`),
      `shard ${date} capture manifest`,
    );
    const dateCaptures = assertArray(
      captureManifest.dateCaptures,
      `shard ${date} dateCaptures`,
    );
    if (dateCaptures.length !== 1 || dateCaptures[0]?.date !== date) {
      throw new Error(`shard ${date} must contain exactly one matching date capture.`);
    }
    const games = assertArray(
      assertPlainObject(dateCaptures[0], `shard ${date} date capture`).games,
      `shard ${date} games`,
    );

    for (const [gameIndex, rawGame] of games.entries()) {
      const game = assertPlainObject(rawGame, `shard ${date} games[${gameIndex}]`);
      const gameId = assertInteger(game.gameId, `shard ${date} gameId`);
      const snapshot = assertPlainObject(
        game.plateAppearancesSnapshot,
        `game ${gameId} plateAppearancesSnapshot`,
      );
      const relativeSnapshotPath = assertNonEmptyString(
        snapshot.filePath,
        `game ${gameId} snapshot filePath`,
      );
      const snapshotPath = path.join(shardRoot, relativeSnapshotPath);
      const snapshotText = await readTextChecked(
        snapshotPath,
        `game ${gameId} plate-appearance snapshot`,
        secret,
      );
      const snapshotSha256 = assertSha256(
        snapshot.savedBodySha256,
        `game ${gameId} savedBodySha256`,
      );
      if (sha256(snapshotText) !== snapshotSha256) {
        throw new Error(`game ${gameId} saved snapshot hash mismatch.`);
      }
      const snapshotBody = assertPlainObject(
        parseJson(snapshotText, `game ${gameId} snapshot`),
        `game ${gameId} snapshot`,
      );
      const data = assertArray(snapshotBody.data, `game ${gameId} snapshot data`);
      if (
        data.length !==
        assertNonNegativeInteger(snapshot.recordCount, `game ${gameId} recordCount`)
      ) {
        throw new Error(`game ${gameId} recordCount drifted from its snapshot.`);
      }

      for (const rawPlateAppearance of data) {
        const row = mapRow({
          rawPlateAppearance,
          date,
          gameId,
          snapshotPath: path.relative(shardCollectionRoot, snapshotPath),
          snapshotSha256,
          normalizeTerminalPa,
        });
        if (seenRowIds.has(row.rowId)) {
          throw new Error(`duplicate plate-appearance row identity: ${row.rowId}.`);
        }
        seenRowIds.add(row.rowId);
        rows.push(row);
      }
      verifiedGames += 1;
      verifiedPlateAppearances += data.length;
    }
  }

  rows.sort((left, right) =>
    left.observedDate.localeCompare(right.observedDate) ||
    left.providerGameId - right.providerGameId ||
    left.providerPaNumber - right.providerPaNumber,
  );

  if (verifiedGames !== period.gameCount) {
    throw new Error(`${periodId} verified game count drifted from partition.`);
  }
  if (verifiedPlateAppearances !== period.plateAppearanceCount) {
    throw new Error(`${periodId} verified PA count drifted from partition.`);
  }

  const normalizedCount = rows.filter(
    (row) => row.mappingStatus === 'normalized',
  ).length;
  const contextRequiredCount = rows.filter(
    (row) => row.mappingStatus === 'context-required',
  ).length;
  const baserunningOnlyCount = rows.filter(
    (row) => row.mappingStatus === 'baserunning-only',
  ).length;

  return Object.freeze({
    startDate: period.startDate,
    endDate: period.endDate,
    rowCount: rows.length,
    normalizedCount,
    contextRequiredCount,
    baserunningOnlyCount,
    terminalModelEligibleRowCount: normalizedCount,
    rows: Object.freeze(rows),
  });
}

export async function buildM8RecencyEvaluationDataset({
  partitionManifestPath,
  secret = null,
  verifyCaptureDirectory = verifyM8CaptureDirectory,
  normalizeTerminalPa,
}) {
  const manifestPath = assertNonEmptyString(
    partitionManifestPath,
    'partitionManifestPath',
  );
  if (typeof verifyCaptureDirectory !== 'function') {
    throw new TypeError('verifyCaptureDirectory must be a function.');
  }
  if (typeof normalizeTerminalPa !== 'function') {
    throw new TypeError('normalizeTerminalPa must be a function.');
  }

  const partitionText = await readTextChecked(
    manifestPath,
    'partition manifest',
    secret,
  );
  const partition = validatePartitionManifest(
    parseJson(partitionText, 'partition manifest'),
  );
  const periods = {};

  for (const periodId of INCLUDED_PERIODS) {
    periods[periodId] = await readPeriodRows({
      periodId,
      period: partition.periods[periodId],
      activeSeason: partition.activeSeason,
      shardCollectionRoot: partition.shardCollectionRoot,
      secret,
      verifyCaptureDirectory,
      normalizeTerminalPa,
    });
  }

  const untouchedTest = partition.periods.test;
  const datasetIdentity = {
    activeSeason: partition.activeSeason,
    sourcePartitionSha256: sha256(partitionText),
    sourceEvidenceSetSha256: partition.evidenceSetSha256,
    periods,
    untouchedTestReservation: {
      startDate: untouchedTest.startDate,
      endDate: untouchedTest.endDate,
      shardCount: untouchedTest.shardCount,
      gameCount: untouchedTest.gameCount,
      plateAppearanceCount: untouchedTest.plateAppearanceCount,
      rowsIncluded: false,
      allowedUse: 'final-evaluation-only-after-candidate-selection',
    },
  };

  return Object.freeze({
    datasetVersion: 1,
    purpose:
      'Preserve deterministic fit and validation PA rows for M8 recency evaluation while keeping untouched-test outcomes sealed.',
    ...datasetIdentity,
    totals: Object.freeze({
      includedRowCount:
        periods.fit.rowCount + periods.validation.rowCount,
      normalizedCount:
        periods.fit.normalizedCount + periods.validation.normalizedCount,
      contextRequiredCount:
        periods.fit.contextRequiredCount + periods.validation.contextRequiredCount,
      baserunningOnlyCount:
        periods.fit.baserunningOnlyCount + periods.validation.baserunningOnlyCount,
    }),
    datasetSha256: sha256(JSON.stringify(datasetIdentity)),
  });
}
