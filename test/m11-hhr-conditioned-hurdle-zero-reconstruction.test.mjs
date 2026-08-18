import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const FIXTURE_PATH = new URL(
  '../fixtures/sanitized/m11/hhr/respecified-v2/balldontlie-hhr-design-matrix-v2.json',
  import.meta.url,
);

const EXPECTED = Object.freeze([
  -0.3156807637,
  -0.4421437692,
  0.0101539499,
  -1.0649822595,
]);
const TOLERANCE = 1e-8;

function sigmoid(value) {
  if (value >= 0) return 1 / (1 + Math.exp(-value));
  const expValue = Math.exp(value);
  return expValue / (1 + expValue);
}

function solve(matrixInput, vectorInput) {
  const size = vectorInput.length;
  const augmented = matrixInput.map((row, index) => [...row, vectorInput[index]]);

  for (let column = 0; column < size; column += 1) {
    let pivot = column;
    for (let row = column + 1; row < size; row += 1) {
      if (Math.abs(augmented[row][column]) > Math.abs(augmented[pivot][column])) pivot = row;
    }
    assert.ok(Math.abs(augmented[pivot][column]) > 1e-14, 'logistic information matrix must be nonsingular');
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
    for (let column = row + 1; column < size; column += 1) right -= augmented[row][column] * solution[column];
    solution[row] = right / augmented[row][row];
  }
  return solution;
}

function designRow(row) {
  const expectedPlateAppearances = row.conditioningInputs?.expectedPlateAppearances;
  const centeredLineupSlot = row.derivedPredictors?.centeredLineupSlot;
  const contextHitQualityLogit = row.derivedPredictors?.contextHitQualityLogit;
  const lineupSlot = 4 * centeredLineupSlot + 5;

  for (const [label, value] of [
    ['expectedPlateAppearances', expectedPlateAppearances],
    ['centeredLineupSlot', centeredLineupSlot],
    ['lineupSlot', lineupSlot],
    ['contextHitQualityLogit', contextHitQualityLogit],
  ]) {
    assert.equal(typeof value, 'number', `${label} must be numeric`);
    assert.ok(Number.isFinite(value), `${label} must be finite`);
  }
  assert.ok(Math.abs(lineupSlot - Math.round(lineupSlot)) < 1e-12, 'reconstructed raw lineupSlot must be integral');
  assert.ok(lineupSlot >= 1 && lineupSlot <= 9, 'reconstructed raw lineupSlot must be 1 through 9');

  return [1, expectedPlateAppearances, lineupSlot, contextHitQualityLogit];
}

function fitLogistic(rows) {
  const design = rows.map(designRow);
  const targets = rows.map((row) => {
    assert.ok(Number.isInteger(row.targetT) && row.targetT >= 0, 'targetT must be a nonnegative integer');
    return row.targetT === 0 ? 1 : 0;
  });
  let beta = Array(4).fill(0);
  let converged = false;

  for (let iteration = 0; iteration < 100; iteration += 1) {
    const information = Array.from({ length: 4 }, () => Array(4).fill(0));
    const gradient = Array(4).fill(0);

    for (let index = 0; index < design.length; index += 1) {
      const x = design[index];
      const eta = x.reduce((sum, value, coefficientIndex) => sum + value * beta[coefficientIndex], 0);
      const probability = sigmoid(eta);
      const weight = probability * (1 - probability);
      const residual = targets[index] - probability;

      for (let row = 0; row < 4; row += 1) {
        gradient[row] += x[row] * residual;
        for (let column = 0; column < 4; column += 1) {
          information[row][column] += weight * x[row] * x[column];
        }
      }
    }

    const delta = solve(information, gradient);
    beta = beta.map((value, index) => value + delta[index]);
    if (Math.max(...delta.map(Math.abs)) < 1e-12) {
      converged = true;
      break;
    }
  }

  assert.equal(converged, true, 'conditioned-hurdle zero logistic reconstruction must converge');
  return beta;
}

test('HHR conditioned-hurdle zero component reconstructs the canonical frozen coefficients', async () => {
  const fixture = JSON.parse(await readFile(FIXTURE_PATH, 'utf8'));
  assert.equal(fixture.schemaVersion, 3);
  assert.equal(fixture.rows.length, 5964);

  const zeroRows = fixture.rows.filter((row) => row.targetT === 0).length;
  const positiveRows = fixture.rows.filter((row) => row.targetT >= 1).length;
  assert.equal(zeroRows, 1977);
  assert.equal(positiveRows, 3987);

  const first = fitLogistic(fixture.rows);
  const second = fitLogistic(fixture.rows);
  assert.deepEqual(second, first, 'identical frozen fitting rows must reconstruct identical coefficients');

  const deltas = first.map((value, index) => Math.abs(value - EXPECTED[index]));
  for (let index = 0; index < EXPECTED.length; index += 1) {
    assert.ok(
      deltas[index] <= TOLERANCE,
      `coefficient ${index} drifted: reconstructed=${first[index]} expected=${EXPECTED[index]} delta=${deltas[index]}`,
    );
  }

  console.log('HHR ZERO RECONSTRUCTION COEFFICIENTS:', JSON.stringify(first));
  console.log('HHR ZERO RECONSTRUCTION MAX DELTA:', Math.max(...deltas));
  console.log('HHR ZERO RECONSTRUCTION TOLERANCE:', TOLERANCE);
});
