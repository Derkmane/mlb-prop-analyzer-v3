import assert from 'node:assert/strict';
import test from 'node:test';

import {
  buildM10HhrCumulativeSelectedSideReport,
  hhrCumulativeInputDiagnostics,
} from '../scripts/m10-hhr-evidence-utils.mjs';
import { selectOneModelSidePerProp } from '../scripts/m10-selected-side-grade-metrics-utils.mjs';

const HASH_A = 'a'.repeat(64);
const HASH_B = 'b'.repeat(64);
const HASH_C = 'c'.repeat(64);
const HASH_D = 'd'.repeat(64);
const SETTLEMENT_VERSION = 'observed-discrete-statistic-settlement-v1';
const HHR_NONSTARTER_SETTLEMENT_VERSION = 'underdog-batter-hhr-settlement-v1';

function hhrRow({
  eventId,
  gameId,
  playerId,
  line,
  side,
  higherProbability,
  officialHhr,
}) {
  const probability = side === 'higher' ? higherProbability : 1 - higherProbability;
  const base = {
    providerEventId: eventId,
    providerGameId: gameId,
    providerPlayerId: playerId,
    providerMarketKey: 'batter_hits_runs_rbis_alternate',
    offerType: 'alternate',
    playerName: `Player ${playerId}`,
    selectedSide: side,
    postedLine: line,
    archivedPWin: probability,
    archivedPLoss: 1 - probability,
    archivedPVoid: 0,
    archivedPWinGivenGrades: probability,
  };
  if (officialHhr === null) {
    return Object.freeze({
      ...base,
      officialHhr: null,
      officialHits: null,
      officialComponents: null,
      outcome: 'void',
      settlementVersion: HHR_NONSTARTER_SETTLEMENT_VERSION,
      settlementReason: 'verified-final-nonstarter',
      gradingSettlement: Object.freeze({
        eligibilityProbability: 0,
        winProbability: 0,
        lossProbability: 0,
        voidProbability: 1,
        winProbabilityGivenGrades: null,
        settlementRuleVersion: HHR_NONSTARTER_SETTLEMENT_VERSION,
        ruleSourceReference: 'fixture-rule-source',
      }),
    });
  }
  const outcome =
    side === 'higher'
      ? officialHhr > line
        ? 'win'
        : officialHhr < line
          ? 'loss'
          : 'void'
      : officialHhr < line
        ? 'win'
        : officialHhr > line
          ? 'loss'
          : 'void';
  return Object.freeze({
    ...base,
    officialHhr,
    officialHits: officialHhr,
    officialComponents: Object.freeze({
      hits: officialHhr,
      runs: 0,
      rbi: 0,
      officialHhr,
    }),
    outcome,
    settlementVersion: SETTLEMENT_VERSION,
  });
}

function hhrPair({ eventId, gameId, playerId, line, higherProbability, officialHhr }) {
  return Object.freeze([
    hhrRow({
      eventId,
      gameId,
      playerId,
      line,
      side: 'higher',
      higherProbability,
      officialHhr,
    }),
    hhrRow({
      eventId,
      gameId,
      playerId,
      line,
      side: 'lower',
      higherProbability,
      officialHhr,
    }),
  ]);
}

function step3Archive({ captureKey, rows }) {
  return Object.freeze({
    captureKey,
    rows: Object.freeze(rows),
    safety: Object.freeze({ productionEnabled: false, rankingEnabled: false }),
  });
}

function gradeReport({ captureKey, gradedAt, rows, archiveSha256 = HASH_D }) {
  return Object.freeze({
    reportVersion: 1,
    reportType: 'm10-hhr-final-grade-v1',
    gradedAt,
    source: Object.freeze({
      captureKey,
      archiveSha256,
      archiveFileSha256: HASH_D,
      archiveModified: false,
    }),
    rows: Object.freeze(rows),
    safety: Object.freeze({
      productionEnabled: false,
      rankingEnabled: false,
      evidenceOnly: true,
      archiveModified: false,
      finalOnly: true,
    }),
  });
}

