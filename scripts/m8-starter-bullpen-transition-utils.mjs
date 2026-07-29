import { sha256 } from './provider-probe-utils.mjs';

const PERIODS = Object.freeze(['fit', 'validation']);
const SIDES = Object.freeze(['away', 'home']);
const PROBABILITY_FLOOR = 1e-300;
const TOLERANCE = 1e-12;

export const M8_STARTER_BULLPEN_CANDIDATE_SET_VERSION = 'm8-starter-bf-pooling-v2';

export const DEFAULT_M8_STARTER_BULLPEN_CANDIDATES = Object.freeze([
  ...[10, 25, 50, 100, 250, 500, 1000].map((leagueEquivalentGames) =>
    Object.freeze({
      candidateId: `starter-bf-side-pool-${leagueEquivalentGames}`,
      grouping: 'side',
      leagueEquivalentGames,
    }),
  ),
  Object.freeze({ candidateId: 'starter-bf-league', grouping: 'league', leagueEquivalentGames: 0 }),
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

function positiveInteger(value, label) {
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new TypeError(`${label} must be a positive integer.`);
  }
  return value;
}

function nonNegativeInteger(value, label) {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new TypeError(`${label} must be a non-negative integer.`);
  }
  return value;
}

function sideFromHalf(value) {
  const normalized = string(value, 'half inning').toLowerCase();
  if (normalized === 'top') return 'away';
  if (normalized === 'bottom') return 'home';
  throw new Error(`unsupported half inning ${value}.`);
}

function validateDataset(rawDataset) {
  const dataset = object(rawDataset, 'resolved categorical dataset');
  if (dataset.datasetVersion !== 3) throw new Error('resolved categorical datasetVersion must equal 3.');
  if (dataset.untouchedTestReservation?.rowsIncluded !== false) {
    throw new Error('starter-bullpen dataset must keep untouched-test rows sealed.');
  }
  return dataset;
}

function groupedRows(dataset, periodId) {
  const period = object(dataset.periods?.[periodId], `${periodId} period`);
  const groups = new Map();
  for (const rawRow of array(period.rows, `${periodId} rows`)) {
    const row = object(rawRow, 'resolved row');
    const side = sideFromHalf(row.halfInning);
    const gameId = positiveInteger(row.providerGameId, 'game id');
    const date = string(row.observedDate, 'observed date');
    const key = `${date}:${gameId}:${side}`;
    const rows = groups.get(key) ?? [];
    rows.push(row);
    groups.set(key, rows);
  }
  return groups;
}

function recoverTeamSide(periodId, key, rawRows) {
  const rows = [...rawRows].sort(
    (left, right) => left.providerPaNumber - right.providerPaNumber,
  );
  const unresolved = rows.filter((row) => row.mappingStatus === 'unresolved');
  if (unresolved.length > 0) {
    return Object.freeze({ row: null, exclusion: 'unresolved-terminal-row' });
  }
  const terminalRows = rows.filter((row) => row.mappingStatus === 'classified-terminal');
  if (terminalRows.length === 0) {
    return Object.freeze({ row: null, exclusion: 'no-classified-terminal-rows' });
  }
  const starterPitcherId = positiveInteger(
    terminalRows[0].providerPitcherId,
    'starter pitcher id',
  );
  let starterBattersFaced = 0;
  let bullpenStarted = false;
  const bullpenRows = [];
  for (const row of terminalRows) {
    const pitcherId = positiveInteger(row.providerPitcherId, 'pitcher id');
    if (!bullpenStarted && pitcherId === starterPitcherId) {
      starterBattersFaced += 1;
      continue;
    }
    bullpenStarted = true;
    if (pitcherId === starterPitcherId) {
      return Object.freeze({ row: null, exclusion: 'starter-reappeared-after-bullpen' });
    }
    bullpenRows.push(row);
  }
  const totalBattersFaced = terminalRows.length;
  const bullpenBattersFaced = bullpenRows.length;
  if (starterBattersFaced + bullpenBattersFaced !== totalBattersFaced) {
    throw new Error('starter and bullpen batters faced do not conserve team plate appearances.');
  }
  const [observedDate, gameIdText, side] = key.split(':');
  return Object.freeze({
    row: Object.freeze({
      rowId: `${periodId}:${key}`,
      periodId,
      observedDate,
      gameId: positiveInteger(Number(gameIdText), 'game id'),
      side,
      starterPitcherId,
      starterBattersFaced,
      bullpenBattersFaced,
      totalBattersFaced,
      bullpenRows: Object.freeze(
        bullpenRows.map((row) =>
          Object.freeze({
            providerPitcherId: row.providerPitcherId,
            normalizedPitcherHand: row.normalizedPitcherHand,
            normalizedBatterSide: row.normalizedBatterSide,
            terminalCategory: row.terminalCategory,
          }),
        ),
      ),
    }),
    exclusion: null,
  });
}

