import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import test from 'node:test';

import {
  evaluateM8PaSurvivalCandidates,
  m8PaCountPmfToSurvival,
  m8PaSurvivalToCountPmf,
} from '../scripts/m8-pa-survival-evaluation-utils.mjs';

const sha256 = (value) =>
  createHash('sha256').update(value).digest('hex');
const digest = (character) => character.repeat(64);

function row({ id, date, periodId, side, slot, pa }) {
  return {
    rowId: id,
    observedDate: date,
    periodId,
    gameId:
      Number(id.replace(/\D/g, '').slice(0, 6)) || 1,
    side,
    homeAway: side,
    teamId: 1,
    playerId: 1,
    playerName: 'Synthetic',
    lineupSlot: slot,
    plateAppearances: pa,
    sourceField: 'stats.plate_appearances',
    componentCandidate: pa,
    componentAuditStatus: 'exact',
    sourceCaptureSha256: digest('a'),
    sourceStatsRawBodySha256s: [digest('b')],
    sourceLineupRawBodySha256s: [digest('c')],
  };
}

function dataset({
  fitRows,
  validationRows,
  untouched = {
    startDate: '2026-07-06',
    endDate: '2026-07-25',
    rowsIncluded: false,
  },
}) {
  return {
    datasetVersion: 1,
    provider: 'BALLDONTLIE MLB API',
    activeSeason: 2026,
    sourceCaptureManifestSha256: digest('d'),
    sourceCapturePlanSha256: digest('e'),
    sourceResolvedDatasetSha256: digest('f'),
    includedPeriods: ['fit', 'validation'],
    untouchedTestReservation: untouched,
    exclusionPolicy: {
      incompleteOfficialLineupGame: 'exclude-entire-game',
      missingStarterStatsRow: 'exclude-starter-observation',
      duplicateStarterStatsRows: 'exclude-starter-observation',
      nullDirectPlateAppearances: 'exclude-starter-observation',
      componentArithmeticMismatch:
        'retain-direct-stats.plate_appearances-and-preserve-audit-flag',
      componentArithmeticFallback: 'prohibited',
    },
    totals: {},
    periods: {
      fit: {
        rowCount: fitRows.length,
        rows: fitRows,
      },
      validation: {
        rowCount: validationRows.length,
        rows: validationRows,
      },
    },
    incompleteLineupGames: [],
    excludedStarterObservations: [],
    datasetSha256: digest('1'),
  };
}

const candidates = [
  {
    candidateId: 'league-only',
    grouping: 'league',
    leagueEquivalentObservations: null,
  },
  {
    candidateId: 'slot-pool-1',
    grouping: 'slot',
    leagueEquivalentObservations: 1,
  },
  {
    candidateId: 'slot-home-away-pool-1',
    grouping: 'slot-home-away',
    leagueEquivalentObservations: 1,
  },
];

test('survival conversion is exact and monotone by construction', () => {
  const pmf = [0.05, 0.1, 0.2, 0.4, 0.25];
  const survival = m8PaCountPmfToSurvival(pmf);
  [0.95, 0.85, 0.65, 0.25].forEach((value, index) =>
    assert.ok(Math.abs(survival[index] - value) < 1e-12),
  );
  const reconstructed = m8PaSurvivalToCountPmf(survival);
  reconstructed.forEach((value, index) =>
    assert.ok(Math.abs(value - pmf[index]) < 1e-12),
  );
});

test('fit-only slot-home-away model wins when validation follows fit structure', () => {
  const fitRows = [];
  const validationRows = [];
  let index = 0;
  for (const side of ['away', 'home']) {
    for (let slot = 1; slot <= 9; slot += 1) {
      const primary =
        side === 'away'
          ? slot <= 4
            ? 5
            : 4
          : slot <= 4
            ? 4
            : 3;
      for (let repeat = 0; repeat < 8; repeat += 1) {
        fitRows.push(
          row({
            id: `fit-${index++}`,
            date: `2026-06-${String(
              1 + Math.floor(index / 50),
            ).padStart(2, '0')}`,
            periodId: 'fit',
            side,
            slot,
            pa: repeat === 0 ? primary - 1 : primary,
          }),
        );
      }
      for (let repeat = 0; repeat < 3; repeat += 1) {
        validationRows.push(
          row({
            id: `validation-${index++}`,
            date: `2026-07-${String(
              1 + Math.floor(index / 100),
            ).padStart(2, '0')}`,
            periodId: 'validation',
            side,
            slot,
            pa: primary,
          }),
        );
      }
    }
  }
  const rawDataset = dataset({
    fitRows,
    validationRows,
  });
  const result = evaluateM8PaSurvivalCandidates({
    rawDataset,
    datasetFileSha256: sha256(JSON.stringify(rawDataset)),
    candidates,
  });
  assert.equal(
    result.selectedCandidateId,
    'slot-home-away-pool-1',
  );
  assert.equal(
    result.selectedModel.monotoneProjectionApplied,
    false,
  );
  assert.ok(
    result.candidateSummaries.every(
      (candidate) => candidate.actualProbabilityMinimum > 0,
    ),
  );
  const rerun = evaluateM8PaSurvivalCandidates({
    rawDataset,
    datasetFileSha256: sha256(JSON.stringify(rawDataset)),
    candidates,
  });
  assert.equal(rerun.evaluationSha256, result.evaluationSha256);
});

