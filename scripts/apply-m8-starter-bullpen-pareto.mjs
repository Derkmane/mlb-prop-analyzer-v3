import fs from 'node:fs';

function replaceOnce(text, oldText, newText, label) {
  const count = text.split(oldText).length - 1;
  if (count !== 1) throw new Error(`${label}: expected one match, found ${count}`);
  return text.replace(oldText, newText);
}

function update(path, transform) {
  const before = fs.readFileSync(path, 'utf8');
  const after = transform(before);
  if (after === before) throw new Error(`${path}: no change produced`);
  fs.writeFileSync(path, after);
}

update('scripts/m8-starter-bullpen-transition-utils.mjs', (source) => {
  source = replaceOnce(
    source,
`export const DEFAULT_M8_STARTER_BULLPEN_CANDIDATES = Object.freeze([
  Object.freeze({ candidateId: 'starter-bf-league', grouping: 'league', leagueEquivalentGames: 0 }),
  ...[10, 25, 50, 100, 250, 500, 1000].map((leagueEquivalentGames) =>
    Object.freeze({
      candidateId: \`starter-bf-side-pool-\${leagueEquivalentGames}\`,
      grouping: 'side',
      leagueEquivalentGames,
    }),
  ),
]);`,
`export const M8_STARTER_BULLPEN_CANDIDATE_SET_VERSION = 'm8-starter-bf-pooling-v2';

export const DEFAULT_M8_STARTER_BULLPEN_CANDIDATES = Object.freeze([
  ...[10, 25, 50, 100, 250, 500, 1000].map((leagueEquivalentGames) =>
    Object.freeze({
      candidateId: \`starter-bf-side-pool-\${leagueEquivalentGames}\`,
      grouping: 'side',
      leagueEquivalentGames,
    }),
  ),
  Object.freeze({ candidateId: 'starter-bf-league', grouping: 'league', leagueEquivalentGames: 0 }),
]);`,
    'candidate set',
  );

  source = replaceOnce(
    source,
`function rank(results) {
  return [...results].sort(
    (left, right) =>
      left.metrics.logLoss - right.metrics.logLoss ||
      left.metrics.multiclassBrier - right.metrics.multiclassBrier ||
      left.candidate.candidateId.localeCompare(right.candidate.candidateId),
  );
}
`,
`function rank(results) {
  return [...results].sort(
    (left, right) =>
      left.metrics.logLoss - right.metrics.logLoss ||
      left.metrics.multiclassBrier - right.metrics.multiclassBrier ||
      left.candidate.candidateId.localeCompare(right.candidate.candidateId),
  );
}

function poolingStrength(candidate) {
  const value = object(candidate, 'starter-bullpen candidate');
  const grouping = string(value.grouping, 'starter-bullpen candidate grouping');
  if (grouping === 'league') return Number.POSITIVE_INFINITY;
  if (grouping === 'side') {
    return positiveInteger(value.leagueEquivalentGames, 'starter-bullpen league-equivalent games');
  }
  throw new Error(\`unsupported starter-bullpen candidate grouping \${grouping}.\`);
}

function validatedCandidateResults(rawResults, label) {
  const seen = new Set();
  return array(rawResults, label).map((rawResult) => {
    const result = object(rawResult, \`\${label} result\`);
    const candidate = object(result.candidate, \`\${label} candidate\`);
    const candidateId = string(candidate.candidateId, \`\${label} candidate id\`);
    if (seen.has(candidateId)) throw new Error(\`\${label} contains duplicate candidate \${candidateId}.\`);
    seen.add(candidateId);
    const resultMetrics = object(result.metrics, \`\${label} metrics\`);
    if (!Number.isFinite(resultMetrics.logLoss) || !Number.isFinite(resultMetrics.multiclassBrier)) {
      throw new Error(\`\${label} candidate \${candidateId} has invalid proper-score metrics.\`);
    }
    return result;
  });
}

function dominates(left, right) {
  const noWorse =
    left.metrics.logLoss <= right.metrics.logLoss &&
    left.metrics.multiclassBrier <= right.metrics.multiclassBrier;
  const strictlyBetter =
    left.metrics.logLoss < right.metrics.logLoss ||
    left.metrics.multiclassBrier < right.metrics.multiclassBrier;
  return noWorse && strictlyBetter;
}

export function computeM8StarterBullpenNondominatedCandidateIds(rawResults) {
  const results = validatedCandidateResults(rawResults, 'starter-bullpen candidate results');
  return Object.freeze(
    results
      .filter(
        (candidateResult, candidateIndex) =>
          !results.some(
            (otherResult, otherIndex) =>
              otherIndex !== candidateIndex && dominates(otherResult, candidateResult),
          ),
      )
      .map((result) => result.candidate.candidateId),
  );
}

export function selectM8StarterBullpenCandidate({ fixedResults, walkForwardResults }) {
  const fixed = validatedCandidateResults(fixedResults, 'fixed starter-bullpen results');
  const walkForward = validatedCandidateResults(
    walkForwardResults,
    'walk-forward starter-bullpen results',
  );
  const fixedById = new Map(fixed.map((result) => [result.candidate.candidateId, result]));
  const walkIds = new Set(walkForward.map((result) => result.candidate.candidateId));
  if (fixedById.size !== walkIds.size || [...fixedById.keys()].some((id) => !walkIds.has(id))) {
    throw new Error('fixed and walk-forward starter-bullpen candidate sets differ.');
  }
  const fixedNondominatedCandidateIds = computeM8StarterBullpenNondominatedCandidateIds(fixed);
  const walkForwardNondominatedCandidateIds =
    computeM8StarterBullpenNondominatedCandidateIds(walkForward);
  const walkForwardNondominated = new Set(walkForwardNondominatedCandidateIds);
  const admissibleCandidateIds = Object.freeze(
    fixedNondominatedCandidateIds.filter((candidateId) =>
      walkForwardNondominated.has(candidateId),
    ),
  );
  const selectedCandidateId =
    [...admissibleCandidateIds].sort((leftId, rightId) => {
      const leftStrength = poolingStrength(fixedById.get(leftId).candidate);
      const rightStrength = poolingStrength(fixedById.get(rightId).candidate);
      if (leftStrength !== rightStrength) return leftStrength > rightStrength ? -1 : 1;
      return leftId.localeCompare(rightId);
    })[0] ?? null;
  return Object.freeze({
    fixedNondominatedCandidateIds,
    walkForwardNondominatedCandidateIds,
    admissibleCandidateIds,
    stable: selectedCandidateId !== null,
    reason: selectedCandidateId === null ? 'EMPTY_ADMISSIBLE_SET' : null,
    selectedCandidateId,
  });
}
`,
    'proper-score selection helpers',
  );

  source = replaceOnce(
    source,
`function evaluationIdentity(value) {
  return {
    evaluationVersion: value.evaluationVersion,
    status: value.status,
    activeSeason: value.activeSeason,
    sourceDatasetSha256: value.sourceDatasetSha256,
    fitWindow: value.fitWindow,
    validationWindow: value.validationWindow,
    supportMaximum: value.supportMaximum,
    candidates: value.candidates,
    fixedResults: value.fixedResults,
    fixedSelectedCandidateId: value.fixedSelectedCandidateId,
    walkForward: value.walkForward,
    selectionAgreement: value.selectionAgreement,
    finalModel: value.finalModel,
    untouchedTestReservation: value.untouchedTestReservation,
  };
}`,
`function evaluationIdentity(value) {
  return {
    evaluationVersion: value.evaluationVersion,
    candidateSetVersion: value.candidateSetVersion,
    mathSpecVersion: value.mathSpecVersion,
    status: value.status,
    activeSeason: value.activeSeason,
    sourceDatasetSha256: value.sourceDatasetSha256,
    fitWindow: value.fitWindow,
    validationWindow: value.validationWindow,
    supportMaximum: value.supportMaximum,
    candidates: value.candidates,
    fixedResults: value.fixedResults,
    fixedSelectedCandidateId: value.fixedSelectedCandidateId,
    walkForward: value.walkForward,
    fixedNondominatedCandidateIds: value.fixedNondominatedCandidateIds,
    walkForwardNondominatedCandidateIds: value.walkForwardNondominatedCandidateIds,
    admissibleCandidateIds: value.admissibleCandidateIds,
    stableSelection: value.stableSelection,
    selectionReason: value.selectionReason,
    selectedCandidateId: value.selectedCandidateId,
    finalModel: value.finalModel,
    untouchedTestReservation: value.untouchedTestReservation,
  };
}`,
    'evaluation identity',
  );

  source = replaceOnce(
    source,
`  const fixedSelectedCandidateId = rank(fixedResults)[0].candidate.candidateId;
  const walkForwardResult = walkForward(fitRows, validationRows, candidates, maximum);
  const selectionAgreement = fixedSelectedCandidateId === walkForwardResult.selectedCandidateId;
  const selectedCandidate = candidates.find((candidate) => candidate.candidateId === fixedSelectedCandidateId);
  const finalModel = selectionAgreement
    ? fitCandidate([...fitRows, ...validationRows], selectedCandidate, maximum)
    : null;
  const identity = {
    evaluationVersion: 1,
    status: selectionAgreement ? 'starter-bullpen-candidate-selected' : 'starter-bullpen-selection-disagrees',`,
`  const fixedSelectedCandidateId = rank(fixedResults)[0].candidate.candidateId;
  const walkForwardResult = walkForward(fitRows, validationRows, candidates, maximum);
  const selection = selectM8StarterBullpenCandidate({
    fixedResults,
    walkForwardResults: walkForwardResult.aggregateResults,
  });
  const selectedCandidate =
    selection.selectedCandidateId === null
      ? null
      : candidates.find(
          (candidate) => candidate.candidateId === selection.selectedCandidateId,
        );
  if (selection.selectedCandidateId !== null && selectedCandidate === undefined) {
    throw new Error('selected starter-bullpen candidate is missing from the candidate set.');
  }
  const finalModel =
    selectedCandidate === null
      ? null
      : fitCandidate([...fitRows, ...validationRows], selectedCandidate, maximum);
  const identity = {
    evaluationVersion: 2,
    candidateSetVersion: M8_STARTER_BULLPEN_CANDIDATE_SET_VERSION,
    mathSpecVersion: '1.5',
    status: selection.stable
      ? 'starter-bullpen-candidate-selected'
      : 'starter-bullpen-no-common-nondominated-candidate',`,
    'evaluation selection start',
  );

  source = replaceOnce(
    source,
`    fixedResults: Object.freeze(fixedResults),
    fixedSelectedCandidateId,
    walkForward: walkForwardResult,
    selectionAgreement,
    finalModel,`,
`    fixedResults: Object.freeze(fixedResults),
    fixedSelectedCandidateId,
    walkForward: walkForwardResult,
    fixedNondominatedCandidateIds: selection.fixedNondominatedCandidateIds,
    walkForwardNondominatedCandidateIds: selection.walkForwardNondominatedCandidateIds,
    admissibleCandidateIds: selection.admissibleCandidateIds,
    stableSelection: selection.stable,
    selectionReason: selection.reason,
    selectedCandidateId: selection.selectedCandidateId,
    finalModel,`,
    'evaluation selection fields',
  );

  source = replaceOnce(
    source,
`  if (evaluation.evaluationVersion !== 1 || evaluation.selectionAgreement !== true || evaluation.finalModel === null) {
    throw new Error('starter-bullpen evaluation did not select one stable model.');
  }`,
`  if (
    evaluation.evaluationVersion !== 2 ||
    evaluation.candidateSetVersion !== M8_STARTER_BULLPEN_CANDIDATE_SET_VERSION ||
    evaluation.mathSpecVersion !== '1.5' ||
    evaluation.stableSelection !== true ||
    evaluation.selectedCandidateId === null ||
    evaluation.finalModel === null
  ) {
    throw new Error(
      \`starter-bullpen evaluation did not select one stable model: \${evaluation.selectionReason ?? 'INVALID_SELECTION'}\`,
    );
  }
  const recomputed = selectM8StarterBullpenCandidate({
    fixedResults: evaluation.fixedResults,
    walkForwardResults: evaluation.walkForward?.aggregateResults,
  });
  for (const field of [
    'fixedNondominatedCandidateIds',
    'walkForwardNondominatedCandidateIds',
    'admissibleCandidateIds',
  ]) {
    if (JSON.stringify(evaluation[field]) !== JSON.stringify(recomputed[field])) {
      throw new Error(\`starter-bullpen \${field} is inconsistent with the proper-score results.\`);
    }
  }
  if (
    recomputed.selectedCandidateId !== evaluation.selectedCandidateId ||
    evaluation.finalModel.candidate?.candidateId !== evaluation.selectedCandidateId
  ) {
    throw new Error('starter-bullpen selected candidate is inconsistent with the final model.');
  }`,
    'evaluation verifier',
  );

  return source;
});

