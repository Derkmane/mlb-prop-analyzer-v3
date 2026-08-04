import { TERMINAL_PA_CATEGORIES } from '../dist/src/domain/terminal-pa.js';

const HANDS = Object.freeze(['L', 'R', 'S']);

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
  if (typeof value !== 'string' || value.length === 0) {
    throw new TypeError(`${label} must be a non-empty string.`);
  }
  return value;
}

function exactVenue(value, label) {
  const venue = string(value, label);
  if (venue.trim() !== venue || venue.includes('\u0000')) {
    throw new Error(`${label} must preserve exact provider venue text.`);
  }
  return venue;
}

function nonNegativeInteger(value, label) {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new TypeError(`${label} must be a non-negative integer.`);
  }
  return value;
}

function positiveFinite(value, label) {
  if (!Number.isFinite(value) || value <= 0) {
    throw new TypeError(`${label} must be positive and finite.`);
  }
  return value;
}

export function factorEffectsAndIndexForM8_5ParkModel(rawModel) {
  const model = object(rawModel, 'selected park model');
  string(model.modelVersion, 'selected park modelVersion');
  const categories = array(model.categories, 'selected park categories').map(
    (category, index) => string(category, `selected park categories[${index}]`),
  );
  if (JSON.stringify(categories) !== JSON.stringify(TERMINAL_PA_CATEGORIES)) {
    throw new Error(
      'selected park model must contain every canonical terminal category in canonical order.',
    );
  }
  const hands = array(model.hands, 'selected park hands');
  if (JSON.stringify(hands) !== JSON.stringify(HANDS)) {
    throw new Error('selected park model hands must equal L, R, S in canonical order.');
  }
  const venues = array(model.venues, 'selected park venues').map((venue, index) =>
    exactVenue(venue, `selected park venues[${index}]`),
  );
  if (venues.length === 0 || new Set(venues).size !== venues.length) {
    throw new Error('selected park model venues must be non-empty and unique.');
  }
  const sortedVenues = [...venues].sort((left, right) => left.localeCompare(right));
  if (JSON.stringify(venues) !== JSON.stringify(sortedVenues)) {
    throw new Error('selected park model venues must be canonically sorted.');
  }
  const byVenue = object(model.byVenue, 'selected park byVenue');
  if (JSON.stringify(Object.keys(byVenue)) !== JSON.stringify(venues)) {
    throw new Error('selected park byVenue coverage or order drifted.');
  }

  const effects = [];
  const effectIdentities = [];
  for (const venue of venues) {
    const byHand = object(byVenue[venue], `selected park ${venue}`);
    if (JSON.stringify(Object.keys(byHand)) !== JSON.stringify(HANDS)) {
      throw new Error(`selected park ${venue} must contain L, R, and S in canonical order.`);
    }
    for (const hand of HANDS) {
      const group = object(byHand[hand], `selected park ${venue}|${hand}`);
      nonNegativeInteger(
        group.observationCount,
        `selected park ${venue}|${hand} observationCount`,
      );
      const multipliers = object(
        group.relativeRateMultipliers,
        `selected park ${venue}|${hand} multipliers`,
      );
      if (JSON.stringify(Object.keys(multipliers)) !== JSON.stringify(categories)) {
        throw new Error(
          `selected park ${venue}|${hand} multiplier coverage or order drifted.`,
        );
      }
      const effectIndex = effects.length;
      effects.push(
        Object.freeze({
          kind: 'park-transformation',
          applicationStage:
            'terminal-outcome-before-statistic-distribution',
          batterHand: hand,
          relativeRateMultipliers: Object.freeze(
            categories.map((category) =>
              Object.freeze({
                category,
                multiplier: positiveFinite(
                  multipliers[category],
                  `selected park ${venue}|${hand}|${category}`,
                ),
              }),
            ),
          ),
        }),
      );
      effectIdentities.push(
        Object.freeze({ venue, batterHand: hand, effectIndex }),
      );
    }
  }

  return Object.freeze({
    effects: Object.freeze(effects),
    effectIdentities: Object.freeze(effectIdentities),
    venueCount: venues.length,
    effectCount: effects.length,
  });
}
