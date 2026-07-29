import { access, readFile, readdir } from 'node:fs/promises';
import path from 'node:path';

import { verifyM8FrozenBatterHitsCandidate } from './m8-batter-hits-frozen-candidate-utils.mjs';
import { evaluateM8FrozenBatterHitsCandidate } from './m8-batter-hits-untouched-evaluation-utils.mjs';
import {
  buildM8UntouchedGameObservations,
  gradeM8UntouchedPlateAppearance,
} from './m8-untouched-hit-observation-utils.mjs';
import { verifyM8SharedOffensiveEnvironmentV2 } from './m8-shared-offensive-environment-v2-utils.mjs';
import { verifyM8StarterRetentionArtifact } from './m8-starter-retention-artifact-utils.mjs';
import { verifyM8TerminalPaOutcomeArtifact } from './m8-terminal-pa-outcome-artifact-utils.mjs';
import { sha256, writeJsonAtomic } from './provider-probe-utils.mjs';

const SEARCH_ROOT = process.env.M8_ARTIFACT_SEARCH_ROOT?.trim() || 'artifacts';
const CANDIDATE_PATH =
  process.env.M8_BATTER_HITS_COMPLETE_CANDIDATE_PATH?.trim() ||
  'model-artifacts/m8-batter-hits-complete-candidate-v1.json';
const SHARED_PATH =
  process.env.M8_SHARED_ENVIRONMENT_V2_PATH?.trim() ||
  'model-artifacts/m8-shared-offensive-environment-v2.json';
const RETENTION_PATH =
  process.env.M8_STARTER_RETENTION_ARTIFACT_PATH?.trim() ||
  'model-artifacts/m8-starter-retention-v1.json';
const TERMINAL_PATH =
  process.env.M8_TERMINAL_PA_OUTCOME_ARTIFACT_PATH?.trim() ||
  'model-artifacts/m8-terminal-pa-outcome-v1.json';
const OUTPUT_PATH =
  process.env.M8_BATTER_HITS_UNTOUCHED_TEST_OUTPUT_PATH?.trim() ||
  'model-artifacts/m8-batter-hits-untouched-test-v1.json';

async function readJson(filePath) {
  const text = await readFile(filePath, 'utf8');
  try {
    return { path: filePath, text, value: JSON.parse(text) };
  } catch {
    throw new Error(`${filePath} is not valid JSON.`);
  }
}

async function walk(directory, results = []) {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    if (entry.name === 'node_modules' || entry.name === 'dist' || entry.name === '.git') continue;
    const fullPath = path.join(directory, entry.name);
    if (entry.isDirectory()) await walk(fullPath, results);
    else if (entry.name.endsWith('.json')) results.push(fullPath);
  }
  return results;
}

function isPartitionManifest(value) {
  return (
    value?.partitionVersion === 1 &&
    Array.isArray(value?.periods?.test?.shards) &&
    value?.selectionBoundary?.testMetricsForbiddenDuringCandidateSelection === true
  );
}

function reportIdentity(value) {
  return {
    evaluationVersion: value.evaluationVersion,
    status: value.status,
    productionEnabled: value.productionEnabled,
    modelVersion: value.modelVersion,
    modelArtifactSha256: value.modelArtifactSha256,
    sourcePartitionSha256: value.sourcePartitionSha256,
    sourceEvidenceSetSha256: value.sourceEvidenceSetSha256,
    testWindow: value.testWindow,
    evidenceCounts: value.evidenceCounts,
    exclusionReasonCounts: value.exclusionReasonCounts,
    selected: value.selected,
    noEnvironmentBenchmark: value.noEnvironmentBenchmark,
    acceptance: value.acceptance,
    observationIdsSha256: value.observationIdsSha256,
  };
}

await Promise.all([
  access(CANDIDATE_PATH),
  access(SHARED_PATH),
  access(RETENTION_PATH),
  access(TERMINAL_PATH),
]);

