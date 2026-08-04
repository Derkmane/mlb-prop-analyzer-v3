import { createHash } from 'node:crypto';

import {
  buildM8_5ParkFrozenBasePredictions,
  M8_5_PARK_FROZEN_BASE_EXPECTED,
} from './m8-5-park-frozen-base-prediction-utils.mjs';
import {
  selectCanonicalM8_5ParkCandidate,
} from './m8-5-park-candidate-selection-utils.mjs';
import { verifyM8_5ParkVenueEvidenceAudit } from './m8-5-park-venue-evidence-utils.mjs';

const HANDS = Object.freeze(['L', 'R', 'S']);
const HIT_CATEGORIES = Object.freeze(['1B', '2B', '3B', 'HR']);
const TOLERANCE = 1e-12;
const PROBABILITY_FLOOR = 1e-300;
const MIN_PARK_FIT_DATE_COUNT = 14;
const INITIAL_SEED_DATE_FRACTION = 0.7;

export const DEFAULT_M8_5_PARK_CANDIDATES = Object.freeze(
  [25, 50, 100, 250, 500, 1000, 2500].map((equivalentPa) =>
    Object.freeze({
      candidateId: `venue-hand-pool-${equivalentPa}`,
      equivalentPa,
    }),
  ),
);

function sha256(value) {
  return createHash('sha256').update(value).digest('hex');
}

function object(value, label) {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new TypeError(`${label} must be an object.`);
  }
  return value;
}

function array(value, label) {
  if (!Array.isArray(value)) {
    throw new TypeError(`${label} must be an array.`);
  }
  return value;
}

function string(value, label) {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new TypeError(`${label} must be a non-empty string.`);
  }
  return value.trim();
}

function positiveInteger(value, label) {
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new TypeError(`${label} must be a positive integer.`);
  }
  return value;
}

function positiveFinite(value, label) {
  if (!Number.isFinite(value) || value <= 0) {
    throw new TypeError(`${label} must be positive and finite.`);
  }
  return value;
}

function sha256Text(value, label) {
  const text = string(value, label);
  if (!/^[a-f0-9]{64}$/u.test(text)) {
    throw new TypeError(`${label} must be a lowercase SHA-256 value.`);
  }
  return text;
}

function assertUntouchedSealed(value, label) {
  const reservation = object(value, label);
  if (reservation.rowsIncluded !== false || Object.hasOwn(reservation, 'rows')) {
    throw new Error(`${label} must keep untouched-test rows excluded.`);
  }
  return reservation;
}

function probabilityVector(raw, categories, label) {
  const value = object(raw, label);
  const keys = Object.keys(value);
  if (JSON.stringify(keys) !== JSON.stringify(categories)) {
    throw new Error(`${label} category order or coverage drifted.`);
  }
  let total = 0;
  const result = {};
  for (const category of categories) {
    const probability = value[category];
    if (!Number.isFinite(probability) || probability < 0 || probability > 1) {
      throw new RangeError(`${label}.${category} must be in [0,1].`);
    }
    result[category] = probability;
    total += probability;
  }
  if (Math.abs(total - 1) > TOLERANCE) {
    throw new Error(`${label} must sum to one.`);
  }
  return Object.freeze(result);
}

function parseResolvedObservations(rawDataset) {
  const dataset = object(rawDataset, 'resolved categorical dataset');
  if (dataset.datasetVersion !== 3 || dataset.activeSeason !== 2026) {
    throw new Error('resolved categorical dataset must be active-season version 3.');
  }
  assertUntouchedSealed(
    dataset.untouchedTestReservation,
    'resolved dataset untouched reservation',
  );
  const periods = object(dataset.periods, 'resolved dataset periods');
  const result = {};
  const seen = new Set();
  for (const periodId of ['fit', 'validation']) {
    const rows = array(object(periods[periodId], `${periodId} period`).rows, `${periodId} rows`);
    const observations = [];
    for (const [index, rawRow] of rows.entries()) {
      const row = object(rawRow, `${periodId} row ${index}`);
      if (row.mappingStatus !== 'classified-terminal') continue;
      if (row.includedInOverallOutcomeModel !== true) {
        throw new Error(`${periodId} classified row ${index} is not overall eligible.`);
      }
      const observationId = string(row.rowId, `${periodId} rowId`);
      if (seen.has(observationId)) {
        throw new Error(`duplicate resolved observation ${observationId}.`);
      }
      seen.add(observationId);
      const normalizedBatterSide = row.normalizedBatterSide === 'L' || row.normalizedBatterSide === 'R'
        ? row.normalizedBatterSide
        : null;
      const normalizedPitcherHand = row.normalizedPitcherHand === 'L' || row.normalizedPitcherHand === 'R'
        ? row.normalizedPitcherHand
        : null;
      const platoonEligible = row.includedInPlatoonModel === true;
      if (platoonEligible !== (normalizedBatterSide !== null && normalizedPitcherHand !== null)) {
        throw new Error(`${observationId} platoon eligibility drifted.`);
      }
      const rawBatterHand = HANDS.includes(row.rawBatterSide)
        ? row.rawBatterSide
        : normalizedBatterSide;
      observations.push(
        Object.freeze({
          observationId,
          observedDate: string(row.observedDate, `${observationId}.observedDate`),
          providerGameId: positiveInteger(
            row.providerGameId,
            `${observationId}.providerGameId`,
          ),
          providerBatterId: positiveInteger(
            row.providerBatterId,
            `${observationId}.providerBatterId`,
          ),
          providerPitcherId: positiveInteger(
            row.providerPitcherId,
            `${observationId}.providerPitcherId`,
          ),
          terminalCategory: string(
            row.terminalCategory,
            `${observationId}.terminalCategory`,
          ),
          batterHand: HANDS.includes(rawBatterHand) ? rawBatterHand : null,
          normalizedBatterSide,
          normalizedPitcherHand,
          platoonEligible,
        }),
      );
    }
    observations.sort(
      (left, right) =>
        left.observedDate.localeCompare(right.observedDate) ||
        left.providerGameId - right.providerGameId ||
        left.observationId.localeCompare(right.observationId),
    );
    if (observations.length === 0) {
      throw new Error(`${periodId} contains no resolved observations.`);
    }
    result[periodId] = Object.freeze(observations);
  }
  if (result.fit.at(-1).observedDate >= result.validation[0].observedDate) {
    throw new Error('resolved fit and validation chronology overlaps.');
  }
  return Object.freeze({ dataset, periods: Object.freeze(result) });
}

