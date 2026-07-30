import { access, readFile, readdir } from 'node:fs/promises';
import path from 'node:path';

import { verifyM8FrozenBatterHitsCandidate } from './m8-batter-hits-frozen-candidate-utils.mjs';
import { predictM8BatterHitsDistribution } from './m8-batter-hits-runtime-candidate-utils.mjs';
import {
  buildM8UntouchedGameObservations,
  gradeM8UntouchedPlateAppearance,
} from './m8-untouched-hit-observation-utils.mjs';
import { verifyM8SharedOffensiveEnvironmentV2 } from './m8-shared-offensive-environment-v2-utils.mjs';
import { verifyM8StarterRetentionArtifact } from './m8-starter-retention-artifact-utils.mjs';
import { verifyM8TerminalPaOutcomeArtifact } from './m8-terminal-pa-outcome-artifact-utils.mjs';
import {
  calibrateHitsDistribution,
  evaluateCalibratedHitsPredictions,
  fitSharedTailLogitIntercept,
  lineBriersNoWorse,
  nondominatedCandidateIds,
} from './m9-batter-hits-tail-calibration-utils.mjs';
import { sha256, writeJsonAtomic } from './provider-probe-utils.mjs';

const SEARCH_ROOT = process.env.M9_ARTIFACT_SEARCH_ROOT?.trim() || 'artifacts';
const BASE_CANDIDATE_PATH =
  process.env.M9_BASE_BATTER_HITS_CANDIDATE_PATH?.trim() ||
  'model-artifacts/m8-batter-hits-complete-candidate-v1.json';
const SHARED_PATH =
  process.env.M9_SHARED_ENVIRONMENT_PATH?.trim() ||
  'model-artifacts/m8-shared-offensive-environment-v2.json';
const RETENTION_PATH =
  process.env.M9_STARTER_RETENTION_PATH?.trim() ||
  'model-artifacts/m8-starter-retention-v1.json';
const TERMINAL_PATH =
  process.env.M9_TERMINAL_OUTCOME_PATH?.trim() ||
  'model-artifacts/m8-terminal-pa-outcome-v1.json';
const PRIOR_REPORT_PATH =
  process.env.M9_PRIOR_UNTOUCHED_REPORT_PATH?.trim() ||
  'model-artifacts/m8-batter-hits-untouched-test-v1.json';
const EVALUATION_OUTPUT_PATH =
  process.env.M9_TAIL_CALIBRATION_EVALUATION_OUTPUT_PATH?.trim() ||
  'model-artifacts/m9-batter-hits-tail-calibration-evaluation-v1.json';
const CANDIDATE_OUTPUT_PATH =
  process.env.M9_TAIL_CALIBRATED_CANDIDATE_OUTPUT_PATH?.trim() ||
  'model-artifacts/m9-batter-hits-tail-calibrated-candidate-v1.json';

const ACTIVE_SEASON = 2026;
const SOURCE_START_DATE = '2026-03-26';
const DEVELOPMENT_END_DATE = '2026-07-25';
const FIXED_FIT_END_DATE = '2026-07-15';
const FIXED_VALIDATION_START_DATE = '2026-07-16';
const FIXED_VALIDATION_END_DATE = '2026-07-25';
const UNTOUCHED_START_DATE = '2026-07-26';
const UNTOUCHED_END_DATE = '2026-07-31';

const CANDIDATES = Object.freeze([
  Object.freeze({ candidateId: 'calibration-shrink-000', lambda: 0, selectable: false }),
  Object.freeze({ candidateId: 'calibration-shrink-025', lambda: 0.25, selectable: true }),
  Object.freeze({ candidateId: 'calibration-shrink-050', lambda: 0.5, selectable: true }),
  Object.freeze({ candidateId: 'calibration-shrink-075', lambda: 0.75, selectable: true }),
  Object.freeze({ candidateId: 'calibration-shrink-100', lambda: 1, selectable: true }),
]);

