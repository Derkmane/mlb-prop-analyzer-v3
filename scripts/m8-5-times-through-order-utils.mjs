import { createHash } from 'node:crypto';

import { buildM8StarterBullpenDataset } from './m8-starter-bullpen-transition-utils.mjs';
import { verifyM8TerminalPaOutcomeArtifact } from './m8-terminal-pa-outcome-artifact-utils.mjs';

const PERIODS = Object.freeze(['fit', 'validation']);
const EXPOSURE_BUCKETS = Object.freeze(['first', 'second', 'third-plus']);
const TOLERANCE = 1e-12;
const PROBABILITY_FLOOR = 1e-300;
const SHA256_PATTERN = /^[a-f0-9]{64}$/u;

export const M8_5_TIMES_THROUGH_ORDER_CANDIDATE_SET_VERSION =
  'm8-5-times-through-order-pooling-v1';

export const DEFAULT_M8_5_TIMES_THROUGH_ORDER_CANDIDATES = Object.freeze(
  [25, 50, 100, 250, 500, 1000, 2500].map((equivalentPa) =>
    Object.freeze({
      candidateId: `tto-pool-${equivalentPa}`,
      equivalentPa,
    }),
  ),
);

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

function positiveInteger(value, label) {
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new TypeError(`${label} must be a positive integer.`);
  }
  return value;
}

function assertSha256(value, label) {
  if (typeof value !== 'string' || !SHA256_PATTERN.test(value)) {
    throw new TypeError(`${label} must be a lowercase SHA-256 value.`);
  }
  return value;
}

function assertNoForbiddenFields(value, label) {
  for (const field of [
    'selectedSide',
    'rawSide',
    'directProbabilityEffect',
    'probabilityDelta',
    'winProbability',
  ]) {
    if (Object.hasOwn(value, field)) {
      throw new Error(`${label} contains forbidden field ${field}.`);
    }
  }
}

function sideFromHalf(value) {
  const normalized = string(value, 'half inning').toLowerCase();
  if (normalized === 'top') return 'away';
  if (normalized === 'bottom') return 'home';
  throw new Error(`unsupported half inning ${value}.`);
}

function sha256(value) {
  return createHash('sha256').update(value).digest('hex');
}

function emptyCounts(categories) {
  return Object.fromEntries(categories.map((category) => [category, 0]));
}

function normalizedVector(raw, categories, label) {
  const value = object(raw, label);
  const values = categories.map((category) => {
    const probability = value[category];
    if (!Number.isFinite(probability) || probability < 0) {
      throw new RangeError(`${label}.${category} must be nonnegative and finite.`);
    }
    return probability;
  });
  const total = values.reduce((sum, probability) => sum + probability, 0);
  if (!(total > 0)) throw new Error(`${label} has no probability mass.`);
  const normalized = values.map((probability) => probability / total);
  return Object.freeze(
    Object.fromEntries(
      categories.map((category, index) => [category, normalized[index]]),
    ),
  );
}

function datasetIdentity(value) {
  return {
    datasetVersion: value.datasetVersion,
    activeSeason: value.activeSeason,
    sourceResolvedDatasetSha256: value.sourceResolvedDatasetSha256,
    sourceStarterBullpenTransitionSha256:
      value.sourceStarterBullpenTransitionSha256,
    periods: value.periods,
    totals: value.totals,
    exclusionReasonCounts: value.exclusionReasonCounts,
    untouchedTestReservation: value.untouchedTestReservation,
  };
}

function evaluationIdentity(value) {
  return {
    evaluationVersion: value.evaluationVersion,
    candidateSetVersion: value.candidateSetVersion,
    mathSpecVersion: value.mathSpecVersion,
    modelFamily: value.modelFamily,
    status: value.status,
    activeSeason: value.activeSeason,
    sourceDatasetSha256: value.sourceDatasetSha256,
    sourceTerminalArtifactSha256: value.sourceTerminalArtifactSha256,
    fitWindow: value.fitWindow,
    validationWindow: value.validationWindow,
    candidates: value.candidates,
    identityFixedMetrics: value.identityFixedMetrics,
    identityWalkForwardMetrics: value.identityWalkForwardMetrics,
    candidateResults: value.candidateResults,
    fixedNondominatedCandidateIds: value.fixedNondominatedCandidateIds,
    walkForwardNondominatedCandidateIds:
      value.walkForwardNondominatedCandidateIds,
    stableCandidateIds: value.stableCandidateIds,
    selectedCandidateId: value.selectedCandidateId,
    decision: value.decision,
    finalModel: value.finalModel,
    invariants: value.invariants,
    untouchedTestReservation: value.untouchedTestReservation,
  };
}

