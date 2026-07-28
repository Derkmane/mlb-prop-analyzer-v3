import { readFile } from 'node:fs/promises';

import { sha256 } from './provider-probe-utils.mjs';
import {
  assertCurrentSeasonDate,
  calculateRecencyWeight,
  selectRecencyCandidateFromValidation,
  validateChronologicalWindows,
} from './m8-recency-weighting-utils.mjs';

const SHA256_PATTERN = /^[a-f0-9]{64}$/;
const INCLUDED_PERIODS = Object.freeze(['fit', 'validation']);

export const DEFAULT_M8_HIT_RECENCY_CANDIDATES = Object.freeze([
  Object.freeze({ candidateId: 'uniform', kind: 'uniform' }),
  Object.freeze({
    candidateId: 'half-life-7',
    kind: 'exponential-half-life',
    halfLifeDays: 7,
  }),
  Object.freeze({
    candidateId: 'half-life-14',
    kind: 'exponential-half-life',
    halfLifeDays: 14,
  }),
  Object.freeze({
    candidateId: 'half-life-21',
    kind: 'exponential-half-life',
    halfLifeDays: 21,
  }),
  Object.freeze({
    candidateId: 'half-life-30',
    kind: 'exponential-half-life',
    halfLifeDays: 30,
  }),
  Object.freeze({
    candidateId: 'half-life-45',
    kind: 'exponential-half-life',
    halfLifeDays: 45,
  }),
  Object.freeze({
    candidateId: 'half-life-60',
    kind: 'exponential-half-life',
    halfLifeDays: 60,
  }),
  Object.freeze({
    candidateId: 'half-life-90',
    kind: 'exponential-half-life',
    halfLifeDays: 90,
  }),
]);

function assertPlainObject(value, label) {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new TypeError(`${label} must be an object.`);
  }
  return value;
}

function assertArray(value, label) {
  if (!Array.isArray(value)) {
    throw new TypeError(`${label} must be an array.`);
  }
  return value;
}

function assertNonEmptyString(value, label) {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new TypeError(`${label} must be a non-empty string.`);
  }
  return value.trim();
}

function assertInteger(value, label) {
  if (!Number.isSafeInteger(value)) {
    throw new TypeError(`${label} must be an integer.`);
  }
  return value;
}

function assertNonNegativeInteger(value, label) {
  const integer = assertInteger(value, label);
  if (integer < 0) {
    throw new RangeError(`${label} must be non-negative.`);
  }
  return integer;
}

function assertSha256(value, label) {
  if (typeof value !== 'string' || !SHA256_PATTERN.test(value)) {
    throw new TypeError(`${label} must be a lowercase SHA-256 digest.`);
  }
  return value;
}

function parseJson(text, label) {
  try {
    return JSON.parse(text);
  } catch {
    throw new Error(`${label} is not valid JSON.`);
  }
}

function benchmarkIdentity(benchmark) {
  return {
    activeSeason: benchmark.activeSeason,
    sourceDatasetSha256: benchmark.sourceDatasetSha256,
    sourceDatasetFileSha256: benchmark.sourceDatasetFileSha256,
    sourcePartitionSha256: benchmark.sourcePartitionSha256,
    sourceEvidenceSetSha256: benchmark.sourceEvidenceSetSha256,
    periods: benchmark.periods,
    untouchedTestReservation: benchmark.untouchedTestReservation,
  };
}

function validateObservation(rawObservation, label, activeSeason) {
  const observation = assertPlainObject(rawObservation, label);
  const hit = assertInteger(observation.hit, `${label}.hit`);
  if (hit !== 0 && hit !== 1) {
    throw new RangeError(`${label}.hit must equal 0 or 1.`);
  }
  const observedDate = assertNonEmptyString(
    observation.observedDate,
    `${label}.observedDate`,
  );
  assertCurrentSeasonDate(observedDate, activeSeason, `${label}.observedDate`);

  return Object.freeze({
    observationId: assertNonEmptyString(
      observation.observationId,
      `${label}.observationId`,
    ),
    observedDate,
    providerBatterId: assertInteger(
      observation.providerBatterId,
      `${label}.providerBatterId`,
    ),
    providerPitcherId: assertInteger(
      observation.providerPitcherId,
      `${label}.providerPitcherId`,
    ),
    hit,
  });
}

