import { createHash } from 'node:crypto';

const PROBABILITY_FLOOR = 1e-300;
const TOLERANCE = 1e-12;
const SHA256_PATTERN = /^[a-f0-9]{64}$/u;

export const M8_5_UNTOUCHED_COHORT_IDENTITY_SHA256 =
  'd82c8e62cdad9023793898c1f0e9ed5baaee650fad650cc13620b7b0800b3d17';
export const M8_5_UNTOUCHED_RESERVATION_ARTIFACT_SHA256 =
  '34558a6b0fffa592de882132b093f3496f14c250b987b3d91eaedc9a254e22cb';
export const M8_5_FROZEN_SUCCESSOR_ARTIFACT_SHA256 =
  'a296c384397315832b39d322a7d061ca73e542d94a886087f743f0774199cd17';
export const M8_5_UNTOUCHED_LIMITATION =
  'This acceptance cohort spans only four dates and 4,159 source plate appearances. The result is a one-time acceptance sanity check and must not be described as decisive proof that the context layer adds predictive value.';

export function stableJson(value) {
  if (
    value === null ||
    typeof value === 'boolean' ||
    typeof value === 'number' ||
    typeof value === 'string'
  ) {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map((entry) => stableJson(entry)).join(',')}]`;
  }
  if (typeof value === 'object') {
    return `{${Object.keys(value)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${stableJson(value[key])}`)
      .join(',')}}`;
  }
  throw new TypeError('acceptance values must be JSON-compatible.');
}

export function sha256Text(text) {
  return createHash('sha256').update(text).digest('hex');
}

export function sha256Value(value) {
  return sha256Text(stableJson(value));
}

function object(value, label) {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new TypeError(`${label} must be an object.`);
  }
  return value;
}

function array(value, label) {
  if (!Array.isArray(value)) throw new TypeError(`${label} must be an array.`);
  return value;
}

function string(value, label) {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new TypeError(`${label} must be a non-empty string.`);
  }
  return value.trim();
}

function nonNegativeInteger(value, label) {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new TypeError(`${label} must be a non-negative integer.`);
  }
  return value;
}

function positiveInteger(value, label) {
  const integer = nonNegativeInteger(value, label);
  if (integer === 0) throw new RangeError(`${label} must be positive.`);
  return integer;
}

function sha256(value, label) {
  const digest = string(value, label);
  if (!SHA256_PATTERN.test(digest)) {
    throw new TypeError(`${label} must be a lowercase SHA-256 digest.`);
  }
  return digest;
}

function probabilities(raw, label) {
  const values = Array.isArray(raw) ? raw : raw?.probabilities;
  if (!Array.isArray(values) || values.length === 0) {
    throw new TypeError(`${label} must contain a non-empty probabilities array.`);
  }
  const verified = values.map((value, index) => {
    if (!Number.isFinite(value) || value < 0 || value > 1) {
      throw new RangeError(`${label}[${index}] must be in [0,1].`);
    }
    return value;
  });
  const total = verified.reduce((sum, value) => sum + value, 0);
  if (Math.abs(total - 1) > TOLERANCE) {
    throw new Error(`${label} must sum to one.`);
  }
  return verified;
}

function accumulator() {
  return {
    count: 0,
    logLoss: 0,
    categoricalBrier: 0,
    anyHitLogLoss: 0,
    anyHitBrier: 0,
    higher15Brier: 0,
    higher25Brier: 0,
    observedHits: 0,
    predictedHits: 0,
  };
}

function score(acc, rawPmf, actualHits, label) {
  const pmf = probabilities(rawPmf, label);
  const actual = nonNegativeInteger(actualHits, `${label} actualHits`);
  const actualProbability = Math.max(pmf[actual] ?? 0, PROBABILITY_FLOOR);
  acc.count += 1;
  acc.logLoss += -Math.log(actualProbability);
  acc.observedHits += actual;
  for (let hits = 0; hits < pmf.length; hits += 1) {
    const probability = pmf[hits];
    acc.categoricalBrier += (probability - (hits === actual ? 1 : 0)) ** 2;
    acc.predictedHits += hits * probability;
  }
  const anyHitProbability = pmf.slice(1).reduce((sum, value) => sum + value, 0);
  const anyHitTarget = actual > 0 ? 1 : 0;
  acc.anyHitLogLoss += -Math.log(
    Math.max(
      anyHitTarget === 1 ? anyHitProbability : 1 - anyHitProbability,
      PROBABILITY_FLOOR,
    ),
  );
  acc.anyHitBrier += (anyHitProbability - anyHitTarget) ** 2;
  for (const [line, key] of [
    [1.5, 'higher15Brier'],
    [2.5, 'higher25Brier'],
  ]) {
    const higher = pmf
      .slice(Math.floor(line) + 1)
      .reduce((sum, value) => sum + value, 0);
    acc[key] += (higher - (actual > line ? 1 : 0)) ** 2;
  }
}

