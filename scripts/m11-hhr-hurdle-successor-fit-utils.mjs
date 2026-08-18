import { createHash } from 'node:crypto';

import {
  evaluateFamilyBDistributionShapeGate,
  FAMILY_B_CANONICAL_MINIMUM_ROWS_PER_BIN,
  FAMILY_B_CANONICAL_TOLERANCE_CEILINGS,
  FAMILY_B_EQUAL_COUNT_BINNING_RULE,
} from './m11-hhr-distribution-shape-diagnostic-utils.mjs';

export const HHR_SUCCESSOR_MODEL_VERSION = 'm11-batter-hhr-conditioned-hurdle-zt-nb2-v1';
export const HHR_SUCCESSOR_FIT_VERSION = 'm11-hhr-positive-zero-truncated-nb2-fit-v1';
export const HHR_SUCCESSOR_REPORT_VERSION = 1;
export const HHR_SUCCESSOR_BIN_COUNT = 5;
export const HHR_SUCCESSOR_MINIMUM_THRESHOLDS = Object.freeze([1, 2, 3]);
export const HHR_SUCCESSOR_TAIL_COLLAPSE_AT = 64;
export const HHR_POSITIVE_PREDICTOR_ORDER = Object.freeze([
  'contextHitQualityLogit',
  'centeredLineupSlot',
  'platoonSplitCell',
  'opposingStarterPooling',
  'teamImpliedRunTotal',
  'precedingLineupSlotsOnBaseQuality',
]);
export const HHR_FROZEN_ZERO_COMPONENT = Object.freeze({
  version: 'canonical-math-spec-1.13-conditioned-hurdle-zero-component',
  coefficientTolerance: 1e-8,
  predictorOrder: Object.freeze([
    'intercept',
    'expectedPlateAppearances',
    'lineupSlot',
    'contextHitQualityLogit',
  ]),
  coefficients: Object.freeze({
    intercept: -0.3156807637,
    expectedPlateAppearances: -0.4421437692,
    lineupSlot: 0.0101539499,
    contextHitQualityLogit: -1.0649822595,
  }),
});

const EXPECTED_FULL_ROW_COUNT = 5964;
const EXPECTED_ZERO_ROW_COUNT = 1977;
const EXPECTED_POSITIVE_ROW_COUNT = 3987;
const OLD_MODEL_VERSION = 'm11-batter-hhr-direct-composite-v2';
const MAX_OPTIMIZER_ITERATIONS = 180;
const GRADIENT_TOLERANCE = 2e-6;
const PARAMETER_TOLERANCE = 1e-9;
const FINITE_DIFFERENCE_SCALE = 1e-5;
const ARMIJO = 1e-4;
const MIN_LINE_SEARCH_STEP = 2 ** -24;

export function sha256Text(text) {
  return createHash('sha256').update(text).digest('hex');
}

function finite(value, label) {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new TypeError(`${label} must be finite.`);
  }
  return value;
}

function sigmoid(value) {
  if (value >= 0) return 1 / (1 + Math.exp(-value));
  const expValue = Math.exp(value);
  return expValue / (1 + expValue);
}

function dot(left, right) {
  return left.reduce((sum, value, index) => sum + value * right[index], 0);
}

function identity(size) {
  return Array.from({ length: size }, (_, row) =>
    Array.from({ length: size }, (_, column) => row === column ? 1 : 0),
  );
}

function matrixVector(matrix, vector) {
  return matrix.map((row) => dot(row, vector));
}

function maximumAbsolute(vector) {
  return Math.max(...vector.map((value) => Math.abs(value)));
}

function bfgsInverseUpdate(inverseHessian, stepVector, gradientChange) {
  const ys = dot(gradientChange, stepVector);
  if (!Number.isFinite(ys) || ys <= 1e-10) return identity(stepVector.length);
  const hy = matrixVector(inverseHessian, gradientChange);
  const yhy = dot(gradientChange, hy);
  const rho = 1 / ys;
  const coefficient = (1 + yhy * rho) * rho;
  return inverseHessian.map((row, rowIndex) => row.map((value, columnIndex) =>
    value
    + coefficient * stepVector[rowIndex] * stepVector[columnIndex]
    - rho * (hy[rowIndex] * stepVector[columnIndex] + stepVector[rowIndex] * hy[columnIndex]),
  ));
}

