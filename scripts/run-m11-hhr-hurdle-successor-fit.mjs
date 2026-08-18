import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

import { normalizeUnderdogBatterHhrCapture } from '../dist/src/features/batter-hhr/index.js';
import {
  evaluateHhrHurdleSuccessor,
  sha256Text,
} from './m11-hhr-hurdle-successor-fit-utils.mjs';

const FIXTURE_PATH = path.resolve('fixtures/sanitized/m11/hhr/respecified-v2/balldontlie-hhr-design-matrix-v2.json');
const OLD_MODEL_PATH = path.resolve('model-artifacts/m11-batter-hhr-direct-composite-v2.json');
const BOARD_PATH = path.resolve('fixtures/sanitized/m11/hhr/respecified-v2/the-odds-api-underdog-hhr-board-v2.json');
const DEFAULT_OUTPUT_PATH = path.resolve('artifacts/m11/hhr/successor-fit/m11-hhr-conditioned-hurdle-positive-zt-nb2-fit-v1.json');

function outputPathFromArgs(argv) {
  const index = argv.indexOf('--output');
  if (index === -1) return DEFAULT_OUTPUT_PATH;
  const value = argv[index + 1];
  if (typeof value !== 'string' || value.length === 0 || value === '--output') {
    throw new Error('--output requires one path value.');
  }
  return path.resolve(value);
}

function thresholdFromHalfPointLine(line) {
  if (typeof line !== 'number' || !Number.isFinite(line) || line < 0
    || Math.abs(line * 2 - Math.round(line * 2)) > 1e-12) {
    throw new Error(`HHR board line ${String(line)} is not a supported half-step numeric line.`);
  }
  return Math.floor(line) + 1;
}

const outputPath = outputPathFromArgs(process.argv.slice(2));
const [fixtureText, oldModelText, boardText] = await Promise.all([
  readFile(FIXTURE_PATH, 'utf8'),
  readFile(OLD_MODEL_PATH, 'utf8'),
  readFile(BOARD_PATH, 'utf8'),
]);
const fixture = JSON.parse(fixtureText);
const oldModel = JSON.parse(oldModelText);
const board = JSON.parse(boardText);
const offers = normalizeUnderdogBatterHhrCapture(board);
const liveRequiredSettlementThresholds = [...new Set(
  offers.map((offer) => thresholdFromHalfPointLine(offer.line)),
)].sort((left, right) => left - right);

const evaluation = evaluateHhrHurdleSuccessor({
  fixture,
  fixtureText,
  oldModel,
  liveRequiredSettlementThresholds,
});
const reportIdentity = Object.freeze({
  ...evaluation,
  source: Object.freeze({
    fixturePath: path.relative(process.cwd(), FIXTURE_PATH),
    fixtureFileSha256: sha256Text(fixtureText),
    oldModelPath: path.relative(process.cwd(), OLD_MODEL_PATH),
    oldModelFileSha256: sha256Text(oldModelText),
    boardPath: path.relative(process.cwd(), BOARD_PATH),
    boardFileSha256: sha256Text(boardText),
  }),
});
const report = Object.freeze({
  ...reportIdentity,
  reportSha256: sha256Text(JSON.stringify(reportIdentity)),
});
await mkdir(path.dirname(outputPath), { recursive: true });
await writeFile(outputPath, `${JSON.stringify(report, null, 2)}\n`);

console.log('--- M11 HHR CONDITIONED-HURDLE SUCCESSOR FIT ---');
console.log(`FULL ROWS: ${report.cohort.fullRowCount}`);
console.log(`ZERO ROWS: ${report.cohort.zeroRowCount}`);
console.log(`POSITIVE FIT ROWS: ${report.cohort.positiveRowCount}`);
console.log(`POSITIVE COEFFICIENTS: ${JSON.stringify(report.positiveFit.coefficients)}`);
console.log(`POSITIVE DISPERSION ALPHA: ${report.positiveFit.dispersionAlpha}`);
console.log(`OPTIMIZER ITERATIONS: ${report.positiveFit.optimization.iterations}`);
console.log(`OPTIMIZER MAX ABS GRADIENT: ${report.positiveFit.optimization.maxAbsoluteGradient}`);
console.log(`GENERIC SHAPE GATE VERDICT: ${report.shapeGate.verdict}`);
console.log(`ALPHA RANGE [INFORMATIONAL FOR THIS SUCCESSOR]: ${report.shapeGate.summary.alphaRange}`);
console.log(`MAX ZERO GAP: ${report.shapeGate.summary.maxZeroGap}`);
for (const [threshold, tail] of Object.entries(report.shapeGate.summary.maxTailGapByThreshold)) {
  console.log(`MAX TAIL GAP threshold=${threshold}: ${tail.maximum}`);
}
for (const bin of report.shapeGate.bins) {
  console.log(`BIN ${bin.binIndex}: n=${bin.rowCount} mu=${bin.meanFittedMu} observedMean=${bin.observedMeanT} alphaImplied=${bin.impliedAlpha} zeroGap=${bin.zeroMass.observedMinusPredicted}`);
  for (const [threshold, tail] of Object.entries(bin.tails)) {
    console.log(`BIN ${bin.binIndex} threshold=${threshold} upperGap=${tail.upper.observedMinusPredicted} lowerGap=${tail.lower.observedMinusPredicted}`);
  }
}
console.log(`SUCCESSOR ZERO MASS PASS: ${report.successorAcceptance.zeroMassPassed}`);
console.log(`SUCCESSOR SETTLEMENT TAILS PASS: ${report.successorAcceptance.settlementTailsPassed}`);
console.log(`SUCCESSOR ACCEPTANCE: ${report.successorAcceptance.passed}`);
console.log(`ALPHA INFORMATIONAL ONLY: ${report.successorAcceptance.alphaImpliedInformationalOnly}`);
console.log(`REPORT SHA-256: ${report.reportSha256}`);
console.log('PRODUCTION ENABLED: false');
console.log('RANKING ENABLED: false');
console.log('UNTOUCHED EVIDENCE READ: false');
console.log('--- END M11 HHR CONDITIONED-HURDLE SUCCESSOR FIT ---');

if (!report.successorAcceptance.passed) {
  console.error('SUCCESSOR REJECTED: at least one required structural, zero-mass, or settlement-tail fit-time gate failed.');
  process.exitCode = 1;
}
