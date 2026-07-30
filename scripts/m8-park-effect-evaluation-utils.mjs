import {
  buildM8TerminalPaOutcomeArtifact,
  verifyM8TerminalPaOutcomeArtifact,
} from './m8-terminal-pa-outcome-artifact-utils.mjs';
import { verifyM8ParkVenueLineage } from './m8-park-venue-lineage-utils.mjs';
import { sha256 } from './provider-probe-utils.mjs';

const PERIODS = Object.freeze(['fit', 'validation']);
const VALID_HANDS = new Set(['L', 'R']);
const TOLERANCE = 1e-12;
const SHA256_PATTERN = /^[a-f0-9]{64}$/;

export const DEFAULT_M8_PARK_CANDIDATES = Object.freeze([
  ...[4, 16, 64, 256, 1024, 4096].map((parkEquivalentPa) =>
    Object.freeze({
      candidateId: `venue-hand-pa-${parkEquivalentPa}`,
      parkEquivalentPa,
      exactNeutral: false,
    }),
  ),
  Object.freeze({
    candidateId: 'no-park-infinite-pooling',
    parkEquivalentPa: null,
    exactNeutral: true,
  }),
]);

function object(value, label) {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new TypeError(`${label} must be an object.`);
  }
  return value;
}

function array(value, label) {
  if (!Array.isArray(value)) throw new TypeError(`${label} must be an array.`);
  return value;
}

function string(value, label) {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new TypeError(`${label} must be a non-empty string.`);
  }
  return value.trim();
}

function integer(value, label) {
  if (!Number.isSafeInteger(value)) throw new TypeError(`${label} must be an integer.`);
  return value;
}

function positiveInteger(value, label) {
  const result = integer(value, label);
  if (result <= 0) throw new RangeError(`${label} must be positive.`);
  return result;
}

function nonNegativeInteger(value, label) {
  const result = integer(value, label);
  if (result < 0) throw new RangeError(`${label} must be non-negative.`);
  return result;
}

function positiveFinite(value, label) {
  if (!Number.isFinite(value) || value <= 0) {
    throw new RangeError(`${label} must be positive and finite.`);
  }
  return value;
}

function sha(value, label) {
  if (typeof value !== 'string' || !SHA256_PATTERN.test(value)) {
    throw new TypeError(`${label} must be a lowercase SHA-256 digest.`);
  }
  return value;
}

function untouched(value, label) {
  const reservation = object(value, label);
  if (reservation.rowsIncluded !== false || Object.hasOwn(reservation, 'rows')) {
    throw new Error(`${label} must keep untouched-test rows excluded.`);
  }
  return Object.freeze({ ...reservation, rowsIncluded: false });
}

function datasetIdentity(dataset) {
  return {
    activeSeason: dataset.activeSeason,
    sourceDatasetSha256: dataset.sourceDatasetSha256,
    sourceDatasetFileSha256: dataset.sourceDatasetFileSha256,
    sourceResolutionSha256: dataset.sourceResolutionSha256,
    sourceResolutionFileSha256: dataset.sourceResolutionFileSha256,
    sourcePartitionSha256: dataset.sourcePartitionSha256,
    sourceEvidenceSetSha256: dataset.sourceEvidenceSetSha256,
    periods: dataset.periods,
    untouchedTestReservation: dataset.untouchedTestReservation,
  };
}

function platoonEvaluationIdentity(value) {
  return {
    activeSeason: value.activeSeason,
    sourceDatasetSha256: value.sourceDatasetSha256,
    sourceDatasetFileSha256: value.sourceDatasetFileSha256,
    sourceFixedEvaluationSha256: value.sourceFixedEvaluationSha256,
    sourceFixedEvaluationFileSha256: value.sourceFixedEvaluationFileSha256,
    sourceWalkForwardSha256: value.sourceWalkForwardSha256,
    sourceWalkForwardFileSha256: value.sourceWalkForwardFileSha256,
    canonicalCategories: value.canonicalCategories,
    modeledCategories: value.modeledCategories,
    structuralZeroCategories: value.structuralZeroCategories,
    hitCategories: value.hitCategories,
    baseParameters: value.baseParameters,
    platoonModel: value.platoonModel,
    cohorts: value.cohorts,
    candidates: value.candidates,
    results: value.results,
    baseline: value.baseline,
    selection: value.selection,
    improvementVersusNoPlatoon: value.improvementVersusNoPlatoon,
    selectedBoundaryFlags: value.selectedBoundaryFlags,
    untouchedTestReservation: value.untouchedTestReservation,
  };
}

