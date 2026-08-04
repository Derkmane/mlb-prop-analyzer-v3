import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';

import {
  applyM8_5TimesThroughOrderModelToPitcherVector,
  buildM8_5TimesThroughOrderDataset,
  evaluateM8_5TimesThroughOrderCandidates,
} from '../scripts/m8-5-times-through-order-utils.mjs';
import { verifyM8TerminalPaOutcomeArtifact } from '../scripts/m8-terminal-pa-outcome-artifact-utils.mjs';

const TERMINAL_ARTIFACT_PATH = path.resolve(
  'model-artifacts/m8-terminal-pa-outcome-v1.json',
);
const STARTER_BULLPEN_TRANSITION_SHA256 =
  '1db3b58868096ea2e19a2e2e9559a709275869db1618af69fd8143d9aae302c3';
const RESOLVED_DATASET_SHA256 = 'a'.repeat(64);

function terminalArtifact() {
  return verifyM8TerminalPaOutcomeArtifact(
    JSON.parse(fs.readFileSync(TERMINAL_ARTIFACT_PATH, 'utf8')),
  );
}

function rawRow({
  observedDate,
  gameId,
  halfInning = 'top',
  paNumber,
  batterId,
  pitcherId,
  terminalCategory,
}) {
  return Object.freeze({
    observedDate,
    providerGameId: gameId,
    halfInning,
    providerPaNumber: paNumber,
    providerBatterId: batterId,
    providerPitcherId: pitcherId,
    normalizedBatterSide: 'L',
    normalizedPitcherHand: 'R',
    mappingStatus: 'classified-terminal',
    terminalCategory,
  });
}

function teamGameRows({
  observedDate,
  gameId,
  pitcherId,
  pattern,
  starterReappears = false,
}) {
  const rows = pattern.map((entry, index) =>
    rawRow({
      observedDate,
      gameId,
      paNumber: index + 1,
      batterId: entry.batterId,
      pitcherId,
      terminalCategory: entry.terminalCategory,
    }),
  );
  rows.push(
    rawRow({
      observedDate,
      gameId,
      paNumber: rows.length + 1,
      batterId: 900000 + gameId,
      pitcherId: pitcherId + 100000,
      terminalCategory: 'BIP_OUT',
    }),
  );
  if (starterReappears) {
    rows.push(
      rawRow({
        observedDate,
        gameId,
        paNumber: rows.length + 1,
        batterId: 910000 + gameId,
        pitcherId,
        terminalCategory: 'K',
      }),
    );
  }
  return rows;
}

function pattern(kind, seed) {
  const batterA = 100000 + seed * 2;
  const batterB = batterA + 1;
  if (kind === 'signal') {
    return [
      { batterId: batterA, terminalCategory: 'K' },
      { batterId: batterB, terminalCategory: 'K' },
      { batterId: batterA, terminalCategory: '1B' },
      { batterId: batterB, terminalCategory: '1B' },
      { batterId: batterA, terminalCategory: '1B' },
      { batterId: batterB, terminalCategory: '1B' },
    ];
  }
  return [
    { batterId: batterA, terminalCategory: 'K' },
    { batterId: batterB, terminalCategory: '1B' },
    { batterId: batterA, terminalCategory: 'K' },
    { batterId: batterB, terminalCategory: '1B' },
    { batterId: batterA, terminalCategory: 'K' },
    { batterId: batterB, terminalCategory: '1B' },
  ];
}

