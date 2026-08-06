export const BATTER_HHR_FEATURE_ID = 'batter-hhr-feature';

/** The single canonical declaration for the implemented Batter HHR base market. */
export const BATTER_HHR_MARKET_KEY = 'batter-hits-runs-rbis';

export const BATTER_HHR_BASELINE_PROVIDER_MARKET_KEY =
  'batter_hits_runs_rbis';
export const BATTER_HHR_ALTERNATE_PROVIDER_MARKET_KEY =
  'batter_hits_runs_rbis_alternate';

export const BATTER_HHR_FEATURE_DATA_FIELD = 'batterHitsRunsRbis';

export const BATTER_HHR_FEATURE_MANIFEST = Object.freeze({
  featureId: BATTER_HHR_FEATURE_ID,
  marketKeys: Object.freeze([BATTER_HHR_MARKET_KEY]),
  featureDataFields: Object.freeze([BATTER_HHR_FEATURE_DATA_FIELD]),
});