const WALK_FORWARD_FOLDS = Object.freeze([
  Object.freeze({
    foldId: 'fit-through-2026-06-21__validate-2026-06-22--2026-07-05',
    fitStartDate: SOURCE_START_DATE,
    fitEndDate: '2026-06-21',
    validationStartDate: '2026-06-22',
    validationEndDate: '2026-07-05',
  }),
  Object.freeze({
    foldId: 'fit-through-2026-07-05__validate-2026-07-06--2026-07-15',
    fitStartDate: SOURCE_START_DATE,
    fitEndDate: '2026-07-05',
    validationStartDate: '2026-07-06',
    validationEndDate: '2026-07-15',
  }),
  Object.freeze({
    foldId: 'fit-through-2026-07-15__validate-2026-07-16--2026-07-25',
    fitStartDate: SOURCE_START_DATE,
    fitEndDate: '2026-07-15',
    validationStartDate: '2026-07-16',
    validationEndDate: '2026-07-25',
  }),
]);

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
    if (entry.name === 'node_modules' || entry.name === 'dist' || entry.name === '.git') {
      continue;
    }
    const fullPath = path.join(directory, entry.name);
    if (entry.isDirectory()) await walk(fullPath, results);
    else if (entry.name.endsWith('.json')) results.push(fullPath);
  }
  return results;
}

function isPartitionManifest(value) {
  return (
    value?.partitionVersion === 1 &&
    Array.isArray(value?.periods?.fit?.shards) &&
    Array.isArray(value?.periods?.validation?.shards) &&
    Array.isArray(value?.periods?.test?.shards) &&
    value?.selectionBoundary?.testMetricsForbiddenDuringCandidateSelection === true
  );
}

function inWindow(date, startDate, endDate) {
  return date >= startDate && date <= endDate;
}

function predictionsInWindow(predictions, startDate, endDate) {
  const selected = predictions.filter((prediction) =>
    inWindow(prediction.observedDate, startDate, endDate),
  );
  if (selected.length === 0) {
    throw new Error(`No predictions exist from ${startDate} through ${endDate}.`);
  }
  return Object.freeze(selected);
}

function allLineGatesPass(gates) {
  return gates.higher05 && gates.higher15 && gates.higher25;
}

function evaluationIdentity(value) {
  return {
    evaluationVersion: value.evaluationVersion,
    purpose: value.purpose,
    activeSeason: value.activeSeason,
    baseCandidateVersion: value.baseCandidateVersion,
    baseCandidateSha256: value.baseCandidateSha256,
    priorUntouchedEvaluationSha256: value.priorUntouchedEvaluationSha256,
    sourcePartitionSha256: value.sourcePartitionSha256,
    sourceEvidenceSetSha256: value.sourceEvidenceSetSha256,
    sourceComponentArtifactSha256s: value.sourceComponentArtifactSha256s,
    developmentWindow: value.developmentWindow,
    fixedValidationDesign: value.fixedValidationDesign,
    walkForwardDesign: value.walkForwardDesign,
    candidateSet: value.candidateSet,
    fixedUnshrunkFit: value.fixedUnshrunkFit,
    walkForwardUnshrunkFits: value.walkForwardUnshrunkFits,
    results: value.results,
    fixedNondominatedCandidateIds: value.fixedNondominatedCandidateIds,
    walkForwardNondominatedCandidateIds: value.walkForwardNondominatedCandidateIds,
    selectableCandidateIds: value.selectableCandidateIds,
    selectedCandidate: value.selectedCandidate,
    observationCounts: value.observationCounts,
    observationIdsSha256: value.observationIdsSha256,
    untouchedTestReservation: value.untouchedTestReservation,
  };
}

function candidateIdentity(value) {
  return {
    artifactVersion: value.artifactVersion,
    modelVersion: value.modelVersion,
    status: value.status,
    productionEnabled: value.productionEnabled,
    activeSeason: value.activeSeason,
    baseCandidateVersion: value.baseCandidateVersion,
    baseCandidateSha256: value.baseCandidateSha256,
    sourceSharedEnvironmentArtifactSha256: value.sourceSharedEnvironmentArtifactSha256,
    sourceStarterRetentionArtifactSha256: value.sourceStarterRetentionArtifactSha256,
    sourceTerminalOutcomeArtifactSha256: value.sourceTerminalOutcomeArtifactSha256,
    sourceCalibrationEvaluationSha256: value.sourceCalibrationEvaluationSha256,
    calibration: value.calibration,
    finalFitWindow: value.finalFitWindow,
    finalFitObservationIdsSha256: value.finalFitObservationIdsSha256,
    untouchedTestReservation: value.untouchedTestReservation,
  };
}