function finalize(acc) {
  if (acc.count === 0) throw new Error('acceptance scoring has no observations.');
  return Object.freeze({
    observationCount: acc.count,
    categoricalLogLoss: acc.logLoss / acc.count,
    categoricalBrier: acc.categoricalBrier / acc.count,
    diagnosticOnly: Object.freeze({
      label: 'DIAGNOSTIC ONLY',
      anyHitLogLoss: acc.anyHitLogLoss / acc.count,
      anyHitBrier: acc.anyHitBrier / acc.count,
      higher05Brier: acc.anyHitBrier / acc.count,
      higher15Brier: acc.higher15Brier / acc.count,
      higher25Brier: acc.higher25Brier / acc.count,
      observedMeanHits: acc.observedHits / acc.count,
      predictedMeanHits: acc.predictedHits / acc.count,
    }),
  });
}

export function scoreM8_5UntouchedDistributions(rawRows) {
  const rows = array(rawRows, 'acceptance rows');
  if (rows.length === 0) throw new Error('acceptance rows must not be empty.');
  const ids = new Set();
  const orderedIds = [];
  const dBase = accumulator();
  const dFinal = accumulator();
  for (const [index, rawRow] of rows.entries()) {
    const row = object(rawRow, `acceptance rows[${index}]`);
    const observationId = string(row.observationId, `acceptance rows[${index}].observationId`);
    if (ids.has(observationId)) {
      throw new Error(`duplicate acceptance observation ID: ${observationId}.`);
    }
    ids.add(observationId);
    orderedIds.push(observationId);
    const actualHits = nonNegativeInteger(
      row.actualHits,
      `${observationId}.actualHits`,
    );
    score(dBase, row.dBase, actualHits, `${observationId}.D_base`);
    score(dFinal, row.dFinal, actualHits, `${observationId}.D_final`);
  }
  const baseMetrics = finalize(dBase);
  const finalMetrics = finalize(dFinal);
  if (baseMetrics.observationCount !== finalMetrics.observationCount) {
    throw new Error('D_base and D_final were not scored on identical rows.');
  }
  const logLossNoWorse =
    finalMetrics.categoricalLogLoss <= baseMetrics.categoricalLogLoss + TOLERANCE;
  const brierNoWorse =
    finalMetrics.categoricalBrier <= baseMetrics.categoricalBrier + TOLERANCE;
  const strictImprovement =
    finalMetrics.categoricalLogLoss < baseMetrics.categoricalLogLoss - TOLERANCE ||
    finalMetrics.categoricalBrier < baseMetrics.categoricalBrier - TOLERANCE;
  return Object.freeze({
    scoringDefinition: Object.freeze({
      primary:
        'Categorical proper scores over the exact Batter Hits count PMF (0, 1, 2, ... hits) on identical hitter-game observations.',
      categoricalLogLoss: '-log(probability assigned to the observed Hits count), averaged over scored observations.',
      categoricalBrier:
        'Sum of squared errors across every supported Hits-count category, averaged over scored observations.',
      hitSpecificMetrics: 'DIAGNOSTIC ONLY',
    }),
    dFinal: finalMetrics,
    dBase: baseMetrics,
    comparison: Object.freeze({
      categoricalLogLossDelta:
        finalMetrics.categoricalLogLoss - baseMetrics.categoricalLogLoss,
      categoricalBrierDelta:
        finalMetrics.categoricalBrier - baseMetrics.categoricalBrier,
      dFinalLogLossNoWorse: logLossNoWorse,
      dFinalBrierNoWorse: brierNoWorse,
      dFinalStrictlyImprovesAtLeastOneProperScore: strictImprovement,
      dFinalProperScoreDominatesDBase:
        logLossNoWorse && brierNoWorse && strictImprovement,
    }),
    observationIdsSha256: sha256Value(orderedIds),
  });
}

function assertReservation(rawReservation) {
  const reservation = object(rawReservation, 'reservation artifact');
  if (
    reservation.cohortIdentitySha256 !== M8_5_UNTOUCHED_COHORT_IDENTITY_SHA256 ||
    reservation.artifactSha256 !== M8_5_UNTOUCHED_RESERVATION_ARTIFACT_SHA256 ||
    reservation.dateRange?.startDate !== '2026-07-26' ||
    reservation.dateRange?.endDate !== '2026-07-29' ||
    reservation.dateRange?.dateCount !== 4 ||
    reservation.gameCount !== 54 ||
    reservation.plateAppearanceCount !== 4159 ||
    reservation.rowsIncluded !== false ||
    reservation.outcomesRead !== false ||
    reservation.evaluationRunCount !== 0
  ) {
    throw new Error('reservation artifact does not match the approved sealed cohort.');
  }
  return reservation;
}

function assertFreeze(rawFreeze) {
  const freeze = object(rawFreeze, 'frozen successor');
  if (
    freeze.modelVersion !== 'm8-5-batter-hits-successor-freeze-v1' ||
    freeze.artifactSha256 !== M8_5_FROZEN_SUCCESSOR_ARTIFACT_SHA256 ||
    freeze.productionEnabled !== false ||
    freeze.rankingEnabled !== false ||
    freeze.untouchedTestAccessed !== false ||
    !Array.isArray(freeze.factors) ||
    freeze.factors.length !== 5
  ) {
    throw new Error('frozen successor does not match the approved M8.5 freeze.');
  }
  return freeze;
}

