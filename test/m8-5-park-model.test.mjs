import test from 'node:test';
import assert from 'node:assert/strict';

import {
  evaluateM8_5ParkCandidates,
} from '../scripts/m8-5-park-model-utils.mjs';

const CATEGORIES = Object.freeze(['1B', 'BIP_OUT']);
const VENUES = Object.freeze(['Park A', 'Park B']);
const HANDS = Object.freeze(['L', 'R']);

function rows({ periodId, dates, signal }) {
  const result = [];
  let gameId = periodId === 'fit' ? 1 : 1000;
  for (const date of dates) {
    for (const venue of VENUES) {
      for (const hand of HANDS) {
        const hitCount = signal ? (venue === 'Park A' ? 16 : 4) : 10;
        for (let index = 0; index < 20; index += 1) {
          result.push(
            Object.freeze({
              rowId: `${periodId}:${date}:${venue}:${hand}:${index}`,
              periodId,
              observedDate: date,
              gameId: gameId++,
              venue,
              batterHand: hand,
              terminalCategory: index < hitCount ? '1B' : 'BIP_OUT',
              baseProbabilities: Object.freeze({ '1B': 0.5, BIP_OUT: 0.5 }),
            }),
          );
        }
      }
    }
  }
  return Object.freeze(result);
}

function dataset(signal) {
  const fitRows = rows({
    periodId: 'fit',
    dates: ['2026-05-01', '2026-05-02', '2026-05-03', '2026-05-04'],
    signal,
  });
  const validationRows = rows({
    periodId: 'validation',
    dates: ['2026-06-01', '2026-06-02', '2026-06-03'],
    signal,
  });
  return Object.freeze({
    datasetVersion: 1,
    activeSeason: 2026,
    datasetSha256: 'a'.repeat(64),
    categories: CATEGORIES,
    hitCategories: Object.freeze(['1B']),
    venues: VENUES,
    periods: Object.freeze({
      fit: Object.freeze({
        startDate: '2026-05-01',
        endDate: '2026-05-04',
        rowCount: fitRows.length,
        rows: fitRows,
      }),
      validation: Object.freeze({
        startDate: '2026-06-01',
        endDate: '2026-06-03',
        rowCount: validationRows.length,
        rows: validationRows,
      }),
    }),
    safety: Object.freeze({
      selectedSideInputUsed: false,
      directProbabilityAdjustmentUsed: false,
      priorSeasonRowsUsed: false,
      productionEnabled: false,
      rankingEnabled: false,
      untouchedTestRowsAccessed: false,
    }),
    untouchedTestReservation: Object.freeze({ rowsIncluded: false }),
  });
}

test('selects a handedness- and outcome-specific venue residual signal in fixed and walk-forward evaluation', () => {
  const result = evaluateM8_5ParkCandidates({
    dataset: dataset(true),
    candidates: [
      { candidateId: 'venue-hand-pool-2', equivalentPa: 2 },
      { candidateId: 'venue-hand-pool-10', equivalentPa: 10 },
      { candidateId: 'venue-hand-pool-50', equivalentPa: 50 },
    ],
  });
  assert.equal(result.decision, 'VALIDATED_PARK_SIGNAL');
  assert.equal(result.selectedCandidateId, 'venue-hand-pool-50');
  assert.ok(
    result.selectedFixedMetrics.categoricalLogLoss <
      result.identityFixedMetrics.categoricalLogLoss,
  );
  assert.ok(
    result.selectedWalkForwardMetrics.hitLogLoss <
      result.identityWalkForwardMetrics.hitLogLoss,
  );
  assert.ok(
    result.selectedModel.byVenue['Park A'].L.relativeRateMultipliers['1B'] > 1,
  );
  assert.ok(
    result.selectedModel.byVenue['Park B'].R.relativeRateMultipliers['1B'] < 1,
  );
  assert.equal(result.safety.selectedSideInputUsed, false);
  assert.equal(result.safety.directProbabilityAdjustmentUsed, false);
});

test('retains identity when venue outcomes match the frozen base probabilities', () => {
  const result = evaluateM8_5ParkCandidates({
    dataset: dataset(false),
    candidates: [
      { candidateId: 'venue-hand-pool-2', equivalentPa: 2 },
      { candidateId: 'venue-hand-pool-50', equivalentPa: 50 },
    ],
  });
  assert.equal(result.decision, 'IDENTITY_RETAINED_NO_VALIDATED_PARK_SIGNAL');
  assert.equal(result.selectedCandidateId, null);
  assert.equal(result.selectedModel, null);
});

test('rejects selected-side fields, direct probability fields, chronology drift, and unverified venues', () => {
  const source = dataset(true);
  assert.throws(
    () =>
      evaluateM8_5ParkCandidates({
        dataset: {
          ...source,
          periods: {
            ...source.periods,
            validation: {
              ...source.periods.validation,
              rows: [
                { ...source.periods.validation.rows[0], selectedSide: 'higher' },
                ...source.periods.validation.rows.slice(1),
              ],
            },
          },
        },
      }),
    /may not contain side or direct probability fields/,
  );
  assert.throws(
    () =>
      evaluateM8_5ParkCandidates({
        dataset: {
          ...source,
          periods: {
            ...source.periods,
            validation: {
              ...source.periods.validation,
              rows: [
                {
                  ...source.periods.validation.rows[0],
                  venue: 'Invented Park',
                },
                ...source.periods.validation.rows.slice(1),
              ],
            },
          },
        },
      }),
    /outside the verified audit/,
  );
  assert.throws(
    () =>
      evaluateM8_5ParkCandidates({
        dataset: {
          ...source,
          periods: {
            ...source.periods,
            fit: {
              ...source.periods.fit,
              rows: source.periods.fit.rows.map((row) => ({
                ...row,
                observedDate: '2026-06-02',
              })),
            },
          },
        },
      }),
    /chronology overlaps/,
  );
});
