import assert from 'node:assert/strict';
import test from 'node:test';

import {
  buildM8StarterBullpenDataset,
  evaluateM8StarterBullpenTransition,
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
  assert.equal(evaluation.selectionAgreement, true);
  assert.equal(
    evaluation.fixedSelectedCandidateId,
    evaluation.walkForward.selectedCandidateId,
  );
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
