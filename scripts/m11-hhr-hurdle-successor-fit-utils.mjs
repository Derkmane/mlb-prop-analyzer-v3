export const HHR_SUCCESSOR_PREDICTOR_ORDER = Object.freeze([
  'contextHitQualityLogit',
  'centeredLineupSlot',
  'platoonSplitCell',
  'opposingStarterPooling',
  'teamImpliedRunTotal',
  'precedingLineupSlotsOnBaseQuality',
]);

export const HHR_CONDITIONED_HURDLE_ZERO_COMPONENT = Object.freeze({
  contract: 'logit(rho)=gamma_0+gamma_1*expectedPlateAppearances+gamma_2*lineupSlot+gamma_3*contextHitQualityLogit',
  conditioningInputs: Object.freeze(['expectedPlateAppearances', 'lineupSlot', 'contextHitQualityLogit']),
  rawCoefficients: Object.freeze({
    intercept: -0.3156807637150578,
    expectedPlateAppearances: -0.4421437691851488,
    lineupSlot: 0.010153949897632894,
    contextHitQualityLogit: -1.0649822595037404,
  }),
  sourceZeroComponentLogLikelihood: -3754.590890898882,
  sourceMeanFittedRho: 0.3314889336132869,
  sourceOptimizer: 'deterministic Newton-Raphson logistic maximum likelihood with monotone line search',
});

export const HHR_SUCCESSOR_GATE = Object.freeze({
  version: 'm11-hhr-hurdle-successor-shape-gate-v1',
  binningRule: 'equal-count-by-fitted-mean-v1',
  binCount: 5,
  minimumRowsPerBin: 200,
  thresholds: Object.freeze([1, 2, 3]),
  tauZero: 0.010,
  tauTail: 0.010,
  alphaImpliedStatus: 'INFORMATIONAL',
});

const LOG_TWO_PI_OVER_TWO = 0.9189385332046727;
const LANCZOS = Object.freeze([
  676.5203681218851,
  -1259.1392167224028,
  771.32342877765313,
  -176.61502916214059,
  12.507343278686905,
  -0.13857109526572012,
  9.9843695780195716e-6,
  1.5056327351493116e-7,
]);

function finite(value, label) {
  if (typeof value !== 'number' || !Number.isFinite(value)) throw new TypeError(`${label} must be finite.`);
  return value;
}

export function logGamma(value) {
  finite(value, 'logGamma value');
  if (!(value > 0)) throw new RangeError('logGamma value must be positive.');
  if (value < 0.5) return Math.log(Math.PI) - Math.log(Math.sin(Math.PI * value)) - logGamma(1 - value);
  const z = value - 1;
  let series = 0.99999999999980993;
  for (let index = 0; index < LANCZOS.length; index += 1) series += LANCZOS[index] / (z + index + 1);
  const t = z + LANCZOS.length - 0.5;
  return LOG_TWO_PI_OVER_TWO + (z + 0.5) * Math.log(t) - t + Math.log(series);
}

export function nb2LogPmf(count, mean, alpha) {
  if (!Number.isInteger(count) || count < 0) throw new RangeError('NB2 count must be a nonnegative integer.');
  finite(mean, 'NB2 mean');
  finite(alpha, 'NB2 alpha');
  if (!(mean > 0) || !(alpha > 0)) throw new RangeError('NB2 mean and alpha must be positive.');
  const size = 1 / alpha;
  const denominator = size + mean;
  return logGamma(count + size) - logGamma(size) - logGamma(count + 1)
    + size * (Math.log(size) - Math.log(denominator))
    + count * (Math.log(mean) - Math.log(denominator));
}

export function nb2Pmf(count, mean, alpha) {
  return Math.exp(nb2LogPmf(count, mean, alpha));
}

export function zeroTruncatedNb2LogPmf(count, mean, alpha) {
  if (!Number.isInteger(count) || count < 1) throw new RangeError('Zero-truncated NB2 count must be a positive integer.');
  const logP0 = nb2LogPmf(0, mean, alpha);
  const logPositiveMass = Math.log(-Math.expm1(logP0));
  return nb2LogPmf(count, mean, alpha) - logPositiveMass;
}

