import assert from 'node:assert/strict';
import test from 'node:test';

import { sha256 } from '../scripts/provider-probe-utils.mjs';
import { buildM8ResolvedCategoricalDataset } from '../scripts/m8-resolved-categorical-dataset-utils.mjs';

const TEST_RESERVATION = Object.freeze({
  startDate: '2026-07-06',
  endDate: '2026-07-25',
  shardCount: 20,
  gameCount: 225,
  plateAppearanceCount: 16830,
  rowsIncluded: false,
  allowedUse: 'final-evaluation-only-after-candidate-selection',
});

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

function rowId(observedDate, providerGameId, providerPaNumber) {
  return `${observedDate}:${providerGameId}:${providerPaNumber}`;
}

function sourceRow({
  observedDate,
  providerGameId,
  providerPaNumber,
  providerBatterId,
  providerPitcherId,
  rawResult,
  rawBatterSide = 'R',
  rawPitcherHand = 'R',
  mappingStatus,
  terminalCategory = null,
  unresolvedReason = null,
}) {
  const classified = mappingStatus === 'classified-terminal';
  const normalizedBatterSide = classified && ['L', 'R'].includes(rawBatterSide)
    ? rawBatterSide
    : null;
  const normalizedPitcherHand = classified && ['L', 'R'].includes(rawPitcherHand)
    ? rawPitcherHand
    : null;
  const platoonEligible =
    classified && normalizedBatterSide !== null && normalizedPitcherHand !== null;
  return {
    rowId: rowId(observedDate, providerGameId, providerPaNumber),
    observedDate,
    providerGameId,
    providerPaNumber,
    providerBatterId,
    providerPitcherId,
    inning: 4,
    halfInning: 'top',
    rawBatterSide,
    rawPitcherHand,
    rawResult,
    sourceSnapshotPath: `${observedDate}/game-${providerGameId}.json`,
    sourceSnapshotSha256: String(providerPaNumber).padStart(64, 'a').slice(-64),
    mappingStatus,
    unresolvedReason,
    terminalCategory,
    normalizedBatterSide,
    normalizedPitcherHand,
    overallOutcomeEligible: classified,
    platoonEligible,
    includedInOverallOutcomeModel: classified,
    includedInPlatoonModel: platoonEligible,
  };
}

function summarizeSourceRows(rows) {
  const summary = {
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
      summary.classifiedTerminalCount += 1;
      summary.overallOutcomeEligibleCount += 1;
      if (row.includedInPlatoonModel) summary.platoonEligibleCount += 1;
      else summary.platoonIneligibleTerminalCount += 1;
    } else if (row.mappingStatus === 'baserunning-only') {
      summary.baserunningOnlyCount += 1;
    } else {
      summary.unresolvedCount += 1;
      if (row.unresolvedReason === 'missing-result') summary.missingResultCount += 1;
      if (row.unresolvedReason === 'context-required') summary.contextRequiredCount += 1;
      if (row.unresolvedReason === 'unknown-result') summary.unknownResultCount += 1;
      if (row.unresolvedReason === 'context-contradiction') {
        summary.contextContradictionCount += 1;
      }
    }
  }
  return summary;
}

function period(startDate, endDate, rows) {
  return { startDate, endDate, ...summarizeSourceRows(rows), rows };
}

