export const FAMILY_B_SHAPE_GATE_VERSION = 'family-b-distribution-shape-gate-v1';
export const FAMILY_B_EQUAL_COUNT_BINNING_RULE = 'equal-count-by-fitted-mean-v1';
export const FAMILY_B_CANONICAL_MINIMUM_BIN_COUNT = 5;
export const FAMILY_B_CANONICAL_MINIMUM_ROWS_PER_BIN = 200;
export const FAMILY_B_CANONICAL_MINIMUM_THRESHOLDS = Object.freeze([1, 2, 3]);
export const FAMILY_B_CANONICAL_TOLERANCE_CEILINGS = Object.freeze({
  tauZero: 0.010,
  tauTail: 0.010,
  tauAlpha: 0.150,
});

const PMF_SUM_TOLERANCE = 1e-9;

function finiteNumber(value) {
  return typeof value === 'number' && Number.isFinite(value);
}

function mean(values) {
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function addFailure(failureReasons, code, message, details = {}) {
  failureReasons.push(Object.freeze({ code, message, ...details }));
}

function sortedUniqueThresholds(values) {
  if (!Array.isArray(values)) return null;
  if (values.some((value) => !Number.isInteger(value) || value < 1)) return null;
  return [...new Set(values)].sort((left, right) => left - right);
}

function validateRow(row, index) {
  if (row === null || typeof row !== 'object') throw new TypeError(`Family B diagnostic row ${index} must be an object.`);
  if (!finiteNumber(row.fittedMean) || !(row.fittedMean > 0)) throw new RangeError(`Family B diagnostic row ${index} fittedMean must be positive and finite.`);
  if (!Number.isInteger(row.observedT) || row.observedT < 0) throw new RangeError(`Family B diagnostic row ${index} observedT must be a nonnegative integer.`);
  if (!Array.isArray(row.predictedProbabilities) || row.predictedProbabilities.length < 4) throw new TypeError(`Family B diagnostic row ${index} predictedProbabilities must contain at least four count masses.`);
  let total = 0;
  row.predictedProbabilities.forEach((probability, probabilityIndex) => {
    if (!finiteNumber(probability) || probability < 0 || probability > 1) throw new RangeError(`Family B diagnostic row ${index} probability ${probabilityIndex} must be in [0,1].`);
    total += probability;
  });
  if (Math.abs(total - 1) > PMF_SUM_TOLERANCE) throw new RangeError(`Family B diagnostic row ${index} predicted probabilities must sum to 1.`);
  return Object.freeze({
    sourceIndex: index,
    fittedMean: row.fittedMean,
    observedT: row.observedT,
    predictedProbabilities: row.predictedProbabilities,
  });
}

function partitionEqualCountByFittedMean(rows, binCount) {
  const sorted = [...rows].sort((left, right) =>
    left.fittedMean - right.fittedMean || left.sourceIndex - right.sourceIndex,
  );
  const bins = Array.from({ length: binCount }, () => []);
  sorted.forEach((row, index) => {
    const binIndex = Math.min(binCount - 1, Math.floor(index * binCount / sorted.length));
    bins[binIndex].push(row);
  });
  return bins;
}

function predictedUpperTail(probabilities, threshold) {
  return probabilities.slice(threshold).reduce((sum, probability) => sum + probability, 0);
}

function predictedLowerTail(probabilities, threshold) {
  return probabilities.slice(0, threshold).reduce((sum, probability) => sum + probability, 0);
}

function summarizeBin(rows, binIndex, settlementThresholds) {
  const fittedMeans = rows.map((row) => row.fittedMean);
  const observedValues = rows.map((row) => row.observedT);
  const alphaNumerator = rows.reduce(
    (sum, row) => sum + (row.observedT - row.fittedMean) ** 2 - row.fittedMean,
    0,
  );
  const alphaDenominator = rows.reduce((sum, row) => sum + row.fittedMean ** 2, 0);
  const impliedAlpha = alphaNumerator / alphaDenominator;
  const observedZeroMass = observedValues.filter((value) => value === 0).length / rows.length;
  const predictedZeroMass = mean(rows.map((row) => row.predictedProbabilities[0]));
  const tails = Object.fromEntries(settlementThresholds.map((threshold) => {
    const observedUpper = observedValues.filter((value) => value >= threshold).length / rows.length;
    const predictedUpper = mean(rows.map((row) => predictedUpperTail(row.predictedProbabilities, threshold)));
    const observedLower = observedValues.filter((value) => value <= threshold - 1).length / rows.length;
    const predictedLower = mean(rows.map((row) => predictedLowerTail(row.predictedProbabilities, threshold)));
    return [String(threshold), Object.freeze({
      threshold,
      upper: Object.freeze({
        observed: observedUpper,
        predicted: predictedUpper,
        observedMinusPredicted: observedUpper - predictedUpper,
      }),
      lower: Object.freeze({
        observed: observedLower,
        predicted: predictedLower,
        observedMinusPredicted: observedLower - predictedLower,
      }),
    })];
  }));
  return Object.freeze({
    binIndex,
    rowCount: rows.length,
    fittedMeanRange: Object.freeze({
      minimum: Math.min(...fittedMeans),
      maximum: Math.max(...fittedMeans),
    }),
    meanFittedMu: mean(fittedMeans),
    observedMeanT: mean(observedValues),
    impliedAlpha,
    zeroMass: Object.freeze({
      observed: observedZeroMass,
      predicted: predictedZeroMass,
      observedMinusPredicted: observedZeroMass - predictedZeroMass,
    }),
    tails: Object.freeze(tails),
  });
}

function maximumAbsolute(values) {
  return Math.max(...values.map((value) => Math.abs(value)));
}

export function evaluateFamilyBDistributionShapeGate(rowsInput, configuration = {}) {
  const failureReasons = [];
  const binCount = configuration.binCount;
  const minimumRowsPerBin = configuration.minimumRowsPerBin;
  const settlementThresholds = sortedUniqueThresholds(configuration.settlementThresholds);
  const liveRequiredThresholds = sortedUniqueThresholds(configuration.liveRequiredSettlementThresholds);
  const tolerances = configuration.tolerances ?? {};

  if (configuration.binningRule !== FAMILY_B_EQUAL_COUNT_BINNING_RULE) {
    addFailure(failureReasons, 'BINNING_RULE_UNDECLARED_OR_UNSUPPORTED', 'The fitted-mu binning rule must be declared as equal-count-by-fitted-mean-v1.');
  }
  if (!Number.isInteger(binCount) || binCount < FAMILY_B_CANONICAL_MINIMUM_BIN_COUNT) {
    addFailure(failureReasons, 'BIN_COUNT_BELOW_MINIMUM', `At least ${FAMILY_B_CANONICAL_MINIMUM_BIN_COUNT} fitted-mu bins are required.`, { binCount: binCount ?? null });
  }
  if (!Number.isInteger(minimumRowsPerBin) || minimumRowsPerBin < FAMILY_B_CANONICAL_MINIMUM_ROWS_PER_BIN) {
    addFailure(failureReasons, 'MINIMUM_ROWS_PER_BIN_UNDECLARED_OR_TOO_SMALL', `The declared minimum rows per bin must be at least ${FAMILY_B_CANONICAL_MINIMUM_ROWS_PER_BIN}.`, { minimumRowsPerBin: minimumRowsPerBin ?? null });
  }

  if (settlementThresholds === null) {
    addFailure(failureReasons, 'SETTLEMENT_THRESHOLDS_UNDECLARED', 'Settlement thresholds must be declared as positive integer count thresholds.');
  }
  if (liveRequiredThresholds === null) {
    addFailure(failureReasons, 'LIVE_THRESHOLDS_UNDECLARED', 'Required live settlement thresholds must be declared before gate evaluation.');
  }
  const requiredThresholds = [...new Set([
    ...FAMILY_B_CANONICAL_MINIMUM_THRESHOLDS,
    ...(liveRequiredThresholds ?? []),
  ])].sort((left, right) => left - right);
  if (settlementThresholds !== null) {
    requiredThresholds.forEach((threshold) => {
      if (!settlementThresholds.includes(threshold)) {
        addFailure(failureReasons, 'MISSING_REQUIRED_THRESHOLD', `Required settlement threshold ${threshold} is missing from the diagnostic.`, { threshold });
      }
    });
  }

  for (const key of ['tauZero', 'tauTail', 'tauAlpha']) {
    const value = tolerances[key];
    if (!finiteNumber(value) || value < 0) {
      addFailure(failureReasons, 'UNDECLARED_TOLERANCE', `${key} must be declared as a finite nonnegative tolerance before evaluation.`, { tolerance: key, value: value ?? null });
      continue;
    }
    const ceiling = FAMILY_B_CANONICAL_TOLERANCE_CEILINGS[key];
    if (value > ceiling) {
      addFailure(failureReasons, 'TOLERANCE_ABOVE_CANONICAL_CEILING', `${key}=${value} is looser than the canonical ceiling ${ceiling}.`, { tolerance: key, value, ceiling });
    }
  }

  if (!Array.isArray(rowsInput) || rowsInput.length === 0) {
    addFailure(failureReasons, 'FITTING_ROWS_MISSING', 'Fitting rows are required for the distribution-shape diagnostic.');
    return Object.freeze({
      gateVersion: FAMILY_B_SHAPE_GATE_VERSION,
      verdict: 'FAIL',
      passed: false,
      configuration: Object.freeze({
        binningRule: configuration.binningRule ?? null,
        binCount: binCount ?? null,
        minimumRowsPerBin: minimumRowsPerBin ?? null,
        settlementThresholds: settlementThresholds ?? null,
        liveRequiredSettlementThresholds: liveRequiredThresholds ?? null,
        tolerances: Object.freeze({ tauZero: tolerances.tauZero ?? null, tauTail: tolerances.tauTail ?? null, tauAlpha: tolerances.tauAlpha ?? null }),
      }),
      bins: Object.freeze([]),
      summary: null,
      failureReasons: Object.freeze(failureReasons),
    });
  }

  const rows = rowsInput.map(validateRow);
  const effectiveBinCount = Number.isInteger(binCount) && binCount > 0 ? binCount : 1;
  const effectiveThresholds = settlementThresholds ?? requiredThresholds;
  const bins = partitionEqualCountByFittedMean(rows, effectiveBinCount);
  bins.forEach((binRows, binIndex) => {
    if (binRows.length < FAMILY_B_CANONICAL_MINIMUM_ROWS_PER_BIN) {
      addFailure(failureReasons, 'BIN_ROW_COUNT_BELOW_MINIMUM', `Fitted-mu bin ${binIndex} contains ${binRows.length} rows, below the canonical minimum ${FAMILY_B_CANONICAL_MINIMUM_ROWS_PER_BIN}.`, { binIndex, rowCount: binRows.length });
    }
    if (Number.isInteger(minimumRowsPerBin) && binRows.length < minimumRowsPerBin) {
      addFailure(failureReasons, 'BIN_ROW_COUNT_BELOW_DECLARED_MINIMUM', `Fitted-mu bin ${binIndex} contains ${binRows.length} rows, below the declared minimum ${minimumRowsPerBin}.`, { binIndex, rowCount: binRows.length, minimumRowsPerBin });
    }
  });

  const summarizedBins = bins.filter((binRows) => binRows.length > 0).map((binRows, binIndex) => summarizeBin(binRows, binIndex, effectiveThresholds));
  const impliedAlphas = summarizedBins.map((bin) => bin.impliedAlpha);
  const alphaRange = impliedAlphas.length > 0 ? Math.max(...impliedAlphas) - Math.min(...impliedAlphas) : null;
  const maxZeroGap = summarizedBins.length > 0 ? maximumAbsolute(summarizedBins.map((bin) => bin.zeroMass.observedMinusPredicted)) : null;
  const maxTailGapByThreshold = Object.fromEntries(effectiveThresholds.map((threshold) => {
    const upper = maximumAbsolute(summarizedBins.map((bin) => bin.tails[String(threshold)].upper.observedMinusPredicted));
    const lower = maximumAbsolute(summarizedBins.map((bin) => bin.tails[String(threshold)].lower.observedMinusPredicted));
    return [String(threshold), Object.freeze({ threshold, upper, lower, maximum: Math.max(upper, lower) })];
  }));

  const tauAlpha = finiteNumber(tolerances.tauAlpha) ? tolerances.tauAlpha : null;
  const tauZero = finiteNumber(tolerances.tauZero) ? tolerances.tauZero : null;
  const tauTail = finiteNumber(tolerances.tauTail) ? tolerances.tauTail : null;
  const alphaPassed = alphaRange !== null && tauAlpha !== null ? alphaRange <= tauAlpha : false;
  const zeroPassed = maxZeroGap !== null && tauZero !== null ? maxZeroGap <= tauZero : false;
  const tailPassedByThreshold = Object.fromEntries(effectiveThresholds.map((threshold) => [
    String(threshold),
    tauTail !== null ? maxTailGapByThreshold[String(threshold)].maximum <= tauTail : false,
  ]));
  const allTailsPassed = Object.values(tailPassedByThreshold).every(Boolean);

  if (alphaRange !== null && tauAlpha !== null && alphaRange > tauAlpha) {
    addFailure(failureReasons, 'ALPHA_RANGE_EXCEEDED', `Implied-alpha range ${alphaRange} exceeds tauAlpha ${tauAlpha}.`, { alphaRange, tauAlpha });
  }
  if (maxZeroGap !== null && tauZero !== null && maxZeroGap > tauZero) {
    addFailure(failureReasons, 'ZERO_MASS_GAP_EXCEEDED', `Maximum absolute zero-mass gap ${maxZeroGap} exceeds tauZero ${tauZero}.`, { maxZeroGap, tauZero });
  }
  if (tauTail !== null) {
    effectiveThresholds.forEach((threshold) => {
      const maximum = maxTailGapByThreshold[String(threshold)].maximum;
      if (maximum > tauTail) {
        addFailure(failureReasons, 'TAIL_GAP_EXCEEDED', `Maximum absolute tail gap at threshold ${threshold} is ${maximum}, exceeding tauTail ${tauTail}.`, { threshold, maxTailGap: maximum, tauTail });
      }
    });
  }

  const structuralFailureCodes = new Set([
    'BINNING_RULE_UNDECLARED_OR_UNSUPPORTED',
    'BIN_COUNT_BELOW_MINIMUM',
    'MINIMUM_ROWS_PER_BIN_UNDECLARED_OR_TOO_SMALL',
    'SETTLEMENT_THRESHOLDS_UNDECLARED',
    'LIVE_THRESHOLDS_UNDECLARED',
    'MISSING_REQUIRED_THRESHOLD',
    'UNDECLARED_TOLERANCE',
    'TOLERANCE_ABOVE_CANONICAL_CEILING',
    'FITTING_ROWS_MISSING',
    'BIN_ROW_COUNT_BELOW_MINIMUM',
    'BIN_ROW_COUNT_BELOW_DECLARED_MINIMUM',
  ]);
  const structuralFailure = failureReasons.some((reason) => structuralFailureCodes.has(reason.code));

  return Object.freeze({
    gateVersion: FAMILY_B_SHAPE_GATE_VERSION,
    verdict: failureReasons.length === 0 ? 'PASS' : 'FAIL',
    passed: failureReasons.length === 0,
    configuration: Object.freeze({
      binningRule: configuration.binningRule ?? null,
      binCount: binCount ?? null,
      minimumRowsPerBin: minimumRowsPerBin ?? null,
      settlementThresholds: settlementThresholds ?? null,
      liveRequiredSettlementThresholds: liveRequiredThresholds ?? null,
      tolerances: Object.freeze({ tauZero: tauZero ?? null, tauTail: tauTail ?? null, tauAlpha: tauAlpha ?? null }),
    }),
    bins: Object.freeze(summarizedBins),
    summary: Object.freeze({
      alphaRange,
      maxZeroGap,
      maxTailGapByThreshold: Object.freeze(maxTailGapByThreshold),
      substantiveChecks: Object.freeze({
        alphaRange: Object.freeze({ passed: alphaPassed, value: alphaRange, tolerance: tauAlpha }),
        zeroMass: Object.freeze({ passed: zeroPassed, value: maxZeroGap, tolerance: tauZero }),
        tails: Object.freeze({
          passed: allTailsPassed,
          byThreshold: Object.freeze(tailPassedByThreshold),
          tolerance: tauTail,
        }),
      }),
      structuralFailure,
    }),
    failureReasons: Object.freeze(failureReasons),
  });
}