await Promise.all([
  access(SEARCH_ROOT),
  access(BASE_CANDIDATE_PATH),
  access(SHARED_PATH),
  access(RETENTION_PATH),
  access(TERMINAL_PATH),
  access(PRIOR_REPORT_PATH),
]);

const [
  baseCandidateRead,
  sharedRead,
  retentionRead,
  terminalRead,
  priorReportRead,
] = await Promise.all([
  readJson(BASE_CANDIDATE_PATH),
  readJson(SHARED_PATH),
  readJson(RETENTION_PATH),
  readJson(TERMINAL_PATH),
  readJson(PRIOR_REPORT_PATH),
]);

const baseCandidate = verifyM8FrozenBatterHitsCandidate(baseCandidateRead.value);
const shared = verifyM8SharedOffensiveEnvironmentV2(sharedRead.value);
const retention = verifyM8StarterRetentionArtifact(retentionRead.value);
const terminal = verifyM8TerminalPaOutcomeArtifact(terminalRead.value);

if (
  baseCandidate.sourceSharedEnvironmentArtifactSha256 !== shared.artifactSha256 ||
  baseCandidate.sourceStarterRetentionArtifactSha256 !== retention.artifactSha256 ||
  baseCandidate.sourceTerminalOutcomeArtifactSha256 !== terminal.artifactSha256
) {
  throw new Error('base candidate does not reference the supplied component artifacts.');
}
if (baseCandidate.environmentEffectPolicy.coefficient !== 1) {
  throw new Error('tail calibration requires the verified nonzero environment coefficient 1.');
}
if (
  priorReportRead.value.status !== 'untouched-test-failed' ||
  priorReportRead.value.evaluationSha256 !==
    '7bc151aceb0c683cbba56d1f7887f1f35436d27ff22d696ecff95851020036c1'
) {
  throw new Error('prior immutable untouched failure does not match the revision plan.');
}

const partitionFiles = [];
for (const filePath of await walk(SEARCH_ROOT)) {
  const item = await readJson(filePath);
  if (isPartitionManifest(item.value)) partitionFiles.push(item);
}
if (partitionFiles.length !== 1) {
  throw new Error(`Expected one chronological partition manifest; found ${partitionFiles.length}.`);
}
const partitionRead = partitionFiles[0];
const partition = partitionRead.value;
if (
  partition.activeSeason !== ACTIVE_SEASON ||
  partition.sourceStartDate !== SOURCE_START_DATE ||
  partition.sourceEndDate !== DEVELOPMENT_END_DATE
) {
  throw new Error('source partition does not match the declared calibration development window.');
}

const shardByDate = new Map();
for (const periodId of ['fit', 'validation', 'test']) {
  for (const shard of partition.periods[periodId].shards) {
    if (shard.date > DEVELOPMENT_END_DATE) {
      throw new Error(`partition unexpectedly exposes post-development shard ${shard.date}.`);
    }
    const prior = shardByDate.get(shard.date);
    if (prior && JSON.stringify(prior) !== JSON.stringify(shard)) {
      throw new Error(`shard ${shard.date} has conflicting identities.`);
    }
    shardByDate.set(shard.date, shard);
  }
}
const shards = [...shardByDate.values()].sort((left, right) =>
  left.date.localeCompare(right.date),
);
if (shards.length === 0 || shards.at(-1).date !== DEVELOPMENT_END_DATE) {
  throw new Error('calibration source shards do not end on 2026-07-25.');
}

const { classifyBallDontLieTerminalPa } = await import(
  new URL('../dist/src/adapters/providers/balldontlie/index.js', import.meta.url)
);

const observations = [];
const observationIds = [];
const exclusionReasonCounts = {};
let rawPlateAppearanceCount = 0;
let gameCount = 0;