function resolvedDataset({
  pitcherId,
  kind = 'signal',
  reverseRows = false,
  starterReappears = false,
  selectedSide,
  rowsIncluded = false,
}) {
  const fitRows = [];
  const validationRows = [];
  for (let game = 1; game <= 12; game += 1) {
    fitRows.push(
      ...teamGameRows({
        observedDate: `2026-04-${String(Math.ceil(game / 3)).padStart(2, '0')}`,
        gameId: 1000 + game,
        pitcherId,
        pattern: pattern(kind, game),
        starterReappears: starterReappears && game === 1,
      }),
    );
  }
  for (let game = 1; game <= 6; game += 1) {
    validationRows.push(
      ...teamGameRows({
        observedDate: `2026-05-${String(Math.ceil(game / 3)).padStart(2, '0')}`,
        gameId: 2000 + game,
        pitcherId,
        pattern: pattern(kind, game + 100),
      }),
    );
  }
  const dataset = {
    datasetVersion: 3,
    activeSeason: 2026,
    datasetSha256: RESOLVED_DATASET_SHA256,
    periods: {
      fit: { rows: reverseRows ? [...fitRows].reverse() : fitRows },
      validation: {
        rows: reverseRows ? [...validationRows].reverse() : validationRows,
      },
    },
    untouchedTestReservation: { rowsIncluded },
  };
  if (selectedSide !== undefined) dataset.selectedSide = selectedSide;
  return dataset;
}

function buildDataset(options = {}) {
  const terminal = terminalArtifact();
  const pitcherId = Number(Object.keys(terminal.pitcherAllowed)[0]);
  assert.ok(Number.isSafeInteger(pitcherId) && pitcherId > 0);
  return {
    terminal,
    pitcherId,
    dataset: buildM8_5TimesThroughOrderDataset({
      resolvedDataset: resolvedDataset({ pitcherId, ...options }),
      starterBullpenTransitionSha256: STARTER_BULLPEN_TRANSITION_SHA256,
    }),
  };
}

test('assigns exact starter exposures and preserves the separate starter-to-bullpen transition', () => {
  const normal = buildDataset();
  const reordered = buildDataset({ reverseRows: true });

  assert.deepEqual(normal.dataset, reordered.dataset);
  assert.equal(normal.dataset.periods.fit.teamGameCount, 12);
  assert.equal(normal.dataset.periods.validation.teamGameCount, 6);
  assert.equal(normal.dataset.totals.starterRowCount, 18 * 6);
  assert.equal(normal.dataset.totals.conservedBullpenRowCount, 18);
  assert.deepEqual(normal.dataset.totals.exposureCounts, {
    first: 18 * 2,
    second: 18 * 2,
    'third-plus': 18 * 2,
  });
  assert.deepEqual(
    normal.dataset.periods.fit.rows
      .filter((row) => row.gameId === 1001)
      .map((row) => [row.exposureNumber, row.exposureBucket]),
    [
      [1, 'first'],
      [1, 'first'],
      [2, 'second'],
      [2, 'second'],
      [3, 'third-plus'],
      [3, 'third-plus'],
    ],
  );
  assert.equal(normal.dataset.untouchedTestReservation.rowsIncluded, false);
  assert.match(normal.dataset.datasetSha256, /^[a-f0-9]{64}$/u);
});

test('selects a repeated-starter-exposure signal while first exposure remains exact identity', () => {
  const { terminal, pitcherId, dataset } = buildDataset({ kind: 'signal' });
  const evaluation = evaluateM8_5TimesThroughOrderCandidates({
    dataset,
    terminalArtifact: terminal,
    candidates: [
      { candidateId: 'tto-pool-1', equivalentPa: 1 },
      { candidateId: 'tto-pool-10', equivalentPa: 10 },
      { candidateId: 'tto-pool-100', equivalentPa: 100 },
    ],
  });

  assert.equal(evaluation.decision, 'VALIDATED_TIMES_THROUGH_ORDER_SIGNAL');
  assert.notEqual(evaluation.selectedCandidateId, 'identity');
  assert.equal(evaluation.invariants.firstExposureIsIdentity, true);
  assert.equal(evaluation.invariants.starterOnly, true);
  assert.equal(evaluation.invariants.bullpenRowsModeled, false);
  assert.equal(evaluation.invariants.starterBullpenTransitionChanged, false);
  assert.equal(evaluation.invariants.selectedSideInputUsed, false);
  assert.equal(evaluation.invariants.directProbabilityAdjustmentUsed, false);

  const pitcherVector = terminal.pitcherAllowed[String(pitcherId)];
  const first = applyM8_5TimesThroughOrderModelToPitcherVector({
    pitcherVector,
    exposureBucket: 'first',
    model: evaluation.finalModel,
  });
  const second = applyM8_5TimesThroughOrderModelToPitcherVector({
    pitcherVector,
    exposureBucket: 'second',
    model: evaluation.finalModel,
  });
  assert.deepEqual(first, pitcherVector);
  assert.notDeepEqual(second, pitcherVector);
  assert.ok(second['1B'] > first['1B']);
  assert.ok(second.K < first.K);
  assert.match(evaluation.evaluationSha256, /^[a-f0-9]{64}$/u);
});