function validateParity(rawParity, dataset, validationObservations) {
  const parity = object(rawParity, 'frozen-base parity');
  if (parity.parityVersion !== 1 || parity.activeSeason !== 2026) {
    throw new Error('frozen-base parity contract is unsupported.');
  }
  if (parity.sourceDatasetSha256 !== dataset.datasetSha256) {
    throw new Error('frozen-base parity does not reference the resolved dataset.');
  }
  if (
    parity.productionEnabled !== false ||
    parity.rankingEnabled !== false ||
    parity.selectedSideInputUsed !== false ||
    parity.directProbabilityAdjustmentUsed !== false ||
    parity.untouchedTestRowsAccessed !== false
  ) {
    throw new Error('frozen-base parity safety boundary is invalid.');
  }
  sha256Text(parity.predictionSha256, 'frozen-base prediction SHA-256');
  sha256Text(parity.paritySha256, 'frozen-base parity SHA-256');
  const predictions = array(parity.predictions, 'frozen-base predictions');
  if (sha256(JSON.stringify(predictions)) !== parity.predictionSha256) {
    throw new Error('frozen-base predictions SHA-256 is invalid.');
  }
  if (predictions.length !== validationObservations.length) {
    throw new Error('frozen-base predictions do not cover the validation cohort.');
  }
  const observationsById = new Map(
    validationObservations.map((observation) => [observation.observationId, observation]),
  );
  let categories = null;
  const normalized = predictions.map((rawPrediction, index) => {
    const prediction = object(rawPrediction, `frozen-base prediction ${index}`);
    if (
      Object.hasOwn(prediction, 'selectedSide') ||
      Object.hasOwn(prediction, 'directProbabilityAdjustment') ||
      Object.hasOwn(prediction, 'probabilityAdjustment')
    ) {
      throw new Error('park source predictions may not contain side or probability shortcuts.');
    }
    const observationId = string(prediction.observationId, `prediction ${index}.observationId`);
    const observation = observationsById.get(observationId);
    if (observation === undefined) {
      throw new Error(`frozen-base prediction ${observationId} is outside validation.`);
    }
    if (
      prediction.providerGameId !== observation.providerGameId ||
      prediction.providerBatterId !== observation.providerBatterId ||
      prediction.providerPitcherId !== observation.providerPitcherId ||
      prediction.observedDate !== observation.observedDate ||
      prediction.terminalCategory !== observation.terminalCategory ||
      prediction.batterHand !== observation.batterHand
    ) {
      throw new Error(`frozen-base prediction ${observationId} identity drifted.`);
    }
    const currentCategories = Object.keys(
      object(prediction.baseProbabilities, `${observationId}.baseProbabilities`),
    );
    categories ??= currentCategories;
    if (JSON.stringify(currentCategories) !== JSON.stringify(categories)) {
      throw new Error('frozen-base prediction category coverage drifted.');
    }
    return Object.freeze({
      ...observation,
      baseProbabilities: probabilityVector(
        prediction.baseProbabilities,
        categories,
        `${observationId}.baseProbabilities`,
      ),
    });
  });
  if (new Set(normalized.map((row) => row.observationId)).size !== normalized.length) {
    throw new Error('frozen-base predictions contain duplicate observations.');
  }
  if (categories === null || categories.length < 2) {
    throw new Error('frozen-base prediction categories are insufficient.');
  }
  return Object.freeze({
    parity,
    categories: Object.freeze(categories),
    predictions: Object.freeze(normalized),
  });
}

