import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

const FIXTURE_PATH = path.resolve('fixtures/sanitized/m11/hhr/respecified-v2/balldontlie-hhr-design-matrix-v2.json');
const MODEL_PATH = path.resolve('model-artifacts/m11-batter-hhr-direct-composite-v2.json');
const OUTPUT_PATH = path.resolve('artifacts/m11/hhr/expected-pa-diagnostic.json');
const sha256 = (bytes) => createHash('sha256').update(bytes).digest('hex');

const mean = (values) => values.reduce((sum, value) => sum + value, 0) / values.length;
function sampleSd(values) {
  const center = mean(values);
  return values.length <= 1 ? 0 : Math.sqrt(values.reduce((sum, value) => sum + (value - center) ** 2, 0) / (values.length - 1));
}
function quantile(values, probability) {
  const sorted = [...values].sort((a, b) => a - b);
  const index = (sorted.length - 1) * probability;
  const lower = Math.floor(index);
  const upper = Math.ceil(index);
  return lower === upper ? sorted[lower] : sorted[lower] + (sorted[upper] - sorted[lower]) * (index - lower);
}
function correlation(left, right) {
  const lm = mean(left), rm = mean(right);
  const numerator = left.reduce((sum, value, index) => sum + (value - lm) * (right[index] - rm), 0);
  const denominator = Math.sqrt(
    left.reduce((sum, value) => sum + (value - lm) ** 2, 0) *
    right.reduce((sum, value) => sum + (value - rm) ** 2, 0),
  );
  if (!(denominator > 0)) throw new Error('Correlation denominator is zero.');
  return numerator / denominator;
}
function finite(value, label) {
  if (typeof value !== 'number' || !Number.isFinite(value)) throw new Error(`${label} must be finite.`);
  return value;
}
function rowPredictor(row, name) {
  if (name === 'contextHitQualityLogit' || name === 'centeredLineupSlot') return finite(row.derivedPredictors?.[name], name);
  return finite(row.conditioningInputs?.[name], name);
}
function summarize(rows) {
  const expected = rows.map((row) => row.expectedPa);
  const actual = rows.map((row) => row.actualPa);
  const delta = rows.map((row) => row.delta);
  return {
    rows: rows.length,
    meanExpectedPa: mean(expected),
    meanActualPa: mean(actual),
    meanActualMinusExpected: mean(delta),
    meanExpectedMinusActual: -mean(delta),
    shareOnePlusPaShort: delta.filter((value) => value <= -1).length / delta.length,
    countOnePlusPaShort: delta.filter((value) => value <= -1).length,
  };
}

const [fixtureBytes, modelBytes] = await Promise.all([readFile(FIXTURE_PATH), readFile(MODEL_PATH)]);
const fixture = JSON.parse(fixtureBytes.toString('utf8'));
const model = JSON.parse(modelBytes.toString('utf8'));

if (sha256(fixtureBytes) !== model.fitEvidence?.sourceFixtureSha256) throw new Error('Pinned fitting fixture SHA-256 does not match frozen v2 lineage.');
if (fixture.rowCount !== 5964 || fixture.rows?.length !== 5964) throw new Error(`Expected 5964 rows; got ${fixture.rows?.length}.`);
if (fixture.gameCount !== 340 || new Set(fixture.rows.map((row) => row.gameId)).size !== 340) throw new Error('Expected 340 fitting games.');
if (fixture.fitWindow?.startDate !== '2026-07-06' || fixture.fitWindow?.endDate !== '2026-08-05') throw new Error('Fitting window drifted.');
if (model.modelVersion !== 'm11-batter-hhr-direct-composite-v2') throw new Error('Frozen v2 model identity drifted.');
if (model.fittingDetails?.expectedPlateAppearancesRole !== 'offset' || model.fittingDetails?.expectedPlateAppearancesCoefficient !== 1) throw new Error('Expected-PA offset contract drifted.');