update('scripts/run-m8-shared-offensive-environment-v2-gate.mjs', (source) => {
  source = replaceOnce(
    source,
`console.log(\`Fixed-validation selected: \${transitionEvaluation.fixedSelectedCandidateId}\`);
console.log(\`Walk-forward selected: \${transitionEvaluation.walkForward.selectedCandidateId}\`);`,
`console.log(\`Fixed minimum-log-loss candidate: \${transitionEvaluation.fixedSelectedCandidateId}\`);
console.log(\`Walk-forward minimum-log-loss candidate: \${transitionEvaluation.walkForward.selectedCandidateId}\`);
console.log(\`Fixed nondominated: \${transitionEvaluation.fixedNondominatedCandidateIds.join(', ')}\`);
console.log(\`Walk-forward nondominated: \${transitionEvaluation.walkForwardNondominatedCandidateIds.join(', ')}\`);
console.log(\`Admissible candidates: \${transitionEvaluation.admissibleCandidateIds.join(', ')}\`);
console.log(\`Selected stable candidate: \${transitionEvaluation.selectedCandidateId}\`);`,
    'gate diagnostics',
  );
  source = replaceOnce(
    source,
`    result.candidate.candidateId === transitionEvaluation.fixedSelectedCandidateId,`,
`    result.candidate.candidateId === transitionEvaluation.selectedCandidateId,`,
    'gate selected metrics',
  );
  source = replaceOnce(
    source,
`console.log(\`Selected starter workload: \${transitionEvaluation.fixedSelectedCandidateId}\`);`,
`console.log(\`Selected starter workload: \${transitionEvaluation.selectedCandidateId}\`);`,
    'gate selected output',
  );
  return source;
});

