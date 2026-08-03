import { readFile } from 'node:fs/promises';

import {
  createM8_5ParkFactorArtifactV1,
  createValidatedM8_5BatterHitsFactorArtifactV1,
  verifyM8_5ParkFactorArtifactV1,
} from '../dist/src/features/batter-hits/index.js';
import {
  factorEffectsAndIndexForM8_5ParkModel,
} from './m8-5-park-factor-artifact-utils.mjs';
import {
  buildM8_5ParkEvaluationDataset,
  evaluateM8_5ParkCandidates,
} from './m8-5-park-model-utils.mjs';
import { sha256, writeJsonAtomic } from './provider-probe-utils.mjs';

function requireEnvironmentValue(name) {
  const value = process.env[name]?.trim();
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

async function readJson(path, label) {
  const text = await readFile(path, 'utf8');
  try {
    return { path, text, value: JSON.parse(text) };
  } catch {
    throw new Error(`${label} is not valid JSON.`);
  }
}

const resolvedPath = requireEnvironmentValue(
  'M8_RESOLVED_CATEGORICAL_DATASET_PATH',
);
const venueAuditPath = requireEnvironmentValue(
  'M8_5_PARK_VENUE_AUDIT_PATH',
);
const frozenBaseParityPath = requireEnvironmentValue(
  'M8_5_PARK_FROZEN_BASE_PREDICTIONS_PATH',
);
const datasetOutputPath = requireEnvironmentValue(
  'M8_5_PARK_EVALUATION_DATASET_OUTPUT_PATH',
);
const evaluationOutputPath = requireEnvironmentValue(
  'M8_5_PARK_EVALUATION_OUTPUT_PATH',
);
const factorOutputPath = requireEnvironmentValue(
  'M8_5_PARK_FACTOR_OUTPUT_PATH',
);

const [resolved, venueAudit, frozenBaseParity] = await Promise.all([
  readJson(resolvedPath, 'resolved categorical dataset'),
  readJson(venueAuditPath, 'park venue audit'),
  readJson(frozenBaseParityPath, 'park frozen-base parity'),
]);

const dataset = buildM8_5ParkEvaluationDataset({
  resolvedDataset: resolved.value,
  venueAudit: venueAudit.value,
  frozenBaseParity: frozenBaseParity.value,
});
const evaluation = evaluateM8_5ParkCandidates({ dataset });

await writeJsonAtomic(datasetOutputPath, dataset);
await writeJsonAtomic(evaluationOutputPath, evaluation);

const [writtenDataset, writtenEvaluation] = await Promise.all([
  readJson(datasetOutputPath, 'written park evaluation dataset'),
  readJson(evaluationOutputPath, 'written park evaluation'),
]);
if (writtenDataset.value.datasetSha256 !== dataset.datasetSha256) {
  throw new Error('written park evaluation dataset identity changed.');
}
if (writtenEvaluation.value.evaluationSha256 !== evaluation.evaluationSha256) {
  throw new Error('written park evaluation identity changed.');
}

let factorArtifact = null;
let factorMapping = null;
let factorFileSha256 = null;
if (evaluation.decision === 'VALIDATED_PARK_SIGNAL') {
  if (evaluation.selectedModel === null) {
    throw new Error('validated park signal is missing its selected model.');
  }
  factorMapping = factorEffectsAndIndexForM8_5ParkModel(
    evaluation.selectedModel,
  );
  const typedFactorArtifact = createValidatedM8_5BatterHitsFactorArtifactV1({
    factorKey: 'park',
    modelVersion: evaluation.selectedModel.modelVersion,
    requiredInputs: [
      'exactProviderVenue',
      'batterHand',
      'frozenBaseTerminalOutcomeProbabilities',
    ],
    sourceEvidenceVersion: 'm8-5-park-evaluation-v1',
    validationEvidence: {
      fitPeriod: {
        start: dataset.periods.fit.startDate,
        end: dataset.periods.fit.endDate,
      },
      validationPeriod: {
        start: dataset.periods.validation.startDate,
        end: dataset.periods.validation.endDate,
      },
      walkForwardEvaluated: true,
      untouchedRowsIncluded: false,
      evidenceArtifactSha256: evaluation.evaluationSha256,
    },
    effects: factorMapping.effects,
  });
  factorArtifact = createM8_5ParkFactorArtifactV1({
    sourceVenueAuditSha256: dataset.sourceVenueAuditSha256,
    sourceEvaluationDatasetSha256: dataset.datasetSha256,
    sourceEvaluationSha256: evaluation.evaluationSha256,
    sourceFrozenBaseParitySha256: dataset.sourceFrozenBaseParitySha256,
    sourceFrozenPredictionSha256:
      dataset.sourceFrozenValidationPredictionSha256,
    typedFactorArtifact,
    effectIdentities: factorMapping.effectIdentities,
  });
  await writeJsonAtomic(factorOutputPath, factorArtifact);
  const persistedFactor = await readJson(
    factorOutputPath,
    'written park factor artifact',
  );
  verifyM8_5ParkFactorArtifactV1(persistedFactor.value);
  if (
    persistedFactor.value.parkArtifactSha256 !==
    factorArtifact.parkArtifactSha256
  ) {
    throw new Error('written park factor artifact identity changed.');
  }
  factorFileSha256 = sha256(persistedFactor.text);
} else if (
  evaluation.decision !== 'IDENTITY_RETAINED_NO_VALIDATED_PARK_SIGNAL'
) {
  throw new Error(`unsupported park evaluation decision ${evaluation.decision}.`);
}

console.log('=== M8.5 PARK MODEL EVALUATION COMPLETE ===');
console.log(`Resolved dataset: ${resolvedPath}`);
console.log(`Venue audit: ${venueAuditPath}`);
console.log(`Frozen-base parity: ${frozenBaseParityPath}`);
console.log(`Park fit observations: ${dataset.periods.fit.rowCount}`);
console.log(`Park validation observations: ${dataset.periods.validation.rowCount}`);
console.log(`Exact venues: ${dataset.venues.length}`);
console.log(`Excluded missing-hand rows: ${dataset.exclusions.length}`);
console.log(`Decision: ${evaluation.decision}`);
console.log(`Selected candidate: ${evaluation.selectedCandidateId ?? 'none'}`);
console.log(
  `Identity fixed categorical log loss: ${evaluation.identityFixedMetrics.categoricalLogLoss}`,
);
console.log(
  `Identity fixed Hit log loss: ${evaluation.identityFixedMetrics.hitLogLoss}`,
);
console.log(
  `Identity walk-forward categorical log loss: ${evaluation.identityWalkForwardMetrics.categoricalLogLoss}`,
);
console.log(
  `Identity walk-forward Hit log loss: ${evaluation.identityWalkForwardMetrics.hitLogLoss}`,
);
if (evaluation.selectedFixedMetrics !== null) {
  console.log(
    `Selected fixed categorical log loss: ${evaluation.selectedFixedMetrics.categoricalLogLoss}`,
  );
  console.log(
    `Selected fixed Hit log loss: ${evaluation.selectedFixedMetrics.hitLogLoss}`,
  );
  console.log(
    `Selected walk-forward categorical log loss: ${evaluation.selectedWalkForwardMetrics.categoricalLogLoss}`,
  );
  console.log(
    `Selected walk-forward Hit log loss: ${evaluation.selectedWalkForwardMetrics.hitLogLoss}`,
  );
}
console.log(`Dataset SHA-256: ${dataset.datasetSha256}`);
console.log(`Evaluation SHA-256: ${evaluation.evaluationSha256}`);
console.log(`Dataset output: ${datasetOutputPath}`);
console.log(`Evaluation output: ${evaluationOutputPath}`);
console.log(
  `Factor artifact: ${factorArtifact === null ? 'not-created-identity-retained' : factorOutputPath}`,
);
if (factorArtifact !== null && factorMapping !== null) {
  console.log(
    `Typed factor artifact SHA-256: ${factorArtifact.typedFactorArtifact.artifactSha256}`,
  );
  console.log(`Park artifact SHA-256: ${factorArtifact.parkArtifactSha256}`);
  console.log(`Park artifact file SHA-256: ${factorFileSha256}`);
  console.log(`Typed venue-hand effects: ${factorMapping.effectCount}`);
}
console.log('Park transformation applied to validation scoring: true');
console.log('Provider venue text preserved exactly: true');
console.log('Home-team venue inference used: false');
console.log('Venue alias merging used: false');
console.log('Selected-side input used: false');
console.log('Direct probability adjustment used: false');
console.log('Prior-season rows used: false');
console.log('Production enabled: false');
console.log('Ranking enabled: false');
console.log('Untouched-test rows accessed: false');