function validatePeriod(rawPeriod, periodId, activeSeason) {
  const period = assertPlainObject(rawPeriod, `periods.${periodId}`);
  const rows = assertArray(
    period.observations,
    `periods.${periodId}.observations`,
  );
  const expectedCount = assertNonNegativeInteger(
    period.observationCount,
    `periods.${periodId}.observationCount`,
  );
  if (rows.length !== expectedCount) {
    throw new Error(`${periodId} observationCount does not match its observations.`);
  }

  const seen = new Set();
  const observations = rows.map((row, index) => {
    const observation = validateObservation(
      row,
      `periods.${periodId}.observations[${index}]`,
      activeSeason,
    );
    if (seen.has(observation.observationId)) {
      throw new Error(
        `${periodId} contains duplicate observationId: ${observation.observationId}.`,
      );
    }
    seen.add(observation.observationId);
    return observation;
  });

  return Object.freeze({
    startDate: assertNonEmptyString(
      period.startDate,
      `periods.${periodId}.startDate`,
    ),
    endDate: assertNonEmptyString(
      period.endDate,
      `periods.${periodId}.endDate`,
    ),
    observations: Object.freeze(observations),
  });
}

function validateBenchmark(rawBenchmark, benchmarkText) {
  const benchmark = assertPlainObject(rawBenchmark, 'M8 Hit benchmark');
  if (benchmark.benchmarkVersion !== 1) {
    throw new RangeError('benchmarkVersion must equal 1.');
  }
  const activeSeason = assertInteger(benchmark.activeSeason, 'activeSeason');
  assertSha256(benchmark.sourceDatasetSha256, 'sourceDatasetSha256');
  assertSha256(benchmark.sourceDatasetFileSha256, 'sourceDatasetFileSha256');
  assertSha256(benchmark.sourcePartitionSha256, 'sourcePartitionSha256');
  assertSha256(benchmark.sourceEvidenceSetSha256, 'sourceEvidenceSetSha256');
  const internalSha = assertSha256(benchmark.benchmarkSha256, 'benchmarkSha256');
  if (internalSha !== sha256(JSON.stringify(benchmarkIdentity(benchmark)))) {
    throw new Error('benchmark internal SHA-256 does not match its identity.');
  }

  const periods = assertPlainObject(benchmark.periods, 'periods');
  const fit = validatePeriod(periods.fit, 'fit', activeSeason);
  const validation = validatePeriod(periods.validation, 'validation', activeSeason);
  const untouchedTest = assertPlainObject(
    benchmark.untouchedTestReservation,
    'untouchedTestReservation',
  );
  if (untouchedTest.rowsIncluded !== false || Object.hasOwn(untouchedTest, 'rows')) {
    throw new Error('untouched test rows must remain absent from recency evaluation.');
  }
  const testCount = assertNonNegativeInteger(
    untouchedTest.plateAppearanceCount,
    'untouchedTestReservation.plateAppearanceCount',
  );

  validateChronologicalWindows({
    activeSeason,
    fitStartDate: fit.startDate,
    fitEndDate: fit.endDate,
    validationStartDate: validation.startDate,
    validationEndDate: validation.endDate,
    testStartDate: assertNonEmptyString(
      untouchedTest.startDate,
      'untouchedTestReservation.startDate',
    ),
    testEndDate: assertNonEmptyString(
      untouchedTest.endDate,
      'untouchedTestReservation.endDate',
    ),
  });

  return Object.freeze({
    activeSeason,
    benchmarkSha256: internalSha,
    benchmarkFileSha256: sha256(benchmarkText),
    sourceDatasetSha256: benchmark.sourceDatasetSha256,
    fit,
    validation,
    untouchedTest: Object.freeze({
      startDate: untouchedTest.startDate,
      endDate: untouchedTest.endDate,
      plateAppearanceCount: testCount,
      rowsIncluded: false,
    }),
  });
}

function classCountsBy(observations, key) {
  const counts = new Map();
  for (const observation of observations) {
    const id = observation[key];
    const current = counts.get(id) ?? { total: 0, hits: 0 };
    current.total += 1;
    current.hits += observation.hit;
    counts.set(id, current);
  }
  return counts;
}

