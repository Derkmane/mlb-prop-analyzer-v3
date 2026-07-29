import { readFile } from 'node:fs/promises';
import path from 'node:path';

import { sha256 } from './provider-probe-utils.mjs';
import { verifyM8CaptureDirectory } from './m8-capture-verification-utils.mjs';
import { enumerateCurrentSeasonDates } from './m8-recency-weighting-utils.mjs';

const SHA256_PATTERN = /^[a-f0-9]{64}$/;
const INCLUDED_PERIODS = Object.freeze(['fit', 'validation']);
const PRESERVED_UNRESOLVED_REASONS = Object.freeze([
  'missing-result',
  'unknown-result',
  'context-required',
  'context-contradiction',
]);
const PRESERVED_UNRESOLVED_REASON_SET = new Set(
  PRESERVED_UNRESOLVED_REASONS,
);

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

function assertNullableNonEmptyString(value, label) {
  return value === null ? null : assertNonEmptyString(value, label);
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

function assertBoolean(value, label) {
  if (typeof value !== 'boolean') {
    throw new TypeError(`${label} must be a boolean.`);
  }
  return value;
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

function assertTerminalIdentity(terminalPa, common) {
  if (
    assertInteger(terminalPa.providerGameId, 'classified providerGameId') !==
      common.providerGameId ||
    assertInteger(terminalPa.providerBatterId, 'classified providerBatterId') !==
      common.providerBatterId ||
    assertInteger(terminalPa.providerPitcherId, 'classified providerPitcherId') !==
      common.providerPitcherId ||
    assertInteger(terminalPa.providerPaNumber, 'classified providerPaNumber') !==
      common.providerPaNumber
  ) {
    throw new Error(
      `plate appearance ${common.rowId} classification identity drifted from raw evidence.`,
    );
  }
}

function mapRow({
  rawPlateAppearance,
  date,
  gameId,
  snapshotPath,
  snapshotSha256,
  classifyTerminalPa,
}) {
  const raw = assertPlainObject(rawPlateAppearance, 'raw plate appearance');
  const paNumber = assertInteger(raw.pa_number, 'raw plate appearance pa_number');
  const classification = assertPlainObject(
    classifyTerminalPa({
      plateAppearance: raw,
      providerGameId: gameId,
      sourceSnapshotSha256: snapshotSha256,
    }),
    'terminal PA classification result',
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
    rawBatterSide: assertNonEmptyString(
      raw.batter_side,
      'raw plate appearance batter_side',
    ),
    rawPitcherHand: assertNonEmptyString(
      raw.pitcher_hand,
      'raw plate appearance pitcher_hand',
    ),
    rawResult: assertNullableNonEmptyString(
      raw.result,
      'raw plate appearance result',
    ),
    sourceSnapshotPath: portablePath(snapshotPath),
    sourceSnapshotSha256: snapshotSha256,
  };

  if (classification.status === 'classified-terminal') {
    const terminalPa = assertPlainObject(
      classification.terminalPa,
      'classified terminal PA',
    );
    assertTerminalIdentity(terminalPa, common);
    if (terminalPa.rawResult !== common.rawResult) {
      throw new Error(
        `plate appearance ${common.rowId} classified result drifted from raw evidence.`,
      );
    }
    const overallOutcomeEligible = assertBoolean(
      classification.overallOutcomeEligible,
      'overallOutcomeEligible',
    );
    if (!overallOutcomeEligible) {
      throw new Error(
        `plate appearance ${common.rowId} classified terminal outcome must be overall eligible.`,
      );
    }
    const platoonEligible = assertBoolean(
      classification.platoonEligible,
      'platoonEligible',
    );
    const batterSide = terminalPa.batterSide;
    const pitcherHand = terminalPa.pitcherHand;
    if (
      platoonEligible !==
      (batterSide !== null && pitcherHand !== null)
    ) {
      throw new Error(
        `plate appearance ${common.rowId} platoon eligibility contradicts normalized handedness.`,
      );
    }

    return Object.freeze({
      ...common,
      mappingStatus: 'classified-terminal',
      unresolvedReason: null,
      terminalCategory: assertNonEmptyString(
        terminalPa.terminalCategory,
        'terminalCategory',
      ),
      normalizedBatterSide: batterSide,
      normalizedPitcherHand: pitcherHand,
      overallOutcomeEligible: true,
      platoonEligible,
      includedInOverallOutcomeModel: true,
      includedInPlatoonModel: platoonEligible,
    });
  }

  if (classification.status === 'baserunning-only') {
    return Object.freeze({
      ...common,
      mappingStatus: 'baserunning-only',
      unresolvedReason: null,
      terminalCategory: null,
      normalizedBatterSide: null,
      normalizedPitcherHand: null,
      overallOutcomeEligible: false,
      platoonEligible: false,
      includedInOverallOutcomeModel: false,
      includedInPlatoonModel: false,
    });
  }

  if (classification.status === 'unresolved') {
    const reason = assertNonEmptyString(
      classification.reason,
      'terminal PA unresolved reason',
    );
    if (reason === 'malformed-input') {
      throw new Error(
        `plate appearance ${common.rowId} contains malformed structural evidence.`,
      );
    }
    if (!PRESERVED_UNRESOLVED_REASON_SET.has(reason)) {
      throw new Error(
        `plate appearance ${common.rowId} returned unsupported unresolved reason: ${reason}.`,
      );
    }
    if (reason === 'missing-result' && common.rawResult !== null) {
      throw new Error(
        `plate appearance ${common.rowId} missing-result state contradicts raw evidence.`,
      );
    }
    if (reason !== 'missing-result' && common.rawResult === null) {
      throw new Error(
        `plate appearance ${common.rowId} null result must use missing-result state.`,
      );
    }

    return Object.freeze({
      ...common,
      mappingStatus: 'unresolved',
      unresolvedReason: reason,
      terminalCategory: null,
      normalizedBatterSide: null,
      normalizedPitcherHand: null,
      overallOutcomeEligible: false,
      platoonEligible: false,
      includedInOverallOutcomeModel: false,
      includedInPlatoonModel: false,
    });
  }

  throw new Error(
    `plate appearance ${common.rowId} returned an invalid classification status.`,
  );
}

function countRows(rows, predicate) {
  return rows.reduce((count, row) => count + (predicate(row) ? 1 : 0), 0);
}

async function readPeriodRows({
  periodId,
  period,
  activeSeason,
  shardCollectionRoot,
  secret,
  verifyCaptureDirectory,
  classifyTerminalPa,
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
          classifyTerminalPa,
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

  const classifiedTerminalCount = countRows(
    rows,
    (row) => row.mappingStatus === 'classified-terminal',
  );
  const baserunningOnlyCount = countRows(
    rows,
    (row) => row.mappingStatus === 'baserunning-only',
  );
  const unresolvedCount = countRows(
    rows,
    (row) => row.mappingStatus === 'unresolved',
  );
  const overallOutcomeEligibleCount = countRows(
    rows,
    (row) => row.includedInOverallOutcomeModel,
  );
  const platoonEligibleCount = countRows(
    rows,
    (row) => row.includedInPlatoonModel,
  );
  const platoonIneligibleTerminalCount = countRows(
    rows,
    (row) =>
      row.mappingStatus === 'classified-terminal' &&
      !row.includedInPlatoonModel,
  );
  const missingResultCount = countRows(
    rows,
    (row) => row.unresolvedReason === 'missing-result',
  );
  const contextRequiredCount = countRows(
    rows,
    (row) => row.unresolvedReason === 'context-required',
  );
  const unknownResultCount = countRows(
    rows,
    (row) => row.unresolvedReason === 'unknown-result',
  );
  const contextContradictionCount = countRows(
    rows,
    (row) => row.unresolvedReason === 'context-contradiction',
  );

  if (
    classifiedTerminalCount + baserunningOnlyCount + unresolvedCount !==
    rows.length
  ) {
    throw new Error(`${periodId} row-state accounting does not conserve rows.`);
  }
  if (overallOutcomeEligibleCount !== classifiedTerminalCount) {
    throw new Error(`${periodId} overall-outcome eligibility count drifted.`);
  }
  if (
    platoonEligibleCount + platoonIneligibleTerminalCount !==
    classifiedTerminalCount
  ) {
    throw new Error(`${periodId} platoon eligibility does not conserve terminal rows.`);
  }
  if (
    missingResultCount +
      contextRequiredCount +
      unknownResultCount +
      contextContradictionCount !==
    unresolvedCount
  ) {
    throw new Error(`${periodId} unresolved-reason accounting does not conserve rows.`);
  }

  return Object.freeze({
    startDate: period.startDate,
    endDate: period.endDate,
    rowCount: rows.length,
    classifiedTerminalCount,
    overallOutcomeEligibleCount,
    platoonEligibleCount,
    platoonIneligibleTerminalCount,
    baserunningOnlyCount,
    unresolvedCount,
    missingResultCount,
    contextRequiredCount,
    unknownResultCount,
    contextContradictionCount,
    rows: Object.freeze(rows),
  });
}

function sumPeriodCount(periods, key) {
  return periods.fit[key] + periods.validation[key];
}

export async function buildM8RecencyEvaluationDataset({
  partitionManifestPath,
  secret = null,
  verifyCaptureDirectory = verifyM8CaptureDirectory,
  classifyTerminalPa,
}) {
  const manifestPath = assertNonEmptyString(
    partitionManifestPath,
    'partitionManifestPath',
  );
  if (typeof verifyCaptureDirectory !== 'function') {
    throw new TypeError('verifyCaptureDirectory must be a function.');
  }
  if (typeof classifyTerminalPa !== 'function') {
    throw new TypeError('classifyTerminalPa must be a function.');
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
      classifyTerminalPa,
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
    datasetVersion: 2,
    purpose:
      'Preserve deterministic fit and validation terminal-PA evidence states for M8 recency evaluation while keeping untouched-test outcomes sealed.',
    ...datasetIdentity,
    totals: Object.freeze({
      includedRowCount: sumPeriodCount(periods, 'rowCount'),
      classifiedTerminalCount: sumPeriodCount(
        periods,
        'classifiedTerminalCount',
      ),
      overallOutcomeEligibleCount: sumPeriodCount(
        periods,
        'overallOutcomeEligibleCount',
      ),
      platoonEligibleCount: sumPeriodCount(periods, 'platoonEligibleCount'),
      platoonIneligibleTerminalCount: sumPeriodCount(
        periods,
        'platoonIneligibleTerminalCount',
      ),
      baserunningOnlyCount: sumPeriodCount(periods, 'baserunningOnlyCount'),
      unresolvedCount: sumPeriodCount(periods, 'unresolvedCount'),
      missingResultCount: sumPeriodCount(periods, 'missingResultCount'),
      contextRequiredCount: sumPeriodCount(periods, 'contextRequiredCount'),
      unknownResultCount: sumPeriodCount(periods, 'unknownResultCount'),
      contextContradictionCount: sumPeriodCount(
        periods,
        'contextContradictionCount',
      ),
    }),
    datasetSha256: sha256(JSON.stringify(datasetIdentity)),
  });
}
