import { createHash } from 'node:crypto';

import { verifyM8StarterRetentionDataset } from './m8-starter-retention-dataset-utils.mjs';

const SCORE_FLOOR = 1e-300;
const TOLERANCE = 1e-12;
const TURN_MINIMUM = 1;

function sha256(value) {
  return createHash('sha256').update(value).digest('hex');
}

function assertObject(value, label) {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new TypeError(`${label} must be an object.`);
  }
  return value;
}

function assertArray(value, label) {
  if (!Array.isArray(value)) throw new TypeError(`${label} must be an array.`);
  return value;
}

function assertPositiveInteger(value, label) {
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new TypeError(`${label} must be a positive integer.`);
  }
  return value;
}

function assertNonNegativeInteger(value, label) {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new TypeError(`${label} must be a non-negative integer.`);
  }
  return value;
}

function assertPositiveFinite(value, label) {
  if (!Number.isFinite(value) || value <= 0) {
    throw new TypeError(`${label} must be positive and finite.`);
  }
  return value;
}

function assertNonEmptyString(value, label) {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new TypeError(`${label} must be a non-empty string.`);
  }
  return value.trim();
}

function validateUntouchedReservation(raw, label) {
  const value = assertObject(raw, label);
  if (value.rowsIncluded !== false || Object.hasOwn(value, 'rows')) {
    throw new Error(`${label} must keep untouched-test rows sealed.`);
  }
  return Object.freeze({ ...value, rowsIncluded: false });
}

const GROUPINGS = Object.freeze(['side', 'slot', 'slot-side']);
const POOLING_STRENGTHS = Object.freeze([10, 50, 200]);

export const DEFAULT_M8_STARTER_RETENTION_CANDIDATES = Object.freeze([
  Object.freeze({
    candidateId: 'no-retention-slot-turns',
    kind: 'no-retention',
    grouping: 'none',
    leagueEquivalentRisk: null,
  }),
  Object.freeze({
    candidateId: 'retention-league-turn',
    kind: 'retention',
    grouping: 'league',
    leagueEquivalentRisk: 0,
  }),
  ...GROUPINGS.flatMap((grouping) =>
    POOLING_STRENGTHS.map((leagueEquivalentRisk) =>
      Object.freeze({
        candidateId: `retention-${grouping}-pool-${leagueEquivalentRisk}`,
        kind: 'retention',
        grouping,
        leagueEquivalentRisk,
      }),
    ),
  ),
]);

function validateCandidates(rawCandidates) {
  const candidates = assertArray(rawCandidates, 'starter retention candidates').map(
    (raw, index) => {
      const candidate = assertObject(raw, `candidate[${index}]`);
      const candidateId = assertNonEmptyString(
        candidate.candidateId,
        `candidate[${index}].candidateId`,
      );
      if (candidate.kind === 'no-retention') {
        if (candidateId !== 'no-retention-slot-turns') {
          throw new Error('no-retention baseline must use the canonical candidate ID.');
        }
        return Object.freeze({
          candidateId,
          kind: 'no-retention',
          grouping: 'none',
          leagueEquivalentRisk: null,
        });
      }
      if (candidate.kind !== 'retention') {
        throw new Error(`${candidateId} has unsupported kind.`);
      }
      if (!['league', ...GROUPINGS].includes(candidate.grouping)) {
        throw new Error(`${candidateId} has unsupported grouping.`);
      }
      const leagueEquivalentRisk =
        candidate.grouping === 'league'
          ? 0
          : assertPositiveFinite(
              candidate.leagueEquivalentRisk,
              `${candidateId}.leagueEquivalentRisk`,
            );
      return Object.freeze({
        candidateId,
        kind: 'retention',
        grouping: candidate.grouping,
        leagueEquivalentRisk,
      });
    },
  );
  if (new Set(candidates.map((candidate) => candidate.candidateId)).size !== candidates.length) {
    throw new Error('starter retention candidate IDs must be unique.');
  }
  if (candidates.filter((candidate) => candidate.kind === 'no-retention').length !== 1) {
    throw new Error('starter retention candidates require exactly one no-retention baseline.');
  }
  return Object.freeze(candidates);
}