function selectedPlatoonCandidate() {
  return Object.freeze({
    candidateId: M8_5_PARK_FROZEN_BASE_EXPECTED.platoonCandidateId,
    leaguePlatoonPriorId:
      M8_5_PARK_FROZEN_BASE_EXPECTED.leaguePlatoonPriorId,
    leaguePlatoonEquivalentPa:
      M8_5_PARK_FROZEN_BASE_EXPECTED.leaguePlatoonEquivalentPa,
    leaguePlatoonExactTarget: false,
    playerSplitPriorId:
      M8_5_PARK_FROZEN_BASE_EXPECTED.playerSplitPriorId,
    playerSplitEquivalentPa:
      M8_5_PARK_FROZEN_BASE_EXPECTED.playerSplitEquivalentPa,
    playerSplitExactTarget: false,
    platoonCoefficient:
      M8_5_PARK_FROZEN_BASE_EXPECTED.platoonCoefficient,
  });
}

function baseParameters() {
  return Object.freeze({
    batterPooling: M8_5_PARK_FROZEN_BASE_EXPECTED.batterPooling,
    pitcherPooling: M8_5_PARK_FROZEN_BASE_EXPECTED.pitcherPooling,
    batterCoefficient: M8_5_PARK_FROZEN_BASE_EXPECTED.batterCoefficient,
    pitcherAllowedCoefficient:
      M8_5_PARK_FROZEN_BASE_EXPECTED.pitcherAllowedCoefficient,
  });
}

function buildChronologicalParkFitPredictions({
  fitObservations,
  categories,
}) {
  const fitDates = [...new Set(fitObservations.map((row) => row.observedDate))].sort();
  if (fitDates.length < MIN_PARK_FIT_DATE_COUNT + 2) {
    throw new Error('fit period has too few dates for a chronological park-training split.');
  }
  const modeledCategories = categories.filter((category) =>
    fitObservations.some((row) => row.terminalCategory === category),
  );
  const initialIndex = Math.max(
    1,
    Math.floor(fitDates.length * INITIAL_SEED_DATE_FRACTION),
  );
  const finalIndex = fitDates.length - MIN_PARK_FIT_DATE_COUNT;
  const failures = [];
  for (let index = initialIndex; index <= finalIndex; index += 1) {
    const parkFitStartDate = fitDates[index];
    const seedRows = fitObservations.filter(
      (row) => row.observedDate < parkFitStartDate,
    );
    const parkFitRows = fitObservations.filter(
      (row) => row.observedDate >= parkFitStartDate,
    );
    try {
      const built = buildM8_5ParkFrozenBasePredictions({
        fitObservations: seedRows,
        validationObservations: parkFitRows,
        modeledCategories,
        canonicalCategories: categories,
        hitCategories: HIT_CATEGORIES,
        baseParameters: baseParameters(),
        platoonCandidate: selectedPlatoonCandidate(),
      });
      return Object.freeze({
        splitPolicy: Object.freeze({
          mode: 'earliest-support-valid-cutoff-at-or-after-70-percent-of-fit-dates',
          initialSeedDateFraction: INITIAL_SEED_DATE_FRACTION,
          minimumParkFitDateCount: MIN_PARK_FIT_DATE_COUNT,
          seedStartDate: seedRows[0].observedDate,
          seedEndDate: seedRows.at(-1).observedDate,
          parkFitStartDate,
          parkFitEndDate: parkFitRows.at(-1).observedDate,
          seedObservationCount: seedRows.length,
          parkFitObservationCount: parkFitRows.length,
          attemptedCutoffCount: failures.length + 1,
        }),
        predictions: built.predictions,
        predictionSha256: built.predictionSha256,
      });
    } catch (error) {
      failures.push(
        Object.freeze({
          parkFitStartDate,
          reason: error instanceof Error ? error.message : String(error),
        }),
      );
    }
  }
  throw new Error(
    `no support-valid chronological park-training split was found: ${JSON.stringify(failures)}`,
  );
}

function venueMap(rawAudit) {
  const audit = verifyM8_5ParkVenueEvidenceAudit(rawAudit);
  if (audit.decision !== 'VENUE_IDENTITY_AVAILABLE') {
    throw new Error('park evaluation requires VENUE_IDENTITY_AVAILABLE evidence.');
  }
  const map = new Map();
  for (const rawGame of array(audit.games, 'park venue audit games')) {
    const game = object(rawGame, 'park venue game');
    const gameId = positiveInteger(game.gameId, 'park venue gameId');
    if (map.has(gameId)) {
      throw new Error(`duplicate venue game ${gameId}.`);
    }
    map.set(gameId, string(game.venue, `venue game ${gameId}`));
  }
  return Object.freeze({
    audit,
    map,
    venues: Object.freeze(
      array(audit.venueCounts, 'park venueCounts')
        .map((entry) => string(object(entry, 'venue count').venue, 'venue count venue'))
        .sort((left, right) => left.localeCompare(right)),
    ),
  });
}

