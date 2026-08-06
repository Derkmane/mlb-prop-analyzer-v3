import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

const FIXTURE_PATH = path.resolve('fixtures/sanitized/m11/hhr/respecified-v1/balldontlie-hhr-design-matrix-v1.json');
const BOARD_PATH = path.resolve('fixtures/sanitized/m11/hhr/respecified-v1/the-odds-api-underdog-hhr-board-v1.json');
const MODEL_PATH = path.resolve('model-artifacts/m11-batter-hhr-direct-composite-v1.json');
const DIAGNOSTICS_PATH = path.resolve('model-artifacts/m11-batter-hhr-direct-composite-diagnostics-v1.json');
const PREDICTOR_ORDER = Object.freeze([
  'contextHitQualityLogit',
  'centeredLineupSlot',
  'platoonSplitCell',
  'opposingStarterPooling',
  'teamImpliedRunTotal',
  'precedingLineupSlotsOnBaseQuality',
]);
const QUALITY_SPREAD_MINIMUM_RATIO = 1.10;
const VIF_MAXIMUM = 5;
const sha256 = (value) => createHash('sha256').update(value).digest('hex');

function finite(value, label) {
  if (typeof value !== 'number' || !Number.isFinite(value)) throw new TypeError(`${label} must be finite.`);
  return value;
}

function transpose(matrix) {
  return matrix[0].map((_, column) => matrix.map((row) => row[column]));
}

function multiply(left, right) {
  const result = Array.from({ length: left.length }, () => Array(right[0].length).fill(0));
  for (let i = 0; i < left.length; i += 1) {
    for (let k = 0; k < right.length; k += 1) {
      for (let j = 0; j < right[0].length; j += 1) result[i][j] += left[i][k] * right[k][j];
    }
  }
  return result;
}

function invert(matrixInput, label) {
  const size = matrixInput.length;
  const matrix = matrixInput.map((row, index) => [
    ...row,
    ...Array.from({ length: size }, (_, column) => index === column ? 1 : 0),
  ]);
  for (let column = 0; column < size; column += 1) {
    let pivot = column;
    for (let row = column + 1; row < size; row += 1) {
      if (Math.abs(matrix[row][column]) > Math.abs(matrix[pivot][column])) pivot = row;
    }
    if (Math.abs(matrix[pivot][column]) < 1e-12) throw new Error(`${label} is singular.`);
    [matrix[column], matrix[pivot]] = [matrix[pivot], matrix[column]];
    const divisor = matrix[column][column];
    for (let entry = 0; entry < size * 2; entry += 1) matrix[column][entry] /= divisor;
    for (let row = 0; row < size; row += 1) {
      if (row === column) continue;
      const factor = matrix[row][column];
      for (let entry = 0; entry < size * 2; entry += 1) matrix[row][entry] -= factor * matrix[column][entry];
    }
  }
  return matrix.map((row) => row.slice(size));
}

function solve(matrix, vector, label) {
  return multiply(invert(matrix, label), vector.map((value) => [value])).map((row) => row[0]);
}

function mean(values) { return values.reduce((sum, value) => sum + value, 0) / values.length; }
function sampleSd(values) {
  const center = mean(values);
  return Math.sqrt(values.reduce((sum, value) => sum + (value - center) ** 2, 0) / (values.length - 1));
}
function quantile(values, probability) {
  const sorted = [...values].sort((a, b) => a - b);
  const index = (sorted.length - 1) * probability;
  const lower = Math.floor(index), upper = Math.ceil(index);
  if (lower === upper) return sorted[lower];
  return sorted[lower] + (sorted[upper] - sorted[lower]) * (index - lower);
}
function summary(values) {
  return {
    min: Math.min(...values), max: Math.max(...values), mean: mean(values), standardDeviation: sampleSd(values),
    p10: quantile(values, 0.10), p50: quantile(values, 0.50), p90: quantile(values, 0.90),
  };
}

