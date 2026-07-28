import { sha256 } from './provider-probe-utils.mjs';
import { assertCurrentSeasonDate } from './m8-recency-weighting-utils.mjs';

const SHA256_PATTERN = /^[a-f0-9]{64}$/;
const INCLUDED_PERIODS = Object.freeze(['fit', 'validation']);
const SOURCE_MAPPING_STATUSES = new Set([
  'classified-terminal',
  'baserunning-only',
  'unresolved',
]);
const SOURCE_UNRESOLVED_REASONS = new Set([
  'missing-result',
  'unknown-result',
  'context-required',
  'context-contradiction',
]);
const RESOLUTION_STATUSES = new Set([
  'resolved-terminal',
  'baserunning-only',
  'unresolved',
]);
const RESOLVED_TERMINAL_CATEGORIES = new Set(['BIP_OUT', 'FC', 'K']);
const RESOLUTION_UNRESOLVED_REASONS = new Set([
  'conflicting-exact-terminal-markers',
  'missing-exact-terminal-marker',
  'segment-match-multiple',
  'segment-match-zero',
]);

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

function assertPositiveInteger(value, label) {
  const integer = assertInteger(value, label);
  if (integer <= 0) throw new RangeError(`${label} must be positive.`);
  return integer;
}

function assertNonNegativeInteger(value, label) {
  const integer = assertInteger(value, label);
  if (integer < 0) throw new RangeError(`${label} must be non-negative.`);
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

function normalizeHandedness(value) {
  return value === 'L' || value === 'R' ? value : null;
}

function sortedCountObject(counts) {
  return Object.freeze(
    Object.fromEntries(
      Object.entries(counts).sort(([left], [right]) => left.localeCompare(right)),
    ),
  );
}

function increment(counts, key) {
  counts[key] = (counts[key] ?? 0) + 1;
}

function sumObjectValues(object) {
  return Object.values(object).reduce((sum, value) => sum + value, 0);
}

function sourceDatasetIdentity(dataset) {
  return {
    activeSeason: dataset.activeSeason,
    sourcePartitionSha256: dataset.sourcePartitionSha256,
    sourceEvidenceSetSha256: dataset.sourceEvidenceSetSha256,
    periods: dataset.periods,
    untouchedTestReservation: dataset.untouchedTestReservation,
  };
}

function resolutionIdentity(resolution) {
  return {
    activeSeason: resolution.activeSeason,
    sourceAuditSha256: resolution.sourceAuditSha256,
    sourceAuditFileSha256: resolution.sourceAuditFileSha256,
    sourceDatasetSha256: resolution.sourceDatasetSha256,
    sourceCaptureSha256: resolution.sourceCaptureSha256,
    contextRowCount: resolution.contextRowCount,
    resultCounts: resolution.resultCounts,
    resolutionStatusCounts: resolution.resolutionStatusCounts,
    terminalCategoryCounts: resolution.terminalCategoryCounts,
    unresolvedReasonCounts: resolution.unresolvedReasonCounts,
    rows: resolution.rows,
    untouchedTestReservation: resolution.untouchedTestReservation,
    untouchedTestRowsRead: resolution.untouchedTestRowsRead,
  };
}

function rowIdentity(row) {
  return `${row.observedDate}:${row.providerGameId}:${row.providerPaNumber}`;
}

function validateSourceRow(rawRow, activeSeason, periodId, index) {
  const label = `${periodId}.rows[${index}]`;
  const row = assertPlainObject(rawRow, label);
  const observedDate = assertNonEmptyString(row.observedDate, `${label}.observedDate`);
  assertCurrentSeasonDate(observedDate, activeSeason, `${label}.observedDate`);
  const providerGameId = assertPositiveInteger(
    row.providerGameId,
    `${label}.providerGameId`,
  );
  const providerPaNumber = assertPositiveInteger(
    row.providerPaNumber,
    `${label}.providerPaNumber`,
  );
  assertPositiveInteger(row.providerBatterId, `${label}.providerBatterId`);
  assertPositiveInteger(row.providerPitcherId, `${label}.providerPitcherId`);
  assertPositiveInteger(row.inning, `${label}.inning`);
  assertNonEmptyString(row.halfInning, `${label}.halfInning`);
  const rawBatterSide = assertNonEmptyString(
    row.rawBatterSide,
    `${label}.rawBatterSide`,
  );
  const rawPitcherHand = assertNonEmptyString(
    row.rawPitcherHand,
    `${label}.rawPitcherHand`,
  );
  const rawResult = assertNullableNonEmptyString(row.rawResult, `${label}.rawResult`);
  assertNonEmptyString(row.sourceSnapshotPath, `${label}.sourceSnapshotPath`);
  assertSha256(row.sourceSnapshotSha256, `${label}.sourceSnapshotSha256`);
  const expectedRowId = `${observedDate}:${providerGameId}:${providerPaNumber}`;
  if (assertNonEmptyString(row.rowId, `${label}.rowId`) !== expectedRowId) {
    throw new Error(`${label}.rowId does not match provider identity.`);
  }

  const mappingStatus = assertNonEmptyString(
    row.mappingStatus,
    `${label}.mappingStatus`,
  );
  if (!SOURCE_MAPPING_STATUSES.has(mappingStatus)) {
    throw new Error(`${label}.mappingStatus is unsupported.`);
  }
  const unresolvedReason = assertNullableNonEmptyString(
    row.unresolvedReason,
    `${label}.unresolvedReason`,
  );
  const terminalCategory = assertNullableNonEmptyString(
    row.terminalCategory,
    `${label}.terminalCategory`,
  );
  const normalizedBatterSide = row.normalizedBatterSide;
  const normalizedPitcherHand = row.normalizedPitcherHand;
  if (
    normalizedBatterSide !== null &&
    normalizedBatterSide !== 'L' &&
    normalizedBatterSide !== 'R'
  ) {
    throw new Error(`${label}.normalizedBatterSide is invalid.`);
  }
  if (
    normalizedPitcherHand !== null &&
    normalizedPitcherHand !== 'L' &&
    normalizedPitcherHand !== 'R'
  ) {
    throw new Error(`${label}.normalizedPitcherHand is invalid.`);
  }
  const overallOutcomeEligible = assertBoolean(
    row.overallOutcomeEligible,
    `${label}.overallOutcomeEligible`,
  );
  const platoonEligible = assertBoolean(
    row.platoonEligible,
    `${label}.platoonEligible`,
  );
  const includedInOverallOutcomeModel = assertBoolean(
    row.includedInOverallOutcomeModel,
    `${label}.includedInOverallOutcomeModel`,
  );
  const includedInPlatoonModel = assertBoolean(
    row.includedInPlatoonModel,
    `${label}.includedInPlatoonModel`,
  );

  if (mappingStatus === 'classified-terminal') {
    if (unresolvedReason !== null || terminalCategory === null) {
      throw new Error(`${label} classified terminal state is incomplete.`);
    }
    const expectedBatterSide = normalizeHandedness(rawBatterSide);
    const expectedPitcherHand = normalizeHandedness(rawPitcherHand);
    const expectedPlatoonEligible =
      expectedBatterSide !== null && expectedPitcherHand !== null;
    if (
      normalizedBatterSide !== expectedBatterSide ||
      normalizedPitcherHand !== expectedPitcherHand ||
      overallOutcomeEligible !== true ||
      includedInOverallOutcomeModel !== true ||
      platoonEligible !== expectedPlatoonEligible ||
      includedInPlatoonModel !== expectedPlatoonEligible
    ) {
      throw new Error(`${label} classified terminal eligibility is inconsistent.`);
    }
  } else if (mappingStatus === 'baserunning-only') {
    if (
      unresolvedReason !== null ||
      terminalCategory !== null ||
      normalizedBatterSide !== null ||
      normalizedPitcherHand !== null ||
      overallOutcomeEligible !== false ||
      platoonEligible !== false ||
      includedInOverallOutcomeModel !== false ||
      includedInPlatoonModel !== false
    ) {
      throw new Error(`${label} baserunning-only state is inconsistent.`);
    }
  } else {
    if (!SOURCE_UNRESOLVED_REASONS.has(unresolvedReason)) {
      throw new Error(`${label} unresolved reason is unsupported.`);
    }
    if (
      terminalCategory !== null ||
      normalizedBatterSide !== null ||
      normalizedPitcherHand !== null ||
      overallOutcomeEligible !== false ||
      platoonEligible !== false ||
      includedInOverallOutcomeModel !== false ||
      includedInPlatoonModel !== false
    ) {
      throw new Error(`${label} unresolved state is inconsistent.`);
    }
    if ((rawResult === null) !== (unresolvedReason === 'missing-result')) {
      throw new Error(`${label} missing-result state contradicts raw evidence.`);
    }
  }

  return row;
}

function summarizeRows(rows) {
  const counts = {
    rowCount: rows.length,
    classifiedTerminalCount: 0,
    overallOutcomeEligibleCount: 0,
    platoonEligibleCount: 0,
    platoonIneligibleTerminalCount: 0,
    baserunningOnlyCount: 0,
    unresolvedCount: 0,
    missingResultCount: 0,
    contextRequiredCount: 0,
    unknownResultCount: 0,
    contextContradictionCount: 0,
  };
  for (const row of rows) {
    if (row.mappingStatus === 'classified-terminal') {
      counts.classifiedTerminalCount += 1;
      if (row.includedInOverallOutcomeModel) counts.overallOutcomeEligibleCount += 1;
      if (row.includedInPlatoonModel) counts.platoonEligibleCount += 1;
      else counts.platoonIneligibleTerminalCount += 1;
    } else if (row.mappingStatus === 'baserunning-only') {
      counts.baserunningOnlyCount += 1;
    } else {
      counts.unresolvedCount += 1;
      if (row.unresolvedReason === 'missing-result') counts.missingResultCount += 1;
      if (row.unresolvedReason === 'context-required') counts.contextRequiredCount += 1;
      if (row.unresolvedReason === 'unknown-result') counts.unknownResultCount += 1;
      if (row.unresolvedReason === 'context-contradiction') {
        counts.contextContradictionCount += 1;
      }
    }
  }
  return counts;
}

function assertPeriodSummary(period, rows, periodId) {
  const summary = summarizeRows(rows);
  for (const [key, expected] of Object.entries(summary)) {
    if (assertNonNegativeInteger(period[key], `${periodId}.${key}`) !== expected) {
      throw new Error(`${periodId}.${key} does not match its rows.`);
    }
  }
}

function validateSourceDataset(rawDataset) {
  const dataset = assertPlainObject(rawDataset, 'source dataset');
  if (dataset.datasetVersion !== 2) {
    throw new Error('source datasetVersion must equal 2.');
  }
  const activeSeason = assertPositiveInteger(dataset.activeSeason, 'activeSeason');
  assertSha256(dataset.sourcePartitionSha256, 'sourcePartitionSha256');
  assertSha256(dataset.sourceEvidenceSetSha256, 'sourceEvidenceSetSha256');
  const periods = assertPlainObject(dataset.periods, 'periods');
  const seenRowIds = new Set();
  for (const periodId of INCLUDED_PERIODS) {
    const period = assertPlainObject(periods[periodId], `periods.${periodId}`);
    const startDate = assertNonEmptyString(period.startDate, `${periodId}.startDate`);
    const endDate = assertNonEmptyString(period.endDate, `${periodId}.endDate`);
    assertCurrentSeasonDate(startDate, activeSeason, `${periodId}.startDate`);
    assertCurrentSeasonDate(endDate, activeSeason, `${periodId}.endDate`);
    if (startDate > endDate) throw new Error(`${periodId} dates are reversed.`);
    const rows = assertArray(period.rows, `${periodId}.rows`).map((row, index) =>
      validateSourceRow(row, activeSeason, periodId, index),
    );
    for (const row of rows) {
      if (row.observedDate < startDate || row.observedDate > endDate) {
        throw new Error(`${periodId} row falls outside its period.`);
      }
      if (seenRowIds.has(row.rowId)) {
        throw new Error(`duplicate source dataset rowId ${row.rowId}.`);
      }
      seenRowIds.add(row.rowId);
    }
    assertPeriodSummary(period, rows, periodId);
  }

  const untouched = assertPlainObject(
    dataset.untouchedTestReservation,
    'untouchedTestReservation',
  );
  assertCurrentSeasonDate(untouched.startDate, activeSeason, 'untouched startDate');
  assertCurrentSeasonDate(untouched.endDate, activeSeason, 'untouched endDate');
  assertNonNegativeInteger(untouched.shardCount, 'untouched shardCount');
  assertNonNegativeInteger(untouched.gameCount, 'untouched gameCount');
  assertNonNegativeInteger(
    untouched.plateAppearanceCount,
    'untouched plateAppearanceCount',
  );
  if (untouched.rowsIncluded !== false || Object.hasOwn(untouched, 'rows')) {
    throw new Error('source dataset must keep untouched-test rows excluded.');
  }
  assertNonEmptyString(untouched.allowedUse, 'untouched allowedUse');

  const totals = assertPlainObject(dataset.totals, 'totals');
  const totalKeys = Object.keys(summarizeRows([]));
  const totalKeyMap = {
    rowCount: 'includedRowCount',
    classifiedTerminalCount: 'classifiedTerminalCount',
    overallOutcomeEligibleCount: 'overallOutcomeEligibleCount',
    platoonEligibleCount: 'platoonEligibleCount',
    platoonIneligibleTerminalCount: 'platoonIneligibleTerminalCount',
    baserunningOnlyCount: 'baserunningOnlyCount',
    unresolvedCount: 'unresolvedCount',
    missingResultCount: 'missingResultCount',
    contextRequiredCount: 'contextRequiredCount',
    unknownResultCount: 'unknownResultCount',
    contextContradictionCount: 'contextContradictionCount',
  };
  for (const key of totalKeys) {
    const expected = INCLUDED_PERIODS.reduce(
      (sum, periodId) => sum + periods[periodId][key],
      0,
    );
    const totalKey = totalKeyMap[key];
    if (assertNonNegativeInteger(totals[totalKey], `totals.${totalKey}`) !== expected) {
      throw new Error(`totals.${totalKey} does not match periods.`);
    }
  }

  const expectedDatasetSha256 = sha256(JSON.stringify(sourceDatasetIdentity(dataset)));
  if (assertSha256(dataset.datasetSha256, 'datasetSha256') !== expectedDatasetSha256) {
    throw new Error('source dataset identity SHA-256 is invalid.');
  }
  return dataset;
}

function validateResolutionRow(rawRow, activeSeason, index) {
  const label = `resolution.rows[${index}]`;
  const row = assertPlainObject(rawRow, label);
  const observedDate = assertNonEmptyString(row.observedDate, `${label}.observedDate`);
  assertCurrentSeasonDate(observedDate, activeSeason, `${label}.observedDate`);
  const providerGameId = assertPositiveInteger(
    row.providerGameId,
    `${label}.providerGameId`,
  );
  const providerPaNumber = assertPositiveInteger(
    row.providerPaNumber,
    `${label}.providerPaNumber`,
  );
  assertPositiveInteger(row.providerBatterId, `${label}.providerBatterId`);
  assertPositiveInteger(row.providerPitcherId, `${label}.providerPitcherId`);
  assertPositiveInteger(row.inning, `${label}.inning`);
  assertNonEmptyString(row.halfInning, `${label}.halfInning`);
  assertNonEmptyString(row.rawResult, `${label}.rawResult`);
  if (
    assertNonEmptyString(row.rowId, `${label}.rowId`) !==
    `${observedDate}:${providerGameId}:${providerPaNumber}`
  ) {
    throw new Error(`${label}.rowId does not match provider identity.`);
  }
  const segmentMatchStatus = assertNonEmptyString(
    row.segmentMatchStatus,
    `${label}.segmentMatchStatus`,
  );
  if (!['zero', 'unique', 'multiple'].includes(segmentMatchStatus)) {
    throw new Error(`${label}.segmentMatchStatus is invalid.`);
  }
  const candidateSegmentCount = assertNonNegativeInteger(
    row.candidateSegmentCount,
    `${label}.candidateSegmentCount`,
  );
  if (
    (segmentMatchStatus === 'zero' && candidateSegmentCount !== 0) ||
    (segmentMatchStatus === 'unique' && candidateSegmentCount !== 1) ||
    (segmentMatchStatus === 'multiple' && candidateSegmentCount < 2)
  ) {
    throw new Error(`${label} segment match count is inconsistent.`);
  }
  const resolutionStatus = assertNonEmptyString(
    row.resolutionStatus,
    `${label}.resolutionStatus`,
  );
  if (!RESOLUTION_STATUSES.has(resolutionStatus)) {
    throw new Error(`${label}.resolutionStatus is unsupported.`);
  }
  const terminalCategory = assertNullableNonEmptyString(
    row.terminalCategory,
    `${label}.terminalCategory`,
  );
  const batterDisposition = assertNullableNonEmptyString(
    row.batterDisposition,
    `${label}.batterDisposition`,
  );
  const baserunningEvent = assertNullableNonEmptyString(
    row.baserunningEvent,
    `${label}.baserunningEvent`,
  );
  const resolutionReason = assertNonEmptyString(
    row.resolutionReason,
    `${label}.resolutionReason`,
  );
  const evidenceMarkers = Object.freeze(
    assertArray(row.evidenceMarkers, `${label}.evidenceMarkers`).map((marker, markerIndex) =>
      assertNonEmptyString(marker, `${label}.evidenceMarkers[${markerIndex}]`),
    ),
  );

  if (resolutionStatus === 'resolved-terminal') {
    if (
      segmentMatchStatus !== 'unique' ||
      !RESOLVED_TERMINAL_CATEGORIES.has(terminalCategory) ||
      baserunningEvent !== null ||
      resolutionReason !== 'exact-provider-terminal-marker'
    ) {
      throw new Error(`${label} resolved terminal state is inconsistent.`);
    }
    const expectedDisposition = terminalCategory === 'FC' ? 'reached' : 'retired';
    if (batterDisposition !== expectedDisposition || evidenceMarkers.length === 0) {
      throw new Error(`${label} resolved terminal evidence is incomplete.`);
    }
  } else if (resolutionStatus === 'baserunning-only') {
    if (
      terminalCategory !== null ||
      batterDisposition !== null ||
      baserunningEvent !== 'CS' ||
      resolutionReason !== 'provider-result-is-baserunning-only' ||
      evidenceMarkers.length !== 0
    ) {
      throw new Error(`${label} baserunning-only resolution is inconsistent.`);
    }
  } else if (
    terminalCategory !== null ||
    batterDisposition !== null ||
    baserunningEvent !== null ||
    !RESOLUTION_UNRESOLVED_REASONS.has(resolutionReason)
  ) {
    throw new Error(`${label} unresolved resolution state is inconsistent.`);
  }
  return row;
}

function validateResolution(rawResolution) {
  const resolution = assertPlainObject(rawResolution, 'resolution');
  if (resolution.resolutionVersion !== 1) {
    throw new Error('resolutionVersion must equal 1.');
  }
  const activeSeason = assertPositiveInteger(resolution.activeSeason, 'resolution activeSeason');
  assertSha256(resolution.sourceAuditSha256, 'resolution sourceAuditSha256');
  assertSha256(resolution.sourceAuditFileSha256, 'resolution sourceAuditFileSha256');
  assertSha256(resolution.sourceDatasetSha256, 'resolution sourceDatasetSha256');
  assertSha256(resolution.sourceCaptureSha256, 'resolution sourceCaptureSha256');
  const rows = assertArray(resolution.rows, 'resolution rows').map((row, index) =>
    validateResolutionRow(row, activeSeason, index),
  );
  if (
    rows.length !==
    assertNonNegativeInteger(resolution.contextRowCount, 'resolution contextRowCount')
  ) {
    throw new Error('resolution contextRowCount does not match rows.');
  }
  const seenRowIds = new Set();
  const statusCounts = {};
  const terminalCounts = {};
  const unresolvedCounts = {};
  const resultCounts = {};
  for (const row of rows) {
    if (seenRowIds.has(row.rowId)) {
      throw new Error(`duplicate resolution rowId ${row.rowId}.`);
    }
    seenRowIds.add(row.rowId);
    increment(statusCounts, row.resolutionStatus);
    increment(resultCounts, row.rawResult);
    if (row.terminalCategory !== null) increment(terminalCounts, row.terminalCategory);
    if (row.resolutionStatus === 'unresolved') {
      increment(unresolvedCounts, row.resolutionReason);
    }
  }
  const reportedObjects = [
    ['resultCounts', resultCounts],
    ['resolutionStatusCounts', statusCounts],
    ['terminalCategoryCounts', terminalCounts],
    ['unresolvedReasonCounts', unresolvedCounts],
  ];
  for (const [key, observed] of reportedObjects) {
    const reported = assertPlainObject(resolution[key], `resolution ${key}`);
    const allKeys = new Set([...Object.keys(observed), ...Object.keys(reported)]);
    for (const countKey of allKeys) {
      if (
        assertNonNegativeInteger(reported[countKey] ?? 0, `resolution ${key}.${countKey}`) !==
        (observed[countKey] ?? 0)
      ) {
        throw new Error(`resolution ${key} does not match rows.`);
      }
    }
  }
  if (
    sumObjectValues(resolution.resolutionStatusCounts) !== rows.length ||
    sumObjectValues(resolution.terminalCategoryCounts) !==
      (statusCounts['resolved-terminal'] ?? 0) ||
    sumObjectValues(resolution.unresolvedReasonCounts) !== (statusCounts.unresolved ?? 0)
  ) {
    throw new Error('resolution accounting does not conserve rows.');
  }
  const untouched = assertPlainObject(
    resolution.untouchedTestReservation,
    'resolution untouchedTestReservation',
  );
  assertCurrentSeasonDate(untouched.startDate, activeSeason, 'resolution untouched startDate');
  assertCurrentSeasonDate(untouched.endDate, activeSeason, 'resolution untouched endDate');
  assertNonNegativeInteger(
    untouched.plateAppearanceCount,
    'resolution untouched plateAppearanceCount',
  );
  if (
    untouched.rowsIncluded !== false ||
    resolution.untouchedTestRowsRead !== false ||
    Object.hasOwn(untouched, 'rows')
  ) {
    throw new Error('resolution must keep untouched-test rows sealed.');
  }
  const expectedResolutionSha256 = sha256(JSON.stringify(resolutionIdentity(resolution)));
  if (
    assertSha256(resolution.resolutionSha256, 'resolutionSha256') !==
    expectedResolutionSha256
  ) {
    throw new Error('resolution identity SHA-256 is invalid.');
  }
  return resolution;
}

function assertResolutionIdentityMatchesSource(sourceRow, resolutionRow) {
  const fields = [
    'rowId',
    'observedDate',
    'providerGameId',
    'providerPaNumber',
    'providerBatterId',
    'providerPitcherId',
    'inning',
    'halfInning',
    'rawResult',
  ];
  for (const field of fields) {
    if (sourceRow[field] !== resolutionRow[field]) {
      throw new Error(`context resolution identity drifted for ${sourceRow.rowId}: ${field}.`);
    }
  }
}

function contextEvidence(resolutionRow) {
  return Object.freeze({
    resolutionVersion: 1,
    resolutionStatus: resolutionRow.resolutionStatus,
    resolutionReason: resolutionRow.resolutionReason,
    terminalCategory: resolutionRow.terminalCategory,
    batterDisposition: resolutionRow.batterDisposition,
    baserunningEvent: resolutionRow.baserunningEvent,
    evidenceMarkers: Object.freeze([...resolutionRow.evidenceMarkers]),
    segmentMatchStatus: resolutionRow.segmentMatchStatus,
    candidateSegmentCount: resolutionRow.candidateSegmentCount,
  });
}

function applyResolution(sourceRow, resolutionRow) {
  assertResolutionIdentityMatchesSource(sourceRow, resolutionRow);
  const contextResolution = contextEvidence(resolutionRow);
  if (resolutionRow.resolutionStatus === 'resolved-terminal') {
    const normalizedBatterSide = normalizeHandedness(sourceRow.rawBatterSide);
    const normalizedPitcherHand = normalizeHandedness(sourceRow.rawPitcherHand);
    const platoonEligible =
      normalizedBatterSide !== null && normalizedPitcherHand !== null;
    return Object.freeze({
      ...sourceRow,
      mappingStatus: 'classified-terminal',
      unresolvedReason: null,
      terminalCategory: resolutionRow.terminalCategory,
      normalizedBatterSide,
      normalizedPitcherHand,
      overallOutcomeEligible: true,
      platoonEligible,
      includedInOverallOutcomeModel: true,
      includedInPlatoonModel: platoonEligible,
      contextResolution,
    });
  }
  if (resolutionRow.resolutionStatus === 'baserunning-only') {
    return Object.freeze({
      ...sourceRow,
      mappingStatus: 'baserunning-only',
      unresolvedReason: null,
      terminalCategory: null,
      normalizedBatterSide: null,
      normalizedPitcherHand: null,
      overallOutcomeEligible: false,
      platoonEligible: false,
      includedInOverallOutcomeModel: false,
      includedInPlatoonModel: false,
      contextResolution,
    });
  }
  return Object.freeze({
    ...sourceRow,
    contextResolution,
  });
}

function buildResolvedPeriod(periodId, sourcePeriod, resolutionByRowId, usedResolutionIds) {
  const rows = Object.freeze(
    sourcePeriod.rows.map((sourceRow) => {
      if (
        sourceRow.mappingStatus !== 'unresolved' ||
        sourceRow.unresolvedReason !== 'context-required'
      ) {
        return Object.freeze({ ...sourceRow });
      }
      const resolutionRow = resolutionByRowId.get(sourceRow.rowId);
      if (resolutionRow === undefined) {
        throw new Error(`missing context resolution row ${sourceRow.rowId}.`);
      }
      usedResolutionIds.add(sourceRow.rowId);
      return applyResolution(sourceRow, resolutionRow);
    }),
  );
  const base = summarizeRows(rows);
  const contextRows = rows.filter((row) => Object.hasOwn(row, 'contextResolution'));
  const contextResolutionStatusCounts = {};
  const terminalCategoryCounts = {};
  for (const row of rows) {
    if (row.terminalCategory !== null) increment(terminalCategoryCounts, row.terminalCategory);
  }
  for (const row of contextRows) {
    increment(
      contextResolutionStatusCounts,
      row.contextResolution.resolutionStatus,
    );
  }
  const contextResolutionAppliedCount = contextRows.length;
  const resolvedContextTerminalCount =
    contextResolutionStatusCounts['resolved-terminal'] ?? 0;
  const resolvedContextBaserunningCount =
    contextResolutionStatusCounts['baserunning-only'] ?? 0;
  const remainingContextUnresolvedCount =
    contextResolutionStatusCounts.unresolved ?? 0;
  if (
    resolvedContextTerminalCount +
      resolvedContextBaserunningCount +
      remainingContextUnresolvedCount !==
    contextResolutionAppliedCount
  ) {
    throw new Error(`${periodId} context-resolution accounting does not conserve rows.`);
  }
  return Object.freeze({
    startDate: sourcePeriod.startDate,
    endDate: sourcePeriod.endDate,
    ...base,
    contextResolutionAppliedCount,
    resolvedContextTerminalCount,
    resolvedContextBaserunningCount,
    remainingContextUnresolvedCount,
    terminalCategoryCounts: sortedCountObject(terminalCategoryCounts),
    rows,
  });
}

function mergeCountObjects(periods, key) {
  const merged = {};
  for (const periodId of INCLUDED_PERIODS) {
    for (const [countKey, value] of Object.entries(periods[periodId][key])) {
      merged[countKey] = (merged[countKey] ?? 0) + value;
    }
  }
  return sortedCountObject(merged);
}

function sumPeriodCount(periods, key) {
  return INCLUDED_PERIODS.reduce((sum, periodId) => sum + periods[periodId][key], 0);
}

export function buildM8ResolvedCategoricalDataset({
  dataset: rawDataset,
  resolution: rawResolution,
  sourceDatasetFileSha256,
  sourceResolutionFileSha256,
}) {
  const dataset = validateSourceDataset(rawDataset);
  const resolution = validateResolution(rawResolution);
  const datasetFileSha256 = assertSha256(
    sourceDatasetFileSha256,
    'sourceDatasetFileSha256',
  );
  const resolutionFileSha256 = assertSha256(
    sourceResolutionFileSha256,
    'sourceResolutionFileSha256',
  );
  if (dataset.activeSeason !== resolution.activeSeason) {
    throw new Error('source dataset and resolution active seasons disagree.');
  }
  if (resolution.sourceDatasetSha256 !== dataset.datasetSha256) {
    throw new Error('resolution does not reference the supplied source dataset.');
  }
  const datasetUntouched = dataset.untouchedTestReservation;
  const resolutionUntouched = resolution.untouchedTestReservation;
  if (
    datasetUntouched.startDate !== resolutionUntouched.startDate ||
    datasetUntouched.endDate !== resolutionUntouched.endDate ||
    datasetUntouched.plateAppearanceCount !==
      resolutionUntouched.plateAppearanceCount
  ) {
    throw new Error('source dataset and resolution untouched-test reservations disagree.');
  }

  const sourceContextRows = [];
  for (const periodId of INCLUDED_PERIODS) {
    for (const row of dataset.periods[periodId].rows) {
      if (
        row.mappingStatus === 'unresolved' &&
        row.unresolvedReason === 'context-required'
      ) {
        sourceContextRows.push(row);
      }
    }
  }
  if (sourceContextRows.length !== resolution.contextRowCount) {
    throw new Error('resolution contextRowCount does not match source context-required rows.');
  }
  const resolutionByRowId = new Map(
    resolution.rows.map((row) => [row.rowId, row]),
  );
  if (resolutionByRowId.size !== resolution.rows.length) {
    throw new Error('resolution contains duplicate row identities.');
  }
  for (const sourceRow of sourceContextRows) {
    const resolutionRow = resolutionByRowId.get(sourceRow.rowId);
    if (resolutionRow === undefined) {
      throw new Error(`resolution is missing source context row ${sourceRow.rowId}.`);
    }
    assertResolutionIdentityMatchesSource(sourceRow, resolutionRow);
  }

  const periods = {};
  const usedResolutionIds = new Set();
  for (const periodId of INCLUDED_PERIODS) {
    periods[periodId] = buildResolvedPeriod(
      periodId,
      dataset.periods[periodId],
      resolutionByRowId,
      usedResolutionIds,
    );
  }
  if (usedResolutionIds.size !== resolution.rows.length) {
    throw new Error('resolution contains rows outside the source context-required cohort.');
  }

  const identity = {
    activeSeason: dataset.activeSeason,
    sourceDatasetSha256: dataset.datasetSha256,
    sourceDatasetFileSha256: datasetFileSha256,
    sourceResolutionSha256: resolution.resolutionSha256,
    sourceResolutionFileSha256: resolutionFileSha256,
    sourcePartitionSha256: dataset.sourcePartitionSha256,
    sourceEvidenceSetSha256: dataset.sourceEvidenceSetSha256,
    periods,
    untouchedTestReservation: dataset.untouchedTestReservation,
  };
  const totals = Object.freeze({
    includedRowCount: sumPeriodCount(periods, 'rowCount'),
    classifiedTerminalCount: sumPeriodCount(periods, 'classifiedTerminalCount'),
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
    contextResolutionAppliedCount: sumPeriodCount(
      periods,
      'contextResolutionAppliedCount',
    ),
    resolvedContextTerminalCount: sumPeriodCount(
      periods,
      'resolvedContextTerminalCount',
    ),
    resolvedContextBaserunningCount: sumPeriodCount(
      periods,
      'resolvedContextBaserunningCount',
    ),
    remainingContextUnresolvedCount: sumPeriodCount(
      periods,
      'remainingContextUnresolvedCount',
    ),
    terminalCategoryCounts: mergeCountObjects(periods, 'terminalCategoryCounts'),
  });
  if (
    totals.classifiedTerminalCount +
      totals.baserunningOnlyCount +
      totals.unresolvedCount !==
    totals.includedRowCount
  ) {
    throw new Error('resolved dataset row accounting does not conserve rows.');
  }
  if (
    totals.resolvedContextTerminalCount +
      totals.resolvedContextBaserunningCount +
      totals.remainingContextUnresolvedCount !==
    totals.contextResolutionAppliedCount
  ) {
    throw new Error('resolved dataset context accounting does not conserve rows.');
  }
  if (
    totals.contextResolutionAppliedCount !== resolution.contextRowCount ||
    totals.resolvedContextTerminalCount !==
      resolution.resolutionStatusCounts['resolved-terminal'] ||
    totals.resolvedContextBaserunningCount !==
      resolution.resolutionStatusCounts['baserunning-only'] ||
    totals.remainingContextUnresolvedCount !==
      resolution.resolutionStatusCounts.unresolved
  ) {
    throw new Error('resolved dataset totals disagree with the resolution artifact.');
  }

  return Object.freeze({
    datasetVersion: 3,
    purpose:
      'Overlay evidence-backed contextual terminal and baserunning resolutions onto the immutable M8 fit-validation dataset while preserving all unresolved states and keeping untouched-test outcomes sealed.',
    ...identity,
    totals,
    datasetSha256: sha256(JSON.stringify(identity)),
  });
}