const predictorOrder = model.fittingDetails.predictorOrder;
const rows = fixture.rows.map((row, sourceIndex) => {
  const expectedPa = finite(row.conditioningInputs?.expectedPlateAppearances, `row ${sourceIndex} expected PA`);
  const actualPa = finite(row.officialBoxScore?.plateAppearances, `row ${sourceIndex} actual PA`);
  const targetT = finite(row.targetT, `row ${sourceIndex} target T`);
  const slot = row.lineupSlot;
  if (!Number.isInteger(actualPa) || actualPa <= 0) throw new Error(`row ${sourceIndex} actual PA must be a positive integer.`);
  if (!Number.isInteger(targetT) || targetT < 0) throw new Error(`row ${sourceIndex} target T must be a nonnegative integer.`);
  if (!Number.isInteger(slot) || slot < 1 || slot > 9) throw new Error(`row ${sourceIndex} lineup slot invalid.`);
  const linear = model.coefficients.intercept + predictorOrder.reduce((sum, name) => {
    const transform = model.predictorTransforms[name];
    return sum + model.coefficients[name] * ((rowPredictor(row, name) - transform.mean) / transform.standardDeviation);
  }, 0);
  const mu = expectedPa * Math.exp(linear);
  if (!(mu > 0) || !Number.isFinite(mu)) throw new Error(`row ${sourceIndex} fitted mu invalid.`);
  return { sourceIndex, expectedPa, actualPa, delta: actualPa - expectedPa, targetT, zero: targetT === 0 ? 1 : 0, slot, mu };
});

const expectedMean = mean(rows.map((row) => row.expectedPa));
if (Math.abs(expectedMean - fixture.predictorSummaries.expectedPlateAppearances.mean) > 1e-12) throw new Error('Expected-PA mean does not reproduce fixture summary.');

const ordered = [...rows].sort((left, right) => left.mu - right.mu || left.sourceIndex - right.sourceIndex);
ordered.forEach((row, index) => { row.muBin = Math.min(4, Math.floor(index * 5 / ordered.length)); });

const overall = summarize(rows);
const byLineupSlot = Array.from({ length: 9 }, (_, index) => {
  const slot = index + 1;
  return { lineupSlot: slot, ...summarize(rows.filter((row) => row.slot === slot)) };
});
const byFittedMuBin = Array.from({ length: 5 }, (_, bin) => {
  const selected = ordered.filter((row) => row.muBin === bin);
  return {
    bin,
    minMu: Math.min(...selected.map((row) => row.mu)),
    maxMu: Math.max(...selected.map((row) => row.mu)),
    meanMu: mean(selected.map((row) => row.mu)),
    ...summarize(selected),
  };
});

const deltas = rows.map((row) => row.delta);
const deltaDistribution = {
  min: Math.min(...deltas),
  max: Math.max(...deltas),
  mean: mean(deltas),
  standardDeviation: sampleSd(deltas),
  p01: quantile(deltas, 0.01),
  p05: quantile(deltas, 0.05),
  p10: quantile(deltas, 0.10),
  p25: quantile(deltas, 0.25),
  p50: quantile(deltas, 0.50),
  p75: quantile(deltas, 0.75),
  p90: quantile(deltas, 0.90),
  p95: quantile(deltas, 0.95),
  p99: quantile(deltas, 0.99),
  countOnePlusPaShort: deltas.filter((value) => value <= -1).length,
  shareOnePlusPaShort: deltas.filter((value) => value <= -1).length / deltas.length,
  countTwoPlusPaShort: deltas.filter((value) => value <= -2).length,
  shareTwoPlusPaShort: deltas.filter((value) => value <= -2).length / deltas.length,
  buckets: [
    { label: '<-2', count: deltas.filter((value) => value < -2).length },
    { label: '[-2,-1)', count: deltas.filter((value) => value >= -2 && value < -1).length },
    { label: '[-1,0)', count: deltas.filter((value) => value >= -1 && value < 0).length },
    { label: '[0,1)', count: deltas.filter((value) => value >= 0 && value < 1).length },
    { label: '[1,2)', count: deltas.filter((value) => value >= 1 && value < 2).length },
    { label: '>=2', count: deltas.filter((value) => value >= 2).length },
  ].map((entry) => ({ ...entry, share: entry.count / deltas.length })),
  actualPaCounts: Object.fromEntries([...new Set(rows.map((row) => row.actualPa))].sort((a, b) => a - b).map((value) => [value, rows.filter((row) => row.actualPa === value).length])),
};