function numericalGradient(objective, parameters) {
  return parameters.map((value, index) => {
    const step = FINITE_DIFFERENCE_SCALE * Math.max(1, Math.abs(value));
    const plus = [...parameters];
    const minus = [...parameters];
    plus[index] += step;
    minus[index] -= step;
    const plusValue = objective(plus);
    const minusValue = objective(minus);
    if (!Number.isFinite(plusValue) || !Number.isFinite(minusValue)) {
      throw new Error(`HHR zero-truncated NB2 numerical gradient became non-finite at parameter ${index}.`);
    }
    return (plusValue - minusValue) / (2 * step);
  });
}

function armijoLineSearch(objective, parameters, objectiveValue, gradient, direction) {
  const directionalDerivative = dot(gradient, direction);
  if (!(directionalDerivative < 0) || !Number.isFinite(directionalDerivative)) return null;
  let lineSearchStep = 1;
  while (lineSearchStep >= MIN_LINE_SEARCH_STEP) {
    const candidate = parameters.map((value, index) => value + lineSearchStep * direction[index]);
    const candidateObjective = objective(candidate);
    if (Number.isFinite(candidateObjective)
      && candidateObjective <= objectiveValue + ARMIJO * lineSearchStep * directionalDerivative) {
      return Object.freeze({ parameters: candidate, objectiveValue: candidateObjective, lineSearchStep });
    }
    lineSearchStep /= 2;
  }
  return null;
}

function optimizeBfgs(objective, initialParameters) {
  let parameters = [...initialParameters];
  let objectiveValue = objective(parameters);
  if (!Number.isFinite(objectiveValue)) throw new Error('Initial HHR zero-truncated NB2 objective is non-finite.');
  let gradient = numericalGradient(objective, parameters);
  let inverseHessian = identity(parameters.length);
  let converged = false;
  let iteration = 0;
  let lastStepMaximum = null;
  let restartCount = 0;

  for (; iteration < MAX_OPTIMIZER_ITERATIONS; iteration += 1) {
    if (maximumAbsolute(gradient) <= GRADIENT_TOLERANCE) {
      converged = true;
      break;
    }

    let direction = matrixVector(inverseHessian, gradient).map((value) => -value);
    let usedSteepestDescent = false;
    if (!(dot(gradient, direction) < 0) || direction.some((value) => !Number.isFinite(value))) {
      inverseHessian = identity(parameters.length);
      direction = gradient.map((value) => -value);
      usedSteepestDescent = true;
      restartCount += 1;
    }

    let search = armijoLineSearch(objective, parameters, objectiveValue, gradient, direction);
    if (search === null && !usedSteepestDescent) {
      inverseHessian = identity(parameters.length);
      direction = gradient.map((value) => -value);
      usedSteepestDescent = true;
      restartCount += 1;
      search = armijoLineSearch(objective, parameters, objectiveValue, gradient, direction);
    }
    if (search === null) {
      throw new Error(
        `HHR zero-truncated NB2 line search failed after steepest-descent restart; objective=${objectiveValue}; max gradient=${maximumAbsolute(gradient)}.`,
      );
    }

    const nextParameters = search.parameters;
    const nextObjectiveValue = search.objectiveValue;
    const nextGradient = numericalGradient(objective, nextParameters);
    const stepVector = nextParameters.map((value, index) => value - parameters[index]);
    const gradientChange = nextGradient.map((value, index) => value - gradient[index]);
    lastStepMaximum = maximumAbsolute(stepVector);
    inverseHessian = bfgsInverseUpdate(inverseHessian, stepVector, gradientChange);
    parameters = nextParameters;
    objectiveValue = nextObjectiveValue;
    gradient = nextGradient;

    if (lastStepMaximum <= PARAMETER_TOLERANCE && maximumAbsolute(gradient) <= GRADIENT_TOLERANCE * 5) {
      converged = true;
      iteration += 1;
      break;
    }
  }

  if (!converged) {
    throw new Error(`HHR zero-truncated NB2 BFGS did not converge after ${MAX_OPTIMIZER_ITERATIONS} iterations; max gradient=${maximumAbsolute(gradient)}.`);
  }
  return Object.freeze({
    parameters: Object.freeze(parameters),
    objectiveValue,
    iterations: iteration,
    maxAbsoluteGradient: maximumAbsolute(gradient),
    lastStepMaximum,
    restartCount,
    convergence: 'bfgs-with-steepest-descent-restart-v1',
  });
}