function artifactIdentity(value) {
  const { artifactSha256: unused, ...identity } = value;
  return identity;
}

export function createM8_5UntouchedAcceptanceArtifact({
  reservation: rawReservation,
  freeze: rawFreeze,
  score,
  evidenceCounts,
  exclusionReasonCounts,
  sourceEvidence,
}) {
  const reservation = assertReservation(rawReservation);
  const freeze = assertFreeze(rawFreeze);
  const scored = object(score, 'acceptance score');
  const counts = object(evidenceCounts, 'evidenceCounts');
  const scoredCount = positiveInteger(
    counts.scoredObservationCount,
    'evidenceCounts.scoredObservationCount',
  );
  if (
    scored.dFinal?.observationCount !== scoredCount ||
    scored.dBase?.observationCount !== scoredCount
  ) {
    throw new Error('score observation count does not match evidenceCounts.');
  }
  const exclusions = Object.freeze(
    Object.fromEntries(
      Object.entries(object(exclusionReasonCounts, 'exclusionReasonCounts'))
        .map(([reason, count]) => [reason, nonNegativeInteger(count, `exclusion ${reason}`)])
        .sort(([left], [right]) => left.localeCompare(right)),
    ),
  );
  const status = scored.comparison?.dFinalProperScoreDominatesDBase
    ? 'untouched-acceptance-d-final-proper-score-dominates-d-base'
    : 'untouched-acceptance-d-final-does-not-proper-score-dominate-d-base';
  const withoutHash = Object.freeze({
    purpose:
      'Immutable one-time untouched current-season M8.5 Batter Hits acceptance result comparing the frozen D_final and D_base on identical hitter-game observations.',
    artifactVersion: 1,
    evaluationVersion: 1,
    status,
    productionEnabled: false,
    rankingEnabled: false,
    hardDiscoveryFilterEnabled: false,
    evaluationRunCount: 1,
    limitation: M8_5_UNTOUCHED_LIMITATION,
    reservedCohort: Object.freeze({
      cohortVersion: reservation.cohortVersion,
      cohortIdentitySha256: reservation.cohortIdentitySha256,
      reservationArtifactSha256: reservation.artifactSha256,
      dateRange: Object.freeze({ ...reservation.dateRange }),
      gameCount: reservation.gameCount,
      sourcePlateAppearanceCount: reservation.plateAppearanceCount,
    }),
    frozenSuccessor: Object.freeze({
      modelVersion: freeze.modelVersion,
      artifactSha256: freeze.artifactSha256,
    }),
    factorDispositions: Object.freeze(
      freeze.factors.map((factor) => Object.freeze({ ...factor })),
    ),
    evidenceCounts: Object.freeze({ ...counts }),
    exclusionReasonCounts: exclusions,
    sourceEvidence: Object.freeze({ ...object(sourceEvidence, 'sourceEvidence') }),
    scoring: Object.freeze({ ...scored }),
    acceptanceDecision: Object.freeze({
      rule:
        'D_final passes this comparison only when it is no worse on both primary categorical proper scores and strictly better on at least one; diagnostics cannot change the decision.',
      dFinalProperScoreDominatesDBase:
        scored.comparison.dFinalProperScoreDominatesDBase,
      productionAuthorizationGranted: false,
      retuningAuthorized: false,
    }),
  });
  return Object.freeze({
    ...withoutHash,
    artifactSha256: sha256Value(withoutHash),
  });
}

export function verifyM8_5UntouchedAcceptanceArtifact(rawArtifact) {
  const artifact = object(rawArtifact, 'M8.5 untouched acceptance artifact');
  if (
    artifact.artifactVersion !== 1 ||
    artifact.evaluationVersion !== 1 ||
    artifact.productionEnabled !== false ||
    artifact.rankingEnabled !== false ||
    artifact.hardDiscoveryFilterEnabled !== false ||
    artifact.evaluationRunCount !== 1 ||
    artifact.limitation !== M8_5_UNTOUCHED_LIMITATION ||
    artifact.reservedCohort?.cohortIdentitySha256 !==
      M8_5_UNTOUCHED_COHORT_IDENTITY_SHA256 ||
    artifact.reservedCohort?.reservationArtifactSha256 !==
      M8_5_UNTOUCHED_RESERVATION_ARTIFACT_SHA256 ||
    artifact.frozenSuccessor?.artifactSha256 !==
      M8_5_FROZEN_SUCCESSOR_ARTIFACT_SHA256 ||
    artifact.acceptanceDecision?.productionAuthorizationGranted !== false ||
    artifact.acceptanceDecision?.retuningAuthorized !== false
  ) {
    throw new Error('unsupported or drifted M8.5 untouched acceptance artifact.');
  }
  sha256(artifact.artifactSha256, 'acceptance artifact SHA-256');
  if (artifact.artifactSha256 !== sha256Value(artifactIdentity(artifact))) {
    throw new Error('M8.5 untouched acceptance artifact SHA-256 is invalid.');
  }
  return artifact;
}