function rowFromPrediction(rawPrediction, periodId, venues, categories) {
  const prediction = object(rawPrediction, `${periodId} prediction`);
  if (
    Object.hasOwn(prediction, 'selectedSide') ||
    Object.hasOwn(prediction, 'directProbabilityAdjustment') ||
    Object.hasOwn(prediction, 'probabilityAdjustment')
  ) {
    throw new Error('park predictions may not contain side or direct probability fields.');
  }
  const providerGameId = positiveInteger(
    prediction.providerGameId,
    `${periodId} providerGameId`,
  );
  const venue = venues.map.get(providerGameId);
  if (venue === undefined) {
    throw new Error(`park prediction game ${providerGameId} lacks exact venue evidence.`);
  }
  const batterHand = HANDS.includes(prediction.batterHand)
    ? prediction.batterHand
    : null;
  return Object.freeze({
    rowId: string(prediction.observationId, `${periodId} observationId`),
    periodId,
    observedDate: string(prediction.observedDate, `${periodId} observedDate`),
    gameId: providerGameId,
    providerBatterId: positiveInteger(
      prediction.providerBatterId,
      `${periodId} providerBatterId`,
    ),
    providerPitcherId: positiveInteger(
      prediction.providerPitcherId,
      `${periodId} providerPitcherId`,
    ),
    venue,
    batterHand,
    terminalCategory: string(
      prediction.terminalCategory,
      `${periodId} terminalCategory`,
    ),
    baseProbabilities: probabilityVector(
      prediction.baseProbabilities,
      categories,
      `${periodId} baseProbabilities`,
    ),
  });
}

function datasetIdentity(value) {
  return {
    datasetVersion: value.datasetVersion,
    activeSeason: value.activeSeason,
    sourceResolvedDatasetSha256: value.sourceResolvedDatasetSha256,
    sourceVenueAuditSha256: value.sourceVenueAuditSha256,
    sourceFrozenBaseParitySha256: value.sourceFrozenBaseParitySha256,
    sourceFrozenValidationPredictionSha256:
      value.sourceFrozenValidationPredictionSha256,
    sourceChronologicalParkFitPredictionSha256:
      value.sourceChronologicalParkFitPredictionSha256,
    splitPolicy: value.splitPolicy,
    categories: value.categories,
    hitCategories: value.hitCategories,
    venues: value.venues,
    periods: value.periods,
    exclusions: value.exclusions,
    safety: value.safety,
    untouchedTestReservation: value.untouchedTestReservation,
  };
}

export function buildM8_5ParkEvaluationDataset({
  resolvedDataset,
  venueAudit,
  frozenBaseParity,
}) {
  const resolved = parseResolvedObservations(resolvedDataset);
  const parity = validateParity(
    frozenBaseParity,
    resolved.dataset,
    resolved.periods.validation,
  );
  const venues = venueMap(venueAudit);
  const parkFitBase = buildChronologicalParkFitPredictions({
    fitObservations: resolved.periods.fit,
    categories: parity.categories,
  });
  const rawPeriods = {
    fit: parkFitBase.predictions.map((prediction) =>
      rowFromPrediction(prediction, 'fit', venues, parity.categories),
    ),
    validation: parity.predictions.map((prediction) =>
      rowFromPrediction(prediction, 'validation', venues, parity.categories),
    ),
  };
  const periods = {};
  const exclusions = [];
  for (const periodId of ['fit', 'validation']) {
    const eligibleRows = [];
    for (const row of rawPeriods[periodId]) {
      if (row.batterHand === null) {
        exclusions.push(
          Object.freeze({
            rowId: row.rowId,
            periodId,
            observedDate: row.observedDate,
            gameId: row.gameId,
            reason: 'missing-supported-batter-hand',
          }),
        );
        continue;
      }
      eligibleRows.push(row);
    }
    eligibleRows.sort(
      (left, right) =>
        left.observedDate.localeCompare(right.observedDate) ||
        left.gameId - right.gameId ||
        left.rowId.localeCompare(right.rowId),
    );
    if (eligibleRows.length === 0) {
      throw new Error(`${periodId} contains no park-eligible observations.`);
    }
    periods[periodId] = Object.freeze({
      startDate: eligibleRows[0].observedDate,
      endDate: eligibleRows.at(-1).observedDate,
      rowCount: eligibleRows.length,
      rows: Object.freeze(eligibleRows),
    });
  }
  if (periods.fit.endDate >= periods.validation.startDate) {
    throw new Error('park fit and validation periods overlap.');
  }
  const identity = {
    datasetVersion: 1,
    activeSeason: 2026,
    sourceResolvedDatasetSha256: sha256Text(
      resolved.dataset.datasetSha256,
      'resolved dataset SHA-256',
    ),
    sourceVenueAuditSha256: sha256Text(
      venues.audit.auditSha256,
      'venue audit SHA-256',
    ),
    sourceFrozenBaseParitySha256: sha256Text(
      parity.parity.paritySha256,
      'frozen-base parity SHA-256',
    ),
    sourceFrozenValidationPredictionSha256: sha256Text(
      parity.parity.predictionSha256,
      'frozen validation prediction SHA-256',
    ),
    sourceChronologicalParkFitPredictionSha256: sha256Text(
      parkFitBase.predictionSha256,
      'chronological park-fit prediction SHA-256',
    ),
    splitPolicy: parkFitBase.splitPolicy,
    categories: parity.categories,
    hitCategories: HIT_CATEGORIES,
    venues: venues.venues,
    periods: Object.freeze(periods),
    exclusions: Object.freeze(
      exclusions.sort(
        (left, right) =>
          left.observedDate.localeCompare(right.observedDate) ||
          left.gameId - right.gameId ||
          left.rowId.localeCompare(right.rowId),
      ),
    ),
    safety: Object.freeze({
      selectedSideInputUsed: false,
      directProbabilityAdjustmentUsed: false,
      priorSeasonRowsUsed: false,
      productionEnabled: false,
      rankingEnabled: false,
      untouchedTestRowsAccessed: false,
    }),
    untouchedTestReservation: Object.freeze({ rowsIncluded: false }),
  };
  return Object.freeze({
    purpose:
      'Fit handedness- and outcome-specific venue residual transformations over chronological out-of-sample frozen-base predictions without using selected side or untouched-test rows.',
    ...identity,
    datasetSha256: sha256(JSON.stringify(datasetIdentity(identity))),
  });
}

