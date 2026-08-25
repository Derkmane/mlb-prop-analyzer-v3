export const BATTER_HITS_DRAFTKINGS_SETTLEMENT_RULE_VERSION =
  'draftkings-sportsbook-batter-hits-2025-08-26-v1' as const;

export const BATTER_HITS_DRAFTKINGS_SETTLEMENT_RULE_SOURCE_REFERENCE =
  'docs/providers/draftkings-mlb-settlement-contract-v1.md' as const;

/**
 * Pick6 is an approved active board source, but the verified official MLB rule
 * page currently supplies neither an effective date nor a publication/version
 * date. CANONICAL_MATH_SPEC.md §12.1 therefore forbids registering a Pick6
 * settlement rule until that temporal boundary is verified.
 */
export const BATTER_HITS_PICK6_SETTLEMENT_RULE_VERSION = null;

/** Historical-only identifiers retained so immutable pre-switch evidence can be read. */
export const BATTER_HITS_SETTLEMENT_RULE_VERSION =
  'underdog-batter-hits-settlement-v1' as const;
export const BATTER_HITS_SETTLEMENT_RULE_SOURCE_REFERENCE =
  'fixtures/sanitized/m11/hhr/settlement/underdog-batter-hhr-settlement-v1.json' as const;
