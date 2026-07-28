import { readFile } from 'node:fs/promises';

import { sha256 } from './provider-probe-utils.mjs';
import { assertCurrentSeasonDate } from './m8-recency-weighting-utils.mjs';

const SHA256_PATTERN = /^[a-f0-9]{64}$/;
const INCLUDED_PERIODS = Object.freeze(['fit', 'validation']);
const HIT_TERMINAL_CATEGORIES = new Set(['1B', '2B', '3B', 'HR']);
const CONTEXTUAL_NON_HIT_RESULTS = new Set([
  'Fielders Choice',
  'Fielders Choice Out',
  'Forceout',
  'Double Play',
  'Triple Play',
]);
const EXCLUDED_UNRESOLVED_REASONS = new Set([
  'missing-result',
  'unknown-result',
  'context-contradiction',
]);

function assertPlainObject(value, label) {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new TypeError(`${label} must be an object.`);
  }
  return value;
}

function assertArray(value, label) {
  if (!Array.isArray(value)) {
    throw new TypeError(`${label} must be an array.`);
  }
  return value;
}

function assertNonEmptyString(value, label) {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new TypeError(`${label} must be a non-empty string.`);
  }
  return value.trim();
}

function assertNullableNonEmptyString(value, label) {
  return value === null ? null : assertNonEmptyString(value, label);
}

function assertInteger(value, label) {
  if (!Number.isSafeInteger(value)) {
    throw new TypeError(`${label} must be an integer.`);
  }
  return value;
}

function assertNonNegativeInteger(value, label) {
  const integer = assertInteger(value, label);
  if (integer < 0) {
    throw new RangeError(`${label} must be non-negative.`);
  }
  return integer;
}

function assertBoolean(value, label) {
  if (typeof value !== 'boolean') {
    throw new TypeError(`${label} must be a boolean.`);
  }
  return value;
}

function assertSha256(value, label) {
  if (typeof value !== 'string' || !SHA256_PATTERN.test(value)) {
    throw new TypeError(`${label} must be a lowercase SHA-256 digest.`);
  }
  return value;
}

function parseJson(text, label) {
  try {
    return JSON.parse(text);
  } catch {
    throw new Error(`${label} is not valid JSON.`);
  }
}

function sourceDatasetIdentity(dataset) {
  return {
    activeSeason: dataset.activeSeason,
    sourcePartitionSha256: dataset.sourcePartitionSha256,
    sourceEvidenceSetSha256: dataset.sourceEvidenceSetSha256,
    periods: dataset.periods,
    untouchedTestReservation: dataset.untouchedTestReservation,
  };
}

function validateSourceDataset(dataset, sourceText) {
  const value = assertPlainObject(dataset, 'M8 recency evaluation dataset');
  if (value.datasetVersion !== 2) {
    throw new RangeError('source datasetVersion must equal 2.');
  }
  const activeSeason = assertInteger(value.activeSeason, 'activeSeason');
  assertSha256(value.sourcePartitionSha256, 'sourcePartitionSha256');
  assertSha256(value.sourceEvidenceSetSha256, 'sourceEvidenceSetSha256');
  const periods = assertPlainObject(value.periods, 'periods');
  const untouchedTestReservation = assertPlainObject(
    value.untouchedTestReservation,
    'untouchedTestReservation',
  );
  if (untouchedTestReservation.rowsIncluded !== false) {
    throw new Error('untouched test rows must remain excluded.');
  }
  if (Object.hasOwn(untouchedTestReservation, 'rows')) {
    throw new Error('untouched test reservation must not contain rows.');
  }
  assertNonNegativeInteger(
    untouchedTestReservation.plateAppearanceCount,
    'untouchedTestReservation.plateAppearanceCount',
  );

  const internalSha = assertSha256(value.datasetSha256, 'datasetSha256');
  const recomputedSha = sha256(JSON.stringify(sourceDatasetIdentity(value)));
  if (internalSha !== recomputedSha) {
    throw new Error('source dataset internal SHA-256 does not match its identity.');
  }

  const totals = assertPlainObject(value.totals, 'totals');
  assertNonNegativeInteger(totals.includedRowCount, 'totals.includedRowCount');

  return Object.freeze({
    value,
    activeSeason,
    periods,
    untouchedTestReservation,
    sourceDatasetFileSha256: sha256(sourceText),
  });
}

