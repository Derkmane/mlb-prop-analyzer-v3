import test from 'node:test';
import assert from 'node:assert/strict';

import {
  buildM8_5ParkFrozenBasePredictions,
  M8_5_PARK_FROZEN_BASE_EXPECTED,
} from '../scripts/m8-5-park-frozen-base-prediction-utils.mjs';

const CATEGORIES = Object.freeze(['1B', 'BIP_OUT']);
const BASE_PARAMETERS = Object.freeze({
  batterPooling: 256,
  pitcherPooling: 256,
  batterCoefficient: 1,
  pitcherAllowedCoefficient: 0.75,
});
const PLATOON_CANDIDATE = Object.freeze({
  candidateId: M8_5_PARK_FROZEN_BASE_EXPECTED.platoonCandidateId,
  leaguePlatoonPriorId:
    M8_5_PARK_FROZEN_BASE_EXPECTED.leaguePlatoonPriorId,
  leaguePlatoonEquivalentPa:
    M8_5_PARK_FROZEN_BASE_EXPECTED.leaguePlatoonEquivalentPa,
  leaguePlatoonExactTarget: false,
  playerSplitPriorId:
    M8_5_PARK_FROZEN_BASE_EXPECTED.playerSplitPriorId,
  playerSplitEquivalentPa:
    M8_5_PARK_FROZEN_BASE_EXPECTED.playerSplitEquivalentPa,
  playerSplitExactTarget: false,
  platoonCoefficient:
    M8_5_PARK_FROZEN_BASE_EXPECTED.platoonCoefficient,
});

function observation({
  id,
  date,
  gameId,
  batterId,
  pitcherId,
  category,
  batterHand,
  pitcherHand,
}) {
  const platoonEligible =
    (batterHand === 'L' || batterHand === 'R') &&
    (pitcherHand === 'L' || pitcherHand === 'R');
  return Object.freeze({
    observationId: id,
    observedDate: date,
    providerGameId: gameId,
    providerBatterId: batterId,
    providerPitcherId: pitcherId,
    terminalCategory: category,
    batterHand,
    normalizedBatterSide: platoonEligible ? batterHand : null,
    normalizedPitcherHand: platoonEligible ? pitcherHand : null,
    platoonEligible,
  });
}

function fitCell({ key, batterHand, pitcherHand, batterId, pitcherId, hits, outs }) {
  const rows = [];
  for (let index = 0; index < hits; index += 1) {
    rows.push(
      observation({
        id: `fit:${key}:h:${index}`,
        date: '2026-05-01',
        gameId: 100 + batterId,
        batterId,
        pitcherId,
        category: '1B',
        batterHand,
        pitcherHand,
      }),
    );
  }
  for (let index = 0; index < outs; index += 1) {
    rows.push(
      observation({
        id: `fit:${key}:o:${index}`,
        date: '2026-05-01',
        gameId: 200 + batterId,
        batterId,
        pitcherId,
        category: 'BIP_OUT',
        batterHand,
        pitcherHand,
      }),
    );
  }
  return rows;
}

function fitRows() {
  return [
    ...fitCell({
      key: 'LvL',
      batterHand: 'L',
      pitcherHand: 'L',
      batterId: 1,
      pitcherId: 11,
      hits: 3,
      outs: 1,
    }),
    ...fitCell({
      key: 'LvR',
      batterHand: 'L',
      pitcherHand: 'R',
      batterId: 1,
      pitcherId: 12,
      hits: 1,
      outs: 3,
    }),
    ...fitCell({
      key: 'RvL',
      batterHand: 'R',
      pitcherHand: 'L',
      batterId: 2,
      pitcherId: 11,
      hits: 1,
      outs: 3,
    }),
    ...fitCell({
      key: 'RvR',
      batterHand: 'R',
      pitcherHand: 'R',
      batterId: 2,
      pitcherId: 12,
      hits: 3,
      outs: 1,
    }),
  ];
}

function validationRows() {
  return [
    observation({
      id: 'validation:1',
      date: '2026-06-01',
      gameId: 301,
      batterId: 1,
      pitcherId: 11,
      category: '1B',
      batterHand: 'L',
      pitcherHand: 'L',
    }),
    observation({
      id: 'validation:2',
      date: '2026-06-01',
      gameId: 302,
      batterId: 1,
      pitcherId: 12,
      category: 'BIP_OUT',
      batterHand: 'L',
      pitcherHand: 'R',
    }),
    observation({
      id: 'validation:3',
      date: '2026-06-02',
      gameId: 303,
      batterId: 2,
      pitcherId: 11,
      category: 'BIP_OUT',
      batterHand: 'R',
      pitcherHand: 'L',
    }),
    observation({
      id: 'validation:4',
      date: '2026-06-02',
      gameId: 304,
      batterId: 2,
      pitcherId: 12,
      category: '1B',
      batterHand: 'R',
      pitcherHand: 'R',
    }),
  ];
}

