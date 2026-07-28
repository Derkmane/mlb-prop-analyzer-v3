import assert from 'node:assert/strict';
import test from 'node:test';

import {
  evaluateFrozenPlatoonCandidateCohort,
} from '../scripts/m8-resolved-categorical-platoon-walk-forward-utils.mjs';
import {
  M8_EXTENDED_PLATOON_BOUNDARY_CANDIDATES,
} from '../scripts/m8-resolved-categorical-platoon-boundary-utils.mjs';

const CATEGORIES = Object.freeze(['K', '1B', '2B']);
const HIT_CATEGORIES = Object.freeze(['1B', '2B']);
const BASE_PARAMETERS = Object.freeze({
  batterPooling: 256,
  pitcherPooling: 256,
  batterCoefficient: 1,
  pitcherAllowedCoefficient: 0.75,
});
const SELECTED = M8_EXTENDED_PLATOON_BOUNDARY_CANDIDATES.find(
  (candidate) =>
    candidate.candidateId ===
    'league-raw-cell-limit-split-pa-1024-coefficient-0.75',
);
const BASELINE = M8_EXTENDED_PLATOON_BOUNDARY_CANDIDATES.find(
  (candidate) => candidate.candidateId === 'no-platoon',
);

assert.ok(SELECTED);
assert.ok(BASELINE);

function sidesForMatchup(key) {
  const [batterSide, pitcherHand] = key.split('-vs-');
  return { batterSide, pitcherHand };
}

function observation({
  id,
  date,
  batterId,
  pitcherId,
  terminalCategory,
  matchupKey,
}) {
  const { batterSide, pitcherHand } = sidesForMatchup(matchupKey);
  return Object.freeze({
    observationId: id,
    observedDate: date,
    providerBatterId: batterId,
    providerPitcherId: pitcherId,
    terminalCategory,
    platoonEligible: true,
    normalizedBatterSide: batterSide,
    normalizedPitcherHand: pitcherHand,
    matchupKey,
  });
}

function buildCohorts() {
  const matchupKeys = ['L-vs-L', 'L-vs-R', 'R-vs-L', 'R-vs-R'];
  const trainingPlatoon = [];
  let id = 1;
  for (const [matchupIndex, matchupKey] of matchupKeys.entries()) {
    for (const [categoryIndex, terminalCategory] of CATEGORIES.entries()) {
      for (let repeat = 0; repeat < 4; repeat += 1) {
        trainingPlatoon.push(
          observation({
            id: `fit-${id}`,
            date: `2026-05-${String(1 + matchupIndex).padStart(2, '0')}`,
            batterId: 100 + matchupIndex * 10 + repeat,
            pitcherId: 200 + matchupIndex * 10 + categoryIndex,
            terminalCategory,
            matchupKey,
          }),
        );
        id += 1;
      }
    }
  }

  const validationPlatoon = matchupKeys.flatMap((matchupKey, matchupIndex) =>
    CATEGORIES.map((terminalCategory, categoryIndex) =>
      observation({
        id: `validation-${matchupIndex}-${categoryIndex}`,
        date: matchupIndex < 2 ? '2026-06-22' : '2026-06-23',
        batterId: 100 + matchupIndex * 10 + categoryIndex,
        pitcherId: 200 + matchupIndex * 10 + categoryIndex,
        terminalCategory,
        matchupKey,
      }),
    ),
  );

  return Object.freeze({
    trainingOverall: Object.freeze([...trainingPlatoon]),
    trainingPlatoon: Object.freeze(trainingPlatoon),
    validationPlatoon: Object.freeze(validationPlatoon),
  });
}

function score(candidate, cohorts = buildCohorts()) {
  return evaluateFrozenPlatoonCandidateCohort({
    categories: CATEGORIES,
    hitCategories: HIT_CATEGORIES,
    ...cohorts,
    baseParameters: BASE_PARAMETERS,
    candidate,
  });
}

test('scores the frozen raw-cell candidate and no-platoon baseline on one identical cohort', () => {
  const selected = score(SELECTED);
  const baseline = score(BASELINE);
  assert.equal(selected.validationObservationCount, 12);
  assert.equal(baseline.validationObservationCount, 12);
  assert.equal(
    selected.validationObservationIdsSha256,
    baseline.validationObservationIdsSha256,
  );
  assert.deepEqual(Object.keys(selected.rawMatchupSupport), [
    'L-vs-L',
    'L-vs-R',
    'R-vs-L',
    'R-vs-R',
  ]);
  assert.equal(baseline.rawMatchupSupport, null);
});

test('keeps the frozen candidate immutable and uses the approved base coefficients', () => {
  const beforeCandidate = JSON.stringify(SELECTED);
  const beforeBase = JSON.stringify(BASE_PARAMETERS);
  const result = score(SELECTED);
  assert.equal(result.candidate, SELECTED);
  assert.equal(JSON.stringify(SELECTED), beforeCandidate);
  assert.equal(JSON.stringify(BASE_PARAMETERS), beforeBase);
  assert.ok(Number.isFinite(result.validationCategoricalLogLoss));
  assert.ok(Number.isFinite(result.validationHitLogLoss));
});

test('is deterministic for identical current-season cohorts', () => {
  const cohorts = buildCohorts();
  const first = score(SELECTED, cohorts);
  const second = score(SELECTED, cohorts);
  assert.deepEqual(first, second);
});

test('fails closed when an exact raw matchup cell lacks one modeled category', () => {
  const cohorts = buildCohorts();
  const trainingPlatoon = cohorts.trainingPlatoon.filter(
    (row) => !(row.matchupKey === 'L-vs-L' && row.terminalCategory === '2B'),
  );
  assert.throws(
    () =>
      score(SELECTED, {
        trainingOverall: cohorts.trainingOverall,
        trainingPlatoon,
        validationPlatoon: cohorts.validationPlatoon,
      }),
    /raw league-platoon cell L-vs-L has zero support for 2B/,
  );
});

test('does not require raw-cell support for the no-platoon baseline', () => {
  const cohorts = buildCohorts();
  const trainingPlatoon = cohorts.trainingPlatoon.filter(
    (row) => !(row.matchupKey === 'L-vs-L' && row.terminalCategory === '2B'),
  );
  const result = score(BASELINE, {
    trainingOverall: cohorts.trainingOverall,
    trainingPlatoon,
    validationPlatoon: cohorts.validationPlatoon,
  });
  assert.equal(result.validationObservationCount, 12);
  assert.equal(result.rawMatchupSupport, null);
});

test('rejects empty cohorts and noncanonical hit categories', () => {
  const cohorts = buildCohorts();
  assert.throws(
    () =>
      evaluateFrozenPlatoonCandidateCohort({
        categories: CATEGORIES,
        hitCategories: HIT_CATEGORIES,
        trainingOverall: cohorts.trainingOverall,
        trainingPlatoon: cohorts.trainingPlatoon,
        validationPlatoon: [],
        baseParameters: BASE_PARAMETERS,
        candidate: SELECTED,
      }),
    /cohorts must be non-empty/,
  );
  assert.throws(
    () =>
      evaluateFrozenPlatoonCandidateCohort({
        categories: CATEGORIES,
        hitCategories: ['HR'],
        ...cohorts,
        baseParameters: BASE_PARAMETERS,
        candidate: SELECTED,
      }),
    /hit category HR is not modeled/,
  );
});