function evaluationIdentity(value) {
  return {
    evaluationVersion: value.evaluationVersion,
    activeSeason: value.activeSeason,
    sourceDatasetSha256: value.sourceDatasetSha256,
    sourceDatasetFileSha256: value.sourceDatasetFileSha256,
    sourceVenueLineageSha256: value.sourceVenueLineageSha256,
    sourceVenueLineageFileSha256: value.sourceVenueLineageFileSha256,
    sourcePlatoonEvaluationSha256: value.sourcePlatoonEvaluationSha256,
    sourcePlatoonEvaluationFileSha256: value.sourcePlatoonEvaluationFileSha256,
    modeledCategories: value.modeledCategories,
    hitCategories: value.hitCategories,
    candidateSetVersion: value.candidateSetVersion,
    candidates: value.candidates,
    model: value.model,
    cohorts: value.cohorts,
    fixedValidation: value.fixedValidation,
    walkForward: value.walkForward,
    selection: value.selection,
    untouchedTestReservation: value.untouchedTestReservation,
  };
}

function validateDataset(rawDataset) {
  const dataset = object(rawDataset, 'resolved categorical dataset');
  if (dataset.datasetVersion !== 3) {
    throw new Error('resolved categorical datasetVersion must equal 3.');
  }
  sha(dataset.datasetSha256, 'resolved categorical dataset SHA-256');
  if (dataset.datasetSha256 !== sha256(JSON.stringify(datasetIdentity(dataset)))) {
    throw new Error('resolved categorical dataset internal SHA-256 is invalid.');
  }
  untouched(dataset.untouchedTestReservation, 'resolved categorical dataset untouchedTestReservation');
  return dataset;
}

function validatePlatoonEvaluation(rawEvaluation, dataset) {
  const evaluation = object(rawEvaluation, 'platoon evaluation');
  if (evaluation.platoonEvaluationVersion !== 1) {
    throw new Error('platoon evaluation version must equal 1.');
  }
  if (
    evaluation.platoonEvaluationSha256 !==
    sha256(JSON.stringify(platoonEvaluationIdentity(evaluation)))
  ) {
    throw new Error('platoon evaluation internal SHA-256 is invalid.');
  }
  if (evaluation.sourceDatasetSha256 !== dataset.datasetSha256) {
    throw new Error('platoon evaluation does not reference the supplied dataset.');
  }
  untouched(evaluation.untouchedTestReservation, 'platoon evaluation untouchedTestReservation');
  object(evaluation.selection?.selectedCandidate, 'platoon evaluation selectedCandidate');
  return evaluation;
}

function validateStringList(rawValues, label, minimum = 1) {
  const values = array(rawValues, label).map((value, index) => string(value, `${label}[${index}]`));
  if (values.length < minimum || new Set(values).size !== values.length) {
    throw new Error(`${label} must contain at least ${minimum} unique values.`);
  }
  return Object.freeze(values);
}

function validateCandidate(raw, label) {
  const candidate = object(raw, label);
  const candidateId = string(candidate.candidateId, `${label}.candidateId`);
  const exactNeutral = candidate.exactNeutral === true;
  return Object.freeze({
    candidateId,
    parkEquivalentPa: exactNeutral
      ? null
      : positiveFinite(candidate.parkEquivalentPa, `${candidateId}.parkEquivalentPa`),
    exactNeutral,
  });
}

function validateCandidates(rawCandidates) {
  const candidates = array(rawCandidates, 'park candidates').map((raw, index) =>
    validateCandidate(raw, `park candidates[${index}]`),
  );
  if (candidates.length < 2) throw new Error('park evaluation requires at least two candidates.');
  if (new Set(candidates.map((candidate) => candidate.candidateId)).size !== candidates.length) {
    throw new Error('park candidateId values must be unique.');
  }
  if (candidates.filter((candidate) => candidate.exactNeutral).length !== 1) {
    throw new Error('park candidates must contain exactly one exact-neutral candidate.');
  }
  const finite = candidates.filter((candidate) => !candidate.exactNeutral);
  for (let index = 1; index < finite.length; index += 1) {
    if (finite[index - 1].parkEquivalentPa >= finite[index].parkEquivalentPa) {
      throw new Error('finite park candidates must be ordered by increasing pooling strength.');
    }
  }
  if (!candidates.at(-1)?.exactNeutral) {
    throw new Error('the exact-neutral park candidate must be last in canonical order.');
  }
  return Object.freeze(candidates);
}