const zeroIndicators = rows.map((row) => row.zero);
const zeroRows = rows.filter((row) => row.zero === 1);
const positiveRows = rows.filter((row) => row.zero === 0);
const shortfallCorrelation = {
  zeroCount: zeroRows.length,
  zeroShare: zeroRows.length / rows.length,
  pearsonActualMinusExpectedVsZero: correlation(deltas, zeroIndicators),
  pearsonExpectedMinusActualVsZero: correlation(deltas.map((value) => -value), zeroIndicators),
  zeroRows: summarize(zeroRows),
  positiveTRows: summarize(positiveRows),
  pZeroWhenOnePlusPaShort: rows.filter((row) => row.delta <= -1 && row.zero === 1).length / rows.filter((row) => row.delta <= -1).length,
  pZeroWhenNotOnePlusPaShort: rows.filter((row) => row.delta > -1 && row.zero === 1).length / rows.filter((row) => row.delta > -1).length,
};

const report = {
  diagnosticVersion: 1,
  source: {
    fixturePath: path.relative(process.cwd(), FIXTURE_PATH),
    fixtureFileSha256: sha256(fixtureBytes),
    modelPath: path.relative(process.cwd(), MODEL_PATH),
    modelFileSha256: sha256(modelBytes),
    modelVersion: model.modelVersion,
    rowCount: rows.length,
    gameCount: new Set(rows.map((row) => fixture.rows[row.sourceIndex].gameId)).size,
    fitWindow: fixture.fitWindow,
    muBinningRule: 'sort all 5964 rows by frozen-v2 fitted mu ascending, sourceIndex tiebreak; bin=floor(rank*5/n)',
  },
  overall,
  byLineupSlot,
  byFittedMuBin,
  actualMinusExpectedDistribution: deltaDistribution,
  paShortfallVsZero: shortfallCorrelation,
  safety: { fittingPerformed: false, modelChanged: false, canonicalChanged: false, reservedEvidenceRead: false },
};

await mkdir(path.dirname(OUTPUT_PATH), { recursive: true });
await writeFile(OUTPUT_PATH, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
console.log('--- M11 HHR EXPECTED-PA DIAGNOSTIC ---');
console.log(`FIXTURE SHA\t${report.source.fixtureFileSha256}`);
console.log(`ROWS\t${report.source.rowCount}`);
console.log(`GAMES\t${report.source.gameCount}`);
console.log(`FIT WINDOW\t${fixture.fitWindow.startDate}\t${fixture.fitWindow.endDate}`);
console.log('OVERALL\t' + JSON.stringify(overall));
console.log('BY LINEUP SLOT');
for (const row of byLineupSlot) console.log(JSON.stringify(row));
console.log('BY FITTED-MU BIN');
for (const row of byFittedMuBin) console.log(JSON.stringify(row));
console.log('ACTUAL MINUS EXPECTED DISTRIBUTION\t' + JSON.stringify(deltaDistribution));
console.log('PA SHORTFALL VS T=0\t' + JSON.stringify(shortfallCorrelation));
console.log('SAFETY\t' + JSON.stringify(report.safety));
console.log(`OUTPUT\t${OUTPUT_PATH}`);
console.log('--- END M11 HHR EXPECTED-PA DIAGNOSTIC ---');