export function buildM8StarterBullpenDataset(rawDataset) {
  const dataset = validateDataset(rawDataset);
  const periods = {};
  const exclusions = {};
  let included = 0;
  let excluded = 0;
  for (const periodId of PERIODS) {
    const rows = [];
    for (const [key, group] of groupedRows(dataset, periodId)) {
      const recovered = recoverTeamSide(periodId, key, group);
      if (recovered.row === null) {
        excluded += 1;
        exclusions[recovered.exclusion] = (exclusions[recovered.exclusion] ?? 0) + 1;
      } else {
        rows.push(recovered.row);
        included += 1;
      }
    }
    rows.sort(
      (left, right) =>
        left.observedDate.localeCompare(right.observedDate) ||
        left.gameId - right.gameId ||
        left.side.localeCompare(right.side),
    );
    periods[periodId] = Object.freeze({
      startDate: rows[0]?.observedDate ?? null,
      endDate: rows.at(-1)?.observedDate ?? null,
      rowCount: rows.length,
      rows: Object.freeze(rows),
    });
  }
  if (periods.fit.rowCount === 0 || periods.validation.rowCount === 0) {
    throw new Error('starter-bullpen dataset requires fit and validation rows.');
  }
  if (periods.fit.endDate >= periods.validation.startDate) {
    throw new Error('starter-bullpen periods overlap.');
  }
  const identity = {
    datasetVersion: 1,
    activeSeason: positiveInteger(dataset.activeSeason, 'active season'),
    sourceResolvedDatasetSha256: string(dataset.datasetSha256, 'source dataset SHA-256'),
    includedPeriods: PERIODS,
    periods: Object.freeze(periods),
    totals: Object.freeze({ includedTeamGameCount: included, excludedTeamGameCount: excluded }),
    exclusionReasonCounts: Object.freeze(Object.fromEntries(Object.entries(exclusions).sort())),
    untouchedTestReservation: Object.freeze({ ...dataset.untouchedTestReservation, rowsIncluded: false }),
  };
  return Object.freeze({
    purpose: 'Recover the opposing starter batters-faced block and bullpen transition from current-season terminal PA order while conserving every team plate appearance.',
    ...identity,
    datasetSha256: sha256(JSON.stringify(identity)),
  });
}

function supportMaximum(rows) {
  return Math.max(...rows.map((row) => row.starterBattersFaced));
}

function countVector(rows, maximum) {
  const counts = Array(maximum + 1).fill(0);
  for (const row of rows) counts[row.starterBattersFaced] += 1;
  return counts;
}

function normalizeCounts(counts, label) {
  const total = counts.reduce((sum, value) => sum + value, 0);
  if (!(total > 0)) throw new Error(`${label} has no observations.`);
  return Object.freeze(counts.map((value) => value / total));
}

