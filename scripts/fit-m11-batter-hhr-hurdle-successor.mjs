import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

import {
  buildPositiveDesignRows,
  evaluateHhrHurdleSuccessorGate,
  fitZeroTruncatedNb2DesignRows,
  HHR_CONDITIONED_HURDLE_ZERO_COMPONENT,
  HHR_SUCCESSOR_GATE,
  HHR_SUCCESSOR_PREDICTOR_ORDER,
  hurdlePredictionForFixtureRow,
} from './m11-hhr-hurdle-successor-fit-utils.mjs';

const MATRIX_PATH = path.resolve('fixtures/sanitized/m11/hhr/respecified-v2/balldontlie-hhr-design-matrix-v2.json');
const BOARD_PATH = path.resolve('fixtures/sanitized/m11/hhr/respecified-v2/the-odds-api-underdog-hhr-board-v2.json');
const PARENT_MODEL_PATH = path.resolve('model-artifacts/m11-batter-hhr-direct-composite-v2.json');
const REPORT_PATH = path.resolve('artifacts/m11/hhr/successor-fit/m11-hhr-hurdle-successor-fit-v1.json');
const CANDIDATE_PATH = path.resolve('model-artifacts/m11-batter-hhr-hurdle-successor-v1.json');
const EXPECTED_TOTAL_ROWS = 5964;
const EXPECTED_POSITIVE_ROWS = 3987;

const sha256 = (value) => createHash('sha256').update(value).digest('hex');

function assertFinite(value, label) {
  if (typeof value !== 'number' || !Number.isFinite(value)) throw new Error(`${label} must be finite.`);
  return value;
}

const [matrixText, boardText, parentModelText] = await Promise.all([
  readFile(MATRIX_PATH, 'utf8'),
  readFile(BOARD_PATH, 'utf8'),
  readFile(PARENT_MODEL_PATH, 'utf8'),
]);
const matrix = JSON.parse(matrixText);
const parentModel = JSON.parse(parentModelText);

if (parentModel.modelVersion !== 'm11-batter-hhr-direct-composite-v2') throw new Error('Parent HHR model identity drifted.');
if (parentModel.fitEvidence?.sourceFixtureSha256 !== sha256(matrixText)) throw new Error('HHR fitting matrix bytes do not match parent model lineage.');
if (parentModel.providerBoardEvidence?.sourceFixtureSha256 !== sha256(boardText)) throw new Error('HHR board bytes do not match parent model lineage.');
if (!Array.isArray(matrix.rows) || matrix.rows.length !== EXPECTED_TOTAL_ROWS || parentModel.fitEvidence?.rowCount !== EXPECTED_TOTAL_ROWS) {
  throw new Error(`HHR successor requires exactly ${EXPECTED_TOTAL_ROWS} fitting rows.`);
}
if (parentModel.fittingDetails?.expectedPlateAppearancesRole !== 'offset' || parentModel.fittingDetails?.expectedPlateAppearancesCoefficient !== 1) {
  throw new Error('Parent HHR expected-PA offset contract drifted.');
}
const parentPredictorOrder = parentModel.fittingDetails?.predictorOrder;
const expectedParentOrder = ['intercept', ...HHR_SUCCESSOR_PREDICTOR_ORDER];
if (JSON.stringify(parentPredictorOrder) !== JSON.stringify(expectedParentOrder)) throw new Error('Parent HHR predictor order drifted.');

const transforms = parentModel.predictorTransforms;
for (const name of HHR_SUCCESSOR_PREDICTOR_ORDER) {
  const transform = transforms?.[name];
  if (!transform || !Number.isFinite(transform.mean) || !(transform.standardDeviation > 0)) throw new Error(`Parent HHR transform ${name} is invalid.`);
}
const positiveRows = matrix.rows.filter((row) => row.targetT >= 1);
if (positiveRows.length !== EXPECTED_POSITIVE_ROWS) throw new Error(`HHR successor requires exactly ${EXPECTED_POSITIVE_ROWS} positive-count rows.`);
if (matrix.rows.some((row) => !Number.isInteger(row.targetT) || row.targetT < 0)) throw new Error('HHR target T must be a nonnegative integer.');

const designRows = buildPositiveDesignRows(matrix.rows, transforms);
const initialBeta = [parentModel.coefficients.intercept, ...HHR_SUCCESSOR_PREDICTOR_ORDER.map((name) => parentModel.coefficients[name])];
const initialAlpha = assertFinite(parentModel.dispersionAlpha, 'parent dispersion alpha');
const fit = fitZeroTruncatedNb2DesignRows(designRows, { beta: initialBeta, alpha: initialAlpha });
if (!fit.converged || fit.maxAbsFinalGradient > 1e-6 || !(fit.finalAverageNegativeLogLikelihood < fit.initialAverageNegativeLogLikelihood)) {
  throw new Error(`SUCCESSOR_FIT_DID_NOT_CONVERGE converged=${fit.converged} maxAbsFinalGradient=${fit.maxAbsFinalGradient} initialNll=${fit.initialAverageNegativeLogLikelihood} finalNll=${fit.finalAverageNegativeLogLikelihood}`);
}