function lineageByGame(rawLineage) {
  const lineage = verifyM8ParkVenueLineage(rawLineage);
  const result = new Map();
  for (const periodId of PERIODS) {
    for (const row of array(lineage.periods?.[periodId]?.rows, `lineage periods.${periodId}.rows`)) {
      const gameId = positiveInteger(row.providerGameId, `${periodId} lineage providerGameId`);
      if (result.has(gameId)) throw new Error(`duplicate venue lineage game ${gameId}.`);
      result.set(
        gameId,
        Object.freeze({
          periodId,
          observedDate: string(row.observedDate, `lineage game ${gameId} observedDate`),
          venue: string(row.venue, `lineage game ${gameId} venue`),
        }),
      );
    }
  }
  return Object.freeze({ lineage, byGameId: result });
}

function sourceObservation({ rawRow, periodId, index, categories, venueByGameId }) {
  const label = `periods.${periodId}.rows[${index}]`;
  const row = object(rawRow, label);
  if (row.mappingStatus !== 'classified-terminal') return null;
  if (row.includedInOverallOutcomeModel !== true) {
    throw new Error(`${label} classified row must be overall-model eligible.`);
  }
  const observationId = string(row.rowId, `${label}.rowId`);
  const terminalCategory = string(row.terminalCategory, `${observationId}.terminalCategory`);
  if (!categories.includes(terminalCategory)) {
    throw new Error(`${observationId} contains unsupported terminal category ${terminalCategory}.`);
  }
  const providerGameId = positiveInteger(row.providerGameId, `${observationId}.providerGameId`);
  const lineage = venueByGameId.get(providerGameId);
  if (lineage === undefined) throw new Error(`missing venue lineage for game ${providerGameId}.`);
  const observedDate = string(row.observedDate, `${observationId}.observedDate`);
  if (lineage.periodId !== periodId || lineage.observedDate !== observedDate) {
    throw new Error(`venue lineage chronology mismatch for game ${providerGameId}.`);
  }
  const batterHand = string(row.normalizedBatterSide, `${observationId}.normalizedBatterSide`);
  if (!VALID_HANDS.has(batterHand)) {
    throw new Error(`${observationId} lacks supported L/R batter handedness.`);
  }
  const pitcherHand = string(row.normalizedPitcherHand, `${observationId}.normalizedPitcherHand`);
  if (!VALID_HANDS.has(pitcherHand)) {
    throw new Error(`${observationId} lacks supported L/R pitcher handedness.`);
  }
  return Object.freeze({
    observationId,
    observedDate,
    periodId,
    providerGameId,
    providerBatterId: positiveInteger(row.providerBatterId, `${observationId}.providerBatterId`),
    providerPitcherId: positiveInteger(row.providerPitcherId, `${observationId}.providerPitcherId`),
    terminalCategory,
    batterHand,
    pitcherHand,
    venue: lineage.venue,
    cellKey: `${lineage.venue}|${batterHand}`,
    rawRow: row,
  });
}

function extractObservations(dataset, categories, venueByGameId) {
  const seen = new Set();
  const result = {};
  for (const periodId of PERIODS) {
    const period = object(dataset.periods?.[periodId], `dataset periods.${periodId}`);
    const rows = array(period.rows, `dataset periods.${periodId}.rows`);
    const observations = [];
    for (const [index, rawRow] of rows.entries()) {
      const observation = sourceObservation({
        rawRow,
        periodId,
        index,
        categories,
        venueByGameId,
      });
      if (observation === null) continue;
      if (seen.has(observation.observationId)) {
        throw new Error(`duplicate fit-validation observation ${observation.observationId}.`);
      }
      seen.add(observation.observationId);
      observations.push(observation);
    }
    if (
      observations.length !==
      nonNegativeInteger(period.classifiedTerminalCount, `${periodId}.classifiedTerminalCount`)
    ) {
      throw new Error(`${periodId} classified terminal count drifted.`);
    }
    observations.sort(
      (left, right) =>
        left.observedDate.localeCompare(right.observedDate) ||
        left.observationId.localeCompare(right.observationId),
    );
    result[periodId] = Object.freeze(observations);
  }
  if (result.fit.length === 0 || result.validation.length === 0) {
    throw new Error('park evaluation requires non-empty fit and validation observations.');
  }
  if (result.fit.at(-1).observedDate >= result.validation[0].observedDate) {
    throw new Error('fit and validation park cohorts must be strictly chronological.');
  }
  return Object.freeze(result);
}

