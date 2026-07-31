const EXPECTED_UNTOUCHED_START = '2026-07-30';
const EXPECTED_UNTOUCHED_END = '2026-08-04';

export const M9_BATTER_HITS_V5_FREEZE_CONTRACT = Object.freeze({
  purpose:
    'Frozen M9 Batter Hits V5 acceptance runtime manifest containing only preselected current-season components and explicit identity/deferred component declarations.',
  modelVersion: 'm9-batter-hits-v5-runtime-freeze-v1',
  settlementVersion: 'batter-hits-settlement-not-production-validated',
  settlementRegistryVersion: 'settlement-registry-v1',
  status: 'frozen-current-season-v5-runtime-manifest-before-untouched-test',
});

export const M9_BATTER_HITS_V5_EXPECTED_CANDIDATES = Object.freeze({
  recencyWeighting: 'uniform',
  batterPooling: 'league-pa-128',
  pitcherAllowedPooling: 'league-pa-256',
  coherentMatchup: 'batter-1.00-pitcher-1.00',
  platoon:
    'league-raw-cell-limit-split-target-only-coefficient-0.75',
  starterBullpenTransition: 'starter-bf-league',
  paSurvival: 'slot-home-away-pool-25',
  sharedOffensiveEnvironment: 'shared-environment-k4',
});

function object(value, label) {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new TypeError(`${label} must be an object.`);
  }
  return value;
}

function nonEmptyString(value, label) {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new TypeError(`${label} must be a non-empty string.`);
  }
  return value.trim();
}

function source(rawSource, label) {
  const value = object(rawSource, label);
  return Object.freeze({
    path: nonEmptyString(value.path, `${label}.path`),
    value: object(value.value, `${label}.value`),
  });
}

function nonEmptyStringArray(value, label) {
  if (!Array.isArray(value) || value.length === 0) {
    throw new TypeError(`${label} must be a non-empty array.`);
  }
  const normalized = value.map((item, index) =>
    nonEmptyString(item, `${label}[${index}]`),
  );
  if (new Set(normalized).size !== normalized.length) {
    throw new Error(`${label} must not contain duplicates.`);
  }
  return Object.freeze(normalized);
}

function exact(value, expected, label) {
  if (value !== expected) {
    throw new Error(`${label} must equal ${expected}; received ${value}.`);
  }
  return value;
}

function candidateId(value, label) {
  return nonEmptyString(value, label);
}

function validateReservation(rawValue, label) {
  const value = object(rawValue, label);
  exact(value.startDate, EXPECTED_UNTOUCHED_START, `${label}.startDate`);
  exact(value.endDate, EXPECTED_UNTOUCHED_END, `${label}.endDate`);
  exact(value.rowsIncluded, false, `${label}.rowsIncluded`);
  if (Object.hasOwn(value, 'rows')) {
    throw new Error(`${label} must not expose untouched-test rows.`);
  }
  return value;
}

function validateSourceReservation(sourceValue, label) {
  return validateReservation(
    sourceValue.untouchedTestReservation,
    `${label}.untouchedTestReservation`,
  );
}

function assertArtifactSha(value, label) {
  const normalized = nonEmptyString(value, label);
  if (!/^[a-f0-9]{64}$/u.test(normalized)) {
    throw new Error(`${label} must be a lowercase SHA-256 digest.`);
  }
  return normalized;
}

function selectedRecency(fixed, walk) {
  const fixedId = candidateId(
    fixed.selection?.selectedCandidate?.candidateId,
    'recency fixed selected candidate',
  );
  const walkId = candidateId(
    walk.selection?.selectedCandidate?.candidateId,
    'recency walk-forward selected candidate',
  );
  exact(walkId, fixedId, 'recency walk-forward candidate');
  exact(
    fixedId,
    M9_BATTER_HITS_V5_EXPECTED_CANDIDATES.recencyWeighting,
    'V5 recency candidate',
  );
  return fixedId;
}