export function zeroTruncatedNb2Pmf(count, mean, alpha) {
  return Math.exp(zeroTruncatedNb2LogPmf(count, mean, alpha));
}

export function sigmoid(value) {
  finite(value, 'sigmoid input');
  if (value >= 0) {
    const e = Math.exp(-value);
    return 1 / (1 + e);
  }
  const e = Math.exp(value);
  return e / (1 + e);
}

export function conditionedHurdleZeroProbability(raw, component = HHR_CONDITIONED_HURDLE_ZERO_COMPONENT) {
  const coefficients = component.rawCoefficients;
  const linear = coefficients.intercept
    + coefficients.expectedPlateAppearances * finite(raw.expectedPlateAppearances, 'expectedPlateAppearances')
    + coefficients.lineupSlot * finite(raw.lineupSlot, 'lineupSlot')
    + coefficients.contextHitQualityLogit * finite(raw.contextHitQualityLogit, 'contextHitQualityLogit');
  return sigmoid(linear);
}

function dot(left, right) {
  let sum = 0;
  for (let index = 0; index < left.length; index += 1) sum += left[index] * right[index];
  return sum;
}

function identity(size) {
  return Array.from({ length: size }, (_, row) => Array.from({ length: size }, (_, column) => row === column ? 1 : 0));
}

function multiplyMatrixVector(matrix, vector) {
  return matrix.map((row) => dot(row, vector));
}

function maximumAbsolute(values) {
  return Math.max(...values.map((value) => Math.abs(value)));
}

function numericalGradient(objective, parameters) {
  const gradient = [];
  for (let index = 0; index < parameters.length; index += 1) {
    const step = 1e-5 * (1 + Math.abs(parameters[index]));
    const plus = [...parameters];
    const minus = [...parameters];
    plus[index] += step;
    minus[index] -= step;
    const plusValue = objective(plus);
    const minusValue = objective(minus);
    if (Number.isFinite(plusValue) && Number.isFinite(minusValue)) {
      gradient.push((plusValue - minusValue) / (2 * step));
    } else {
      const base = objective(parameters);
      if (!Number.isFinite(base) || !Number.isFinite(plusValue)) throw new Error('Successor likelihood gradient became non-finite.');
      gradient.push((plusValue - base) / step);
    }
  }
  return gradient;
}

function inverseBfgsUpdate(hessianInverse, stepVector, gradientChange) {
  const ys = dot(gradientChange, stepVector);
  if (!(ys > 1e-12) || !Number.isFinite(ys)) return identity(stepVector.length);
  const rho = 1 / ys;
  const size = stepVector.length;
  const left = Array.from({ length: size }, (_, row) => Array.from({ length: size }, (_, column) =>
    (row === column ? 1 : 0) - rho * stepVector[row] * gradientChange[column],
  ));
  const right = Array.from({ length: size }, (_, row) => Array.from({ length: size }, (_, column) =>
    (row === column ? 1 : 0) - rho * gradientChange[row] * stepVector[column],
  ));
  const temp = Array.from({ length: size }, () => Array(size).fill(0));
  for (let row = 0; row < size; row += 1) {
    for (let middle = 0; middle < size; middle += 1) {
      for (let column = 0; column < size; column += 1) temp[row][column] += left[row][middle] * hessianInverse[middle][column];
    }
  }
  const updated = Array.from({ length: size }, () => Array(size).fill(0));
  for (let row = 0; row < size; row += 1) {
    for (let middle = 0; middle < size; middle += 1) {
      for (let column = 0; column < size; column += 1) updated[row][column] += temp[row][middle] * right[middle][column];
    }
  }
  for (let row = 0; row < size; row += 1) {
    for (let column = 0; column < size; column += 1) updated[row][column] += rho * stepVector[row] * stepVector[column];
  }
  return updated;
}