function fitCandidate(rows, candidate, maximum) {
  const leagueCounts = countVector(rows, maximum);
  const league = normalizeCounts(leagueCounts, 'league starter BF');
  if (candidate.grouping === 'league') {
    return Object.freeze({ candidate, maximum, league, bySide: Object.freeze({ away: league, home: league }) });
  }
  const bySide = {};
  for (const side of SIDES) {
    const sideCounts = countVector(rows.filter((row) => row.side === side), maximum);
    const total = sideCounts.reduce((sum, value) => sum + value, 0);
    const pooled = sideCounts.map(
      (value, count) => value + candidate.leagueEquivalentGames * league[count],
    );
    if (total === 0) throw new Error(`starter BF fit has no ${side} rows.`);
    bySide[side] = normalizeCounts(pooled, `${side} starter BF`);
  }
  return Object.freeze({ candidate, maximum, league, bySide: Object.freeze(bySide) });
}

function probabilityFor(model, row) {
  const distribution = model.bySide[row.side];
  return distribution[row.starterBattersFaced] ?? 0;
}

function metrics(rows, model) {
  let logLoss = 0;
  let brier = 0;
  let predictedMean = 0;
  let observedMean = 0;
  const ids = [];
  for (const row of rows) {
    const distribution = model.bySide[row.side];
    const probability = Math.max(probabilityFor(model, row), PROBABILITY_FLOOR);
    logLoss += -Math.log(probability);
    observedMean += row.starterBattersFaced;
    ids.push(row.rowId);
    for (let count = 0; count < distribution.length; count += 1) {
      const target = count === row.starterBattersFaced ? 1 : 0;
      brier += (distribution[count] - target) ** 2;
      predictedMean += distribution[count] * count;
    }
  }
  return Object.freeze({
    observationCount: rows.length,
    logLoss: logLoss / rows.length,
    multiclassBrier: brier / rows.length,
    predictedMeanBattersFaced: predictedMean / rows.length,
    observedMeanBattersFaced: observedMean / rows.length,
    observationIdsSha256: sha256(JSON.stringify(ids)),
  });
}

function rank(results) {
  return [...results].sort(
    (left, right) =>
      left.metrics.logLoss - right.metrics.logLoss ||
      left.metrics.multiclassBrier - right.metrics.multiclassBrier ||
      left.candidate.candidateId.localeCompare(right.candidate.candidateId),
  );
}

function poolingStrength(candidate) {
  const value = object(candidate, 'starter-bullpen candidate');
  const grouping = string(value.grouping, 'starter-bullpen candidate grouping');
  if (grouping === 'league') return Number.POSITIVE_INFINITY;
  if (grouping === 'side') {
    return positiveInteger(value.leagueEquivalentGames, 'starter-bullpen league-equivalent games');
  }
  throw new Error(`unsupported starter-bullpen candidate grouping ${grouping}.`);
}

function validatedCandidateResults(rawResults, label) {
  const seen = new Set();
  return array(rawResults, label).map((rawResult) => {
    const result = object(rawResult, `${label} result`);
    const candidate = object(result.candidate, `${label} candidate`);
    const candidateId = string(candidate.candidateId, `${label} candidate id`);
    if (seen.has(candidateId)) throw new Error(`${label} contains duplicate candidate ${candidateId}.`);
    seen.add(candidateId);
    const resultMetrics = object(result.metrics, `${label} metrics`);
    if (!Number.isFinite(resultMetrics.logLoss) || !Number.isFinite(resultMetrics.multiclassBrier)) {
      throw new Error(`${label} candidate ${candidateId} has invalid proper-score metrics.`);
    }
    return result;
  });
}

function dominates(left, right) {
  const noWorse =
    left.metrics.logLoss <= right.metrics.logLoss &&
    left.metrics.multiclassBrier <= right.metrics.multiclassBrier;
  const strictlyBetter =
    left.metrics.logLoss < right.metrics.logLoss ||
    left.metrics.multiclassBrier < right.metrics.multiclassBrier;
  return noWorse && strictlyBetter;
}