function historyState(counts, id) {
  const value = counts.get(id);
  if (!value) return 'unseen';
  if (value.hits === 0 || value.hits === value.total) return 'single-class';
  return 'usable';
}

function exclusionReason(batterState, pitcherState) {
  if (batterState === 'unseen' && pitcherState === 'unseen') {
    return 'unseen-batter-and-pitcher';
  }
  if (batterState === 'unseen') return 'unseen-batter';
  if (pitcherState === 'unseen') return 'unseen-pitcher';
  if (batterState === 'single-class' && pitcherState === 'single-class') {
    return 'batter-and-pitcher-single-class-history';
  }
  if (batterState === 'single-class') return 'batter-single-class-history';
  if (pitcherState === 'single-class') return 'pitcher-single-class-history';
  return null;
}

function buildValidationCohort(fitObservations, validationObservations) {
  const batterCounts = classCountsBy(fitObservations, 'providerBatterId');
  const pitcherCounts = classCountsBy(fitObservations, 'providerPitcherId');
  const eligible = [];
  const exclusions = new Map();

  for (const observation of validationObservations) {
    const reason = exclusionReason(
      historyState(batterCounts, observation.providerBatterId),
      historyState(pitcherCounts, observation.providerPitcherId),
    );
    if (reason === null) {
      eligible.push(observation);
    } else {
      exclusions.set(reason, (exclusions.get(reason) ?? 0) + 1);
    }
  }
  if (eligible.length === 0) {
    throw new Error('no validation observations have usable batter and pitcher histories.');
  }

  return Object.freeze({
    eligible: Object.freeze(eligible),
    summary: Object.freeze({
      validationObservationCount: validationObservations.length,
      eligibleObservationCount: eligible.length,
      coverageRate: eligible.length / validationObservations.length,
      eligibleObservationIdsSha256: sha256(
        JSON.stringify(eligible.map((observation) => observation.observationId)),
      ),
      exclusionsByReason: Object.freeze(
        Object.fromEntries([...exclusions.entries()].sort(([a], [b]) => a.localeCompare(b))),
      ),
    }),
  });
}

function weightedCountsBy(observations, key, weights) {
  const counts = new Map();
  for (let index = 0; index < observations.length; index += 1) {
    const observation = observations[index];
    const weight = weights[index];
    const id = observation[key];
    const current = counts.get(id) ?? { total: 0, hits: 0 };
    current.total += weight;
    current.hits += weight * observation.hit;
    counts.set(id, current);
  }
  return counts;
}

function interiorRate(counts, id, label) {
  const value = counts.get(id);
  if (!value || !(value.total > 0)) {
    throw new Error(`${label} has no weighted fit history.`);
  }
  const rate = value.hits / value.total;
  if (!(rate > 0 && rate < 1)) {
    throw new Error(`${label} weighted rate is degenerate; no clipping or smoothing is allowed.`);
  }
  return rate;
}

function binaryLog5(batterRate, pitcherRate, leagueRate) {
  for (const [label, rate] of [
    ['batterRate', batterRate],
    ['pitcherRate', pitcherRate],
    ['leagueRate', leagueRate],
  ]) {
    if (!(rate > 0 && rate < 1)) {
      throw new RangeError(`${label} must be strictly between 0 and 1.`);
    }
  }
  const hitTerm = (batterRate * pitcherRate) / leagueRate;
  const noHitTerm =
    ((1 - batterRate) * (1 - pitcherRate)) / (1 - leagueRate);
  const probability = hitTerm / (hitTerm + noHitTerm);
  if (!(probability > 0 && probability < 1)) {
    throw new Error('binary log5 produced a degenerate probability.');
  }
  return probability;
}