function makeDataset() {
  const fitRows = [
    sourceRow({
      observedDate: '2026-05-01',
      providerGameId: 9001,
      providerPaNumber: 1,
      providerBatterId: 11,
      providerPitcherId: 21,
      rawResult: 'Strikeout',
      rawBatterSide: 'R',
      rawPitcherHand: 'L',
      mappingStatus: 'classified-terminal',
      terminalCategory: 'K',
    }),
    sourceRow({
      observedDate: '2026-05-01',
      providerGameId: 9001,
      providerPaNumber: 2,
      providerBatterId: 12,
      providerPitcherId: 22,
      rawResult: 'Fielders Choice',
      rawBatterSide: 'L',
      rawPitcherHand: 'R',
      mappingStatus: 'unresolved',
      unresolvedReason: 'context-required',
    }),
    sourceRow({
      observedDate: '2026-05-01',
      providerGameId: 9001,
      providerPaNumber: 3,
      providerBatterId: 13,
      providerPitcherId: 23,
      rawResult: 'Double Play',
      rawBatterSide: 'S',
      rawPitcherHand: 'R',
      mappingStatus: 'unresolved',
      unresolvedReason: 'context-required',
    }),
    sourceRow({
      observedDate: '2026-05-01',
      providerGameId: 9001,
      providerPaNumber: 4,
      providerBatterId: 14,
      providerPitcherId: 24,
      rawResult: 'Caught Stealing 2B',
      mappingStatus: 'unresolved',
      unresolvedReason: 'context-required',
    }),
    sourceRow({
      observedDate: '2026-05-01',
      providerGameId: 9001,
      providerPaNumber: 5,
      providerBatterId: 15,
      providerPitcherId: 25,
      rawResult: 'Forceout',
      mappingStatus: 'unresolved',
      unresolvedReason: 'context-required',
    }),
    sourceRow({
      observedDate: '2026-05-01',
      providerGameId: 9001,
      providerPaNumber: 6,
      providerBatterId: 16,
      providerPitcherId: 26,
      rawResult: 'Caught Stealing 2B',
      mappingStatus: 'baserunning-only',
    }),
  ];
  const validationRows = [
    sourceRow({
      observedDate: '2026-06-25',
      providerGameId: 9002,
      providerPaNumber: 1,
      providerBatterId: 17,
      providerPitcherId: 27,
      rawResult: 'Strikeout Double Play',
      rawBatterSide: 'R',
      rawPitcherHand: 'R',
      mappingStatus: 'unresolved',
      unresolvedReason: 'context-required',
    }),
    sourceRow({
      observedDate: '2026-06-25',
      providerGameId: 9002,
      providerPaNumber: 2,
      providerBatterId: 18,
      providerPitcherId: 28,
      rawResult: 'Mystery Event',
      mappingStatus: 'unresolved',
      unresolvedReason: 'unknown-result',
    }),
  ];
  const periods = {
    fit: period('2026-03-26', '2026-06-21', fitRows),
    validation: period('2026-06-22', '2026-07-05', validationRows),
  };
  const dataset = {
    datasetVersion: 2,
    purpose: 'test source dataset',
    activeSeason: 2026,
    sourcePartitionSha256: '1'.repeat(64),
    sourceEvidenceSetSha256: '2'.repeat(64),
    periods,
    untouchedTestReservation: { ...TEST_RESERVATION },
    totals: {
      includedRowCount: 8,
      classifiedTerminalCount: 1,
      overallOutcomeEligibleCount: 1,
      platoonEligibleCount: 1,
      platoonIneligibleTerminalCount: 0,
      baserunningOnlyCount: 1,
      unresolvedCount: 6,
      missingResultCount: 0,
      contextRequiredCount: 5,
      unknownResultCount: 1,
      contextContradictionCount: 0,
    },
  };
  dataset.datasetSha256 = sha256(JSON.stringify(sourceDatasetIdentity(dataset)));
  return dataset;
}

function resolutionRow({
  source,
  resolutionStatus,
  terminalCategory = null,
  batterDisposition = null,
  baserunningEvent = null,
  resolutionReason,
  evidenceMarkers = [],
  segmentMatchStatus = 'unique',
  candidateSegmentCount = segmentMatchStatus === 'zero' ? 0 : 1,
}) {
  return {
    rowId: source.rowId,
    observedDate: source.observedDate,
    providerGameId: source.providerGameId,
    providerPaNumber: source.providerPaNumber,
    providerBatterId: source.providerBatterId,
    providerPitcherId: source.providerPitcherId,
    inning: source.inning,
    halfInning: source.halfInning,
    rawResult: source.rawResult,
    candidateSegmentCount,
    segmentMatchStatus,
    resolutionStatus,
    terminalCategory,
    batterDisposition,
    baserunningEvent,
    resolutionReason,
    evidenceMarkers,
  };
}