update('scripts/m8-shared-offensive-environment-v2-utils.mjs', (source) => {
  source = replaceOnce(
    source,
`  const fixedSelected = transition.fixedResults.find(
    (result) => result.candidate.candidateId === transition.fixedSelectedCandidateId,
  );
  if (!fixedSelected) throw new Error('starter-bullpen selected fixed result is missing.');`,
`  const selectedFixedResult = transition.fixedResults.find(
    (result) => result.candidate.candidateId === transition.selectedCandidateId,
  );
  if (!selectedFixedResult) {
    throw new Error('starter-bullpen selected candidate fixed result is missing.');
  }`,
    'shared environment selected result',
  );
  source = replaceOnce(
    source,
`      starterBullpenFixed: fixedSelected.metrics,
      starterBullpenWalkForwardSelectedCandidateId: transition.walkForward.selectedCandidateId,
      starterBullpenWalkForwardFoldCount: transition.walkForward.foldCount,
      selectionAgreement: transition.selectionAgreement,`,
`      starterBullpenSelectedFixedMetrics: selectedFixedResult.metrics,
      starterBullpenFixedMinimumLogLossCandidateId: transition.fixedSelectedCandidateId,
      starterBullpenWalkForwardMinimumLogLossCandidateId: transition.walkForward.selectedCandidateId,
      starterBullpenFixedNondominatedCandidateIds: transition.fixedNondominatedCandidateIds,
      starterBullpenWalkForwardNondominatedCandidateIds:
        transition.walkForwardNondominatedCandidateIds,
      starterBullpenAdmissibleCandidateIds: transition.admissibleCandidateIds,
      starterBullpenSelectedCandidateId: transition.selectedCandidateId,
      starterBullpenWalkForwardFoldCount: transition.walkForward.foldCount,
      starterBullpenStableSelection: transition.stableSelection,`,
    'shared environment validation evidence',
  );
  return source;
});

