import { sha256 } from './provider-probe-utils.mjs';

const TOLERANCE = 1e-12;

export const REQUIRED_FITTED_COMPONENT_IDS = Object.freeze([
  'recencyWeighting',
  'batterPooling',
  'pitcherAllowedPooling',
  'coherentMatchup',
  'platoon',
  'starterBullpenTransition',
  'paSurvival',
  'sharedOffensiveEnvironment',
]);

export const M8_BATTER_HITS_CLOSEOUT_CONTRACT = Object.freeze({
  purpose:
    'Frozen M8 Batter Hits runtime manifest containing only already-selected current-season components and explicit identity/deferred component declarations.',
  modelVersion: 'm8-batter-hits-runtime-freeze-v1',
  settlementVersion: 'batter-hits-settlement-not-production-validated',
  settlementRegistryVersion: 'settlement-registry-v1',
  status: 'frozen-current-season-runtime-manifest-before-untouched-test',
});

export const M8_DEFERRED_COMPONENT_MANIFEST = Object.freeze({
  park: Object.freeze({
    modeled: false,
    reason: 'deferred, not fitted in M8',
    adjustment: 'identity',
  }),
  defenseToBattedBall: Object.freeze({
    modeled: false,
    reason: 'deferred, not fitted in M8',
    adjustment: 'identity',
  }),
  timesThroughOrder: Object.freeze({
    modeled: false,
    reason: 'deferred, not fitted in M8',
    adjustment: 'identity',
  }),
  eligibilityAndParticipation: Object.freeze({
    modeled: false,
    reason: 'deferred to the ranking pipeline',
    adjustment: 'runtime-gate',
  }),
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

function stringArray(value, label) {
  if (!Array.isArray(value) || value.length === 0) {
    throw new TypeError(`${label} must be a non-empty array.`);
  }

  const normalized = value.map((item, index) =>
    nonEmptyString(item, `${label}[${index}]`),
  );

  return Object.freeze([...new Set(normalized)].sort());
}

function validateFreezeContract(rawContract) {
  const contract = object(rawContract, 'closeout freeze contract');

  return Object.freeze({
    purpose: nonEmptyString(contract.purpose, 'closeout freeze contract purpose'),
    modelVersion: nonEmptyString(
      contract.modelVersion,
      'closeout freeze contract modelVersion',
    ),
    settlementVersion: nonEmptyString(
      contract.settlementVersion,
      'closeout freeze contract settlementVersion',
    ),
    settlementRegistryVersion: nonEmptyString(
      contract.settlementRegistryVersion,
      'closeout freeze contract settlementRegistryVersion',
    ),
    status: nonEmptyString(contract.status, 'closeout freeze contract status'),
  });
}

function candidateAppears(value, candidateId) {
  if (value === candidateId) return true;

  if (Array.isArray(value)) {
    return value.some((item) => candidateAppears(item, candidateId));
  }

  if (value !== null && typeof value === 'object') {
    return Object.values(value).some((item) =>
      candidateAppears(item, candidateId),
    );
  }

  return false;
}

function extractCandidateIds(value, results = []) {
  if (typeof value === 'string') {
    results.push(value);
    return results;
  }

  if (Array.isArray(value)) {
    for (const item of value) extractCandidateIds(item, results);
    return results;
  }

  if (value !== null && typeof value === 'object') {
    if (typeof value.candidateId === 'string') {
      results.push(value.candidateId);
    }

    if (typeof value.selectedCandidateId === 'string') {
      results.push(value.selectedCandidateId);
    }

    if (typeof value.candidate?.candidateId === 'string') {
      results.push(value.candidate.candidateId);
    }

    for (const child of Object.values(value)) {
      extractCandidateIds(child, results);
    }
  }

  return results;
}

function collectNondominatedSets(value) {
  const sets = [];

  function visit(node, path) {
    if (Array.isArray(node)) {
      if (/nondominated/i.test(path)) {
        const candidateIds = [
          ...new Set(extractCandidateIds(node).filter(Boolean)),
        ].sort();

        if (candidateIds.length > 0) {
          sets.push(Object.freeze({ path, candidateIds }));
        }
      }

      node.forEach((item, index) => visit(item, `${path}[${index}]`));
      return;
    }

    if (node !== null && typeof node === 'object') {
      for (const [key, child] of Object.entries(node)) {
        visit(child, `${path}.${key}`);
      }
    }
  }

  visit(value, '$');

  return Object.freeze(
    sets.sort(
      (left, right) =>
        left.path.localeCompare(right.path) ||
        JSON.stringify(left.candidateIds).localeCompare(
          JSON.stringify(right.candidateIds),
        ),
    ),
  );
}

function collectProperScores(value) {
  const scores = [];

  function visit(node, path) {
    if (typeof node === 'number' && Number.isFinite(node)) {
      if (/(log.?loss|brier)/i.test(path)) {
        scores.push(Object.freeze({ path, value: node }));
      }
      return;
    }

    if (Array.isArray(node)) {
      node.forEach((item, index) => visit(item, `${path}[${index}]`));
      return;
    }

    if (node !== null && typeof node === 'object') {
      for (const [key, child] of Object.entries(node)) {
        visit(child, `${path}.${key}`);
      }
    }
  }

  visit(value, '$');

  return Object.freeze(
    scores.sort(
      (left, right) =>
        left.path.localeCompare(right.path) || left.value - right.value,
    ),
  );
}

function assertUntouchedRowsSealed(value, path = '$') {
  if (Array.isArray(value)) {
    value.forEach((item, index) =>
      assertUntouchedRowsSealed(item, `${path}[${index}]`),
    );
    return;
  }

  if (value === null || typeof value !== 'object') return;

  for (const [key, child] of Object.entries(value)) {
    const childPath = `${path}.${key}`;

    if (
      key === 'rowsIncluded' &&
      child === true &&
      /untouched|testReservation/i.test(path)
    ) {
      throw new Error(`${childPath} exposes untouched-test rows.`);
    }

    assertUntouchedRowsSealed(child, childPath);
  }
}

export function summarizeSelectedEvidence({
  sourcePath,
  sourceValue,
  candidateId,
  declaredNondominatedCandidateIds,
}) {
  const path = nonEmptyString(sourcePath, 'sourcePath');
  const candidate = nonEmptyString(candidateId, 'candidateId');
  const source = object(sourceValue, `${path} source`);

  assertUntouchedRowsSealed(source);

  const explicitNondominatedSets = collectNondominatedSets(source);
  const properScores = collectProperScores(source);

  if (properScores.length === 0) {
    throw new Error(`${path} contains no log-loss or Brier evidence.`);
  }

  return Object.freeze({
    sourcePath: path,
    sourceSha256: sha256(JSON.stringify(source)),
    selectedCandidateObserved: candidateAppears(source, candidate),
    declaredNondominatedCandidateIds: stringArray(
      declaredNondominatedCandidateIds,
      `${path}.declaredNondominatedCandidateIds`,
    ),
    explicitNondominatedSets,
    properScores,
  });
}

function validateDeferredManifest(rawManifest) {
  const manifest = object(rawManifest, 'deferred component manifest');

  for (const componentId of [
    'park',
    'defenseToBattedBall',
    'timesThroughOrder',
  ]) {
    const component = object(manifest[componentId], componentId);

    if (
      component.modeled !== false ||
      component.reason !== 'deferred, not fitted in M8' ||
      component.adjustment !== 'identity'
    ) {
      throw new Error(`${componentId} must be an explicit identity component.`);
    }
  }

  const eligibility = object(
    manifest.eligibilityAndParticipation,
    'eligibilityAndParticipation',
  );

  if (
    eligibility.modeled !== false ||
    eligibility.reason !== 'deferred to the ranking pipeline' ||
    eligibility.adjustment !== 'runtime-gate'
  ) {
    throw new Error(
      'eligibilityAndParticipation must be deferred to the ranking pipeline.',
    );
  }

  return manifest;
}

function validateFittedComponents(rawComponents) {
  const components = object(rawComponents, 'fittedComponents');
  const actualIds = Object.keys(components).sort();
  const requiredIds = [...REQUIRED_FITTED_COMPONENT_IDS].sort();

  if (JSON.stringify(actualIds) !== JSON.stringify(requiredIds)) {
    throw new Error(
      `fittedComponents must contain exactly: ${requiredIds.join(', ')}.`,
    );
  }

  return Object.freeze(
    Object.fromEntries(
      REQUIRED_FITTED_COMPONENT_IDS.map((componentId) => {
        const component = object(
          components[componentId],
          `fittedComponents.${componentId}`,
        );

        const candidateId = nonEmptyString(
          component.candidateId,
          `fittedComponents.${componentId}.candidateId`,
        );

        const fixed = object(
          component.fixedValidation,
          `fittedComponents.${componentId}.fixedValidation`,
        );

        const walkForward = object(
          component.walkForward,
          `fittedComponents.${componentId}.walkForward`,
        );

        if (
          fixed.selectedCandidateObserved !== true &&
          walkForward.selectedCandidateObserved !== true
        ) {
          throw new Error(
            `${componentId} candidate ${candidateId} is absent from both evidence artifacts.`,
          );
        }

        if (
          !Array.isArray(fixed.properScores) ||
          fixed.properScores.length === 0 ||
          !Array.isArray(walkForward.properScores) ||
          walkForward.properScores.length === 0
        ) {
          throw new Error(
            `${componentId} must preserve fixed and walk-forward proper scores.`,
          );
        }

        return [
          componentId,
          Object.freeze({
            candidateId,
            fixedValidation: fixed,
            walkForward,
          }),
        ];
      }),
    ),
  );
}

function validateRuntimeSourceArtifacts(rawSources, { sort = false } = {}) {
  if (!Array.isArray(rawSources) || rawSources.length === 0) {
    throw new Error('runtimeSourceArtifacts must be non-empty.');
  }

  const seenPaths = new Set();
  const sources = rawSources.map((source, index) => {
    const value = object(source, `runtimeSourceArtifacts[${index}]`);
    const sourcePath = nonEmptyString(
      value.sourcePath,
      `runtimeSourceArtifacts[${index}].sourcePath`,
    );

    if (seenPaths.has(sourcePath)) {
      throw new Error(`runtimeSourceArtifacts contains duplicate path ${sourcePath}.`);
    }
    seenPaths.add(sourcePath);

    return Object.freeze({
      sourcePath,
      sourceSha256: nonEmptyString(
        value.sourceSha256,
        `runtimeSourceArtifacts[${index}].sourceSha256`,
      ),
    });
  });

  if (sort) {
    sources.sort((left, right) =>
      left.sourcePath.localeCompare(right.sourcePath),
    );
  }

  return Object.freeze(sources);
}

function artifactIdentity(value) {
  return {
    artifactVersion: value.artifactVersion,
    modelVersion: value.modelVersion,
    settlementVersion: value.settlementVersion,
    settlementRegistryVersion: value.settlementRegistryVersion,
    status: value.status,
    productionEnabled: value.productionEnabled,
    untouchedTestAccessed: value.untouchedTestAccessed,
    activeSeason: value.activeSeason,
    componentManifest: value.componentManifest,
    fittedComponents: value.fittedComponents,
    runtimeSourceArtifacts: value.runtimeSourceArtifacts,
    untouchedTestReservation: value.untouchedTestReservation,
  };
}

export function buildBatterHitsCloseoutFreeze({
  activeSeason,
  fittedComponents,
  runtimeSourceArtifacts,
  untouchedTestReservation,
  componentManifest = M8_DEFERRED_COMPONENT_MANIFEST,
  contract = M8_BATTER_HITS_CLOSEOUT_CONTRACT,
}) {
  if (!Number.isSafeInteger(activeSeason) || activeSeason !== 2026) {
    throw new Error('activeSeason must be the 2026 MLB regular season.');
  }

  const validatedContract = validateFreezeContract(contract);
  const manifest = validateDeferredManifest(componentManifest);
  const fitted = validateFittedComponents(fittedComponents);
  const sources = validateRuntimeSourceArtifacts(runtimeSourceArtifacts, {
    sort: true,
  });

  const reservation = object(
    untouchedTestReservation,
    'untouchedTestReservation',
  );

  if (reservation.rowsIncluded !== false) {
    throw new Error('untouched-test reservation must remain sealed.');
  }

  const identity = {
    artifactVersion: 1,
    modelVersion: validatedContract.modelVersion,
    settlementVersion: validatedContract.settlementVersion,
    settlementRegistryVersion:
      validatedContract.settlementRegistryVersion,
    status: validatedContract.status,
    productionEnabled: false,
    untouchedTestAccessed: false,
    activeSeason,
    componentManifest: manifest,
    fittedComponents: fitted,
    runtimeSourceArtifacts: sources,
    untouchedTestReservation: Object.freeze({
      ...reservation,
      rowsIncluded: false,
    }),
  };

  return Object.freeze({
    purpose: validatedContract.purpose,
    ...identity,
    artifactSha256: sha256(JSON.stringify(artifactIdentity(identity))),
  });
}

export function verifyBatterHitsCloseoutFreeze(
  rawArtifact,
  { expectedContract = null } = {},
) {
  const artifact = object(rawArtifact, 'Batter Hits closeout freeze');
  const actualContract = validateFreezeContract({
    purpose: artifact.purpose,
    modelVersion: artifact.modelVersion,
    settlementVersion: artifact.settlementVersion,
    settlementRegistryVersion: artifact.settlementRegistryVersion,
    status: artifact.status,
  });

  if (
    artifact.artifactVersion !== 1 ||
    artifact.productionEnabled !== false ||
    artifact.untouchedTestAccessed !== false ||
    artifact.activeSeason !== 2026
  ) {
    throw new Error('unsupported Batter Hits closeout freeze contract.');
  }

  if (expectedContract !== null) {
    const expected = validateFreezeContract(expectedContract);

    for (const field of [
      'purpose',
      'modelVersion',
      'settlementVersion',
      'settlementRegistryVersion',
      'status',
    ]) {
      if (actualContract[field] !== expected[field]) {
        throw new Error(
          `Batter Hits closeout freeze ${field} does not match the expected contract.`,
        );
      }
    }
  }

  validateDeferredManifest(artifact.componentManifest);
  validateFittedComponents(artifact.fittedComponents);
  validateRuntimeSourceArtifacts(artifact.runtimeSourceArtifacts);

  if (artifact.untouchedTestReservation?.rowsIncluded !== false) {
    throw new Error('Batter Hits closeout freeze exposes untouched-test rows.');
  }

  if (
    artifact.artifactSha256 !==
    sha256(JSON.stringify(artifactIdentity(artifact)))
  ) {
    throw new Error('Batter Hits closeout freeze SHA-256 is invalid.');
  }

  return artifact;
}

export function buildM8BatterHitsCloseoutFreeze(args) {
  return buildBatterHitsCloseoutFreeze({
    ...args,
    contract: M8_BATTER_HITS_CLOSEOUT_CONTRACT,
  });
}

export function verifyM8BatterHitsCloseoutFreeze(rawArtifact) {
  return verifyBatterHitsCloseoutFreeze(rawArtifact, {
    expectedContract: M8_BATTER_HITS_CLOSEOUT_CONTRACT,
  });
}

export function applyDeferredIdentityComponents({
  probabilities,
  componentManifest = M8_DEFERRED_COMPONENT_MANIFEST,
}) {
  validateDeferredManifest(componentManifest);

  const vector = object(probabilities, 'terminal PA probability vector');
  const entries = Object.entries(vector);

  if (entries.length < 2) {
    throw new Error('terminal PA probability vector requires multiple outcomes.');
  }

  let total = 0;

  for (const [category, probability] of entries) {
    nonEmptyString(category, 'terminal PA category');

    if (
      typeof probability !== 'number' ||
      !Number.isFinite(probability) ||
      probability < 0 ||
      probability > 1
    ) {
      throw new Error(`invalid terminal PA probability for ${category}.`);
    }

    total += probability;
  }

  if (Math.abs(total - 1) > TOLERANCE) {
    throw new Error('terminal PA probability vector must sum to one.');
  }

  return Object.freeze({ ...vector });
}