export function computeM8StarterBullpenNondominatedCandidateIds(rawResults) {
  const results = validatedCandidateResults(rawResults, 'starter-bullpen candidate results');
  return Object.freeze(
    results
      .filter(
        (candidateResult, candidateIndex) =>
          !results.some(
            (otherResult, otherIndex) =>
              otherIndex !== candidateIndex && dominates(otherResult, candidateResult),
          ),
      )
      .map((result) => result.candidate.candidateId),
  );
}

export function selectM8StarterBullpenCandidate({ fixedResults, walkForwardResults }) {
  const fixed = validatedCandidateResults(fixedResults, 'fixed starter-bullpen results');
  const walkForward = validatedCandidateResults(
    walkForwardResults,
    'walk-forward starter-bullpen results',
  );
  const fixedById = new Map(fixed.map((result) => [result.candidate.candidateId, result]));
  const walkIds = new Set(walkForward.map((result) => result.candidate.candidateId));
  if (fixedById.size !== walkIds.size || [...fixedById.keys()].some((id) => !walkIds.has(id))) {
    throw new Error('fixed and walk-forward starter-bullpen candidate sets differ.');
  }
  const fixedNondominatedCandidateIds = computeM8StarterBullpenNondominatedCandidateIds(fixed);
  const walkForwardNondominatedCandidateIds =
    computeM8StarterBullpenNondominatedCandidateIds(walkForward);
  const walkForwardNondominated = new Set(walkForwardNondominatedCandidateIds);
  const admissibleCandidateIds = Object.freeze(
    fixedNondominatedCandidateIds.filter((candidateId) =>
      walkForwardNondominated.has(candidateId),
    ),
  );
  const selectedCandidateId =
    [...admissibleCandidateIds].sort((leftId, rightId) => {
      const leftStrength = poolingStrength(fixedById.get(leftId).candidate);
      const rightStrength = poolingStrength(fixedById.get(rightId).candidate);
      if (leftStrength !== rightStrength) return leftStrength > rightStrength ? -1 : 1;
      return leftId.localeCompare(rightId);
    })[0] ?? null;
  return Object.freeze({
    fixedNondominatedCandidateIds,
    walkForwardNondominatedCandidateIds,
    admissibleCandidateIds,
    stable: selectedCandidateId !== null,
    reason: selectedCandidateId === null ? 'EMPTY_ADMISSIBLE_SET' : null,
    selectedCandidateId,
  });
}

function walkForward(fitRows, validationRows, candidates, maximum) {
  const dates = [...new Set(validationRows.map((row) => row.observedDate))].sort();
  const accumulators = new Map(
    candidates.map((candidate) => [candidate.candidateId, []]),
  );
  const folds = [];
  for (const date of dates) {
    const training = [...fitRows, ...validationRows.filter((row) => row.observedDate < date)];
    const foldRows = validationRows.filter((row) => row.observedDate === date);
    const foldResults = candidates.map((candidate) => {
      const model = fitCandidate(training, candidate, maximum);
      const result = Object.freeze({ candidate, metrics: metrics(foldRows, model) });
      accumulators.get(candidate.candidateId).push(...foldRows.map((row) => ({ row, model })));
      return result;
    });
    folds.push(
      Object.freeze({
        validationDate: date,
        observationCount: foldRows.length,
        selectedCandidateId: rank(foldResults)[0].candidate.candidateId,
      }),
    );
  }
  const aggregateResults = candidates.map((candidate) => {
    const scored = accumulators.get(candidate.candidateId);
    let logLoss = 0;
    let brier = 0;
    let predictedMean = 0;
    let observedMean = 0;
    const ids = [];
    for (const { row, model } of scored) {
      const distribution = model.bySide[row.side];
      logLoss += -Math.log(Math.max(probabilityFor(model, row), PROBABILITY_FLOOR));
      observedMean += row.starterBattersFaced;
      ids.push(row.rowId);
      for (let count = 0; count < distribution.length; count += 1) {
        const target = count === row.starterBattersFaced ? 1 : 0;
        brier += (distribution[count] - target) ** 2;
        predictedMean += distribution[count] * count;
      }
    }
    return Object.freeze({
      candidate,
      metrics: Object.freeze({
        observationCount: scored.length,
        logLoss: logLoss / scored.length,
        multiclassBrier: brier / scored.length,
        predictedMeanBattersFaced: predictedMean / scored.length,
        observedMeanBattersFaced: observedMean / scored.length,
        observationIdsSha256: sha256(JSON.stringify(ids)),
      }),
    });
  });
  return Object.freeze({
    foldCount: folds.length,
    folds: Object.freeze(folds),
    aggregateResults: Object.freeze(aggregateResults),
    selectedCandidateId: rank(aggregateResults)[0].candidate.candidateId,
  });
}