function batterHitsPair() {
  const common = {
    providerEventId: 'hits-event',
    providerGameId: 8001,
    providerPlayerId: 4001,
    providerMarketKey: 'batter_hits_alternate',
    offerType: 'alternate',
    playerName: 'Hits Player',
    postedLine: 0.5,
    archivedPVoid: 0,
    officialHits: 1,
    settlementVersion: SETTLEMENT_VERSION,
  };
  return [
    Object.freeze({
      ...common,
      selectedSide: 'higher',
      archivedPWin: 0.6,
      archivedPLoss: 0.4,
      archivedPWinGivenGrades: 0.6,
      outcome: 'win',
    }),
    Object.freeze({
      ...common,
      selectedSide: 'lower',
      archivedPWin: 0.4,
      archivedPLoss: 0.6,
      archivedPWinGivenGrades: 0.4,
      outcome: 'loss',
    }),
  ];
}

test('HHR cumulative validates repeated props per capture, retains latest only, preserves superseded evidence, and excludes voids', () => {
  const oldCaptureKey = `20260810T120000Z--${HASH_A}`;
  const middleCaptureKey = `20260810T130000000Z--${HASH_B}`;
  const latestCaptureKey = `20260810T140000000Z--${HASH_C}`;
  const repeatedIdentity = {
    gameId: 7001,
    playerId: 3001,
    line: 1.5,
    officialHhr: 2,
  };

  const seed = step3Archive({
    captureKey: oldCaptureKey,
    rows: hhrPair({
      eventId: 'event-old',
      ...repeatedIdentity,
      higherProbability: 0.7,
    }),
  });
  const middle = gradeReport({
    captureKey: middleCaptureKey,
    gradedAt: '2026-08-11T09:00:00.000Z',
    rows: hhrPair({
      eventId: 'event-middle',
      ...repeatedIdentity,
      higherProbability: 0.4,
    }),
    archiveSha256: HASH_B,
  });
  const latest = gradeReport({
    captureKey: latestCaptureKey,
    gradedAt: '2026-08-11T10:00:00.000Z',
    rows: [
      ...hhrPair({
        eventId: 'event-latest',
        ...repeatedIdentity,
        higherProbability: 0.55,
      }),
      ...hhrPair({
        eventId: 'event-void',
        gameId: 7001,
        playerId: 3002,
        line: 0.5,
        higherProbability: 0.62,
        officialHhr: null,
      }),
    ],
    archiveSha256: HASH_C,
  });

  const cumulative = buildM10HhrCumulativeSelectedSideReport({
    step3Archive: seed,
    gradeReports: [latest, middle],
    generatedAt: '2026-08-11T10:05:00.000Z',
  });

  assert.equal(cumulative.archivesIncluded, 3);
  assert.equal(cumulative.selectedSide.selectedSideRowsBeforeDedup, 4);
  assert.equal(cumulative.selectedSide.retainedSelectedSideRows, 2);
  assert.equal(cumulative.selectedSide.supersededSelectedSideRows, 2);
  assert.equal(cumulative.selectedSide.calibrationEligiblePicksBeforeDedup, 3);
  assert.equal(cumulative.selectedSide.calibrationEligiblePicks, 1);
  assert.equal(cumulative.selectedSide.summary.picksGraded, 2);
  assert.equal(cumulative.selectedSide.summary.voids, 1);

  const repeatedEvidence = cumulative.selectedSide.evidenceRows.filter(
    (row) => row.providerPlayerId === repeatedIdentity.playerId,
  );
  assert.equal(repeatedEvidence.length, 3);
  assert.deepEqual(
    repeatedEvidence.map((row) => row.captureKey),
    [oldCaptureKey, middleCaptureKey, latestCaptureKey],
  );
  assert.deepEqual(
    repeatedEvidence.map((row) => row.calibrationDedupStatus),
    ['superseded', 'superseded', 'retained'],
  );
  assert.equal(repeatedEvidence[0].supersededByCaptureKey, latestCaptureKey);
  assert.equal(repeatedEvidence[1].supersededByCaptureKey, latestCaptureKey);
  assert.equal(repeatedEvidence[0].calibrationEligible, false);
  assert.equal(repeatedEvidence[1].calibrationEligible, false);
  assert.equal(repeatedEvidence[2].calibrationEligible, true);
  assert.equal(repeatedEvidence[0].calibrationExclusionReason, 'superseded-by-later-capture');
  assert.equal(repeatedEvidence[1].calibrationExclusionReason, 'superseded-by-later-capture');
  assert.equal(repeatedEvidence[2].captureTimestamp, '2026-08-10T14:00:00.000Z');
  assert.equal(repeatedEvidence[2].selectedSide, 'higher');
  assert.equal(repeatedEvidence[2].archivedPWinGivenGrades, 0.55);

  const voidEvidence = cumulative.selectedSide.evidenceRows.find(
    (row) => row.providerPlayerId === 3002,
  );
  assert.equal(voidEvidence.calibrationDedupStatus, 'retained');
  assert.equal(voidEvidence.calibrationEligible, false);
  assert.equal(voidEvidence.calibrationExclusionReason, 'void');
  assert.equal(cumulative.selectedSide.perLine['0.5'].summary.picksGraded, 1);
  assert.equal(cumulative.selectedSide.perLine['0.5'].summary.voids, 1);
  assert.equal(cumulative.selectedSide.perLine['0.5'].calibrationEligiblePicks, 0);
  assert.equal(cumulative.selectedSide.perLine['1.5'].calibrationEligiblePicks, 1);

  assert.equal(cumulative.selectedSide.perLine['1.5'].minimumCountGatePassed, false);
  assert.equal(cumulative.selectedSide.perLine['1.5'].ownerDecisionRequired, true);
  assert.equal(cumulative.selectedSide.perLine['1.5'].productionEnabled, false);
  assert.equal(cumulative.selectedSide.perLine['1.5'].rankingEnabled, false);
  assert.equal(cumulative.safety.ownerDecisionRequired, true);
  assert.equal(cumulative.safety.productionEnabled, false);
  assert.equal(cumulative.safety.rankingEnabled, false);

  const diagnostics = hhrCumulativeInputDiagnostics({
    step3Archive: seed,
    gradeReports: [latest, middle],
  });
  assert.equal(diagnostics.selectedSideRowsBeforeDedup, 4);
  assert.equal(diagnostics.selectedSideRows, 2);
  assert.equal(diagnostics.supersededSelectedSideRows, 2);
  assert.equal(diagnostics.calibrationEligibleRowsBeforeDedup, 3);
  assert.equal(diagnostics.calibrationEligibleRows, 1);
  assert.equal(diagnostics.voidSelectedSideRows, 1);
  assert.deepEqual(diagnostics.lineCountsBeforeDedup, {
    '0.5': 0,
    '1.5': 3,
    '2.5+': 0,
  });
  assert.deepEqual(diagnostics.lineCounts, {
    '0.5': 0,
    '1.5': 1,
    '2.5+': 0,
  });
});

test('HHR cumulative still rejects a genuine one-sided prop inside one capture', () => {
  const pair = hhrPair({
    eventId: 'event-one-sided',
    gameId: 7002,
    playerId: 3003,
    line: 1.5,
    higherProbability: 0.6,
    officialHhr: 2,
  });
  const seed = step3Archive({
    captureKey: `20260810T120000Z--${HASH_A}`,
    rows: [pair[0]],
  });
  assert.throws(
    () =>
      buildM10HhrCumulativeSelectedSideReport({
        step3Archive: seed,
        gradeReports: [],
        generatedAt: '2026-08-11T10:05:00.000Z',
      }),
    /must contain exactly one Higher and one Lower row/u,
  );
});

test('Batter Hits selectOneModelSidePerProp single-capture behavior is unchanged', () => {
  const result = selectOneModelSidePerProp(batterHitsPair());
  assert.equal(result.pairs.length, 1);
  assert.equal(result.selectedRows.length, 1);
  assert.equal(result.selectedRows[0].providerMarketKey, 'batter_hits_alternate');
  assert.equal(result.selectedRows[0].selectedSide, 'higher');
  assert.equal(result.selectedRows[0].archivedPWinGivenGrades, 0.6);
});