update('test/m8-starter-bullpen-transition.test.mjs', (source) => {
  source = replaceOnce(
    source,
`  buildM8StarterBullpenDataset,
  evaluateM8StarterBullpenTransition,
  verifyM8StarterBullpenEvaluation,`,
`  DEFAULT_M8_STARTER_BULLPEN_CANDIDATES,
  buildM8StarterBullpenDataset,
  computeM8StarterBullpenNondominatedCandidateIds,
  evaluateM8StarterBullpenTransition,
  selectM8StarterBullpenCandidate,
  verifyM8StarterBullpenEvaluation,`,
    'test imports',
  );
  source = replaceOnce(
    source,
`  assert.equal(evaluation.selectionAgreement, true);
  assert.equal(
    evaluation.fixedSelectedCandidateId,
    evaluation.walkForward.selectedCandidateId,
  );`,
`  assert.equal(evaluation.stableSelection, true);
  assert.equal(
    evaluation.fixedSelectedCandidateId,
    evaluation.walkForward.selectedCandidateId,
  );
  assert.ok(evaluation.admissibleCandidateIds.includes(evaluation.selectedCandidateId));
  assert.equal(evaluation.finalModel.candidate.candidateId, evaluation.selectedCandidateId);`,
    'existing stability assertions',
  );

  source += `

const candidateById = new Map(
  DEFAULT_M8_STARTER_BULLPEN_CANDIDATES.map((candidate) => [candidate.candidateId, candidate]),
);

function scored(candidateId, logLoss, multiclassBrier) {
  const candidate = candidateById.get(candidateId);
  if (!candidate) throw new Error(\`unknown test candidate \${candidateId}\`);
  return { candidate, metrics: { logLoss, multiclassBrier } };
}

test('the real-shape proper-score frontiers select side-pool-1000', () => {
  assert.deepEqual(
    DEFAULT_M8_STARTER_BULLPEN_CANDIDATES.map((candidate) => candidate.candidateId),
    [
      'starter-bf-side-pool-10',
      'starter-bf-side-pool-25',
      'starter-bf-side-pool-50',
      'starter-bf-side-pool-100',
      'starter-bf-side-pool-250',
      'starter-bf-side-pool-500',
      'starter-bf-side-pool-1000',
      'starter-bf-league',
    ],
  );
  const fixedResults = [
    scored('starter-bf-side-pool-10', 2.848679651177694, 0.9268310592726594),
    scored('starter-bf-side-pool-25', 2.848625839884098, 0.9268221983333319),
    scored('starter-bf-side-pool-50', 2.8485441280168833, 0.9268082852943009),
    scored('starter-bf-side-pool-100', 2.8484068673282326, 0.9267833300733421),
    scored('starter-bf-side-pool-250', 2.8481484036883873, 0.9267262163529916),
    scored('starter-bf-side-pool-500', 2.8480057054840135, 0.9266681373491591),
    scored('starter-bf-side-pool-1000', 2.848105162546217, 0.926614844041183),
    scored('starter-bf-league', 2.850462309846479, 0.9266005135161092),
  ];
  const walkForwardResults = [
    scored('starter-bf-side-pool-10', 2.8529344427081216, 0.9266697073696496),
    scored('starter-bf-side-pool-25', 2.8528557708147284, 0.926663055423049),
    scored('starter-bf-side-pool-50', 2.852733329655666, 0.9266526205122834),
    scored('starter-bf-side-pool-100', 2.8525173895096176, 0.9266339454118445),
    scored('starter-bf-side-pool-250', 2.8520458399217152, 0.9265915755449415),
    scored('starter-bf-side-pool-500', 2.851617827045183, 0.9265497133917449),
    scored('starter-bf-side-pool-1000', 2.8513316062022067, 0.9265147051602064),
    scored('starter-bf-league', 2.852502338276471, 0.9265571731930152),
  ];
  const selection = selectM8StarterBullpenCandidate({ fixedResults, walkForwardResults });
  assert.deepEqual(selection.fixedNondominatedCandidateIds, [
    'starter-bf-side-pool-500',
    'starter-bf-side-pool-1000',
    'starter-bf-league',
  ]);
  assert.deepEqual(selection.walkForwardNondominatedCandidateIds, [
    'starter-bf-side-pool-1000',
  ]);
  assert.deepEqual(selection.admissibleCandidateIds, ['starter-bf-side-pool-1000']);
  assert.equal(selection.stable, true);
  assert.equal(selection.selectedCandidateId, 'starter-bf-side-pool-1000');
});

test('proper-score sign disagreement keeps both candidates nondominated', () => {
  const ids = computeM8StarterBullpenNondominatedCandidateIds([
    scored('starter-bf-side-pool-500', 1, 2),
    scored('starter-bf-side-pool-1000', 2, 1),
  ]);
  assert.deepEqual(ids, ['starter-bf-side-pool-500', 'starter-bf-side-pool-1000']);
});

test('the full Pareto comparison removes a candidate dominated by a non-log-loss winner', () => {
  const ids = computeM8StarterBullpenNondominatedCandidateIds([
    scored('starter-bf-side-pool-500', 1, 3),
    scored('starter-bf-side-pool-1000', 2, 1),
    scored('starter-bf-league', 3, 2),
  ]);
  assert.deepEqual(ids, ['starter-bf-side-pool-500', 'starter-bf-side-pool-1000']);
});

test('contradictory fixed and walk-forward frontiers fail closed', () => {
  const fixedResults = [
    scored('starter-bf-side-pool-500', 1, 1),
    scored('starter-bf-side-pool-1000', 2, 2),
  ];
  const walkForwardResults = [
    scored('starter-bf-side-pool-500', 2, 2),
    scored('starter-bf-side-pool-1000', 1, 1),
  ];
  const selection = selectM8StarterBullpenCandidate({ fixedResults, walkForwardResults });
  assert.equal(selection.stable, false);
  assert.equal(selection.reason, 'EMPTY_ADMISSIBLE_SET');
  assert.equal(selection.selectedCandidateId, null);
  assert.deepEqual(selection.admissibleCandidateIds, []);
});

test('strongest-pooling selection is deterministic under input reordering', () => {
  const results = [
    scored('starter-bf-side-pool-500', 1, 3),
    scored('starter-bf-side-pool-1000', 2, 2),
    scored('starter-bf-league', 3, 1),
  ];
  const forward = selectM8StarterBullpenCandidate({
    fixedResults: results,
    walkForwardResults: results,
  });
  const reversed = selectM8StarterBullpenCandidate({
    fixedResults: [...results].reverse(),
    walkForwardResults: [...results].reverse(),
  });
  assert.equal(forward.selectedCandidateId, 'starter-bf-league');
  assert.equal(reversed.selectedCandidateId, forward.selectedCandidateId);
});

test('untouched-test rows cannot enter starter-bullpen candidate selection', () => {
  const source = dataset();
  source.untouchedTestReservation.rowsIncluded = true;
  assert.throws(
    () => buildM8StarterBullpenDataset(source),
    /must keep untouched-test rows sealed/,
  );
});

test('identical inputs produce an identical starter-bullpen evaluation', () => {
  const recovered = buildM8StarterBullpenDataset(dataset());
  const first = evaluateM8StarterBullpenTransition({ rawDataset: recovered });
  const second = evaluateM8StarterBullpenTransition({ rawDataset: recovered });
  assert.equal(JSON.stringify(second), JSON.stringify(first));
});
`;
  return source;
});

fs.unlinkSync(new URL(import.meta.url));
console.log('Applied M8 starter-bullpen Pareto selection implementation and removed the temporary migration script.');
