import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

import {
  buildBatterHhrDirectCompositeDistribution,
  normalizeUnderdogBatterHhrCapture,
  validateBatterHhrDirectCompositeArtifact,
} from '../dist/src/features/batter-hhr/index.js';
import {
  evaluateFamilyBDistributionShapeGate,
  FAMILY_B_CANONICAL_MINIMUM_ROWS_PER_BIN,
  FAMILY_B_CANONICAL_TOLERANCE_CEILINGS,
  FAMILY_B_EQUAL_COUNT_BINNING_RULE,
} from './m11-hhr-distribution-shape-diagnostic-utils.mjs';

const MODEL_PATH = path.resolve('model-artifacts/m11-batter-hhr-direct-composite-v2.json');
const FITTING_MATRIX_PATH = path.resolve('fixtures/sanitized/m11/hhr/respecified-v2/balldontlie-hhr-design-matrix-v2.json');
const BOARD_PATH = path.resolve('fixtures/sanitized/m11/hhr/respecified-v2/the-odds-api-underdog-hhr-board-v2.json');
const DEFAULT_OUTPUT_PATH = path.resolve('artifacts/m11/hhr/distribution-shape/m11-hhr-v2-distribution-shape-diagnostic-v1.json');
const CANONICAL_MINIMUM_THRESHOLDS = Object.freeze([1, 2, 3]);
const BIN_COUNT = 5;

function sha256(text) {
  return createHash('sha256').update(text).digest('hex');
}

function outputPathFromArgs(argv) {
  const outputIndex = argv.indexOf('--output');
  if (outputIndex === -1) return DEFAULT_OUTPUT_PATH;
  const candidate = argv[outputIndex + 1];
  if (typeof candidate !== 'string' || candidate.length === 0 || argv.includes('--output', outputIndex + 1)) {
    throw new Error('--output requires one path value.');
  }
  return path.resolve(candidate);
}

function distributionInputFromFixtureRow(row) {
  const vector = row?.conditioningInputs?.contextAdjustedTerminalOutcomeVector;
  if (vector === null || typeof vector !== 'object' || Array.isArray(vector)) {
    throw new Error('HHR fitting row is missing the context-adjusted terminal outcome vector.');
  }
  return {
    contextAdjustedTerminalOutcomeVector: vector,
    terminalOutcomeCategories: Object.keys(vector),
    expectedPlateAppearances: row.conditioningInputs.expectedPlateAppearances,
    lineupSlot: row.conditioningInputs.lineupSlot,
    platoonSplitCell: row.conditioningInputs.platoonSplitCell,
    opposingStarterPooling: row.conditioningInputs.opposingStarterPooling,
    teamImpliedRunTotal: row.conditioningInputs.teamImpliedRunTotal,
    precedingLineupSlotsOnBaseQuality: row.conditioningInputs.precedingLineupSlotsOnBaseQuality,
  };
}

function thresholdFromHalfPointLine(line) {
  if (typeof line !== 'number' || !Number.isFinite(line) || line < 0 || Math.abs(line * 2 - Math.round(line * 2)) > 1e-12) {
    throw new Error(`HHR board line ${String(line)} is not a supported half-step numeric line.`);
  }
  return Math.floor(line) + 1;
}

const outputPath = outputPathFromArgs(process.argv.slice(2));
const [modelText, fittingMatrixText, boardText] = await Promise.all([
  readFile(MODEL_PATH, 'utf8'),
  readFile(FITTING_MATRIX_PATH, 'utf8'),
  readFile(BOARD_PATH, 'utf8'),
]);
const model = validateBatterHhrDirectCompositeArtifact(JSON.parse(modelText));
const fittingMatrix = JSON.parse(fittingMatrixText);
const board = JSON.parse(boardText);

