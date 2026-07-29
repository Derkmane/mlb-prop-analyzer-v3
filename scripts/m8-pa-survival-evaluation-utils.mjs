import { createHash } from 'node:crypto';

const SIDES = Object.freeze(['away', 'home']);
const SLOTS = Object.freeze([1, 2, 3, 4, 5, 6, 7, 8, 9]);
const TOLERANCE = 1e-12;
const SHA256_PATTERN = /^[a-f0-9]{64}$/;
const DEFAULT_POOLING_STRENGTHS = Object.freeze([1, 5, 10, 25, 50, 100, 250, 500]);

export const DEFAULT_M8_PA_SURVIVAL_CANDIDATES = Object.freeze([
  Object.freeze({
    candidateId: 'league-only',
    grouping: 'league',
    leagueEquivalentObservations: null,
  }),
  ...['slot', 'home-away', 'slot-home-away'].flatMap((grouping) =>
    DEFAULT_POOLING_STRENGTHS.map((leagueEquivalentObservations) =>
      Object.freeze({
        candidateId: `${grouping}-pool-${leagueEquivalentObservations}`,
        grouping,
        leagueEquivalentObservations,
      }),
    ),
  ),
]);

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

function assertSha256(value, label) {
  if (typeof value !== 'string' || !SHA256_PATTERN.test(value)) {
    throw new TypeError(`${label} must be a lowercase SHA-256 digest.`);
  }
  return value;
}

function assertProbability(value, label) {
  if (
    !Number.isFinite(value) ||
    value < -TOLERANCE ||
    value > 1 + TOLERANCE
  ) {
    throw new RangeError(`${label} must be a finite probability.`);
  }
  return value;
}

function sum(values) {
  return values.reduce((total, value) => total + value, 0);
}

function assertProbabilityMassFunction(rawPmf, label) {
  const pmf = assertArray(rawPmf, label).map((value, index) =>
    assertProbability(value, `${label}[${index}]`),
  );
  const total = sum(pmf);
  if (Math.abs(total - 1) > TOLERANCE) {
    throw new Error(`${label} must sum to 1.`);
  }
  return Object.freeze(pmf);
}

export function m8PaCountPmfToSurvival(rawPmf) {
  const pmf = assertProbabilityMassFunction(rawPmf, 'count PMF');
  if (pmf.length < 2) {
    throw new RangeError('count PMF must support at least counts 0 and 1.');
  }
  const survival = [];
  let tail = 0;
  for (let count = pmf.length - 1; count >= 1; count -= 1) {
    tail += pmf[count];
    survival.unshift(tail);
  }
  for (let index = 1; index < survival.length; index += 1) {
    if (survival[index] > survival[index - 1] + TOLERANCE) {
      throw new Error('derived survival curve is not monotone non-increasing.');
    }
  }
  return Object.freeze(survival);
}

export function m8PaSurvivalToCountPmf(rawSurvival) {
  const survival = assertArray(rawSurvival, 'survival curve').map(
    (value, index) =>
      assertProbability(value, `survival curve[${index}]`),
  );
  if (survival.length === 0) {
    throw new RangeError('survival curve must not be empty.');
  }
  for (let index = 1; index < survival.length; index += 1) {
    if (survival[index] > survival[index - 1] + TOLERANCE) {
      throw new Error('survival curve must be monotone non-increasing.');
    }
  }
  const pmf = [1 - survival[0]];
  for (let index = 0; index < survival.length - 1; index += 1) {
    pmf.push(survival[index] - survival[index + 1]);
  }
  pmf.push(survival.at(-1));
  return assertProbabilityMassFunction(pmf, 'survival-derived PMF');
}

function countVector(rows, maximumCount) {
  const counts = Array.from({ length: maximumCount + 1 }, () => 0);
  for (const row of rows) {
    counts[row.plateAppearances] += 1;
  }
  return counts;
}

function normalizeCounts(counts) {
  const total = sum(counts);
  if (!(total > 0)) {
    throw new Error('count vector must contain at least one observation.');
  }
  return Object.freeze(counts.map((count) => count / total));
}