function validateResolvedDataset(rawDataset) {
  const dataset = object(rawDataset, 'resolved categorical dataset');
  assertNoForbiddenFields(dataset, 'resolved categorical dataset');
  if (dataset.datasetVersion !== 3) {
    throw new Error('resolved categorical datasetVersion must equal 3.');
  }
  if (dataset.activeSeason !== 2026) {
    throw new Error('times-through-order inputs must use active season 2026.');
  }
  assertSha256(dataset.datasetSha256, 'resolved dataset SHA-256');
  const reservation = object(
    dataset.untouchedTestReservation,
    'resolved dataset untouched reservation',
  );
  if (reservation.rowsIncluded !== false || Object.hasOwn(reservation, 'rows')) {
    throw new Error('resolved dataset must keep untouched-test rows sealed.');
  }
  return dataset;
}

function groupedResolvedRows(dataset, periodId) {
  const period = object(dataset.periods?.[periodId], `${periodId} period`);
  const groups = new Map();
  for (const rawRow of array(period.rows, `${periodId} rows`)) {
    const row = object(rawRow, `${periodId} resolved row`);
    assertNoForbiddenFields(row, `${periodId} resolved row`);
    const key = `${string(row.observedDate, 'observed date')}:${positiveInteger(
      row.providerGameId,
      'provider game id',
    )}:${sideFromHalf(row.halfInning)}`;
    const rows = groups.get(key) ?? [];
    rows.push(row);
    groups.set(key, rows);
  }
  return groups;
}

function exposureBucket(exposureNumber) {
  if (exposureNumber === 1) return 'first';
  if (exposureNumber === 2) return 'second';
  return 'third-plus';
}

function reconstructStarterRows(teamGame, rawRows) {
  const rows = [...rawRows].sort(
    (left, right) => left.providerPaNumber - right.providerPaNumber,
  );
  const terminalRows = rows.filter(
    (row) => row.mappingStatus === 'classified-terminal',
  );
  const starterRows = [];
  let bullpenStarted = false;
  let bullpenBattersFaced = 0;
  for (const row of terminalRows) {
    const pitcherId = positiveInteger(row.providerPitcherId, 'pitcher id');
    if (!bullpenStarted && pitcherId === teamGame.starterPitcherId) {
      starterRows.push(row);
      continue;
    }
    bullpenStarted = true;
    if (pitcherId === teamGame.starterPitcherId) {
      throw new Error(`${teamGame.rowId} starter reappeared after bullpen.`);
    }
    bullpenBattersFaced += 1;
  }
  if (
    starterRows.length !== teamGame.starterBattersFaced ||
    bullpenBattersFaced !== teamGame.bullpenBattersFaced ||
    starterRows.length + bullpenBattersFaced !== teamGame.totalBattersFaced
  ) {
    throw new Error(
      `${teamGame.rowId} times-through-order reconstruction drifted from the frozen starter-to-bullpen transition.`,
    );
  }
  return starterRows;
}

