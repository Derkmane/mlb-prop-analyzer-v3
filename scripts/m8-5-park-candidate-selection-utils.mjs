const SCORE_TOLERANCE = 1e-12;

export const M8_5_PARK_CANDIDATE_SET_VERSION =
  'm8-5-park-candidate-set-v1';

function object(value, label) {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new TypeError(`${label} must be an object.`);
  }
  return value;
}

function array(value, label) {
  if (!Array.isArray(value)) {
    throw new TypeError(`${label} must be an array.`);
  }
  return value;
}

function nonEmptyString(value, label) {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new TypeError(`${label} must be a non-empty string.`);
  }
  return value.trim();
}

function finiteScore(value, label) {
  if (!Number.isFinite(value) || value < 0) {
    throw new TypeError(`${label} must be a finite nonnegative score.`);
  }
  return value;
}

function metrics(value, label) {
  const record = object(value, label);
  return Object.freeze({
    categoricalLogLoss: finiteScore(
      record.categoricalLogLoss,
      `${label}.categoricalLogLoss`,
    ),
    categoricalBrier: finiteScore(
      record.categoricalBrier,
      `${label}.categoricalBrier`,
    ),
  });
}

function finitePooling(value, label) {
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new TypeError(`${label} must be a positive safe integer.`);
  }
  return value;
}

function candidatePoint({
  candidateId,
  equivalentPa,
  fixedMetrics,
  walkForwardMetrics,
}) {
  return Object.freeze({
    candidateId: nonEmptyString(candidateId, 'candidateId'),
    equivalentPa:
      equivalentPa === null
        ? null
        : finitePooling(equivalentPa, `${candidateId}.equivalentPa`),
    fixedMetrics: metrics(fixedMetrics, `${candidateId}.fixedMetrics`),
    walkForwardMetrics: metrics(
      walkForwardMetrics,
      `${candidateId}.walkForwardMetrics`,
    ),
  });
}

function scorePair(point, design) {
  if (design === 'fixed') return point.fixedMetrics;
  if (design === 'walkForward') return point.walkForwardMetrics;
  throw new Error(`unsupported park validation design ${String(design)}.`);
}

export function parkCandidateDominates(left, right, design) {
  const leftScores = scorePair(left, design);
  const rightScores = scorePair(right, design);
  const noWorse =
    leftScores.categoricalLogLoss <=
      rightScores.categoricalLogLoss + SCORE_TOLERANCE &&
    leftScores.categoricalBrier <=
      rightScores.categoricalBrier + SCORE_TOLERANCE;
  const strictlyBetter =
    leftScores.categoricalLogLoss <
      rightScores.categoricalLogLoss - SCORE_TOLERANCE ||
    leftScores.categoricalBrier <
      rightScores.categoricalBrier - SCORE_TOLERANCE;
  return noWorse && strictlyBetter;
}

function nondominatedCandidateIds(points, design) {
  return Object.freeze(
    points
      .filter(
        (candidate) =>
          !points.some(
            (other) =>
              other.candidateId !== candidate.candidateId &&
              parkCandidateDominates(other, candidate, design),
          ),
      )
      .map((candidate) => candidate.candidateId)
      .sort((left, right) => left.localeCompare(right)),
  );
}

function strongerPooling(left, right) {
  if (left.candidateId === 'identity') return -1;
  if (right.candidateId === 'identity') return 1;
  return (
    right.equivalentPa - left.equivalentPa ||
    left.candidateId.localeCompare(right.candidateId)
  );
}

export function selectCanonicalM8_5ParkCandidate({
  identityFixedMetrics,
  identityWalkForwardMetrics,
  candidateResults: rawCandidateResults,
}) {
  const candidateResults = array(
    rawCandidateResults,
    'park candidate results',
  );
  const points = [
    candidatePoint({
      candidateId: 'identity',
      equivalentPa: null,
      fixedMetrics: identityFixedMetrics,
      walkForwardMetrics: identityWalkForwardMetrics,
    }),
    ...candidateResults.map((rawResult, index) => {
      const result = object(rawResult, `park candidate result ${index}`);
      const candidate = object(
        result.candidate,
        `park candidate result ${index}.candidate`,
      );
      return candidatePoint({
        candidateId: candidate.candidateId,
        equivalentPa: candidate.equivalentPa,
        fixedMetrics: result.fixedMetrics,
        walkForwardMetrics: result.walkForwardMetrics,
      });
    }),
  ];
  const ids = points.map((point) => point.candidateId);
  if (new Set(ids).size !== ids.length) {
    throw new Error('park candidate family contains duplicate candidate IDs.');
  }
  if (ids.filter((candidateId) => candidateId === 'identity').length !== 1) {
    throw new Error('park candidate family must contain exactly one identity limit.');
  }

  const fixedNondominatedCandidateIds = nondominatedCandidateIds(
    points,
    'fixed',
  );
  const walkForwardNondominatedCandidateIds = nondominatedCandidateIds(
    points,
    'walkForward',
  );
  const walkSet = new Set(walkForwardNondominatedCandidateIds);
  const stableCandidateIds = Object.freeze(
    fixedNondominatedCandidateIds.filter((candidateId) =>
      walkSet.has(candidateId),
    ),
  );
  if (stableCandidateIds.length === 0) {
    return Object.freeze({
      candidateSetVersion: M8_5_PARK_CANDIDATE_SET_VERSION,
      fixedNondominatedCandidateIds,
      walkForwardNondominatedCandidateIds,
      stableCandidateIds,
      selectedCandidateId: null,
      decision: 'NO_STABLE_PARK_CANDIDATE',
    });
  }

  const stableSet = new Set(stableCandidateIds);
  const selected = points
    .filter((point) => stableSet.has(point.candidateId))
    .sort(strongerPooling)[0];
  if (selected === undefined) {
    throw new Error('park stable set could not be selected deterministically.');
  }
  return Object.freeze({
    candidateSetVersion: M8_5_PARK_CANDIDATE_SET_VERSION,
    fixedNondominatedCandidateIds,
    walkForwardNondominatedCandidateIds,
    stableCandidateIds,
    selectedCandidateId: selected.candidateId,
    decision:
      selected.candidateId === 'identity'
        ? 'IDENTITY_RETAINED_NO_VALIDATED_PARK_SIGNAL'
        : 'VALIDATED_PARK_SIGNAL',
  });
}