test('validation outcomes do not alter fitted selected-model curves', () => {
  const fitRows = [];
  let index = 0;
  for (const side of ['away', 'home']) {
    for (let slot = 1; slot <= 9; slot += 1) {
      for (const pa of [3, 4, 4, 5]) {
        fitRows.push(
          row({
            id: `fit-${index++}`,
            date: '2026-06-01',
            periodId: 'fit',
            side,
            slot,
            pa,
          }),
        );
      }
    }
  }
  const validationA = [
    row({
      id: 'validation-a',
      date: '2026-07-01',
      periodId: 'validation',
      side: 'away',
      slot: 1,
      pa: 3,
    }),
  ];
  const validationB = [
    row({
      id: 'validation-b',
      date: '2026-07-01',
      periodId: 'validation',
      side: 'away',
      slot: 1,
      pa: 4,
    }),
  ];
  const onlyCandidate = [
    {
      candidateId: 'slot-home-away-pool-5',
      grouping: 'slot-home-away',
      leagueEquivalentObservations: 5,
    },
  ];
  const dataA = dataset({
    fitRows,
    validationRows: validationA,
  });
  const dataB = dataset({
    fitRows,
    validationRows: validationB,
  });
  const resultA = evaluateM8PaSurvivalCandidates({
    rawDataset: dataA,
    datasetFileSha256: sha256(JSON.stringify(dataA)),
    candidates: onlyCandidate,
  });
  const resultB = evaluateM8PaSurvivalCandidates({
    rawDataset: dataB,
    datasetFileSha256: sha256(JSON.stringify(dataB)),
    candidates: onlyCandidate,
  });
  assert.deepEqual(
    resultA.selectedModel.groups,
    resultB.selectedModel.groups,
  );
  assert.notEqual(
    resultA.candidateSummaries[0].logLoss,
    resultB.candidateSummaries[0].logLoss,
  );
});

test('fails closed for unsupported validation counts and exposed untouched rows', () => {
  const fitRows = [];
  let index = 0;
  for (const side of ['away', 'home']) {
    for (let slot = 1; slot <= 9; slot += 1) {
      fitRows.push(
        row({
          id: `fit-${index++}`,
          date: '2026-06-01',
          periodId: 'fit',
          side,
          slot,
          pa: 4,
        }),
      );
    }
  }
  const unsupported = dataset({
    fitRows,
    validationRows: [
      row({
        id: 'validation-unsupported',
        date: '2026-07-01',
        periodId: 'validation',
        side: 'away',
        slot: 1,
        pa: 5,
      }),
    ],
  });
  assert.throws(
    () =>
      evaluateM8PaSurvivalCandidates({
        rawDataset: unsupported,
        datasetFileSha256: sha256(JSON.stringify(unsupported)),
        candidates,
      }),
    /beyond fit support/,
  );
  const exposed = dataset({
    fitRows,
    validationRows: [
      row({
        id: 'validation-supported',
        date: '2026-07-01',
        periodId: 'validation',
        side: 'away',
        slot: 1,
        pa: 4,
      }),
    ],
    untouched: {
      startDate: '2026-07-06',
      endDate: '2026-07-25',
      rowsIncluded: false,
      rows: [],
    },
  });
  assert.throws(
    () =>
      evaluateM8PaSurvivalCandidates({
        rawDataset: exposed,
        datasetFileSha256: sha256(JSON.stringify(exposed)),
        candidates,
      }),
    /untouched-test rows must remain excluded/,
  );
});