if (sha256(fittingMatrixText) !== model.fitEvidence.sourceFixtureSha256) {
  throw new Error('HHR fitting matrix bytes do not match the frozen v2 artifact lineage.');
}
if (sha256(boardText) !== model.providerBoardEvidence.sourceFixtureSha256) {
  throw new Error('HHR board bytes do not match the frozen v2 artifact lineage.');
}
if (!Array.isArray(fittingMatrix.rows) || fittingMatrix.rows.length !== model.fitEvidence.rowCount) {
  throw new Error('HHR fitting matrix row count does not match the frozen v2 artifact.');
}

const offers = normalizeUnderdogBatterHhrCapture(board);
const liveRequiredSettlementThresholds = [...new Set(offers.map((offer) => thresholdFromHalfPointLine(offer.line)))].sort((left, right) => left - right);
const settlementThresholds = [...new Set([...CANONICAL_MINIMUM_THRESHOLDS, ...liveRequiredSettlementThresholds])].sort((left, right) => left - right);

const rows = fittingMatrix.rows.map((row) => {
  const distribution = buildBatterHhrDirectCompositeDistribution(model, distributionInputFromFixtureRow(row));
  return {
    fittedMean: distribution.mean,
    observedT: row.targetT,
    predictedProbabilities: distribution.statisticDistribution.probabilities,
  };
});

const gate = evaluateFamilyBDistributionShapeGate(rows, {
  binningRule: FAMILY_B_EQUAL_COUNT_BINNING_RULE,
  binCount: BIN_COUNT,
  minimumRowsPerBin: FAMILY_B_CANONICAL_MINIMUM_ROWS_PER_BIN,
  settlementThresholds,
  liveRequiredSettlementThresholds,
  tolerances: FAMILY_B_CANONICAL_TOLERANCE_CEILINGS,
});

const report = Object.freeze({
  reportVersion: 1,
  reportType: 'm11-hhr-v2-family-b-distribution-shape-diagnostic',
  modelVersion: model.modelVersion,
  distributionBuilderVersion: model.distributionBuilderVersion,
  mathematicalFamily: model.mathematicalFamily,
  officialSettlementStatistic: model.officialSettlementStatistic,
  productionEnabled: false,
  rankingEnabled: false,
  source: Object.freeze({
    modelPath: path.relative(process.cwd(), MODEL_PATH),
    modelFileSha256: sha256(modelText),
    fittingMatrixPath: path.relative(process.cwd(), FITTING_MATRIX_PATH),
    fittingMatrixFileSha256: sha256(fittingMatrixText),
    boardPath: path.relative(process.cwd(), BOARD_PATH),
    boardFileSha256: sha256(boardText),
  }),
  fittingEvidence: Object.freeze({
    activeSeason: model.fitEvidence.activeSeason,
    startDate: model.fitEvidence.startDate,
    endDate: model.fitEvidence.endDate,
    gameCount: model.fitEvidence.gameCount,
    rowCount: model.fitEvidence.rowCount,
  }),
  gate,
});

await mkdir(path.dirname(outputPath), { recursive: true });
await writeFile(outputPath, `${JSON.stringify(report, null, 2)}\n`);
console.log('--- M11 HHR V2 DISTRIBUTION SHAPE GATE ---');
console.log(JSON.stringify(gate, null, 2));
console.log('--- END M11 HHR V2 DISTRIBUTION SHAPE GATE ---');

const substantive = gate.summary?.substantiveChecks;
const expectedKnownBadRejection = gate.verdict === 'FAIL'
  && gate.summary?.structuralFailure === false
  && substantive?.alphaRange?.passed === false
  && substantive?.zeroMass?.passed === false
  && substantive?.tails?.passed === false;

if (!expectedKnownBadRejection) {
  console.error('INSTRUMENT DEFECT: frozen HHR v2 did not fail all three substantive §17.46 shape checks cleanly.');
  process.exitCode = 2;
} else {
  console.error('EXPECTED PROTECTIVE FAILURE: frozen HHR v2 breaches zero-mass, tail, and implied-alpha shape gates.');
  process.exitCode = 1;
}
