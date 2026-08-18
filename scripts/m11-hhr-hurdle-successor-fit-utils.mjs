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
const HESSIAN_DIFFERENCE_SCALE = 1e-4;
const INITIAL_DAMPING = 1e-6;
const MINIMUM_DAMPING = 1e-12;
const DAMPING_GROWTH = 10;
const DAMPING_SHRINK = 0.2;
const MAX_DAMPING_ATTEMPTS = 18;
const LINEAR_SOLVE_PIVOT_TOLERANCE = 1e-14;

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

function maximumAbsolute(vector) {
  return Math.max(...vector.map((value) => Math.abs(value)));
}

function solveLinearSystem(matrixInput, vectorInput) {
  const size = vectorInput.length;
  if (!Array.isArray(matrixInput) || matrixInput.length !== size
    || matrixInput.some((row) => !Array.isArray(row) || row.length !== size)) {
    throw new Error('HHR damped-Newton linear system shape is invalid.');
  }
  const augmented = matrixInput.map((row, index) => [...row, vectorInput[index]]);
  if (augmented.some((row) => row.some((value) => !Number.isFinite(value)))) return null;

  for (let column = 0; column < size; column += 1) {
    let pivot = column;
    for (let row = column + 1; row < size; row += 1) {
      if (Math.abs(augmented[row][column]) > Math.abs(augmented[pivot][column])) pivot = row;
    }
    if (!(Math.abs(augmented[pivot][column]) > LINEAR_SOLVE_PIVOT_TOLERANCE)) return null;
    [augmented[column], augmented[pivot]] = [augmented[pivot], augmented[column]];

    for (let row = column + 1; row < size; row += 1) {
      const factor = augmented[row][column] / augmented[column][column];
      for (let entry = column; entry <= size; entry += 1) {
        augmented[row][entry] -= factor * augmented[column][entry];
      }
    }
  }

  const solution = Array(size).fill(0);
  for (let row = size - 1; row >= 0; row -= 1) {
    let right = augmented[row][size];
    for (let column = row + 1; column < size; column += 1) {
      right -= augmented[row][column] * solution[column];
    }
    solution[row] = right / augmented[row][row];
    if (!Number.isFinite(solution[row])) return null;
  }
  return solution;
}

function numericalHessianFromAnalyticGradient(evaluate, parameters) {
  const size = parameters.length;
  const raw = Array.from({ length: size }, () => Array(size).fill(0));

  for (let column = 0; column < size; column += 1) {
    const step = HESSIAN_DIFFERENCE_SCALE * Math.max(1, Math.abs(parameters[column]));
    const plus = [...parameters];
    const minus = [...parameters];
    plus[column] += step;
    minus[column] -= step;
    const plusGradient = evaluate(plus).gradient;
    const minusGradient = evaluate(minus).gradient;
    if (!Array.isArray(plusGradient) || !Array.isArray(minusGradient)
      || plusGradient.length !== size || minusGradient.length !== size
      || plusGradient.some((value) => !Number.isFinite(value))
      || minusGradient.some((value) => !Number.isFinite(value))) {
      throw new Error(`HHR damped-Newton Hessian gradient became non-finite at parameter ${column}.`);
    }
    for (let row = 0; row < size; row += 1) {
      raw[row][column] = (plusGradient[row] - minusGradient[row]) / (2 * step);
    }
  }

  return raw.map((row, rowIndex) => row.map((value, columnIndex) => {
    const symmetric = 0.5 * (value + raw[columnIndex][rowIndex]);
    if (!Number.isFinite(symmetric)) throw new Error('HHR damped-Newton Hessian contains a non-finite value.');
    return symmetric;
  }));
}

function dampedNewtonMatrix(hessian, damping) {
  return hessian.map((row, rowIndex) => row.map((value, columnIndex) => {
    if (rowIndex !== columnIndex) return value;
    const diagonalScale = Math.max(1, Math.abs(hessian[rowIndex][rowIndex]));
    return value + damping * diagonalScale;
  }));
}