function makeResolution(dataset) {
  const sourceRows = [...dataset.periods.fit.rows, ...dataset.periods.validation.rows];
  const byResult = new Map(sourceRows.map((row) => [row.rawResult, row]));
  const rows = [
    resolutionRow({
      source: byResult.get('Fielders Choice'),
      resolutionStatus: 'resolved-terminal',
      terminalCategory: 'FC',
      batterDisposition: 'reached',
      resolutionReason: 'exact-provider-terminal-marker',
      evidenceMarkers: ['Batters Fielders Choice - All Runners Safe'],
    }),
    resolutionRow({
      source: byResult.get('Double Play'),
      resolutionStatus: 'resolved-terminal',
      terminalCategory: 'BIP_OUT',
      batterDisposition: 'retired',
      resolutionReason: 'exact-provider-terminal-marker',
      evidenceMarkers: ['Line Out'],
    }),
    resolutionRow({
      source: byResult.get('Caught Stealing 2B'),
      resolutionStatus: 'baserunning-only',
      baserunningEvent: 'CS',
      resolutionReason: 'provider-result-is-baserunning-only',
      segmentMatchStatus: 'zero',
      candidateSegmentCount: 0,
    }),
    resolutionRow({
      source: byResult.get('Forceout'),
      resolutionStatus: 'unresolved',
      resolutionReason: 'missing-exact-terminal-marker',
    }),
    resolutionRow({
      source: byResult.get('Strikeout Double Play'),
      resolutionStatus: 'resolved-terminal',
      terminalCategory: 'K',
      batterDisposition: 'retired',
      resolutionReason: 'exact-provider-terminal-marker',
      evidenceMarkers: ['Strike Swinging'],
    }),
  ];
  const resolution = {
    resolutionVersion: 1,
    purpose: 'test resolution',
    activeSeason: 2026,
    sourceAuditSha256: '3'.repeat(64),
    sourceAuditFileSha256: '4'.repeat(64),
    sourceDatasetSha256: dataset.datasetSha256,
    sourceCaptureSha256: '5'.repeat(64),
    contextRowCount: 5,
    resultCounts: {
      'Caught Stealing 2B': 1,
      'Double Play': 1,
      'Fielders Choice': 1,
      Forceout: 1,
      'Strikeout Double Play': 1,
    },
    resolutionStatusCounts: {
      'resolved-terminal': 3,
      'baserunning-only': 1,
      unresolved: 1,
    },
    terminalCategoryCounts: { BIP_OUT: 1, FC: 1, K: 1 },
    unresolvedReasonCounts: { 'missing-exact-terminal-marker': 1 },
    rows,
    untouchedTestReservation: {
      startDate: TEST_RESERVATION.startDate,
      endDate: TEST_RESERVATION.endDate,
      plateAppearanceCount: TEST_RESERVATION.plateAppearanceCount,
      rowsIncluded: false,
    },
    untouchedTestRowsRead: false,
  };
  resolution.resolutionSha256 = sha256(JSON.stringify(resolutionIdentity(resolution)));
  return resolution;
}

function buildFixture() {
  const dataset = makeDataset();
  const resolution = makeResolution(dataset);
  return { dataset, resolution };
}

function build(dataset, resolution) {
  return buildM8ResolvedCategoricalDataset({
    dataset,
    resolution,
    sourceDatasetFileSha256: '6'.repeat(64),
    sourceResolutionFileSha256: '7'.repeat(64),
  });
}

test('overlays exact contextual terminal, baserunning, and unresolved states with conserved totals', () => {
  const { dataset, resolution } = buildFixture();
  const resolved = build(dataset, resolution);
  assert.equal(resolved.datasetVersion, 3);
  assert.equal(resolved.totals.includedRowCount, 8);
  assert.equal(resolved.totals.contextResolutionAppliedCount, 5);
  assert.equal(resolved.totals.resolvedContextTerminalCount, 3);
  assert.equal(resolved.totals.resolvedContextBaserunningCount, 1);
  assert.equal(resolved.totals.remainingContextUnresolvedCount, 1);
  assert.equal(resolved.totals.classifiedTerminalCount, 4);
  assert.equal(resolved.totals.baserunningOnlyCount, 2);
  assert.equal(resolved.totals.unresolvedCount, 2);
  assert.equal(resolved.totals.contextRequiredCount, 1);
  assert.deepEqual(resolved.totals.terminalCategoryCounts, {
    BIP_OUT: 1,
    FC: 1,
    K: 2,
  });
  assert.equal(resolved.untouchedTestReservation.rowsIncluded, false);
  assert.equal(Object.hasOwn(resolved.untouchedTestReservation, 'rows'), false);
});