// The candidate and every component are verified before the test partition is located or read.
const [candidateRead, sharedRead, retentionRead, terminalRead] = await Promise.all([
  readJson(CANDIDATE_PATH),
  readJson(SHARED_PATH),
  readJson(RETENTION_PATH),
  readJson(TERMINAL_PATH),
]);
const candidate = verifyM8FrozenBatterHitsCandidate(candidateRead.value);
const shared = verifyM8SharedOffensiveEnvironmentV2(sharedRead.value);
const retention = verifyM8StarterRetentionArtifact(retentionRead.value);
const terminal = verifyM8TerminalPaOutcomeArtifact(terminalRead.value);
if (
  candidate.sourceSharedEnvironmentArtifactSha256 !== shared.artifactSha256 ||
  candidate.sourceStarterRetentionArtifactSha256 !== retention.artifactSha256 ||
  candidate.sourceTerminalOutcomeArtifactSha256 !== terminal.artifactSha256
) {
  throw new Error('frozen candidate does not reference the supplied component artifacts.');
}
console.log(`Frozen candidate verified before test access: ${candidate.artifactSha256}`);

await access(SEARCH_ROOT);
const files = await walk(SEARCH_ROOT);
const partitions = [];
for (const filePath of files) {
  const item = await readJson(filePath);
  if (isPartitionManifest(item.value)) partitions.push(item);
}
if (partitions.length !== 1) {
  throw new Error(
    `Expected exactly one chronological partition manifest under ${SEARCH_ROOT}; found ${partitions.length}.`,
  );
}
const partitionRead = partitions[0];
const partition = partitionRead.value;
const testPeriod = partition.periods.test;
if (
  testPeriod.startDate !== candidate.untouchedTestReservation.startDate ||
  testPeriod.endDate !== candidate.untouchedTestReservation.endDate
) {
  throw new Error('partition test window differs from the frozen candidate reservation.');
}
const { classifyBallDontLieTerminalPa } = await import(
  new URL('../dist/src/adapters/providers/balldontlie/index.js', import.meta.url)
);

const observations = [];
const exclusionReasonCounts = {};
let gameCount = 0;
let sideExclusionCount = 0;
let ignoredBaserunningRowCount = 0;
let rawPlateAppearanceCount = 0;
let terminalPlateAppearanceCount = 0;

for (const shard of testPeriod.shards) {
  const date = shard.date;
  const shardRoot = path.join(partition.shardCollectionRoot, date);
  const manifestPath = path.join(
    partition.shardCollectionRoot,
    shard.captureManifestPath,
  );
  const manifestRead = await readJson(manifestPath);
  if (sha256(manifestRead.text) !== shard.captureManifestSha256) {
    throw new Error(`test shard ${date} capture manifest hash drifted.`);
  }
  const dateCaptures = manifestRead.value.dateCaptures;
  if (!Array.isArray(dateCaptures) || dateCaptures.length !== 1 || dateCaptures[0].date !== date) {
    throw new Error(`test shard ${date} does not contain one matching date capture.`);
  }
  for (const game of dateCaptures[0].games) {
    const gameId = game.gameId;
    const snapshotPath = path.join(
      shardRoot,
      game.plateAppearancesSnapshot.filePath,
    );
    const snapshotRead = await readJson(snapshotPath);
    if (
      sha256(snapshotRead.text) !==
      game.plateAppearancesSnapshot.savedBodySha256
    ) {
      throw new Error(`test game ${gameId} plate-appearance snapshot hash drifted.`);
    }
    if (!Array.isArray(snapshotRead.value.data)) {
      throw new Error(`test game ${gameId} plate-appearance data is not an array.`);
    }
    rawPlateAppearanceCount += snapshotRead.value.data.length;
    const gradedRows = snapshotRead.value.data.map((rawPlateAppearance) => {
      const classification = classifyBallDontLieTerminalPa({
        plateAppearance: rawPlateAppearance,
        providerGameId: gameId,
        sourceSnapshotSha256: game.plateAppearancesSnapshot.savedBodySha256,
      });
      const graded = gradeM8UntouchedPlateAppearance({
        rawPlateAppearance,
        classification,
      });
      if (graded.kind === 'terminal') terminalPlateAppearanceCount += 1;
      return graded;
    });
    const recovered = buildM8UntouchedGameObservations({
      observedDate: date,
      gameId,
      gradedRows,
    });
    observations.push(...recovered.observations);
    ignoredBaserunningRowCount += recovered.ignoredBaserunningRowCount;
    for (const exclusion of recovered.exclusions) {
      sideExclusionCount += 1;
      exclusionReasonCounts[exclusion.reason] =
        (exclusionReasonCounts[exclusion.reason] ?? 0) + 1;
    }
    gameCount += 1;
  }
  console.log(`Untouched shard graded: ${date}`);
}

