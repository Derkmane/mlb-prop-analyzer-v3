import { readFile } from 'node:fs/promises';

import {
  buildM8BatterHitsCloseoutFreeze,
  summarizeSelectedEvidence,
  verifyM8BatterHitsCloseoutFreeze,
} from './m8-batter-hits-closeout-freeze-utils.mjs';
import { sha256, writeJsonAtomic } from './provider-probe-utils.mjs';

const OUTPUT_PATH =
  'model-artifacts/m8-batter-hits-runtime-freeze-v1.json';

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

const specifications = Object.freeze([
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
]);

const runtimeSourcePaths = Object.freeze([
  'model-artifacts/m8-terminal-pa-outcome-v1.json',
  'model-artifacts/m8-shared-offensive-environment-v2.json',
  'model-artifacts/m8-starter-retention-v1.json',
]);

const loaded = new Map();

async function load(sourcePath) {
  if (!loaded.has(sourcePath)) {
    loaded.set(sourcePath, await readJson(sourcePath));
  }

  return loaded.get(sourcePath);
}

const fittedComponents = {};

for (const specification of specifications) {
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
  runtimeSourcePaths.map((sourcePath) => load(sourcePath)),
);

const terminalArtifact = runtimeSources.find(
  (source) =>
    source.sourcePath ===
    'model-artifacts/m8-terminal-pa-outcome-v1.json',
);

if (!terminalArtifact) {
  throw new Error('terminal PA runtime source artifact is missing.');
}

const reservation = terminalArtifact.value.untouchedTestReservation;

if (!reservation || reservation.rowsIncluded !== false) {
  throw new Error(
    'terminal PA artifact does not preserve a sealed untouched-test reservation.',
  );
}

const artifact = buildM8BatterHitsCloseoutFreeze({
  activeSeason: 2026,
  fittedComponents,
  runtimeSourceArtifacts: runtimeSources.map((source) => ({
    sourcePath: source.sourcePath,
    sourceSha256: sha256(JSON.stringify(source.value)),
  })),
  untouchedTestReservation: reservation,
});

verifyM8BatterHitsCloseoutFreeze(artifact);
await writeJsonAtomic(OUTPUT_PATH, artifact);

const persisted = await readJson(OUTPUT_PATH);
verifyM8BatterHitsCloseoutFreeze(persisted.value);

if (persisted.value.artifactSha256 !== artifact.artifactSha256) {
  throw new Error('persisted freeze artifact changed after writing.');
}

console.log('=== M8 BATTER HITS RUNTIME FREEZE COMPLETE ===');
console.log(`Output: ${OUTPUT_PATH}`);

for (const specification of specifications) {
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