export function fitZeroTruncatedNb2DesignRows(designRows, initial) {
  if (!Array.isArray(designRows) || designRows.length === 0) throw new Error('Positive-count design rows are required.');
  const width = designRows[0].x.length;
  if (width < 1 || designRows.some((row) => row.x.length !== width || !Number.isInteger(row.y) || row.y < 1 || !Number.isFinite(row.offset))) {
    throw new Error('Positive-count design row contract is invalid.');
  }
  if (!Array.isArray(initial.beta) || initial.beta.length !== width || initial.beta.some((value) => !Number.isFinite(value)) || !(initial.alpha > 0)) {
    throw new Error('Initial successor parameters are invalid.');
  }
  const objective = (parameters) => {
    const beta = parameters.slice(0, width);
    const alpha = Math.exp(parameters[width]);
    if (!Number.isFinite(alpha) || alpha < 1e-6 || alpha > 100) return Number.POSITIVE_INFINITY;
    let logLikelihood = 0;
    for (const row of designRows) {
      const eta = row.offset + dot(row.x, beta);
      if (eta < -30 || eta > 30) return Number.POSITIVE_INFINITY;
      const mean = Math.exp(eta);
      const contribution = zeroTruncatedNb2LogPmf(row.y, mean, alpha);
      if (!Number.isFinite(contribution)) return Number.POSITIVE_INFINITY;
      logLikelihood += contribution;
    }
    return -logLikelihood / designRows.length;
  };

  let parameters = [...initial.beta, Math.log(initial.alpha)];
  let value = objective(parameters);
  if (!Number.isFinite(value)) throw new Error('Initial successor likelihood is non-finite.');
  const initialAverageNegativeLogLikelihood = value;
  let gradient = numericalGradient(objective, parameters);
  let hessianInverse = identity(parameters.length);
  let iterations = 0;
  let converged = false;

  for (iterations = 0; iterations < 250; iterations += 1) {
    const gradientMax = maximumAbsolute(gradient);
    if (gradientMax < 1e-7) { converged = true; break; }
    let direction = multiplyMatrixVector(hessianInverse, gradient).map((valueEntry) => -valueEntry);
    let directionalDerivative = dot(gradient, direction);
    if (!(directionalDerivative < 0) || !Number.isFinite(directionalDerivative)) {
      hessianInverse = identity(parameters.length);
      direction = gradient.map((valueEntry) => -valueEntry);
      directionalDerivative = -dot(gradient, gradient);
    }
    let scale = 1;
    let candidate = null;
    let candidateValue = Number.POSITIVE_INFINITY;
    while (scale >= 1e-8) {
      const trial = parameters.map((valueEntry, index) => valueEntry + scale * direction[index]);
      const trialValue = objective(trial);
      if (Number.isFinite(trialValue) && trialValue <= value + 1e-4 * scale * directionalDerivative) {
        candidate = trial;
        candidateValue = trialValue;
        break;
      }
      scale *= 0.5;
    }
    if (candidate === null) break;
    const nextGradient = numericalGradient(objective, candidate);
    const stepVector = candidate.map((valueEntry, index) => valueEntry - parameters[index]);
    const gradientChange = nextGradient.map((valueEntry, index) => valueEntry - gradient[index]);
    hessianInverse = inverseBfgsUpdate(hessianInverse, stepVector, gradientChange);
    parameters = candidate;
    value = candidateValue;
    gradient = nextGradient;
    if (maximumAbsolute(stepVector) < 1e-9 && maximumAbsolute(gradient) < 1e-6) { converged = true; break; }
  }

  const beta = parameters.slice(0, width);
  const alpha = Math.exp(parameters[width]);
  return Object.freeze({
    beta: Object.freeze(beta),
    alpha,
    optimizer: 'deterministic-bfgs-central-difference-v1',
    iterations,
    converged,
    maxAbsFinalGradient: maximumAbsolute(gradient),
    initialAverageNegativeLogLikelihood,
    finalAverageNegativeLogLikelihood: value,
    logLikelihood: -value * designRows.length,
  });
}