function selectedPooling(pooling, key, expectedCandidateId, terminalStrength) {
  const parameter = object(pooling.parameters?.[key], `pooling parameters.${key}`);
  exact(parameter.stableSelection, true, `${key}.stableSelection`);
  const fixedIds = nonEmptyStringArray(
    parameter.fixedNondominatedCandidateIds,
    `${key}.fixedNondominatedCandidateIds`,
  );
  const walkIds = nonEmptyStringArray(
    parameter.walkForwardNondominatedCandidateIds,
    `${key}.walkForwardNondominatedCandidateIds`,
  );
  const stableIds = nonEmptyStringArray(
    parameter.stableCandidateIds,
    `${key}.stableCandidateIds`,
  );
  const selectedId = candidateId(
    parameter.selectedCandidateId,
    `${key}.selectedCandidateId`,
  );
  exact(selectedId, expectedCandidateId, `${key} V5 selected candidate`);
  if (!fixedIds.includes(selectedId) || !walkIds.includes(selectedId) || !stableIds.includes(selectedId)) {
    throw new Error(`${key} selected candidate is not in every required stable set.`);
  }
  const result = parameter.fixedResults?.find(
    (entry) => entry?.candidate?.candidateId === selectedId,
  );
  if (!result) {
    throw new Error(`${key} selected candidate is missing from fixed results.`);
  }
  exact(
    result.candidate.leagueEquivalentPa,
    terminalStrength,
    `${key} selected pooling strength versus terminal artifact`,
  );
  return Object.freeze({ selectedId, fixedIds, walkIds });
}

function selectedCoherent(fixed, walk, terminal) {
  const fixedCandidate = object(
    fixed.coherentMatchup?.selection?.selectedCandidate,
    'coherent fixed selected candidate',
  );
  const walkCandidate = object(
    walk.aggregateSelection?.selectedCandidate,
    'coherent walk-forward selected candidate',
  );
  const selectedId = candidateId(
    fixedCandidate.candidateId,
    'coherent fixed selected candidateId',
  );
  exact(
    candidateId(walkCandidate.candidateId, 'coherent walk-forward selected candidateId'),
    selectedId,
    'coherent walk-forward selected candidate',
  );
  exact(
    selectedId,
    M9_BATTER_HITS_V5_EXPECTED_CANDIDATES.coherentMatchup,
    'V5 coherent candidate',
  );
  exact(
    fixedCandidate.batterCoefficient,
    terminal.baseParameters?.batterCoefficient,
    'coherent batter coefficient versus terminal artifact',
  );
  exact(
    fixedCandidate.pitcherAllowedCoefficient,
    terminal.baseParameters?.pitcherAllowedCoefficient,
    'coherent pitcher coefficient versus terminal artifact',
  );
  return selectedId;
}

function selectedPlatoon(fixed, walk, terminal) {
  const fixedId = candidateId(
    fixed.selection?.selectedCandidate?.candidateId,
    'platoon fixed selected candidate',
  );
  const walkId = candidateId(
    walk.frozenCandidate?.candidateId,
    'platoon walk-forward frozen candidate',
  );
  const terminalId = candidateId(
    terminal.selectedPlatoonCandidate?.candidateId,
    'terminal selected platoon candidate',
  );
  exact(walkId, fixedId, 'platoon walk-forward selected candidate');
  exact(terminalId, fixedId, 'terminal platoon candidate');
  exact(
    fixedId,
    M9_BATTER_HITS_V5_EXPECTED_CANDIDATES.platoon,
    'V5 platoon candidate',
  );
  return fixedId;
}

function selectedStarterBullpen(evaluation, sharedV2) {
  exact(evaluation.stableSelection, true, 'starter-bullpen stableSelection');
  const selectedId = candidateId(
    evaluation.selectedCandidateId,
    'starter-bullpen selected candidate',
  );
  exact(
    selectedId,
    M9_BATTER_HITS_V5_EXPECTED_CANDIDATES.starterBullpenTransition,
    'V5 starter-bullpen candidate',
  );
  const fixedIds = nonEmptyStringArray(
    evaluation.fixedNondominatedCandidateIds,
    'starter-bullpen fixed nondominated candidates',
  );
  const walkIds = nonEmptyStringArray(
    evaluation.walkForwardNondominatedCandidateIds,
    'starter-bullpen walk-forward nondominated candidates',
  );
  const admissibleIds = nonEmptyStringArray(
    evaluation.admissibleCandidateIds,
    'starter-bullpen admissible candidates',
  );
  if (!fixedIds.includes(selectedId) || !walkIds.includes(selectedId) || !admissibleIds.includes(selectedId)) {
    throw new Error('starter-bullpen selected candidate is not in every required stable set.');
  }
  exact(
    sharedV2.starterBullpenTransition?.selectedCandidate?.candidateId,
    selectedId,
    'shared-environment V2 starter-bullpen candidate',
  );
  return Object.freeze({ selectedId, fixedIds, walkIds });
}

function selectedPaSurvival(fixed, walk, artifact) {
  const selectedId = candidateId(
    artifact.selectedCandidateId,
    'PA-survival artifact selected candidate',
  );
  exact(
    fixed.selectedCandidateId,
    selectedId,
    'PA-survival fixed selected candidate',
  );
  exact(
    walk.sourceHoldoutSelectedCandidateId,
    selectedId,
    'PA-survival walk-forward source candidate',
  );
  exact(
    walk.selectedCandidateId,
    selectedId,
    'PA-survival walk-forward selected candidate',
  );
  exact(
    selectedId,
    M9_BATTER_HITS_V5_EXPECTED_CANDIDATES.paSurvival,
    'V5 PA-survival candidate',
  );
  return selectedId;
}