function validateRow(raw, label) {
  const row = assertObject(raw, label);
  const side = assertNonEmptyString(row.side, `${label}.side`);
  if (side !== 'home' && side !== 'away') {
    throw new Error(`${label}.side must be home or away.`);
  }
  const lineupSlot = assertPositiveInteger(row.lineupSlot, `${label}.lineupSlot`);
  if (lineupSlot > 9) throw new Error(`${label}.lineupSlot must be at most 9.`);
  const slotTurns = assertPositiveInteger(row.slotTurns, `${label}.slotTurns`);
  const starterPlateAppearances = assertPositiveInteger(
    row.starterPlateAppearances,
    `${label}.starterPlateAppearances`,
  );
  if (starterPlateAppearances > slotTurns) {
    throw new Error(`${label} starter PA exceeds slot turns.`);
  }
  const substituted = row.substituted === true;
  if (substituted !== (starterPlateAppearances < slotTurns)) {
    throw new Error(`${label}.substituted disagrees with observed counts.`);
  }
  return Object.freeze({
    rowId: assertNonEmptyString(row.rowId, `${label}.rowId`),
    observedDate: assertNonEmptyString(row.observedDate, `${label}.observedDate`),
    gameId: assertPositiveInteger(row.gameId, `${label}.gameId`),
    side,
    lineupSlot,
    slotTurns,
    starterPlateAppearances,
    substituted,
  });
}

function periodRows(dataset, periodId) {
  const period = assertObject(dataset.periods?.[periodId], `periods.${periodId}`);
  const rows = assertArray(period.rows, `periods.${periodId}.rows`).map((row, index) =>
    validateRow(row, `${periodId}.rows[${index}]`),
  );
  if (period.rowCount !== rows.length) {
    throw new Error(`${periodId}.rowCount does not match rows.`);
  }
  if (rows.length === 0) throw new Error(`${periodId} must contain rows.`);
  return Object.freeze(rows);
}

function groupKey(row, grouping) {
  switch (grouping) {
    case 'league':
      return 'league';
    case 'side':
      return row.side;
    case 'slot':
      return `slot:${row.lineupSlot}`;
    case 'slot-side':
      return `${row.side}:slot:${row.lineupSlot}`;
    default:
      throw new Error(`unsupported starter retention grouping ${grouping}.`);
  }
}

function emptyTurnStats(turnMaximum) {
  return Array.from({ length: turnMaximum + 1 }, () => ({ risk: 0, retained: 0 }));
}

function addRowToStats(stats, row) {
  for (let turn = TURN_MINIMUM; turn <= row.slotTurns; turn += 1) {
    if (row.starterPlateAppearances < turn - 1) continue;
    stats[turn].risk += 1;
    if (row.starterPlateAppearances >= turn) stats[turn].retained += 1;
  }
}

function freezeTurnStats(stats) {
  return Object.freeze(
    stats.map((value, turn) =>
      Object.freeze({ turn, risk: value.risk, retained: value.retained }),
    ),
  );
}

function fitCandidate(rows, candidate, turnMaximum) {
  if (candidate.kind === 'no-retention') {
    return Object.freeze({
      candidate,
      turnMaximum,
      leagueTurnStats: Object.freeze([]),
      groupTurnStats: Object.freeze({}),
    });
  }
  const league = emptyTurnStats(turnMaximum);
  const groups = new Map();
  for (const row of rows) {
    addRowToStats(league, row);
    const key = groupKey(row, candidate.grouping);
    const stats = groups.get(key) ?? emptyTurnStats(turnMaximum);
    addRowToStats(stats, row);
    groups.set(key, stats);
  }
  for (let turn = 1; turn <= turnMaximum; turn += 1) {
    if (league[turn].risk === 0) {
      throw new Error(`starter retention has no current-season risk set for turn ${turn}.`);
    }
    if (turn === 1 && league[turn].retained !== league[turn].risk) {
      throw new Error('first-turn starter retention must be exact for every fitted row.');
    }
  }
  return Object.freeze({
    candidate,
    turnMaximum,
    leagueTurnStats: freezeTurnStats(league),
    groupTurnStats: Object.freeze(
      Object.fromEntries(
        [...groups.entries()]
          .sort(([left], [right]) => left.localeCompare(right))
          .map(([key, stats]) => [key, freezeTurnStats(stats)]),
      ),
    ),
  });
}

function conditionalRetention(model, row, turn) {
  if (model.candidate.kind === 'no-retention') return 1;
  const league = model.leagueTurnStats[turn];
  if (league === undefined || league.risk === 0) {
    throw new Error(`missing league retention risk for turn ${turn}.`);
  }
  const leagueRate = league.retained / league.risk;
  if (model.candidate.grouping === 'league') return leagueRate;
  const key = groupKey(row, model.candidate.grouping);
  const group = model.groupTurnStats[key]?.[turn] ?? { risk: 0, retained: 0 };
  const strength = model.candidate.leagueEquivalentRisk;
  return (group.retained + strength * leagueRate) / (group.risk + strength);
}

