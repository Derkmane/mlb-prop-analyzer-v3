import { poolCategoricalCountsOnce } from './m8-categorical-pooling-utils.mjs';
import { sha256 } from './provider-probe-utils.mjs';

const PERIODS = Object.freeze(['fit', 'validation']);
const VALID_HANDS = new Set(['L', 'R']);
const TOLERANCE = 1e-12;

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

function positive(value, label) {
  if (!Number.isFinite(value) || value <= 0) {
    throw new RangeError(`${label} must be positive and finite.`);
  }
  return value;
}

function nonNegative(value, label) {
  if (!Number.isFinite(value) || value < 0) {
    throw new RangeError(`${label} must be non-negative and finite.`);
  }
  return value;
}

function integer(value, label) {
  if (!Number.isSafeInteger(value)) throw new TypeError(`${label} must be an integer.`);
  return value;
}

function probabilityVector(raw, categories, label) {
  const value = object(raw, label);
  const result = {};
  let total = 0;
  for (const category of categories) {
    const probability = value[category];
    if (!Number.isFinite(probability) || probability <= 0 || probability >= 1) {
      throw new RangeError(`${label}.${category} must be strictly between zero and one.`);
    }
    result[category] = probability;
    total += probability;
  }
  if (Object.keys(value).some((key) => !categories.includes(key))) {
    throw new Error(`${label} contains an unsupported category.`);
  }
  if (Math.abs(total - 1) > TOLERANCE) throw new Error(`${label} must sum to one.`);
  return Object.freeze(result);
}

function normalize(raw, categories, label) {
  let total = 0;
  const values = {};
  for (const category of categories) {
    const value = raw[category];
    if (!Number.isFinite(value) || value <= 0) {
      throw new RangeError(`${label}.${category} must be positive and finite.`);
    }
    values[category] = value;
    total += value;
  }
  return probabilityVector(
    Object.fromEntries(categories.map((category) => [category, values[category] / total])),
    categories,
    label,
  );
}

function emptyCounts(categories) {
  return Object.fromEntries(categories.map((category) => [category, 0]));
}

function addCount(map, key, category, categories) {
  const counts = map.get(key) ?? emptyCounts(categories);
  counts[category] += 1;
  map.set(key, counts);
}

function countsToObject(map) {
  return Object.freeze(
    Object.fromEntries(
      [...map.entries()]
        .sort(([left], [right]) => String(left).localeCompare(String(right)))
        .map(([key, value]) => [String(key), Object.freeze({ ...value })]),
    ),
  );
}

function distributionsToObject(map) {
  return Object.freeze(
    Object.fromEntries(
      [...map.entries()]
        .sort(([left], [right]) => String(left).localeCompare(String(right)))
        .map(([key, value]) => [String(key), value]),
    ),
  );
}

function stableSoftmax(logScores, categories) {
  const maximum = Math.max(...categories.map((category) => logScores[category]));
  return normalize(
    Object.fromEntries(
      categories.map((category) => [category, Math.exp(logScores[category] - maximum)]),
    ),
    categories,
    'softmax probabilities',
  );
}

function platoonKey(batterSide, pitcherHand) {
  return `${batterSide}-vs-${pitcherHand}`;
}

function splitKey(batterId, matchup) {
  return `${batterId}|${matchup}`;
}

function leagueTargetFromCounts(counts, categories) {
  const total = categories.reduce((sum, category) => sum + counts[category], 0);
  if (total <= 0) throw new Error('terminal outcome artifact has no current-season rows.');
  return normalize(
    Object.fromEntries(categories.map((category) => [category, counts[category] / total])),
    categories,
    'current-season league target',
  );
}

function pooledEstimate(counts, categories, leagueTarget, equivalentPa) {
  return poolCategoricalCountsOnce({
    categories,
    source: { kind: 'raw-current-season-categorical-counts', counts },
    leagueTarget,
    leagueEquivalentPa: equivalentPa,
  }).probabilities;
}

