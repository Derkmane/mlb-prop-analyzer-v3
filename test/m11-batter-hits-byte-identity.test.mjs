import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';

import {
  buildM11BatterHitsByteIdentityEvidence,
  serializeM11BatterHitsByteIdentityPayload,
} from './helpers/m11-batter-hits-byte-identity-proof.mjs';

const FIXTURE_PATH = path.resolve(
  'fixtures/regression/m11-batter-hits-byte-identity-v1.json',
);

function sha256(bytes) {
  return createHash('sha256').update(bytes).digest('hex');
}

test('M11 step 1 preserves Batter Hits distributions, alternate settlements, and ranked output byte for byte', async () => {
  const expectedBytes = await readFile(FIXTURE_PATH);
  const evidence = await buildM11BatterHitsByteIdentityEvidence();
  const actualBytes = serializeM11BatterHitsByteIdentityPayload(
    evidence.payload,
  );
  const expectedSha256 = sha256(expectedBytes);
  const actualSha256 = sha256(actualBytes);

  assert.equal(actualBytes.length, expectedBytes.length);
  assert.equal(actualSha256, expectedSha256);
  assert.equal(Buffer.compare(actualBytes, expectedBytes), 0);
  assert.equal(evidence.distributionCount, 34);
  assert.equal(evidence.rankedRowCount, 34);
  assert.ok(evidence.alternateLineSettlementCount > 0);

  process.stdout.write('\n--- M11 BATTER HITS BYTE IDENTITY PROOF ---\n');
  process.stdout.write(`BASE MAIN SHA: ${evidence.payload.baseMainSha}\n`);
  process.stdout.write(`EXPECTED BYTE LENGTH: ${expectedBytes.length}\n`);
  process.stdout.write(`ACTUAL BYTE LENGTH: ${actualBytes.length}\n`);
  process.stdout.write(`EXPECTED SHA-256: ${expectedSha256}\n`);
  process.stdout.write(`ACTUAL SHA-256: ${actualSha256}\n`);
  process.stdout.write(
    `DISTRIBUTIONS COMPARED: ${evidence.distributionCount}\n`,
  );
  process.stdout.write(
    `ALTERNATE SETTLEMENTS COMPARED: ${evidence.alternateLineSettlementCount}\n`,
  );
  process.stdout.write(`RANKED ROWS COMPARED: ${evidence.rankedRowCount}\n`);
  process.stdout.write('BYTE IDENTICAL: true\n');
  process.stdout.write('--- END M11 BATTER HITS BYTE IDENTITY PROOF ---\n');
});