export function buildM8_5TimesThroughOrderDataset({
  resolvedDataset: rawResolvedDataset,
  starterBullpenTransitionSha256,
}) {
  const resolvedDataset = validateResolvedDataset(rawResolvedDataset);
  const transitionSha256 = assertSha256(
    starterBullpenTransitionSha256,
    'starter-bullpen transition SHA-256',
  );
  const transitionDataset = buildM8StarterBullpenDataset(resolvedDataset);
  const periods = {};
  const exposureCounts = { first: 0, second: 0, 'third-plus': 0 };
  let starterRowCount = 0;
  let conservedBullpenRowCount = 0;

  for (const periodId of PERIODS) {
    const resolvedGroups = groupedResolvedRows(resolvedDataset, periodId);
    const rows = [];
    for (const teamGame of transitionDataset.periods[periodId].rows) {
      const groupKey = `${teamGame.observedDate}:${teamGame.gameId}:${teamGame.side}`;
      const sourceRows = resolvedGroups.get(groupKey);
      if (sourceRows === undefined) {
        throw new Error(`missing resolved team-game group ${groupKey}.`);
      }
      const starterRows = reconstructStarterRows(teamGame, sourceRows);
      const exposuresByBatter = new Map();
      for (const row of starterRows) {
        const batterId = positiveInteger(row.providerBatterId, 'batter id');
        const exposureNumber = (exposuresByBatter.get(batterId) ?? 0) + 1;
        exposuresByBatter.set(batterId, exposureNumber);
        const bucket = exposureBucket(exposureNumber);
        exposureCounts[bucket] += 1;
        rows.push(
          Object.freeze({
            rowId: `${teamGame.rowId}:starter-pa:${positiveInteger(
              row.providerPaNumber,
              'provider PA number',
            )}:${batterId}:${exposureNumber}`,
            periodId,
            observedDate: teamGame.observedDate,
            gameId: teamGame.gameId,
            battingSide: teamGame.side,
            starterPitcherId: teamGame.starterPitcherId,
            providerBatterId: batterId,
            pitcherHand:
              row.normalizedPitcherHand === 'L' ||
              row.normalizedPitcherHand === 'R'
                ? row.normalizedPitcherHand
                : null,
            batterSide:
              row.normalizedBatterSide === 'L' ||
              row.normalizedBatterSide === 'R'
                ? row.normalizedBatterSide
                : null,
            exposureNumber,
            exposureBucket: bucket,
            terminalCategory: string(
              row.terminalCategory,
              'starter terminal category',
            ),
          }),
        );
      }
      starterRowCount += starterRows.length;
      conservedBullpenRowCount += teamGame.bullpenBattersFaced;
    }
    rows.sort(
      (left, right) =>
        left.observedDate.localeCompare(right.observedDate) ||
        left.gameId - right.gameId ||
        left.battingSide.localeCompare(right.battingSide) ||
        left.rowId.localeCompare(right.rowId),
    );
    if (rows.length === 0) {
      throw new Error(`${periodId} contains no usable starter exposure rows.`);
    }
    periods[periodId] = Object.freeze({
      startDate: rows[0].observedDate,
      endDate: rows.at(-1).observedDate,
      rowCount: rows.length,
      teamGameCount: transitionDataset.periods[periodId].rowCount,
      rows: Object.freeze(rows),
    });
  }
  if (periods.fit.endDate >= periods.validation.startDate) {
    throw new Error('times-through-order fit and validation periods overlap.');
  }
  const identity = {
    datasetVersion: 1,
    activeSeason: 2026,
    sourceResolvedDatasetSha256: resolvedDataset.datasetSha256,
    sourceStarterBullpenTransitionSha256: transitionSha256,
    periods: Object.freeze(periods),
    totals: Object.freeze({
      starterRowCount,
      conservedBullpenRowCount,
      includedTeamGameCount:
        transitionDataset.totals.includedTeamGameCount,
      excludedTeamGameCount:
        transitionDataset.totals.excludedTeamGameCount,
      exposureCounts: Object.freeze({ ...exposureCounts }),
    }),
    exclusionReasonCounts: transitionDataset.exclusionReasonCounts,
    untouchedTestReservation: Object.freeze({ rowsIncluded: false }),
  };
  return Object.freeze({
    purpose:
      'Assign exact first, second, and third-plus batter exposures inside the recovered starter prefix while preserving the separately validated starter-to-bullpen transition and excluding every bullpen plate appearance from the factor.',
    ...identity,
    datasetSha256: sha256(JSON.stringify(datasetIdentity(identity))),
  });
}