function leagueMatchupTarget(candidate, counts, categories, leagueTarget) {
  if (candidate.platoonCoefficient === 0 || candidate.leaguePlatoonExactTarget === true) {
    return leagueTarget;
  }
  return pooledEstimate(
    counts ?? emptyCounts(categories),
    categories,
    leagueTarget,
    positive(candidate.leaguePlatoonEquivalentPa, 'league platoon equivalent PA'),
  );
}

function playerAdjustedTarget(batterOverall, leagueMatchup, leagueTarget, categories) {
  return normalize(
    Object.fromEntries(
      categories.map((category) => [
        category,
        batterOverall[category] * (leagueMatchup[category] / leagueTarget[category]),
      ]),
    ),
    categories,
    'player plus league platoon target',
  );
}

function splitEstimate(candidate, counts, target, categories) {
  if (candidate.platoonCoefficient === 0 || candidate.playerSplitExactTarget === true) {
    return target;
  }
  return pooledEstimate(
    counts ?? emptyCounts(categories),
    categories,
    target,
    positive(candidate.playerSplitEquivalentPa, 'player split equivalent PA'),
  );
}

function applyPlatoon(batterOverall, split, coefficient, categories) {
  if (coefficient === 0) return batterOverall;
  return stableSoftmax(
    Object.fromEntries(
      categories.map((category) => [
        category,
        Math.log(batterOverall[category]) +
          coefficient * (Math.log(split[category]) - Math.log(batterOverall[category])),
      ]),
    ),
    categories,
  );
}

function coherentMatchup(artifact, batterVector, pitcherVector) {
  const categories = artifact.categories;
  return stableSoftmax(
    Object.fromEntries(
      categories.map((category) => {
        const leagueLog = Math.log(artifact.leagueTarget[category]);
        return [
          category,
          leagueLog +
            artifact.baseParameters.batterCoefficient *
              (Math.log(batterVector[category]) - leagueLog) +
            artifact.baseParameters.pitcherAllowedCoefficient *
              (Math.log(pitcherVector[category]) - leagueLog),
        ];
      }),
    ),
    categories,
  );
}

function platoonEvaluationIdentity(value) {
  return {
    activeSeason: value.activeSeason,
    sourceDatasetSha256: value.sourceDatasetSha256,
    sourceDatasetFileSha256: value.sourceDatasetFileSha256,
    sourceFixedEvaluationSha256: value.sourceFixedEvaluationSha256,
    sourceFixedEvaluationFileSha256: value.sourceFixedEvaluationFileSha256,
    sourceWalkForwardSha256: value.sourceWalkForwardSha256,
    sourceWalkForwardFileSha256: value.sourceWalkForwardFileSha256,
    canonicalCategories: value.canonicalCategories,
    modeledCategories: value.modeledCategories,
    structuralZeroCategories: value.structuralZeroCategories,
    hitCategories: value.hitCategories,
    baseParameters: value.baseParameters,
    platoonModel: value.platoonModel,
    cohorts: value.cohorts,
    candidates: value.candidates,
    results: value.results,
    baseline: value.baseline,
    selection: value.selection,
    improvementVersusNoPlatoon: value.improvementVersusNoPlatoon,
    selectedBoundaryFlags: value.selectedBoundaryFlags,
    untouchedTestReservation: value.untouchedTestReservation,
  };
}

