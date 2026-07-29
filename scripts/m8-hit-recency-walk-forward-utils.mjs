import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { sha256 } from './provider-probe-utils.mjs';
import {
  DEFAULT_M8_HIT_RECENCY_CANDIDATES,
  evaluateM8HitRecencyCandidates,
} from './m8-hit-recency-evaluation-utils.mjs';
import { selectRecencyCandidateFromValidation } from './m8-recency-weighting-utils.mjs';

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

function periodFromObservations(startDate, endDate, observations) {
  const hitCount = observations.reduce(
    (sum, observation) => sum + observation.hit,
    0,
  );
  return {
    startDate,
    endDate,
    sourceRowCount: observations.length,
    observationCount: observations.length,
    hitCount,
    noHitCount: observations.length - hitCount,
    contextualNonHitCount: observations.filter(
      (observation) =>
        observation.labelSource === 'verified-contextual-non-hit-result',
    ).length,
    platoonEligibleCount: observations.filter(
      (observation) => observation.platoonEligible,
    ).length,
    excludedCount: 0,
    observations,
    exclusions: [],
  };
}

function latestObservedDate(observations, fallback) {
  return observations.reduce(
    (latest, observation) =>
      observation.observedDate > latest ? observation.observedDate : latest,
    fallback,
  );
}

function assertUniqueObservationIds(fitObservations, validationObservations) {
  const seen = new Set();
  for (const observation of [...fitObservations, ...validationObservations]) {
    const observationId = assertNonEmptyString(
      observation.observationId,
      'observationId',
    );
    if (seen.has(observationId)) {
      throw new Error(`duplicate observationId across benchmark periods: ${observationId}.`);
    }
    seen.add(observationId);
  }
}

function validationDates(observations) {
  return [...new Set(observations.map((observation) => observation.observedDate))]
    .sort((left, right) => left.localeCompare(right));
}

function buildFoldBenchmark({ source, trainingObservations, validationDate, validationObservations }) {
  const trainingEndDate = latestObservedDate(
    trainingObservations,
    source.periods.fit.endDate,
  );
  if (!(trainingEndDate < validationDate)) {
    throw new Error(
      `walk-forward training end ${trainingEndDate} must precede validation date ${validationDate}.`,
    );
  }
  if (
    trainingObservations.some(
      (observation) => observation.observedDate >= validationDate,
    )
  ) {
    throw new Error(`walk-forward fold ${validationDate} contains future training rows.`);
  }
  if (
    validationObservations.some(
      (observation) => observation.observedDate !== validationDate,
    )
  ) {
    throw new Error(`walk-forward fold ${validationDate} contains another validation date.`);
  }

  const fit = periodFromObservations(
    source.periods.fit.startDate,
    trainingEndDate,
    trainingObservations,
  );
  const validation = periodFromObservations(
    validationDate,
    validationDate,
    validationObservations,
  );
  const identity = {
    activeSeason: source.activeSeason,
    sourceDatasetSha256: source.sourceDatasetSha256,
    sourceDatasetFileSha256: source.sourceDatasetFileSha256,
    sourcePartitionSha256: source.sourcePartitionSha256,
    sourceEvidenceSetSha256: source.sourceEvidenceSetSha256,
    periods: { fit, validation },
    untouchedTestReservation: source.untouchedTestReservation,
  };

  return {
    benchmarkVersion: 1,
    purpose: `M8 walk-forward fold ending before ${validationDate}`,
    ...identity,
    totals: {
      sourceRowCount: trainingObservations.length + validationObservations.length,
      observationCount: trainingObservations.length + validationObservations.length,
      hitCount: fit.hitCount + validation.hitCount,
      noHitCount: fit.noHitCount + validation.noHitCount,
      contextualNonHitCount:
        fit.contextualNonHitCount + validation.contextualNonHitCount,
      platoonEligibleCount:
        fit.platoonEligibleCount + validation.platoonEligibleCount,
      excludedCount: 0,
    },
    benchmarkSha256: sha256(JSON.stringify(identity)),
  };
}

function aggregateCandidateResults(candidates, folds) {
  return Object.freeze(
    candidates.map((candidate) => {
      let validationObservationCount = 0;
      let logLossTotal = 0;
      let brierTotal = 0;
      let hitTotal = 0;
      let predictionTotal = 0;
      let minimumPrediction = 1;
      let maximumPrediction = 0;

      for (const fold of folds) {
        const result = fold.results.find(
          (candidateResult) =>
            candidateResult.candidate.candidateId === candidate.candidateId,
        );
        if (!result) {
          throw new Error(
            `walk-forward fold ${fold.validationDate} is missing candidate ${candidate.candidateId}.`,
          );
        }
        const count = result.validationObservationCount;
        validationObservationCount += count;
        logLossTotal += result.validationLogLoss * count;
        brierTotal += result.validationBrierScore * count;
        hitTotal += result.validationHitRate * count;
        predictionTotal += result.validationMeanPrediction * count;
        minimumPrediction = Math.min(
          minimumPrediction,
          result.minimumPrediction,
        );
        maximumPrediction = Math.max(
          maximumPrediction,
          result.maximumPrediction,
        );
      }

      if (validationObservationCount === 0) {
        throw new Error(
          `walk-forward candidate ${candidate.candidateId} has no eligible observations.`,
        );
      }

      return Object.freeze({
        candidate,
        validationObservationCount,
        validationLogLoss: logLossTotal / validationObservationCount,
        validationBrierScore: brierTotal / validationObservationCount,
        validationHitRate: hitTotal / validationObservationCount,
        validationMeanPrediction: predictionTotal / validationObservationCount,
        minimumPrediction,
        maximumPrediction,
      });
    }),
  );
}

