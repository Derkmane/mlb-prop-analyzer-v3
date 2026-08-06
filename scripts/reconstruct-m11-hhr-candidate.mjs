import { createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

const DIAGNOSTICS_PATH = path.resolve('model-artifacts/m11-batter-hhr-direct-composite-diagnostics-v2.json');
const FIT_LOG_PATH = path.resolve('artifacts/workflow-logs/m11-hhr-attempt2-fit.log');
const STATUS_PATH = path.resolve('artifacts/workflow-logs/m11-hhr-attempt2-status.json');
const INVESTIGATION_PATH = path.resolve('artifacts/workflow-logs/m11-hhr-attempt2-investigation.json');
const DESIGN_PATH = path.resolve('fixtures/sanitized/m11/hhr/respecified-v2/balldontlie-hhr-design-matrix-v2.json');
const BOARD_PATH = path.resolve('fixtures/sanitized/m11/hhr/respecified-v2/the-odds-api-underdog-hhr-board-v2.json');
const OUTPUT_PATH = path.resolve('model-artifacts/m11-batter-hhr-direct-composite-v2.json');
const PREDICTOR_ORDER = Object.freeze([
  'contextHitQualityLogit',
  'centeredLineupSlot',
  'platoonSplitCell',
  'opposingStarterPooling',
  'teamImpliedRunTotal',
  'precedingLineupSlotsOnBaseQuality',
]);
const sha256 = (value) => createHash('sha256').update(value).digest('hex');
const jsonBytes = (value) => Buffer.from(`${JSON.stringify(value, null, 2)}\n`, 'utf8');
const blockBytes = (value) => Buffer.from(JSON.stringify(value), 'utf8');

async function readJson(filePath) {
  const text = await readFile(filePath, 'utf8');
  return { value: JSON.parse(text), text, sha256: sha256(text) };
}

const [diagnosticsFile, fitLog, statusFile, investigationFile, designFile, boardFile] = await Promise.all([
  readJson(DIAGNOSTICS_PATH),
  readFile(FIT_LOG_PATH, 'utf8'),
  readJson(STATUS_PATH),
  readJson(INVESTIGATION_PATH),
  readJson(DESIGN_PATH),
  readJson(BOARD_PATH),
]);
const diagnostics = diagnosticsFile.value;
const status = statusFile.value;
const investigation = investigationFile.value;
const design = designFile.value;

if (diagnostics.modelVersion !== 'm11-batter-hhr-direct-composite-v2') throw new Error('Persisted diagnostics model identity drifted.');
if (diagnostics.coefficientScale !== 'standardized-per-sample-standard-deviation') throw new Error('Persisted coefficient scale drifted.');
if (JSON.stringify(diagnostics.predictorOrder) !== JSON.stringify(PREDICTOR_ORDER)) throw new Error('Persisted predictor order drifted.');
if (status.lookaheadAudit?.overlap !== false || status.lookaheadAudit?.fittedRowsOnOrBeforePitcherAllowedEndDate !== 0) throw new Error('Persisted lookahead attestation is not clean.');
if (investigation.fitWindow?.startDate !== '2026-07-06' || investigation.fitWindow?.endDate !== '2026-08-05') throw new Error('Persisted fitted window drifted.');
if (design.rowCount !== diagnostics.rowCount || design.gameCount !== diagnostics.gameCount) throw new Error('Design and diagnostics counts differ.');

const alphaMatch = fitLog.match(/^DISPERSION ALPHA: ([0-9]+(?:\.[0-9]+)?)$/mu);
if (!alphaMatch) throw new Error('Persisted fit log does not contain one dispersion alpha.');
const dispersionAlpha = Number(alphaMatch[1]);
if (!(dispersionAlpha > 0) || !Number.isFinite(dispersionAlpha)) throw new Error('Persisted dispersion alpha is invalid.');
const printedDiagnosticsHash = fitLog.match(/^DIAGNOSTICS SHA-256: ([a-f0-9]{64})$/mu)?.[1];
if (printedDiagnosticsHash !== diagnosticsFile.sha256) throw new Error('Persisted diagnostics bytes do not match the Attempt 2 fit log hash.');

const predictorTransforms = Object.fromEntries(PREDICTOR_ORDER.map((name) => {
  const summary = diagnostics.predictorSummaries?.[name];
  if (!summary || !Number.isFinite(summary.mean) || !(summary.standardDeviation > 0)) throw new Error(`Persisted transform ${name} is invalid.`);
  return [name, { mean: summary.mean, standardDeviation: summary.standardDeviation }];
}));
const coefficients = Object.fromEntries(['intercept', ...PREDICTOR_ORDER].map((name) => {
  const value = diagnostics.coefficientInference?.[name]?.estimate;
  if (!Number.isFinite(value)) throw new Error(`Persisted coefficient ${name} is invalid.`);
  return [name, value];
}));

const sourceCoefficientBlock = {
  coefficientScale: diagnostics.coefficientScale,
  predictorOrder: diagnostics.predictorOrder,
  predictorStandardDeviations: diagnostics.predictorStandardDeviations,
  predictorTransforms,
  coefficients,
  standardizedCoefficientTable: diagnostics.standardizedCoefficientTable,
  coefficientInference: diagnostics.coefficientInference,
  coefficientCovarianceMatrix: diagnostics.coefficientCovarianceMatrix,
  pairwiseCorrelationMatrix: diagnostics.pairwiseCorrelationMatrix,
  varianceInflationFactors: diagnostics.varianceInflationFactors,
};
const reconstructedCoefficientBlock = JSON.parse(JSON.stringify(sourceCoefficientBlock));
const sourceCoefficientBlockBytes = blockBytes(sourceCoefficientBlock);
const reconstructedCoefficientBlockBytes = blockBytes(reconstructedCoefficientBlock);
const sourceCoefficientBlockSha256 = sha256(sourceCoefficientBlockBytes);
const reconstructedCoefficientBlockSha256 = sha256(reconstructedCoefficientBlockBytes);
if (!sourceCoefficientBlockBytes.equals(reconstructedCoefficientBlockBytes)) throw new Error('Reconstructed coefficient block differs byte for byte from persisted diagnostics.');
if (sourceCoefficientBlockSha256 !== reconstructedCoefficientBlockSha256) throw new Error('Reconstructed coefficient-block hashes differ.');

const excludedRowCount = Object.values(design.exclusionCounts ?? {}).reduce((sum, value) => sum + Number(value), 0);
if (excludedRowCount !== design.excludedRowCount) throw new Error('Persisted exclusion counts do not conserve.');
const usedConditioningInputs = [
  'context-adjusted-terminal-outcome-vector',
  'expected-plate-appearances',
  'lineup-slot',
  'platoon-split-cell',
  'opposing-starter-pooling',
  'team-implied-run-total',
  'preceding-lineup-slots-on-base-quality',
];
const artifactWithoutHash = {
  artifactVersion: 2,
  status: 'CANDIDATE',
  modelVersion: 'm11-batter-hhr-direct-composite-v2',
  distributionBuilderVersion: 'm11-batter-hhr-negative-binomial-v1',
  mathematicalFamily: 'directly-fitted-composite',
  officialSettlementStatistic: 'hits+runs+rbis',
  activeSeason: 2026,
  productionEnabled: false,
  rankingEnabled: false,
  validationStatus: 'not-production-validated',
  fittingMethod: 'negative-binomial-log-link-irls-offset-v1',
  fittingDetails: {
    response: 'T=hits+runs+rbi',
    link: 'log',
    variance: 'mu+alpha*mu^2',
    expectedPlateAppearancesRole: 'offset',
    expectedPlateAppearancesCoefficient: 1,
    coefficientScale: diagnostics.coefficientScale,
    predictorStandardDeviations: diagnostics.predictorStandardDeviations,
    predictorOrder: diagnostics.predictorOrder,
    numericalRidge: 1e-9,
    independentMarginalConvolution: false,
    tripleJointFormed: false,
    monteCarloRuntime: false,
  },
  usedConditioningInputs,
  excludedConditioningInputs: [],
  predictorTransforms,
  coefficients,
  dispersionAlpha,
  fitEvidence: {
    provider: 'BALLDONTLIE MLB API',
    activeSeason: 2026,
    seasonType: 'regular',
    warmupStartDate: status.lookaheadAudit.hhrWarmupStartDate,
    warmupEndDate: status.lookaheadAudit.hhrWarmupEndDate,
    startDate: investigation.fitWindow.startDate,
    endDate: investigation.fitWindow.endDate,
    chronology: 'all fitted rows are strictly after the frozen pitcherAllowed end date; zero fitted rows occur on or before 2026-07-05',
    sourceFixtureSha256: designFile.sha256,
    gameCount: diagnostics.gameCount,
    rowCount: diagnostics.rowCount,
    excludedRowCount,
    diagnosticsSha256: diagnosticsFile.sha256,
  },
  providerBoardEvidence: {
    provider: 'The Odds API',
    bookmaker: 'underdog',
    region: 'us_dfs',
    baselineMarketKey: 'batter_hits_runs_rbis',
    alternateMarketKey: 'batter_hits_runs_rbis_alternate',
    sourceFixtureSha256: boardFile.sha256,
  },
  reconstructionEvidence: {
    method: 'hash-verified-reconstruction-without-refit',
    sourceAttemptHead: '5278d63f123207772a76f25c482c5cecbb919331',
    diagnosticsSha256: diagnosticsFile.sha256,
    fitLogSha256: sha256(fitLog),
    statusSha256: statusFile.sha256,
    investigationSha256: investigationFile.sha256,
    sourceCoefficientBlockSha256,
    reconstructedCoefficientBlockSha256,
    coefficientBlockByteIdentical: true,
    coefficientBlock: reconstructedCoefficientBlock,
    dispersionAlphaSource: 'immutable Attempt 2 fit log literal',
    refitPerformed: false,
  },
  chronologyAttestation: status.lookaheadAudit,
  tailCollapseAt: 64,
  maximumExactPostedLine: 63.5,
  calibrationStatus: 'step-3-required',
  boxScoreVerificationStatus: 'step-3-required',
  blocker: 'step-3-evidence-review-required',
};
const artifactSha256 = sha256(jsonBytes(artifactWithoutHash));
const artifact = { ...artifactWithoutHash, artifactSha256 };
await writeFile(OUTPUT_PATH, jsonBytes(artifact));

console.log('=== M11 HHR CANDIDATE RECONSTRUCTION ===');
console.log('DIAGNOSTICS SHA-256:', diagnosticsFile.sha256);
console.log('FIT LOG SHA-256:', sha256(fitLog));
console.log('SOURCE COEFFICIENT BLOCK SHA-256:', sourceCoefficientBlockSha256);
console.log('RECONSTRUCTED COEFFICIENT BLOCK SHA-256:', reconstructedCoefficientBlockSha256);
console.log('COEFFICIENT BLOCK BYTE IDENTICAL:', true);
console.log('DISPERSION ALPHA:', dispersionAlpha);
console.log('REFIT PERFORMED:', false);
console.log('CANDIDATE ARTIFACT SHA-256:', artifactSha256);
console.log('PRODUCTION ENABLED:', false);
console.log('RANKING ENABLED:', false);
console.log('=== END M11 HHR CANDIDATE RECONSTRUCTION ===');
