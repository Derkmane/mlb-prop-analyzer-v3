import assert from 'node:assert/strict';
import test from 'node:test';

import {
  poissonBinomialDistribution,
  preserveValidatedArtifactText,
  selectCompleteBatterGameCohort,
  summarizeConditionalHitCountOverdispersion,
} from '../scripts/m8-resolved-categorical-hit-overdispersion-utils.mjs';

test('validates artifact text without trimming raw bytes', () => {
  const text = '{"artifact":true}\n';

  assert.equal(
    preserveValidatedArtifactText(
      text,
      'artifactText',
    ),
    text,
  );

  assert.throws(
    () =>
      preserveValidatedArtifactText(
        '  \n\t  ',
        'artifactText',
      ),
    /non-empty string/,
  );
});

test('poisson-binomial matches two-trial exact distribution', () => {
  const pmf = poissonBinomialDistribution([0.2, 0.3]);
  assert.ok(Math.abs(pmf[0] - 0.56) < 1e-12);
  assert.ok(Math.abs(pmf[1] - 0.38) < 1e-12);
  assert.ok(Math.abs(pmf[2] - 0.06) < 1e-12);
  assert.ok(Math.abs(pmf.reduce((sum, value) => sum + value, 0) - 1) < 1e-12);
});

test('reports overdispersion when mean is right but outcomes cluster', () => {
  const games = Array.from({ length: 100 }, (_, index) => ({
    gameKey: `g-${index}`,
    probabilities: [0.25, 0.25, 0.25, 0.25],
    observedHitCount: index < 50 ? 0 : 2,
  }));
  const result = summarizeConditionalHitCountOverdispersion({
    games,
    lines: [0.5, 1.5, 2.5, 3.5],
  });
  assert.ok(Math.abs(result.observedHitsPerGame - 1) < 1e-12);
  assert.ok(Math.abs(result.expectedHitsPerGame - 1) < 1e-12);
  assert.ok(result.varianceRatioObservedToExpected > 1);
  assert.ok(result.pearsonDispersion > 1);
  assert.ok(result.secondFactorialMomentGapObservedMinusExpected > 0);
});

test('preserves Higher and Lower half-line symmetry', () => {
  const result = summarizeConditionalHitCountOverdispersion({
    games: [
      { gameKey: 'a', probabilities: [0.2, 0.3, 0.4], observedHitCount: 0 },
      { gameKey: 'b', probabilities: [0.6, 0.4, 0.2], observedHitCount: 2 },
    ],
    lines: [0.5, 1.5, 2.5],
  });
  for (const report of Object.values(result.lineReports)) {
    assert.equal(
      report.higher.observedWinCount + report.lower.observedWinCount,
      2,
    );
    assert.ok(
      Math.abs(
        report.higher.meanPredictedWinProbability +
          report.lower.meanPredictedWinProbability -
          1,
      ) < 1e-12,
    );
  }
});

test('excludes entire batter-game when overall PA coverage is incomplete', () => {
  const result = selectCompleteBatterGameCohort({
    validationOverall: [
      {
        observationId: '1',
        observedDate: '2026-06-22',
        providerGameId: 1,
        providerBatterId: 10,
      },
      {
        observationId: '2',
        observedDate: '2026-06-22',
        providerGameId: 1,
        providerBatterId: 10,
      },
      {
        observationId: '3',
        observedDate: '2026-06-22',
        providerGameId: 2,
        providerBatterId: 20,
      },
    ],
    predictions: [
      {
        observationId: '1',
        observedDate: '2026-06-22',
        providerGameId: 1,
        providerBatterId: 10,
        providerPaNumber: 1,
        hitProbability: 0.2,
        hit: 0,
      },
      {
        observationId: '3',
        observedDate: '2026-06-22',
        providerGameId: 2,
        providerBatterId: 20,
        providerPaNumber: 1,
        hitProbability: 0.3,
        hit: 1,
      },
    ],
  });
  assert.equal(result.completeGameCount, 1);
  assert.equal(result.excludedGameCount, 1);
  assert.equal(result.excludedOverallPaCount, 2);
  assert.equal(result.excludedPredictedPaCount, 1);
});

test('is deterministic for identical games in different input order', () => {
  const games = Array.from({ length: 20 }, (_, index) => ({
    gameKey: `g-${String(index).padStart(2, '0')}`,
    probabilities: [0.1 + (index % 5) * 0.05, 0.2, 0.3],
    observedHitCount: index % 3,
  }));
  const first = summarizeConditionalHitCountOverdispersion({
    games,
    lines: [0.5, 1.5, 2.5],
  });
  const second = summarizeConditionalHitCountOverdispersion({
    games: [...games].reverse(),
    lines: [0.5, 1.5, 2.5],
  });
  assert.deepEqual(first, second);
});

test('rejects invalid probabilities, duplicate game keys, and impossible hit counts', () => {
  assert.throws(
    () => poissonBinomialDistribution([0]),
    /strictly between/,
  );
  assert.throws(
    () =>
      summarizeConditionalHitCountOverdispersion({
        games: [
          { gameKey: 'a', probabilities: [0.2], observedHitCount: 0 },
          { gameKey: 'a', probabilities: [0.3], observedHitCount: 0 },
        ],
      }),
    /duplicate batter-game/,
  );
  assert.throws(
    () =>
      summarizeConditionalHitCountOverdispersion({
        games: [{ gameKey: 'a', probabilities: [0.2], observedHitCount: 2 }],
      }),
    /exceeds PA count/,
  );
});

test('conserves probability mass for a large heterogeneous cohort', () => {
  let state = 1;
  const games = Array.from({ length: 3_000 }, (_, index) => {
    const probabilities = Array.from({ length: 1 + (index % 6) }, () => {
      state = (1_664_525 * state + 1_013_904_223) >>> 0;
      return 0.01 + 0.98 * (state / 4_294_967_296);
    });
    return {
      gameKey: `g-${index}`,
      probabilities,
      observedHitCount: index % (probabilities.length + 1),
    };
  });
  const result = summarizeConditionalHitCountOverdispersion({
    games,
    lines: [0.5, 1.5, 2.5, 3.5],
  });
  const expectedTotal = result.countHistogram.reduce(
    (sum, row) => sum + row.expectedGameCount,
    0,
  );
  assert.ok(Math.abs(expectedTotal - 3_000) <= 3e-9);
  assert.equal(
    result.countHistogram.reduce(
      (sum, row) => sum + row.observedGameCount,
      0,
    ),
    3_000,
  );
});
