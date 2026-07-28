import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { poolCategoricalCountsOnce } from '../scripts/m8-categorical-pooling-utils.mjs';
import {
  combineSinglePassCategoricalEffects,
  evaluateCoherentCategoricalMatchupCandidates,
  evaluateM8CoherentCategoricalMatchup,
} from '../scripts/m8-coherent-categorical-matchup-utils.mjs';
import { sha256 } from '../scripts/provider-probe-utils.mjs';

const categories = Object.freeze(['HIT', 'OUT', 'WALK']);
const leagueTarget = Object.freeze({ HIT: 0.25, OUT: 0.65, WALK: 0.1 });

function approximateDistribution(actual, expected, tolerance = 1e-12) {
  for (const category of Object.keys(expected)) {
    assert.ok(
      Math.abs(actual[category] - expected[category]) <= tolerance,
      `${category}: expected ${expected[category]}, received ${actual[category]}`,
    );
  }
}

function pooled(counts, strength = 8) {
  return poolCategoricalCountsOnce({
    categories,
    source: {
      kind: 'raw-current-season-categorical-counts',
      counts,
    },
    leagueTarget,
    leagueEquivalentPa: strength,
  });
}

function observation(id, batterId, pitcherId, terminalCategory) {
  return Object.freeze({
    observationId: id,
    providerBatterId: batterId,
    providerPitcherId: pitcherId,
    terminalCategory,
  });
}

test('returns the league vector when both pooled effects are neutral', () => {
  const neutral = pooled({ HIT: 0, OUT: 0, WALK: 0 });
  const result = combineSinglePassCategoricalEffects({
    categories,
    leagueTarget,
    batterEstimate: neutral,
    pitcherAllowedEstimate: neutral,
    batterCoefficient: 1.5,
    pitcherAllowedCoefficient: 1.25,
  });

  approximateDistribution(result.probabilities, leagueTarget);
  assert.equal(result.poolingPassCountPerParameter, 1);
  assert.equal(result.secondShrinkageAllowed, false);
  assert.equal(
    Object.values(result.probabilities).reduce((sum, probability) => sum + probability, 0),
    1,
  );
});

test('reproduces one pooled parameter exactly when the other effect is neutral and its coefficient is one', () => {
  const neutral = pooled({ HIT: 0, OUT: 0, WALK: 0 });
  const batter = pooled({ HIT: 12, OUT: 4, WALK: 2 });
  const pitcher = pooled({ HIT: 3, OUT: 12, WALK: 3 });

  const batterOnly = combineSinglePassCategoricalEffects({
    categories,
    leagueTarget,
    batterEstimate: batter,
    pitcherAllowedEstimate: neutral,
    batterCoefficient: 1,
    pitcherAllowedCoefficient: 1,
  });
  const pitcherOnly = combineSinglePassCategoricalEffects({
    categories,
    leagueTarget,
    batterEstimate: neutral,
    pitcherAllowedEstimate: pitcher,
    batterCoefficient: 1,
    pitcherAllowedCoefficient: 1,
  });

  approximateDistribution(batterOnly.probabilities, batter.probabilities);
  approximateDistribution(pitcherOnly.probabilities, pitcher.probabilities);
});

test('coefficient zero removes that factor exactly and positive weight moves the matching category directionally', () => {
  const batterHighHit = pooled({ HIT: 15, OUT: 3, WALK: 2 });
  const batterLowHit = pooled({ HIT: 2, OUT: 16, WALK: 2 });
  const pitcher = pooled({ HIT: 4, OUT: 12, WALK: 4 });

  const removedHigh = combineSinglePassCategoricalEffects({
    categories,
    leagueTarget,
    batterEstimate: batterHighHit,
    pitcherAllowedEstimate: pitcher,
    batterCoefficient: 0,
    pitcherAllowedCoefficient: 1,
  });
  const removedLow = combineSinglePassCategoricalEffects({
    categories,
    leagueTarget,
    batterEstimate: batterLowHit,
    pitcherAllowedEstimate: pitcher,
    batterCoefficient: 0,
    pitcherAllowedCoefficient: 1,
  });
  approximateDistribution(removedHigh.probabilities, removedLow.probabilities);

  const includedHigh = combineSinglePassCategoricalEffects({
    categories,
    leagueTarget,
    batterEstimate: batterHighHit,
    pitcherAllowedEstimate: pitcher,
    batterCoefficient: 1,
    pitcherAllowedCoefficient: 1,
  });
  const includedLow = combineSinglePassCategoricalEffects({
    categories,
    leagueTarget,
    batterEstimate: batterLowHit,
    pitcherAllowedEstimate: pitcher,
    batterCoefficient: 1,
    pitcherAllowedCoefficient: 1,
  });
  assert.ok(includedHigh.probabilities.HIT > includedLow.probabilities.HIT);
});

test('rejects estimates that did not come directly from exactly one pooling pass', () => {
  const valid = pooled({ HIT: 4, OUT: 12, WALK: 4 });
  assert.throws(
    () =>
      combineSinglePassCategoricalEffects({
        categories,
        leagueTarget,
        batterEstimate: {
          ...valid,
          poolingPassCount: 2,
        },
        pitcherAllowedEstimate: valid,
        batterCoefficient: 1,
        pitcherAllowedCoefficient: 1,
      }),
    /exactly one current-season categorical pooling pass/,
  );
});