function rowPredictors(row) {
  return {
    contextHitQualityLogit: finite(row.derivedPredictors?.contextHitQualityLogit, 'context quality'),
    centeredLineupSlot: finite(row.derivedPredictors?.centeredLineupSlot, 'centered lineup slot'),
    platoonSplitCell: finite(row.conditioningInputs?.platoonSplitCell, 'platoon split cell'),
    opposingStarterPooling: finite(row.conditioningInputs?.opposingStarterPooling, 'opposing starter pooling'),
    teamImpliedRunTotal: finite(row.conditioningInputs?.teamImpliedRunTotal, 'team implied run total'),
    precedingLineupSlotsOnBaseQuality: finite(row.conditioningInputs?.precedingLineupSlotsOnBaseQuality, 'preceding on-base quality'),
  };
}

function correlation(left, right) {
  const leftMean = mean(left), rightMean = mean(right);
  const numerator = left.reduce((sum, value, index) => sum + (value - leftMean) * (right[index] - rightMean), 0);
  const denominator = Math.sqrt(
    left.reduce((sum, value) => sum + (value - leftMean) ** 2, 0) *
    right.reduce((sum, value) => sum + (value - rightMean) ** 2, 0),
  );
  if (!(denominator > 0)) throw new Error('predictor correlation has zero variance.');
  return numerator / denominator;
}

function fitNb2(rows, transforms) {
  const design = rows.map((row) => {
    const predictors = rowPredictors(row);
    return [1, ...PREDICTOR_ORDER.map((name) =>
      (predictors[name] - transforms[name].mean) / transforms[name].standardDeviation,
    )];
  });
  const offsets = rows.map((row) => Math.log(finite(row.conditioningInputs?.expectedPlateAppearances, 'expected PA')));
  const targets = rows.map((row) => finite(row.targetT, 'target T'));
  if (targets.some((value) => !Number.isInteger(value) || value < 0)) throw new Error('HHR target must be a nonnegative integer.');
  const baselineRate = targets.reduce((sum, value, index) => sum + value / Math.exp(offsets[index]), 0) / targets.length;
  let beta = [Math.log(baselineRate), ...Array(PREDICTOR_ORDER.length).fill(0)];
  let alpha = 0.5;
  const ridge = 1e-9;
  let finalNormal = null;
  for (let outer = 0; outer < 12; outer += 1) {
    for (let iteration = 0; iteration < 120; iteration += 1) {
      const size = beta.length;
      const normal = Array.from({ length: size }, () => Array(size).fill(0));
      const right = Array(size).fill(0);
      for (let index = 0; index < design.length; index += 1) {
        const x = design[index];
        const etaNoOffset = x.reduce((sum, value, coefficientIndex) => sum + value * beta[coefficientIndex], 0);
        const eta = offsets[index] + etaNoOffset;
        const mu = Math.exp(eta);
        if (!Number.isFinite(mu) || !(mu > 0)) throw new Error('HHR fitted mean became invalid.');
        const weight = mu / (1 + alpha * mu);
        const workingNoOffset = etaNoOffset + (targets[index] - mu) / mu;
        for (let row = 0; row < size; row += 1) {
          right[row] += weight * x[row] * workingNoOffset;
          for (let column = 0; column < size; column += 1) normal[row][column] += weight * x[row] * x[column];
        }
      }
      for (let diagonal = 0; diagonal < beta.length; diagonal += 1) normal[diagonal][diagonal] += ridge;
      const next = solve(normal, right, 'HHR IRLS normal equation');
      const change = Math.max(...next.map((value, index) => Math.abs(value - beta[index])));
      beta = next;
      finalNormal = normal;
      if (change < 1e-10) break;
    }
    let numerator = 0, denominator = 0;
    for (let index = 0; index < design.length; index += 1) {
      const eta = offsets[index] + design[index].reduce((sum, value, coefficientIndex) => sum + value * beta[coefficientIndex], 0);
      const mu = Math.exp(eta);
      numerator += (targets[index] - mu) ** 2 - mu;
      denominator += mu ** 2;
    }
    const nextAlpha = numerator / denominator;
    if (!Number.isFinite(nextAlpha) || !(nextAlpha > 0)) throw new Error('HHR rows do not support positive NB2 dispersion.');
    if (Math.abs(nextAlpha - alpha) < 1e-10) { alpha = nextAlpha; break; }
    alpha = nextAlpha;
  }
  if (!finalNormal || beta.some((value) => !Number.isFinite(value)) || !(alpha > 0)) throw new Error('HHR fit is invalid.');
  const covariance = invert(finalNormal, 'HHR coefficient information matrix');
  return { beta, alpha, covariance, numericalRidge: ridge };
}