function evaluationIdentity(value) {
  return {
    evaluationVersion: value.evaluationVersion,
    candidateSetVersion: value.candidateSetVersion,
    mathSpecVersion: value.mathSpecVersion,
    status: value.status,
    activeSeason: value.activeSeason,
    sourceDatasetSha256: value.sourceDatasetSha256,
    fitWindow: value.fitWindow,
    validationWindow: value.validationWindow,
    supportMaximum: value.supportMaximum,
    candidates: value.candidates,
    fixedResults: value.fixedResults,
    fixedSelectedCandidateId: value.fixedSelectedCandidateId,
    walkForward: value.walkForward,
    fixedNondominatedCandidateIds: value.fixedNondominatedCandidateIds,
    walkForwardNondominatedCandidateIds: value.walkForwardNondominatedCandidateIds,
    admissibleCandidateIds: value.admissibleCandidateIds,
    stableSelection: value.stableSelection,
    selectionReason: value.selectionReason,
    selectedCandidateId: value.selectedCandidateId,
    finalModel: value.finalModel,
    untouchedTestReservation: value.untouchedTestReservation,
  };
}

export function evaluateM8StarterBullpenTransition({ rawDataset, candidates = DEFAULT_M8_STARTER_BULLPEN_CANDIDATES }) {
  const dataset = object(rawDataset, 'starter-bullpen dataset');
  if (dataset.datasetSha256 !== sha256(JSON.stringify({
    datasetVersion: dataset.datasetVersion,
    activeSeason: dataset.activeSeason,
    sourceResolvedDatasetSha256: dataset.sourceResolvedDatasetSha256,
    includedPeriods: dataset.includedPeriods,
    periods: dataset.periods,
    totals: dataset.totals,
    exclusionReasonCounts: dataset.exclusionReasonCounts,
    untouchedTestReservation: dataset.untouchedTestReservation,
  }))) {
    throw new Error('starter-bullpen dataset SHA-256 is invalid.');
  }
  const fitRows = dataset.periods.fit.rows;
  const validationRows = dataset.periods.validation.rows;
  const maximum = Math.max(supportMaximum(fitRows), supportMaximum(validationRows));
  const fixedResults = candidates.map((candidate) => {
    const model = fitCandidate(fitRows, candidate, maximum);
    return Object.freeze({ candidate, metrics: metrics(validationRows, model) });
  });
  const fixedSelectedCandidateId = rank(fixedResults)[0].candidate.candidateId;
  const walkForwardResult = walkForward(fitRows, validationRows, candidates, maximum);
  const selection = selectM8StarterBullpenCandidate({
    fixedResults,
    walkForwardResults: walkForwardResult.aggregateResults,
  });
  const selectedCandidate =
    selection.selectedCandidateId === null
      ? null
      : candidates.find(
          (candidate) => candidate.candidateId === selection.selectedCandidateId,
        );
  if (selection.selectedCandidateId !== null && selectedCandidate === undefined) {
    throw new Error('selected starter-bullpen candidate is missing from the candidate set.');
  }
  const finalModel =
    selectedCandidate === null
      ? null
      : fitCandidate([...fitRows, ...validationRows], selectedCandidate, maximum);
  const identity = {
    evaluationVersion: 2,
    candidateSetVersion: M8_STARTER_BULLPEN_CANDIDATE_SET_VERSION,
    mathSpecVersion: '1.5',
    status: selection.stable
      ? 'starter-bullpen-candidate-selected'
      : 'starter-bullpen-no-common-nondominated-candidate',
    activeSeason: dataset.activeSeason,
    sourceDatasetSha256: dataset.datasetSha256,
    fitWindow: Object.freeze({ startDate: dataset.periods.fit.startDate, endDate: dataset.periods.fit.endDate, observationCount: fitRows.length }),
    validationWindow: Object.freeze({ startDate: dataset.periods.validation.startDate, endDate: dataset.periods.validation.endDate, observationCount: validationRows.length }),
    supportMaximum: maximum,
    candidates,
    fixedResults: Object.freeze(fixedResults),
    fixedSelectedCandidateId,
    walkForward: walkForwardResult,
    fixedNondominatedCandidateIds: selection.fixedNondominatedCandidateIds,
    walkForwardNondominatedCandidateIds: selection.walkForwardNondominatedCandidateIds,
    admissibleCandidateIds: selection.admissibleCandidateIds,
    stableSelection: selection.stable,
    selectionReason: selection.reason,
    selectedCandidateId: selection.selectedCandidateId,
    finalModel,
    untouchedTestReservation: dataset.untouchedTestReservation,
  };
  return Object.freeze({
    purpose: 'Select a current-season opposing-starter batters-faced distribution before the bullpen transition, using fixed validation and daily expanding walk-forward evaluation.',
    ...identity,
    evaluationSha256: sha256(JSON.stringify(evaluationIdentity(identity))),
  });
}