if (rawPlateAppearanceCount !== testPeriod.plateAppearanceCount) {
  throw new Error('untouched raw PA count drifted from the partition manifest.');
}
if (observations.length === 0) {
  throw new Error('untouched period produced no valid starter observations.');
}
const evaluation = evaluateM8FrozenBatterHitsCandidate({
  candidate,
  sharedEnvironmentArtifact: shared,
  starterRetentionArtifact: retention,
  terminalOutcomeArtifact: terminal,
  observations,
});
const report = {
  evaluationVersion: 1,
  status: evaluation.acceptance.allRequiredGatesPass
    ? 'untouched-test-passed'
    : 'untouched-test-failed',
  productionEnabled: false,
  modelVersion: evaluation.modelVersion,
  modelArtifactSha256: evaluation.modelArtifactSha256,
  sourcePartitionSha256: sha256(partitionRead.text),
  sourceEvidenceSetSha256: partition.evidenceSetSha256,
  testWindow: evaluation.testWindow,
  evidenceCounts: Object.freeze({
    shardCount: testPeriod.shardCount,
    gameCount,
    candidateSideCount: gameCount * 2,
    includedStarterObservationCount: observations.length,
    includedTeamSideCount: observations.length / 9,
    excludedTeamSideCount: sideExclusionCount,
    rawPlateAppearanceCount,
    terminalPlateAppearanceCount,
    ignoredBaserunningRowCount,
  }),
  exclusionReasonCounts: Object.freeze(
    Object.fromEntries(Object.entries(exclusionReasonCounts).sort()),
  ),
  selected: evaluation.selected,
  noEnvironmentBenchmark: evaluation.noEnvironmentBenchmark,
  acceptance: evaluation.acceptance,
  observationIdsSha256: evaluation.observationIdsSha256,
};
const frozenReport = Object.freeze({
  purpose:
    'Immutable one-time untouched current-season Batter Hits acceptance report for the candidate frozen before test access.',
  ...report,
  evaluationSha256: sha256(JSON.stringify(reportIdentity(report))),
});
await writeJsonAtomic(OUTPUT_PATH, frozenReport);

console.log('=== M8 BATTER HITS UNTOUCHED TEST COMPLETE ===');
console.log(`Status: ${frozenReport.status}`);
console.log(`Test games: ${gameCount}`);
console.log(`Included starter observations: ${observations.length}`);
console.log(`Excluded team sides: ${sideExclusionCount}`);
console.log(`Selected log loss: ${evaluation.selected.logLoss}`);
console.log(`No-environment log loss: ${evaluation.noEnvironmentBenchmark.logLoss}`);
console.log(`Selected multiclass Brier: ${evaluation.selected.multiclassBrier}`);
console.log(`No-environment multiclass Brier: ${evaluation.noEnvironmentBenchmark.multiclassBrier}`);
console.log(`Higher 0.5 Brier pass: ${evaluation.acceptance.lineBrierPasses.higher05}`);
console.log(`Higher 1.5 Brier pass: ${evaluation.acceptance.lineBrierPasses.higher15}`);
console.log(`Higher 2.5 Brier pass: ${evaluation.acceptance.lineBrierPasses.higher25}`);
console.log(`All required gates pass: ${evaluation.acceptance.allRequiredGatesPass}`);
console.log(`Evaluation SHA-256: ${frozenReport.evaluationSha256}`);
console.log(`Tracked report: ${OUTPUT_PATH}`);
console.log('Production enabled: false');

if (!evaluation.acceptance.allRequiredGatesPass) {
  process.exitCode = 1;
}