test('preserves source identities and applies the existing L/R-only platoon rule', () => {
  const { dataset, resolution } = buildFixture();
  const resolved = build(dataset, resolution);
  const sourceRows = [...dataset.periods.fit.rows, ...dataset.periods.validation.rows];
  const resolvedRows = [
    ...resolved.periods.fit.rows,
    ...resolved.periods.validation.rows,
  ];
  assert.deepEqual(
    resolvedRows.map((row) => [
      row.rowId,
      row.observedDate,
      row.sourceSnapshotPath,
      row.sourceSnapshotSha256,
    ]),
    sourceRows.map((row) => [
      row.rowId,
      row.observedDate,
      row.sourceSnapshotPath,
      row.sourceSnapshotSha256,
    ]),
  );
  const fc = resolvedRows.find((row) => row.rawResult === 'Fielders Choice');
  assert.equal(fc.terminalCategory, 'FC');
  assert.equal(fc.normalizedBatterSide, 'L');
  assert.equal(fc.normalizedPitcherHand, 'R');
  assert.equal(fc.includedInPlatoonModel, true);
  const doublePlay = resolvedRows.find((row) => row.rawResult === 'Double Play');
  assert.equal(doublePlay.terminalCategory, 'BIP_OUT');
  assert.equal(doublePlay.normalizedBatterSide, null);
  assert.equal(doublePlay.normalizedPitcherHand, 'R');
  assert.equal(doublePlay.includedInPlatoonModel, false);
  assert.equal(resolved.totals.platoonEligibleCount, 3);
  assert.equal(resolved.totals.platoonIneligibleTerminalCount, 1);
});

test('is deterministic for identical versioned inputs', () => {
  const { dataset, resolution } = buildFixture();
  const first = build(dataset, resolution);
  const second = build(dataset, resolution);
  assert.equal(first.datasetSha256, second.datasetSha256);
  assert.deepEqual(first, second);
});

test('rejects a resolution cohort that is missing or outside the source context rows', () => {
  const { dataset, resolution } = buildFixture();
  const outside = structuredClone(resolution);
  const row = outside.rows[0];
  row.observedDate = '2026-05-02';
  row.providerGameId = 9999;
  row.providerPaNumber = 99;
  row.rowId = rowId(row.observedDate, row.providerGameId, row.providerPaNumber);
  outside.resolutionSha256 = sha256(JSON.stringify(resolutionIdentity(outside)));
  assert.throws(() => build(dataset, outside), /missing source context row/);
});

test('rejects contextual identity drift even when artifact hashes are recomputed', () => {
  const { dataset, resolution } = buildFixture();
  const drifted = structuredClone(resolution);
  drifted.rows[0].providerBatterId += 1;
  drifted.resolutionSha256 = sha256(JSON.stringify(resolutionIdentity(drifted)));
  assert.throws(() => build(dataset, drifted), /identity drifted/);
});

test('rejects tampered artifacts and any exposed untouched-test rows', () => {
  const { dataset, resolution } = buildFixture();
  const tampered = structuredClone(resolution);
  tampered.rows[0].terminalCategory = 'K';
  assert.throws(() => build(dataset, tampered), /SHA-256|terminalCategoryCounts/);

  const exposedDataset = structuredClone(dataset);
  exposedDataset.untouchedTestReservation.rowsIncluded = true;
  exposedDataset.datasetSha256 = sha256(
    JSON.stringify(sourceDatasetIdentity(exposedDataset)),
  );
  assert.throws(() => build(exposedDataset, resolution), /untouched-test rows excluded/);

  const exposedResolution = structuredClone(resolution);
  exposedResolution.untouchedTestRowsRead = true;
  exposedResolution.resolutionSha256 = sha256(
    JSON.stringify(resolutionIdentity(exposedResolution)),
  );
  assert.throws(() => build(dataset, exposedResolution), /untouched-test rows sealed/);
});