function countDistribution(model, row) {
  let cumulative = 1;
  const survival = [];
  for (let turn = 1; turn <= row.slotTurns; turn += 1) {
    const probability = conditionalRetention(model, row, turn);
    if (!Number.isFinite(probability) || probability < 0 || probability > 1) {
      throw new Error(`invalid starter retention probability at turn ${turn}.`);
    }
    cumulative *= probability;
    survival.push(cumulative);
  }
  for (let index = 1; index < survival.length; index += 1) {
    if (survival[index] > survival[index - 1] + TOLERANCE) {
      throw new Error('starter retention survival must be monotone by construction.');
    }
  }
  const pmf = Array(row.slotTurns + 1).fill(0);
  pmf[0] = 1 - survival[0];
  for (let count = 1; count < row.slotTurns; count += 1) {
    pmf[count] = survival[count - 1] - survival[count];
  }
  pmf[row.slotTurns] = survival[row.slotTurns - 1];
  const total = pmf.reduce((sum, value) => sum + value, 0);
  if (Math.abs(total - 1) > TOLERANCE || pmf.some((value) => value < -TOLERANCE)) {
    throw new Error('starter retention count distribution is invalid.');
  }
  return Object.freeze({
    pmf: Object.freeze(pmf),
    survival: Object.freeze(survival),
  });
}

function metricAccumulator() {
  return { count: 0, logLoss: 0, brier: 0, predictedMean: 0, observedMean: 0 };
}

function addMetric(accumulator, row, prediction, supportMaximum) {
  const actual = row.starterPlateAppearances;
  const actualProbability = prediction.pmf[actual] ?? 0;
  accumulator.count += 1;
  accumulator.logLoss += -Math.log(Math.max(actualProbability, SCORE_FLOOR));
  let brier = 0;
  for (let count = 0; count <= supportMaximum; count += 1) {
    const predicted = prediction.pmf[count] ?? 0;
    const target = count === actual ? 1 : 0;
    brier += (predicted - target) ** 2;
  }
  accumulator.brier += brier;
  accumulator.predictedMean += prediction.pmf.reduce(
    (sum, probability, count) => sum + probability * count,
    0,
  );
  accumulator.observedMean += actual;
}

function finalizeMetric(accumulator) {
  if (accumulator.count === 0) return null;
  return Object.freeze({
    observationCount: accumulator.count,
    logLoss: accumulator.logLoss / accumulator.count,
    multiclassBrier: accumulator.brier / accumulator.count,
    predictedMeanPlateAppearances: accumulator.predictedMean / accumulator.count,
    observedMeanPlateAppearances: accumulator.observedMean / accumulator.count,
  });
}

function evaluateRows(rows, model, supportMaximum) {
  const overall = metricAccumulator();
  const bySlot = Object.fromEntries(
    Array.from({ length: 9 }, (_, index) => [index + 1, metricAccumulator()]),
  );
  const bySide = { away: metricAccumulator(), home: metricAccumulator() };
  const bySubstitution = {
    substituted: metricAccumulator(),
    notSubstituted: metricAccumulator(),
  };
  const tail = Object.fromEntries(
    Array.from({ length: supportMaximum }, (_, index) => [
      index + 1,
      { observationCount: 0, predicted: 0, observed: 0 },
    ]),
  );
  const observationIds = [];
  for (const row of rows) {
    const prediction = countDistribution(model, row);
    addMetric(overall, row, prediction, supportMaximum);
    addMetric(bySlot[row.lineupSlot], row, prediction, supportMaximum);
    addMetric(bySide[row.side], row, prediction, supportMaximum);
    addMetric(
      bySubstitution[row.substituted ? 'substituted' : 'notSubstituted'],
      row,
      prediction,
      supportMaximum,
    );
    for (let turn = 1; turn <= supportMaximum; turn += 1) {
      const report = tail[turn];
      report.observationCount += 1;
      report.predicted += prediction.survival[turn - 1] ?? 0;
      report.observed += row.starterPlateAppearances >= turn ? 1 : 0;
    }
    observationIds.push(row.rowId);
  }
  return Object.freeze({
    overall: finalizeMetric(overall),
    bySlot: Object.freeze(
      Object.fromEntries(
        Object.entries(bySlot).map(([key, value]) => [key, finalizeMetric(value)]),
      ),
    ),
    bySide: Object.freeze(
      Object.fromEntries(
        Object.entries(bySide).map(([key, value]) => [key, finalizeMetric(value)]),
      ),
    ),
    bySubstitution: Object.freeze(
      Object.fromEntries(
        Object.entries(bySubstitution).map(([key, value]) => [key, finalizeMetric(value)]),
      ),
    ),
    survivalReliability: Object.freeze(
      Object.fromEntries(
        Object.entries(tail).map(([turn, report]) => [
          turn,
          Object.freeze({
            observationCount: report.observationCount,
            meanPredictedSurvival: report.predicted / report.observationCount,
            observedSurvivalRate: report.observed / report.observationCount,
          }),
        ]),
      ),
    ),
    observationIdsSha256: sha256(JSON.stringify(observationIds)),
  });
}