const [fixtureText, boardText] = await Promise.all([readFile(FIXTURE_PATH, 'utf8'), readFile(BOARD_PATH, 'utf8')]);
const fixture = JSON.parse(fixtureText);
const board = JSON.parse(boardText);
if (fixture.schemaVersion !== 2 || fixture.expectedPaRole !== 'log offset with fixed coefficient 1') throw new Error('HHR respecified fixture contract mismatch.');
if (!Array.isArray(fixture.rows) || fixture.rows.length < 500) throw new Error('HHR fixture requires at least 500 rows.');
const requiredInputs = [
  'context-adjusted-terminal-outcome-vector','expected-plate-appearances','lineup-slot','platoon-split-cell',
  'opposing-starter-pooling','team-implied-run-total','preceding-lineup-slots-on-base-quality',
];
if (JSON.stringify(fixture.conditioningInputContract) !== JSON.stringify(requiredInputs)) throw new Error('HHR seven-input contract mismatch.');
if (Object.values(fixture.exclusionCounts).reduce((sum, count) => sum + count, 0) !== fixture.excludedRowCount) throw new Error('HHR exclusion counts do not conserve.');

const columns = Object.fromEntries(PREDICTOR_ORDER.map((name) => [name, fixture.rows.map((row) => rowPredictors(row)[name])]));
const predictorSummaries = Object.fromEntries(PREDICTOR_ORDER.map((name) => [name, summary(columns[name])]));
const transforms = Object.fromEntries(PREDICTOR_ORDER.map((name) => [name, {
  mean: predictorSummaries[name].mean,
  standardDeviation: predictorSummaries[name].standardDeviation,
} ]));
if (Object.values(transforms).some((entry) => !(entry.standardDeviation > 0))) throw new Error('HHR predictor has zero variance.');
const correlationMatrix = Object.fromEntries(PREDICTOR_ORDER.map((left) => [left,
  Object.fromEntries(PREDICTOR_ORDER.map((right) => [right, correlation(columns[left], columns[right])])),
]));
const numericCorrelation = PREDICTOR_ORDER.map((left) => PREDICTOR_ORDER.map((right) => correlationMatrix[left][right]));
const inverseCorrelation = invert(numericCorrelation, 'HHR predictor correlation matrix');
const varianceInflationFactors = Object.fromEntries(PREDICTOR_ORDER.map((name, index) => [name, inverseCorrelation[index][index]]));

const fit = fitNb2(fixture.rows, transforms);
const coefficientNames = ['intercept', ...PREDICTOR_ORDER];
const coefficients = Object.fromEntries(coefficientNames.map((name, index) => [name, fit.beta[index]]));
const coefficientInference = Object.fromEntries(coefficientNames.map((name, index) => {
  const standardError = Math.sqrt(fit.covariance[index][index]);
  return [name, {
    estimate: fit.beta[index], standardError,
    confidenceInterval95: [fit.beta[index] - 1.959963984540054 * standardError, fit.beta[index] + 1.959963984540054 * standardError],
  }];
}));