const coefficientNames = ['intercept', ...HHR_SUCCESSOR_PREDICTOR_ORDER];
const coefficients = Object.freeze(Object.fromEntries(coefficientNames.map((name, index) => [name, fit.beta[index]])));
const gateRows = matrix.rows.map((row) => {
  const prediction = hurdlePredictionForFixtureRow(row, transforms, coefficients, fit.alpha);
  return Object.freeze({
    fittedMean: prediction.fittedMean,
    observedT: row.targetT,
    predictedZero: prediction.rho,
    predictedUpperTails: prediction.upperTails,
  });
});
const gate = evaluateHhrHurdleSuccessorGate(gateRows, HHR_SUCCESSOR_GATE);

const reportIdentity = Object.freeze({
  reportVersion: 1,
  reportType: 'm11-hhr-hurdle-successor-fit-gate',
  canonicalMathVersion: '1.12',
  status: gate.passed ? 'FIT_GATE_PASSED' : 'FIT_GATE_FAILED',
  productionEnabled: false,
  rankingEnabled: false,
  source: Object.freeze({
    parentModelPath: path.relative(process.cwd(), PARENT_MODEL_PATH),
    parentModelFileSha256: sha256(parentModelText),
    fittingMatrixPath: path.relative(process.cwd(), MATRIX_PATH),
    fittingMatrixFileSha256: sha256(matrixText),
    boardPath: path.relative(process.cwd(), BOARD_PATH),
    boardFileSha256: sha256(boardText),
  }),
  fittingEvidence: Object.freeze({
    activeSeason: parentModel.fitEvidence.activeSeason,
    startDate: parentModel.fitEvidence.startDate,
    endDate: parentModel.fitEvidence.endDate,
    gameCount: parentModel.fitEvidence.gameCount,
    totalRowCount: matrix.rows.length,
    positiveRowCount: positiveRows.length,
    positiveRowCondition: 'T>=1',
    predictorOrder: HHR_SUCCESSOR_PREDICTOR_ORDER,
    predictorStandardization: 'preserved exactly from m11-batter-hhr-direct-composite-v2',
    predictorTransforms: transforms,
    link: 'log',
    expectedPlateAppearancesRole: 'offset',
    expectedPlateAppearancesCoefficient: 1,
  }),
  zeroComponent: HHR_CONDITIONED_HURDLE_ZERO_COMPONENT,
  positiveCountFit: Object.freeze({
    family: 'zero-truncated-NB2',
    likelihood: 'sum log NB2(T|mu,alpha) - log(1-NB2(0|mu,alpha)) over T>=1 rows',
    coefficients,
    dispersionAlpha: fit.alpha,
    optimizer: fit.optimizer,
    iterations: fit.iterations,
    converged: fit.converged,
    maxAbsFinalGradient: fit.maxAbsFinalGradient,
    initialAverageNegativeLogLikelihood: fit.initialAverageNegativeLogLikelihood,
    finalAverageNegativeLogLikelihood: fit.finalAverageNegativeLogLikelihood,
    logLikelihood: fit.logLikelihood,
  }),
  gate,
  untouchedReservationRead: false,
});
const report = Object.freeze({ ...reportIdentity, reportSha256: sha256(JSON.stringify(reportIdentity)) });
await mkdir(path.dirname(REPORT_PATH), { recursive: true });
await writeFile(REPORT_PATH, `${JSON.stringify(report, null, 2)}\n`);

console.log('=== M11 HHR HURDLE SUCCESSOR FIT ===');
console.log(`TOTAL ROWS: ${matrix.rows.length}`);
console.log(`POSITIVE ROWS: ${positiveRows.length}`);
console.log(`COEFFICIENTS: ${JSON.stringify(coefficients)}`);
console.log(`DISPERSION ALPHA: ${fit.alpha}`);
console.log(`OPTIMIZER: ${fit.optimizer}`);
console.log(`ITERATIONS: ${fit.iterations}`);
console.log(`MAX ABS FINAL GRADIENT: ${fit.maxAbsFinalGradient}`);
console.log(`INITIAL AVG NLL: ${fit.initialAverageNegativeLogLikelihood}`);
console.log(`FINAL AVG NLL: ${fit.finalAverageNegativeLogLikelihood}`);
console.log(`ZERO MAX ABS GAP: ${gate.summary.maxZeroGap}`);
for (const threshold of HHR_SUCCESSOR_GATE.thresholds) console.log(`TAIL ${threshold} MAX ABS GAP: ${gate.summary.maxTailGapByThreshold[String(threshold)]}`);
console.log(`ALPHA IMPLIED RANGE [INFORMATIONAL]: ${gate.summary.alphaImpliedRange}`);
console.log(`FIT GATE: ${gate.verdict}`);
console.log('UNTOUCHED RESERVATION READ: false');

