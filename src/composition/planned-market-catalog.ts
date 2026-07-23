import type { PlannedMarketDefinition } from '../domain/market.js';

export const PLANNED_MARKET_KEYS = {
  BATTER_HITS: 'batter-hits',
  BATTER_TOTAL_BASES: 'batter-total-bases',
  BATTER_HITS_RUNS_RBIS: 'batter-hits-runs-rbis',
  PITCHER_STRIKEOUTS: 'pitcher-strikeouts',
} as const;

export type PlannedMarketKey =
  (typeof PLANNED_MARKET_KEYS)[keyof typeof PLANNED_MARKET_KEYS];

const definitions = [
  {
    baseMarketKey: PLANNED_MARKET_KEYS.BATTER_HITS,
    displayName: 'Batter Hits',
    mathematicalFamily: 'self-contained-hitter-pa',
    status: 'planned',
    blocker: 'The first vertical slice is not implemented and its current-season production fit is not validated.',
  },
  {
    baseMarketKey: PLANNED_MARKET_KEYS.BATTER_TOTAL_BASES,
    displayName: 'Batter Total Bases',
    mathematicalFamily: 'self-contained-hitter-pa',
    status: 'planned',
    blocker: 'The shared categorical fit, distribution builder, and current-season validation are incomplete.',
  },
  {
    baseMarketKey: PLANNED_MARKET_KEYS.BATTER_HITS_RUNS_RBIS,
    displayName: 'Batter Hits + Runs + RBIs',
    mathematicalFamily: 'tagged-player-base-out',
    status: 'planned',
    blocker: 'Approved-source data sufficiency and the tagged-player joint model are not validated.',
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
