const ISO_DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const MILLISECONDS_PER_DAY = 24 * 60 * 60 * 1000;

function assertPlainObject(value, label) {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new TypeError(`${label} must be an object.`);
  }
  return value;
}

function assertNonEmptyString(value, label) {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new TypeError(`${label} must be a non-empty string.`);
  }
  return value.trim();
}

function assertActiveSeason(activeSeason) {
  if (!Number.isSafeInteger(activeSeason) || activeSeason < 1900) {
    throw new TypeError('activeSeason must be a four-digit integer year.');
  }
  return activeSeason;
}

export function parseUtcIsoDate(value, label = 'date') {
  const normalized = assertNonEmptyString(value, label);
  if (!ISO_DATE_PATTERN.test(normalized)) {
    throw new TypeError(`${label} must use YYYY-MM-DD.`);
  }

  const parsed = new Date(`${normalized}T00:00:00.000Z`);
  if (
    Number.isNaN(parsed.getTime()) ||
    parsed.toISOString().slice(0, 10) !== normalized
  ) {
    throw new TypeError(`${label} must be a real UTC calendar date.`);
  }

  return parsed;
}

export function assertCurrentSeasonDate(value, activeSeason, label = 'date') {
  const season = assertActiveSeason(activeSeason);
  const parsed = parseUtcIsoDate(value, label);
  if (parsed.getUTCFullYear() !== season) {
    throw new RangeError(`${label} must belong to active season ${season}.`);
  }
  return parsed;
}

export function enumerateCurrentSeasonDates({
  startDate,
  endDate,
  activeSeason,
}) {
  const start = assertCurrentSeasonDate(
    startDate,
    activeSeason,
    'startDate',
  );
  const end = assertCurrentSeasonDate(endDate, activeSeason, 'endDate');
  if (start.getTime() > end.getTime()) {
    throw new RangeError('startDate must not be after endDate.');
  }

  const dates = [];
  for (
    let current = start.getTime();
    current <= end.getTime();
    current += MILLISECONDS_PER_DAY
  ) {
    dates.push(new Date(current).toISOString().slice(0, 10));
  }
  return Object.freeze(dates);
}

export function validateChronologicalWindows({
  activeSeason,
  fitStartDate,
  fitEndDate,
  validationStartDate,
  validationEndDate,
  testStartDate,
  testEndDate,
}) {
  const season = assertActiveSeason(activeSeason);
  const values = {
    fitStartDate: assertCurrentSeasonDate(
      fitStartDate,
      season,
      'fitStartDate',
    ),
    fitEndDate: assertCurrentSeasonDate(fitEndDate, season, 'fitEndDate'),
    validationStartDate: assertCurrentSeasonDate(
      validationStartDate,
      season,
      'validationStartDate',
    ),
    validationEndDate: assertCurrentSeasonDate(
      validationEndDate,
      season,
      'validationEndDate',
    ),
    testStartDate: assertCurrentSeasonDate(
      testStartDate,
      season,
      'testStartDate',
    ),
    testEndDate: assertCurrentSeasonDate(testEndDate, season, 'testEndDate'),
  };

  const timestamps = Object.fromEntries(
    Object.entries(values).map(([key, date]) => [key, date.getTime()]),
  );

  if (timestamps.fitStartDate > timestamps.fitEndDate) {
    throw new RangeError('fitStartDate must not be after fitEndDate.');
  }
  if (timestamps.fitEndDate >= timestamps.validationStartDate) {
    throw new RangeError('fit period must end before validation begins.');
  }
  if (timestamps.validationStartDate > timestamps.validationEndDate) {
    throw new RangeError(
      'validationStartDate must not be after validationEndDate.',
    );
  }
  if (timestamps.validationEndDate >= timestamps.testStartDate) {
    throw new RangeError(
      'validation period must end before untouched test begins.',
    );
  }
  if (timestamps.testStartDate > timestamps.testEndDate) {
    throw new RangeError('testStartDate must not be after testEndDate.');
  }

  return Object.freeze({
    activeSeason: season,
    fitStartDate,
    fitEndDate,
    validationStartDate,
    validationEndDate,
    testStartDate,
    testEndDate,
  });
}

function validateRecencyCandidate(candidate) {
  const value = assertPlainObject(candidate, 'candidate');
  const candidateId = assertNonEmptyString(value.candidateId, 'candidateId');

  if (value.kind === 'uniform') {
    if (value.halfLifeDays !== undefined && value.halfLifeDays !== null) {
      throw new RangeError('uniform candidate cannot define halfLifeDays.');
    }
    return Object.freeze({ candidateId, kind: 'uniform' });
  }

  if (value.kind !== 'exponential-half-life') {
    throw new RangeError(
      'candidate kind must be uniform or exponential-half-life.',
    );
  }
  if (!Number.isFinite(value.halfLifeDays) || value.halfLifeDays <= 0) {
    throw new RangeError(
      'exponential-half-life candidate requires positive halfLifeDays.',
    );
  }

  return Object.freeze({
    candidateId,
    kind: 'exponential-half-life',
    halfLifeDays: value.halfLifeDays,
  });
}

export function calculateRecencyWeight({
  observedDate,
  asOfDate,
  activeSeason,
  candidate,
}) {
  const observed = assertCurrentSeasonDate(
    observedDate,
    activeSeason,
    'observedDate',
  );
  const asOf = assertCurrentSeasonDate(asOfDate, activeSeason, 'asOfDate');
  if (observed.getTime() > asOf.getTime()) {
    throw new RangeError('observedDate cannot be after asOfDate.');
  }

  const validatedCandidate = validateRecencyCandidate(candidate);
  if (validatedCandidate.kind === 'uniform') {
    return 1;
  }

  const ageDays =
    (asOf.getTime() - observed.getTime()) / MILLISECONDS_PER_DAY;
  return 2 ** (-ageDays / validatedCandidate.halfLifeDays);
}