if (!gate.passed) {
  console.log(`REPORT SHA-256: ${report.reportSha256}`);
  console.log('CANDIDATE PERSISTED: false');
  console.log('PRODUCTION ENABLED: false');
  console.log('RANKING ENABLED: false');
  console.log('=== END M11 HHR HURDLE SUCCESSOR FIT ===');
  process.exitCode = 1;
} else {
  const candidateIdentity = Object.freeze({
    artifactVersion: 3,
    status: 'CANDIDATE',
    modelVersion: 'm11-batter-hhr-hurdle-successor-v1',
    distributionBuilderVersion: 'm11-batter-hhr-conditioned-hurdle-ztnb2-v1',
    mathematicalFamily: 'directly-fitted-composite-hurdle',
    officialSettlementStatistic: 'hits+runs+rbis',
    activeSeason: 2026,
    productionEnabled: false,
    rankingEnabled: false,
    validationStatus: 'fit-gate-passed-awaiting-untouched-evaluation',
    fittingMethod: 'conditioned-hurdle-zero-truncated-nb2-positive-refit-v1',
    fittingDetails: Object.freeze({
      zeroComponent: HHR_CONDITIONED_HURDLE_ZERO_COMPONENT,
      positiveCountFamily: 'NB2 conditioned on T>=1',
      positiveCountLikelihood: 'zero-truncated NB2',
      link: 'log',
      expectedPlateAppearancesRole: 'offset',
      expectedPlateAppearancesCoefficient: 1,
      coefficientScale: parentModel.fittingDetails.coefficientScale,
      predictorOrder: expectedParentOrder,
      predictorStandardDeviations: parentModel.fittingDetails.predictorStandardDeviations,
      optimizer: fit.optimizer,
    }),
    usedConditioningInputs: parentModel.usedConditioningInputs,
    excludedConditioningInputs: parentModel.excludedConditioningInputs,
    predictorTransforms: transforms,
    coefficients,
    dispersionAlpha: fit.alpha,
    fitEvidence: Object.freeze({
      provider: 'BALLDONTLIE MLB API',
      activeSeason: parentModel.fitEvidence.activeSeason,
      seasonType: parentModel.fitEvidence.seasonType,
      warmupStartDate: parentModel.fitEvidence.warmupStartDate,
      warmupEndDate: parentModel.fitEvidence.warmupEndDate,
      startDate: parentModel.fitEvidence.startDate,
      endDate: parentModel.fitEvidence.endDate,
      chronology: parentModel.fitEvidence.chronology,
      sourceFixtureSha256: sha256(matrixText),
      parentModelFileSha256: sha256(parentModelText),
      gameCount: parentModel.fitEvidence.gameCount,
      rowCount: matrix.rows.length,
      positiveRowCount: positiveRows.length,
      positiveRowCondition: 'T>=1',
      fitGateReportSha256: report.reportSha256,
    }),
    providerBoardEvidence: parentModel.providerBoardEvidence,
    distributionShapeGate: gate,
    untouchedReservationStatus: 'SEALED_NOT_READ',
    tailCollapseAt: parentModel.tailCollapseAt,
    maximumExactPostedLine: parentModel.maximumExactPostedLine,
    calibrationStatus: 'untouched-evaluation-required',
    boxScoreVerificationStatus: 'untouched-evaluation-required',
    blocker: 'Reserved untouched evaluation, calibration, coherence, and production enablement remain required.',
  });
  const candidate = Object.freeze({ ...candidateIdentity, artifactSha256: sha256(JSON.stringify(candidateIdentity)) });
  await writeFile(CANDIDATE_PATH, `${JSON.stringify(candidate, null, 2)}\n`);
  console.log(`REPORT SHA-256: ${report.reportSha256}`);
  console.log(`CANDIDATE ARTIFACT SHA-256: ${candidate.artifactSha256}`);
  console.log('CANDIDATE PERSISTED: true');
  console.log('PRODUCTION ENABLED: false');
  console.log('RANKING ENABLED: false');
  console.log('=== END M11 HHR HURDLE SUCCESSOR FIT ===');
}