function derivedDataset(template, observations) {
  if (observations.length === 0) throw new Error('baseline training cohort must be non-empty.');
  const rows = Object.freeze(observations.map((observation) => observation.rawRow));
  const fitPeriod = Object.freeze({
    startDate: observations[0].observedDate,
    endDate: observations.at(-1).observedDate,
    rowCount: rows.length,
    classifiedTerminalCount: rows.length,
    platoonEligibleCount: rows.filter((row) => row.includedInPlatoonModel === true).length,
    rows,
  });
  const validationPeriod = Object.freeze({
    startDate: fitPeriod.endDate,
    endDate: fitPeriod.endDate,
    rowCount: 0,
    classifiedTerminalCount: 0,
    platoonEligibleCount: 0,
    rows: Object.freeze([]),
  });
  const identity = Object.freeze({
    sourceDatasetSha256: template.datasetSha256,
    trainingObservationIds: Object.freeze(observations.map((observation) => observation.observationId)),
  });
  return Object.freeze({
    datasetVersion: 3,
    activeSeason: template.activeSeason,
    datasetSha256: sha256(JSON.stringify(identity)),
    periods: Object.freeze({ fit: fitPeriod, validation: validationPeriod }),
    untouchedTestReservation: Object.freeze({
      ...template.untouchedTestReservation,
      rowsIncluded: false,
    }),
  });
}

function derivedEvaluation(source, dataset) {
  const value = {
    ...source,
    sourceDatasetSha256: dataset.datasetSha256,
    sourceDatasetFileSha256: sha256(JSON.stringify(dataset)),
  };
  value.platoonEvaluationSha256 = sha256(JSON.stringify(platoonEvaluationIdentity(value)));
  return Object.freeze(value);
}

function fitBaselineArtifact({ dataset, platoonEvaluation, trainingObservations }) {
  const trainingDataset = derivedDataset(dataset, trainingObservations);
  const trainingEvaluation = derivedEvaluation(platoonEvaluation, trainingDataset);
  return verifyM8TerminalPaOutcomeArtifact(
    buildM8TerminalPaOutcomeArtifact({
      rawDataset: trainingDataset,
      datasetFileSha256: sha256(JSON.stringify(trainingDataset)),
      rawPlatoonEvaluation: trainingEvaluation,
      platoonEvaluationFileSha256: sha256(JSON.stringify(trainingEvaluation)),
    }),
  );
}

function normalizePositiveWeights(rawWeights, categories, label) {
  let total = 0;
  const weights = {};
  for (const category of categories) {
    const value = positiveFinite(rawWeights[category], `${label}.${category}`);
    weights[category] = value;
    total += value;
  }
  const probabilities = Object.freeze(
    Object.fromEntries(categories.map((category) => [category, weights[category] / total])),
  );
  const sum = Object.values(probabilities).reduce((accumulator, value) => accumulator + value, 0);
  if (Math.abs(sum - 1) > TOLERANCE) throw new Error(`${label} does not sum to one.`);
  return probabilities;
}

function stableSoftmax(logScores, categories, label) {
  const maximum = Math.max(...categories.map((category) => logScores[category]));
  return normalizePositiveWeights(
    Object.fromEntries(
      categories.map((category) => [category, Math.exp(logScores[category] - maximum)]),
    ),
    categories,
    label,
  );
}

function playerAdjustedTarget(overall, leagueMatchup, leagueTarget, categories) {
  return normalizePositiveWeights(
    Object.fromEntries(
      categories.map((category) => [
        category,
        overall[category] * (leagueMatchup[category] / leagueTarget[category]),
      ]),
    ),
    categories,
    'park benchmark player-adjusted platoon target',
  );
}

export function terminalPaOutcomeProbabilitiesFromVerifiedArtifact({
  artifact,
  batterId,
  pitcherId,
  batterSide,
  pitcherHand,
}) {
  const categories = artifact.categories;
  const batterKey = String(positiveInteger(batterId, 'batter id'));
  const pitcherKey = String(positiveInteger(pitcherId, 'pitcher id'));
  const batterOverall = artifact.batterOverall[batterKey] ?? artifact.unseenBatter;
  const pitcherVector = artifact.pitcherAllowed[pitcherKey] ?? artifact.unseenPitcher;
  let batterVector = batterOverall;
  if (
    artifact.selectedPlatoonCandidate.platoonCoefficient > 0 &&
    VALID_HANDS.has(batterSide) &&
    VALID_HANDS.has(pitcherHand)
  ) {
    const matchup = `${batterSide}-vs-${pitcherHand}`;
    const split =
      artifact.batterSplitByMatchup[`${batterKey}|${matchup}`] ??
      playerAdjustedTarget(
        batterOverall,
        artifact.leaguePlatoonByMatchup[matchup],
        artifact.leagueTarget,
        categories,
      );
    batterVector = stableSoftmax(
      Object.fromEntries(
        categories.map((category) => [
          category,
          Math.log(batterOverall[category]) +
            artifact.selectedPlatoonCandidate.platoonCoefficient *
              (Math.log(split[category]) - Math.log(batterOverall[category])),
        ]),
      ),
      categories,
      'park benchmark platoon probabilities',
    );
  }
  return stableSoftmax(
    Object.fromEntries(
      categories.map((category) => {
        const leagueLog = Math.log(artifact.leagueTarget[category]);
        return [
          category,
          leagueLog +
            artifact.baseParameters.batterCoefficient *
              (Math.log(batterVector[category]) - leagueLog) +
            artifact.baseParameters.pitcherAllowedCoefficient *
              (Math.log(pitcherVector[category]) - leagueLog),
        ];
      }),
    ),
    categories,
    'park benchmark coherent matchup probabilities',
  );
}

