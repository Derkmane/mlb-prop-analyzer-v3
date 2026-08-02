import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';

const FREEZE_PATH = 'model-artifacts/m8-batter-hits-runtime-freeze-v1.json';
const TARGET_SHA = '3e3e30150bee91e612798f39a449ef9f2adb682ce43fe1835a17f46a5bed4e82';
const SHA_RE = /^[0-9a-f]{64}$/;

function sha256(text) {
  return createHash('sha256').update(text).digest('hex');
}

async function readArtifact(path, label) {
  assert.equal(typeof path, 'string', `${label} path must be text`);
  assert.notEqual(path.length, 0, `${label} path must be non-empty`);
  const text = await readFile(path, 'utf8');
  return Object.freeze({ path, text, fileSha256: sha256(text), value: JSON.parse(text) });
}

function collectShaFields(value, prefix = '', output = []) {
  if (typeof value === 'string') {
    if (SHA_RE.test(value)) output.push({ path: prefix, value });
    return output;
  }
  if (Array.isArray(value)) {
    value.forEach((entry, index) => collectShaFields(entry, `${prefix}[${index}]`, output));
    return output;
  }
  if (value && typeof value === 'object') {
    for (const [key, entry] of Object.entries(value)) {
      collectShaFields(entry, prefix ? `${prefix}.${key}` : key, output);
    }
  }
  return output;
}

function firstPath(...values) {
  return values.find((value) => typeof value === 'string' && value.length > 0) ?? null;
}

test('maps the real committed M8 park provenance chain without synthetic identities', async () => {
  const freeze = await readArtifact(FREEZE_PATH, 'freeze');
  const coherent = freeze.value?.fittedComponents?.coherentMatchup;
  const platoon = freeze.value?.fittedComponents?.platoon;
  assert.ok(coherent, 'freeze coherent component must exist');
  assert.ok(platoon, 'freeze platoon component must exist');

  const fixedPath = firstPath(coherent.fixedValidation?.sourcePath);
  const coherentWalkForwardPath = firstPath(coherent.walkForward?.sourcePath);
  const boundaryPath = firstPath(platoon.fixedValidation?.sourcePath);
  const derivedPath = firstPath(platoon.walkForward?.sourcePath);
  assert.ok(fixedPath, 'coherent fixed source path must exist');
  assert.ok(boundaryPath, 'platoon boundary source path must exist');
  assert.ok(derivedPath, 'derived platoon walk-forward path must exist');

  const fixed = await readArtifact(fixedPath, 'coherent fixed');
  const boundary = await readArtifact(boundaryPath, 'platoon boundary');
  const derived = await readArtifact(derivedPath, 'derived platoon walk-forward');
  const sourceWalkForwardPath = firstPath(
    coherentWalkForwardPath,
    boundary.value?.sourceWalkForwardPath,
    boundary.value?.sourceWalkForward?.sourcePath,
    derived.value?.sourceCoherentWalkForwardPath,
  );
  const sourceWalkForward = sourceWalkForwardPath
    ? await readArtifact(sourceWalkForwardPath, 'coherent walk-forward')
    : null;

  const artifacts = [freeze, fixed, sourceWalkForward, boundary, derived].filter(Boolean);
  const targetLocations = [];
  const summary = artifacts.map((artifact) => {
    if (artifact.fileSha256 === TARGET_SHA) {
      targetLocations.push({ kind: 'FILE_BYTES', file: artifact.path, path: '(raw bytes)' });
    }
    const shaFields = collectShaFields(artifact.value);
    for (const field of shaFields) {
      if (field.value === TARGET_SHA) {
        targetLocations.push({ kind: 'FIELD', file: artifact.path, path: field.path });
      }
    }
    return {
      path: artifact.path,
      fileSha256: artifact.fileSha256,
      targetIsFileBytes: artifact.fileSha256 === TARGET_SHA,
      targetFieldPaths: shaFields.filter((field) => field.value === TARGET_SHA).map((field) => field.path),
      shaFields,
    };
  });

  console.log('M8_5_PARK_REAL_ARTIFACT_LINEAGE=' + JSON.stringify({
    targetSha256: TARGET_SHA,
    targetLocations,
    paths: {
      freeze: FREEZE_PATH,
      coherentFixed: fixedPath,
      coherentWalkForward: sourceWalkForwardPath,
      platoonBoundary: boundaryPath,
      derivedPlatoonWalkForward: derivedPath,
    },
    summary,
  }));

  assert.equal(artifacts.length >= 4, true, 'at least freeze, fixed, boundary, and derived artifacts must load');
  assert.equal(new Set(artifacts.map((artifact) => artifact.path)).size, artifacts.length, 'provenance paths must be distinct');
});