function logFactorials(maximum) {
  const values = Array(maximum + 1).fill(0);
  for (let value = 2; value <= maximum; value += 1) values[value] = values[value - 1] + Math.log(value);
  return values;
}

function rowPredictors(row) {
  return {
    contextHitQualityLogit: finite(row.derivedPredictors?.contextHitQualityLogit, 'contextHitQualityLogit'),
    centeredLineupSlot: finite(row.derivedPredictors?.centeredLineupSlot, 'centeredLineupSlot'),
    platoonSplitCell: finite(row.conditioningInputs?.platoonSplitCell, 'platoonSplitCell'),
    opposingStarterPooling: finite(row.conditioningInputs?.opposingStarterPooling, 'opposingStarterPooling'),
    teamImpliedRunTotal: finite(row.conditioningInputs?.teamImpliedRunTotal, 'teamImpliedRunTotal'),
    precedingLineupSlotsOnBaseQuality: finite(row.conditioningInputs?.precedingLineupSlotsOnBaseQuality, 'precedingLineupSlotsOnBaseQuality'),
  };
}

function validateFrozenTransforms(oldModel) {
  if (oldModel?.modelVersion !== OLD_MODEL_VERSION) throw new Error('HHR successor source model must be the frozen v2 model.');
  if (oldModel?.fittingDetails?.expectedPlateAppearancesRole !== 'offset'
    || oldModel.fittingDetails.expectedPlateAppearancesCoefficient !== 1) {
    throw new Error('HHR successor source model must preserve the expected-PA offset with fixed coefficient 1.');
  }
  if (JSON.stringify(oldModel.fittingDetails.predictorOrder) !== JSON.stringify(HHR_POSITIVE_PREDICTOR_ORDER)) {
    throw new Error('HHR successor positive-count predictor order drifted from the frozen v2 contract.');
  }
  const transforms = oldModel.predictorTransforms;
  for (const name of HHR_POSITIVE_PREDICTOR_ORDER) {
    finite(transforms?.[name]?.mean, `frozen transform mean ${name}`);
    const standardDeviation = finite(transforms?.[name]?.standardDeviation, `frozen transform SD ${name}`);
    if (!(standardDeviation > 0)) throw new Error(`Frozen transform SD ${name} must be positive.`);
  }
  return transforms;
}

function prepareRows(fixture, oldModel, fixtureText) {
  if (fixture?.schemaVersion !== 3 || fixture?.expectedPaRole !== 'log offset with fixed coefficient 1') {
    throw new Error('HHR successor fitting fixture contract mismatch.');
  }
  if (!Array.isArray(fixture.rows) || fixture.rows.length !== EXPECTED_FULL_ROW_COUNT) {
    throw new Error(`HHR successor requires exactly ${EXPECTED_FULL_ROW_COUNT} fitting rows.`);
  }
  if (oldModel?.fitEvidence?.sourceFixtureSha256 !== sha256Text(fixtureText)) {
    throw new Error('HHR successor fitting fixture bytes do not match frozen v2 lineage.');
  }
  const transforms = validateFrozenTransforms(oldModel);
  const prepared = fixture.rows.map((row, index) => {
    const target = finite(row.targetT, `targetT ${index}`);
    if (!Number.isInteger(target) || target < 0) throw new Error(`HHR targetT ${index} must be a nonnegative integer.`);
    const expectedPlateAppearances = finite(row.conditioningInputs?.expectedPlateAppearances, `expected PA ${index}`);
    if (!(expectedPlateAppearances > 0)) throw new Error(`HHR expected PA ${index} must be positive.`);
    const predictors = rowPredictors(row);
    const design = [1, ...HHR_POSITIVE_PREDICTOR_ORDER.map((name) =>
      (predictors[name] - transforms[name].mean) / transforms[name].standardDeviation,
    )];
    const recoveredLineupSlot = 4 * predictors.centeredLineupSlot + 5;
    const declaredLineupSlot = finite(row.conditioningInputs?.lineupSlot, `declared lineupSlot ${index}`);
    if (Math.abs(recoveredLineupSlot - declaredLineupSlot) > 1e-12) {
      throw new Error(`HHR row ${index} raw lineupSlot reconstruction disagrees with the frozen fixture.`);
    }
    if (Math.abs(recoveredLineupSlot - Math.round(recoveredLineupSlot)) > 1e-12
      || recoveredLineupSlot < 1 || recoveredLineupSlot > 9) {
      throw new Error(`HHR row ${index} reconstructed lineupSlot must be an integer from 1 through 9.`);
    }
    return Object.freeze({
      target,
      design: Object.freeze(design),
      expectedPlateAppearances,
      logExpectedPlateAppearances: Math.log(expectedPlateAppearances),
      contextHitQualityLogit: predictors.contextHitQualityLogit,
      lineupSlot: recoveredLineupSlot,
    });
  });
  const zeroCount = prepared.filter((row) => row.target === 0).length;
  const positiveCount = prepared.filter((row) => row.target >= 1).length;
  if (zeroCount !== EXPECTED_ZERO_ROW_COUNT || positiveCount !== EXPECTED_POSITIVE_ROW_COUNT) {
    throw new Error(`HHR successor cohort identity mismatch: zero=${zeroCount}, positive=${positiveCount}.`);
  }
  return Object.freeze({ prepared, transforms, zeroCount, positiveCount });
}