function observationCommon(row, activeSeason, label) {
  const value = assertPlainObject(row, label);
  const observationId = assertNonEmptyString(value.rowId, `${label}.rowId`);
  const observedDate = assertNonEmptyString(
    value.observedDate,
    `${label}.observedDate`,
  );
  assertCurrentSeasonDate(observedDate, activeSeason, `${label}.observedDate`);
  return Object.freeze({
    observationId,
    observedDate,
    providerGameId: assertInteger(
      value.providerGameId,
      `${label}.providerGameId`,
    ),
    providerPaNumber: assertInteger(
      value.providerPaNumber,
      `${label}.providerPaNumber`,
    ),
    providerBatterId: assertInteger(
      value.providerBatterId,
      `${label}.providerBatterId`,
    ),
    providerPitcherId: assertInteger(
      value.providerPitcherId,
      `${label}.providerPitcherId`,
    ),
    rawBatterSide: assertNonEmptyString(
      value.rawBatterSide,
      `${label}.rawBatterSide`,
    ),
    rawPitcherHand: assertNonEmptyString(
      value.rawPitcherHand,
      `${label}.rawPitcherHand`,
    ),
    rawResult: assertNullableNonEmptyString(
      value.rawResult,
      `${label}.rawResult`,
    ),
    sourceSnapshotPath: assertNonEmptyString(
      value.sourceSnapshotPath,
      `${label}.sourceSnapshotPath`,
    ),
    sourceSnapshotSha256: assertSha256(
      value.sourceSnapshotSha256,
      `${label}.sourceSnapshotSha256`,
    ),
  });
}

function classifiedObservation(row, common, label) {
  const terminalCategory = assertNonEmptyString(
    row.terminalCategory,
    `${label}.terminalCategory`,
  );
  if (row.unresolvedReason !== null) {
    throw new Error(`${label} classified terminal row cannot be unresolved.`);
  }
  if (assertBoolean(row.includedInOverallOutcomeModel, `${label}.includedInOverallOutcomeModel`) !== true) {
    throw new Error(`${label} classified terminal row must be overall eligible.`);
  }
  const platoonEligible = assertBoolean(
    row.includedInPlatoonModel,
    `${label}.includedInPlatoonModel`,
  );

  return Object.freeze({
    ...common,
    hit: HIT_TERMINAL_CATEGORIES.has(terminalCategory) ? 1 : 0,
    labelSource: 'canonical-terminal-category',
    terminalCategory,
    platoonEligible,
  });
}

function contextualNonHitObservation(row, common, label) {
  if (row.unresolvedReason !== 'context-required') {
    throw new Error(`${label} must be context-required.`);
  }
  if (
    common.rawResult === null ||
    !CONTEXTUAL_NON_HIT_RESULTS.has(common.rawResult)
  ) {
    throw new Error(
      `${label} context-required result is not verified as binary No Hit.`,
    );
  }
  if (row.terminalCategory !== null) {
    throw new Error(`${label} contextual benchmark row cannot invent a terminal category.`);
  }

  return Object.freeze({
    ...common,
    hit: 0,
    labelSource: 'verified-contextual-non-hit-result',
    terminalCategory: null,
    platoonEligible: false,
  });
}

function excludedObservation(row, common, label) {
  if (row.mappingStatus === 'baserunning-only') {
    return Object.freeze({
      ...common,
      exclusionReason: 'baserunning-only',
    });
  }

  if (row.mappingStatus !== 'unresolved') {
    throw new Error(`${label} has unsupported mappingStatus: ${row.mappingStatus}.`);
  }
  const reason = assertNonEmptyString(
    row.unresolvedReason,
    `${label}.unresolvedReason`,
  );
  if (!EXCLUDED_UNRESOLVED_REASONS.has(reason)) {
    throw new Error(`${label} has unsupported unresolved reason: ${reason}.`);
  }
  return Object.freeze({
    ...common,
    exclusionReason: reason,
  });
}