function baselineProbabilities(artifact, observation) {
  return terminalPaOutcomeProbabilitiesFromVerifiedArtifact({
    artifact,
    batterId: observation.providerBatterId,
    pitcherId: observation.providerPitcherId,
    batterSide: observation.batterHand,
    pitcherHand: observation.pitcherHand,
  });
}

function emptyCategoryObject(categories, value = 0) {
  return Object.fromEntries(categories.map((category) => [category, value]));
}

function fitCellStatistics({ observations, baselineArtifact, categories }) {
  const cells = new Map();
  for (const observation of observations) {
    const probabilities = baselineProbabilities(baselineArtifact, observation);
    const cell = cells.get(observation.cellKey) ?? {
      observationCount: 0,
      observedCounts: emptyCategoryObject(categories),
      expectedMass: emptyCategoryObject(categories),
    };
    cell.observationCount += 1;
    cell.observedCounts[observation.terminalCategory] += 1;
    for (const category of categories) {
      cell.expectedMass[category] += probabilities[category];
    }
    cells.set(observation.cellKey, cell);
  }
  return cells;
}

export function fitParkResiduals({ cellStatistics, categories: rawCategories, candidate: rawCandidate }) {
  const categories = validateStringList(rawCategories, 'categories', 2);
  const candidate = validateCandidate(rawCandidate, 'park candidate');
  if (candidate.exactNeutral) return new Map();
  const residuals = new Map();
  for (const [cellKey, rawCell] of cellStatistics.entries()) {
    const cell = object(rawCell, `cell ${cellKey}`);
    const count = positiveInteger(cell.observationCount, `cell ${cellKey} observationCount`);
    const factors = {};
    for (const category of categories) {
      const expectedRate = positiveFinite(
        cell.expectedMass[category] / count,
        `cell ${cellKey} expected rate ${category}`,
      );
      const observedCount = nonNegativeInteger(
        cell.observedCounts[category],
        `cell ${cellKey} observed count ${category}`,
      );
      const pooledRate =
        (observedCount + candidate.parkEquivalentPa * expectedRate) /
        (count + candidate.parkEquivalentPa);
      factors[category] = positiveFinite(
        pooledRate / expectedRate,
        `cell ${cellKey} residual factor ${category}`,
      );
    }
    residuals.set(cellKey, Object.freeze(factors));
  }
  return residuals;
}

export function applyParkResidual({ baseProbabilities: rawBase, residualFactors, categories: rawCategories }) {
  const categories = validateStringList(rawCategories, 'categories', 2);
  const base = object(rawBase, 'base probabilities');
  const factors = residualFactors === undefined ? null : object(residualFactors, 'residual factors');
  let total = 0;
  const weights = {};
  for (const category of categories) {
    const probability = positiveFinite(base[category], `base probabilities.${category}`);
    const factor = factors === null ? 1 : positiveFinite(factors[category], `residual factors.${category}`);
    weights[category] = probability * factor;
    total += weights[category];
  }
  if (!(total > 0) || !Number.isFinite(total)) {
    throw new Error('park-adjusted probability total is invalid.');
  }
  const probabilities = Object.freeze(
    Object.fromEntries(categories.map((category) => [category, weights[category] / total])),
  );
  const sum = Object.values(probabilities).reduce((accumulator, value) => accumulator + value, 0);
  if (Math.abs(sum - 1) > TOLERANCE) {
    throw new Error('park-adjusted probabilities do not sum to one.');
  }
  return probabilities;
}