function groupKey(grouping, row) {
  switch (grouping) {
    case 'league':
      return 'league';
    case 'slot':
      return `slot:${row.lineupSlot}`;
    case 'home-away':
      return row.homeAway;
    case 'slot-home-away':
      return `${row.homeAway}:slot:${row.lineupSlot}`;
    default:
      throw new Error(`unsupported PA-survival grouping ${grouping}.`);
  }
}

function expectedGroupKeys(grouping) {
  switch (grouping) {
    case 'league':
      return ['league'];
    case 'slot':
      return SLOTS.map((slot) => `slot:${slot}`);
    case 'home-away':
      return [...SIDES];
    case 'slot-home-away':
      return SIDES.flatMap((side) =>
        SLOTS.map((slot) => `${side}:slot:${slot}`),
      );
    default:
      throw new Error(`unsupported PA-survival grouping ${grouping}.`);
  }
}

function validateCandidate(rawCandidate, index) {
  const candidate = assertObject(rawCandidate, `candidates[${index}]`);
  const candidateId = assertNonEmptyString(
    candidate.candidateId,
    `candidates[${index}].candidateId`,
  );
  const grouping = assertNonEmptyString(
    candidate.grouping,
    `${candidateId}.grouping`,
  );
  expectedGroupKeys(grouping);
  if (grouping === 'league') {
    if (candidate.leagueEquivalentObservations !== null) {
      throw new Error(
        `${candidateId} league-only candidate must use null pooling strength.`,
      );
    }
  } else {
    assertPositiveInteger(
      candidate.leagueEquivalentObservations,
      `${candidateId}.leagueEquivalentObservations`,
    );
  }
  return Object.freeze({
    candidateId,
    grouping,
    leagueEquivalentObservations: candidate.leagueEquivalentObservations,
  });
}

function validateRows(rawPeriod, periodId, activeSeason, seenRowIds) {
  const period = assertObject(rawPeriod, `periods.${periodId}`);
  const rows = assertArray(period.rows, `periods.${periodId}.rows`);
  if (
    assertNonNegativeInteger(
      period.rowCount,
      `periods.${periodId}.rowCount`,
    ) !== rows.length
  ) {
    throw new Error(`${periodId} rowCount does not match rows.`);
  }
  return Object.freeze(
    rows.map((rawRow, index) => {
      const row = assertObject(rawRow, `${periodId} row ${index}`);
      const rowId = assertNonEmptyString(
        row.rowId,
        `${periodId} row ${index}.rowId`,
      );
      if (seenRowIds.has(rowId)) {
        throw new Error(`duplicate PA-survival row ${rowId}.`);
      }
      seenRowIds.add(rowId);
      const observedDate = assertNonEmptyString(
        row.observedDate,
        `${rowId}.observedDate`,
      );
      if (!observedDate.startsWith(`${activeSeason}-`)) {
        throw new Error(`${rowId} is outside active season ${activeSeason}.`);
      }
      if (row.periodId !== periodId) {
        throw new Error(`${rowId} periodId does not match ${periodId}.`);
      }
      const homeAway = assertNonEmptyString(
        row.homeAway,
        `${rowId}.homeAway`,
      );
      if (!SIDES.includes(homeAway) || row.side !== homeAway) {
        throw new Error(`${rowId} must preserve matching homeAway and side.`);
      }
      const lineupSlot = assertPositiveInteger(
        row.lineupSlot,
        `${rowId}.lineupSlot`,
      );
      if (!SLOTS.includes(lineupSlot)) {
        throw new Error(`${rowId} lineupSlot is invalid.`);
      }
      const plateAppearances = assertNonNegativeInteger(
        row.plateAppearances,
        `${rowId}.plateAppearances`,
      );
      if (row.sourceField !== 'stats.plate_appearances') {
        throw new Error(
          `${rowId} does not use authoritative direct PA field.`,
        );
      }
      return Object.freeze({
        rowId,
        observedDate,
        periodId,
        homeAway,
        lineupSlot,
        plateAppearances,
      });
    }),
  );
}

