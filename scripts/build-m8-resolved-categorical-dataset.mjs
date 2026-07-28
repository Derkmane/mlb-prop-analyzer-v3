import { readFile } from 'node:fs/promises';

import { sha256, writeJsonAtomic } from './provider-probe-utils.mjs';
import { buildM8ResolvedCategoricalDataset } from './m8-resolved-categorical-dataset-utils.mjs';

function requireEnvironmentValue(name) {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`Missing required environment variable: ${name}`);
  return value;
}

const datasetPath = requireEnvironmentValue('M8_RECENCY_DATASET_PATH');
const resolutionPath = requireEnvironmentValue(
  'M8_CONTEXT_TERMINAL_RESOLUTION_PATH',
);
const outputPath = requireEnvironmentValue(
  'M8_RESOLVED_CATEGORICAL_DATASET_OUTPUT_PATH',
);

const datasetText = await readFile(datasetPath, 'utf8');
const resolutionText = await readFile(resolutionPath, 'utf8');
const dataset = JSON.parse(datasetText);
const resolution = JSON.parse(resolutionText);
const resolvedDataset = buildM8ResolvedCategoricalDataset({
  dataset,
  resolution,
  sourceDatasetFileSha256: sha256(datasetText),
  sourceResolutionFileSha256: sha256(resolutionText),
});
await writeJsonAtomic(outputPath, resolvedDataset);

console.log('=== M8 RESOLVED CATEGORICAL DATASET ===');
console.log(`Output: ${outputPath}`);
console.log(`Source dataset SHA-256: ${resolvedDataset.sourceDatasetSha256}`);
console.log(`Source resolution SHA-256: ${resolvedDataset.sourceResolutionSha256}`);
console.log(`Fit rows: ${resolvedDataset.periods.fit.rowCount}`);
console.log(`Validation rows: ${resolvedDataset.periods.validation.rowCount}`);
console.log(`Fit + validation rows conserved: ${resolvedDataset.totals.includedRowCount}`);
console.log(
  `Context resolution applied: ${resolvedDataset.totals.contextResolutionAppliedCount}`,
);
console.log(
  `Resolved contextual terminal rows: ${resolvedDataset.totals.resolvedContextTerminalCount}`,
);
console.log(
  `Resolved contextual baserunning rows: ${resolvedDataset.totals.resolvedContextBaserunningCount}`,
);
console.log(
  `Remaining contextual unresolved rows: ${resolvedDataset.totals.remainingContextUnresolvedCount}`,
);
console.log(`Classified terminal total: ${resolvedDataset.totals.classifiedTerminalCount}`);
console.log(`Baserunning-only total: ${resolvedDataset.totals.baserunningOnlyCount}`);
console.log(`Unresolved total: ${resolvedDataset.totals.unresolvedCount}`);
console.log(`Platoon eligible: ${resolvedDataset.totals.platoonEligibleCount}`);
console.log(
  `Terminal but platoon ineligible: ${resolvedDataset.totals.platoonIneligibleTerminalCount}`,
);
console.log(
  `Terminal categories: ${JSON.stringify(resolvedDataset.totals.terminalCategoryCounts)}`,
);
console.log(
  `Untouched test sealed: ${resolvedDataset.untouchedTestReservation.startDate} through ${resolvedDataset.untouchedTestReservation.endDate} — ${resolvedDataset.untouchedTestReservation.plateAppearanceCount} rows excluded`,
);
console.log(`Resolved dataset SHA-256: ${resolvedDataset.datasetSha256}`);