function scoreCandidate({
  candidate,
  observations,
  baselineArtifact,
  residuals,
  categories,
  hitCategories,
}) {
  const hitSet = new Set(hitCategories);
  let categoricalLogLossSum = 0;
  let categoricalBrierSum = 0;
  let hitLogLossSum = 0;
  let hitBrierSum = 0;
  let unseenCellObservationCount = 0;
  for (const observation of observations) {
    const base = baselineProbabilities(baselineArtifact, observation);
    const factors = residuals.get(observation.cellKey);
    if (factors === undefined && !candidate.exactNeutral) unseenCellObservationCount += 1;
    const probabilities = applyParkResidual({
      baseProbabilities: base,
      residualFactors: factors,
      categories,
    });
    categoricalLogLossSum += -Math.log(probabilities[observation.terminalCategory]);
    for (const category of categories) {
      const target = category === observation.terminalCategory ? 1 : 0;
      categoricalBrierSum += (probabilities[category] - target) ** 2;
    }
    const hitProbability = hitCategories.reduce(
      (sum, category) => sum + probabilities[category],
      0,
    );
    const hit = hitSet.has(observation.terminalCategory) ? 1 : 0;
    hitLogLossSum += hit === 1 ? -Math.log(hitProbability) : -Math.log(1 - hitProbability);
    hitBrierSum += (hitProbability - hit) ** 2;
  }
  return Object.freeze({
    candidate,
    observationCount: observations.length,
    observationIdsSha256: sha256(
      JSON.stringify(observations.map((observation) => observation.observationId)),
    ),
    categoricalLogLoss: categoricalLogLossSum / observations.length,
    categoricalBrierScore: categoricalBrierSum / observations.length,
    hitLogLoss: hitLogLossSum / observations.length,
    hitBrierScore: hitBrierSum / observations.length,
    unseenCellObservationCount,
  });
}

function evaluateSplit({
  trainingObservations,
  scoringObservations,
  dataset,
  platoonEvaluation,
  categories,
  hitCategories,
  candidates,
}) {
  const baselineArtifact = fitBaselineArtifact({
    dataset,
    platoonEvaluation,
    trainingObservations,
  });
  const cellStatistics = fitCellStatistics({
    observations: trainingObservations,
    baselineArtifact,
    categories,
  });
  const results = Object.freeze(
    candidates.map((candidate) => {
      const residuals = candidate.exactNeutral
        ? new Map()
        : fitParkResiduals({ cellStatistics, categories, candidate });
      return scoreCandidate({
        candidate,
        observations: scoringObservations,
        baselineArtifact,
        residuals,
        categories,
        hitCategories,
      });
    }),
  );
  const identity = results[0].observationIdsSha256;
  if (
    results.some(
      (result) =>
        result.observationCount !== scoringObservations.length ||
        result.observationIdsSha256 !== identity,
    )
  ) {
    throw new Error('park candidates did not score one identical observation cohort.');
  }
  return Object.freeze({
    trainingObservationCount: trainingObservations.length,
    scoringObservationCount: scoringObservations.length,
    scoringObservationIdsSha256: identity,
    fitVenueHandCellCount: cellStatistics.size,
    results,
  });
}

function dominates(left, right) {
  return (
    left.categoricalLogLoss <= right.categoricalLogLoss + TOLERANCE &&
    left.categoricalBrierScore <= right.categoricalBrierScore + TOLERANCE &&
    (left.categoricalLogLoss < right.categoricalLogLoss - TOLERANCE ||
      left.categoricalBrierScore < right.categoricalBrierScore - TOLERANCE)
  );
}

function nondominatedCandidateIds(results) {
  return Object.freeze(
    results
      .filter(
        (candidate) =>
          !results.some(
            (other) =>
              other.candidate.candidateId !== candidate.candidate.candidateId &&
              dominates(other, candidate),
          ),
      )
      .map((result) => result.candidate.candidateId)
      .sort(),
  );
}

function poolingRank(candidate) {
  return candidate.exactNeutral ? Number.POSITIVE_INFINITY : candidate.parkEquivalentPa;
}

export function selectStableParkCandidate({ fixedResults, walkForwardResults, candidates: rawCandidates }) {
  const candidates = validateCandidates(rawCandidates);
  const fixedSet = nondominatedCandidateIds(array(fixedResults, 'fixedResults'));
  const walkSet = nondominatedCandidateIds(array(walkForwardResults, 'walkForwardResults'));
  const stableIds = fixedSet.filter((candidateId) => walkSet.includes(candidateId));
  if (stableIds.length === 0) {
    return Object.freeze({
      status: 'no-stable-park-candidate',
      fixedNondominatedCandidateIds: fixedSet,
      walkForwardNondominatedCandidateIds: walkSet,
      stableCandidateIds: Object.freeze([]),
      selectedCandidate: null,
    });
  }
  const byId = new Map(candidates.map((candidate) => [candidate.candidateId, candidate]));
  const selectedCandidate = stableIds
    .map((candidateId) => byId.get(candidateId))
    .sort(
      (left, right) =>
        poolingRank(right) - poolingRank(left) ||
        left.candidateId.localeCompare(right.candidateId),
    )[0];
  return Object.freeze({
    status: selectedCandidate.exactNeutral
      ? 'stable-neutral-park-selected'
      : 'stable-finite-park-selected',
    fixedNondominatedCandidateIds: fixedSet,
    walkForwardNondominatedCandidateIds: walkSet,
    stableCandidateIds: Object.freeze([...stableIds].sort()),
    selectedCandidate,
  });
}