export async function evaluateM8HitRecencyWalkForward({
  benchmarkPath,
  candidates = DEFAULT_M8_HIT_RECENCY_CANDIDATES,
}) {
  const inputPath = assertNonEmptyString(benchmarkPath, 'benchmarkPath');
  const candidateList = assertArray(candidates, 'candidates');
  if (candidateList.length < 2) {
    throw new RangeError(
      'candidates must include uniform and at least one alternative.',
    );
  }

  const sourceText = await readFile(inputPath, 'utf8');
  const source = assertPlainObject(
    parseJson(sourceText, 'M8 Hit benchmark'),
    'M8 Hit benchmark',
  );
  await evaluateM8HitRecencyCandidates({
    benchmarkPath: inputPath,
    candidates: candidateList,
  });

  const periods = assertPlainObject(source.periods, 'periods');
  const fit = assertPlainObject(periods.fit, 'periods.fit');
  const validation = assertPlainObject(periods.validation, 'periods.validation');
  const fitObservations = assertArray(
    fit.observations,
    'periods.fit.observations',
  );
  const validationObservations = assertArray(
    validation.observations,
    'periods.validation.observations',
  );
  assertUniqueObservationIds(fitObservations, validationObservations);

  const dates = validationDates(validationObservations);
  if (dates.length < 2) {
    throw new Error('walk-forward evaluation requires at least two validation dates.');
  }

  const temporaryRoot = await mkdtemp(
    path.join(os.tmpdir(), 'm8-hit-recency-walk-forward-'),
  );
  const folds = [];
  const trainingObservations = [...fitObservations];

  try {
    for (const [index, validationDate] of dates.entries()) {
      const foldValidation = validationObservations.filter(
        (observation) => observation.observedDate === validationDate,
      );
      const foldBenchmark = buildFoldBenchmark({
        source,
        trainingObservations: [...trainingObservations],
        validationDate,
        validationObservations: foldValidation,
      });
      const foldPath = path.join(
        temporaryRoot,
        `fold-${String(index + 1).padStart(2, '0')}-${validationDate}.json`,
      );
      await writeFile(
        foldPath,
        `${JSON.stringify(foldBenchmark, null, 2)}\n`,
        'utf8',
      );
      const evaluation = await evaluateM8HitRecencyCandidates({
        benchmarkPath: foldPath,
        candidates: candidateList,
      });
      folds.push(
        Object.freeze({
          foldNumber: index + 1,
          validationDate,
          trainingStartDate: foldBenchmark.periods.fit.startDate,
          trainingEndDate: foldBenchmark.periods.fit.endDate,
          trainingObservationCount: trainingObservations.length,
          validationObservationCount: foldValidation.length,
          eligibleObservationCount:
            evaluation.cohort.eligibleObservationCount,
          coverageRate: evaluation.cohort.coverageRate,
          exclusionsByReason: evaluation.cohort.exclusionsByReason,
          eligibleObservationIdsSha256:
            evaluation.cohort.eligibleObservationIdsSha256,
          results: evaluation.results,
        }),
      );
      trainingObservations.push(...foldValidation);
    }
  } finally {
    await rm(temporaryRoot, { recursive: true, force: true });
  }

  const aggregateResults = aggregateCandidateResults(candidateList, folds);
  const expectedObservationCount = aggregateResults[0].validationObservationCount;
  if (
    aggregateResults.some(
      (result) =>
        result.validationObservationCount !== expectedObservationCount,
    )
  ) {
    throw new Error(
      'walk-forward candidates did not use an identical aggregate cohort.',
    );
  }
  const selection = selectRecencyCandidateFromValidation(aggregateResults);
  const walkForwardIdentity = {
    activeSeason: source.activeSeason,
    sourceBenchmarkSha256: source.benchmarkSha256,
    sourceBenchmarkFileSha256: sha256(sourceText),
    candidates: candidateList,
    folds: Object.freeze(folds),
    aggregateResults,
    selection,
    untouchedTestReservation: source.untouchedTestReservation,
  };

  return Object.freeze({
    walkForwardVersion: 1,
    purpose:
      'Test benchmark-only current-season Hit/No-Hit recency candidates through expanding daily validation folds without pooling, clipping, or untouched-test access.',
    candidateGridStatus: 'benchmark-hypotheses-not-production-coefficients',
    ...walkForwardIdentity,
    walkForwardSha256: sha256(JSON.stringify(walkForwardIdentity)),
  });
}