function validateTimesThroughOrderDataset(rawDataset) {
  const dataset = object(rawDataset, 'times-through-order dataset');
  assertNoForbiddenFields(dataset, 'times-through-order dataset');
  if (dataset.datasetVersion !== 1 || dataset.activeSeason !== 2026) {
    throw new Error('unsupported times-through-order dataset contract.');
  }
  if (
    dataset.datasetSha256 !==
    sha256(JSON.stringify(datasetIdentity(dataset)))
  ) {
    throw new Error('times-through-order dataset SHA-256 is invalid.');
  }
  const reservation = object(
    dataset.untouchedTestReservation,
    'times-through-order untouched reservation',
  );
  if (reservation.rowsIncluded !== false || Object.hasOwn(reservation, 'rows')) {
    throw new Error('times-through-order dataset must keep untouched rows sealed.');
  }
  return dataset;
}

function validateCandidates(rawCandidates) {
  const candidates = array(rawCandidates, 'times-through-order candidates').map(
    (rawCandidate, index) => {
      const candidate = object(rawCandidate, `candidate[${index}]`);
      const equivalentPa = positiveInteger(
        candidate.equivalentPa,
        `candidate[${index}].equivalentPa`,
      );
      const candidateId = string(
        candidate.candidateId,
        `candidate[${index}].candidateId`,
      );
      if (candidateId !== `tto-pool-${equivalentPa}`) {
        throw new Error(`${candidateId} does not match its pooling strength.`);
      }
      return Object.freeze({ candidateId, equivalentPa });
    },
  );
  if (candidates.length === 0) {
    throw new Error('times-through-order candidate grid is empty.');
  }
  if (
    new Set(candidates.map((candidate) => candidate.candidateId)).size !==
    candidates.length
  ) {
    throw new Error('times-through-order candidate grid contains duplicates.');
  }
  return Object.freeze(candidates);
}

function countByExposure(rows, categories) {
  const counts = Object.fromEntries(
    EXPOSURE_BUCKETS.map((bucket) => [bucket, emptyCounts(categories)]),
  );
  const totals = { first: 0, second: 0, 'third-plus': 0 };
  for (const row of rows) {
    if (!EXPOSURE_BUCKETS.includes(row.exposureBucket)) {
      throw new Error(`unsupported exposure bucket ${row.exposureBucket}.`);
    }
    if (!categories.includes(row.terminalCategory)) {
      throw new Error(
        `times-through-order row has unsupported terminal category ${row.terminalCategory}.`,
      );
    }
    counts[row.exposureBucket][row.terminalCategory] += 1;
    totals[row.exposureBucket] += 1;
  }
  if (totals.first === 0 || totals.second + totals['third-plus'] === 0) {
    throw new Error(
      'times-through-order fitting requires first and repeated starter exposures.',
    );
  }
  return { counts, totals };
}

function pooledDistribution(counts, total, target, equivalentPa, categories) {
  return normalizedVector(
    Object.fromEntries(
      categories.map((category) => [
        category,
        counts[category] + equivalentPa * target[category],
      ]),
    ),
    categories,
    'times-through-order pooled distribution',
  );
}

function fitExposureModel(rows, terminalArtifact, candidate) {
  const categories = terminalArtifact.categories;
  const { counts, totals } = countByExposure(rows, categories);
  const byExposure = {};
  for (const bucket of EXPOSURE_BUCKETS) {
    byExposure[bucket] = pooledDistribution(
      counts[bucket],
      totals[bucket],
      terminalArtifact.leagueTarget,
      candidate.equivalentPa,
      categories,
    );
  }
  const multipliers = {
    first: Object.freeze(
      Object.fromEntries(categories.map((category) => [category, 1])),
    ),
  };
  for (const bucket of ['second', 'third-plus']) {
    multipliers[bucket] = Object.freeze(
      Object.fromEntries(
        categories.map((category) => [
          category,
          byExposure[bucket][category] / byExposure.first[category],
        ]),
      ),
    );
  }
  return Object.freeze({
    modelVersion: `m8-5-times-through-order-${candidate.candidateId}-v1`,
    candidate,
    categories,
    firstExposurePolicy: 'identity',
    starterOnly: true,
    preservesStarterBullpenTransition: true,
    byExposure: Object.freeze(byExposure),
    multipliers: Object.freeze(multipliers),
  });
}

