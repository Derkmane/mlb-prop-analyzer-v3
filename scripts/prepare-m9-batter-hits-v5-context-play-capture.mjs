import { readFile } from 'node:fs/promises';
import path from 'node:path';

import {
  buildM8ContextPlayCapturePlan,
} from './m8-context-play-capture-utils.mjs';
import {
  prepareM9BatterHitsV5ContextPlayReuse,
  verifyM9BatterHitsV5ContextPlayReuse,
} from './m9-batter-hits-v5-context-play-reuse-utils.mjs';
import { writeJsonAtomic } from './provider-probe-utils.mjs';

const DATASET_PATH =
  process.env.M9_V5_RECENCY_DATASET_PATH?.trim() ||
  'artifacts/m9-batter-hits-v5-refit/' +
    'm9-batter-hits-v5-recency-evaluation-dataset-v1.json';
const SOURCE_CAPTURE_ROOT =
  process.env.M9_V5_CONTEXT_PLAY_SOURCE_ROOT?.trim() ||
  'artifacts/m8-current-season-pa/m8-context-plays-v1';
const TARGET_CAPTURE_ROOT =
  process.env.M9_V5_CONTEXT_PLAY_OUTPUT_ROOT?.trim() ||
  'artifacts/m9-batter-hits-v5-refit/' +
    'm9-batter-hits-v5-context-plays-v1';
const PLAN_PATH = path.join(TARGET_CAPTURE_ROOT, 'capture-plan.json');
const REUSE_MANIFEST_PATH = path.join(
  TARGET_CAPTURE_ROOT,
  'reuse-manifest.json',
);

async function readJson(filePath, label) {
  let text;
  try {
    text = await readFile(filePath, 'utf8');
  } catch (error) {
    throw new Error(
      `${label} could not be read: ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
  }
  try {
    return JSON.parse(text);
  } catch {
    throw new Error(`${label} is not valid JSON.`);
  }
}

const plan = await buildM8ContextPlayCapturePlan({
  datasetPath: DATASET_PATH,
});
const sourceManifest = await readJson(
  path.join(SOURCE_CAPTURE_ROOT, 'capture-manifest.json'),
  'source context-play capture manifest',
);
const reuse = await prepareM9BatterHitsV5ContextPlayReuse({
  rawPlan: plan,
  rawSourceCaptureManifest: sourceManifest,
  sourceCaptureRoot: SOURCE_CAPTURE_ROOT,
  targetCaptureRoot: TARGET_CAPTURE_ROOT,
  secret: process.env.BALLDONTLIE_API_KEY?.trim() || null,
});
verifyM9BatterHitsV5ContextPlayReuse(reuse);

await writeJsonAtomic(PLAN_PATH, plan);
await writeJsonAtomic(REUSE_MANIFEST_PATH, reuse);

const persistedReuse = await readJson(
  REUSE_MANIFEST_PATH,
  'persisted V5 context-play reuse manifest',
);
verifyM9BatterHitsV5ContextPlayReuse(persistedReuse);
if (persistedReuse.reuseSha256 !== reuse.reuseSha256) {
  throw new Error('persisted V5 context-play reuse identity changed after writing.');
}

console.log('=== M9 BATTER HITS V5 CONTEXT-PLAY CAPTURE PREPARED ===');
console.log(`Dataset: ${DATASET_PATH}`);
console.log(`Source capture root: ${SOURCE_CAPTURE_ROOT}`);
console.log(`Target capture root: ${TARGET_CAPTURE_ROOT}`);
console.log(`Context-required rows: ${plan.contextRowCount}`);
console.log(`Planned games: ${plan.gameCount}`);
console.log(`Verified reusable games: ${reuse.reusedGameCount}`);
console.log(`Relative symlink games: ${reuse.linkedGameCount}`);
console.log(`Equivalent independent target games: ${reuse.existingVerifiedGameCount}`);
console.log(`Missing games requiring provider capture: ${reuse.missingGameCount}`);
console.log(`Plan SHA-256: ${plan.planSha256}`);
console.log(`Reuse SHA-256: ${reuse.reuseSha256}`);
console.log(`Capture plan: ${PLAN_PATH}`);
console.log(`Reuse manifest: ${REUSE_MANIFEST_PATH}`);
console.log('Raw play pages copied: 0');
console.log('Production enabled: false');
console.log('Untouched acceptance rows accessed: false');