function validateCandidates(rawCandidates) {
  const candidates = array(rawCandidates, 'park candidates').map(
    (rawCandidate, index) => {
      const candidate = object(rawCandidate, `park candidate ${index}`);
      const equivalentPa = positiveInteger(
        candidate.equivalentPa,
        `park candidate ${index}.equivalentPa`,
      );
      const candidateId = string(
        candidate.candidateId,
        `park candidate ${index}.candidateId`,
      );
      if (candidateId !== `venue-hand-pool-${equivalentPa}`) {
        throw new Error(`${candidateId} does not match its pooling strength.`);
      }
      return Object.freeze({ candidateId, equivalentPa });
    },
  );
  if (candidates.length === 0) {
    throw new Error('park candidate grid is empty.');
  }
  if (new Set(candidates.map((candidate) => candidate.candidateId)).size !== candidates.length) {
    throw new Error('park candidate grid contains duplicates.');
  }
  return Object.freeze(candidates);
}

function identityMultipliers(categories) {
  return Object.freeze(Object.fromEntries(categories.map((category) => [category, 1])));
}

function fitParkModel(rows, venues, categories, candidate) {
  const stats = new Map();
  for (const row of rows) {
    const key = `${row.venue}\u0000${row.batterHand}`;
    const entry = stats.get(key) ?? {
      observationCount: 0,
      observed: Object.fromEntries(categories.map((category) => [category, 0])),
      expected: Object.fromEntries(categories.map((category) => [category, 0])),
    };
    entry.observationCount += 1;
    entry.observed[row.terminalCategory] += 1;
    for (const category of categories) {
      entry.expected[category] += row.baseProbabilities[category];
    }
    stats.set(key, entry);
  }
  const byVenue = {};
  for (const venue of venues) {
    const byHand = {};
    for (const hand of HANDS) {
      const entry = stats.get(`${venue}\u0000${hand}`);
      if (entry === undefined || entry.observationCount === 0) {
        byHand[hand] = Object.freeze({
          observationCount: 0,
          relativeRateMultipliers: identityMultipliers(categories),
        });
        continue;
      }
      const multipliers = {};
      for (const category of categories) {
        const expectedAverage = entry.expected[category] / entry.observationCount;
        if (expectedAverage <= 0) {
          if (entry.observed[category] !== 0) {
            throw new Error(
              `park group ${venue}|${hand} observed ${category} against zero base support.`,
            );
          }
          multipliers[category] = 1;
          continue;
        }
        const smoothedObservedRate =
          (entry.observed[category] + candidate.equivalentPa * expectedAverage) /
          (entry.observationCount + candidate.equivalentPa);
        multipliers[category] = positiveFinite(
          smoothedObservedRate / expectedAverage,
          `park multiplier ${venue}|${hand}|${category}`,
        );
      }
      byHand[hand] = Object.freeze({
        observationCount: entry.observationCount,
        relativeRateMultipliers: Object.freeze(multipliers),
      });
    }
    byVenue[venue] = Object.freeze(byHand);
  }
  return Object.freeze({
    modelVersion: `m8-5-park-${candidate.candidateId}-v1`,
    candidate,
    application:
      'multiply frozen terminal-outcome probabilities by exact venue-and-batter-hand relative-rate multipliers, then renormalize once',
    categories,
    venues,
    hands: HANDS,
    byVenue: Object.freeze(byVenue),
  });
}

function identityModel(venues, categories) {
  return fitParkModel([], venues, categories, {
    candidateId: 'identity',
    equivalentPa: Number.MAX_SAFE_INTEGER,
  });
}

function transformedProbabilities(model, row) {
  const group = model.byVenue[row.venue]?.[row.batterHand];
  if (group === undefined) {
    throw new Error(`park model lacks ${row.venue}|${row.batterHand}.`);
  }
  const raw = {};
  let total = 0;
  for (const category of model.categories) {
    const value =
      row.baseProbabilities[category] *
      group.relativeRateMultipliers[category];
    if (!Number.isFinite(value) || value < 0) {
      throw new Error(`park transformation produced invalid ${category} mass.`);
    }
    raw[category] = value;
    total += value;
  }
  if (!(total > 0)) {
    throw new Error('park transformation produced no probability mass.');
  }
  return Object.freeze(
    Object.fromEntries(
      model.categories.map((category) => [category, raw[category] / total]),
    ),
  );
}