export function verifyM8StarterBullpenEvaluation(rawEvaluation) {
  const evaluation = object(rawEvaluation, 'starter-bullpen evaluation');
  if (
    evaluation.evaluationVersion !== 2 ||
    evaluation.candidateSetVersion !== M8_STARTER_BULLPEN_CANDIDATE_SET_VERSION ||
    evaluation.mathSpecVersion !== '1.5' ||
    evaluation.stableSelection !== true ||
    evaluation.selectedCandidateId === null ||
    evaluation.finalModel === null
  ) {
    throw new Error(
      `starter-bullpen evaluation did not select one stable model: ${evaluation.selectionReason ?? 'INVALID_SELECTION'}`,
    );
  }
  const recomputed = selectM8StarterBullpenCandidate({
    fixedResults: evaluation.fixedResults,
    walkForwardResults: evaluation.walkForward?.aggregateResults,
  });
  for (const field of [
    'fixedNondominatedCandidateIds',
    'walkForwardNondominatedCandidateIds',
    'admissibleCandidateIds',
  ]) {
    if (JSON.stringify(evaluation[field]) !== JSON.stringify(recomputed[field])) {
      throw new Error(`starter-bullpen ${field} is inconsistent with the proper-score results.`);
    }
  }
  if (
    recomputed.selectedCandidateId !== evaluation.selectedCandidateId ||
    evaluation.finalModel.candidate?.candidateId !== evaluation.selectedCandidateId
  ) {
    throw new Error('starter-bullpen selected candidate is inconsistent with the final model.');
  }
  if (evaluation.untouchedTestReservation?.rowsIncluded !== false) {
    throw new Error('starter-bullpen evaluation exposes untouched-test rows.');
  }
  if (evaluation.evaluationSha256 !== sha256(JSON.stringify(evaluationIdentity(evaluation)))) {
    throw new Error('starter-bullpen evaluation SHA-256 is invalid.');
  }
  for (const side of SIDES) {
    const distribution = array(evaluation.finalModel.bySide?.[side], `${side} starter BF distribution`);
    const total = distribution.reduce((sum, value) => sum + value, 0);
    if (distribution.some((value) => !Number.isFinite(value) || value < 0) || Math.abs(total - 1) > TOLERANCE) {
      throw new Error(`${side} starter BF distribution is invalid.`);
    }
  }
  return evaluation;
}
