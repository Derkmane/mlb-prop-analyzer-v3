function object(value, label) {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new TypeError(`${label} must be an object.`);
  }
  return value;
}

function nonemptyString(value, label) {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new TypeError(`${label} must be a nonempty string.`);
  }
  return value.trim();
}

function isoTimestamp(value, label) {
  const timestamp = nonemptyString(value, label);
  if (!Number.isFinite(Date.parse(timestamp))) {
    throw new TypeError(`${label} must be an ISO timestamp or date.`);
  }
  return timestamp;
}

function temporalBoundary(rule) {
  if (typeof rule.sourceVerifiedAt === 'string') {
    return Object.freeze({ kind: 'sourceVerifiedAt', value: rule.sourceVerifiedAt });
  }
  if (typeof rule.sourcePublishedAt === 'string') {
    return Object.freeze({ kind: 'sourcePublishedAt', value: rule.sourcePublishedAt });
  }
  if (typeof rule.effectiveDate === 'string') {
    return Object.freeze({ kind: 'effectiveDate', value: rule.effectiveDate });
  }
  return null;
}

function unauthorized(reason) {
  return Object.freeze({ authorized: false, reason });
}

export function authorizeActiveSourceOfferForResearch({
  settlementRegistry,
  offer,
  evaluatedAt,
}) {
  const registry = object(settlementRegistry, 'settlementRegistry');
  if (!Array.isArray(registry.rules)) {
    throw new TypeError('settlementRegistry.rules must be an array.');
  }
  const value = object(offer, 'offer');
  const boardSource = value.boardSource;
  const bookmaker = value.providerBookmakerKey ?? value.bookmaker;
  const region = value.providerRegion ?? value.region;
  const settlementRuleVersion = value.settlementRuleVersion;
  const baseMarketKey = value.baseMarketKey;
  const selectedSide = value.selectedSide;
  const timestamp = isoTimestamp(evaluatedAt, 'evaluatedAt');

  if (boardSource === 'pick6') {
    if (bookmaker !== 'pick6' || region !== 'us_dfs') {
      return unauthorized('active-source-identity-mismatch');
    }
  } else if (boardSource === 'draftkings') {
    if (bookmaker !== 'draftkings' || region !== 'us') {
      return unauthorized('active-source-identity-mismatch');
    }
  } else {
    return unauthorized('active-source-settlement-rule-unavailable');
  }
  if (selectedSide !== 'higher' && selectedSide !== 'lower') {
    return unauthorized('active-source-side-unavailable');
  }
  if (
    typeof settlementRuleVersion !== 'string' ||
    settlementRuleVersion.length === 0 ||
    typeof baseMarketKey !== 'string' ||
    baseMarketKey.length === 0
  ) {
    return unauthorized('active-source-settlement-rule-unavailable');
  }

  const matches = registry.rules.filter(
    (rawRule) =>
      rawRule?.version === settlementRuleVersion &&
      rawRule?.boardSource === boardSource &&
      rawRule?.baseMarketKey === baseMarketKey,
  );
  if (matches.length !== 1) {
    return unauthorized('active-source-settlement-rule-unavailable');
  }
  const rule = object(matches[0], 'settlement rule');
  const boundary = temporalBoundary(rule);
  if (boundary === null) {
    return unauthorized('active-source-settlement-rule-temporal-evidence-unavailable');
  }
  const boundaryTimestamp = isoTimestamp(boundary.value, `settlement rule ${boundary.kind}`);
  if (Date.parse(timestamp) < Date.parse(boundaryTimestamp)) {
    return unauthorized(
      boardSource === 'pick6'
        ? 'pick6-settlement-rule-temporal-evidence-unavailable'
        : 'active-source-settlement-rule-temporal-evidence-unavailable',
    );
  }

  if (boardSource === 'pick6' && selectedSide === 'higher') {
    return unauthorized('pick6-pardon-eligibility-unmodeled');
  }

  return Object.freeze({
    authorized: true,
    reason: null,
    boardSource,
    settlementRuleVersion,
    temporalBoundaryKind: boundary.kind,
    temporalBoundary: boundaryTimestamp,
  });
}