function zeroTruncatedNb2ObjectiveFactory(positiveRows) {
  const maximumTarget = Math.max(...positiveRows.map((row) => row.target));
  const logFactorial = logFactorials(maximumTarget);
  return (parameters) => {
    if (!Array.isArray(parameters) || parameters.length !== HHR_POSITIVE_PREDICTOR_ORDER.length + 2) return Number.POSITIVE_INFINITY;
    const logAlpha = parameters.at(-1);
    if (!Number.isFinite(logAlpha)) return Number.POSITIVE_INFINITY;
    const alpha = Math.exp(logAlpha);
    if (!Number.isFinite(alpha) || !(alpha > 0)) return Number.POSITIVE_INFINITY;
    const r = 1 / alpha;
    if (!Number.isFinite(r) || !(r > 0)) return Number.POSITIVE_INFINITY;
    const beta = parameters.slice(0, -1);
    const risingLog = Array(maximumTarget + 1).fill(0);
    for (let value = 1; value <= maximumTarget; value += 1) {
      risingLog[value] = risingLog[value - 1] + Math.log(r + value - 1);
    }
    let negativeLogLikelihood = 0;
    for (const row of positiveRows) {
      const eta = row.logExpectedPlateAppearances + dot(row.design, beta);
      if (!Number.isFinite(eta) || eta > 700 || eta < -700) return Number.POSITIVE_INFINITY;
      const mu = Math.exp(eta);
      const logOnePlusAlphaMu = Math.log1p(alpha * mu);
      const logQ0 = -r * logOnePlusAlphaMu;
      const oneMinusQ0 = -Math.expm1(logQ0);
      if (!Number.isFinite(oneMinusQ0) || !(oneMinusQ0 > 0) || !(oneMinusQ0 < 1)) return Number.POSITIVE_INFINITY;
      const logQy = risingLog[row.target]
        - logFactorial[row.target]
        - r * logOnePlusAlphaMu
        + row.target * (Math.log(alpha * mu) - logOnePlusAlphaMu);
      const logTruncated = logQy - Math.log(oneMinusQ0);
      if (!Number.isFinite(logTruncated)) return Number.POSITIVE_INFINITY;
      negativeLogLikelihood -= logTruncated;
    }
    return negativeLogLikelihood;
  };
}

function initialParameters(oldModel) {
  const coefficients = oldModel?.coefficients;
  const beta = [finite(coefficients?.intercept, 'old v2 intercept')];
  for (const name of HHR_POSITIVE_PREDICTOR_ORDER) beta.push(finite(coefficients?.[name], `old v2 coefficient ${name}`));
  const alpha = finite(oldModel?.dispersionAlpha, 'old v2 dispersion alpha');
  if (!(alpha > 0)) throw new Error('Old v2 dispersion alpha must be positive.');
  return [...beta, Math.log(alpha)];
}

