import assert from 'node:assert/strict';
import test from 'node:test';

import {
  assertFeatureCanProducePrediction,
  FeatureUnavailableError,
} from '../src/application/feature-gate.js';
import type { FeatureRegistration } from '../src/domain/feature-status.js';

function captureUnavailableError(registration: FeatureRegistration): FeatureUnavailableError {
  try {
    assertFeatureCanProducePrediction(registration);
  } catch (error) {
    assert.ok(error instanceof FeatureUnavailableError);
    return error;
  }

  assert.fail('expected the feature gate to fail closed');
}

test('a disabled feature cannot produce a prediction', () => {
  const error = captureUnavailableError({
    featureId: 'synthetic-disabled-market',
    enabled: false,
    status: 'production-enabled',
  });

  assert.equal(error.code, 'FEATURE_DISABLED');
  assert.equal(error.featureId, 'synthetic-disabled-market');
});

test('a not-yet-production-enabled feature cannot produce a prediction', () => {
  const error = captureUnavailableError({
    featureId: 'synthetic-validation-market',
    enabled: true,
    status: 'validation',
  });

  assert.equal(error.code, 'FEATURE_NOT_PRODUCTION_ENABLED');
});

test('an enabled production feature passes the generic gate', () => {
  const registration: FeatureRegistration = {
    featureId: 'synthetic-production-market',
    enabled: true,
    status: 'production-enabled',
  };

  assert.doesNotThrow(() => assertFeatureCanProducePrediction(registration));
});
