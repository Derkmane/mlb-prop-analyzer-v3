const PREDICTOR_ORDER = Object.freeze([
  'contextHitQualityLogit',
  'centeredLineupSlot',
  'platoonSplitCell',
  'opposingStarterPooling',
  'teamImpliedRunTotal',
  'precedingLineupSlotsOnBaseQuality',
]);

export const CONTINUATION_PREDICTOR_ORDER = Object.freeze([
  'logExpectedPlateAppearances',
  ...PREDICTOR_ORDER,
]);

export const CONTINUATION_THRESHOLDS = Object.freeze([0, 1, 2, 3, 4, 5, 6, 7]);
export const REQUIRED_SETTLEMENT_THRESHOLDS = Object.freeze([1, 2, 3]);
export const FIT_BIN_COUNT = 5;
export const MINIMUM_ROWS_PER_BIN = 200;
export const TAU_ZERO = 0.01;
export const TAU_TAIL = 0.01;

function finite(value, label) {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new TypeError(`${label} must be finite.`);
  }
  return value;
}

function sigmoid(value) {
  if (value >= 0) {
    const expNegative = Math.exp(-value);
    return 1 / (1 + expNegative);
  }
  const expValue = Math.exp(value);
  return expValue / (1 + expValue);
}

function logSigmoid(value) {
  return value >= 0
    ? -Math.log1p(Math.exp(-value))
    : value - Math.log1p(Math.exp(value));
}

function logOneMinusSigmoid(value) {
  return value >= 0
    ? -value - Math.log1p(Math.exp(-value))
    : -Math.log1p(Math.exp(value));
}