function artifactIdentity(value) {
  return {
    artifactVersion: value.artifactVersion,
    modelVersion: value.modelVersion,
    status: value.status,
    productionEnabled: value.productionEnabled,
    activeSeason: value.activeSeason,
    sourceDatasetSha256: value.sourceDatasetSha256,
    sourceDatasetFileSha256: value.sourceDatasetFileSha256,
    sourcePlatoonEvaluationSha256: value.sourcePlatoonEvaluationSha256,
    sourcePlatoonEvaluationFileSha256: value.sourcePlatoonEvaluationFileSha256,
    fitWindow: value.fitWindow,
    validationWindow: value.validationWindow,
    categories: value.categories,
    hitCategories: value.hitCategories,
    structuralZeroCategories: value.structuralZeroCategories,
    baseParameters: value.baseParameters,
    selectedPlatoonCandidate: value.selectedPlatoonCandidate,
    rowCounts: value.rowCounts,
    leagueCounts: value.leagueCounts,
    leagueTarget: value.leagueTarget,
    batterCounts: value.batterCounts,
    pitcherCounts: value.pitcherCounts,
    matchupCounts: value.matchupCounts,
    batterSplitCounts: value.batterSplitCounts,
    batterOverall: value.batterOverall,
    pitcherAllowed: value.pitcherAllowed,
    leaguePlatoonByMatchup: value.leaguePlatoonByMatchup,
    batterSplitByMatchup: value.batterSplitByMatchup,
    unseenBatter: value.unseenBatter,
    unseenPitcher: value.unseenPitcher,
    untouchedTestReservation: value.untouchedTestReservation,
  };
}

function validateDataset(dataset) {
  const value = object(dataset, 'resolved categorical dataset');
  if (value.datasetVersion !== 3) throw new Error('resolved categorical datasetVersion must equal 3.');
  if (value.untouchedTestReservation?.rowsIncluded !== false) {
    throw new Error('resolved categorical dataset must keep the untouched test sealed.');
  }
  return value;
}

function validateEvaluation(evaluation, dataset) {
  const value = object(evaluation, 'platoon boundary evaluation');
  if (value.platoonEvaluationVersion !== 1) throw new Error('platoon evaluation version must equal 1.');
  if (value.platoonEvaluationSha256 !== sha256(JSON.stringify(platoonEvaluationIdentity(value)))) {
    throw new Error('platoon evaluation SHA-256 is invalid.');
  }
  if (value.sourceDatasetSha256 !== dataset.datasetSha256) {
    throw new Error('platoon evaluation does not reference the supplied dataset.');
  }
  if (!value.selection?.selectedCandidate) throw new Error('platoon evaluation did not select a candidate.');
  return value;
}

