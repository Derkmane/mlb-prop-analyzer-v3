import type { PerPaOutcomeVector } from '../domain/per-pa-outcome.js';
import {
  validateProbability,
  validateProbabilityVector,
} from './probability-validation.js';

export function validatePerPaOutcomeVector<Category extends string>(
  vector: PerPaOutcomeVector<Category>,
  categories: readonly Category[],
  label: string,
): PerPaOutcomeVector<Category> {
  const keys = Object.keys(vector).sort();
  const expected = [...categories].sort();
  if (JSON.stringify(keys) !== JSON.stringify(expected)) {
    throw new Error(`${label} must contain every and only modeled category.`);
  }

  const values = categories.map(
    (category) => vector[category] ?? Number.NaN,
  );
  validateProbabilityVector(values, label);
  return vector;
}

export function sumPerPaOutcomeProbability<Category extends string>(
  vector: PerPaOutcomeVector<string>,
  selectedCategories: readonly Category[],
  label: string,
): number {
  return validateProbability(
    selectedCategories.reduce(
      (sum, category) => sum + (vector[category] ?? 0),
      0,
    ),
    label,
  );
}