function predictMean(raw) {
  const linear = coefficients.intercept + PREDICTOR_ORDER.reduce((sum, name) =>
    sum + coefficients[name] * ((raw[name] - transforms[name].mean) / transforms[name].standardDeviation), 0);
  return raw.expectedPlateAppearances * Math.exp(linear);
}
const expectedPaMean = mean(fixture.rows.map((row) => finite(row.conditioningInputs.expectedPlateAppearances, 'expected PA')));
const quality = predictorSummaries.contextHitQualityLogit;
const nineCellPredictionTable = [];
for (const slot of [1,5,9]) {
  for (const [qualityPercentile, qualityValue] of [['p10',quality.p10],['p50',quality.p50],['p90',quality.p90]]) {
    const raw = Object.fromEntries(PREDICTOR_ORDER.map((name) => [name, transforms[name].mean]));
    raw.contextHitQualityLogit = qualityValue;
    raw.centeredLineupSlot = (slot - 5) / 4;
    raw.expectedPlateAppearances = expectedPaMean;
    nineCellPredictionTable.push({ lineupSlot: slot, qualityPercentile, qualityValue, expectedPlateAppearances: expectedPaMean, predictedMeanHhr: predictMean(raw) });
  }
}
const qualitySpreadBySlot = [1,5,9].map((slot) => {
  const cells = nineCellPredictionTable.filter((row) => row.lineupSlot === slot);
  const p10 = cells.find((row) => row.qualityPercentile === 'p10').predictedMeanHhr;
  const p90 = cells.find((row) => row.qualityPercentile === 'p90').predictedMeanHhr;
  return { lineupSlot: slot, p10, p90, ratio: p90 / p10, absoluteDifference: p90 - p10 };
});
const gates = {
  vif: {
    threshold: VIF_MAXIMUM,
    maximumObserved: Math.max(...Object.values(varianceInflationFactors)),
    passed: Object.values(varianceInflationFactors).every((value) => value <= VIF_MAXIMUM),
  },
  lineupSlotSign: {
    coefficient: coefficients.centeredLineupSlot,
    requirement: 'coefficient <= 0',
    passed: coefficients.centeredLineupSlot <= 0,
  },
  batterQualitySpread: {
    thresholdRatio: QUALITY_SPREAD_MINIMUM_RATIO,
    oldIllustrativeRatio: 1.0264815010195374,
    minimumObservedRatio: Math.min(...qualitySpreadBySlot.map((row) => row.ratio)),
    passed: qualitySpreadBySlot.every((row) => row.ratio >= QUALITY_SPREAD_MINIMUM_RATIO),
  },
};

const diagnosticsIdentity = {
  diagnosticsVersion: 1,
  modelVersion: 'm11-batter-hhr-direct-composite-v1',
  sourceFixtureSha256: sha256(fixtureText),
  rowCount: fixture.rows.length,
  gameCount: fixture.gameCount,
  predictorOrder: PREDICTOR_ORDER,
  predictorSummaries,
  pairwiseCorrelationMatrix: correlationMatrix,
  varianceInflationFactors,
  coefficientCovarianceMatrix: fit.covariance,
  coefficientInference,
  expectedPlateAppearancesSummary: summary(fixture.rows.map((row) => row.conditioningInputs.expectedPlateAppearances)),
  exclusionCounts: fixture.exclusionCounts,
  excludedRowCount: fixture.excludedRowCount,
  exclusionCountSum: fixture.exclusionCountSum,
  nineCellPredictionTable,
  qualitySpreadBySlot,
  acceptanceGates: gates,
};
const diagnostics = { ...diagnosticsIdentity, diagnosticsSha256: sha256(JSON.stringify(diagnosticsIdentity)) };
const modelIdentity = {
  artifactVersion: 1,
  modelVersion: 'm11-batter-hhr-direct-composite-v1',
  distributionBuilderVersion: 'm11-batter-hhr-negative-binomial-v1',
  mathematicalFamily: 'directly-fitted-composite',
  officialSettlementStatistic: 'hits+runs+rbis',
  activeSeason: 2026,
  productionEnabled: false,
  validationStatus: 'not-production-validated',
  fittingMethod: 'negative-binomial-log-link-irls-offset-v1',
  fittingDetails: {
    response: 'T=hits+runs+rbi', link: 'log', variance: 'mu+alpha*mu^2',
    expectedPlateAppearancesRole: 'offset', expectedPlateAppearancesCoefficient: 1,
    predictorOrder: coefficientNames, numericalRidge: fit.numericalRidge,
    independentMarginalConvolution: false, tripleJointFormed: false, monteCarloRuntime: false,
  },
  usedConditioningInputs: requiredInputs,
  excludedConditioningInputs: [],
  predictorTransforms: transforms,
  coefficients,
  dispersionAlpha: fit.alpha,
  fitEvidence: {
    provider: 'BALLDONTLIE MLB API', activeSeason: 2026, seasonType: 'regular',
    warmupStartDate: fixture.warmupWindow.startDate, warmupEndDate: fixture.warmupWindow.endDate,
    startDate: fixture.fitWindow.startDate, endDate: fixture.fitWindow.endDate,
    chronology: fixture.chronology, sourceFixtureSha256: sha256(fixtureText),
    gameCount: fixture.gameCount, rowCount: fixture.rows.length, excludedRowCount: fixture.excludedRowCount,
    diagnosticsSha256: diagnostics.diagnosticsSha256,
  },
  providerBoardEvidence: {
    provider: 'The Odds API', bookmaker: 'underdog', region: 'us_dfs',
    baselineMarketKey: 'batter_hits_runs_rbis', alternateMarketKey: 'batter_hits_runs_rbis_alternate',
    sourceFixtureSha256: sha256(boardText),
  },
  tailCollapseAt: 64,
  maximumExactPostedLine: 63.5,
  calibrationStatus: 'step-3-required',
  boxScoreVerificationStatus: 'step-3-required',
  blocker: 'M11 step 3 box-score verification and per-line calibration, including separate deep-line buckets, are incomplete.',
};
const model = { ...modelIdentity, artifactSha256: sha256(JSON.stringify(modelIdentity)) };
await mkdir(path.dirname(MODEL_PATH), { recursive: true });
await writeFile(DIAGNOSTICS_PATH, `${JSON.stringify(diagnostics, null, 2)}\n`);
await writeFile(MODEL_PATH, `${JSON.stringify(model, null, 2)}\n`);