for (const shard of shards) {
  const date = shard.date;
  const shardRoot = path.join(partition.shardCollectionRoot, date);
  const manifestPath = path.join(partition.shardCollectionRoot, shard.captureManifestPath);
  const manifestRead = await readJson(manifestPath);
  if (sha256(manifestRead.text) !== shard.captureManifestSha256) {
    throw new Error(`development shard ${date} capture manifest hash drifted.`);
  }
  const dateCaptures = manifestRead.value.dateCaptures;
  if (!Array.isArray(dateCaptures) || dateCaptures.length !== 1 || dateCaptures[0].date !== date) {
    throw new Error(`development shard ${date} does not contain one matching date capture.`);
  }
  for (const game of dateCaptures[0].games) {
    const snapshotPath = path.join(
      shardRoot,
      game.plateAppearancesSnapshot.filePath,
    );
    const snapshotRead = await readJson(snapshotPath);
    if (sha256(snapshotRead.text) !== game.plateAppearancesSnapshot.savedBodySha256) {
      throw new Error(`development game ${game.gameId} snapshot hash drifted.`);
    }
    if (!Array.isArray(snapshotRead.value.data)) {
      throw new Error(`development game ${game.gameId} plate appearances are not an array.`);
    }
    rawPlateAppearanceCount += snapshotRead.value.data.length;
    const gradedRows = snapshotRead.value.data.map((rawPlateAppearance) => {
      const classification = classifyBallDontLieTerminalPa({
        plateAppearance: rawPlateAppearance,
        providerGameId: game.gameId,
        sourceSnapshotSha256: game.plateAppearancesSnapshot.savedBodySha256,
      });
      return gradeM8UntouchedPlateAppearance({
        rawPlateAppearance,
        classification,
      });
    });
    const recovered = buildM8UntouchedGameObservations({
      observedDate: date,
      gameId: game.gameId,
      gradedRows,
    });
    for (const observation of recovered.observations) {
      observations.push(observation);
      observationIds.push(observation.observationId);
    }
    for (const exclusion of recovered.exclusions) {
      exclusionReasonCounts[exclusion.reason] =
        (exclusionReasonCounts[exclusion.reason] ?? 0) + 1;
    }
    gameCount += 1;
  }
  console.log(`Calibration development shard graded: ${date}`);
}

if (observations.length === 0) {
  throw new Error('calibration development produced no starter-hitter observations.');
}
if (observations.some((observation) => observation.observedDate >= UNTOUCHED_START_DATE)) {
  throw new Error('calibration development accessed the untouched period.');
}

const rawPredictions = [];
for (const [index, observation] of observations.entries()) {
  const prediction = predictM8BatterHitsDistribution({
    sharedEnvironmentArtifact: shared,
    starterRetentionArtifact: retention,
    terminalOutcomeArtifact: terminal,
    bullpenModel: baseCandidate.bullpenModel,
    environmentCoefficient: baseCandidate.environmentEffectPolicy.coefficient,
    observation,
  });
  rawPredictions.push(
    Object.freeze({
      observationId: observation.observationId,
      observedDate: observation.observedDate,
      actualHits: observation.actualHits,
      pmf: prediction.statisticDistribution,
    }),
  );
  if ((index + 1) % 1000 === 0) {
    console.log(`Raw Batter Hits distributions built: ${index + 1}/${observations.length}`);
  }
}

const fixedFitPredictions = predictionsInWindow(
  rawPredictions,
  SOURCE_START_DATE,
  FIXED_FIT_END_DATE,
);
const fixedValidationPredictions = predictionsInWindow(
  rawPredictions,
  FIXED_VALIDATION_START_DATE,
  FIXED_VALIDATION_END_DATE,
);
const fixedUnshrunkFit = fitSharedTailLogitIntercept(fixedFitPredictions);

const fixedResults = CANDIDATES.map((candidate) => {
  const delta = candidate.lambda * fixedUnshrunkFit.delta;
  const evaluation = evaluateCalibratedHitsPredictions(
    fixedValidationPredictions,
    delta,
  );
  return Object.freeze({
    candidateId: candidate.candidateId,
    lambda: candidate.lambda,
    selectable: candidate.selectable,
    delta,
    metrics: evaluation.metrics,
    observationIdsSha256: evaluation.observationIdsSha256,
  });
});