function build(overrides = {}) {
  return buildM8_5ParkFrozenBasePredictions({
    fitObservations: fitRows(),
    validationObservations: validationRows(),
    modeledCategories: CATEGORIES,
    canonicalCategories: CATEGORIES,
    hitCategories: ['1B'],
    baseParameters: BASE_PARAMETERS,
    platoonCandidate: PLATOON_CANDIDATE,
    ...overrides,
  });
}

test('reproduces deterministic coherent and selected-platoon base distributions without side input', () => {
  const first = build();
  const second = build({ fitObservations: [...fitRows()].reverse() });
  assert.equal(first.predictionSha256, second.predictionSha256);
  assert.deepEqual(first.predictions, second.predictions);
  assert.equal(first.validationObservationCount, 4);
  assert.equal(first.validationPlatoonObservationCount, 4);
  assert.ok(
    first.predictions.some(
      (prediction) =>
        JSON.stringify(prediction.coherentProbabilities) !==
        JSON.stringify(prediction.baseProbabilities),
    ),
  );
  for (const prediction of first.predictions) {
    assert.ok(
      Math.abs(
        Object.values(prediction.baseProbabilities).reduce(
          (sum, probability) => sum + probability,
          0,
        ) - 1,
      ) < 1e-12,
    );
    assert.equal(Object.hasOwn(prediction, 'selectedSide'), false);
    assert.equal(Object.hasOwn(prediction, 'probabilityAdjustment'), false);
  }
});

test('keeps a switch hitter on the coherent base path instead of inventing platoon evidence', () => {
  const switchRow = observation({
    id: 'validation:switch',
    date: '2026-06-03',
    gameId: 305,
    batterId: 3,
    pitcherId: 12,
    category: 'BIP_OUT',
    batterHand: 'S',
    pitcherHand: null,
  });
  const result = build({
    validationObservations: [...validationRows(), switchRow],
  });
  const prediction = result.predictions.find(
    (candidate) => candidate.observationId === switchRow.observationId,
  );
  assert.equal(prediction.batterHand, 'S');
  assert.equal(prediction.platoonEligible, false);
  assert.deepEqual(prediction.baseProbabilities, prediction.coherentProbabilities);
});

test('rejects selected-side and direct-probability inputs instead of silently ignoring them', () => {
  assert.throws(
    () =>
      buildM8_5ParkFrozenBasePredictions({
        fitObservations: fitRows(),
        validationObservations: validationRows(),
        modeledCategories: CATEGORIES,
        canonicalCategories: CATEGORIES,
        hitCategories: ['1B'],
        baseParameters: BASE_PARAMETERS,
        platoonCandidate: PLATOON_CANDIDATE,
        selectedSide: 'higher',
      }),
    /selected side and direct probability adjustments are prohibited/,
  );
  assert.throws(
    () =>
      buildM8_5ParkFrozenBasePredictions({
        fitObservations: fitRows(),
        validationObservations: validationRows(),
        modeledCategories: CATEGORIES,
        canonicalCategories: CATEGORIES,
        hitCategories: ['1B'],
        baseParameters: BASE_PARAMETERS,
        platoonCandidate: PLATOON_CANDIDATE,
        directProbabilityAdjustment: 0.1,
      }),
    /selected side and direct probability adjustments are prohibited/,
  );
});

test('fails closed when an exact raw matchup cell lacks category support', () => {
  const missingSupport = fitRows().filter(
    (row) =>
      !(
        row.normalizedBatterSide === 'L' &&
        row.normalizedPitcherHand === 'L' &&
        row.terminalCategory === 'BIP_OUT'
      ),
  );
  assert.throws(
    () => build({ fitObservations: missingSupport }),
    /raw matchup target L-vs-L\.BIP_OUT must be positive and finite/,
  );
});

test('fails closed on handedness eligibility drift and duplicate observation identity', () => {
  const badHand = {
    ...validationRows()[0],
    normalizedPitcherHand: null,
    platoonEligible: true,
  };
  assert.throws(
    () => build({ validationObservations: [badHand, ...validationRows().slice(1)] }),
    /platoon eligibility disagrees/,
  );
  assert.throws(
    () => build({ validationObservations: [validationRows()[0], validationRows()[0]] }),
    /fit-validation observation identities must be unique/,
  );
});