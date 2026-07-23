export const TERMINAL_PA_CATEGORIES = [
  'K',
  'UBB',
  'IBB',
  'HBP',
  '1B',
  '2B',
  '3B',
  'HR',
  'ROE',
  'FC',
  'SF',
  'SH',
  'BIP_OUT',
  'CATCHER_INTERFERENCE',
  'OTHER_PA',
] as const;

export type TerminalPaCategory = (typeof TERMINAL_PA_CATEGORIES)[number];

export function isTerminalPaCategory(value: unknown): value is TerminalPaCategory {
  return (
    typeof value === 'string' &&
    TERMINAL_PA_CATEGORIES.includes(value as TerminalPaCategory)
  );
}

export const BASERUNNING_EVENT_CATEGORIES = [
  'SB',
  'CS',
  'PICKOFF',
  'OTHER_BASERUNNING',
] as const;

export type BaserunningEventCategory =
  (typeof BASERUNNING_EVENT_CATEGORIES)[number];

export function isBaserunningEventCategory(
  value: unknown,
): value is BaserunningEventCategory {
  return (
    typeof value === 'string' &&
    BASERUNNING_EVENT_CATEGORIES.includes(value as BaserunningEventCategory)
  );
}
