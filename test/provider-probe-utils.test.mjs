import assert from 'node:assert/strict';
import test from 'node:test';

import { sanitizeText, sha256 } from '../scripts/provider-probe-utils.mjs';

test('provider probe redacts every configured secret from captured text', () => {
  const secretOne = 'odds-secret-value';
  const secretTwo = 'bdl-secret-value';
  const raw = `first=${secretOne}; second=${secretTwo}; first-again=${secretOne}`;

  const sanitized = sanitizeText(raw, [secretOne, secretTwo]);

  assert.equal(sanitized.includes(secretOne), false);
  assert.equal(sanitized.includes(secretTwo), false);
  assert.equal(
    sanitized,
    'first=[REDACTED]; second=[REDACTED]; first-again=[REDACTED]',
  );
});

test('provider probe hashes identical response bodies deterministically', () => {
  const body = '{"data":[]}';
  assert.equal(sha256(body), sha256(body));
  assert.notEqual(sha256(body), sha256('{"data":[1]}'));
});
