import { readFile } from 'node:fs/promises';

import {
  buildBatterHitsCloseoutFreeze,
  M8_BATTER_HITS_CLOSEOUT_CONTRACT,
  summarizeSelectedEvidence,
  verifyBatterHitsCloseoutFreeze,
} from './m8-batter-hits-closeout-freeze-utils.mjs';
import { sha256, writeJsonAtomic } from './provider-probe-utils.mjs';

const DEFAULT_OUTPUT_PATH =
  'model-artifacts/m8-batter-hits-runtime-freeze-v1.json';

const DEFAULT_RUN_SPECIFICATION = Object.freeze({
  activeSeason: 2026,
  outputPath: DEFAULT_OUTPUT_PATH,
  contract: M8_BATTER_HITS_CLOSEOUT_CONTRACT,
  specifications: Object.freeze([
    {
      componentId: 'recencyWeighting',
      candidateId: 'uniform',
      fixedPath:
        'artifacts/m8-current-season-pa/m8-hit-recency-evaluation-v1.json',
      walkForwardPath:
        'artifacts/m8-current-season-pa/m8-hit-recency-walk-forward-v1.json',
      fixedNondominatedCandidateIds: ['uniform'],
      walkForwardNondominatedCandidateIds: ['uniform'],
    },
    {
      componentId: 'batterPooling',
      candidateId: 'league-pa-256',
      fixedPath:
        'artifacts/m8-current-season-pa/m8-resolved-categorical-model-evaluation-v1.json',
      walkForwardPath:
        'artifacts/m8-current-season-pa/m8-resolved-categorical-walk-forward-v1.json',
      fixedNondominatedCandidateIds: ['league-pa-256'],
      walkForwardNondominatedCandidateIds: ['league-pa-256'],
    },
    {
      componentId: 'pitcherAllowedPooling',
      candidateId: 'league-pa-256',
      fixedPath:
        'artifacts/m8-current-season-pa/m8-resolved-categorical-model-evaluation-v1.json',
      walkForwardPath:
        'artifacts/m8-current-season-pa/m8-resolved-categorical-walk-forward-v1.json',
      fixedNondominatedCandidateIds: ['league-pa-256'],
      walkForwardNondominatedCandidateIds: ['league-pa-256'],
    },
    {
      componentId: 'coherentMatchup',
      candidateId: 'batter-1.00-pitcher-0.75',
      fixedPath:
        'artifacts/m8-current-season-pa/m8-resolved-categorical-model-evaluation-v1.json',
      walkForwardPath:
        'artifacts/m8-current-season-pa/m8-resolved-categorical-walk-forward-v1.json',
      fixedNondominatedCandidateIds: ['batter-1.00-pitcher-0.75'],
      walkForwardNondominatedCandidateIds: ['batter-1.00-pitcher-0.75'],
    },
    {
      componentId: 'platoon',
      candidateId:
        'league-raw-cell-limit-split-pa-1024-coefficient-0.75',
      fixedPath:
        'artifacts/m8-current-season-pa/m8-resolved-categorical-platoon-boundary-v2.json',
      walkForwardPath:
        'artifacts/m8-current-season-pa/m8-resolved-categorical-platoon-walk-forward-v1.json',
      fixedNondominatedCandidateIds: [
        'league-raw-cell-limit-split-pa-1024-coefficient-0.75',
      ],
      walkForwardNondominatedCandidateIds: [
        'league-raw-cell-limit-split-pa-1024-coefficient-0.75',
      ],
    },
    {
      componentId: 'starterBullpenTransition',
      candidateId: 'starter-bf-side-pool-1000',
      fixedPath:
        'artifacts/m8-starter-bullpen-transition/starter-bullpen-evaluation.json',
      walkForwardPath:
        'artifacts/m8-starter-bullpen-transition/starter-bullpen-evaluation.json',
      fixedNondominatedCandidateIds: [
        'starter-bf-side-pool-500',
        'starter-bf-side-pool-1000',
        'starter-bf-league',
      ],
      walkForwardNondominatedCandidateIds: [
        'starter-bf-side-pool-1000',
      ],
    },
    {
      componentId: 'paSurvival',
      candidateId: 'slot-home-away-pool-50',
      fixedPath:
        'artifacts/m8-current-season-pa/m8-pa-survival-evaluation-v1.json',
      walkForwardPath:
        'artifacts/m8-current-season-pa/m8-pa-survival-walk-forward-v1.json',
      fixedNondominatedCandidateIds: ['slot-home-away-pool-50'],
      walkForwardNondominatedCandidateIds: ['slot-home-away-pool-50'],
    },
    {
      componentId: 'sharedOffensiveEnvironment',
      candidateId: 'shared-environment-k4',
      fixedPath:
        'artifacts/m8-current-season-pa/m8-shared-offensive-environment-evaluation-v1.json',
      walkForwardPath:
        'artifacts/m8-current-season-pa/m8-shared-offensive-environment-walk-forward-v1.json',
      fixedNondominatedCandidateIds: ['shared-environment-k4'],
      walkForwardNondominatedCandidateIds: ['shared-environment-k4'],
    },
  ]),
  runtimeSourcePaths: Object.freeze([
    'model-artifacts/m8-terminal-pa-outcome-v1.json',
    'model-artifacts/m8-shared-offensive-environment-v2.json',
    'model-artifacts/m8-starter-retention-v1.json',
  ]),
  reservationSourcePath:
    'model-artifacts/m8-terminal-pa-outcome-v1.json',
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

  return Object.freeze(
    value.map((item, index) =>
      nonEmptyString(item, `${label}[${index}]`),
    ),
  );
}

async function readJson(sourcePath) {
  const text = await readFile(sourcePath, 'utf8');

  try {
    return {
      sourcePath,
      text,
      value: JSON.parse(text),
    };
  } catch {
    throw new Error(`${sourcePath} is not valid JSON.`);
  }
}

function normalizeRunSpecification(rawSpecification) {
  const raw = object(rawSpecification, 'closeout freeze run specification');
  const activeSeason = raw.activeSeason;

  if (!Number.isSafeInteger(activeSeason) || activeSeason !== 2026) {
    throw new Error(
      'closeout freeze run specification activeSeason must equal 2026.',
    );
  }

  const specifications = raw.specifications;
  if (!Array.isArray(specifications) || specifications.length === 0) {
    throw new TypeError(
      'closeout freeze run specification specifications must be non-empty.',
    );
  }

  const normalizedSpecifications = specifications.map((rawItem, index) => {
    const item = object(rawItem, `specifications[${index}]`);

    return Object.freeze({
      componentId: nonEmptyString(
        item.componentId,
        `specifications[${index}].componentId`,
      ),
      candidateId: nonEmptyString(
        item.candidateId,
        `specifications[${index}].candidateId`,
      ),
      fixedPath: nonEmptyString(
        item.fixedPath,
        `specifications[${index}].fixedPath`,
      ),
      walkForwardPath: nonEmptyString(
        item.walkForwardPath,
        `specifications[${index}].walkForwardPath`,
      ),
      fixedNondominatedCandidateIds: stringArray(
        item.fixedNondominatedCandidateIds,
        `specifications[${index}].fixedNondominatedCandidateIds`,
      ),
      walkForwardNondominatedCandidateIds: stringArray(
        item.walkForwardNondominatedCandidateIds,
        `specifications[${index}].walkForwardNondominatedCandidateIds`,
      ),
    });
  });

  const componentIds = normalizedSpecifications.map(
    (item) => item.componentId,
  );
  if (new Set(componentIds).size !== componentIds.length) {
    throw new Error(
      'closeout freeze run specification contains duplicate componentId values.',
    );
  }

  const runtimeSourcePaths = stringArray(
    raw.runtimeSourcePaths,
    'runtimeSourcePaths',
  );
  const reservationSourcePath = nonEmptyString(
    raw.reservationSourcePath,
    'reservationSourcePath',
  );

  if (!runtimeSourcePaths.includes(reservationSourcePath)) {
    throw new Error(
      'reservationSourcePath must also appear in runtimeSourcePaths.',
    );
  }

  return Object.freeze({
    activeSeason,
    outputPath: nonEmptyString(raw.outputPath, 'outputPath'),
    contract: object(raw.contract, 'contract'),
    specifications: Object.freeze(normalizedSpecifications),
    runtimeSourcePaths,
    reservationSourcePath,
  });
}

async function loadRunSpecification() {
  const specificationPath =
    process.env.M8_BATTER_HITS_FREEZE_SPEC_PATH?.trim();

  if (!specificationPath) {
    return normalizeRunSpecification(DEFAULT_RUN_SPECIFICATION);
  }

  const loaded = await readJson(specificationPath);
  return normalizeRunSpecification(loaded.value);
}

const runSpecification = await loadRunSpecification();
const outputPath =
  process.env.M8_BATTER_HITS_RUNTIME_FREEZE_OUTPUT_PATH?.trim() ||
  runSpecification.outputPath;
const loaded = new Map();

async function load(sourcePath) {
  if (!loaded.has(sourcePath)) {
    loaded.set(sourcePath, await readJson(sourcePath));
  }

  return loaded.get(sourcePath);
}

const fittedComponents = {};

for (const specification of runSpecification.specifications) {
  const [fixed, walkForward] = await Promise.all([
    load(specification.fixedPath),
    load(specification.walkForwardPath),
  ]);

  fittedComponents[specification.componentId] = {
    candidateId: specification.candidateId,
    fixedValidation: summarizeSelectedEvidence({
      sourcePath: fixed.sourcePath,
      sourceValue: fixed.value,
      candidateId: specification.candidateId,
      declaredNondominatedCandidateIds:
        specification.fixedNondominatedCandidateIds,
    }),
    walkForward: summarizeSelectedEvidence({
      sourcePath: walkForward.sourcePath,
      sourceValue: walkForward.value,
      candidateId: specification.candidateId,
      declaredNondominatedCandidateIds:
        specification.walkForwardNondominatedCandidateIds,
    }),
  };
}

const runtimeSources = await Promise.all(
  runSpecification.runtimeSourcePaths.map((sourcePath) => load(sourcePath)),
);

const reservationArtifact = runtimeSources.find(
  (source) =>
    source.sourcePath === runSpecification.reservationSourcePath,
);

if (!reservationArtifact) {
  throw new Error('untouched-test reservation source artifact is missing.');
}

const reservation = reservationArtifact.value.untouchedTestReservation;

if (!reservation || reservation.rowsIncluded !== false) {
  throw new Error(
    'reservation source artifact does not preserve a sealed untouched-test reservation.',
  );
}

const artifact = buildBatterHitsCloseoutFreeze({
  activeSeason: runSpecification.activeSeason,
  fittedComponents,
  runtimeSourceArtifacts: runtimeSources.map((source) => ({
    sourcePath: source.sourcePath,
    sourceSha256: sha256(JSON.stringify(source.value)),
  })),
  untouchedTestReservation: reservation,
  contract: runSpecification.contract,
});

verifyBatterHitsCloseoutFreeze(artifact, {
  expectedContract: runSpecification.contract,
});
await writeJsonAtomic(outputPath, artifact);

const persisted = await readJson(outputPath);
verifyBatterHitsCloseoutFreeze(persisted.value, {
  expectedContract: runSpecification.contract,
});

if (persisted.value.artifactSha256 !== artifact.artifactSha256) {
  throw new Error('persisted freeze artifact changed after writing.');
}

console.log('=== BATTER HITS RUNTIME FREEZE COMPLETE ===');
console.log(`Model version: ${artifact.modelVersion}`);
console.log(`Output: ${outputPath}`);

for (const specification of runSpecification.specifications) {
  const component = artifact.fittedComponents[specification.componentId];

  console.log(
    `${specification.componentId}: ${component.candidateId} | fixed scores=${component.fixedValidation.properScores.length} | walk-forward scores=${component.walkForward.properScores.length}`,
  );
}

console.log(
  'Park: modeled=false | reason=deferred, not fitted in M8 | adjustment=identity',
);
console.log(
  'Defense: modeled=false | reason=deferred, not fitted in M8 | adjustment=identity',
);
console.log(
  'Times-through-order: modeled=false | reason=deferred, not fitted in M8 | adjustment=identity',
);
console.log(
  'Eligibility/participation: deferred to the ranking pipeline',
);
console.log(`Artifact SHA-256: ${artifact.artifactSha256}`);
console.log('Production enabled: false');
console.log('Untouched-test accessed: false');
