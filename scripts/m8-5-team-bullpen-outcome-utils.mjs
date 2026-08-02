import { createHash } from 'node:crypto';

import { buildM8StarterBullpenDataset } from './m8-starter-bullpen-transition-utils.mjs';

const PERIODS = Object.freeze(['fit', 'validation']);
const HANDS = Object.freeze(['L', 'R']);
const TOLERANCE = 1e-12;
const PROBABILITY_FLOOR = 1e-300;
const SHA256_PATTERN = /^[a-f0-9]{64}$/u;

export const M8_5_TEAM_BULLPEN_TERMINAL_CATEGORIES = Object.freeze([
  'K',
  'UBB',
  'IBB',
  'HBP',
  '1B',
  '2B',
  '3B',
  'HR',
  'ROE',
  'FC',
  'SF',
  'SH',
  'BIP_OUT',
  'CATCHER_INTERFERENCE',
  'OTHER_PA',
]);

export const DEFAULT_M8_5_TEAM_BULLPEN_CANDIDATES = Object.freeze(
  [25, 50, 100, 250, 500, 1000, 2500].map((leagueEquivalentPa) =>
    Object.freeze({
      candidateId: `team-hand-pool-${leagueEquivalentPa}`,
      leagueEquivalentPa,
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

function sha256String(value) {
  return createHash('sha256').update(value).digest('hex');
}

function assertSha256(value, label) {
  if (typeof value !== 'string' || !SHA256_PATTERN.test(value)) {
    throw new TypeError(`${label} must be a lowercase SHA-256 value.`);
  }
  return value;
}

function assertUntouchedSealed(value, label) {
  const reservation = object(value, label);
  if (reservation.rowsIncluded !== false || Object.hasOwn(reservation, 'rows')) {
    throw new Error(`${label} must keep untouched rows excluded.`);
  }
  return reservation;
}

function assertProbability(value, label) {
  if (!Number.isFinite(value) || value < 0 || value > 1) {
    throw new RangeError(`${label} must be in [0,1].`);
  }
  return value;
}

function normalizedVector(raw, label) {
  const values = M8_5_TEAM_BULLPEN_TERMINAL_CATEGORIES.map((category) => {
    const value = raw[category] ?? (category === 'OTHER_PA' ? 0 : Number.NaN);
    return assertProbability(value, `${label}.${category}`);
  });
  const total = values.reduce((sum, value) => sum + value, 0);
  if (!(total > 0)) throw new Error(`${label} has no probability mass.`);
  const normalized = values.map((value) => value / total);
  return Object.freeze(
    Object.fromEntries(
      M8_5_TEAM_BULLPEN_TERMINAL_CATEGORIES.map((category, index) => [
        category,
        normalized[index],
      ]),
    ),
  );
}

function sortedObject(entries) {
  return Object.freeze(
    Object.fromEntries(
      [...entries].sort(([left], [right]) => String(left).localeCompare(String(right))),
    ),
  );
}

function datasetIdentity(value) {
  return {
    datasetVersion: value.datasetVersion,
    activeSeason: value.activeSeason,
    sourceResolvedDatasetSha256: value.sourceResolvedDatasetSha256,
    sourceTeamEnvironmentDatasetSha256: value.sourceTeamEnvironmentDatasetSha256,
    sourceStarterBullpenTransitionSha256:
      value.sourceStarterBullpenTransitionSha256,
    periods: value.periods,
    totals: value.totals,
    untouchedTestReservation: value.untouchedTestReservation,
  };
}

function environmentRowsByKey(dataset, periodId) {
  const rows = array(dataset.periods?.[periodId]?.rows, `${periodId} environment rows`);
  const map = new Map();
  for (const row of rows) {
    const value = object(row, `${periodId} environment row`);
    const key = `${periodId}:${string(value.observedDate, 'environment date')}:${positiveInteger(
      value.gameId,
      'environment gameId',
    )}:${string(value.side, 'environment side')}`;
    if (map.has(key)) throw new Error(`duplicate team-environment row ${key}.`);
    map.set(key, value);
  }
  return map;
}

function validateJoinInputs(resolvedDataset, teamEnvironmentDataset) {
  const resolved = object(resolvedDataset, 'resolved categorical dataset');
  const environment = object(teamEnvironmentDataset, 'team environment dataset');
  if (resolved.datasetVersion !== 3) {
    throw new Error('resolved categorical datasetVersion must equal 3.');
  }
  if (environment.datasetVersion !== 2) {
    throw new Error('team environment datasetVersion must equal 2.');
  }
  if (resolved.activeSeason !== 2026 || environment.activeSeason !== 2026) {
    throw new Error('team bullpen inputs must use active season 2026.');
  }
  const resolvedSha = assertSha256(resolved.datasetSha256, 'resolved dataset SHA-256');
  if (
    assertSha256(
      environment.sourceResolvedDatasetSha256,
      'environment source resolved dataset SHA-256',
    ) !== resolvedSha
  ) {
    throw new Error('team environment dataset does not match the resolved dataset.');
  }
  assertSha256(environment.datasetSha256, 'team environment dataset SHA-256');
  assertUntouchedSealed(
    resolved.untouchedTestReservation,
    'resolved dataset untouched reservation',
  );
  assertUntouchedSealed(
    environment.untouchedTestReservation,
    'team environment untouched reservation',
  );
  return { resolved, environment };
}

export function buildM8_5TeamBullpenDataset({
  resolvedDataset,
  teamEnvironmentDataset,
  starterBullpenTransitionSha256,
}) {
  const { resolved, environment } = validateJoinInputs(
    resolvedDataset,
    teamEnvironmentDataset,
  );
  const transitionSha = assertSha256(
    starterBullpenTransitionSha256,
    'starter-bullpen transition SHA-256',
  );
  const transitionDataset = buildM8StarterBullpenDataset(resolved);
  const periods = {};
  const teamIds = new Set();
  const handCounts = { L: 0, R: 0 };
  let totalRows = 0;

  for (const periodId of PERIODS) {
    const environmentByKey = environmentRowsByKey(environment, periodId);
    const rows = [];
    for (const teamGame of transitionDataset.periods[periodId].rows) {
      const key = `${periodId}:${teamGame.observedDate}:${teamGame.gameId}:${teamGame.side}`;
      const environmentRow = environmentByKey.get(key);
      if (environmentRow === undefined) {
        throw new Error(`missing team-environment row ${key}.`);
      }
      const pitchingTeamId = positiveInteger(
        environmentRow.opponentTeamId,
        `${key} opponentTeamId`,
      );
      teamIds.add(pitchingTeamId);
      teamGame.bullpenRows.forEach((bullpenRow, bullpenIndex) => {
        if (!HANDS.includes(bullpenRow.normalizedPitcherHand)) return;
        if (
          !M8_5_TEAM_BULLPEN_TERMINAL_CATEGORIES.includes(
            bullpenRow.terminalCategory,
          )
        ) {
          throw new Error(
            `${key} bullpen row has unsupported terminal category ${bullpenRow.terminalCategory}.`,
          );
        }
        const pitcherHand = bullpenRow.normalizedPitcherHand;
        handCounts[pitcherHand] += 1;
        rows.push(
          Object.freeze({
            rowId: `${teamGame.rowId}:bullpen:${bullpenIndex + 1}:${bullpenRow.providerPitcherId}`,
            periodId,
            observedDate: teamGame.observedDate,
            gameId: teamGame.gameId,
            battingSide: teamGame.side,
            pitchingTeamId,
            providerPitcherId: positiveInteger(
              bullpenRow.providerPitcherId,
              `${key} bullpen pitcherId`,
            ),
            pitcherHand,
            batterSide:
              bullpenRow.normalizedBatterSide === 'L' ||
              bullpenRow.normalizedBatterSide === 'R'
                ? bullpenRow.normalizedBatterSide
                : null,
            terminalCategory: bullpenRow.terminalCategory,
          }),
        );
      });
    }
    rows.sort(
      (left, right) =>
        left.observedDate.localeCompare(right.observedDate) ||
        left.gameId - right.gameId ||
        left.battingSide.localeCompare(right.battingSide) ||
        left.rowId.localeCompare(right.rowId),
    );
    if (rows.length === 0) {
      throw new Error(`${periodId} contains no usable bullpen terminal rows.`);
    }
    periods[periodId] = Object.freeze({
      startDate: rows[0].observedDate,
      endDate: rows.at(-1).observedDate,
      rowCount: rows.length,
      rows: Object.freeze(rows),
    });
    totalRows += rows.length;
  }
  if (periods.fit.endDate >= periods.validation.startDate) {
    throw new Error('team bullpen fit and validation periods overlap.');
  }
  const identity = {
    datasetVersion: 1,
    activeSeason: 2026,
    sourceResolvedDatasetSha256: resolved.datasetSha256,
    sourceTeamEnvironmentDatasetSha256: environment.datasetSha256,
    sourceStarterBullpenTransitionSha256: transitionSha,
    periods: Object.freeze(periods),
    totals: Object.freeze({
      rowCount: totalRows,
      fitRowCount: periods.fit.rowCount,
      validationRowCount: periods.validation.rowCount,
      pitchingTeamCount: teamIds.size,
      handCounts: Object.freeze({ ...handCounts }),
    }),
    untouchedTestReservation: Object.freeze({ rowsIncluded: false }),
  };
  return Object.freeze({
    purpose:
      'Join current-season recovered bullpen terminal PA rows to the verified opposing pitching team while preserving the frozen starter-to-bullpen workload transition as source evidence only.',
    ...identity,
    datasetSha256: sha256String(JSON.stringify(datasetIdentity(identity))),
  });
}

function validateGenericBullpenModel(rawModel) {
  const model = object(rawModel, 'generic bullpen model');
  if (model.modelVersion !== 'm8-generic-bullpen-outcome-v1') {
    throw new Error('generic bullpen modelVersion is unsupported.');
  }
  const handWeights = object(model.handWeights, 'generic bullpen handWeights');
  const normalizedWeights = {
    L: assertProbability(handWeights.L, 'generic bullpen L hand weight'),
    R: assertProbability(handWeights.R, 'generic bullpen R hand weight'),
  };
  if (Math.abs(normalizedWeights.L + normalizedWeights.R - 1) > TOLERANCE) {
    throw new Error('generic bullpen hand weights must sum to one.');
  }
  const byHand = object(model.byHand, 'generic bullpen byHand');
  return Object.freeze({
    modelVersion: model.modelVersion,
    handWeights: Object.freeze(normalizedWeights),
    byHand: Object.freeze({
      L: normalizedVector(object(byHand.L, 'generic bullpen L vector'), 'generic bullpen L'),
      R: normalizedVector(object(byHand.R, 'generic bullpen R vector'), 'generic bullpen R'),
    }),
  });
}

function validateCandidates(rawCandidates) {
  const candidates = array(rawCandidates, 'team bullpen candidates').map(
    (rawCandidate, index) => {
      const candidate = object(rawCandidate, `candidate[${index}]`);
      const leagueEquivalentPa = positiveInteger(
        candidate.leagueEquivalentPa,
        `candidate[${index}].leagueEquivalentPa`,
      );
      const candidateId = string(candidate.candidateId, `candidate[${index}].candidateId`);
      if (candidateId !== `team-hand-pool-${leagueEquivalentPa}`) {
        throw new Error(`${candidateId} does not match its pooling strength.`);
      }
      return Object.freeze({ candidateId, leagueEquivalentPa });
    },
  );
  if (candidates.length === 0) throw new Error('team bullpen candidate grid is empty.');
  if (new Set(candidates.map((candidate) => candidate.candidateId)).size !== candidates.length) {
    throw new Error('team bullpen candidate grid contains duplicates.');
  }
  return candidates;
}

function emptyCounts() {
  return Object.fromEntries(
    M8_5_TEAM_BULLPEN_TERMINAL_CATEGORIES.map((category) => [category, 0]),
  );
}

function fitTeamModel(rows, generic, candidate) {
  const counts = new Map();
  const teamIds = new Set();
  for (const row of rows) {
    teamIds.add(row.pitchingTeamId);
    const key = `${row.pitchingTeamId}|${row.pitcherHand}`;
    const entry = counts.get(key) ?? { total: 0, byCategory: emptyCounts() };
    entry.byCategory[row.terminalCategory] += 1;
    entry.total += 1;
    counts.set(key, entry);
  }
  const byTeam = {};
  for (const teamId of [...teamIds].sort((left, right) => left - right)) {
    const hands = {};
    for (const hand of HANDS) {
      const entry = counts.get(`${teamId}|${hand}`) ?? {
        total: 0,
        byCategory: emptyCounts(),
      };
      const denominator = entry.total + candidate.leagueEquivalentPa;
      hands[hand] = Object.freeze(
        Object.fromEntries(
          M8_5_TEAM_BULLPEN_TERMINAL_CATEGORIES.map((category) => [
            category,
            (entry.byCategory[category] +
              candidate.leagueEquivalentPa * generic.byHand[hand][category]) /
              denominator,
          ]),
        ),
      );
    }
    byTeam[String(teamId)] = Object.freeze(hands);
  }
  return Object.freeze({
    modelVersion: `m8-5-team-bullpen-outcome-${candidate.candidateId}-v1`,
    candidate: Object.freeze({ ...candidate }),
    handWeightsPolicy: 'preserve-m8-generic-bullpen-hand-weights',
    handWeights: generic.handWeights,
    genericFallbackByHand: generic.byHand,
    byTeam: sortedObject(Object.entries(byTeam)),
  });
}

function probabilityVectorForRow(model, row) {
  return model.byTeam[String(row.pitchingTeamId)]?.[row.pitcherHand] ??
    model.genericFallbackByHand[row.pitcherHand];
}

function scoreRows(rows, model) {
  if (rows.length === 0) throw new Error('cannot score an empty bullpen cohort.');
  let logLossTotal = 0;
  let brierTotal = 0;
  const rowIds = [];
  for (const row of rows) {
    const vector = probabilityVectorForRow(model, row);
    const observedProbability = Math.max(
      vector[row.terminalCategory] ?? 0,
      PROBABILITY_FLOOR,
    );
    logLossTotal += -Math.log(observedProbability);
    for (const category of M8_5_TEAM_BULLPEN_TERMINAL_CATEGORIES) {
      const target = category === row.terminalCategory ? 1 : 0;
      brierTotal += ((vector[category] ?? 0) - target) ** 2;
    }
    rowIds.push(row.rowId);
  }
  return Object.freeze({
    observationCount: rows.length,
    logLoss: logLossTotal / rows.length,
    multiclassBrier: brierTotal / rows.length,
    observationIdsSha256: sha256String(JSON.stringify(rowIds)),
    logLossTotal,
    multiclassBrierTotal: brierTotal,
  });
}

function genericModel(generic) {
  return Object.freeze({
    modelVersion: generic.modelVersion,
    candidate: null,
    handWeightsPolicy: 'preserve-m8-generic-bullpen-hand-weights',
    handWeights: generic.handWeights,
    genericFallbackByHand: generic.byHand,
    byTeam: Object.freeze({}),
  });
}

function aggregateMetrics(parts) {
  const observationCount = parts.reduce(
    (sum, metrics) => sum + metrics.observationCount,
    0,
  );
  const logLossTotal = parts.reduce((sum, metrics) => sum + metrics.logLossTotal, 0);
  const multiclassBrierTotal = parts.reduce(
    (sum, metrics) => sum + metrics.multiclassBrierTotal,
    0,
  );
  return Object.freeze({
    observationCount,
    logLoss: logLossTotal / observationCount,
    multiclassBrier: multiclassBrierTotal / observationCount,
    observationIdsSha256: sha256String(
      JSON.stringify(parts.map((metrics) => metrics.observationIdsSha256)),
    ),
    logLossTotal,
    multiclassBrierTotal,
  });
}

function walkForwardMetrics(fitRows, validationRows, generic, candidate) {
  const dates = [...new Set(validationRows.map((row) => row.observedDate))].sort();
  const parts = [];
  const folds = [];
  for (const date of dates) {
    const trainingRows = [
      ...fitRows,
      ...validationRows.filter((row) => row.observedDate < date),
    ];
    const scoringRows = validationRows.filter((row) => row.observedDate === date);
    const model = candidate === null
      ? genericModel(generic)
      : fitTeamModel(trainingRows, generic, candidate);
    const metrics = scoreRows(scoringRows, model);
    parts.push(metrics);
    folds.push(
      Object.freeze({
        validationDate: date,
        trainingObservationCount: trainingRows.length,
        scoringObservationCount: scoringRows.length,
        metrics,
      }),
    );
  }
  return Object.freeze({ metrics: aggregateMetrics(parts), folds: Object.freeze(folds) });
}

function strictlyValidatedImprovement(result, baseline) {
  return (
    result.fixedMetrics.logLoss < baseline.fixedMetrics.logLoss - TOLERANCE &&
    result.fixedMetrics.multiclassBrier <=
      baseline.fixedMetrics.multiclassBrier + TOLERANCE &&
    result.walkForwardMetrics.logLoss <
      baseline.walkForwardMetrics.logLoss - TOLERANCE &&
    result.walkForwardMetrics.multiclassBrier <=
      baseline.walkForwardMetrics.multiclassBrier + TOLERANCE
  );
}

export function evaluateM8_5TeamBullpenCandidates({
  dataset: rawDataset,
  genericBullpenModel: rawGeneric,
  candidates: rawCandidates = DEFAULT_M8_5_TEAM_BULLPEN_CANDIDATES,
}) {
  const dataset = object(rawDataset, 'team bullpen dataset');
  if (dataset.datasetVersion !== 1 || dataset.activeSeason !== 2026) {
    throw new Error('unsupported team bullpen dataset contract.');
  }
  assertUntouchedSealed(
    dataset.untouchedTestReservation,
    'team bullpen untouched reservation',
  );
  const fitRows = array(dataset.periods?.fit?.rows, 'team bullpen fit rows');
  const validationRows = array(
    dataset.periods?.validation?.rows,
    'team bullpen validation rows',
  );
  if (fitRows.length === 0 || validationRows.length === 0) {
    throw new Error('team bullpen evaluation requires fit and validation rows.');
  }
  const generic = validateGenericBullpenModel(rawGeneric);
  const candidates = validateCandidates(rawCandidates);
  const genericRuntimeModel = genericModel(generic);
  const genericFixedMetrics = scoreRows(validationRows, genericRuntimeModel);
  const genericWalkForward = walkForwardMetrics(
    fitRows,
    validationRows,
    generic,
    null,
  );
  const baseline = {
    fixedMetrics: genericFixedMetrics,
    walkForwardMetrics: genericWalkForward.metrics,
  };
  const results = candidates.map((candidate) => {
    const fixedModel = fitTeamModel(fitRows, generic, candidate);
    const fixedMetrics = scoreRows(validationRows, fixedModel);
    const walkForward = walkForwardMetrics(
      fitRows,
      validationRows,
      generic,
      candidate,
    );
    return Object.freeze({
      candidate,
      fixedMetrics,
      walkForwardMetrics: walkForward.metrics,
      walkForwardFolds: walkForward.folds,
      validatedImprovement: strictlyValidatedImprovement(
        {
          fixedMetrics,
          walkForwardMetrics: walkForward.metrics,
        },
        baseline,
      ),
    });
  });
  const eligible = results
    .filter((result) => result.validatedImprovement)
    .sort(
      (left, right) =>
        right.candidate.leagueEquivalentPa -
          left.candidate.leagueEquivalentPa ||
        left.candidate.candidateId.localeCompare(right.candidate.candidateId),
    );
  const selected = eligible[0] ?? null;
  const selectedModel = selected === null
    ? null
    : fitTeamModel(fitRows, generic, selected.candidate);
  return Object.freeze({
    evaluationVersion: 1,
    modelFamily: 'm8-5-team-specific-bullpen-terminal-outcome',
    activeSeason: 2026,
    decision:
      selected === null
        ? 'IDENTITY_RETAINED_NO_VALIDATED_TEAM_SIGNAL'
        : 'VALIDATED_TEAM_SIGNAL',
    selectedCandidateId: selected?.candidate.candidateId ?? null,
    genericFixedMetrics,
    genericWalkForwardMetrics: genericWalkForward.metrics,
    candidateResults: Object.freeze(results),
    selectedFixedMetrics: selected?.fixedMetrics ?? null,
    selectedWalkForwardMetrics: selected?.walkForwardMetrics ?? null,
    selectedModel,
    selectionPolicy: Object.freeze({
      requiredFixedLogLossImprovement: true,
      requiredFixedBrierNoWorse: true,
      requiredWalkForwardLogLossImprovement: true,
      requiredWalkForwardBrierNoWorse: true,
      tieBreaker:
        'strongest-league-pooling-among-candidates-passing-all-validation-gates',
      validationRowsUsedForFinalVectorFit: false,
    }),
    untouchedTestReservation: Object.freeze({ rowsIncluded: false }),
  });
}

export function factorEffectsForM8_5TeamBullpenModel(rawModel) {
  const model = object(rawModel, 'selected team bullpen model');
  if (
    model.handWeightsPolicy !==
    'preserve-m8-generic-bullpen-hand-weights'
  ) {
    throw new Error('team bullpen model does not preserve frozen hand weights.');
  }
  const effects = [];
  for (const [teamIdText, rawHands] of Object.entries(
    object(model.byTeam, 'selected team bullpen byTeam'),
  ).sort(([left], [right]) => Number(left) - Number(right))) {
    const teamId = positiveInteger(Number(teamIdText), 'team bullpen teamId');
    const hands = object(rawHands, `team ${teamId} hands`);
    for (const hand of HANDS) {
      const vector = normalizedVector(
        object(hands[hand], `team ${teamId} ${hand} vector`),
        `team ${teamId} ${hand}`,
      );
      effects.push(
        Object.freeze({
          kind: 'terminal-outcome-vector',
          applicationStage:
            'terminal-outcome-before-statistic-distribution',
          scope: 'bullpen',
          matchupKey: `pitching-team:${teamId}|pitcher-hand:${hand}`,
          categoryProbabilities: Object.freeze(
            M8_5_TEAM_BULLPEN_TERMINAL_CATEGORIES.map((category) =>
              Object.freeze({ category, probability: vector[category] }),
            ),
          ),
        }),
      );
    }
  }
  if (effects.length === 0) {
    throw new Error('selected team bullpen model contains no team effects.');
  }
  return Object.freeze(effects);
}