export function predictorValuesFromFixtureRow(row) {
  return Object.freeze({
    contextHitQualityLogit: finite(row?.derivedPredictors?.contextHitQualityLogit, 'contextHitQualityLogit'),
    centeredLineupSlot: finite(row?.derivedPredictors?.centeredLineupSlot, 'centeredLineupSlot'),
    platoonSplitCell: finite(row?.conditioningInputs?.platoonSplitCell, 'platoonSplitCell'),
    opposingStarterPooling: finite(row?.conditioningInputs?.opposingStarterPooling, 'opposingStarterPooling'),
    teamImpliedRunTotal: finite(row?.conditioningInputs?.teamImpliedRunTotal, 'teamImpliedRunTotal'),
    precedingLineupSlotsOnBaseQuality: finite(row?.conditioningInputs?.precedingLineupSlotsOnBaseQuality, 'precedingLineupSlotsOnBaseQuality'),
  });
}

export function buildPositiveDesignRows(fixtureRows, transforms) {
  return fixtureRows.filter((row) => row.targetT >= 1).map((row) => {
    const raw = predictorValuesFromFixtureRow(row);
    const x = [1, ...HHR_SUCCESSOR_PREDICTOR_ORDER.map((name) => {
      const transform = transforms[name];
      if (!transform || !Number.isFinite(transform.mean) || !(transform.standardDeviation > 0)) throw new Error(`Invalid frozen transform for ${name}.`);
      return (raw[name] - transform.mean) / transform.standardDeviation;
    })];
    const expectedPlateAppearances = finite(row?.conditioningInputs?.expectedPlateAppearances, 'expectedPlateAppearances');
    if (!(expectedPlateAppearances > 0)) throw new Error('expectedPlateAppearances must be positive.');
    return Object.freeze({ x: Object.freeze(x), offset: Math.log(expectedPlateAppearances), y: row.targetT });
  });
}

export function fittedPositiveMean(row, transforms, coefficients) {
  const raw = predictorValuesFromFixtureRow(row);
  const beta = [coefficients.intercept, ...HHR_SUCCESSOR_PREDICTOR_ORDER.map((name) => coefficients[name])];
  if (beta.some((value) => !Number.isFinite(value))) throw new Error('Successor coefficients are incomplete.');
  const x = [1, ...HHR_SUCCESSOR_PREDICTOR_ORDER.map((name) => (raw[name] - transforms[name].mean) / transforms[name].standardDeviation)];
  const expectedPlateAppearances = finite(row?.conditioningInputs?.expectedPlateAppearances, 'expectedPlateAppearances');
  return Math.exp(Math.log(expectedPlateAppearances) + dot(x, beta));
}

export function hurdlePredictionForFixtureRow(row, transforms, coefficients, alpha) {
  const mean = fittedPositiveMean(row, transforms, coefficients);
  const rho = conditionedHurdleZeroProbability({
    expectedPlateAppearances: row.conditioningInputs.expectedPlateAppearances,
    lineupSlot: row.conditioningInputs.lineupSlot,
    contextHitQualityLogit: row.derivedPredictors.contextHitQualityLogit,
  });
  const positiveOne = zeroTruncatedNb2Pmf(1, mean, alpha);
  const positiveTwo = zeroTruncatedNb2Pmf(2, mean, alpha);
  return Object.freeze({
    fittedMean: mean,
    rho,
    upperTails: Object.freeze({
      1: 1 - rho,
      2: (1 - rho) * (1 - positiveOne),
      3: (1 - rho) * (1 - positiveOne - positiveTwo),
    }),
  });
}

