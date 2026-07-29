import { sha256 } from './provider-probe-utils.mjs';

const SHA256_PATTERN = /^[a-f0-9]{64}$/;
const RESOLUTION_STATUSES = Object.freeze([
  'resolved-terminal',
  'baserunning-only',
  'unresolved',
]);
const FC_SAFE_MARKER = 'Batters Fielders Choice - All Runners Safe';
const FC_RUNNER_OUT_MARKER = 'Batters Fielders Choice - Runner Out';
const BIP_OUT_MARKERS = Object.freeze([
  'Fly Out',
  'Foul Out',
  'Ground Out',
  'Line Out',
  'Pop Out',
]);
const STRIKEOUT_MARKERS = Object.freeze([
  'Strike Looking',
  'Strike Swinging',
]);
const RECOGNIZED_TERMINAL_MARKERS = Object.freeze([
  FC_SAFE_MARKER,
  FC_RUNNER_OUT_MARKER,
  ...BIP_OUT_MARKERS,
  ...STRIKEOUT_MARKERS,
]);
const RECOGNIZED_TERMINAL_MARKER_SET = new Set(RECOGNIZED_TERMINAL_MARKERS);
const SUPPORTED_RESULTS = new Set([
  'Caught Stealing 2B',
  'Double Play',
  'Fielders Choice',
  'Fielders Choice Out',
  'Forceout',
  'Strikeout Double Play',
  'Triple Play',
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

function assertSha256(value, label) {
  if (typeof value !== 'string' || !SHA256_PATTERN.test(value)) {
    throw new TypeError(`${label} must be a lowercase SHA-256 digest.`);
  }
  return value;
}

function normalizeHalfInning(value, label) {
  const normalized = assertNonEmptyString(value, label).toLowerCase();
  if (normalized !== 'top' && normalized !== 'bottom') {
    throw new Error(`${label} must be top or bottom.`);
  }
  return normalized;
}

function sortedObject(rawObject, label) {
  const object = assertPlainObject(rawObject, label);
  return Object.freeze(
    Object.fromEntries(
      Object.entries(object)
        .map(([key, value]) => [
          assertNonEmptyString(key, `${label} key`),
          assertNonNegativeInteger(value, `${label}.${key}`),
        ])
        .sort(([left], [right]) => left.localeCompare(right)),
    ),
  );
}

function increment(counts, key) {
  counts[key] = (counts[key] ?? 0) + 1;
}

function auditIdentity(audit) {
  return {
    activeSeason: audit.activeSeason,
    sourceDatasetSha256: audit.sourceDatasetSha256,
    sourceDatasetFileSha256: audit.sourceDatasetFileSha256,
    sourceCaptureSha256: audit.sourceCaptureSha256,
    sourceCaptureManifestFileSha256: audit.sourceCaptureManifestFileSha256,
    verifiedGameCount: audit.verifiedGameCount,
    verifiedPageCount: audit.verifiedPageCount,
    verifiedPlayCount: audit.verifiedPlayCount,
    contextRowCount: audit.contextRowCount,
    resultCounts: audit.resultCounts,
    matchStatusCounts: audit.matchStatusCounts,
    signatureCount: audit.signatureCount,
    signatures: audit.signatures,
    rows: audit.rows,
    untouchedTestReservation: audit.untouchedTestReservation,
    untouchedTestRowsRead: audit.untouchedTestRowsRead,
    mappingApplied: audit.mappingApplied,
  };
}

function validateAuditRow(rawRow, label) {
  const row = assertPlainObject(rawRow, label);
  const rawResult = assertNonEmptyString(row.rawResult, `${label}.rawResult`);
  if (!SUPPORTED_RESULTS.has(rawResult)) {
    throw new Error(`${label} has unsupported rawResult ${rawResult}.`);
  }
  const matchStatus = assertNonEmptyString(row.matchStatus, `${label}.matchStatus`);
  if (!['zero', 'unique', 'multiple'].includes(matchStatus)) {
    throw new Error(`${label}.matchStatus is invalid.`);
  }
  const candidateSegmentCount = assertNonNegativeInteger(
    row.candidateSegmentCount,
    `${label}.candidateSegmentCount`,
  );
  const expectedCount = matchStatus === 'zero' ? 0 : matchStatus === 'unique' ? 1 : 2;
  if (
    (matchStatus !== 'multiple' && candidateSegmentCount !== expectedCount) ||
    (matchStatus === 'multiple' && candidateSegmentCount < expectedCount)
  ) {
    throw new Error(`${label} match status and candidate count disagree.`);
  }
  let segment = null;
  if (matchStatus === 'unique') {
    segment = assertPlainObject(row.segment, `${label}.segment`);
    assertPositiveInteger(segment.startOrder, `${label}.segment.startOrder`);
    assertPositiveInteger(segment.endOrder, `${label}.segment.endOrder`);
    if (segment.endOrder < segment.startOrder) {
      throw new Error(`${label}.segment order is invalid.`);
    }
    const batterOwnedTypes = assertArray(
      segment.batterOwnedTypes,
      `${label}.segment.batterOwnedTypes`,
    ).map((value, index) =>
      assertNonEmptyString(value, `${label}.segment.batterOwnedTypes[${index}]`),
    );
    segment = Object.freeze({
      ...segment,
      batterOwnedTypes: Object.freeze([...new Set(batterOwnedTypes)].sort()),
    });
  } else if (row.segment !== null) {
    throw new Error(`${label}.segment must be null unless the match is unique.`);
  }
  return Object.freeze({
    rowId: assertNonEmptyString(row.rowId, `${label}.rowId`),
    observedDate: assertNonEmptyString(row.observedDate, `${label}.observedDate`),
    providerGameId: assertPositiveInteger(row.providerGameId, `${label}.providerGameId`),
    providerPaNumber: assertPositiveInteger(row.providerPaNumber, `${label}.providerPaNumber`),
    providerBatterId: assertPositiveInteger(
      row.providerBatterId,
      `${label}.providerBatterId`,
    ),
    providerPitcherId: assertPositiveInteger(
      row.providerPitcherId,
      `${label}.providerPitcherId`,
    ),
    inning: assertPositiveInteger(row.inning, `${label}.inning`),
    halfInning: normalizeHalfInning(row.halfInning, `${label}.halfInning`),
    rawResult,
    matchStatus,
    candidateSegmentCount,
    segment,
  });
}

export function validateM8ContextPlaySignatureAudit(rawAudit) {
  const audit = assertPlainObject(rawAudit, 'signature audit');
  if (audit.auditVersion !== 1) {
    throw new Error('signature auditVersion must equal 1.');
  }
  if (audit.mappingApplied !== false) {
    throw new Error('signature audit must not already contain mappings.');
  }
  if (audit.untouchedTestRowsRead !== false) {
    throw new Error('signature audit must not read untouched-test rows.');
  }
  const untouched = assertPlainObject(
    audit.untouchedTestReservation,
    'signature audit untouchedTestReservation',
  );
  if (untouched.rowsIncluded !== false || Object.hasOwn(untouched, 'rows')) {
    throw new Error('untouched-test rows must remain excluded.');
  }
  const rows = assertArray(audit.rows, 'signature audit rows').map((row, index) =>
    validateAuditRow(row, `signature audit rows[${index}]`),
  );
  if (
    rows.length !==
    assertNonNegativeInteger(audit.contextRowCount, 'signature audit contextRowCount')
  ) {
    throw new Error('signature audit contextRowCount does not match rows.');
  }
  const signatures = assertArray(audit.signatures, 'signature audit signatures');
  if (
    signatures.length !==
    assertNonNegativeInteger(audit.signatureCount, 'signature audit signatureCount')
  ) {
    throw new Error('signature audit signatureCount does not match signatures.');
  }
  const seenRowIds = new Set();
  const observedResultCounts = {};
  const observedMatchCounts = {};
  for (const row of rows) {
    if (seenRowIds.has(row.rowId)) {
      throw new Error(`duplicate signature audit rowId ${row.rowId}.`);
    }
    seenRowIds.add(row.rowId);
    increment(observedResultCounts, row.rawResult);
    increment(observedMatchCounts, row.matchStatus);
  }
  const resultCounts = sortedObject(audit.resultCounts, 'signature audit resultCounts');
  const matchStatusCounts = sortedObject(
    audit.matchStatusCounts,
    'signature audit matchStatusCounts',
  );
  for (const [key, expected] of Object.entries(resultCounts)) {
    if ((observedResultCounts[key] ?? 0) !== expected) {
      throw new Error('signature audit resultCounts do not match rows.');
    }
  }
  if (Object.keys(observedResultCounts).some((key) => !Object.hasOwn(resultCounts, key))) {
    throw new Error('signature audit resultCounts contain an unreported result.');
  }
  for (const [key, expected] of Object.entries(matchStatusCounts)) {
    if ((observedMatchCounts[key] ?? 0) !== expected) {
      throw new Error('signature audit matchStatusCounts do not match rows.');
    }
  }
  if (Object.keys(observedMatchCounts).some((key) => !Object.hasOwn(matchStatusCounts, key))) {
    throw new Error('signature audit matchStatusCounts contain an unreported status.');
  }
  const expectedAuditSha256 = sha256(JSON.stringify(auditIdentity(audit)));
  if (assertSha256(audit.auditSha256, 'signature audit SHA-256') !== expectedAuditSha256) {
    throw new Error('signature audit identity SHA-256 is invalid.');
  }
  return Object.freeze({
    ...audit,
    activeSeason: assertPositiveInteger(audit.activeSeason, 'signature audit activeSeason'),
    sourceDatasetSha256: assertSha256(
      audit.sourceDatasetSha256,
      'signature audit sourceDatasetSha256',
    ),
    sourceCaptureSha256: assertSha256(
      audit.sourceCaptureSha256,
      'signature audit sourceCaptureSha256',
    ),
    rows: Object.freeze(rows),
    resultCounts,
    matchStatusCounts,
    untouchedTestReservation: Object.freeze({
      startDate: assertNonEmptyString(untouched.startDate, 'untouched startDate'),
      endDate: assertNonEmptyString(untouched.endDate, 'untouched endDate'),
      plateAppearanceCount: assertNonNegativeInteger(
        untouched.plateAppearanceCount,
        'untouched plateAppearanceCount',
      ),
      rowsIncluded: false,
    }),
  });
}

function recognizedEvidenceMarkers(segment) {
  if (segment === null) return Object.freeze([]);
  return Object.freeze(
    segment.batterOwnedTypes
      .filter((type) => RECOGNIZED_TERMINAL_MARKER_SET.has(type))
      .sort(),
  );
}

function publicIdentity(row) {
  return {
    rowId: row.rowId,
    observedDate: row.observedDate,
    providerGameId: row.providerGameId,
    providerPaNumber: row.providerPaNumber,
    providerBatterId: row.providerBatterId,
    providerPitcherId: row.providerPitcherId,
    inning: row.inning,
    halfInning: row.halfInning,
    rawResult: row.rawResult,
    matchStatus: row.matchStatus,
    candidateSegmentCount: row.candidateSegmentCount,
    segment: row.segment,
  };
}

function resolvedTerminal(row, terminalCategory, batterDisposition, evidenceMarkers) {
  return {
    ...row,
    segmentMatchStatus: row.matchStatus,
    resolutionStatus: 'resolved-terminal',
    terminalCategory,
    batterDisposition,
    baserunningEvent: null,
    resolutionReason: 'exact-provider-terminal-marker',
    evidenceMarkers,
  };
}

function baserunningOnly(row) {
  return {
    ...row,
    segmentMatchStatus: row.matchStatus,
    resolutionStatus: 'baserunning-only',
    terminalCategory: null,
    batterDisposition: null,
    baserunningEvent: 'CS',
    resolutionReason: 'provider-result-is-baserunning-only',
    evidenceMarkers: Object.freeze([]),
  };
}

function unresolved(row, reason, evidenceMarkers = Object.freeze([])) {
  return {
    ...row,
    segmentMatchStatus: row.matchStatus,
    resolutionStatus: 'unresolved',
    terminalCategory: null,
    batterDisposition: null,
    baserunningEvent: null,
    resolutionReason: reason,
    evidenceMarkers,
  };
}

function omitAuditOnlyFields(result) {
  const { segment: _segment, matchStatus: _matchStatus, ...publicResult } = result;
  return Object.freeze(publicResult);
}

export function resolveM8ContextAuditRow(rawRow) {
  const row = validateAuditRow(rawRow, 'signature audit row');
  const base = publicIdentity(row);
  if (row.rawResult === 'Caught Stealing 2B') {
    return omitAuditOnlyFields(baserunningOnly(base));
  }
  if (row.matchStatus !== 'unique') {
    return omitAuditOnlyFields(unresolved(base, `segment-match-${row.matchStatus}`));
  }

  const evidenceMarkers = recognizedEvidenceMarkers(row.segment);
  const markerSet = new Set(evidenceMarkers);
  const hasSafe = markerSet.has(FC_SAFE_MARKER);
  const hasRunnerOut = markerSet.has(FC_RUNNER_OUT_MARKER);
  const outMarkers = BIP_OUT_MARKERS.filter((marker) => markerSet.has(marker));
  const strikeMarkers = STRIKEOUT_MARKERS.filter((marker) => markerSet.has(marker));
  const hasAnyBipOut = outMarkers.length > 0;

  let result;
  if (row.rawResult === 'Fielders Choice') {
    result = hasSafe && !hasRunnerOut && !hasAnyBipOut
      ? resolvedTerminal(base, 'FC', 'reached', evidenceMarkers)
      : unresolved(
          base,
          evidenceMarkers.length === 0
            ? 'missing-exact-terminal-marker'
            : 'conflicting-exact-terminal-markers',
          evidenceMarkers,
        );
  } else if (row.rawResult === 'Fielders Choice Out' || row.rawResult === 'Forceout') {
    result = hasRunnerOut && !hasSafe && !hasAnyBipOut
      ? resolvedTerminal(base, 'FC', 'reached', evidenceMarkers)
      : unresolved(
          base,
          evidenceMarkers.length === 0
            ? 'missing-exact-terminal-marker'
            : 'conflicting-exact-terminal-markers',
          evidenceMarkers,
        );
  } else if (row.rawResult === 'Double Play' || row.rawResult === 'Triple Play') {
    result = outMarkers.length === 1 && !hasSafe && !hasRunnerOut
      ? resolvedTerminal(base, 'BIP_OUT', 'retired', evidenceMarkers)
      : unresolved(
          base,
          evidenceMarkers.length === 0
            ? 'missing-exact-terminal-marker'
            : 'conflicting-exact-terminal-markers',
          evidenceMarkers,
        );
  } else if (row.rawResult === 'Strikeout Double Play') {
    result = strikeMarkers.length >= 1 && !hasSafe && !hasRunnerOut && outMarkers.length === 0
      ? resolvedTerminal(base, 'K', 'retired', evidenceMarkers)
      : unresolved(
          base,
          evidenceMarkers.length === 0
            ? 'missing-exact-terminal-marker'
            : 'conflicting-exact-terminal-markers',
          evidenceMarkers,
        );
  } else {
    throw new Error(`unsupported context result ${row.rawResult}.`);
  }
  return omitAuditOnlyFields(result);
}

export function buildM8ContextTerminalResolution({ audit: rawAudit, sourceAuditFileSha256 }) {
  const audit = validateM8ContextPlaySignatureAudit(rawAudit);
  const rows = Object.freeze(audit.rows.map((row) => resolveM8ContextAuditRow(row)));
  const resolutionStatusCounts = Object.fromEntries(
    RESOLUTION_STATUSES.map((status) => [status, 0]),
  );
  const terminalCategoryCounts = { BIP_OUT: 0, FC: 0, K: 0 };
  const unresolvedReasonCounts = {};
  for (const row of rows) {
    resolutionStatusCounts[row.resolutionStatus] += 1;
    if (row.terminalCategory !== null) terminalCategoryCounts[row.terminalCategory] += 1;
    if (row.resolutionStatus === 'unresolved') {
      increment(unresolvedReasonCounts, row.resolutionReason);
    }
  }
  if (
    Object.values(resolutionStatusCounts).reduce((sum, value) => sum + value, 0) !==
      audit.contextRowCount ||
    Object.values(terminalCategoryCounts).reduce((sum, value) => sum + value, 0) !==
      resolutionStatusCounts['resolved-terminal'] ||
    Object.values(unresolvedReasonCounts).reduce((sum, value) => sum + value, 0) !==
      resolutionStatusCounts.unresolved
  ) {
    throw new Error('context terminal resolution accounting does not conserve rows.');
  }
  const identity = {
    activeSeason: audit.activeSeason,
    sourceAuditSha256: audit.auditSha256,
    sourceAuditFileSha256: assertSha256(
      sourceAuditFileSha256,
      'sourceAuditFileSha256',
    ),
    sourceDatasetSha256: audit.sourceDatasetSha256,
    sourceCaptureSha256: audit.sourceCaptureSha256,
    contextRowCount: audit.contextRowCount,
    resultCounts: audit.resultCounts,
    resolutionStatusCounts: Object.freeze(resolutionStatusCounts),
    terminalCategoryCounts: Object.freeze(terminalCategoryCounts),
    unresolvedReasonCounts: Object.freeze(
      Object.fromEntries(
        Object.entries(unresolvedReasonCounts).sort(([left], [right]) =>
          left.localeCompare(right),
        ),
      ),
    ),
    rows,
    untouchedTestReservation: audit.untouchedTestReservation,
    untouchedTestRowsRead: false,
  };
  return Object.freeze({
    resolutionVersion: 1,
    purpose:
      'Resolve only evidence-backed fit-validation contextual plate-appearance states from exact BALLDONTLIE typed play markers while preserving all ambiguous states explicitly.',
    ...identity,
    resolutionSha256: sha256(JSON.stringify(identity)),
  });
}