export function buildFitObservationWeights({
  observations,
  activeSeason,
  windows,
  candidate,
}) {
  if (!Array.isArray(observations) || observations.length === 0) {
    throw new RangeError('fit observations must be a non-empty array.');
  }
  const validatedWindows = validateChronologicalWindows({
    activeSeason,
    ...windows,
  });
  const validatedCandidate = validateRecencyCandidate(candidate);
  const fitStart = parseUtcIsoDate(validatedWindows.fitStartDate).getTime();
  const fitEnd = parseUtcIsoDate(validatedWindows.fitEndDate).getTime();
  const seen = new Set();

  return Object.freeze(
    observations.map((rawObservation, index) => {
      const observation = assertPlainObject(
        rawObservation,
        `observations[${index}]`,
      );
      const observationId = assertNonEmptyString(
        observation.observationId,
        `observations[${index}].observationId`,
      );
      if (seen.has(observationId)) {
        throw new RangeError(`duplicate observationId: ${observationId}`);
      }
      seen.add(observationId);

      const observed = assertCurrentSeasonDate(
        observation.observedDate,
        activeSeason,
        `observations[${index}].observedDate`,
      );
      if (observed.getTime() < fitStart || observed.getTime() > fitEnd) {
        throw new RangeError(
          `fit observation ${observationId} falls outside the fit period.`,
        );
      }

      return Object.freeze({
        observationId,
        observedDate: observation.observedDate,
        weight: calculateRecencyWeight({
          observedDate: observation.observedDate,
          asOfDate: validatedWindows.fitEndDate,
          activeSeason,
          candidate: validatedCandidate,
        }),
      });
    }),
  );
}

export function selectRecencyCandidateFromValidation(results) {
  if (!Array.isArray(results) || results.length < 2) {
    throw new RangeError(
      'validation results must include a uniform baseline and at least one alternative.',
    );
  }

  const seen = new Set();
  const validated = results.map((rawResult, index) => {
    const result = assertPlainObject(rawResult, `results[${index}]`);
    const candidate = validateRecencyCandidate(result.candidate);
    if (seen.has(candidate.candidateId)) {
      throw new RangeError(`duplicate candidateId: ${candidate.candidateId}`);
    }
    seen.add(candidate.candidateId);

    if (
      !Number.isSafeInteger(result.validationObservationCount) ||
      result.validationObservationCount <= 0
    ) {
      throw new RangeError(
        `results[${index}].validationObservationCount must be positive.`,
      );
    }
    if (
      !Number.isFinite(result.validationLogLoss) ||
      result.validationLogLoss < 0
    ) {
      throw new RangeError(
        `results[${index}].validationLogLoss must be finite and non-negative.`,
      );
    }
    if ('testLogLoss' in result || 'testObservationCount' in result) {
      throw new RangeError(
        'untouched test-period metrics cannot participate in candidate selection.',
      );
    }

    return Object.freeze({
      candidate,
      validationObservationCount: result.validationObservationCount,
      validationLogLoss: result.validationLogLoss,
    });
  });

  const baselines = validated.filter(
    (result) => result.candidate.kind === 'uniform',
  );
  if (baselines.length !== 1) {
    throw new RangeError('exactly one uniform validation baseline is required.');
  }

  const sorted = [...validated].sort(
    (left, right) => left.validationLogLoss - right.validationLogLoss,
  );
  if (sorted[0].validationLogLoss === sorted[1].validationLogLoss) {
    throw new RangeError(
      'recency candidate selection is ambiguous at the best validation log loss.',
    );
  }

  const selected = sorted[0];
  const baseline = baselines[0];
  return Object.freeze({
    status:
      selected.candidate.kind === 'uniform'
        ? 'uniform-baseline-retained'
        : 'validated-recency-selected',
    selectedCandidate: selected.candidate,
    validationLogLoss: selected.validationLogLoss,
    uniformBaselineLogLoss: baseline.validationLogLoss,
    validationObservationCount: selected.validationObservationCount,
  });
}

export function selectFinalGamesForDate(body, expectedDate, activeSeason) {
  assertCurrentSeasonDate(expectedDate, activeSeason, 'expectedDate');
  const envelope = assertPlainObject(body, 'BALLDONTLIE games response');
  if (!Array.isArray(envelope.data)) {
    throw new TypeError('BALLDONTLIE games response data must be an array.');
  }

  return Object.freeze(
    envelope.data
      .map((rawGame, index) => {
        const game = assertPlainObject(rawGame, `games[${index}]`);
        if (!Number.isSafeInteger(game.id) || game.id <= 0) {
          throw new TypeError(`games[${index}].id must be a positive integer.`);
        }
        const date = assertNonEmptyString(
          game.date,
          `games[${index}].date`,
        );
        assertCurrentSeasonDate(date, activeSeason, `games[${index}].date`);
        if (date !== expectedDate) {
          throw new RangeError(
            `game ${game.id} date ${date} does not match requested date ${expectedDate}.`,
          );
        }
        const status = assertNonEmptyString(
          game.status,
          `games[${index}].status`,
        );
        return Object.freeze({ id: game.id, date, status });
      })
      .filter((game) => game.status === 'STATUS_FINAL'),
  );
}

export function countPlateAppearances(body) {
  const envelope = assertPlainObject(
    body,
    'BALLDONTLIE plate-appearances response',
  );
  if (!Array.isArray(envelope.data)) {
    throw new TypeError(
      'BALLDONTLIE plate-appearances response data must be an array.',
    );
  }
  return envelope.data.length;
}