function mean(values) {
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

export function evaluateHhrHurdleSuccessorGate(rowsInput, configuration = HHR_SUCCESSOR_GATE) {
  if (!Array.isArray(rowsInput) || rowsInput.length === 0) throw new Error('Successor gate rows are required.');
  const binCount = configuration.binCount;
  if (!Number.isInteger(binCount) || binCount < 5) throw new Error('Successor gate requires at least five fitted-mu bins.');
  const rows = rowsInput.map((row, sourceIndex) => Object.freeze({ ...row, sourceIndex }));
  const sorted = [...rows].sort((left, right) => left.fittedMean - right.fittedMean || left.sourceIndex - right.sourceIndex);
  const bins = Array.from({ length: binCount }, () => []);
  sorted.forEach((row, index) => bins[Math.min(binCount - 1, Math.floor(index * binCount / sorted.length))].push(row));
  if (bins.some((bin) => bin.length < configuration.minimumRowsPerBin)) throw new Error('Successor fitted-mu bin is below the canonical minimum row count.');

  const summaries = bins.map((bin, binIndex) => {
    const observedZero = bin.filter((row) => row.observedT === 0).length / bin.length;
    const predictedZero = mean(bin.map((row) => row.predictedZero));
    const alphaNumerator = bin.reduce((sum, row) => sum + (row.observedT - row.fittedMean) ** 2 - row.fittedMean, 0);
    const alphaDenominator = bin.reduce((sum, row) => sum + row.fittedMean ** 2, 0);
    const tails = Object.fromEntries(configuration.thresholds.map((threshold) => {
      const observedUpper = bin.filter((row) => row.observedT >= threshold).length / bin.length;
      const predictedUpper = mean(bin.map((row) => row.predictedUpperTails[threshold]));
      return [String(threshold), Object.freeze({
        threshold,
        upper: Object.freeze({ observed: observedUpper, predicted: predictedUpper, observedMinusPredicted: observedUpper - predictedUpper }),
        lower: Object.freeze({ observed: 1 - observedUpper, predicted: 1 - predictedUpper, observedMinusPredicted: predictedUpper - observedUpper }),
      })];
    }));
    return Object.freeze({
      binIndex,
      rowCount: bin.length,
      fittedMeanRange: Object.freeze({ minimum: bin[0].fittedMean, maximum: bin[bin.length - 1].fittedMean }),
      meanFittedMu: mean(bin.map((row) => row.fittedMean)),
      observedMeanT: mean(bin.map((row) => row.observedT)),
      impliedAlphaInformational: alphaNumerator / alphaDenominator,
      zeroMass: Object.freeze({ observed: observedZero, predicted: predictedZero, observedMinusPredicted: observedZero - predictedZero }),
      tails: Object.freeze(tails),
    });
  });

  const maxZeroGap = maximumAbsolute(summaries.map((bin) => bin.zeroMass.observedMinusPredicted));
  const maxTailGapByThreshold = Object.fromEntries(configuration.thresholds.map((threshold) => [String(threshold), maximumAbsolute(
    summaries.map((bin) => bin.tails[String(threshold)].upper.observedMinusPredicted),
  )]));
  const impliedAlphas = summaries.map((bin) => bin.impliedAlphaInformational);
  const alphaImpliedRange = Math.max(...impliedAlphas) - Math.min(...impliedAlphas);
  const zeroPassed = maxZeroGap <= configuration.tauZero;
  const tailsPassed = Object.values(maxTailGapByThreshold).every((value) => value <= configuration.tauTail);
  const failureReasons = [];
  if (!zeroPassed) failureReasons.push(Object.freeze({ code: 'ZERO_MASS_GAP_EXCEEDED', maxZeroGap, tolerance: configuration.tauZero }));
  for (const threshold of configuration.thresholds) {
    const value = maxTailGapByThreshold[String(threshold)];
    if (value > configuration.tauTail) failureReasons.push(Object.freeze({ code: 'TAIL_GAP_EXCEEDED', threshold, maxTailGap: value, tolerance: configuration.tauTail }));
  }
  return Object.freeze({
    gateVersion: configuration.version,
    verdict: failureReasons.length === 0 ? 'PASS' : 'FAIL',
    passed: failureReasons.length === 0,
    configuration: Object.freeze({
      binningRule: configuration.binningRule,
      binCount,
      minimumRowsPerBin: configuration.minimumRowsPerBin,
      thresholds: configuration.thresholds,
      tauZero: configuration.tauZero,
      tauTail: configuration.tauTail,
      alphaImpliedStatus: 'INFORMATIONAL',
    }),
    bins: Object.freeze(summaries),
    summary: Object.freeze({
      maxZeroGap,
      maxTailGapByThreshold: Object.freeze(maxTailGapByThreshold),
      alphaImpliedRange,
      alphaImpliedStatus: 'INFORMATIONAL',
      substantiveChecks: Object.freeze({ zeroMass: Object.freeze({ passed: zeroPassed }), tails: Object.freeze({ passed: tailsPassed }) }),
    }),
    failureReasons: Object.freeze(failureReasons),
  });
}
