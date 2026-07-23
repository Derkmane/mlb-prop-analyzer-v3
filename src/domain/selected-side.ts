export const SELECTED_SIDES = ['higher', 'lower'] as const;

export type SelectedSide = (typeof SELECTED_SIDES)[number];

export function isSelectedSide(value: unknown): value is SelectedSide {
  return typeof value === 'string' && SELECTED_SIDES.includes(value as SelectedSide);
}