function validateDataset(rawDataset, datasetFileSha256) {
  const dataset = assertObject(rawDataset, 'PA-survival dataset');
  if (
    dataset.datasetVersion !== 1 ||
    dataset.provider !== 'BALLDONTLIE MLB API'
  ) {
    throw new Error('unsupported PA-survival dataset contract.');
  }
  const activeSeason = assertPositiveInteger(
    dataset.activeSeason,
    'activeSeason',
  );
  const datasetSha256 = assertSha256(
    dataset.datasetSha256,
    'datasetSha256',
  );
  assertSha256(datasetFileSha256, 'datasetFileSha256');
  const untouched = assertObject(
    dataset.untouchedTestReservation,
    'untouchedTestReservation',
  );
  if (untouched.rowsIncluded !== false || Object.hasOwn(untouched, 'rows')) {
    throw new Error('untouched-test rows must remain excluded.');
  }
  if (
    dataset.exclusionPolicy?.componentArithmeticFallback !== 'prohibited' ||
    dataset.exclusionPolicy?.componentArithmeticMismatch !==
      'retain-direct-stats.plate_appearances-and-preserve-audit-flag'
  ) {
    throw new Error(
      'PA-survival dataset does not preserve the approved direct-PA authority boundary.',
    );
  }
  const seenRowIds = new Set();
  const fit = validateRows(
    dataset.periods?.fit,
    'fit',
    activeSeason,
    seenRowIds,
  );
  const validation = validateRows(
    dataset.periods?.validation,
    'validation',
    activeSeason,
    seenRowIds,
  );
  if (fit.length === 0 || validation.length === 0) {
    throw new Error(
      'fit and validation periods must both contain observations.',
    );
  }
  const fitStartDate = fit[0].observedDate;
  const fitEndDate = fit.at(-1).observedDate;
  const validationStartDate = validation[0].observedDate;
  const validationEndDate = validation.at(-1).observedDate;
  if (fitEndDate >= validationStartDate) {
    throw new Error(
      'fit and validation periods must be strictly chronological and non-overlapping.',
    );
  }
  return Object.freeze({
    activeSeason,
    datasetSha256,
    datasetFileSha256,
    fit,
    validation,
    fitWindow: Object.freeze({
      startDate: fitStartDate,
      endDate: fitEndDate,
    }),
    validationWindow: Object.freeze({
      startDate: validationStartDate,
      endDate: validationEndDate,
    }),
    untouchedTestReservation: Object.freeze({
      ...untouched,
      rowsIncluded: false,
    }),
  });
}

function buildGroupModels({
  candidate,
  fitRows,
  maximumCount,
  leaguePmf,
}) {
  const groupedRows = new Map(
    expectedGroupKeys(candidate.grouping).map((key) => [key, []]),
  );
  for (const row of fitRows) {
    const key = groupKey(candidate.grouping, row);
    if (!groupedRows.has(key)) {
      throw new Error(
        `${candidate.candidateId} encountered unexpected group ${key}.`,
      );
    }
    groupedRows.get(key).push(row);
  }
  const models = new Map();
  for (const key of expectedGroupKeys(candidate.grouping)) {
    const rows = groupedRows.get(key);
    if (rows.length === 0) {
      throw new Error(`${candidate.candidateId} fit group ${key} is empty.`);
    }
    const counts = countVector(rows, maximumCount);
    const rawPmf = normalizeCounts(counts);
    let fittedPmf;
    if (candidate.grouping === 'league') {
      fittedPmf = leaguePmf;
    } else {
      const strength = candidate.leagueEquivalentObservations;
      fittedPmf = assertProbabilityMassFunction(
        counts.map(
          (count, index) =>
            (count + strength * leaguePmf[index]) /
            (rows.length + strength),
        ),
        `${candidate.candidateId} ${key} pooled PMF`,
      );
    }
    const rawSurvival = m8PaCountPmfToSurvival(rawPmf);
    const fittedSurvival = m8PaCountPmfToSurvival(fittedPmf);
    const reconstructed = m8PaSurvivalToCountPmf(fittedSurvival);
    for (let index = 0; index < fittedPmf.length; index += 1) {
      if (Math.abs(reconstructed[index] - fittedPmf[index]) > TOLERANCE) {
        throw new Error(
          `${candidate.candidateId} ${key} survival conversion drifted.`,
        );
      }
    }
    models.set(
      key,
      Object.freeze({
        groupKey: key,
        fitObservationCount: rows.length,
        countVector: Object.freeze(counts),
        rawPmf,
        rawSurvival,
        fittedPmf,
        fittedSurvival,
      }),
    );
  }
  return models;
}