function scoreRows(rows, model, hitCategories) {
  if (rows.length === 0) {
    throw new Error('cannot score an empty park cohort.');
  }
  const hitSet = new Set(hitCategories);
  let categoricalLogLossTotal = 0;
  let categoricalBrierTotal = 0;
  let hitLogLossTotal = 0;
  let hitBrierTotal = 0;
  const ids = [];
  for (const row of rows) {
    const probabilities = transformedProbabilities(model, row);
    const observedProbability = Math.max(
      probabilities[row.terminalCategory] ?? 0,
      PROBABILITY_FLOOR,
    );
    categoricalLogLossTotal += -Math.log(observedProbability);
    for (const category of model.categories) {
      const target = category === row.terminalCategory ? 1 : 0;
      categoricalBrierTotal += (probabilities[category] - target) ** 2;
    }
    const hitProbability = hitCategories.reduce(
      (sum, category) => sum + probabilities[category],
      0,
    );
    const hit = hitSet.has(row.terminalCategory) ? 1 : 0;
    hitLogLossTotal +=
      hit === 1
        ? -Math.log(Math.max(hitProbability, PROBABILITY_FLOOR))
        : -Math.log(Math.max(1 - hitProbability, PROBABILITY_FLOOR));
    hitBrierTotal += (hitProbability - hit) ** 2;
    ids.push(row.rowId);
  }
  return Object.freeze({
    observationCount: rows.length,
    categoricalLogLoss: categoricalLogLossTotal / rows.length,
    categoricalBrier: categoricalBrierTotal / rows.length,
    hitLogLoss: hitLogLossTotal / rows.length,
    hitBrier: hitBrierTotal / rows.length,
    observationIdsSha256: sha256(JSON.stringify(ids)),
    categoricalLogLossTotal,
    categoricalBrierTotal,
    hitLogLossTotal,
    hitBrierTotal,
  });
}

function aggregateMetrics(parts) {
  const observationCount = parts.reduce(
    (sum, metrics) => sum + metrics.observationCount,
    0,
  );
  if (observationCount === 0) {
    throw new Error('walk-forward park metrics contain no observations.');
  }
  const totals = {
    categoricalLogLossTotal: parts.reduce(
      (sum, metrics) => sum + metrics.categoricalLogLossTotal,
      0,
    ),
    categoricalBrierTotal: parts.reduce(
      (sum, metrics) => sum + metrics.categoricalBrierTotal,
      0,
    ),
    hitLogLossTotal: parts.reduce(
      (sum, metrics) => sum + metrics.hitLogLossTotal,
      0,
    ),
    hitBrierTotal: parts.reduce(
      (sum, metrics) => sum + metrics.hitBrierTotal,
      0,
    ),
  };
  return Object.freeze({
    observationCount,
    categoricalLogLoss:
      totals.categoricalLogLossTotal / observationCount,
    categoricalBrier: totals.categoricalBrierTotal / observationCount,
    hitLogLoss: totals.hitLogLossTotal / observationCount,
    hitBrier: totals.hitBrierTotal / observationCount,
    observationIdsSha256: sha256(
      JSON.stringify(parts.map((metrics) => metrics.observationIdsSha256)),
    ),
    ...totals,
  });
}

function walkForward(fitRows, validationRows, venues, categories, hitCategories, candidate) {
  const dates = [...new Set(validationRows.map((row) => row.observedDate))].sort();
  const parts = [];
  const folds = [];
  for (const date of dates) {
    const trainingRows = [
      ...fitRows,
      ...validationRows.filter((row) => row.observedDate < date),
    ];
    const scoringRows = validationRows.filter((row) => row.observedDate === date);
    const model = candidate === null
      ? identityModel(venues, categories)
      : fitParkModel(trainingRows, venues, categories, candidate);
    const metrics = scoreRows(scoringRows, model, hitCategories);
    parts.push(metrics);
    folds.push(
      Object.freeze({
        validationDate: date,
        trainingObservationCount: trainingRows.length,
        scoringObservationCount: scoringRows.length,
        metrics,
      }),
    );
  }
  return Object.freeze({
    metrics: aggregateMetrics(parts),
    folds: Object.freeze(folds),
  });
}

function beatsIdentityOnEveryReportedMetric(result, baseline) {
  return (
    result.fixedMetrics.categoricalLogLoss <
      baseline.fixedMetrics.categoricalLogLoss - TOLERANCE &&
    result.fixedMetrics.categoricalBrier <=
      baseline.fixedMetrics.categoricalBrier + TOLERANCE &&
    result.fixedMetrics.hitLogLoss <
      baseline.fixedMetrics.hitLogLoss - TOLERANCE &&
    result.fixedMetrics.hitBrier <=
      baseline.fixedMetrics.hitBrier + TOLERANCE &&
    result.walkForwardMetrics.categoricalLogLoss <
      baseline.walkForwardMetrics.categoricalLogLoss - TOLERANCE &&
    result.walkForwardMetrics.categoricalBrier <=
      baseline.walkForwardMetrics.categoricalBrier + TOLERANCE &&
    result.walkForwardMetrics.hitLogLoss <
      baseline.walkForwardMetrics.hitLogLoss - TOLERANCE &&
    result.walkForwardMetrics.hitBrier <=
      baseline.walkForwardMetrics.hitBrier + TOLERANCE
  );
}