function evaluateCandidate({ benchmark, candidate, eligibleValidation }) {
  const weights = benchmark.fit.observations.map((observation) =>
    calculateRecencyWeight({
      observedDate: observation.observedDate,
      asOfDate: benchmark.fit.endDate,
      activeSeason: benchmark.activeSeason,
      candidate,
    }),
  );
  const totalWeight = weights.reduce((sum, weight) => sum + weight, 0);
  const hitWeight = benchmark.fit.observations.reduce(
    (sum, observation, index) => sum + observation.hit * weights[index],
    0,
  );
  const leagueRate = hitWeight / totalWeight;
  if (!(leagueRate > 0 && leagueRate < 1)) {
    throw new Error('weighted league rate is degenerate.');
  }

  const batterCounts = weightedCountsBy(
    benchmark.fit.observations,
    'providerBatterId',
    weights,
  );
  const pitcherCounts = weightedCountsBy(
    benchmark.fit.observations,
    'providerPitcherId',
    weights,
  );

  let logLossSum = 0;
  let brierSum = 0;
  let predictionSum = 0;
  let minimumProbability = 1;
  let maximumProbability = 0;

  for (const observation of eligibleValidation) {
    const batterRate = interiorRate(
      batterCounts,
      observation.providerBatterId,
      `batter ${observation.providerBatterId}`,
    );
    const pitcherRate = interiorRate(
      pitcherCounts,
      observation.providerPitcherId,
      `pitcher ${observation.providerPitcherId}`,
    );
    const probability = binaryLog5(batterRate, pitcherRate, leagueRate);
    const loss = observation.hit === 1 ? -Math.log(probability) : -Math.log(1 - probability);
    logLossSum += loss;
    brierSum += (probability - observation.hit) ** 2;
    predictionSum += probability;
    minimumProbability = Math.min(minimumProbability, probability);
    maximumProbability = Math.max(maximumProbability, probability);
  }

  const count = eligibleValidation.length;
  return Object.freeze({
    candidate,
    validationObservationCount: count,
    validationLogLoss: logLossSum / count,
    validationBrierScore: brierSum / count,
    validationHitRate:
      eligibleValidation.reduce((sum, observation) => sum + observation.hit, 0) /
      count,
    validationMeanPrediction: predictionSum / count,
    minimumPrediction: minimumProbability,
    maximumPrediction: maximumProbability,
    weightedLeagueHitRate: leagueRate,
    effectiveFitObservationWeight: totalWeight,
  });
}

export async function evaluateM8HitRecencyCandidates({
  benchmarkPath,
  candidates = DEFAULT_M8_HIT_RECENCY_CANDIDATES,
}) {
  const inputPath = assertNonEmptyString(benchmarkPath, 'benchmarkPath');
  const candidateList = assertArray(candidates, 'candidates');
  if (candidateList.length < 2) {
    throw new RangeError('candidates must include uniform and at least one alternative.');
  }

  const benchmarkText = await readFile(inputPath, 'utf8');
  const benchmark = validateBenchmark(
    parseJson(benchmarkText, 'M8 Hit benchmark'),
    benchmarkText,
  );
  const cohort = buildValidationCohort(
    benchmark.fit.observations,
    benchmark.validation.observations,
  );
  const results = Object.freeze(
    candidateList.map((candidate) =>
      evaluateCandidate({
        benchmark,
        candidate,
        eligibleValidation: cohort.eligible,
      }),
    ),
  );
  const expectedCount = cohort.summary.eligibleObservationCount;
  if (
    results.some(
      (result) => result.validationObservationCount !== expectedCount,
    )
  ) {
    throw new Error('recency candidates did not use an identical validation cohort.');
  }

  const selection = selectRecencyCandidateFromValidation(results);
  const evaluationIdentity = {
    activeSeason: benchmark.activeSeason,
    sourceBenchmarkSha256: benchmark.benchmarkSha256,
    sourceBenchmarkFileSha256: benchmark.benchmarkFileSha256,
    cohort: cohort.summary,
    candidates: candidateList,
    results,
    selection,
    untouchedTestReservation: benchmark.untouchedTest,
  };

  return Object.freeze({
    evaluationVersion: 1,
    purpose:
      'Select a benchmark-only current-season Hit/No-Hit recency candidate using fixed fit-period binary log5 rates and later validation log loss, without pooling, clipping, or untouched-test access.',
    candidateGridStatus: 'benchmark-hypotheses-not-production-coefficients',
    ...evaluationIdentity,
    evaluationSha256: sha256(JSON.stringify(evaluationIdentity)),
  });
}