function evaluateCandidate({
  candidate,
  fitRows,
  validationRows,
  maximumCount,
  leaguePmf,
}) {
  const models = buildGroupModels({
    candidate,
    fitRows,
    maximumCount,
    leaguePmf,
  });
  let logLossSum = 0;
  let brierSum = 0;
  let actualProbabilityMinimum = 1;
  let actualProbabilityMaximum = 0;
  for (const row of validationRows) {
    const key = groupKey(candidate.grouping, row);
    const model = models.get(key);
    if (model === undefined) {
      throw new Error(
        `${candidate.candidateId} has no fit model for validation group ${key}.`,
      );
    }
    const actualProbability = model.fittedPmf[row.plateAppearances];
    if (!(actualProbability > 0 && actualProbability <= 1)) {
      throw new Error(
        `${candidate.candidateId} assigned non-positive validation probability.`,
      );
    }
    logLossSum += -Math.log(actualProbability);
    actualProbabilityMinimum = Math.min(
      actualProbabilityMinimum,
      actualProbability,
    );
    actualProbabilityMaximum = Math.max(
      actualProbabilityMaximum,
      actualProbability,
    );
    for (let count = 0; count <= maximumCount; count += 1) {
      const target = count === row.plateAppearances ? 1 : 0;
      brierSum += (model.fittedPmf[count] - target) ** 2;
    }
  }
  return Object.freeze({
    candidateId: candidate.candidateId,
    grouping: candidate.grouping,
    leagueEquivalentObservations:
      candidate.leagueEquivalentObservations,
    validationObservationCount: validationRows.length,
    logLoss: logLossSum / validationRows.length,
    multiclassBrier: brierSum / validationRows.length,
    actualProbabilityMinimum,
    actualProbabilityMaximum,
    models,
  });
}

function summarizeSelectedModel(result) {
  return Object.freeze({
    candidateId: result.candidateId,
    grouping: result.grouping,
    leagueEquivalentObservations:
      result.leagueEquivalentObservations,
    groups: Object.freeze(
      [...result.models.values()].map((model) =>
        Object.freeze({
          groupKey: model.groupKey,
          fitObservationCount: model.fitObservationCount,
          countVector: model.countVector,
          rawPmf: model.rawPmf,
          rawSurvival: model.rawSurvival,
          fittedPmf: model.fittedPmf,
          fittedSurvival: model.fittedSurvival,
        }),
      ),
    ),
    rawCurvesMonotoneByConstruction: true,
    fittedCurvesMonotoneByConstruction: true,
    monotoneProjectionApplied: false,
  });
}

function bestResultByGrouping(results, grouping) {
  return results
    .filter((result) => result.grouping === grouping)
    .sort(
      (left, right) =>
        left.logLoss - right.logLoss ||
        left.multiclassBrier - right.multiclassBrier ||
        left.candidateId.localeCompare(right.candidateId),
    )[0];
}

