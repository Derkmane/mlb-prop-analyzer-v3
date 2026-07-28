import assert from 'node:assert/strict';
import test from 'node:test';

import { sha256 } from '../scripts/provider-probe-utils.mjs';
import {
  buildM8ContextTerminalResolution,
  resolveM8ContextAuditRow,
} from '../scripts/m8-context-terminal-resolution-utils.mjs';

const RESULTS = [
  'Caught Stealing 2B',
  'Double Play',
  'Fielders Choice',
  'Fielders Choice Out',
  'Forceout',
  'Strikeout Double Play',
  'Triple Play',
];

function row({
  rowId,
  rawResult,
  matchStatus = 'unique',
  types = [],
  candidateSegmentCount = matchStatus === 'zero' ? 0 : matchStatus === 'unique' ? 1 : 2,
}) {
  return {
    rowId,
    observedDate: '2026-05-01',
    providerGameId: 9001,
    providerPaNumber: Number(rowId.replace(/\D/g, '').slice(-2)) || 1,
    providerBatterId: 10,
    providerPitcherId: 20,
    inning: 4,
    halfInning: 'top',
    rawResult,
    matchStatus,
    candidateSegmentCount,
    segment:
      matchStatus === 'unique'
        ? {
            startOrder: 100,
            endOrder: 110,
            playCount: 5,
            firstPlayResultPriorType: types.at(-1) ?? null,
            playResultCount: 1,
            batterOwnedTypes: ['Start Batter/Pitcher', ...types],
            nullBatterTypes: [],
            hasNullBatterCaughtStealing: false,
            playResultTexts: ['untrusted description'],
          }
        : null,
    candidateOrders: [],
    inferredBatterDisposition: null,
    inferredTerminalCategory: null,
  };
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

function makeAudit(rows, overrides = {}) {
  const resultCounts = Object.fromEntries(RESULTS.map((result) => [result, 0]));
  const matchStatusCounts = { zero: 0, unique: 0, multiple: 0 };
  for (const value of rows) {
    resultCounts[value.rawResult] += 1;
    matchStatusCounts[value.matchStatus] += 1;
  }
  const audit = {
    auditVersion: 1,
    purpose: 'test',
    activeSeason: 2026,
    sourceDatasetSha256: 'a'.repeat(64),
    sourceDatasetFileSha256: 'b'.repeat(64),
    sourceCaptureSha256: 'c'.repeat(64),
    sourceCaptureManifestFileSha256: 'd'.repeat(64),
    verifiedGameCount: 1,
    verifiedPageCount: 1,
    verifiedPlayCount: 10,
    contextRowCount: rows.length,
    resultCounts,
    matchStatusCounts,
    signatureCount: 0,
    signatures: [],
    rows,
    untouchedTestReservation: {
      startDate: '2026-07-06',
      endDate: '2026-07-25',
      plateAppearanceCount: 16830,
      rowsIncluded: false,
    },
    untouchedTestRowsRead: false,
    mappingApplied: false,
    ...overrides,
  };
  audit.auditSha256 = sha256(JSON.stringify(auditIdentity(audit)));
  return audit;
}

test('maps exact typed provider markers into canonical FC, BIP_OUT, and K categories', () => {
  const cases = [
    ['fc', 'Fielders Choice', ['Batters Fielders Choice - All Runners Safe'], 'FC', 'reached'],
    ['fco', 'Fielders Choice Out', ['Batters Fielders Choice - Runner Out'], 'FC', 'reached'],
    ['force', 'Forceout', ['Strike Looking', 'Batters Fielders Choice - Runner Out'], 'FC', 'reached'],
    ['dp', 'Double Play', ['Strike Swinging', 'Line Out'], 'BIP_OUT', 'retired'],
    ['kdp', 'Strikeout Double Play', ['Strike Looking', 'Strike Swinging'], 'K', 'retired'],
  ];
  for (const [rowId, rawResult, types, category, disposition] of cases) {
    const resolved = resolveM8ContextAuditRow(row({ rowId, rawResult, types }));
    assert.equal(resolved.resolutionStatus, 'resolved-terminal');
    assert.equal(resolved.terminalCategory, category);
    assert.equal(resolved.batterDisposition, disposition);
    assert.equal(resolved.resolutionReason, 'exact-provider-terminal-marker');
  }
});

test('keeps caught stealing in the baserunning layer even without a unique batter segment', () => {
  const resolved = resolveM8ContextAuditRow(
    row({ rowId: 'cs', rawResult: 'Caught Stealing 2B', matchStatus: 'zero' }),
  );
  assert.equal(resolved.resolutionStatus, 'baserunning-only');
  assert.equal(resolved.terminalCategory, null);
  assert.equal(resolved.baserunningEvent, 'CS');
});

test('leaves zero and multiple segment matches unresolved for terminal outcomes', () => {
  for (const matchStatus of ['zero', 'multiple']) {
    const resolved = resolveM8ContextAuditRow(
      row({ rowId: matchStatus, rawResult: 'Forceout', matchStatus }),
    );
    assert.equal(resolved.resolutionStatus, 'unresolved');
    assert.equal(resolved.terminalCategory, null);
    assert.equal(resolved.resolutionReason, `segment-match-${matchStatus}`);
  }
});

test('fails closed on markerless and conflicting exact terminal evidence', () => {
  const markerless = resolveM8ContextAuditRow(
    row({ rowId: 'missing', rawResult: 'Fielders Choice', types: ['Ball'] }),
  );
  assert.equal(markerless.resolutionReason, 'missing-exact-terminal-marker');

  const conflicting = resolveM8ContextAuditRow(
    row({
      rowId: 'conflict',
      rawResult: 'Forceout',
      types: [
        'Batters Fielders Choice - Runner Out',
        'Batters Fielders Choice - All Runners Safe',
      ],
    }),
  );
  assert.equal(conflicting.resolutionReason, 'conflicting-exact-terminal-markers');
  assert.equal(conflicting.terminalCategory, null);

  const wrongFamily = resolveM8ContextAuditRow(
    row({
      rowId: 'wrong',
      rawResult: 'Double Play',
      types: ['Batters Fielders Choice - Runner Out'],
    }),
  );
  assert.equal(wrongFamily.resolutionReason, 'conflicting-exact-terminal-markers');
});

test('does not infer a terminal category from play-result text', () => {
  const input = row({ rowId: 'text', rawResult: 'Double Play', types: ['Ball'] });
  input.segment.playResultTexts = ['Batter lined into double play.'];
  const resolved = resolveM8ContextAuditRow(input);
  assert.equal(resolved.resolutionStatus, 'unresolved');
  assert.equal(resolved.terminalCategory, null);
});

test('builds a deterministic conserved artifact while the untouched test stays sealed', () => {
  const rows = [
    row({ rowId: 'a1', rawResult: 'Fielders Choice', types: ['Batters Fielders Choice - All Runners Safe'] }),
    row({ rowId: 'a2', rawResult: 'Forceout', types: ['Batters Fielders Choice - Runner Out'] }),
    row({ rowId: 'a3', rawResult: 'Double Play', types: ['Fly Out'] }),
    row({ rowId: 'a4', rawResult: 'Strikeout Double Play', types: ['Strike Swinging'] }),
    row({ rowId: 'a5', rawResult: 'Caught Stealing 2B', matchStatus: 'zero' }),
    row({ rowId: 'a6', rawResult: 'Forceout', matchStatus: 'multiple' }),
  ];
  const audit = makeAudit(rows);
  const first = buildM8ContextTerminalResolution({
    audit,
    sourceAuditFileSha256: 'e'.repeat(64),
  });
  const second = buildM8ContextTerminalResolution({
    audit,
    sourceAuditFileSha256: 'e'.repeat(64),
  });
  assert.equal(first.resolutionSha256, second.resolutionSha256);
  assert.equal(first.contextRowCount, 6);
  assert.deepEqual(first.resolutionStatusCounts, {
    'resolved-terminal': 4,
    'baserunning-only': 1,
    unresolved: 1,
  });
  assert.deepEqual(first.terminalCategoryCounts, { BIP_OUT: 1, FC: 2, K: 1 });
  assert.equal(first.untouchedTestReservation.rowsIncluded, false);
  assert.equal(first.untouchedTestRowsRead, false);
});

test('rejects a tampered audit and any exposed untouched-test rows', () => {
  const sourceRows = [
    row({ rowId: 'guard', rawResult: 'Forceout', types: ['Batters Fielders Choice - Runner Out'] }),
  ];
  const tampered = makeAudit(sourceRows);
  tampered.rows[0].rawResult = 'Double Play';
  assert.throws(
    () =>
      buildM8ContextTerminalResolution({
        audit: tampered,
        sourceAuditFileSha256: 'e'.repeat(64),
      }),
    /SHA-256|resultCounts/,
  );

  const exposed = makeAudit(sourceRows, {
    untouchedTestRowsRead: true,
  });
  exposed.auditSha256 = sha256(JSON.stringify(auditIdentity(exposed)));
  assert.throws(
    () =>
      buildM8ContextTerminalResolution({
        audit: exposed,
        sourceAuditFileSha256: 'e'.repeat(64),
      }),
    /must not read untouched-test rows/,
  );
});
