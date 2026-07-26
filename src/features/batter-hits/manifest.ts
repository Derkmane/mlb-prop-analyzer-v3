export const BATTER_HITS_FEATURE_ID = 'batter-hits-feature';

/** The single canonical declaration for the implemented Batter Hits base market. */
export const BATTER_HITS_MARKET_KEY = 'batter-hits';

export const BATTER_HITS_FEATURE_DATA_FIELD = 'batterHits';

export const BATTER_HITS_FEATURE_MANIFEST = Object.freeze({
  featureId: BATTER_HITS_FEATURE_ID,
  marketKeys: Object.freeze([BATTER_HITS_MARKET_KEY]),
  featureDataFields: Object.freeze([BATTER_HITS_FEATURE_DATA_FIELD]),
});