function mapPeriod(periodId, rawPeriod, activeSeason, seenObservationIds) {
  const period = assertPlainObject(rawPeriod, `periods.${periodId}`);
  const rows = assertArray(period.rows, `periods.${periodId}.rows`);
  const expectedRowCount = assertNonNegativeInteger(
    period.rowCount,
    `periods.${periodId}.rowCount`,
  );
  if (rows.length !== expectedRowCount) {
    throw new Error(`${periodId} rowCount does not match its rows.`);
  }

  const observations = [];
  const exclusions = [];

  for (const [index, rawRow] of rows.entries()) {
    const label = `periods.${periodId}.rows[${index}]`;
    const row = assertPlainObject(rawRow, label);
    const common = observationCommon(row, activeSeason, label);
    if (seenObservationIds.has(common.observationId)) {
      throw new Error(`duplicate observationId: ${common.observationId}.`);
    }
    seenObservationIds.add(common.observationId);

    if (row.mappingStatus === 'classified-terminal') {
      observations.push(classifiedObservation(row, common, label));
      continue;
    }
    if (
      row.mappingStatus === 'unresolved' &&
      row.unresolvedReason === 'context-required'
    ) {
      observations.push(contextualNonHitObservation(row, common, label));
      continue;
    }
    exclusions.push(excludedObservation(row, common, label));
  }

  observations.sort((left, right) =>
    left.observedDate.localeCompare(right.observedDate) ||
    left.providerGameId - right.providerGameId ||
    left.providerPaNumber - right.providerPaNumber,
  );
  exclusions.sort((left, right) =>
    left.observedDate.localeCompare(right.observedDate) ||
    left.providerGameId - right.providerGameId ||
    left.providerPaNumber - right.providerPaNumber,
  );

  const hitCount = observations.reduce(
    (count, observation) => count + observation.hit,
    0,
  );
  const contextualNonHitCount = observations.filter(
    (observation) =>
      observation.labelSource === 'verified-contextual-non-hit-result',
  ).length;
  const platoonEligibleCount = observations.filter(
    (observation) => observation.platoonEligible,
  ).length;
  if (observations.length + exclusions.length !== rows.length) {
    throw new Error(`${periodId} benchmark accounting does not conserve rows.`);
  }

  return Object.freeze({
    startDate: assertNonEmptyString(
      period.startDate,
      `periods.${periodId}.startDate`,
    ),
    endDate: assertNonEmptyString(
      period.endDate,
      `periods.${periodId}.endDate`,
    ),
    sourceRowCount: rows.length,
    observationCount: observations.length,
    hitCount,
    noHitCount: observations.length - hitCount,
    contextualNonHitCount,
    platoonEligibleCount,
    excludedCount: exclusions.length,
    observations: Object.freeze(observations),
    exclusions: Object.freeze(exclusions),
  });
}

function sumPeriods(periods, key) {
  return periods.fit[key] + periods.validation[key];
}

export async function buildM8HitBenchmarkDataset({ sourceDatasetPath }) {
  const inputPath = assertNonEmptyString(
    sourceDatasetPath,
    'sourceDatasetPath',
  );
  const sourceText = await readFile(inputPath, 'utf8');
  const source = validateSourceDataset(
    parseJson(sourceText, 'M8 recency evaluation dataset'),
    sourceText,
  );

  const periods = {};
  const seenObservationIds = new Set();
  for (const periodId of INCLUDED_PERIODS) {
    periods[periodId] = mapPeriod(
      periodId,
      source.periods[periodId],
      source.activeSeason,
      seenObservationIds,
    );
  }

  const sourceRowCount = sumPeriods(periods, 'sourceRowCount');
  if (sourceRowCount !== source.value.totals.includedRowCount) {
    throw new Error('benchmark source-row total drifted from source dataset totals.');
  }

  const benchmarkIdentity = {
    activeSeason: source.activeSeason,
    sourceDatasetSha256: source.value.datasetSha256,
    sourceDatasetFileSha256: source.sourceDatasetFileSha256,
    sourcePartitionSha256: source.value.sourcePartitionSha256,
    sourceEvidenceSetSha256: source.value.sourceEvidenceSetSha256,
    periods,
    untouchedTestReservation: {
      startDate: source.untouchedTestReservation.startDate,
      endDate: source.untouchedTestReservation.endDate,
      plateAppearanceCount:
        source.untouchedTestReservation.plateAppearanceCount,
      rowsIncluded: false,
    },
  };

  return Object.freeze({
    benchmarkVersion: 1,
    purpose:
      'Provide a deterministic current-season Hit-versus-No-Hit benchmark for recency evaluation without assigning unresolved contextual rows to a canonical terminal category.',
    ...benchmarkIdentity,
    totals: Object.freeze({
      sourceRowCount,
      observationCount: sumPeriods(periods, 'observationCount'),
      hitCount: sumPeriods(periods, 'hitCount'),
      noHitCount: sumPeriods(periods, 'noHitCount'),
      contextualNonHitCount: sumPeriods(periods, 'contextualNonHitCount'),
      platoonEligibleCount: sumPeriods(periods, 'platoonEligibleCount'),
      excludedCount: sumPeriods(periods, 'excludedCount'),
    }),
    benchmarkSha256: sha256(JSON.stringify(benchmarkIdentity)),
  });
}
