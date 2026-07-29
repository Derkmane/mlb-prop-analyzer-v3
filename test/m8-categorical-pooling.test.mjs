import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import {
  evaluateCategoricalPoolingPath,
  evaluateM8CategoricalPoolingCandidates,
  poolCategoricalCountsOnce,
} from '../scripts/m8-categorical-pooling-utils.mjs';
import { sha256 } from '../scripts/provider-probe-utils.mjs';

const categories = Object.freeze(['HIT', 'OUT', 'WALK']);
const leagueTarget = Object.freeze({ HIT: 0.25, OUT: 0.65, WALK: 0.1 });

function l1(left, right) {
  return categories.reduce(
    (sum, category) => sum + Math.abs(left[category] - right[category]),
    0,
  );
}

function observation(id, identity, terminalCategory) {
  return Object.freeze({
    observationId: id,
    observedDate: '2026-06-01',
    providerBatterId: identity,
    providerPitcherId: identity,
    terminalCategory,
  });
}

test('pools one complete categorical vector and maps an unseen identity exactly to the current-season league target', () => {
  const unseen = poolCategoricalCountsOnce({
    categories,
    source: {
      kind: 'raw-current-season-categorical-counts',
      counts: { HIT: 0, OUT: 0, WALK: 0 },
    },
    leagueTarget,
    leagueEquivalentPa: 16,
  });

  assert.deepEqual(unseen.probabilities, leagueTarget);
  assert.equal(
    Object.values(unseen.probabilities).reduce((sum, value) => sum + value, 0),
    1,
  );
  assert.equal(unseen.poolingPassCount, 1);
  assert.equal(unseen.rawObservationCount, 0);
});

test('sparse identities remain closer to the league target while large samples approach their raw categorical rates', () => {
  const rawRate = Object.freeze({ HIT: 0, OUT: 1, WALK: 0 });
  const sparse = poolCategoricalCountsOnce({
    categories,
    source: {
      kind: 'raw-current-season-categorical-counts',
      counts: { HIT: 0, OUT: 2, WALK: 0 },
    },
    leagueTarget,
    leagueEquivalentPa: 16,
  });
  const large = poolCategoricalCountsOnce({
    categories,
    source: {
      kind: 'raw-current-season-categorical-counts',
      counts: { HIT: 0, OUT: 200, WALK: 0 },
    },
    leagueTarget,
    leagueEquivalentPa: 16,
  });

  assert.ok(l1(sparse.probabilities, leagueTarget) < l1(large.probabilities, leagueTarget));
  assert.ok(l1(large.probabilities, rawRate) < l1(sparse.probabilities, rawRate));
  assert.ok(large.probabilities.OUT > sparse.probabilities.OUT);
});

test('rejects a second shrinkage pass instead of accepting an already pooled estimate as raw counts', () => {
  const first = poolCategoricalCountsOnce({
    categories,
    source: {
      kind: 'raw-current-season-categorical-counts',
      counts: { HIT: 2, OUT: 6, WALK: 2 },
    },
    leagueTarget,
    leagueEquivalentPa: 8,
  });

  assert.throws(
    () =>
      poolCategoricalCountsOnce({
        categories,
        source: first,
        leagueTarget,
        leagueEquivalentPa: 8,
      }),
    /pooled estimates cannot be pooled again/,
  );
});

test('selects pooling strength from one identical later-validation cohort', () => {
  const fit = [];
  const validation = [];
  for (let index = 0; index < 9; index += 1) {
    fit.push(observation(`fit-a-hit-${index}`, 1, 'HIT'));
    fit.push(observation(`fit-b-out-${index}`, 2, 'OUT'));
  }
  fit.push(observation('fit-a-out', 1, 'OUT'));
  fit.push(observation('fit-b-hit', 2, 'HIT'));
  for (let index = 0; index < 5; index += 1) {
    validation.push(observation(`validation-a-${index}`, 1, 'HIT'));
    validation.push(observation(`validation-b-${index}`, 2, 'OUT'));
  }

  const result = evaluateCategoricalPoolingPath({
    categories: ['HIT', 'OUT'],
    fitObservations: fit,
    validationObservations: validation,
    identityKey: 'providerBatterId',
    parameterId: 'synthetic-batter-vector',
    candidates: [
      { candidateId: 'league-pa-1', leagueEquivalentPa: 1 },
      { candidateId: 'league-pa-64', leagueEquivalentPa: 64 },
    ],
  });

  assert.equal(result.selection.status, 'validation-candidate-selected');
  assert.equal(result.selection.selectedCandidate.candidateId, 'league-pa-1');
  assert.equal(result.validationObservationCount, 10);
  assert.equal(result.poolingPassCount, 1);
  assert.equal(result.secondShrinkageAllowed, false);
  assert.ok(
    result.results.every(
      (candidateResult) =>
        candidateResult.validationObservationCount === 10 &&
        candidateResult.validationObservationIdsSha256 ===
          result.validationObservationIdsSha256,
    ),
  );
});

test('fails closed when validation contains a terminal category with no current-season fit support', () => {
  assert.throws(
    () =>
      evaluateCategoricalPoolingPath({
        categories: ['HIT', 'OUT', 'WALK'],
        fitObservations: [
          observation('fit-hit', 1, 'HIT'),
          observation('fit-out', 1, 'OUT'),
        ],
        validationObservations: [observation('validation-walk', 1, 'WALK')],
        identityKey: 'providerBatterId',
        parameterId: 'synthetic-batter-vector',
        candidates: [
          { candidateId: 'league-pa-1', leagueEquivalentPa: 1 },
          { candidateId: 'league-pa-2', leagueEquivalentPa: 2 },
        ],
      }),
    /has no current-season fit support/,
  );
});

test('rejects a source dataset that exposes untouched-test rows', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'm8-categorical-pooling-'));
  try {
    const emptyPeriod = {
      startDate: '2026-03-26',
      endDate: '2026-03-26',
      rowCount: 0,
      classifiedTerminalCount: 0,
      rows: [],
    };
    const identity = {
      activeSeason: 2026,
      sourcePartitionSha256: 'a'.repeat(64),
      sourceEvidenceSetSha256: 'b'.repeat(64),
      periods: {
        fit: emptyPeriod,
        validation: {
          ...emptyPeriod,
          startDate: '2026-03-27',
          endDate: '2026-03-27',
        },
      },
      untouchedTestReservation: {
        startDate: '2026-03-28',
        endDate: '2026-03-28',
        plateAppearanceCount: 1,
        rowsIncluded: false,
        rows: [{ forbidden: true }],
      },
    };
    const dataset = {
      datasetVersion: 2,
      purpose: 'synthetic test dataset',
      ...identity,
      totals: {},
      datasetSha256: sha256(JSON.stringify(identity)),
    };
    const datasetPath = path.join(root, 'dataset.json');
    await writeFile(datasetPath, `${JSON.stringify(dataset, null, 2)}\n`, 'utf8');

    await assert.rejects(
      evaluateM8CategoricalPoolingCandidates({
        datasetPath,
        categories: ['HIT', 'OUT'],
        candidates: [
          { candidateId: 'league-pa-1', leagueEquivalentPa: 1 },
          { candidateId: 'league-pa-2', leagueEquivalentPa: 2 },
        ],
      }),
      /test rows must remain absent/,
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
