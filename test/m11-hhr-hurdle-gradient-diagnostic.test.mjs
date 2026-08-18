import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';

import { diagnoseHhrPositiveGradient } from '../scripts/m11-hhr-hurdle-successor-fit-utils.mjs';

const FIXTURE_PATH = path.resolve('fixtures/sanitized/m11/hhr/respecified-v2/balldontlie-hhr-design-matrix-v2.json');
const OLD_MODEL_PATH = path.resolve('model-artifacts/m11-batter-hhr-direct-composite-v2.json');
const ABSOLUTE_DIAGNOSTIC_TOLERANCE = 1e-4;
const RELATIVE_DIAGNOSTIC_TOLERANCE = 2e-6;
const PERTURBATIONS = Object.freeze([
  null,
  Object.freeze([0.15, -0.10, 0.08, -0.06, 0.04, -0.02, 0.05, 0.12]),
  Object.freeze([-0.20, 0.06, -0.04, 0.09, -0.05, 0.07, -0.03, -0.18]),
]);

test('HHR zero-truncated NB2 analytic gradient matches central finite differences', async () => {
  const [fixtureText, oldModelText] = await Promise.all([
    readFile(FIXTURE_PATH, 'utf8'),
    readFile(OLD_MODEL_PATH, 'utf8'),
  ]);
  const fixture = JSON.parse(fixtureText);
  const oldModel = JSON.parse(oldModelText);

  for (let diagnosticIndex = 0; diagnosticIndex < PERTURBATIONS.length; diagnosticIndex += 1) {
    const diagnostic = diagnoseHhrPositiveGradient({
      fixture,
      fixtureText,
      oldModel,
      parameterDelta: PERTURBATIONS[diagnosticIndex],
      finiteDifferenceScale: 1e-4,
    });

    console.log(`HHR GRADIENT DIAGNOSTIC ${diagnosticIndex} OBJECTIVE:`, diagnostic.objectiveValue);
    console.log(`HHR GRADIENT DIAGNOSTIC ${diagnosticIndex} PARAMETERS:`, JSON.stringify(diagnostic.parameters));
    for (const comparison of diagnostic.comparisons) {
      console.log(
        `HHR GRADIENT DIAGNOSTIC ${diagnosticIndex} ${comparison.label}: analytic=${comparison.analytic} numerical=${comparison.numerical} abs=${comparison.absoluteDifference} rel=${comparison.relativeDifference}`,
      );
      const allowedDifference = ABSOLUTE_DIAGNOSTIC_TOLERANCE
        + RELATIVE_DIAGNOSTIC_TOLERANCE * Math.max(1, Math.abs(comparison.analytic), Math.abs(comparison.numerical));
      assert.ok(
        comparison.absoluteDifference <= allowedDifference,
        `${comparison.label} analytic gradient disagrees with central finite differences: abs=${comparison.absoluteDifference}, allowed=${allowedDifference}`,
      );
    }
    console.log(`HHR GRADIENT DIAGNOSTIC ${diagnosticIndex} MAX ABS DIFF:`, diagnostic.maxAbsoluteDifference);
    console.log(`HHR GRADIENT DIAGNOSTIC ${diagnosticIndex} MAX REL DIFF:`, diagnostic.maxRelativeDifference);
  }
});
