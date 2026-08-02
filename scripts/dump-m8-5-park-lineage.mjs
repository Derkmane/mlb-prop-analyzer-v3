#!/usr/bin/env node
import { createHash } from 'node:crypto';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

const FREEZE_PATH = 'model-artifacts/m8-batter-hits-runtime-freeze-v1.json';
const TARGET_SHA =
  process.argv[2] ??
  '3e3e30150bee91e612798f39a449ef9f2adb682ce43fe1835a17f46a5bed4e82';
const SHA_RE = /^[0-9a-f]{64}$/;

if (!SHA_RE.test(TARGET_SHA)) {
  throw new Error('target must be one lowercase SHA-256 value.');
}

function sha256(raw) {
  return createHash('sha256').update(raw).digest('hex');
}

function walkJson(dir, out = []) {
  let entries = [];
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    return out;
  }
  for (const entry of entries) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) walkJson(path, out);
    else if (entry.isFile() && entry.name.endsWith('.json')) out.push(path);
  }
  return out;
}

function readArtifact(path) {
  const raw = readFileSync(path);
  return {
    path: relative(process.cwd(), path),
    raw,
    fileSha256: sha256(raw),
    bytes: raw.length,
    trailingNewline: raw.length > 0 && raw[raw.length - 1] === 0x0a,
    containsCRLF: raw.includes(Buffer.from('\r\n')),
    value: JSON.parse(raw.toString('utf8')),
  };
}

function collectInteresting(value, prefix = '', output = []) {
  if (!value || typeof value !== 'object') return output;
  for (const [key, entry] of Object.entries(value)) {
    const path = prefix ? `${prefix}.${key}` : key;
    if (
      typeof entry === 'string' &&
      (key.toLowerCase().includes('sha256') || key.toLowerCase().includes('sourcepath'))
    ) {
      output.push({ path, value: entry });
    }
    if (entry && typeof entry === 'object') collectInteresting(entry, path, output);
  }
  return output;
}

function artifactSummary(artifact) {
  return {
    path: artifact.path,
    fileSha256: artifact.fileSha256,
    bytes: artifact.bytes,
    trailingNewline: artifact.trailingNewline,
    containsCRLF: artifact.containsCRLF,
    fields: collectInteresting(artifact.value),
  };
}

function pathValue(...values) {
  return values.find((value) => typeof value === 'string' && value.length > 0) ?? null;
}

const freeze = readArtifact(FREEZE_PATH);
const coherent = freeze.value?.fittedComponents?.coherentMatchup;
const platoon = freeze.value?.fittedComponents?.platoon;
if (!coherent || !platoon) {
  throw new Error('freeze manifest lacks coherent or platoon component evidence.');
}

const declaredPaths = {
  coherentFixed: pathValue(coherent.fixedValidation?.sourcePath),
  coherentWalkForward: pathValue(coherent.walkForward?.sourcePath),
  platoonBoundary: pathValue(platoon.fixedValidation?.sourcePath),
  derivedPlatoonWalkForward: pathValue(platoon.walkForward?.sourcePath),
};

const allArtifacts = ['model-artifacts', 'artifacts']
  .flatMap((root) => walkJson(root))
  .map(readArtifact);
const byPath = new Map(allArtifacts.map((artifact) => [artifact.path, artifact]));

const boundary = declaredPaths.platoonBoundary
  ? byPath.get(declaredPaths.platoonBoundary)
  : null;
const derived = declaredPaths.derivedPlatoonWalkForward
  ? byPath.get(declaredPaths.derivedPlatoonWalkForward)
  : null;

const boundarySourceInternal = boundary?.value?.sourceWalkForwardSha256 ?? null;
const boundarySourceFile = boundary?.value?.sourceWalkForwardFileSha256 ?? null;
let coherentWalkForward = declaredPaths.coherentWalkForward
  ? byPath.get(declaredPaths.coherentWalkForward)
  : null;

if (!coherentWalkForward && boundarySourceFile) {
  coherentWalkForward = allArtifacts.find(
    (artifact) => artifact.fileSha256 === boundarySourceFile,
  );
}
if (!coherentWalkForward && boundarySourceInternal) {
  coherentWalkForward = allArtifacts.find((artifact) =>
    collectInteresting(artifact.value).some(
      (field) =>
        field.value === boundarySourceInternal &&
        !field.path.toLowerCase().startsWith('source'),
    ),
  );
}

const named = {
  freeze,
  coherentFixed: declaredPaths.coherentFixed
    ? byPath.get(declaredPaths.coherentFixed) ?? null
    : null,
  coherentWalkForward: coherentWalkForward ?? null,
  platoonBoundary: boundary ?? null,
  derivedPlatoonWalkForward: derived ?? null,
};

const targetLocations = [];
for (const artifact of allArtifacts) {
  if (artifact.fileSha256 === TARGET_SHA) {
    targetLocations.push({
      kind: 'FILE_BYTES',
      file: artifact.path,
      path: '(raw bytes)',
    });
  }
  for (const field of collectInteresting(artifact.value)) {
    if (field.value === TARGET_SHA) {
      targetLocations.push({ kind: 'FIELD', file: artifact.path, path: field.path });
    }
  }
}

console.log(
  JSON.stringify(
    {
      targetSha256: TARGET_SHA,
      targetLocations,
      declaredPaths,
      resolvedArtifacts: Object.fromEntries(
        Object.entries(named).map(([name, artifact]) => [
          name,
          artifact ? artifactSummary(artifact) : null,
        ]),
      ),
      derivedBoundaryChecks: derived
        ? {
            sourcePlatoonBoundarySha256:
              derived.value.sourcePlatoonBoundarySha256 ?? null,
            sourcePlatoonBoundaryFileSha256:
              derived.value.sourcePlatoonBoundaryFileSha256 ?? null,
            sourcePlatoonEvaluationSha256:
              derived.value.sourcePlatoonEvaluationSha256 ?? null,
            sourcePlatoonEvaluationFileSha256:
              derived.value.sourcePlatoonEvaluationFileSha256 ?? null,
          }
        : null,
      boundaryCurrentChecks: boundary
        ? {
            platoonEvaluationSha256:
              boundary.value.platoonEvaluationSha256 ?? null,
            currentFileSha256: boundary.fileSha256,
            sourceWalkForwardSha256:
              boundary.value.sourceWalkForwardSha256 ?? null,
            sourceWalkForwardFileSha256:
              boundary.value.sourceWalkForwardFileSha256 ?? null,
          }
        : null,
    },
    null,
    2,
  ),
);