export function buildM8TerminalPaOutcomeArtifact({
  rawDataset,
  datasetFileSha256,
  rawPlatoonEvaluation,
  platoonEvaluationFileSha256,
}) {
  const dataset = validateDataset(rawDataset);
  const evaluation = validateEvaluation(rawPlatoonEvaluation, dataset);
  const categories = Object.freeze(array(evaluation.modeledCategories, 'modeled categories').map((v, i) => string(v, `category ${i}`)));
  const hitCategories = Object.freeze(array(evaluation.hitCategories, 'hit categories').map((v, i) => string(v, `hit category ${i}`)));
  const selected = Object.freeze({ ...evaluation.selection.selectedCandidate });
  const baseParameters = Object.freeze({
    batterPooling: positive(evaluation.baseParameters.batterPooling, 'batter pooling'),
    pitcherPooling: positive(evaluation.baseParameters.pitcherPooling, 'pitcher pooling'),
    batterCoefficient: nonNegative(evaluation.baseParameters.batterCoefficient, 'batter coefficient'),
    pitcherAllowedCoefficient: nonNegative(evaluation.baseParameters.pitcherAllowedCoefficient, 'pitcher coefficient'),
  });

  const rows = [];
  const periodCounts = {};
  for (const periodId of PERIODS) {
    const period = object(dataset.periods?.[periodId], `${periodId} period`);
    const periodRows = array(period.rows, `${periodId} rows`).filter(
      (row) => row.mappingStatus === 'classified-terminal' && row.includedInOverallOutcomeModel === true,
    );
    periodCounts[periodId] = periodRows.length;
    rows.push(...periodRows);
  }
  if (rows.length === 0) throw new Error('terminal artifact requires classified current-season rows.');

  const leagueCounts = emptyCounts(categories);
  const batterCounts = new Map();
  const pitcherCounts = new Map();
  const matchupCounts = new Map();
  const splitCounts = new Map();

  for (const row of rows) {
    const category = string(row.terminalCategory, 'terminal category');
    if (!categories.includes(category)) throw new Error(`unsupported terminal category ${category}.`);
    const batterId = integer(row.providerBatterId, 'batter id');
    const pitcherId = integer(row.providerPitcherId, 'pitcher id');
    leagueCounts[category] += 1;
    addCount(batterCounts, batterId, category, categories);
    addCount(pitcherCounts, pitcherId, category, categories);
    if (row.includedInPlatoonModel === true) {
      const batterSide = string(row.normalizedBatterSide, 'batter side');
      const pitcherHand = string(row.normalizedPitcherHand, 'pitcher hand');
      if (!VALID_HANDS.has(batterSide) || !VALID_HANDS.has(pitcherHand)) {
        throw new Error('platoon-eligible row is missing normalized L/R hands.');
      }
      const matchup = platoonKey(batterSide, pitcherHand);
      addCount(matchupCounts, matchup, category, categories);
      addCount(splitCounts, splitKey(batterId, matchup), category, categories);
    }
  }

  const leagueTarget = leagueTargetFromCounts(leagueCounts, categories);
  const batterOverall = new Map();
  for (const [id, counts] of batterCounts) {
    batterOverall.set(id, pooledEstimate(counts, categories, leagueTarget, baseParameters.batterPooling));
  }
  const pitcherAllowed = new Map();
  for (const [id, counts] of pitcherCounts) {
    pitcherAllowed.set(id, pooledEstimate(counts, categories, leagueTarget, baseParameters.pitcherPooling));
  }
  const unseenBatter = pooledEstimate(emptyCounts(categories), categories, leagueTarget, baseParameters.batterPooling);
  const unseenPitcher = pooledEstimate(emptyCounts(categories), categories, leagueTarget, baseParameters.pitcherPooling);

  const leaguePlatoonByMatchup = new Map();
  const batterSplitByMatchup = new Map();
  if (selected.platoonCoefficient > 0) {
    for (const batterSide of VALID_HANDS) {
      for (const pitcherHand of VALID_HANDS) {
        const matchup = platoonKey(batterSide, pitcherHand);
        leaguePlatoonByMatchup.set(
          matchup,
          leagueMatchupTarget(selected, matchupCounts.get(matchup), categories, leagueTarget),
        );
      }
    }
    for (const [id, overall] of batterOverall) {
      for (const [matchup, leagueMatchup] of leaguePlatoonByMatchup) {
        const target = playerAdjustedTarget(overall, leagueMatchup, leagueTarget, categories);
        batterSplitByMatchup.set(
          splitKey(id, matchup),
          splitEstimate(selected, splitCounts.get(splitKey(id, matchup)), target, categories),
        );
      }
    }
  }

  const identity = {
    artifactVersion: 1,
    modelVersion: 'm8-terminal-pa-outcome-v1',
    status: 'frozen-current-season-candidate-awaiting-untouched-test',
    productionEnabled: false,
    activeSeason: integer(dataset.activeSeason, 'active season'),
    sourceDatasetSha256: string(dataset.datasetSha256, 'dataset SHA-256'),
    sourceDatasetFileSha256: string(datasetFileSha256, 'dataset file SHA-256'),
    sourcePlatoonEvaluationSha256: string(evaluation.platoonEvaluationSha256, 'platoon evaluation SHA-256'),
    sourcePlatoonEvaluationFileSha256: string(platoonEvaluationFileSha256, 'platoon evaluation file SHA-256'),
    fitWindow: Object.freeze({ startDate: dataset.periods.fit.startDate, endDate: dataset.periods.fit.endDate, observationCount: periodCounts.fit }),
    validationWindow: Object.freeze({ startDate: dataset.periods.validation.startDate, endDate: dataset.periods.validation.endDate, observationCount: periodCounts.validation }),
    categories,
    hitCategories,
    structuralZeroCategories: Object.freeze([...(evaluation.structuralZeroCategories ?? [])]),
    baseParameters,
    selectedPlatoonCandidate: selected,
    rowCounts: Object.freeze({ fit: periodCounts.fit, validation: periodCounts.validation, total: rows.length }),
    leagueCounts: Object.freeze({ ...leagueCounts }),
    leagueTarget,
    batterCounts: countsToObject(batterCounts),
    pitcherCounts: countsToObject(pitcherCounts),
    matchupCounts: countsToObject(matchupCounts),
    batterSplitCounts: countsToObject(splitCounts),
    batterOverall: distributionsToObject(batterOverall),
    pitcherAllowed: distributionsToObject(pitcherAllowed),
    leaguePlatoonByMatchup: distributionsToObject(leaguePlatoonByMatchup),
    batterSplitByMatchup: distributionsToObject(batterSplitByMatchup),
    unseenBatter,
    unseenPitcher,
    untouchedTestReservation: Object.freeze({ ...dataset.untouchedTestReservation, rowsIncluded: false }),
  };
  return Object.freeze({
    purpose: 'Frozen current-season coherent terminal plate-appearance outcome parameters for Batter Hits, including one pooling pass, batter and pitcher-allowed effects, and the selected platoon interaction.',
    ...identity,
    artifactSha256: sha256(JSON.stringify(identity)),
  });
}

