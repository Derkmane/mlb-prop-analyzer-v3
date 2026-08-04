import { TERMINAL_PA_CATEGORIES } from '../../domain/terminal-pa.js';
import type { M8_5ParkTransformationResolutionV1 } from './park-transformation.js';

function canonicalMultiplierMap(
  resolution: M8_5ParkTransformationResolutionV1,
): ReadonlyMap<string, number> {
  if (resolution.status !== 'validated' || resolution.factorKey !== 'park') {
    throw new Error('park transformation resolution is invalid.');
  }
  if (!Array.isArray(resolution.relativeRateMultipliers)) {
    throw new TypeError('park relative-rate multipliers must be an array.');
  }

  const multipliers = new Map<string, number>();
  for (const entry of resolution.relativeRateMultipliers) {
    if (!TERMINAL_PA_CATEGORIES.includes(entry.category)) {
      throw new Error(`park multiplier contains unknown category ${entry.category}.`);
    }
    if (!Number.isFinite(entry.multiplier) || entry.multiplier <= 0) {
      throw new RangeError(
        `park multiplier for ${entry.category} must be a positive finite number.`,
      );
    }
    if (multipliers.has(entry.category)) {
      throw new Error(`duplicate park multiplier category ${entry.category}.`);
    }
    multipliers.set(entry.category, entry.multiplier);
  }

  if (multipliers.size !== TERMINAL_PA_CATEGORIES.length) {
    throw new Error('park multipliers must contain every canonical terminal category.');
  }
  return multipliers;
}

export function projectM8_5ParkMultipliersToModeledCategoriesV1(
  resolution: M8_5ParkTransformationResolutionV1,
  modeledCategories: readonly string[],
): Readonly<Record<string, number>> {
  if (modeledCategories.length === 0) {
    throw new Error('modeled terminal categories must not be empty.');
  }

  const modeled = new Set<string>();
  for (const category of modeledCategories) {
    if (!TERMINAL_PA_CATEGORIES.includes(category)) {
      throw new Error(`modeled terminal category ${category} is not canonical.`);
    }
    if (modeled.has(category)) {
      throw new Error(`duplicate modeled terminal category ${category}.`);
    }
    modeled.add(category);
  }

  const multipliers = canonicalMultiplierMap(resolution);
  for (const category of TERMINAL_PA_CATEGORIES) {
    const multiplier = multipliers.get(category);
    if (multiplier === undefined) {
      throw new Error(`park multiplier for ${category} is missing.`);
    }
    if (!modeled.has(category) && multiplier !== 1) {
      throw new Error(
        `park effect on omitted category ${category} must be exactly identity.`,
      );
    }
  }

  return Object.freeze(
    Object.fromEntries(
      modeledCategories.map((category) => [category, multipliers.get(category)!]),
    ),
  );
}