const walkForwardUnshrunkFits = [];
const walkForwardByCandidate = Object.fromEntries(
  CANDIDATES.map((candidate) => [candidate.candidateId, []]),
);
const walkForwardCombinedByCandidate = Object.fromEntries(
  CANDIDATES.map((candidate) => [candidate.candidateId, []]),
);

for (const fold of WALK_FORWARD_FOLDS) {
  const fitPredictions = predictionsInWindow(
    rawPredictions,
    fold.fitStartDate,
    fold.fitEndDate,
  );
  const validationPredictions = predictionsInWindow(
    rawPredictions,
    fold.validationStartDate,
    fold.validationEndDate,
  );
  const unshrunkFit = fitSharedTailLogitIntercept(fitPredictions);
  walkForwardUnshrunkFits.push(
    Object.freeze({
      ...fold,
      fit: unshrunkFit,
      fitObservationCount: fitPredictions.length,
      validationObservationCount: validationPredictions.length,
    }),
  );
  for (const candidate of CANDIDATES) {
    const delta = candidate.lambda * unshrunkFit.delta;
    const foldEvaluation = evaluateCalibratedHitsPredictions(
      validationPredictions,
      delta,
    );
    walkForwardByCandidate[candidate.candidateId].push(
      Object.freeze({
        foldId: fold.foldId,
        delta,
        metrics: foldEvaluation.metrics,
        observationIdsSha256: foldEvaluation.observationIdsSha256,
      }),
    );
    for (const prediction of validationPredictions) {
      walkForwardCombinedByCandidate[candidate.candidateId].push(
        Object.freeze({
          observationId: prediction.observationId,
          observedDate: prediction.observedDate,
          actualHits: prediction.actualHits,
          pmf: calibrateHitsDistribution(prediction.pmf, delta),
        }),
      );
    }
  }
}

const walkForwardResults = CANDIDATES.map((candidate) => {
  const aggregate = evaluateCalibratedHitsPredictions(
    walkForwardCombinedByCandidate[candidate.candidateId],
    0,
  );
  return Object.freeze({
    candidateId: candidate.candidateId,
    lambda: candidate.lambda,
    selectable: candidate.selectable,
    foldResults: Object.freeze(walkForwardByCandidate[candidate.candidateId]),
    metrics: aggregate.metrics,
    observationIdsSha256: aggregate.observationIdsSha256,
  });
});

const fixedNondominatedCandidateIds = nondominatedCandidateIds(fixedResults);
const walkForwardNondominatedCandidateIds = nondominatedCandidateIds(
  walkForwardResults,
);
const benchmarkFixed = fixedResults.find(
  (result) => result.candidateId === 'calibration-shrink-000',
);
const benchmarkWalk = walkForwardResults.find(
  (result) => result.candidateId === 'calibration-shrink-000',
);
if (!benchmarkFixed || !benchmarkWalk) {
  throw new Error('zero-shrinkage calibration benchmark is missing.');
}

const results = CANDIDATES.map((candidate) => {
  const fixed = fixedResults.find((result) => result.candidateId === candidate.candidateId);
  const walkForward = walkForwardResults.find(
    (result) => result.candidateId === candidate.candidateId,
  );
  const fixedLineGates = lineBriersNoWorse(
    fixed.metrics,
    benchmarkFixed.metrics,
  );
  const walkForwardLineGates = lineBriersNoWorse(
    walkForward.metrics,
    benchmarkWalk.metrics,
  );
  const inFixedNondominatedSet = fixedNondominatedCandidateIds.includes(
    candidate.candidateId,
  );
  const inWalkForwardNondominatedSet = walkForwardNondominatedCandidateIds.includes(
    candidate.candidateId,
  );
  const selectable =
    candidate.selectable &&
    inFixedNondominatedSet &&
    inWalkForwardNondominatedSet &&
    allLineGatesPass(fixedLineGates) &&
    allLineGatesPass(walkForwardLineGates);
  return Object.freeze({
    candidateId: candidate.candidateId,
    lambda: candidate.lambda,
    benchmarkOnly: !candidate.selectable,
    fixed,
    walkForward,
    fixedLineGates,
    walkForwardLineGates,
    inFixedNondominatedSet,
    inWalkForwardNondominatedSet,
    selectable,
  });
});

