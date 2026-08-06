import { createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

const fixturePath = process.env.M11_HHR_FIT_FIXTURE_PATH ??
  path.resolve('fixtures/sanitized/m11/hhr/2026-08-05/balldontlie-hhr-fit-v1.json');
const boardPath = process.env.M11_HHR_BOARD_FIXTURE_PATH ??
  path.resolve('fixtures/sanitized/m11/hhr/2026-08-05/the-odds-api-underdog-hhr-v1.json');
const outputPath = process.env.M11_HHR_MODEL_ARTIFACT_PATH ??
  path.resolve('model-artifacts/m11-batter-hhr-direct-composite-v1.json');

const sha256 = (value) => createHash('sha256').update(value).digest('hex');

function assertFinite(value, label) {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new TypeError(`${label} must be finite.`);
  }
  return value;
}

function solveLinearSystem(matrixInput, vectorInput) {
  const matrix = matrixInput.map((row, index) => [
    ...row,
    vectorInput[index],
  ]);
  const size = vectorInput.length;
  for (let column = 0; column < size; column += 1) {
    let pivot = column;
    for (let row = column + 1; row < size; row += 1) {
      if (Math.abs(matrix[row][column]) > Math.abs(matrix[pivot][column])) {
        pivot = row;
      }
    }
    if (Math.abs(matrix[pivot][column]) < 1e-12) {
      throw new Error('HHR fitting normal equation is singular.');
    }
    [matrix[column], matrix[pivot]] = [matrix[pivot], matrix[column]];
    const divisor = matrix[column][column];
    for (let entry = column; entry <= size; entry += 1) {
      matrix[column][entry] /= divisor;
    }
    for (let row = 0; row < size; row += 1) {
      if (row === column) continue;
      const factor = matrix[row][column];
      for (let entry = column; entry <= size; entry += 1) {
        matrix[row][entry] -= factor * matrix[column][entry];
      }
    }
  }
  return matrix.map((row) => row[size]);
}

function fitNegativeBinomial(rows) {
  const design = rows.map((row) => [
    1,
    Math.log(assertFinite(row.expectedPlateAppearances, 'expected PA')),
    assertFinite(row.terminalHitProbability, 'terminal Hit probability'),
    (assertFinite(row.lineupSlot, 'lineup slot') - 5) / 4,
  ]);
  const targets = rows.map((row) => assertFinite(row.targetT, 'target T'));
  if (targets.some((value) => !Number.isInteger(value) || value < 0)) {
    throw new Error('HHR target T values must be non-negative integers.');
  }
  const meanTarget = targets.reduce((sum, value) => sum + value, 0) / targets.length;
  if (!(meanTarget > 0)) throw new Error('HHR fit target mean must be positive.');

  let beta = [Math.log(meanTarget), 0, 0, 0];
  let alpha = 0.5;
  const ridge = 1e-9;

  for (let outer = 0; outer < 8; outer += 1) {
    for (let iteration = 0; iteration < 80; iteration += 1) {
      const normal = Array.from({ length: 4 }, () => Array(4).fill(0));
      const right = Array(4).fill(0);
      for (let index = 0; index < design.length; index += 1) {
        const x = design[index];
        const y = targets[index];
        const eta = x.reduce((sum, value, coefficientIndex) =>
          sum + value * beta[coefficientIndex], 0);
        const mu = Math.exp(eta);
        if (!Number.isFinite(mu) || !(mu > 0)) {
          throw new Error('HHR fitted mean became invalid.');
        }
        const weight = mu / (1 + alpha * mu);
        const working = eta + (y - mu) / mu;
        for (let row = 0; row < 4; row += 1) {
          right[row] += weight * x[row] * working;
          for (let column = 0; column < 4; column += 1) {
            normal[row][column] += weight * x[row] * x[column];
          }
        }
      }
      for (let diagonal = 0; diagonal < 4; diagonal += 1) {
        normal[diagonal][diagonal] += ridge;
      }
      const next = solveLinearSystem(normal, right);
      const maximumChange = Math.max(...next.map((value, index) =>
        Math.abs(value - beta[index])));
      beta = next;
      if (maximumChange < 1e-11) break;
    }

    let numerator = 0;
    let denominator = 0;
    for (let index = 0; index < design.length; index += 1) {
      const eta = design[index].reduce((sum, value, coefficientIndex) =>
        sum + value * beta[coefficientIndex], 0);
      const mu = Math.exp(eta);
      const residual = targets[index] - mu;
      numerator += residual * residual - mu;
      denominator += mu * mu;
    }
    const nextAlpha = numerator / denominator;
    if (!Number.isFinite(nextAlpha) || !(nextAlpha > 0)) {
      throw new Error('HHR current-season rows do not support positive NB2 dispersion.');
    }
    if (Math.abs(nextAlpha - alpha) < 1e-11) {
      alpha = nextAlpha;
      break;
    }
    alpha = nextAlpha;
  }

  if (beta.some((value) => !Number.isFinite(value)) || !Number.isFinite(alpha) || !(alpha > 0)) {
    throw new Error('HHR fitted coefficients are invalid.');
  }
  return { beta, alpha, numericalRidge: ridge };
}