function aggregateWalkForwardResults(folds, candidates) {
  const results = [];
  for (const candidate of candidates) {
    let observationCount = 0;
    let categoricalLogLossSum = 0;
    let categoricalBrierSum = 0;
    let hitLogLossSum = 0;
    let hitBrierSum = 0;
    let unseenCellObservationCount = 0;
    const ids = [];
    for (const fold of folds) {
      const result = fold.results.find(
        (item) => item.candidate.candidateId === candidate.candidateId,
      );
      if (!result) throw new Error(`walk-forward fold omitted ${candidate.candidateId}.`);
      observationCount += result.observationCount;
      categoricalLogLossSum += result.categoricalLogLoss * result.observationCount;
      categoricalBrierSum += result.categoricalBrierScore * result.observationCount;
      hitLogLossSum += result.hitLogLoss * result.observationCount;
      hitBrierSum += result.hitBrierScore * result.observationCount;
      unseenCellObservationCount += result.unseenCellObservationCount;
      ids.push(...fold.scoringObservationIds);
    }
    results.push(
      Object.freeze({
        candidate,
        observationCount,
        observationIdsSha256: sha256(JSON.stringify(ids)),
        categoricalLogLoss: categoricalLogLossSum / observationCount,
        categoricalBrierScore: categoricalBrierSum / observationCount,
        hitLogLoss: hitLogLossSum / observationCount,
        hitBrierScore: hitBrierSum / observationCount,
        unseenCellObservationCount,
      }),
    );
  }
  return Object.freeze(results);
}