function fitPositiveZeroTruncatedNb2(preparedRows, oldModel) {
  const positiveRows = preparedRows.filter((row) => row.target >= 1);
  if (positiveRows.length !== EXPECTED_POSITIVE_ROW_COUNT) throw new Error('HHR positive-row subset identity drifted.');
  const objective = zeroTruncatedNb2ObjectiveFactory(positiveRows);
  const optimization = optimizeBfgs(objective, initialParameters(oldModel));
  const beta = optimization.parameters.slice(0, -1);
  const dispersionAlpha = Math.exp(optimization.parameters.at(-1));
  if (!(dispersionAlpha > 0) || !Number.isFinite(dispersionAlpha)) throw new Error('HHR successor dispersion alpha is invalid.');
  const coefficientNames = ['intercept', ...HHR_POSITIVE_PREDICTOR_ORDER];
  const coefficients = Object.freeze(Object.fromEntries(
    coefficientNames.map((name, index) => [name, beta[index]]),
  ));
  return Object.freeze({
    fittingMethod: 'zero-truncated-negative-binomial-2-log-link-bfgs-v1',
    responseSubset: 'T>=1',
    rowCount: positiveRows.length,
    link: 'log',
    expectedPlateAppearancesRole: 'log offset',
    expectedPlateAppearancesCoefficient: 1,
    predictorOrder: Object.freeze([...HHR_POSITIVE_PREDICTOR_ORDER]),
    coefficients,
    dispersionAlpha,
    optimization,
  });
}

function positiveMean(row, positiveFit) {
  const beta = [positiveFit.coefficients.intercept, ...HHR_POSITIVE_PREDICTOR_ORDER.map((name) => positiveFit.coefficients[name])];
  const eta = row.logExpectedPlateAppearances + dot(row.design, beta);
  const mu = Math.exp(eta);
  if (!Number.isFinite(mu) || !(mu > 0)) throw new Error('HHR successor fitted positive-count mu is invalid.');
  return mu;
}

function zeroProbability(row) {
  const coefficients = HHR_FROZEN_ZERO_COMPONENT.coefficients;
  const logit = coefficients.intercept
    + coefficients.expectedPlateAppearances * row.expectedPlateAppearances
    + coefficients.lineupSlot * row.lineupSlot
    + coefficients.contextHitQualityLogit * row.contextHitQualityLogit;
  const rho = sigmoid(logit);
  if (!Number.isFinite(rho) || !(rho > 0) || !(rho < 1)) throw new Error('HHR frozen hurdle zero probability is invalid.');
  return rho;
}

function buildHurdlePmf(mu, dispersionAlpha, rho) {
  const r = 1 / dispersionAlpha;
  const q = dispersionAlpha * mu / (1 + dispersionAlpha * mu);
  const q0 = Math.exp(-r * Math.log1p(dispersionAlpha * mu));
  if (!(q0 > 0) || !(q0 < 1) || !(q > 0) || !(q < 1)) throw new Error('HHR successor NB2 parameters produced invalid positive-count mass.');
  const scale = (1 - rho) / (1 - q0);
  const probabilities = Array(HHR_SUCCESSOR_TAIL_COLLAPSE_AT + 1).fill(0);
  probabilities[0] = rho;
  let qMass = q0;
  let assigned = rho;
  for (let count = 1; count < HHR_SUCCESSOR_TAIL_COLLAPSE_AT; count += 1) {
    qMass *= ((count - 1 + r) / count) * q;
    const mass = qMass * scale;
    if (!Number.isFinite(mass) || mass < 0) throw new Error(`HHR successor PMF mass at ${count} is invalid.`);
    probabilities[count] = mass;
    assigned += mass;
  }
  const tailMass = 1 - assigned;
  if (!Number.isFinite(tailMass) || tailMass < -1e-12 || tailMass > 1) {
    throw new Error(`HHR successor collapsed tail mass is invalid: ${tailMass}.`);
  }
  probabilities[HHR_SUCCESSOR_TAIL_COLLAPSE_AT] = tailMass < 0 ? 0 : tailMass;
  const total = probabilities.reduce((sum, value) => sum + value, 0);
  if (Math.abs(total - 1) > 1e-10) throw new Error(`HHR successor PMF does not conserve probability: ${total}.`);
  return Object.freeze(probabilities);
}