export function verifyM8TerminalPaOutcomeArtifact(rawArtifact) {
  const artifact = object(rawArtifact, 'terminal PA outcome artifact');
  if (artifact.artifactVersion !== 1 || artifact.productionEnabled !== false) {
    throw new Error('unsupported terminal PA outcome artifact contract.');
  }
  const categories = array(artifact.categories, 'artifact categories');
  probabilityVector(artifact.leagueTarget, categories, 'league target');
  probabilityVector(artifact.unseenBatter, categories, 'unseen batter');
  probabilityVector(artifact.unseenPitcher, categories, 'unseen pitcher');
  for (const [label, collection] of [
    ['batterOverall', artifact.batterOverall],
    ['pitcherAllowed', artifact.pitcherAllowed],
    ['leaguePlatoonByMatchup', artifact.leaguePlatoonByMatchup],
    ['batterSplitByMatchup', artifact.batterSplitByMatchup],
  ]) {
    for (const [key, vector] of Object.entries(object(collection, label))) {
      probabilityVector(vector, categories, `${label}.${key}`);
    }
  }
  if (artifact.untouchedTestReservation?.rowsIncluded !== false) {
    throw new Error('terminal artifact exposes untouched-test rows.');
  }
  if (artifact.artifactSha256 !== sha256(JSON.stringify(artifactIdentity(artifact)))) {
    throw new Error('terminal PA outcome artifact SHA-256 is invalid.');
  }
  return artifact;
}

export function terminalPaOutcomeProbabilities({ artifact: rawArtifact, batterId, pitcherId, batterSide, pitcherHand }) {
  const artifact = verifyM8TerminalPaOutcomeArtifact(rawArtifact);
  const categories = artifact.categories;
  const batterKey = String(integer(batterId, 'batter id'));
  const pitcherKey = String(integer(pitcherId, 'pitcher id'));
  const batterOverall = artifact.batterOverall[batterKey] ?? artifact.unseenBatter;
  const pitcherVector = artifact.pitcherAllowed[pitcherKey] ?? artifact.unseenPitcher;
  let batterVector = batterOverall;
  if (
    artifact.selectedPlatoonCandidate.platoonCoefficient > 0 &&
    VALID_HANDS.has(batterSide) &&
    VALID_HANDS.has(pitcherHand)
  ) {
    const matchup = platoonKey(batterSide, pitcherHand);
    const split =
      artifact.batterSplitByMatchup[splitKey(batterKey, matchup)] ??
      playerAdjustedTarget(
        batterOverall,
        artifact.leaguePlatoonByMatchup[matchup],
        artifact.leagueTarget,
        categories,
      );
    batterVector = applyPlatoon(
      batterOverall,
      split,
      artifact.selectedPlatoonCandidate.platoonCoefficient,
      categories,
    );
  }
  return coherentMatchup(artifact, batterVector, pitcherVector);
}