function selectedSharedEnvironment(fixed, walk, artifact, sharedV2) {
  const selectedId = candidateId(
    artifact.selectedCandidateId,
    'shared-environment artifact selected candidate',
  );
  exact(
    fixed.selectedCandidate?.candidateId,
    selectedId,
    'shared-environment fixed selected candidate',
  );
  exact(
    walk.selectedCandidate?.candidateId,
    selectedId,
    'shared-environment walk-forward selected candidate',
  );
  exact(
    selectedId,
    M9_BATTER_HITS_V5_EXPECTED_CANDIDATES.sharedOffensiveEnvironment,
    'V5 shared-environment candidate',
  );
  exact(
    sharedV2.sourceSharedEnvironmentArtifactSha256,
    artifact.artifactSha256,
    'shared-environment V2 source artifact SHA-256',
  );
  return selectedId;
}

export function buildM9BatterHitsV5FreezeRunSpecification({
  rootPath,
  outputPath,
  sources: rawSources,
}) {
  const root = nonEmptyString(rootPath, 'rootPath');
  const output = nonEmptyString(outputPath, 'outputPath');
  const inputs = object(rawSources, 'sources');
  const sources = Object.fromEntries(
    Object.entries(inputs).map(([key, value]) => [key, source(value, `sources.${key}`)]),
  );

  const requiredKeys = [
    'recencyFixed',
    'recencyWalk',
    'poolingWalk',
    'categoricalFixed',
    'categoricalWalk',
    'platoonFixed',
    'platoonWalk',
    'starterBullpenEvaluation',
    'paFixed',
    'paWalk',
    'paArtifact',
    'sharedFixed',
    'sharedWalk',
    'sharedArtifact',
    'sharedV2',
    'retentionArtifact',
    'terminalArtifact',
    'completeCandidate',
  ];
  for (const key of requiredKeys) {
    if (!sources[key]) throw new Error(`sources.${key} is required.`);
    validateSourceReservation(sources[key].value, `sources.${key}`);
  }

  const paArtifactSha = assertArtifactSha(
    sources.paArtifact.value.artifactSha256,
    'PA-survival artifact SHA-256',
  );
  const retentionArtifactSha = assertArtifactSha(
    sources.retentionArtifact.value.artifactSha256,
    'starter-retention artifact SHA-256',
  );
  const sharedArtifactSha = assertArtifactSha(
    sources.sharedV2.value.artifactSha256,
    'shared-environment V2 artifact SHA-256',
  );
  const terminalArtifactSha = assertArtifactSha(
    sources.terminalArtifact.value.artifactSha256,
    'terminal-PA artifact SHA-256',
  );
  assertArtifactSha(
    sources.completeCandidate.value.artifactSha256,
    'complete-candidate artifact SHA-256',
  );

  exact(
    sources.retentionArtifact.value.selectedCandidate?.candidateId,
    'retention-slot-pool-200',
    'V5 starter-retention candidate',
  );
  exact(
    sources.completeCandidate.value.sourceSharedEnvironmentArtifactSha256,
    sharedArtifactSha,
    'complete-candidate shared-environment source',
  );
  exact(
    sources.completeCandidate.value.sourceStarterRetentionArtifactSha256,
    retentionArtifactSha,
    'complete-candidate starter-retention source',
  );
  exact(
    sources.completeCandidate.value.sourceTerminalOutcomeArtifactSha256,
    terminalArtifactSha,
    'complete-candidate terminal-PA source',
  );

  const recencyId = selectedRecency(
    sources.recencyFixed.value,
    sources.recencyWalk.value,
  );
  const batterPooling = selectedPooling(
    sources.poolingWalk.value,
    'batter',
    M9_BATTER_HITS_V5_EXPECTED_CANDIDATES.batterPooling,
    sources.terminalArtifact.value.baseParameters?.batterPooling,
  );
  const pitcherPooling = selectedPooling(
    sources.poolingWalk.value,
    'pitcherAllowed',
    M9_BATTER_HITS_V5_EXPECTED_CANDIDATES.pitcherAllowedPooling,
    sources.terminalArtifact.value.baseParameters?.pitcherPooling,
  );
  const coherentId = selectedCoherent(
    sources.categoricalFixed.value,
    sources.categoricalWalk.value,
    sources.terminalArtifact.value,
  );
  const platoonId = selectedPlatoon(
    sources.platoonFixed.value,
    sources.platoonWalk.value,
    sources.terminalArtifact.value,
  );
  const starterBullpen = selectedStarterBullpen(
    sources.starterBullpenEvaluation.value,
    sources.sharedV2.value,
  );
  const paId = selectedPaSurvival(
    sources.paFixed.value,
    sources.paWalk.value,
    sources.paArtifact.value,
  );
  const sharedId = selectedSharedEnvironment(
    sources.sharedFixed.value,
    sources.sharedWalk.value,
    sources.sharedArtifact.value,
    sources.sharedV2.value,
  );

  exact(
    sources.poolingWalk.value.productionEnabled,
    false,
    'categorical pooling productionEnabled',
  );
  exact(
    sources.poolingWalk.value.untouchedTestAccessed,
    false,
    'categorical pooling untouchedTestAccessed',
  );
  exact(
    sources.completeCandidate.value.productionEnabled,
    false,
    'complete-candidate productionEnabled',
  );

  const specifications = Object.freeze([
    Object.freeze({
      componentId: 'recencyWeighting',
      candidateId: recencyId,
      fixedPath: sources.recencyFixed.path,
      walkForwardPath: sources.recencyWalk.path,
      fixedNondominatedCandidateIds: [recencyId],
      walkForwardNondominatedCandidateIds: [recencyId],
    }),
    Object.freeze({
      componentId: 'batterPooling',
      candidateId: batterPooling.selectedId,
      fixedPath: sources.categoricalFixed.path,
      walkForwardPath: sources.poolingWalk.path,
      fixedNondominatedCandidateIds: batterPooling.fixedIds,
      walkForwardNondominatedCandidateIds: batterPooling.walkIds,
    }),
    Object.freeze({
      componentId: 'pitcherAllowedPooling',
      candidateId: pitcherPooling.selectedId,
      fixedPath: sources.categoricalFixed.path,
      walkForwardPath: sources.poolingWalk.path,
      fixedNondominatedCandidateIds: pitcherPooling.fixedIds,
      walkForwardNondominatedCandidateIds: pitcherPooling.walkIds,
    }),
    Object.freeze({
      componentId: 'coherentMatchup',
      candidateId: coherentId,
      fixedPath: sources.categoricalFixed.path,
      walkForwardPath: sources.categoricalWalk.path,
      fixedNondominatedCandidateIds: [coherentId],
      walkForwardNondominatedCandidateIds: [coherentId],
    }),
    Object.freeze({
      componentId: 'platoon',
      candidateId: platoonId,
      fixedPath: sources.platoonFixed.path,
      walkForwardPath: sources.platoonWalk.path,
      fixedNondominatedCandidateIds: [platoonId],
      walkForwardNondominatedCandidateIds: [platoonId],
    }),
    Object.freeze({
      componentId: 'starterBullpenTransition',
      candidateId: starterBullpen.selectedId,
      fixedPath: sources.starterBullpenEvaluation.path,
      walkForwardPath: sources.starterBullpenEvaluation.path,
      fixedNondominatedCandidateIds: starterBullpen.fixedIds,
      walkForwardNondominatedCandidateIds: starterBullpen.walkIds,
    }),
    Object.freeze({
      componentId: 'paSurvival',
      candidateId: paId,
      fixedPath: sources.paFixed.path,
      walkForwardPath: sources.paWalk.path,
      fixedNondominatedCandidateIds: [paId],
      walkForwardNondominatedCandidateIds: [paId],
    }),
    Object.freeze({
      componentId: 'sharedOffensiveEnvironment',
      candidateId: sharedId,
      fixedPath: sources.sharedFixed.path,
      walkForwardPath: sources.sharedWalk.path,
      fixedNondominatedCandidateIds: [sharedId],
      walkForwardNondominatedCandidateIds: [sharedId],
    }),
  ]);

  return Object.freeze({
    activeSeason: 2026,
    outputPath: output,
    contract: M9_BATTER_HITS_V5_FREEZE_CONTRACT,
    specifications,
    runtimeSourcePaths: Object.freeze([
      sources.paArtifact.path,
      sources.retentionArtifact.path,
      sources.sharedV2.path,
      sources.terminalArtifact.path,
      sources.completeCandidate.path,
    ]),
    reservationSourcePath: sources.terminalArtifact.path,
    rootPath: root,
    sourceArtifactSha256: Object.freeze({
      paSurvival: paArtifactSha,
      starterRetention: retentionArtifactSha,
      sharedEnvironmentV2: sharedArtifactSha,
      terminalPa: terminalArtifactSha,
      completeCandidate: sources.completeCandidate.value.artifactSha256,
    }),
  });
}
