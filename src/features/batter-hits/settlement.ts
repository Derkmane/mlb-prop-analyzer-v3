export const BATTER_HITS_SETTLEMENT_RULE_VERSION =
  'underdog-batter-hits-settlement-v1' as const;

/**
 * The verified Underdog Pick'em MLB participant/tie/postponement rule bundle is
 * market-general. The existing sanitized fixture was first introduced while
 * HHR was being registered, but its cited operator rules apply to MLB batter
 * Pick'em selections generally and therefore also govern Batter Hits.
 */
export const BATTER_HITS_SETTLEMENT_RULE_SOURCE_REFERENCE =
  'fixtures/sanitized/m11/hhr/settlement/underdog-batter-hhr-settlement-v1.json' as const;