function identityModel(terminalArtifact) {
  const categories = terminalArtifact.categories;
  const identity = Object.freeze(
    Object.fromEntries(categories.map((category) => [category, 1])),
  );
  return Object.freeze({
    modelVersion: 'm8-5-times-through-order-identity-v1',
    candidate: null,
    categories,
    firstExposurePolicy: 'identity',
    starterOnly: true,
    preservesStarterBullpenTransition: true,
    byExposure: null,
    multipliers: Object.freeze({
      first: identity,
      second: identity,
      'third-plus': identity,
    }),
  });
}

function pitcherVectorForRow(terminalArtifact, row) {
  return (
    terminalArtifact.pitcherAllowed[String(row.starterPitcherId)] ??
    terminalArtifact.unseenPitcher
  );
}

export function applyM8_5TimesThroughOrderModelToPitcherVector({
  pitcherVector: rawPitcherVector,
  exposureBucket: bucket,
  model,
}) {
  if (!EXPOSURE_BUCKETS.includes(bucket)) {
    throw new Error(`unsupported times-through-order exposure ${bucket}.`);
  }
  const categories = array(model.categories, 'times-through-order categories');
  const pitcherVector = normalizedVector(
    rawPitcherVector,
    categories,
    'frozen starter pitcher vector',
  );
  const multiplier = object(
    model.multipliers?.[bucket],
    `${bucket} times-through-order multiplier`,
  );
  if (bucket === 'first') {
    for (const category of categories) {
      if (multiplier[category] !== 1) {
        throw new Error('first starter exposure must remain exact identity.');
      }
    }
  }
  return normalizedVector(
    Object.fromEntries(
      categories.map((category) => [
        category,
        pitcherVector[category] * multiplier[category],
      ]),
    ),
    categories,
    `${bucket} adjusted starter pitcher vector`,
  );
}

function vectorForRow(model, terminalArtifact, row) {
  return applyM8_5TimesThroughOrderModelToPitcherVector({
    pitcherVector: pitcherVectorForRow(terminalArtifact, row),
    exposureBucket: row.exposureBucket,
    model,
  });
}

function scoreRows(rows, model, terminalArtifact) {
  if (rows.length === 0) throw new Error('cannot score an empty TTO cohort.');
  let logLossTotal = 0;
  let brierTotal = 0;
  const rowIds = [];
  for (const row of rows) {
    const vector = vectorForRow(model, terminalArtifact, row);
    logLossTotal += -Math.log(
      Math.max(vector[row.terminalCategory] ?? 0, PROBABILITY_FLOOR),
    );
    for (const category of terminalArtifact.categories) {
      const target = category === row.terminalCategory ? 1 : 0;
      brierTotal += (vector[category] - target) ** 2;
    }
    rowIds.push(row.rowId);
  }
  return Object.freeze({
    observationCount: rows.length,
    categoricalLogLoss: logLossTotal / rows.length,
    categoricalBrier: brierTotal / rows.length,
    observationIdsSha256: sha256(JSON.stringify(rowIds)),
    logLossTotal,
    brierTotal,
  });
}

function aggregateMetrics(parts) {
  const observationCount = parts.reduce(
    (sum, part) => sum + part.observationCount,
    0,
  );
  const logLossTotal = parts.reduce(
    (sum, part) => sum + part.logLossTotal,
    0,
  );
  const brierTotal = parts.reduce((sum, part) => sum + part.brierTotal, 0);
  return Object.freeze({
    observationCount,
    categoricalLogLoss: logLossTotal / observationCount,
    categoricalBrier: brierTotal / observationCount,
    observationIdsSha256: sha256(
      JSON.stringify(parts.map((part) => part.observationIdsSha256)),
    ),
    logLossTotal,
    brierTotal,
  });
}