console.log('=== M11 HHR RESPECIFIED FIT ===');
console.log(`ROWS: ${fixture.rows.length}`);
console.log(`GAMES: ${fixture.gameCount}`);
console.log('EXPECTED PA ROLE: offset');
console.log('EXPECTED PA COEFFICIENT: 1');
console.log(`COEFFICIENTS: ${JSON.stringify(coefficients)}`);
console.log(`DISPERSION ALPHA: ${fit.alpha}`);
for (const name of PREDICTOR_ORDER) console.log(`VIF ${name}: ${varianceInflationFactors[name]}`);
for (const row of nineCellPredictionTable) console.log(`PREDICTION slot=${row.lineupSlot} quality=${row.qualityPercentile}: ${row.predictedMeanHhr}`);
for (const row of qualitySpreadBySlot) console.log(`QUALITY SPREAD slot=${row.lineupSlot}: ratio=${row.ratio} difference=${row.absoluteDifference}`);
console.log(`GATE A VIF <= ${VIF_MAXIMUM}: ${gates.vif.passed}`);
console.log(`GATE B LINEUP SLOT NON-POSITIVE: ${gates.lineupSlotSign.passed}`);
console.log(`GATE C QUALITY RATIO >= ${QUALITY_SPREAD_MINIMUM_RATIO}: ${gates.batterQualitySpread.passed}`);
console.log(`EXCLUSION SUM: ${fixture.exclusionCountSum}`);
console.log(`MODEL SHA-256: ${model.artifactSha256}`);
console.log(`DIAGNOSTICS SHA-256: ${diagnostics.diagnosticsSha256}`);
console.log('PRODUCTION ENABLED: false');
console.log('RANKING ENABLED: false');
console.log('=== END M11 HHR RESPECIFIED FIT ===');

if (!gates.vif.passed) throw new Error(`GATE A FAILED: maximum VIF ${gates.vif.maximumObserved} exceeds ${VIF_MAXIMUM}.`);
if (!gates.lineupSlotSign.passed) throw new Error(`GATE B FAILED: lineup-slot coefficient ${coefficients.centeredLineupSlot} is positive.`);
if (!gates.batterQualitySpread.passed) throw new Error(`GATE C FAILED: minimum quality ratio ${gates.batterQualitySpread.minimumObservedRatio} is below ${QUALITY_SPREAD_MINIMUM_RATIO}.`);