const [fixtureText, boardText] = await Promise.all([
  readFile(fixturePath, 'utf8'),
  readFile(boardPath, 'utf8'),
]);
const fixture = JSON.parse(fixtureText);
const board = JSON.parse(boardText);
if (fixture.schemaVersion !== 1 || fixture.provider !== 'BALLDONTLIE MLB API') {
  throw new Error('HHR fit fixture identity mismatch.');
}
if (!Array.isArray(fixture.rows) || fixture.rows.length < 100) {
  throw new Error('HHR fit fixture requires at least 100 strictly chronological rows.');
}
if (
  board.captureVersion !== 1 ||
  board.request?.provider !== 'The Odds API' ||
  board.request?.bookmaker !== 'underdog' ||
  board.request?.region !== 'us_dfs'
) {
  throw new Error('HHR board fixture identity mismatch.');
}

const fit = fitNegativeBinomial(fixture.rows);
const identity = {
  artifactVersion: 1,
  modelVersion: 'm11-batter-hhr-direct-composite-v1',
  distributionBuilderVersion: 'm11-batter-hhr-negative-binomial-v1',
  mathematicalFamily: 'directly-fitted-composite',
  officialSettlementStatistic: 'hits+runs+rbis',
  activeSeason: 2026,
  productionEnabled: false,
  validationStatus: 'not-production-validated',
  fittingMethod: 'negative-binomial-log-link-irls-v1',
  fittingDetails: {
    response: 'T=hits+runs+rbi',
    link: 'log',
    variance: 'mu+alpha*mu^2',
    predictorOrder: [
      'intercept',
      'log(expectedPlateAppearances)',
      'terminalHitProbability',
      'centeredLineupSlot=(lineupSlot-5)/4',
    ],
    numericalRidge: fit.numericalRidge,
    independentMarginalConvolution: false,
    tripleJointFormed: false,
    monteCarloRuntime: false,
  },
  usedConditioningInputs: [
    'context-adjusted-terminal-outcome-vector',
    'expected-plate-appearances',
    'lineup-slot',
  ],
  excludedConditioningInputs: [
    'platoon-split-cell',
    'opposing-starter-pooling',
    'team-implied-run-total',
    'preceding-lineup-slots-on-base-quality',
  ],
  coefficients: {
    intercept: fit.beta[0],
    logExpectedPlateAppearances: fit.beta[1],
    terminalHitProbability: fit.beta[2],
    centeredLineupSlot: fit.beta[3],
  },
  dispersionAlpha: fit.alpha,
  fitEvidence: {
    provider: 'BALLDONTLIE MLB API',
    activeSeason: 2026,
    seasonType: 'regular',
    startDate: fixture.startDate,
    endDate: fixture.endDate,
    chronology: 'strictly-earlier-date-predictors',
    sourceFixtureSha256: sha256(fixtureText),
    gameCount: fixture.gameCount,
    rowCount: fixture.rows.length,
    excludedRowCount: fixture.excludedRowCount,
  },
  providerBoardEvidence: {
    provider: 'The Odds API',
    bookmaker: 'underdog',
    region: 'us_dfs',
    baselineMarketKey: 'batter_hits_runs_rbis',
    alternateMarketKey: 'batter_hits_runs_rbis_alternate',
    sourceFixtureSha256: sha256(boardText),
  },
  tailCollapseAt: 64,
  maximumExactPostedLine: 63.5,
  calibrationStatus: 'step-3-required',
  boxScoreVerificationStatus: 'step-3-required',
  blocker:
    'M11 step 3 box-score verification and per-line calibration, including separate deep-line buckets, are incomplete.',
};
const artifact = {
  ...identity,
  artifactSha256: sha256(JSON.stringify(identity)),
};
await writeFile(outputPath, `${JSON.stringify(artifact, null, 2)}\n`);
console.log('=== M11 HHR DIRECT COMPOSITE FIT ===');
console.log(`Rows: ${fixture.rows.length}`);
console.log(`Games: ${fixture.gameCount}`);
console.log(`Coefficients: ${JSON.stringify(artifact.coefficients)}`);
console.log(`Dispersion alpha: ${artifact.dispersionAlpha}`);
console.log(`Artifact SHA-256: ${artifact.artifactSha256}`);
console.log('Independent marginal convolution: false');
console.log('Triple joint formed: false');
console.log('Production enabled: false');
console.log('=== END M11 HHR DIRECT COMPOSITE FIT ===');