function mean(values) {
  if (values.length === 0) throw new Error('Cannot calculate a mean of zero values.');
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function solveLinearSystem(matrixInput, vectorInput, label) {
  const size = vectorInput.length;
  if (matrixInput.length !== size || matrixInput.some((row) => row.length !== size)) {
    throw new Error(`${label} dimensions are invalid.`);
  }
  const matrix = matrixInput.map((row, index) => [...row, vectorInput[index]]);
  for (let column = 0; column < size; column += 1) {
    let pivot = column;
    for (let row = column + 1; row < size; row += 1) {
      if (Math.abs(matrix[row][column]) > Math.abs(matrix[pivot][column])) pivot = row;
    }
    const pivotMagnitude = Math.abs(matrix[pivot][column]);
    if (!Number.isFinite(pivotMagnitude) || pivotMagnitude < 1e-12) {
      throw new Error(`${label} is singular at column ${column}.`);
    }
    [matrix[column], matrix[pivot]] = [matrix[pivot], matrix[column]];
    const divisor = matrix[column][column];
    for (let entry = column; entry <= size; entry += 1) matrix[column][entry] /= divisor;
    for (let row = 0; row < size; row += 1) {
      if (row === column) continue;
      const factor = matrix[row][column];
      if (factor === 0) continue;
      for (let entry = column; entry <= size; entry += 1) {
        matrix[row][entry] -= factor * matrix[column][entry];
      }
    }
  }
  const solution = matrix.map((row) => row[size]);
  if (solution.some((value) => !Number.isFinite(value))) {
    throw new Error(`${label} produced a non-finite solution.`);
  }
  return solution;
}

function readSixPredictors(row) {
  return {
    contextHitQualityLogit: finite(row.derivedPredictors?.contextHitQualityLogit, 'contextHitQualityLogit'),
    centeredLineupSlot: finite(row.derivedPredictors?.centeredLineupSlot, 'centeredLineupSlot'),
    platoonSplitCell: finite(row.conditioningInputs?.platoonSplitCell, 'platoonSplitCell'),
    opposingStarterPooling: finite(row.conditioningInputs?.opposingStarterPooling, 'opposingStarterPooling'),
    teamImpliedRunTotal: finite(row.conditioningInputs?.teamImpliedRunTotal, 'teamImpliedRunTotal'),
    precedingLineupSlotsOnBaseQuality: finite(
      row.conditioningInputs?.precedingLineupSlotsOnBaseQuality,
      'precedingLineupSlotsOnBaseQuality',
    ),
  };
}

export function buildContinuationRows(fixture, diagnostics) {
  if (!fixture || !Array.isArray(fixture.rows) || fixture.rows.length !== 5964) {
    throw new Error('HHR continuation-ratio fit requires the approved 5,964-row fitting cohort.');
  }
  if (fixture.schemaVersion !== 3) throw new Error('HHR fitting fixture schemaVersion must remain 3.');
  const transforms = diagnostics?.predictorTransforms;
  if (!transforms || typeof transforms !== 'object') {
    throw new Error('Frozen HHR predictor transforms are required.');
  }
  return fixture.rows.map((row, sourceIndex) => {
    const target = finite(row.targetT, `targetT row ${sourceIndex}`);
    if (!Number.isInteger(target) || target < 0) throw new Error(`targetT row ${sourceIndex} must be a nonnegative integer.`);
    const expectedPlateAppearances = finite(
      row.conditioningInputs?.expectedPlateAppearances,
      `expectedPlateAppearances row ${sourceIndex}`,
    );
    if (!(expectedPlateAppearances > 0)) throw new Error(`expectedPlateAppearances row ${sourceIndex} must be positive.`);
    const raw = readSixPredictors(row);
    const standardized = PREDICTOR_ORDER.map((name) => {
      const transform = transforms[name];
      if (!transform || !Number.isFinite(transform.mean) || !(transform.standardDeviation > 0)) {
        throw new Error(`Frozen transform for ${name} is invalid.`);
      }
      return (raw[name] - transform.mean) / transform.standardDeviation;
    });
    return Object.freeze({
      sourceIndex,
      target,
      predictors: Object.freeze([Math.log(expectedPlateAppearances), ...standardized]),
    });
  });
}

function buildTransitionObservations(rows) {
  const observations = [];
  for (const row of rows) {
    for (const threshold of CONTINUATION_THRESHOLDS) {
      if (row.target < threshold) break;
      observations.push(Object.freeze({
        sourceIndex: row.sourceIndex,
        threshold,
        y: row.target >= threshold + 1 ? 1 : 0,
        predictors: row.predictors,
      }));
    }
  }
  return observations;
}

function parameterVectorToNamed(parameters) {
  return Object.freeze({
    thresholdIntercepts: Object.freeze(CONTINUATION_THRESHOLDS.map((threshold) => parameters[threshold])),
    sharedSlopes: Object.freeze(Object.fromEntries(
      CONTINUATION_PREDICTOR_ORDER.map((name, index) => [name, parameters[8 + index]]),
    )),
  });
}

function logLikelihood(observations, parameters) {
  let value = 0;
  for (const observation of observations) {
    let eta = parameters[observation.threshold];
    for (let index = 0; index < observation.predictors.length; index += 1) {
      eta += parameters[8 + index] * observation.predictors[index];
    }
    value += observation.y === 1 ? logSigmoid(eta) : logOneMinusSigmoid(eta);
  }
  if (!Number.isFinite(value)) throw new Error('Continuation-ratio log likelihood became non-finite.');
  return value;
}

function scoreAndInformation(observations, parameters) {
  const size = parameters.length;
  const score = Array(size).fill(0);
  const information = Array.from({ length: size }, () => Array(size).fill(0));
  for (const observation of observations) {
    let eta = parameters[observation.threshold];
    for (let index = 0; index < observation.predictors.length; index += 1) {
      eta += parameters[8 + index] * observation.predictors[index];
    }
    const probability = sigmoid(eta);
    if (!(probability > 0 && probability < 1) || !Number.isFinite(probability)) {
      throw new Error('Continuation probability numerically saturated during fitting.');
    }
    const residual = observation.y - probability;
    const weight = probability * (1 - probability);
    const indices = [observation.threshold, ...observation.predictors.map((_, index) => 8 + index)];
    const values = [1, ...observation.predictors];
    for (let left = 0; left < indices.length; left += 1) {
      score[indices[left]] += values[left] * residual;
      for (let right = 0; right < indices.length; right += 1) {
        information[indices[left]][indices[right]] += weight * values[left] * values[right];
      }
    }
  }
  return { score, information };
}

function initialParameters(rows) {
  const parameters = Array(15).fill(0);
  for (const threshold of CONTINUATION_THRESHOLDS) {
    const exposed = rows.filter((row) => row.target >= threshold);
    const successes = exposed.filter((row) => row.target >= threshold + 1).length;
    if (successes === 0 || successes === exposed.length) {
      throw new Error(`Threshold ${threshold} lacks both continuation outcomes.`);
    }
    const probability = successes / exposed.length;
    parameters[threshold] = Math.log(probability / (1 - probability));
  }
  return parameters;
}

export function fitContinuationRatio(rows, options = {}) {
  const maxIterations = options.maxIterations ?? 80;
  const scoreTolerance = options.scoreTolerance ?? 1e-8;
  const observations = buildTransitionObservations(rows);
  let parameters = initialParameters(rows);
  let currentLogLikelihood = logLikelihood(observations, parameters);
  let iterations = 0;
  let maxAbsScore = Infinity;

  for (let iteration = 0; iteration < maxIterations; iteration += 1) {
    iterations = iteration + 1;
    const { score, information } = scoreAndInformation(observations, parameters);
    maxAbsScore = Math.max(...score.map((value) => Math.abs(value)));
    if (maxAbsScore <= scoreTolerance) break;
    const step = solveLinearSystem(information, score, 'HHR continuation-ratio information matrix');
    let scale = 1;
    let accepted = false;
    while (scale >= 2 ** -24) {
      const proposal = parameters.map((value, index) => value + scale * step[index]);
      const proposalLogLikelihood = logLikelihood(observations, proposal);
      if (proposalLogLikelihood >= currentLogLikelihood - 1e-12) {
        parameters = proposal;
        currentLogLikelihood = proposalLogLikelihood;
        accepted = true;
        break;
      }
      scale /= 2;
    }
    if (!accepted) throw new Error('HHR continuation-ratio Newton line search failed.');
  }

  const final = scoreAndInformation(observations, parameters);
  maxAbsScore = Math.max(...final.score.map((value) => Math.abs(value)));
  if (maxAbsScore > scoreTolerance) {
    throw new Error(`HHR continuation-ratio fit did not converge: maxAbsScore=${maxAbsScore}.`);
  }
  return Object.freeze({
    parameters: Object.freeze([...parameters]),
    namedParameters: parameterVectorToNamed(parameters),
    observations: observations.length,
    iterations,
    logLikelihood: currentLogLikelihood,
    maxAbsScore,
    scoreTolerance,
  });
}

export function predictContinuationDistribution(row, fit) {
  const continuations = CONTINUATION_THRESHOLDS.map((threshold) => {
    let eta = fit.parameters[threshold];
    for (let index = 0; index < row.predictors.length; index += 1) {
      eta += fit.parameters[8 + index] * row.predictors[index];
    }
    const value = sigmoid(eta);
    if (!(value > 0 && value < 1) || !Number.isFinite(value)) {
      throw new Error(`Continuation probability at threshold ${threshold} is numerically invalid.`);
    }
    return value;
  });

  const survival = [1];
  for (const continuation of continuations) survival.push(survival.at(-1) * continuation);
  const pmf = [];
  pmf.push(1 - continuations[0]);
  for (let target = 1; target <= 7; target += 1) {
    pmf.push(survival[target] * (1 - continuations[target]));
  }
  const terminalTail = survival[8];
  const mass = pmf.reduce((sum, value) => sum + value, 0) + terminalTail;
  if (!Number.isFinite(mass) || Math.abs(mass - 1) > 1e-12) {
    throw new Error(`Continuation-ratio PMF does not conserve mass: ${mass}.`);
  }
  for (let threshold = 0; threshold < 8; threshold += 1) {
    if (!(survival[threshold + 1] < survival[threshold])) {
      throw new Error(`Continuation survival is not strictly decreasing at threshold ${threshold}.`);
    }
  }
  const terminalPartitionMean = survival.slice(1).reduce((sum, value) => sum + value, 0);
  return Object.freeze({
    continuations: Object.freeze(continuations),
    survival: Object.freeze(survival),
    pmfExact0Through7: Object.freeze(pmf),
    terminalTail,
    terminalPartitionMean,
  });
}

function makeEqualCountBins(evaluatedRows) {
  const sorted = [...evaluatedRows].sort((left, right) =>
    left.prediction.terminalPartitionMean - right.prediction.terminalPartitionMean || left.sourceIndex - right.sourceIndex,
  );
  return Array.from({ length: FIT_BIN_COUNT }, (_, binIndex) => sorted.filter((_, index) =>
    Math.floor(index * FIT_BIN_COUNT / sorted.length) === binIndex,
  ));
}

function tailRecord(binRows, threshold) {
  const observedUpper = mean(binRows.map((row) => row.target >= threshold ? 1 : 0));
  const predictedUpper = mean(binRows.map((row) => row.prediction.survival[threshold]));
  const observedLower = 1 - observedUpper;
  const predictedLower = 1 - predictedUpper;
  return Object.freeze({
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
  });
}

function impliedAlpha(binRows) {
  let numerator = 0;
  let denominator = 0;
  for (const row of binRows) {
    const mu = row.prediction.terminalPartitionMean;
    numerator += (row.target - mu) ** 2 - mu;
    denominator += mu ** 2;
  }
  return numerator / denominator;
}

function numericalMonotonicity(binRows) {
  const meanSurvival = Array.from({ length: 9 }, (_, threshold) =>
    mean(binRows.map((row) => row.prediction.survival[threshold])),
  );
  const meanLower = meanSurvival.map((value) => 1 - value);
  const adjacent = [];
  let passed = true;
  for (let threshold = 0; threshold < 8; threshold += 1) {
    const upperDelta = meanSurvival[threshold + 1] - meanSurvival[threshold];
    const lowerDelta = meanLower[threshold + 1] - meanLower[threshold];
    const pairPassed = Number.isFinite(upperDelta) && Number.isFinite(lowerDelta) && upperDelta < 0 && lowerDelta > 0;
    passed &&= pairPassed;
    adjacent.push(Object.freeze({ threshold, upperDelta, lowerDelta, passed: pairPassed }));
  }
  return Object.freeze({
    passed,
    meanSurvival: Object.freeze(meanSurvival),
    meanComplementaryLower: Object.freeze(meanLower),
    adjacent: Object.freeze(adjacent),
  });
}

export function diagnoseContinuationRatio(rows, fit) {
  const evaluatedRows = rows.map((row) => Object.freeze({
    sourceIndex: row.sourceIndex,
    target: row.target,
    prediction: predictContinuationDistribution(row, fit),
  }));
  const bins = makeEqualCountBins(evaluatedRows).map((binRows, binIndex) => {
    if (binRows.length < MINIMUM_ROWS_PER_BIN) {
      throw new Error(`HHR continuation bin ${binIndex} has only ${binRows.length} rows.`);
    }
    const zeroObserved = mean(binRows.map((row) => row.target === 0 ? 1 : 0));
    const zeroPredicted = mean(binRows.map((row) => row.prediction.pmfExact0Through7[0]));
    const tails = Object.fromEntries(REQUIRED_SETTLEMENT_THRESHOLDS.map((threshold) => [threshold, tailRecord(binRows, threshold)]));
    return Object.freeze({
      binIndex,
      rowCount: binRows.length,
      fittedMeanRange: Object.freeze({
        minimum: Math.min(...binRows.map((row) => row.prediction.terminalPartitionMean)),
        maximum: Math.max(...binRows.map((row) => row.prediction.terminalPartitionMean)),
      }),
      meanFittedMu: mean(binRows.map((row) => row.prediction.terminalPartitionMean)),
      fittedMuDefinition: 'E[min(T,8)] from exact continuation partition; terminal T>=8 retained as one tail bucket',
      observedMeanT: mean(binRows.map((row) => row.target)),
      impliedAlpha: impliedAlpha(binRows),
      impliedAlphaStatus: 'INFORMATIONAL_ONLY_FOR_HHR_CONTINUATION_RATIO_V1_14',
      zeroMass: Object.freeze({
        observed: zeroObserved,
        predicted: zeroPredicted,
        observedMinusPredicted: zeroObserved - zeroPredicted,
      }),
      tails: Object.freeze(tails),
      numericalMonotonicity: numericalMonotonicity(binRows),
    });
  });

  const maxZeroGap = Math.max(...bins.map((bin) => Math.abs(bin.zeroMass.observedMinusPredicted)));
  const maxTailGapByThreshold = Object.fromEntries(REQUIRED_SETTLEMENT_THRESHOLDS.map((threshold) => {
    const upper = Math.max(...bins.map((bin) => Math.abs(bin.tails[threshold].upper.observedMinusPredicted)));
    const lower = Math.max(...bins.map((bin) => Math.abs(bin.tails[threshold].lower.observedMinusPredicted)));
    return [threshold, Object.freeze({ threshold, upper, lower, maximum: Math.max(upper, lower) })];
  }));
  const monotonicityPassed = bins.every((bin) => bin.numericalMonotonicity.passed);
  const zeroPassed = maxZeroGap <= TAU_ZERO;
  const tailsPassed = Object.values(maxTailGapByThreshold).every((entry) => entry.maximum <= TAU_TAIL);
  const passed = zeroPassed && tailsPassed && monotonicityPassed;
  return Object.freeze({
    bins: Object.freeze(bins),
    summary: Object.freeze({
      maxZeroGap,
      maxTailGapByThreshold: Object.freeze(maxTailGapByThreshold),
      zeroPassed,
      tailsPassed,
      monotonicityPassed,
      alphaImpliedAcceptanceRole: 'INFORMATIONAL_ONLY',
      passed,
      verdict: passed ? 'PASS' : 'FAIL',
    }),
  });
}

export function fitAndDiagnoseContinuationRatio(fixture, diagnostics, options = {}) {
  const rows = buildContinuationRows(fixture, diagnostics);
  const fit = fitContinuationRatio(rows, options);
  const diagnostic = diagnoseContinuationRatio(rows, fit);
  return Object.freeze({
    contract: Object.freeze({
      model: 'HHR_CONTINUATION_RATIO_V1_14_CANDIDATE',
      fittingRows: rows.length,
      thresholds: CONTINUATION_THRESHOLDS,
      requiredSettlementThresholds: REQUIRED_SETTLEMENT_THRESHOLDS,
      predictorOrder: CONTINUATION_PREDICTOR_ORDER,
      binningRule: 'equal-count-by-fitted-mean-v1',
      binCount: FIT_BIN_COUNT,
      minimumRowsPerBin: MINIMUM_ROWS_PER_BIN,
      tauZero: TAU_ZERO,
      tauTail: TAU_TAIL,
      untouchedEvidenceRead: false,
      candidateFrozen: false,
      productionEnabled: false,
      rankingEnabled: false,
    }),
    fit,
    diagnostic,
  });
}