function rankResults(results) {
  return [...results].sort(
    (left, right) =>
      left.metrics.overall.logLoss - right.metrics.overall.logLoss ||
      left.metrics.overall.multiclassBrier - right.metrics.overall.multiclassBrier ||
      left.candidate.candidateId.localeCompare(right.candidate.candidateId),
  );
}

function walkForward({ fitRows, validationRows, candidates, supportMaximum }) {
  const dates = [...new Set(validationRows.map((row) => row.observedDate))].sort();
  const aggregates = new Map(
    candidates.map((candidate) => [candidate.candidateId, metricAccumulator()]),
  );
  const foldSelections = [];
  const candidateObservationIds = new Map(
    candidates.map((candidate) => [candidate.candidateId, []]),
  );
  for (const date of dates) {
    const training = [
      ...fitRows,
      ...validationRows.filter((row) => row.observedDate < date),
    ];
    const foldRows = validationRows.filter((row) => row.observedDate === date);
    const foldResults = candidates.map((candidate) => {
      const model = fitCandidate(training, candidate, supportMaximum);
      const metrics = evaluateRows(foldRows, model, supportMaximum);
      const accumulator = aggregates.get(candidate.candidateId);
      for (const row of foldRows) {
        const prediction = countDistribution(model, row);
        addMetric(accumulator, row, prediction, supportMaximum);
        candidateObservationIds.get(candidate.candidateId).push(row.rowId);
      }
      return Object.freeze({ candidate, metrics });
    });
    foldSelections.push(
      Object.freeze({
        validationDate: date,
        observationCount: foldRows.length,
        selectedCandidateId: rankResults(foldResults)[0].candidate.candidateId,
      }),
    );
  }
  const aggregateResults = candidates.map((candidate) =>
    Object.freeze({
      candidate,
      metrics: Object.freeze({
        overall: finalizeMetric(aggregates.get(candidate.candidateId)),
        observationIdsSha256: sha256(
          JSON.stringify(candidateObservationIds.get(candidate.candidateId)),
        ),
      }),
    }),
  );
  const ranked = rankResults(aggregateResults);
  return Object.freeze({
    foldCount: dates.length,
    folds: Object.freeze(foldSelections),
    aggregateResults: Object.freeze(aggregateResults),
    selectedCandidateId: ranked[0].candidate.candidateId,
  });
}

function serializeModel(model) {
  return Object.freeze({
    candidate: model.candidate,
    turnMaximum: model.turnMaximum,
    leagueTurnStats: model.leagueTurnStats,
    groupTurnStats: model.groupTurnStats,
  });
}

