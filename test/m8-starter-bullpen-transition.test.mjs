import assert from 'node:assert/strict';
import test from 'node:test';

import {
  DEFAULT_M8_STARTER_BULLPEN_CANDIDATES,
  buildM8StarterBullpenDataset,
  computeM8StarterBullpenNondominatedCandidateIds,
  evaluateM8StarterBullpenTransition,
  selectM8StarterBullpenCandidate,
  verifyM8StarterBullpenEvaluation,
} from '../scripts/m8-starter-bullpen-transition-utils.mjs';

function pa({ gameId, date, number, half, pitcherId, category = 'BIP_OUT' }) {
  return {
    rowId: `${date}:${gameId}:${number}:${half}`,
    observedDate: date,
    providerGameId: gameId,
    providerPaNumber: number,
    providerBatterId: 1000 + number,
    providerPitcherId: pitcherId,
    halfInning: half,
    mappingStatus: 'classified-terminal',
    includedInOverallOutcomeModel: true,
    terminalCategory: category,
    normalizedPitcherHand: pitcherId % 2 === 0 ? 'R' : 'L',
    normalizedBatterSide: number % 2 === 0 ? 'L' : 'R',
  };
}

function sideRows(gameId, date, half, starterId, starterBf, totalBf) {
  return Array.from({ length: totalBf }, (_, index) =>
    pa({
      gameId,
      date,
      number: index + 1,
      half,
      pitcherId: index < starterBf ? starterId : starterId + 100,
      category: index % 4 === 0 ? '1B' : 'BIP_OUT',
    }),
  );
}

function dataset() {
  const fit = [];
  const validation = [];
  for (let game = 1; game <= 20; game += 1) {
    const date = `2026-05-${String(game).padStart(2, '0')}`;
    fit.push(...sideRows(game, date, 'top', 10 + game, 3, 6));
    fit.push(...sideRows(game, date, 'bottom', 30 + game, 5, 6));
  }
  for (let game = 21; game <= 26; game += 1) {
    const date = `2026-06-${String(game).padStart(2, '0')}`;
    validation.push(...sideRows(game, date, 'top', 10 + game, 3, 6));
    validation.push(...sideRows(game, date, 'bottom', 30 + game, 5, 6));
  }
  return {
    datasetVersion: 3,
    activeSeason: 2026,
    datasetSha256: 'a'.repeat(64),
    periods: {
      fit: { rows: fit },
      validation: { rows: validation },
    },
    untouchedTestReservation: {
      startDate: '2026-07-06',
      endDate: '2026-07-25',
      rowsIncluded: false,
    },
  };
}

test('recovers the starter block, conserves team PA, and selects one stable workload model', () => {
  const recovered = buildM8StarterBullpenDataset(dataset());
  assert.equal(recovered.totals.includedTeamGameCount, 52);
  assert.equal(recovered.totals.excludedTeamGameCount, 0);
  for (const period of Object.values(recovered.periods)) {
    for (const row of period.rows) {
      assert.equal(
        row.starterBattersFaced + row.bullpenBattersFaced,
        row.totalBattersFaced,
      );
    }
  }

  const evaluation = evaluateM8StarterBullpenTransition({ rawDataset: recovered });
  verifyM8StarterBullpenEvaluation(evaluation);
  assert.equal(evaluation.stableSelection, true);
  assert.equal(
    evaluation.fixedSelectedCandidateId,
    evaluation.walkForward.selectedCandidateId,
  );
  assert.ok(evaluation.admissibleCandidateIds.includes(evaluation.selectedCandidateId));
  assert.equal(evaluation.finalModel.candidate.candidateId, evaluation.selectedCandidateId);
  assert.equal(
    evaluation.finalModel.bySide.away.reduce((sum, value) => sum + value, 0),
    1,
  );
  assert.equal(
    evaluation.finalModel.bySide.home.reduce((sum, value) => sum + value, 0),
    1,
  );
});

test('a starter who reappears after the bullpen is rejected instead of repaired', () => {
  const source = dataset();
  const badGame = 100;
  source.periods.fit.rows.push(
    pa({ gameId: badGame, date: '2026-05-25', number: 1, half: 'top', pitcherId: 1 }),
    pa({ gameId: badGame, date: '2026-05-25', number: 2, half: 'top', pitcherId: 2 }),
    pa({ gameId: badGame, date: '2026-05-25', number: 3, half: 'top', pitcherId: 1 }),
  );
  const recovered = buildM8StarterBullpenDataset(source);
  assert.equal(recovered.exclusionReasonCounts['starter-reappeared-after-bullpen'], 1);
  assert.ok(
    recovered.periods.fit.rows.every((row) => row.gameId !== badGame),
  );
});


const candidateById = new Map(
  DEFAULT_M8_STARTER_BULLPEN_CANDIDATES.map((candidate) => [candidate.candidateId, candidate]),
);

function scored(candidateId, logLoss, multiclassBrier) {
  const candidate = candidateById.get(candidateId);
  if (!candidate) throw new Error(`unknown test candidate ${candidateId}`);
  return { candidate, metrics: { logLoss, multiclassBrier } };
}