export function evaluateM8PaSurvivalCandidates({
  rawDataset,
  datasetFileSha256,
  candidates = DEFAULT_M8_PA_SURVIVAL_CANDIDATES,
}) {
  const dataset = validateDataset(rawDataset, datasetFileSha256);
  const validatedCandidates = assertArray(candidates, 'candidates').map(
    validateCandidate,
  );
  if (validatedCandidates.length === 0) {
    throw new RangeError('at least one PA-survival candidate is required.');
  }
  if (
    new Set(
      validatedCandidates.map((candidate) => candidate.candidateId),
    ).size !== validatedCandidates.length
  ) {
    throw new Error('PA-survival candidate IDs must be unique.');
  }
  const maximumCount = Math.max(
    ...dataset.fit.map((row) => row.plateAppearances),
  );
  if (maximumCount < 1) {
    throw new Error('fit period must support at least one positive PA count.');
  }
  const unsupportedValidationRows = dataset.validation.filter(
    (row) => row.plateAppearances > maximumCount,
  );
  if (unsupportedValidationRows.length > 0) {
    throw new Error(
      `validation contains PA count ${unsupportedValidationRows[0].plateAppearances} beyond fit support ${maximumCount}.`,
    );
  }
  const leagueCounts = countVector(dataset.fit, maximumCount);
  for (const row of dataset.validation) {
    if (leagueCounts[row.plateAppearances] === 0) {
      throw new Error(
        `validation PA count ${row.plateAppearances} has no current-season fit support.`,
      );
    }
  }
  const leaguePmf = normalizeCounts(leagueCounts);
  const results = validatedCandidates
    .map((candidate) =>
      evaluateCandidate({
        candidate,
        fitRows: dataset.fit,
        validationRows: dataset.validation,
        maximumCount,
        leaguePmf,
      }),
    )
    .sort(
      (left, right) =>
        left.logLoss - right.logLoss ||
        left.multiclassBrier - right.multiclassBrier ||
        left.candidateId.localeCompare(right.candidateId),
    );
  const selected = results[0];
  const bestByGrouping = Object.fromEntries(
    ['league', 'slot', 'home-away', 'slot-home-away'].map((grouping) => {
      const best = bestResultByGrouping(results, grouping);
      return [
        grouping,
        best === undefined
          ? null
          : {
              candidateId: best.candidateId,
              logLoss: best.logLoss,
              multiclassBrier: best.multiclassBrier,
            },
      ];
    }),
  );
  const slot = bestByGrouping.slot;
  const slotHomeAway = bestByGrouping['slot-home-away'];
  const league = bestByGrouping.league;
  const comparisons = {
    bestSlotVersusLeague:
      slot === null || league === null
        ? null
        : {
            logLossImprovement: league.logLoss - slot.logLoss,
            brierImprovement:
              league.multiclassBrier - slot.multiclassBrier,
          },
    bestSlotHomeAwayVersusBestSlot:
      slotHomeAway === null || slot === null
        ? null
        : {
            logLossImprovement: slot.logLoss - slotHomeAway.logLoss,
            brierImprovement:
              slot.multiclassBrier - slotHomeAway.multiclassBrier,
          },
  };
  const candidateSummaries = results.map((result) => ({
    candidateId: result.candidateId,
    grouping: result.grouping,
    leagueEquivalentObservations:
      result.leagueEquivalentObservations,
    validationObservationCount: result.validationObservationCount,
    logLoss: result.logLoss,
    multiclassBrier: result.multiclassBrier,
    actualProbabilityMinimum: result.actualProbabilityMinimum,
    actualProbabilityMaximum: result.actualProbabilityMaximum,
  }));
  const identity = {
    evaluationVersion: 1,
    activeSeason: dataset.activeSeason,
    sourceDatasetSha256: dataset.datasetSha256,
    sourceDatasetFileSha256: dataset.datasetFileSha256,
    fitWindow: dataset.fitWindow,
    validationWindow: dataset.validationWindow,
    fitObservationCount: dataset.fit.length,
    validationObservationCount: dataset.validation.length,
    fitObservationIdsSha256: sha256(
      JSON.stringify(dataset.fit.map((row) => row.rowId)),
    ),
    validationObservationIdsSha256: sha256(
      JSON.stringify(dataset.validation.map((row) => row.rowId)),
    ),
    countSupport: Object.freeze({
      minimum: 0,
      maximum: maximumCount,
    }),
    leagueFitCountVector: Object.freeze(leagueCounts),
    leagueFitPmf: leaguePmf,
    candidateSummaries: Object.freeze(candidateSummaries),
    selectionRule:
      'validation log loss ascending, multiclass Brier ascending, candidate ID ascending',
    selectedCandidateId: selected.candidateId,
    bestByGrouping,
    comparisons,
    selectedModel: summarizeSelectedModel(selected),
    untouchedTestReservation: dataset.untouchedTestReservation,
  };
  return Object.freeze({
    purpose:
      'Chronological current-season evaluation of hitter PA-count distributions by official lineup slot and home/away using fit-only pooled empirical models.',
    ...identity,
    evaluationSha256: sha256(JSON.stringify(identity)),
  });
}