function combinedDistributionRow(row, positiveFit) {
  const mu = positiveMean(row, positiveFit);
  const rho = zeroProbability(row);
  return Object.freeze({
    fittedMean: mu,
    observedT: row.target,
    predictedProbabilities: buildHurdlePmf(mu, positiveFit.dispersionAlpha, rho),
  });
}

function normalizeThresholds(liveRequiredSettlementThresholds) {
  if (!Array.isArray(liveRequiredSettlementThresholds) || liveRequiredSettlementThresholds.length === 0) {
    throw new Error('HHR successor live settlement thresholds are required.');
  }
  const live = [...new Set(liveRequiredSettlementThresholds)].sort((left, right) => left - right);
  if (live.some((value) => !Number.isInteger(value) || value < 1 || value >= HHR_SUCCESSOR_TAIL_COLLAPSE_AT)) {
    throw new Error('HHR successor live settlement threshold is unsupported by the exact fitted PMF range.');
  }
  const all = [...new Set([...HHR_SUCCESSOR_MINIMUM_THRESHOLDS, ...live])].sort((left, right) => left - right);
  return Object.freeze({ live: Object.freeze(live), all: Object.freeze(all) });
}

function successorAcceptance(shapeGate) {
  const substantive = shapeGate?.summary?.substantiveChecks;
  const structuralPassed = shapeGate?.summary?.structuralFailure === false;
  const zeroPassed = substantive?.zeroMass?.passed === true;
  const tailsPassed = substantive?.tails?.passed === true;
  return Object.freeze({
    ruleVersion: 'canonical-math-spec-1.12-item-o-successor-shape-acceptance-v1',
    passed: structuralPassed && zeroPassed && tailsPassed,
    structuralPassed,
    zeroMassPassed: zeroPassed,
    settlementTailsPassed: tailsPassed,
    alphaImpliedInformationalOnly: true,
    alphaGateGenericResult: substantive?.alphaRange ?? null,
    tauZero: shapeGate?.configuration?.tolerances?.tauZero ?? null,
    tauTail: shapeGate?.configuration?.tolerances?.tauTail ?? null,
  });
}

export function evaluateHhrHurdleSuccessor({ fixture, fixtureText, oldModel, liveRequiredSettlementThresholds }) {
  if (fixture === null || typeof fixture !== 'object') throw new TypeError('HHR successor fixture must be an object.');
  if (oldModel === null || typeof oldModel !== 'object') throw new TypeError('HHR successor source model must be an object.');
  if (typeof fixtureText !== 'string') throw new TypeError('HHR successor fixtureText must be raw fixture text.');
  const thresholds = normalizeThresholds(liveRequiredSettlementThresholds);
  const prepared = prepareRows(fixture, oldModel, fixtureText);
  const positiveFit = fitPositiveZeroTruncatedNb2(prepared.prepared, oldModel);
  const diagnosticRows = prepared.prepared.map((row) => combinedDistributionRow(row, positiveFit));
  const shapeGate = evaluateFamilyBDistributionShapeGate(diagnosticRows, {
    binningRule: FAMILY_B_EQUAL_COUNT_BINNING_RULE,
    binCount: HHR_SUCCESSOR_BIN_COUNT,
    minimumRowsPerBin: FAMILY_B_CANONICAL_MINIMUM_ROWS_PER_BIN,
    settlementThresholds: thresholds.all,
    liveRequiredSettlementThresholds: thresholds.live,
    tolerances: FAMILY_B_CANONICAL_TOLERANCE_CEILINGS,
  });
  const acceptance = successorAcceptance(shapeGate);
  return Object.freeze({
    reportVersion: HHR_SUCCESSOR_REPORT_VERSION,
    reportType: 'm11-hhr-conditioned-hurdle-positive-zt-nb2-successor-fit',
    modelVersion: HHR_SUCCESSOR_MODEL_VERSION,
    productionEnabled: false,
    rankingEnabled: false,
    untouchedEvidenceRead: false,
    cohort: Object.freeze({
      fullRowCount: prepared.prepared.length,
      zeroRowCount: prepared.zeroCount,
      positiveRowCount: prepared.positiveCount,
    }),
    frozenPositivePredictorTransforms: prepared.transforms,
    frozenZeroComponent: HHR_FROZEN_ZERO_COMPONENT,
    positiveFit,
    shapeGate,
    successorAcceptance: acceptance,
  });
}
