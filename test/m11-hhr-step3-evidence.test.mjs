import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

const MODEL_PATH = 'model-artifacts/m11-batter-hhr-direct-composite-v2.json';
const DIAGNOSTICS_PATH = 'model-artifacts/m11-batter-hhr-direct-composite-diagnostics-v2.json';
const REPORT_PATH = 'artifacts/m11/hhr/step3/m11-hhr-step3-evidence.json';

function readJson(path) {
  return JSON.parse(fs.readFileSync(path, 'utf8'));
}

test('candidate artifact is hash-verified reconstruction without refitting', () => {
  const model = readJson(MODEL_PATH);
  const diagnostics = readJson(DIAGNOSTICS_PATH);
  assert.equal(model.status, 'CANDIDATE');
  assert.equal(model.productionEnabled, false);
  assert.equal(model.rankingEnabled, false);
  assert.equal(model.reconstructionEvidence.method, 'hash-verified-reconstruction-without-refit');
  assert.equal(model.reconstructionEvidence.refitPerformed, false);
  assert.equal(model.reconstructionEvidence.coefficientBlockByteIdentical, true);
  assert.equal(
    model.reconstructionEvidence.sourceCoefficientBlockSha256,
    model.reconstructionEvidence.reconstructedCoefficientBlockSha256,
  );
  assert.deepEqual(model.coefficients, Object.fromEntries(
    ['intercept', ...diagnostics.predictorOrder].map((name) => [name, diagnostics.coefficientInference[name].estimate]),
  ));
  assert.deepEqual(model.fittingDetails.predictorStandardDeviations, diagnostics.predictorStandardDeviations);
  assert.equal(model.fitEvidence.startDate, '2026-07-06');
  assert.equal(model.fitEvidence.endDate, '2026-08-05');
  assert.equal(model.chronologyAttestation.overlap, false);
  assert.equal(model.chronologyAttestation.fittedRowsOnOrBeforePitcherAllowedEndDate, 0);
});

test('Step 3 evidence uses final untouched games, both sides, per-line calibration, and insufficient labels', () => {
  const report = readJson(REPORT_PATH);
  const archive = readJson(report.source.archivePath);
  assert.equal(report.reportType, 'm11-hhr-step3-calibration-selected-side-evidence');
  assert.equal(report.safety.productionEnabled, false);
  assert.equal(report.safety.rankingEnabled, false);
  assert.equal(archive.untouchedEvidence.fittedRowOverlapCount, 0);
  assert.equal(archive.games.every((game) => game.status === 'STATUS_FINAL'), true);
  assert.equal(archive.rows.some((row) => row.selectedSide === 'higher'), true);
  assert.equal(archive.rows.some((row) => row.selectedSide === 'lower'), true);
  assert.equal(archive.rows.every((row) => row.archivedPWin + row.archivedPLoss + row.archivedPVoid > 0.999999999999), true);
  assert.equal(Object.keys(report.gates.F.perLine).length > 0, true);
  for (const line of Object.values(report.gates.F.perLine)) {
    assert.equal(line.calibration.every((bucket) => bucket.picksGraded >= 30 || bucket.evidenceStatus === 'insufficient'), true);
  }
  assert.equal(report.gates.G.references.allCoinFlipBinaryBrier, 0.25);
  assert.equal(report.gates.H.label, 'top-decile minus bottom-decile observed win rate');
  assert.equal(Number.isFinite(report.gates.H.topMinusBottomPercentagePoints), true);
  assert.equal(report.gates.J.byteIdentical, true);
});