export function evaluateM8ParkEffect({
  rawDataset,
  datasetFileSha256,
  rawVenueLineage,
  venueLineageFileSha256,
  rawPlatoonEvaluation,
  platoonEvaluationFileSha256,
  candidates: rawCandidates = DEFAULT_M8_PARK_CANDIDATES,
}) {
  const dataset = validateDataset(rawDataset);
  const venue = lineageByGame(rawVenueLineage);
  const platoonEvaluation = validatePlatoonEvaluation(rawPlatoonEvaluation, dataset);
  if (venue.lineage.sourceResolvedDatasetSha256 !== dataset.datasetSha256) {
    throw new Error('venue lineage does not reference the supplied dataset.');
  }
  if (venue.lineage.activeSeason !== dataset.activeSeason) {
    throw new Error('venue lineage active season does not match the dataset.');
  }
  const categories = validateStringList(
    platoonEvaluation.modeledCategories,
    'modeledCategories',
    2,
  );
  const hitCategories = validateStringList(platoonEvaluation.hitCategories, 'hitCategories', 1);
  for (const category of hitCategories) {
    if (!categories.includes(category)) throw new Error(`unsupported hit category ${category}.`);
  }
  const candidates = validateCandidates(rawCandidates);
  const observations = extractObservations(dataset, categories, venue.byGameId);

  const fixedValidation = evaluateSplit({
    trainingObservations: observations.fit,
    scoringObservations: observations.validation,
    dataset,
    platoonEvaluation,
    categories,
    hitCategories,
    candidates,
  });

  const validationByDate = new Map();
  for (const observation of observations.validation) {
    const current = validationByDate.get(observation.observedDate) ?? [];
    current.push(observation);
    validationByDate.set(observation.observedDate, current);
  }
  const folds = [];
  const priorValidation = [];
  for (const observedDate of [...validationByDate.keys()].sort()) {
    const scoringObservations = Object.freeze(validationByDate.get(observedDate));
    const split = evaluateSplit({
      trainingObservations: Object.freeze([...observations.fit, ...priorValidation]),
      scoringObservations,
      dataset,
      platoonEvaluation,
      categories,
      hitCategories,
      candidates,
    });
    folds.push(
      Object.freeze({
        observedDate,
        trainingObservationCount: split.trainingObservationCount,
        scoringObservationCount: split.scoringObservationCount,
        scoringObservationIds: Object.freeze(
          scoringObservations.map((observation) => observation.observationId),
        ),
        fitVenueHandCellCount: split.fitVenueHandCellCount,
        results: split.results,
      }),
    );
    priorValidation.push(...scoringObservations);
  }
  const aggregateResults = aggregateWalkForwardResults(folds, candidates);
  if (
    aggregateResults.some(
      (result) => result.observationCount !== observations.validation.length,
    )
  ) {
    throw new Error('walk-forward evaluation did not score every validation observation exactly once.');
  }
  const selection = selectStableParkCandidate({
    fixedResults: fixedValidation.results,
    walkForwardResults: aggregateResults,
    candidates,
  });

  const identity = {
    evaluationVersion: 1,
    activeSeason: dataset.activeSeason,
    sourceDatasetSha256: dataset.datasetSha256,
    sourceDatasetFileSha256: sha(datasetFileSha256, 'source dataset file SHA-256'),
    sourceVenueLineageSha256: venue.lineage.lineageSha256,
    sourceVenueLineageFileSha256: sha(
      venueLineageFileSha256,
      'source venue lineage file SHA-256',
    ),
    sourcePlatoonEvaluationSha256: platoonEvaluation.platoonEvaluationSha256,
    sourcePlatoonEvaluationFileSha256: sha(
      platoonEvaluationFileSha256,
      'source platoon evaluation file SHA-256',
    ),
    modeledCategories: categories,
    hitCategories,
    candidateSetVersion: 1,
    candidates,
    model: Object.freeze({
      family: 'current-season-venue-by-batter-hand-categorical-residual',
      neutralization:
        'fit observed venue-hand terminal-category counts against summed fit-only batter-pitcher-platoon baseline probabilities',
      pooling:
        'pool each venue-hand observed categorical distribution once toward its own fit-only baseline expected distribution',
      application:
        'multiply each baseline categorical probability by the pooled venue-hand residual factor and renormalize coherently',
      priorSeasonRowsAllowed: false,
      hardSampleCutoffAllowed: false,
      arbitraryPointAdjustmentAllowed: false,
      noParkLimit: 'infinite pooling',
    }),
    cohorts: Object.freeze({
      fitObservationCount: observations.fit.length,
      validationObservationCount: observations.validation.length,
      fitVenueCount: new Set(observations.fit.map((observation) => observation.venue)).size,
      validationVenueCount: new Set(
        observations.validation.map((observation) => observation.venue),
      ).size,
      fitVenueHandCellCount: new Set(
        observations.fit.map((observation) => observation.cellKey),
      ).size,
      validationVenueHandCellCount: new Set(
        observations.validation.map((observation) => observation.cellKey),
      ).size,
    }),
    fixedValidation: Object.freeze({
      trainingObservationCount: fixedValidation.trainingObservationCount,
      scoringObservationCount: fixedValidation.scoringObservationCount,
      scoringObservationIdsSha256: fixedValidation.scoringObservationIdsSha256,
      fitVenueHandCellCount: fixedValidation.fitVenueHandCellCount,
      results: fixedValidation.results,
      nondominatedCandidateIds: nondominatedCandidateIds(fixedValidation.results),
    }),
    walkForward: Object.freeze({
      foldCount: folds.length,
      folds: Object.freeze(folds),
      aggregateResults,
      nondominatedCandidateIds: nondominatedCandidateIds(aggregateResults),
    }),
    selection,
    untouchedTestReservation: untouched(
      dataset.untouchedTestReservation,
      'park evaluation untouchedTestReservation',
    ),
  };
  return Object.freeze({
    purpose:
      'Fit and validate a current-season handedness- and outcome-specific park residual layer without double-applying batter, pitcher, or platoon context.',
    status: 'offline-park-effect-evaluation-not-production-model',
    ...identity,
    evaluationSha256: sha256(JSON.stringify(identity)),
  });
}

export function verifyM8ParkEffectEvaluation(rawEvaluation) {
  const evaluation = object(rawEvaluation, 'park effect evaluation');
  if (evaluation.evaluationVersion !== 1) {
    throw new Error('park effect evaluation version must equal 1.');
  }
  untouched(evaluation.untouchedTestReservation, 'park effect evaluation untouchedTestReservation');
  validateCandidates(evaluation.candidates);
  if (evaluation.evaluationSha256 !== sha256(JSON.stringify(evaluationIdentity(evaluation)))) {
    throw new Error('park effect evaluation SHA-256 is invalid.');
  }
  const selection = object(evaluation.selection, 'park effect selection');
  if (selection.selectedCandidate !== null) {
    if (!selection.stableCandidateIds.includes(selection.selectedCandidate.candidateId)) {
      throw new Error('selected park candidate is not in the stable candidate set.');
    }
  }
  return evaluation;
}