export function evaluateM8StarterRetention({
  rawDataset,
  datasetText,
  candidates: rawCandidates = DEFAULT_M8_STARTER_RETENTION_CANDIDATES,
}) {
  const dataset = verifyM8StarterRetentionDataset(rawDataset);
  const sourceText = assertNonEmptyString(datasetText, 'datasetText');
  const candidates = validateCandidates(rawCandidates);
  const fitRows = periodRows(dataset, 'fit');
  const validationRows = periodRows(dataset, 'validation');
  if (fitRows.at(-1).observedDate >= validationRows[0].observedDate) {
    throw new Error('starter retention fit and validation periods overlap.');
  }
  const supportMaximum = Math.max(
    ...fitRows.map((row) => row.slotTurns),
    ...validationRows.map((row) => row.slotTurns),
  );
  const fixedResults = candidates.map((candidate) => {
    const model = fitCandidate(fitRows, candidate, supportMaximum);
    return Object.freeze({
      candidate,
      metrics: evaluateRows(validationRows, model, supportMaximum),
    });
  });
  const fixedSelectedCandidateId = rankResults(fixedResults)[0].candidate.candidateId;
  const walkForwardResult = walkForward({
    fitRows,
    validationRows,
    candidates,
    supportMaximum,
  });
  const selectionAgreement =
    fixedSelectedCandidateId === walkForwardResult.selectedCandidateId;
  const selectedCandidate = selectionAgreement
    ? candidates.find((candidate) => candidate.candidateId === fixedSelectedCandidateId)
    : null;
  const finalModel =
    selectedCandidate === null
      ? null
      : serializeModel(
          fitCandidate(
            [...fitRows, ...validationRows],
            selectedCandidate,
            supportMaximum,
          ),
        );
  const baselineFixed = fixedResults.find(
    (result) => result.candidate.kind === 'no-retention',
  );
  const selectedFixed = fixedResults.find(
    (result) => result.candidate.candidateId === fixedSelectedCandidateId,
  );
  const selectedBeatsNoRetention =
    selectedFixed.metrics.overall.logLoss < baselineFixed.metrics.overall.logLoss &&
    selectedFixed.metrics.overall.multiclassBrier <
      baselineFixed.metrics.overall.multiclassBrier;

  const identity = {
    evaluationVersion: 1,
    status:
      selectionAgreement && selectedBeatsNoRetention
        ? 'starter-retention-candidate-selected'
        : 'starter-retention-not-selected',
    activeSeason: dataset.activeSeason,
    sourceDatasetSha256: dataset.datasetSha256,
    sourceDatasetFileSha256: sha256(sourceText),
    fitWindow: Object.freeze({
      startDate: fitRows[0].observedDate,
      endDate: fitRows.at(-1).observedDate,
      observationCount: fitRows.length,
    }),
    validationWindow: Object.freeze({
      startDate: validationRows[0].observedDate,
      endDate: validationRows.at(-1).observedDate,
      observationCount: validationRows.length,
    }),
    supportMaximum,
    candidates,
    fixedResults: Object.freeze(fixedResults),
    fixedSelectedCandidateId,
    walkForward: walkForwardResult,
    selectionAgreement,
    selectedBeatsNoRetention,
    selectedCandidate,
    finalModel,
    untouchedTestReservation: validateUntouchedReservation(
      dataset.untouchedTestReservation,
      'evaluation untouchedTestReservation',
    ),
  };
  return Object.freeze({
    purpose:
      'Select one current-season named-starter retention model using later validation and daily expanding walk-forward evaluation, with slot turns preserved separately.',
    ...identity,
    evaluationSha256: sha256(JSON.stringify(identity)),
  });
}

export function verifyM8StarterRetentionEvaluation(rawEvaluation) {
  const evaluation = assertObject(rawEvaluation, 'starter retention evaluation');
  validateUntouchedReservation(
    evaluation.untouchedTestReservation,
    'starter retention evaluation untouchedTestReservation',
  );
  if (evaluation.evaluationVersion !== 1) {
    throw new Error('unsupported starter retention evaluation version.');
  }
  const identity = {
    evaluationVersion: evaluation.evaluationVersion,
    status: evaluation.status,
    activeSeason: evaluation.activeSeason,
    sourceDatasetSha256: evaluation.sourceDatasetSha256,
    sourceDatasetFileSha256: evaluation.sourceDatasetFileSha256,
    fitWindow: evaluation.fitWindow,
    validationWindow: evaluation.validationWindow,
    supportMaximum: evaluation.supportMaximum,
    candidates: evaluation.candidates,
    fixedResults: evaluation.fixedResults,
    fixedSelectedCandidateId: evaluation.fixedSelectedCandidateId,
    walkForward: evaluation.walkForward,
    selectionAgreement: evaluation.selectionAgreement,
    selectedBeatsNoRetention: evaluation.selectedBeatsNoRetention,
    selectedCandidate: evaluation.selectedCandidate,
    finalModel: evaluation.finalModel,
    untouchedTestReservation: evaluation.untouchedTestReservation,
  };
  if (evaluation.evaluationSha256 !== sha256(JSON.stringify(identity))) {
    throw new Error('starter retention evaluation SHA-256 is invalid.');
  }
  return evaluation;
}