function optimizeDampedNewton(evaluate, initialParameters) {
  let parameters = [...initialParameters];
  let evaluation = evaluate(parameters);
  if (!Number.isFinite(evaluation.objectiveValue)) {
    throw new Error('Initial HHR zero-truncated NB2 objective is non-finite.');
  }
  if (!Array.isArray(evaluation.gradient) || evaluation.gradient.some((value) => !Number.isFinite(value))) {
    throw new Error('Initial HHR zero-truncated NB2 analytic gradient is non-finite.');
  }

  let damping = INITIAL_DAMPING;
  let lastStepMaximum = null;
  let lastObjectiveDecrease = null;
  let maximumAcceptedDamping = 0;
  let totalDampingAttempts = 0;
  let converged = false;
  let iteration = 0;

  for (; iteration < MAX_OPTIMIZER_ITERATIONS; iteration += 1) {
    const gradient = evaluation.gradient;
    const maxGradient = maximumAbsolute(gradient);
    if (maxGradient <= GRADIENT_TOLERANCE) {
      converged = true;
      break;
    }

    const hessian = numericalHessianFromAnalyticGradient(evaluate, parameters);
    let accepted = null;
    let localDamping = Math.max(MINIMUM_DAMPING, damping);

    for (let attempt = 0; attempt < MAX_DAMPING_ATTEMPTS; attempt += 1) {
      totalDampingAttempts += 1;
      const matrix = dampedNewtonMatrix(hessian, localDamping);
      const step = solveLinearSystem(matrix, gradient.map((value) => -value));
      if (step !== null && step.every((value) => Number.isFinite(value)) && dot(gradient, step) < 0) {
        const candidateParameters = parameters.map((value, index) => value + step[index]);
        const candidateEvaluation = evaluate(candidateParameters);
        if (Number.isFinite(candidateEvaluation.objectiveValue)
          && Array.isArray(candidateEvaluation.gradient)
          && candidateEvaluation.gradient.every((value) => Number.isFinite(value))
          && candidateEvaluation.objectiveValue < evaluation.objectiveValue) {
          accepted = Object.freeze({
            parameters: candidateParameters,
            evaluation: candidateEvaluation,
            step,
            damping: localDamping,
          });
          break;
        }
      }
      localDamping *= DAMPING_GROWTH;
    }

    if (accepted === null) {
      throw new Error(
        `HHR zero-truncated NB2 damped Newton failed to find a decreasing step; objective=${evaluation.objectiveValue}; max analytic gradient=${maxGradient}; attempted damping through ${localDamping / DAMPING_GROWTH}.`,
      );
    }

    lastStepMaximum = maximumAbsolute(accepted.step);
    lastObjectiveDecrease = evaluation.objectiveValue - accepted.evaluation.objectiveValue;
    maximumAcceptedDamping = Math.max(maximumAcceptedDamping, accepted.damping);
    parameters = accepted.parameters;
    evaluation = accepted.evaluation;
    damping = Math.max(MINIMUM_DAMPING, accepted.damping * DAMPING_SHRINK);

    if (lastStepMaximum <= PARAMETER_TOLERANCE
      && maximumAbsolute(evaluation.gradient) <= GRADIENT_TOLERANCE * 5) {
      converged = true;
      iteration += 1;
      break;
    }
  }

  if (!converged) {
    throw new Error(
      `HHR zero-truncated NB2 damped Newton did not converge after ${MAX_OPTIMIZER_ITERATIONS} iterations; max analytic gradient=${maximumAbsolute(evaluation.gradient)}.`,
    );
  }

  return Object.freeze({
    parameters: Object.freeze(parameters),
    objectiveValue: evaluation.objectiveValue,
    iterations: iteration,
    maxAbsoluteGradient: maximumAbsolute(evaluation.gradient),
    lastStepMaximum,
    lastObjectiveDecrease,
    finalDamping: damping,
    maximumAcceptedDamping,
    totalDampingAttempts,
    hessianDifferenceScale: HESSIAN_DIFFERENCE_SCALE,
    convergence: 'damped-newton-analytic-gradient-numerical-hessian-v1',
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

function zeroTruncatedNb2EvaluationFactory(positiveRows) {
  const maximumTarget = Math.max(...positiveRows.map((row) => row.target));
  const logFactorial = logFactorials(maximumTarget);
  const parameterCount = HHR_POSITIVE_PREDICTOR_ORDER.length + 2;

  return (parameters) => {
    if (!Array.isArray(parameters) || parameters.length !== parameterCount) {
      return { objectiveValue: Number.POSITIVE_INFINITY, gradient: null };
    }
    const logAlpha = parameters.at(-1);
    if (!Number.isFinite(logAlpha)) return { objectiveValue: Number.POSITIVE_INFINITY, gradient: null };
    const alpha = Math.exp(logAlpha);
    if (!Number.isFinite(alpha) || !(alpha > 0)) return { objectiveValue: Number.POSITIVE_INFINITY, gradient: null };
    const r = 1 / alpha;
    if (!Number.isFinite(r) || !(r > 0)) return { objectiveValue: Number.POSITIVE_INFINITY, gradient: null };

    const beta = parameters.slice(0, -1);
    const risingLog = Array(maximumTarget + 1).fill(0);
    const digammaDifference = Array(maximumTarget + 1).fill(0);
    for (let value = 1; value <= maximumTarget; value += 1) {
      const shiftedR = r + value - 1;
      risingLog[value] = risingLog[value - 1] + Math.log(shiftedR);
      digammaDifference[value] = digammaDifference[value - 1] + 1 / shiftedR;
    }

    let negativeLogLikelihood = 0;
    const gradient = Array(parameterCount).fill(0);
    const logAlphaIndex = parameterCount - 1;

    for (const row of positiveRows) {
      const eta = row.logExpectedPlateAppearances + dot(row.design, beta);
      if (!Number.isFinite(eta) || eta > 700 || eta < -700) {
        return { objectiveValue: Number.POSITIVE_INFINITY, gradient: null };
      }
      const mu = Math.exp(eta);
      const alphaMu = alpha * mu;
      if (!Number.isFinite(alphaMu) || !(alphaMu > 0)) {
        return { objectiveValue: Number.POSITIVE_INFINITY, gradient: null };
      }
      const logOnePlusAlphaMu = Math.log1p(alphaMu);
      const q = alphaMu / (1 + alphaMu);
      const logQ0 = -r * logOnePlusAlphaMu;
      const q0 = Math.exp(logQ0);
      const oneMinusQ0 = -Math.expm1(logQ0);
      if (!Number.isFinite(oneMinusQ0) || !(oneMinusQ0 > 0) || !(oneMinusQ0 < 1)
        || !Number.isFinite(q0) || !(q0 > 0) || !(q0 < 1)) {
        return { objectiveValue: Number.POSITIVE_INFINITY, gradient: null };
      }

      const target = row.target;
      const logQy = risingLog[target]
        - logFactorial[target]
        - r * logOnePlusAlphaMu
        + target * (logAlpha + eta - logOnePlusAlphaMu);
      const logTruncated = logQy - Math.log(oneMinusQ0);
      if (!Number.isFinite(logTruncated)) {
        return { objectiveValue: Number.POSITIVE_INFINITY, gradient: null };
      }
      negativeLogLikelihood -= logTruncated;

      const dLogQyDeta = target - (target + r) * q;
      const dLogOneMinusQ0Deta = (q0 * r * q) / oneMinusQ0;
      const dLogTruncatedDeta = dLogQyDeta - dLogOneMinusQ0Deta;
      for (let index = 0; index < row.design.length; index += 1) {
        gradient[index] -= dLogTruncatedDeta * row.design[index];
      }

      const dLogQyDLogAlpha = target
        - (target + r) * q
        - r * (digammaDifference[target] - logOnePlusAlphaMu);
      const dLogQ0DLogAlpha = r * (logOnePlusAlphaMu - q);
      const dLogOneMinusQ0DLogAlpha = -(q0 * dLogQ0DLogAlpha) / oneMinusQ0;
      const dLogTruncatedDLogAlpha = dLogQyDLogAlpha - dLogOneMinusQ0DLogAlpha;
      gradient[logAlphaIndex] -= dLogTruncatedDLogAlpha;
    }

    if (!Number.isFinite(negativeLogLikelihood) || gradient.some((value) => !Number.isFinite(value))) {
      return { objectiveValue: Number.POSITIVE_INFINITY, gradient: null };
    }
    return { objectiveValue: negativeLogLikelihood, gradient };
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

export function diagnoseHhrPositiveGradient({ fixture, fixtureText, oldModel, parameterDelta = null, finiteDifferenceScale = 1e-4 }) {
  if (!Number.isFinite(finiteDifferenceScale) || !(finiteDifferenceScale > 0)) {
    throw new TypeError('finiteDifferenceScale must be positive and finite.');
  }
  const prepared = prepareRows(fixture, oldModel, fixtureText);
  const positiveRows = prepared.prepared.filter((row) => row.target >= 1);
  const baseParameters = initialParameters(oldModel);
  const parameters = parameterDelta === null
    ? baseParameters
    : baseParameters.map((value, index) => value + finite(parameterDelta[index] ?? 0, `parameterDelta ${index}`));
  if (parameters.length !== HHR_POSITIVE_PREDICTOR_ORDER.length + 2) {
    throw new Error('HHR diagnostic parameter vector length drifted.');
  }
  const evaluate = zeroTruncatedNb2EvaluationFactory(positiveRows);
  const analyticEvaluation = evaluate(parameters);
  if (!Array.isArray(analyticEvaluation.gradient)) throw new Error('HHR analytic diagnostic gradient is unavailable.');
  const numericalGradient = parameters.map((value, index) => {
    const step = finiteDifferenceScale * Math.max(1, Math.abs(value));
    const plus = [...parameters];
    const minus = [...parameters];
    plus[index] += step;
    minus[index] -= step;
    const plusObjective = evaluate(plus).objectiveValue;
    const minusObjective = evaluate(minus).objectiveValue;
    if (!Number.isFinite(plusObjective) || !Number.isFinite(minusObjective)) {
      throw new Error(`HHR numerical diagnostic became non-finite at parameter ${index}.`);
    }
    return (plusObjective - minusObjective) / (2 * step);
  });
  const labels = Object.freeze(['intercept', ...HHR_POSITIVE_PREDICTOR_ORDER, 'logDispersionAlpha']);
  const comparisons = labels.map((label, index) => {
    const analytic = analyticEvaluation.gradient[index];
    const numerical = numericalGradient[index];
    const absoluteDifference = Math.abs(analytic - numerical);
    const relativeDifference = absoluteDifference / Math.max(1, Math.abs(analytic), Math.abs(numerical));
    return Object.freeze({ label, analytic, numerical, absoluteDifference, relativeDifference });
  });
  return Object.freeze({
    objectiveValue: analyticEvaluation.objectiveValue,
    parameters: Object.freeze(parameters),
    labels,
    comparisons: Object.freeze(comparisons),
    maxAbsoluteDifference: Math.max(...comparisons.map((entry) => entry.absoluteDifference)),
    maxRelativeDifference: Math.max(...comparisons.map((entry) => entry.relativeDifference)),
    finiteDifferenceScale,
  });
}

function fitPositiveZeroTruncatedNb2(preparedRows, oldModel) {
  const positiveRows = preparedRows.filter((row) => row.target >= 1);
  if (positiveRows.length !== EXPECTED_POSITIVE_ROW_COUNT) throw new Error('HHR positive-row subset identity drifted.');
  const evaluate = zeroTruncatedNb2EvaluationFactory(positiveRows);
  const optimization = optimizeDampedNewton(evaluate, initialParameters(oldModel));
  const beta = optimization.parameters.slice(0, -1);
  const dispersionAlpha = Math.exp(optimization.parameters.at(-1));
  if (!(dispersionAlpha > 0) || !Number.isFinite(dispersionAlpha)) throw new Error('HHR successor dispersion alpha is invalid.');
  const coefficientNames = ['intercept', ...HHR_POSITIVE_PREDICTOR_ORDER];
  const coefficients = Object.freeze(Object.fromEntries(
    coefficientNames.map((name, index) => [name, beta[index]]),
  ));
  return Object.freeze({
    fittingMethod: 'zero-truncated-negative-binomial-2-log-link-damped-newton-v1',
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