test('retains the identity limit when exposure outcome distributions are identical', () => {
  const { terminal, dataset } = buildDataset({ kind: 'identity' });
  const evaluation = evaluateM8_5TimesThroughOrderCandidates({
    dataset,
    terminalArtifact: terminal,
    candidates: [
      { candidateId: 'tto-pool-1', equivalentPa: 1 },
      { candidateId: 'tto-pool-10', equivalentPa: 10 },
      { candidateId: 'tto-pool-100', equivalentPa: 100 },
    ],
  });

  assert.equal(
    evaluation.decision,
    'IDENTITY_RETAINED_NO_VALIDATED_TIMES_THROUGH_ORDER_SIGNAL',
  );
  assert.equal(evaluation.selectedCandidateId, 'identity');
  assert.deepEqual(
    evaluation.finalModel.multipliers.first,
    evaluation.finalModel.multipliers.second,
  );
  assert.deepEqual(
    evaluation.finalModel.multipliers.first,
    evaluation.finalModel.multipliers['third-plus'],
  );
});

test('fails closed on selected-side input, exposed untouched rows, hash drift, and starter reappearance', () => {
  const terminal = terminalArtifact();
  const pitcherId = Number(Object.keys(terminal.pitcherAllowed)[0]);

  assert.throws(
    () =>
      buildM8_5TimesThroughOrderDataset({
        resolvedDataset: resolvedDataset({ pitcherId, selectedSide: 'higher' }),
        starterBullpenTransitionSha256: STARTER_BULLPEN_TRANSITION_SHA256,
      }),
    /forbidden field selectedSide/u,
  );
  assert.throws(
    () =>
      buildM8_5TimesThroughOrderDataset({
        resolvedDataset: resolvedDataset({ pitcherId, rowsIncluded: true }),
        starterBullpenTransitionSha256: STARTER_BULLPEN_TRANSITION_SHA256,
      }),
    /untouched-test rows sealed/u,
  );
  assert.throws(
    () =>
      buildM8_5TimesThroughOrderDataset({
        resolvedDataset: resolvedDataset({ pitcherId }),
        starterBullpenTransitionSha256: 'not-a-sha',
      }),
    /lowercase SHA-256/u,
  );
  const reappeared = buildM8_5TimesThroughOrderDataset({
    resolvedDataset: resolvedDataset({ pitcherId, starterReappears: true }),
    starterBullpenTransitionSha256: STARTER_BULLPEN_TRANSITION_SHA256,
  });
  assert.equal(
    reappeared.exclusionReasonCounts['starter-reappeared-after-bullpen'],
    1,
  );
  assert.equal(reappeared.totals.excludedTeamGameCount, 1);

  const valid = buildDataset().dataset;
  assert.throws(
    () =>
      evaluateM8_5TimesThroughOrderCandidates({
        dataset: { ...valid, datasetSha256: '0'.repeat(64) },
        terminalArtifact: terminal,
      }),
    /dataset SHA-256 is invalid/u,
  );
});
