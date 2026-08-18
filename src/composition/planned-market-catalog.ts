import type { PlannedMarketDefinition } from '../domain/market.js';

export const PLANNED_MARKET_KEYS = {
  BATTER_RUNS: 'batter-runs',
  BATTER_TOTAL_BASES: 'batter-total-bases',
  PITCHER_STRIKEOUTS: 'pitcher-strikeouts',
} as const;

export type PlannedMarketKey =
  (typeof PLANNED_MARKET_KEYS)[keyof typeof PLANNED_MARKET_KEYS];

const definitions = [
  {
    baseMarketKey: PLANNED_MARKET_KEYS.BATTER_RUNS,
    displayName: 'Batter Runs',
    mathematicalFamily: 'directly-fitted-composite',
    status: 'planned',
    blocker: 'The Family B Batter Runs distribution has not yet been fitted, versioned, and admitted to research ranking.',
  },
  {
    baseMarketKey: PLANNED_MARKET_KEYS.BATTER_TOTAL_BASES,
    displayName: 'Batter Total Bases',
    mathematicalFamily: 'self-contained-hitter-pa',
    status: 'planned',
    blocker: 'The shared terminal-outcome runtime must preserve base-value outcomes through the Total Bases distribution builder and exact Underdog board evidence remains to be captured.',
  },
  {
    baseMarketKey: PLANNED_MARKET_KEYS.PITCHER_STRIKEOUTS,
    displayName: 'Pitcher Strikeouts',
    mathematicalFamily: 'joint-pitcher-workload-outcome',
    status: 'planned',
    blocker: 'The sequential workload, outcome, and removal model is not implemented or validated.',
  },
] satisfies readonly PlannedMarketDefinition[];

export const PLANNED_MARKET_CATALOG: readonly PlannedMarketDefinition[] =
  Object.freeze(definitions.map((definition) => Object.freeze(definition)));