const selectable = results
  .filter((result) => result.selectable)
  .sort(
    (left, right) =>
      left.lambda - right.lambda ||
      left.candidateId.localeCompare(right.candidateId),
  );
const selected = selectable[0] ?? null;

const evaluationBase = {
  evaluationVersion: 1,
  purpose:
    'Current-season selection of one monotone shared-logit-intercept calibration for coherent Batter Hits tail probabilities.',
  activeSeason: ACTIVE_SEASON,
  baseCandidateVersion: baseCandidate.modelVersion,
  baseCandidateSha256: baseCandidate.artifactSha256,
  priorUntouchedEvaluationSha256: priorReportRead.value.evaluationSha256,
  sourcePartitionSha256: sha256(partitionRead.text),
  sourceEvidenceSetSha256: partition.evidenceSetSha256,
  sourceComponentArtifactSha256s: Object.freeze({
    sharedEnvironment: shared.artifactSha256,
    starterRetention: retention.artifactSha256,
    terminalOutcome: terminal.artifactSha256,
  }),
  developmentWindow: Object.freeze({
    startDate: SOURCE_START_DATE,
    endDate: DEVELOPMENT_END_DATE,
    gameCount,
    rawPlateAppearanceCount,
    includedStarterObservationCount: observations.length,
    exclusionReasonCounts: Object.freeze(
      Object.fromEntries(Object.entries(exclusionReasonCounts).sort()),
    ),
  }),
  fixedValidationDesign: Object.freeze({
    fitStartDate: SOURCE_START_DATE,
    fitEndDate: FIXED_FIT_END_DATE,
    validationStartDate: FIXED_VALIDATION_START_DATE,
    validationEndDate: FIXED_VALIDATION_END_DATE,
    fitObservationCount: fixedFitPredictions.length,
    validationObservationCount: fixedValidationPredictions.length,
  }),
  walkForwardDesign: WALK_FORWARD_FOLDS,
  candidateSet: CANDIDATES,
  fixedUnshrunkFit,
  walkForwardUnshrunkFits: Object.freeze(walkForwardUnshrunkFits),
  results: Object.freeze(results),
  fixedNondominatedCandidateIds,
  walkForwardNondominatedCandidateIds,
  selectableCandidateIds: Object.freeze(selectable.map((result) => result.candidateId)),
  selectedCandidate:
    selected === null
      ? null
      : Object.freeze({
          candidateId: selected.candidateId,
          lambda: selected.lambda,
        }),
  observationCounts: Object.freeze({
    development: rawPredictions.length,
    fixedFit: fixedFitPredictions.length,
    fixedValidation: fixedValidationPredictions.length,
    walkForwardValidation: walkForwardCombinedByCandidate['calibration-shrink-000'].length,
  }),
  observationIdsSha256: sha256(JSON.stringify(observationIds)),
  untouchedTestReservation: Object.freeze({
    startDate: UNTOUCHED_START_DATE,
    endDate: UNTOUCHED_END_DATE,
    rowsIncluded: false,
    allowedUse: 'one-time-final-evaluation-after-calibrated-candidate-freeze',
    minimumIncludedStarterObservations: 900,
    minimumActualHitsAbove25: 35,
  }),
};
const evaluation = Object.freeze({
  ...evaluationBase,
  evaluationSha256: sha256(JSON.stringify(evaluationIdentity(evaluationBase))),
});
await writeJsonAtomic(EVALUATION_OUTPUT_PATH, evaluation);

