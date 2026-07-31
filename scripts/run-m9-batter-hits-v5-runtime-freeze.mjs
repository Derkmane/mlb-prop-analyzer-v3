import { spawnSync } from 'node:child_process';
import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import {
  verifyBatterHitsCloseoutFreeze,
} from './m8-batter-hits-closeout-freeze-utils.mjs';
import {
  M9_BATTER_HITS_V5_EXPECTED_CANDIDATES,
  M9_BATTER_HITS_V5_FREEZE_CONTRACT,
  buildM9BatterHitsV5FreezeRunSpecification,
} from './m9-batter-hits-v5-runtime-freeze-utils.mjs';

const ROOT =
  process.env.M9_BATTER_HITS_V5_ROOT?.trim() ||
  'artifacts/m9-batter-hits-v5-refit';
const OUTPUT_PATH =
  process.env.M9_BATTER_HITS_V5_RUNTIME_FREEZE_OUTPUT_PATH?.trim() ||
  `${ROOT}/m9-batter-hits-v5-runtime-freeze-v1.json`;

async function collectFiles(root) {
  const result = [];

  async function visit(directory) {
    const entries = await readdir(directory, { withFileTypes: true });
    for (const entry of entries) {
      const entryPath = path.join(directory, entry.name);
      if (entry.isDirectory()) {
        await visit(entryPath);
      } else if (entry.isFile()) {
        result.push(entryPath);
      }
    }
  }

  await visit(root);
  return result.sort((left, right) => left.localeCompare(right));
}

function uniqueBySuffix(files, suffix, label) {
  const matches = files.filter((file) => file.endsWith(suffix));
  if (matches.length !== 1) {
    throw new Error(
      `${label} requires exactly one file ending in ${suffix}; found ${matches.length}: ${matches.join(', ')}`,
    );
  }
  return matches[0];
}

async function readSource(filePath, label) {
  const text = await readFile(filePath, 'utf8');
  let value;
  try {
    value = JSON.parse(text);
  } catch {
    throw new Error(`${label} is not valid JSON: ${filePath}`);
  }
  return Object.freeze({ path: filePath, value });
}

const files = await collectFiles(ROOT);
const paths = Object.freeze({
  recencyFixed: uniqueBySuffix(
    files,
    'hit-recency-evaluation-v1.json',
    'recency fixed evaluation',
  ),
  recencyWalk: uniqueBySuffix(
    files,
    'hit-recency-walk-forward-v1.json',
    'recency walk-forward evaluation',
  ),
  poolingWalk: uniqueBySuffix(
    files,
    'resolved-categorical-pooling-walk-forward-v1.json',
    'categorical pooling walk-forward evaluation',
  ),
  categoricalFixed: uniqueBySuffix(
    files,
    'resolved-categorical-model-evaluation-v1.json',
    'categorical fixed evaluation',
  ),
  categoricalWalk: uniqueBySuffix(
    files,
    'resolved-categorical-walk-forward-v1.json',
    'categorical walk-forward evaluation',
  ),
  platoonFixed: uniqueBySuffix(
    files,
    'resolved-categorical-platoon-boundary-v1.json',
    'platoon fixed evaluation',
  ),
  platoonWalk: uniqueBySuffix(
    files,
    'resolved-categorical-platoon-walk-forward-v1.json',
    'platoon walk-forward evaluation',
  ),
  starterBullpenEvaluation: uniqueBySuffix(
    files,
    'starter-bullpen-evaluation.json',
    'starter-bullpen evaluation',
  ),
  paFixed: uniqueBySuffix(
    files,
    'pa-survival-evaluation-v1.json',
    'PA-survival fixed evaluation',
  ),
  paWalk: uniqueBySuffix(
    files,
    'pa-survival-walk-forward-v1.json',
    'PA-survival walk-forward evaluation',
  ),
  paArtifact: uniqueBySuffix(
    files,
    'pa-survival-artifact-v1.json',
    'PA-survival artifact',
  ),
  sharedFixed: uniqueBySuffix(
    files,
    'shared-offensive-environment-evaluation-v1.json',
    'shared-environment fixed evaluation',
  ),
  sharedWalk: uniqueBySuffix(
    files,
    'shared-offensive-environment-walk-forward-v1.json',
    'shared-environment walk-forward evaluation',
  ),
  sharedArtifact: uniqueBySuffix(
    files,
    'shared-offensive-environment-artifact-v1.json',
    'shared-environment V1 artifact',
  ),
  sharedV2: uniqueBySuffix(
    files,
    'shared-offensive-environment-v2.json',
    'shared-environment V2 artifact',
  ),
  retentionArtifact: uniqueBySuffix(
    files,
    'starter-retention-artifact-v1.json',
    'starter-retention artifact',
  ),
  terminalArtifact: uniqueBySuffix(
    files,
    'terminal-pa-outcome-artifact-v1.json',
    'terminal-PA artifact',
  ),
  completeCandidate: uniqueBySuffix(
    files,
    'complete-candidate-v1.json',
    'complete Batter Hits candidate',
  ),
});

const sources = Object.fromEntries(
  await Promise.all(
    Object.entries(paths).map(async ([key, filePath]) => [
      key,
      await readSource(filePath, key),
    ]),
  ),
);

const specification = buildM9BatterHitsV5FreezeRunSpecification({
  rootPath: ROOT,
  outputPath: OUTPUT_PATH,
  sources,
});

const temporaryRoot = await mkdtemp(
  path.join(os.tmpdir(), 'm9-batter-hits-v5-freeze-'),
);
const specificationPath = path.join(temporaryRoot, 'freeze-specification.json');

try {
  await writeFile(
    specificationPath,
    `${JSON.stringify(specification, null, 2)}\n`,
    'utf8',
  );

  const run = spawnSync(
    process.execPath,
    ['scripts/run-m8-batter-hits-closeout-freeze.mjs'],
    {
      cwd: process.cwd(),
      env: {
        ...process.env,
        M8_BATTER_HITS_FREEZE_SPEC_PATH: specificationPath,
        M8_BATTER_HITS_RUNTIME_FREEZE_OUTPUT_PATH: OUTPUT_PATH,
      },
      encoding: 'utf8',
    },
  );

  if (run.stdout) process.stdout.write(run.stdout);
  if (run.stderr) process.stderr.write(run.stderr);

  if (run.status !== 0) {
    throw new Error(
      `V5 runtime freeze runner failed with exit status ${run.status}.`,
    );
  }

  const persisted = JSON.parse(await readFile(OUTPUT_PATH, 'utf8'));
  verifyBatterHitsCloseoutFreeze(persisted, {
    expectedContract: M9_BATTER_HITS_V5_FREEZE_CONTRACT,
  });

  const actualCandidates = Object.fromEntries(
    Object.entries(persisted.fittedComponents).map(([key, component]) => [
      key,
      component.candidateId,
    ]),
  );

  if (
    JSON.stringify(actualCandidates) !==
    JSON.stringify(M9_BATTER_HITS_V5_EXPECTED_CANDIDATES)
  ) {
    throw new Error('persisted V5 runtime candidate identities drifted.');
  }

  console.log('=== M9 BATTER HITS V5 ACCEPTANCE FREEZE VERIFIED ===');
  console.log(`Output: ${OUTPUT_PATH}`);
  console.log(`Artifact SHA-256: ${persisted.artifactSha256}`);
  console.log('Production enabled: false');
  console.log('Untouched-test rows accessed: false');
  console.log('Connected M8 runtime artifact replaced: false');
} finally {
  await rm(temporaryRoot, { recursive: true, force: true });
}