test('selects coherent batter and pitcher coefficients from one identical later-validation cohort', () => {
  const fit = [];
  const validation = [];
  let id = 0;

  for (let index = 0; index < 90; index += 1) {
    fit.push(observation(`fit-${id++}`, 1, 9, 'HIT'));
    fit.push(observation(`fit-${id++}`, 2, 9, 'OUT'));
  }
  for (let index = 0; index < 10; index += 1) {
    fit.push(observation(`fit-${id++}`, 1, 9, 'OUT'));
    fit.push(observation(`fit-${id++}`, 2, 9, 'HIT'));
  }
  fit.push(observation(`fit-${id++}`, 1, 9, 'WALK'));
  fit.push(observation(`fit-${id++}`, 2, 9, 'WALK'));

  for (let index = 0; index < 20; index += 1) {
    validation.push(observation(`validation-${id++}`, 1, 9, 'HIT'));
    validation.push(observation(`validation-${id++}`, 2, 9, 'OUT'));
  }
  validation.push(observation(`validation-${id++}`, 1, 9, 'WALK'));
  validation.push(observation(`validation-${id++}`, 2, 9, 'WALK'));

  const result = evaluateCoherentCategoricalMatchupCandidates({
    categories,
    hitCategories: ['HIT'],
    fitObservations: fit,
    validationObservations: validation,
    batterLeagueEquivalentPa: 8,
    pitcherAllowedLeagueEquivalentPa: 8,
    candidates: [
      {
        candidateId: 'league-only',
        batterCoefficient: 0,
        pitcherAllowedCoefficient: 0,
      },
      {
        candidateId: 'batter-only',
        batterCoefficient: 1,
        pitcherAllowedCoefficient: 0,
      },
      {
        candidateId: 'pitcher-only',
        batterCoefficient: 0,
        pitcherAllowedCoefficient: 1,
      },
    ],
  });

  assert.equal(result.selection.status, 'validation-candidate-selected');
  assert.equal(result.selection.selectedCandidate.candidateId, 'batter-only');
  assert.equal(result.validationObservationCount, validation.length);
  assert.equal(result.poolingPassCountPerParameter, 1);
  assert.equal(result.secondShrinkageAllowed, false);
  assert.ok(
    result.results.every(
      (candidate) =>
        candidate.validationObservationCount === validation.length &&
        candidate.validationObservationIdsSha256 ===
          result.validationObservationIdsSha256,
    ),
  );
});

function datasetIdentity(dataset) {
  return {
    activeSeason: dataset.activeSeason,
    sourcePartitionSha256: dataset.sourcePartitionSha256,
    sourceEvidenceSetSha256: dataset.sourceEvidenceSetSha256,
    periods: dataset.periods,
    untouchedTestReservation: dataset.untouchedTestReservation,
  };
}

function boundaryIdentity(boundary) {
  return {
    activeSeason: boundary.activeSeason,
    sourceDatasetSha256: boundary.sourceDatasetSha256,
    sourceDatasetFileSha256: boundary.sourceDatasetFileSha256,
    sourceFiniteEvaluationSha256: boundary.sourceFiniteEvaluationSha256,
    categories: boundary.categories,
    finiteCandidates: boundary.finiteCandidates,
    exactLeagueOnlyCandidate: boundary.exactLeagueOnlyCandidate,
    batter: boundary.batter,
    pitcherAllowed: boundary.pitcherAllowed,
    untouchedTestReservation: boundary.untouchedTestReservation,
  };
}

test('rejects any source dataset that exposes untouched-test rows', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'm8-coherent-matchup-'));
  try {
    const period = {
      startDate: '2026-03-26',
      endDate: '2026-03-26',
      rowCount: 0,
      classifiedTerminalCount: 0,
      rows: [],
    };
    const dataset = {
      datasetVersion: 2,
      purpose: 'synthetic test dataset',
      activeSeason: 2026,
      sourcePartitionSha256: 'a'.repeat(64),
      sourceEvidenceSetSha256: 'b'.repeat(64),
      periods: {
        fit: period,
        validation: {
          ...period,
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
    dataset.datasetSha256 = sha256(JSON.stringify(datasetIdentity(dataset)));
    const datasetText = `${JSON.stringify(dataset, null, 2)}\n`;
    const datasetPath = path.join(root, 'dataset.json');
    await writeFile(datasetPath, datasetText, 'utf8');

    const parameter = {
      poolingPassCount: 1,
      secondShrinkageAllowed: false,
      selection: {
        status: 'finite-pooling-candidate-selected',
        selectedCandidate: {
          candidateId: 'league-pa-8',
          leagueEquivalentPa: 8,
        },
      },
    };
    const boundary = {
      boundaryEvaluationVersion: 1,
      purpose: 'synthetic boundary',
      status: 'offline',
      activeSeason: 2026,
      sourceDatasetSha256: dataset.datasetSha256,
      sourceDatasetFileSha256: sha256(datasetText),
      sourceFiniteEvaluationSha256: 'c'.repeat(64),
      categories,
      finiteCandidates: [],
      exactLeagueOnlyCandidate: {
        candidateId: 'league-only-limit',
        kind: 'league-only-limit',
        leagueEquivalentPa: null,
      },
      batter: parameter,
      pitcherAllowed: parameter,
      untouchedTestReservation: {
        startDate: '2026-03-28',
        endDate: '2026-03-28',
        plateAppearanceCount: 1,
        rowsIncluded: false,
      },
    };
    boundary.boundaryEvaluationSha256 = sha256(
      JSON.stringify(boundaryIdentity(boundary)),
    );
    const boundaryPath = path.join(root, 'boundary.json');
    await writeFile(boundaryPath, `${JSON.stringify(boundary, null, 2)}\n`, 'utf8');

    await assert.rejects(
      evaluateM8CoherentCategoricalMatchup({
        datasetPath,
        poolingBoundaryPath: boundaryPath,
        categories,
        hitCategories: ['HIT'],
      }),
      /test rows must remain absent/,
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