console.log('=== M9 BATTER HITS TAIL CALIBRATION EVALUATION ===');
console.log(`Development observations: ${rawPredictions.length}`);
console.log(`Fixed validation observations: ${fixedValidationPredictions.length}`);
console.log(`Fixed unshrunk delta: ${fixedUnshrunkFit.delta}`);
console.log(`Fixed nondominated: ${fixedNondominatedCandidateIds.join(', ')}`);
console.log(`Walk-forward nondominated: ${walkForwardNondominatedCandidateIds.join(', ')}`);
console.log(`Selectable: ${evaluation.selectableCandidateIds.join(', ') || 'NONE'}`);
console.log(`Evaluation SHA-256: ${evaluation.evaluationSha256}`);
console.log(`Evaluation artifact: ${EVALUATION_OUTPUT_PATH}`);
for (const result of results) {
  console.log(
    JSON.stringify({
      candidateId: result.candidateId,
      lambda: result.lambda,
      selectable: result.selectable,
      fixedMetrics: result.fixed.metrics,
      walkForwardMetrics: result.walkForward.metrics,
      fixedLineGates: result.fixedLineGates,
      walkForwardLineGates: result.walkForwardLineGates,
    }),
  );
}

if (selected === null) {
  console.error('No nonzero tail-calibration candidate passed the frozen selection rule.');
  process.exitCode = 1;
} else {
  const finalFitPredictions = predictionsInWindow(
    rawPredictions,
    SOURCE_START_DATE,
    DEVELOPMENT_END_DATE,
  );
  const finalUnshrunkFit = fitSharedTailLogitIntercept(finalFitPredictions);
  const appliedDelta = selected.lambda * finalUnshrunkFit.delta;
  const finalFitObservationIdsSha256 = sha256(
    JSON.stringify(finalFitPredictions.map((prediction) => prediction.observationId)),
  );
  const candidateBase = {
    artifactVersion: 1,
    modelVersion: 'm9-batter-hits-tail-calibrated-candidate-v1',
    status: 'frozen-current-season-calibrated-candidate-awaiting-untouched-test',
    productionEnabled: false,
    activeSeason: ACTIVE_SEASON,
    baseCandidateVersion: baseCandidate.modelVersion,
    baseCandidateSha256: baseCandidate.artifactSha256,
    sourceSharedEnvironmentArtifactSha256: shared.artifactSha256,
    sourceStarterRetentionArtifactSha256: retention.artifactSha256,
    sourceTerminalOutcomeArtifactSha256: terminal.artifactSha256,
    sourceCalibrationEvaluationSha256: evaluation.evaluationSha256,
    calibration: Object.freeze({
      method: 'shared-logit-intercept-v1',
      fitThresholds: Object.freeze([1, 2, 3]),
      selectedCandidateId: selected.candidateId,
      shrinkageMultiplier: selected.lambda,
      finalUnshrunkDelta: finalUnshrunkFit.delta,
      appliedDelta,
      finalFitSha256: finalUnshrunkFit.fitSha256,
      exactEndpointsPreserved: true,
      monotoneTailTransform: true,
      coherentPmfReconstruction: true,
    }),
    finalFitWindow: Object.freeze({
      startDate: SOURCE_START_DATE,
      endDate: DEVELOPMENT_END_DATE,
      observationCount: finalFitPredictions.length,
    }),
    finalFitObservationIdsSha256,
    untouchedTestReservation: evaluation.untouchedTestReservation,
  };
  const frozenCandidate = Object.freeze({
    purpose:
      'Frozen current-season Batter Hits candidate adding one validated monotone tail-calibration layer to the coherent base distribution.',
    ...candidateBase,
    artifactSha256: sha256(JSON.stringify(candidateIdentity(candidateBase))),
  });
  await writeJsonAtomic(CANDIDATE_OUTPUT_PATH, frozenCandidate);
  console.log(`Selected candidate: ${selected.candidateId}`);
  console.log(`Selected lambda: ${selected.lambda}`);
  console.log(`Final unshrunk delta: ${finalUnshrunkFit.delta}`);
  console.log(`Applied delta: ${appliedDelta}`);
  console.log(`Candidate SHA-256: ${frozenCandidate.artifactSha256}`);
  console.log(`Candidate artifact: ${CANDIDATE_OUTPUT_PATH}`);
  console.log('Production enabled: false');
  console.log('July 26–31 outcomes accessed: false');
}