function walkForwardMetrics(fitRows, validationRows, terminalArtifact, candidate) {
  const dates = [...new Set(validationRows.map((row) => row.observedDate))].sort();
  const parts = [];
  const folds = [];
  for (const validationDate of dates) {
    const trainingRows = [
      ...fitRows,
      ...validationRows.filter((row) => row.observedDate < validationDate),
    ];
    const scoringRows = validationRows.filter(
      (row) => row.observedDate === validationDate,
    );
    const model =
      candidate === null
        ? identityModel(terminalArtifact)
        : fitExposureModel(trainingRows, terminalArtifact, candidate);
    const metrics = scoreRows(scoringRows, model, terminalArtifact);
    parts.push(metrics);
    folds.push(
      Object.freeze({
        validationDate,
        trainingObservationCount: trainingRows.length,
        scoringObservationCount: scoringRows.length,
        metrics,
      }),
    );
  }
  return Object.freeze({
    metrics: aggregateMetrics(parts),
    folds: Object.freeze(folds),
  });
}

function dominates(left, right) {
  const noWorse =
    left.categoricalLogLoss <= right.categoricalLogLoss + TOLERANCE &&
    left.categoricalBrier <= right.categoricalBrier + TOLERANCE;
  const strictlyBetter =
    left.categoricalLogLoss < right.categoricalLogLoss - TOLERANCE ||
    left.categoricalBrier < right.categoricalBrier - TOLERANCE;
  return noWorse && strictlyBetter;
}

function nondominatedIds(points, metricKey) {
  return Object.freeze(
    points
      .filter(
        (point) =>
          !points.some(
            (other) =>
              other.candidateId !== point.candidateId &&
              dominates(other[metricKey], point[metricKey]),
          ),
      )
      .map((point) => point.candidateId)
      .sort((left, right) => left.localeCompare(right)),
  );
}

function selectCandidate(points) {
  const fixedNondominatedCandidateIds = nondominatedIds(
    points,
    'fixedMetrics',
  );
  const walkForwardNondominatedCandidateIds = nondominatedIds(
    points,
    'walkForwardMetrics',
  );
  const walkSet = new Set(walkForwardNondominatedCandidateIds);
  const stableCandidateIds = Object.freeze(
    fixedNondominatedCandidateIds.filter((candidateId) =>
      walkSet.has(candidateId),
    ),
  );
  if (stableCandidateIds.length === 0) {
    return Object.freeze({
      fixedNondominatedCandidateIds,
      walkForwardNondominatedCandidateIds,
      stableCandidateIds,
      selectedCandidateId: null,
      decision: 'NO_STABLE_TIMES_THROUGH_ORDER_CANDIDATE',
    });
  }
  const pointById = new Map(points.map((point) => [point.candidateId, point]));
  const selectedCandidateId = [...stableCandidateIds].sort((left, right) => {
    if (left === 'identity') return -1;
    if (right === 'identity') return 1;
    const leftStrength = pointById.get(left).equivalentPa;
    const rightStrength = pointById.get(right).equivalentPa;
    return rightStrength - leftStrength || left.localeCompare(right);
  })[0];
  return Object.freeze({
    fixedNondominatedCandidateIds,
    walkForwardNondominatedCandidateIds,
    stableCandidateIds,
    selectedCandidateId,
    decision:
      selectedCandidateId === 'identity'
        ? 'IDENTITY_RETAINED_NO_VALIDATED_TIMES_THROUGH_ORDER_SIGNAL'
        : 'VALIDATED_TIMES_THROUGH_ORDER_SIGNAL',
  });
}