function validateEvaluationRows(rows, periodId, venues, categories) {
  const venueSet = new Set(venues);
  const seen = new Set();
  return Object.freeze(
    rows.map((rawRow, index) => {
      const row = object(rawRow, `${periodId} row ${index}`);
      if (
        Object.hasOwn(row, 'selectedSide') ||
        Object.hasOwn(row, 'directProbabilityAdjustment') ||
        Object.hasOwn(row, 'probabilityAdjustment')
      ) {
        throw new Error('park evaluation rows may not contain side or direct probability fields.');
      }
      const rowId = string(row.rowId, `${periodId} row ${index}.rowId`);
      if (seen.has(rowId)) {
        throw new Error(`${periodId} contains duplicate row ${rowId}.`);
      }
      seen.add(rowId);
      const venue = string(row.venue, `${rowId}.venue`);
      if (!venueSet.has(venue)) {
        throw new Error(`${rowId} references venue outside the verified audit.`);
      }
      if (!HANDS.includes(row.batterHand)) {
        throw new Error(`${rowId} has unsupported batter hand.`);
      }
      const terminalCategory = string(
        row.terminalCategory,
        `${rowId}.terminalCategory`,
      );
      if (!categories.includes(terminalCategory)) {
        throw new Error(`${rowId} has unsupported terminal category.`);
      }
      return Object.freeze({
        ...row,
        rowId,
        observedDate: string(row.observedDate, `${rowId}.observedDate`),
        gameId: positiveInteger(row.gameId, `${rowId}.gameId`),
        venue,
        batterHand: row.batterHand,
        terminalCategory,
        baseProbabilities: probabilityVector(
          row.baseProbabilities,
          categories,
          `${rowId}.baseProbabilities`,
        ),
      });
    }),
  );
}

function evaluationIdentity(value) {
  return {
    evaluationVersion: value.evaluationVersion,
    modelFamily: value.modelFamily,
    activeSeason: value.activeSeason,
    sourceDatasetSha256: value.sourceDatasetSha256,
    decision: value.decision,
    selectedCandidateId: value.selectedCandidateId,
    identityFixedMetrics: value.identityFixedMetrics,
    identityWalkForwardMetrics: value.identityWalkForwardMetrics,
    candidateResults: value.candidateResults,
    selectedFixedMetrics: value.selectedFixedMetrics,
    selectedWalkForwardMetrics: value.selectedWalkForwardMetrics,
    selectedModel: value.selectedModel,
    selectionPolicy: value.selectionPolicy,
    safety: value.safety,
    untouchedTestReservation: value.untouchedTestReservation,
  };
}