test('the real-shape proper-score frontiers select side-pool-1000', () => {
  assert.deepEqual(
    DEFAULT_M8_STARTER_BULLPEN_CANDIDATES.map((candidate) => candidate.candidateId),
    [
      'starter-bf-side-pool-10',
      'starter-bf-side-pool-25',
      'starter-bf-side-pool-50',
      'starter-bf-side-pool-100',
      'starter-bf-side-pool-250',
      'starter-bf-side-pool-500',
      'starter-bf-side-pool-1000',
      'starter-bf-league',
    ],
  );
  const fixedResults = [
    scored('starter-bf-side-pool-10', 2.848679651177694, 0.9268310592726594),
    scored('starter-bf-side-pool-25', 2.848625839884098, 0.9268221983333319),
    scored('starter-bf-side-pool-50', 2.8485441280168833, 0.9268082852943009),
    scored('starter-bf-side-pool-100', 2.8484068673282326, 0.9267833300733421),
    scored('starter-bf-side-pool-250', 2.8481484036883873, 0.9267262163529916),
    scored('starter-bf-side-pool-500', 2.8480057054840135, 0.9266681373491591),
    scored('starter-bf-side-pool-1000', 2.848105162546217, 0.926614844041183),
    scored('starter-bf-league', 2.850462309846479, 0.9266005135161092),
  ];
  const walkForwardResults = [
    scored('starter-bf-side-pool-10', 2.8529344427081216, 0.9266697073696496),
    scored('starter-bf-side-pool-25', 2.8528557708147284, 0.926663055423049),
    scored('starter-bf-side-pool-50', 2.852733329655666, 0.9266526205122834),
    scored('starter-bf-side-pool-100', 2.8525173895096176, 0.9266339454118445),
    scored('starter-bf-side-pool-250', 2.8520458399217152, 0.9265915755449415),
    scored('starter-bf-side-pool-500', 2.851617827045183, 0.9265497133917449),
    scored('starter-bf-side-pool-1000', 2.8513316062022067, 0.9265147051602064),
    scored('starter-bf-league', 2.852502338276471, 0.9265571731930152),
  ];
  const selection = selectM8StarterBullpenCandidate({ fixedResults, walkForwardResults });
  assert.deepEqual(selection.fixedNondominatedCandidateIds, [
    'starter-bf-side-pool-500',
    'starter-bf-side-pool-1000',
    'starter-bf-league',
  ]);
  assert.deepEqual(selection.walkForwardNondominatedCandidateIds, [
    'starter-bf-side-pool-1000',
  ]);
  assert.deepEqual(selection.admissibleCandidateIds, ['starter-bf-side-pool-1000']);
  assert.equal(selection.stable, true);
  assert.equal(selection.selectedCandidateId, 'starter-bf-side-pool-1000');
});

test('proper-score sign disagreement keeps both candidates nondominated', () => {
  const ids = computeM8StarterBullpenNondominatedCandidateIds([
    scored('starter-bf-side-pool-500', 1, 2),
    scored('starter-bf-side-pool-1000', 2, 1),
  ]);
  assert.deepEqual(ids, ['starter-bf-side-pool-500', 'starter-bf-side-pool-1000']);
});

test('the full Pareto comparison removes a candidate dominated by a non-log-loss winner', () => {
  const ids = computeM8StarterBullpenNondominatedCandidateIds([
    scored('starter-bf-side-pool-500', 1, 3),
    scored('starter-bf-side-pool-1000', 2, 1),
    scored('starter-bf-league', 3, 2),
  ]);
  assert.deepEqual(ids, ['starter-bf-side-pool-500', 'starter-bf-side-pool-1000']);
});

test('contradictory fixed and walk-forward frontiers fail closed', () => {
  const fixedResults = [
    scored('starter-bf-side-pool-500', 1, 1),
    scored('starter-bf-side-pool-1000', 2, 2),
  ];
  const walkForwardResults = [
    scored('starter-bf-side-pool-500', 2, 2),
    scored('starter-bf-side-pool-1000', 1, 1),
  ];
  const selection = selectM8StarterBullpenCandidate({ fixedResults, walkForwardResults });
  assert.equal(selection.stable, false);
  assert.equal(selection.reason, 'EMPTY_ADMISSIBLE_SET');
  assert.equal(selection.selectedCandidateId, null);
  assert.deepEqual(selection.admissibleCandidateIds, []);
});

test('strongest-pooling selection is deterministic under input reordering', () => {
  const results = [
    scored('starter-bf-side-pool-500', 1, 3),
    scored('starter-bf-side-pool-1000', 2, 2),
    scored('starter-bf-league', 3, 1),
  ];
  const forward = selectM8StarterBullpenCandidate({
    fixedResults: results,
    walkForwardResults: results,
  });
  const reversed = selectM8StarterBullpenCandidate({
    fixedResults: [...results].reverse(),
    walkForwardResults: [...results].reverse(),
  });
  assert.equal(forward.selectedCandidateId, 'starter-bf-league');
  assert.equal(reversed.selectedCandidateId, forward.selectedCandidateId);
});

test('untouched-test rows cannot enter starter-bullpen candidate selection', () => {
  const source = dataset();
  source.untouchedTestReservation.rowsIncluded = true;
  assert.throws(
    () => buildM8StarterBullpenDataset(source),
    /must keep untouched-test rows sealed/,
  );
});

test('identical inputs produce an identical starter-bullpen evaluation', () => {
  const recovered = buildM8StarterBullpenDataset(dataset());
  const first = evaluateM8StarterBullpenTransition({ rawDataset: recovered });
  const second = evaluateM8StarterBullpenTransition({ rawDataset: recovered });
  assert.equal(JSON.stringify(second), JSON.stringify(first));
});