export function evaluateM8_5TimesThroughOrderCandidates({
  dataset: rawDataset,
  terminalArtifact: rawTerminalArtifact,
  candidates: rawCandidates = DEFAULT_M8_5_TIMES_THROUGH_ORDER_CANDIDATES,
}) {
  const dataset = validateTimesThroughOrderDataset(rawDataset);
  const terminalArtifact = verifyM8TerminalPaOutcomeArtifact(
    rawTerminalArtifact,
  );
  if (terminalArtifact.activeSeason !== 2026) {
    throw new Error('terminal artifact must use active season 2026.');
  }
  const candidates = validateCandidates(rawCandidates);
  const fitRows = array(dataset.periods?.fit?.rows, 'TTO fit rows');
  const validationRows = array(
    dataset.periods?.validation?.rows,
    'TTO validation rows',
  );
  if (fitRows.length === 0 || validationRows.length === 0) {
    throw new Error('TTO evaluation requires fit and validation rows.');
  }
  const identity = identityModel(terminalArtifact);
  const identityFixedMetrics = scoreRows(
    validationRows,
    identity,
    terminalArtifact,
  );
  const identityWalkForward = walkForwardMetrics(
    fitRows,
    validationRows,
    terminalArtifact,
    null,
  );
  const candidateResults = candidates.map((candidate) => {
    const fixedModel = fitExposureModel(
      fitRows,
      terminalArtifact,
      candidate,
    );
    const fixedMetrics = scoreRows(
      validationRows,
      fixedModel,
      terminalArtifact,
    );
    const walkForward = walkForwardMetrics(
      fitRows,
      validationRows,
      terminalArtifact,
      candidate,
    );
    return Object.freeze({
      candidate,
      fixedMetrics,
      walkForwardMetrics: walkForward.metrics,
      walkForwardFolds: walkForward.folds,
    });
  });
  const points = [
    Object.freeze({
      candidateId: 'identity',
      equivalentPa: Number.POSITIVE_INFINITY,
      fixedMetrics: identityFixedMetrics,
      walkForwardMetrics: identityWalkForward.metrics,
    }),
    ...candidateResults.map((result) =>
      Object.freeze({
        candidateId: result.candidate.candidateId,
        equivalentPa: result.candidate.equivalentPa,
        fixedMetrics: result.fixedMetrics,
        walkForwardMetrics: result.walkForwardMetrics,
      }),
    ),
  ];
  const selection = selectCandidate(points);
  const selectedCandidate = candidates.find(
    (candidate) => candidate.candidateId === selection.selectedCandidateId,
  );
  const finalModel =
    selection.selectedCandidateId === null ||
    selection.selectedCandidateId === 'identity'
      ? identity
      : fitExposureModel(
          [...fitRows, ...validationRows],
          terminalArtifact,
          selectedCandidate,
        );
  const identityRecord = {
    evaluationVersion: 1,
    candidateSetVersion:
      M8_5_TIMES_THROUGH_ORDER_CANDIDATE_SET_VERSION,
    mathSpecVersion: '1.7',
    modelFamily: 'm8-5-starter-times-through-order-terminal-residual',
    status:
      selection.selectedCandidateId === null
        ? 'times-through-order-no-common-nondominated-candidate'
        : selection.selectedCandidateId === 'identity'
          ? 'times-through-order-identity-retained'
          : 'times-through-order-candidate-selected',
    activeSeason: 2026,
    sourceDatasetSha256: dataset.datasetSha256,
    sourceTerminalArtifactSha256: terminalArtifact.artifactSha256,
    fitWindow: Object.freeze({
      startDate: dataset.periods.fit.startDate,
      endDate: dataset.periods.fit.endDate,
      observationCount: fitRows.length,
    }),
    validationWindow: Object.freeze({
      startDate: dataset.periods.validation.startDate,
      endDate: dataset.periods.validation.endDate,
      observationCount: validationRows.length,
    }),
    candidates,
    identityFixedMetrics,
    identityWalkForwardMetrics: identityWalkForward.metrics,
    candidateResults: Object.freeze(candidateResults),
    fixedNondominatedCandidateIds:
      selection.fixedNondominatedCandidateIds,
    walkForwardNondominatedCandidateIds:
      selection.walkForwardNondominatedCandidateIds,
    stableCandidateIds: selection.stableCandidateIds,
    selectedCandidateId: selection.selectedCandidateId,
    decision: selection.decision,
    finalModel,
    invariants: Object.freeze({
      selectedSideInputUsed: false,
      directProbabilityAdjustmentUsed: false,
      firstExposureIsIdentity: true,
      starterOnly: true,
      bullpenRowsModeled: false,
      starterBullpenTransitionChanged: false,
      validationRowsUsedForCandidateFit: false,
      validationRowsUsedForFinalFrozenFit: true,
    }),
    untouchedTestReservation: Object.freeze({ rowsIncluded: false }),
  };
  return Object.freeze({
    ...identityRecord,
    evaluationSha256: sha256(
      JSON.stringify(evaluationIdentity(identityRecord)),
    ),
  });
}