export function evaluateM8_5ParkCandidates({
  dataset: rawDataset,
  candidates: rawCandidates = DEFAULT_M8_5_PARK_CANDIDATES,
}) {
  const dataset = object(rawDataset, 'park evaluation dataset');
  if (dataset.datasetVersion !== 1 || dataset.activeSeason !== 2026) {
    throw new Error('park evaluation dataset contract is unsupported.');
  }
  assertUntouchedSealed(
    dataset.untouchedTestReservation,
    'park evaluation dataset untouched reservation',
  );
  if (
    dataset.safety?.selectedSideInputUsed !== false ||
    dataset.safety?.directProbabilityAdjustmentUsed !== false ||
    dataset.safety?.priorSeasonRowsUsed !== false ||
    dataset.safety?.productionEnabled !== false ||
    dataset.safety?.rankingEnabled !== false ||
    dataset.safety?.untouchedTestRowsAccessed !== false
  ) {
    throw new Error('park evaluation dataset safety boundary is invalid.');
  }
  const rawFitRows = array(dataset.periods?.fit?.rows, 'park fit rows');
  const rawValidationRows = array(
    dataset.periods?.validation?.rows,
    'park validation rows',
  );
  if (rawFitRows.length === 0 || rawValidationRows.length === 0) {
    throw new Error('park evaluation requires fit and validation rows.');
  }
  const venues = array(dataset.venues, 'park venues').map((venue) => string(venue, 'park venue'));
  if (new Set(venues).size !== venues.length) {
    throw new Error('park venues must be unique.');
  }
  const categories = array(dataset.categories, 'park categories').map((category) => string(category, 'park category'));
  if (new Set(categories).size !== categories.length) {
    throw new Error('park categories must be unique.');
  }
  const hitCategories = array(dataset.hitCategories, 'park hit categories').map((category) => string(category, 'park hit category'));
  for (const category of hitCategories) {
    if (!categories.includes(category)) {
      throw new Error(`park Hit category ${category} is not modeled.`);
    }
  }
  const fitRows = validateEvaluationRows(rawFitRows, 'fit', venues, categories);
  const validationRows = validateEvaluationRows(
    rawValidationRows,
    'validation',
    venues,
    categories,
  );
  if (fitRows.at(-1).observedDate >= validationRows[0].observedDate) {
    throw new Error('park evaluation fit and validation chronology overlaps.');
  }
  const candidates = validateCandidates(rawCandidates);
  const identity = identityModel(venues, categories);
  const identityFixedMetrics = scoreRows(validationRows, identity, hitCategories);
  const identityWalkForward = walkForward(
    fitRows,
    validationRows,
    venues,
    categories,
    hitCategories,
    null,
  );
  const baseline = {
    fixedMetrics: identityFixedMetrics,
    walkForwardMetrics: identityWalkForward.metrics,
  };
  const results = candidates.map((candidate) => {
    const fixedModel = fitParkModel(
      fitRows,
      venues,
      categories,
      candidate,
    );
    const fixedMetrics = scoreRows(validationRows, fixedModel, hitCategories);
    const walkForwardResult = walkForward(
      fitRows,
      validationRows,
      venues,
      categories,
      hitCategories,
      candidate,
    );
    return Object.freeze({
      candidate,
      fixedMetrics,
      walkForwardMetrics: walkForwardResult.metrics,
      walkForwardFolds: walkForwardResult.folds,
      beatsIdentityOnEveryReportedMetric:
        beatsIdentityOnEveryReportedMetric(
          {
            fixedMetrics,
            walkForwardMetrics: walkForwardResult.metrics,
          },
          baseline,
        ),
    });
  });
  const selection = selectCanonicalM8_5ParkCandidate({
    identityFixedMetrics,
    identityWalkForwardMetrics: identityWalkForward.metrics,
    candidateResults: results,
  });
  if (selection.decision === 'NO_STABLE_PARK_CANDIDATE') {
    throw new Error(
      `park candidate family has no stable fixed/walk-forward nondominated intersection: ${JSON.stringify(selection)}`,
    );
  }
  const selected =
    selection.selectedCandidateId === 'identity'
      ? null
      : results.find(
          (result) =>
            result.candidate.candidateId === selection.selectedCandidateId,
        );
  if (selection.selectedCandidateId !== 'identity' && selected === undefined) {
    throw new Error('canonical park selection did not resolve to one fitted candidate.');
  }
  const selectedFixedMetrics =
    selected?.fixedMetrics ?? identityFixedMetrics;
  const selectedWalkForwardMetrics =
    selected?.walkForwardMetrics ?? identityWalkForward.metrics;
  const identityFields = {
    evaluationVersion: 1,
    modelFamily: 'm8-5-handedness-outcome-specific-park-residual-transformation',
    activeSeason: 2026,
    sourceDatasetSha256: sha256Text(
      dataset.datasetSha256,
      'park evaluation dataset SHA-256',
    ),
    decision: selection.decision,
    selectedCandidateId: selection.selectedCandidateId,
    identityFixedMetrics,
    identityWalkForwardMetrics: identityWalkForward.metrics,
    candidateResults: Object.freeze(results),
    selectedFixedMetrics,
    selectedWalkForwardMetrics,
    selectedModel:
      selected === null || selected === undefined
        ? null
        : fitParkModel(fitRows, venues, categories, selected.candidate),
    selectionPolicy: Object.freeze({
      candidateSetVersion: selection.candidateSetVersion,
      candidateFamily:
        'exact-provider-venue-by-batter-hand residual relative-rate multipliers with one pooling hyperparameter',
      candidateIds: Object.freeze([
        'identity',
        ...candidates.map((candidate) => candidate.candidateId),
      ]),
      identityCandidateId: 'identity',
      identityIsInfinitePoolingLimit: true,
      properScoresUsedForSelection: Object.freeze([
        'categoricalLogLoss',
        'categoricalBrier',
      ]),
      fixedNondominatedCandidateIds:
        selection.fixedNondominatedCandidateIds,
      walkForwardNondominatedCandidateIds:
        selection.walkForwardNondominatedCandidateIds,
      stableCandidateIds: selection.stableCandidateIds,
      selectedStableCandidateId: selection.selectedCandidateId,
      selectionRule:
        'intersect fixed-validation and expanding-walk-forward categorical proper-score nondominated sets, then select the strongest pooling candidate; break equal-pooling ties by ascending candidate ID',
      hitMetricsUsedForSelection: false,
      hitMetricsRetainedAsDiagnostics: true,
      validationRowsUsedForFinalMultiplierFit: false,
    }),
    safety: Object.freeze({
      selectedSideInputUsed: false,
      directProbabilityAdjustmentUsed: false,
      priorSeasonRowsUsed: false,
      productionEnabled: false,
      rankingEnabled: false,
      untouchedTestRowsAccessed: false,
    }),
    untouchedTestReservation: Object.freeze({ rowsIncluded: false }),
  };
  return Object.freeze({
    ...identityFields,
    evaluationSha256: sha256(JSON.stringify(evaluationIdentity(identityFields))),
  });
}
