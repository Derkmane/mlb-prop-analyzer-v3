import path from 'node:path';

import { buildM8HitBenchmarkDataset } from './m8-hit-benchmark-dataset-utils.mjs';
import { evaluateM8HitRecencyCandidates } from './m8-hit-recency-evaluation-utils.mjs';
import { evaluateM8HitRecencyWalkForward } from './m8-hit-recency-walk-forward-utils.mjs';
import { writeJsonAtomic } from './provider-probe-utils.mjs';

const EXPECTED_UNTOUCHED_START = '2026-07-30';
const EXPECTED_UNTOUCHED_END = '2026-08-04';
const EXPECTED_RECENCY_CANDIDATE = 'uniform';

const SUFFIXES = Object.freeze({
  sourceDataset: 'recency-evaluation-dataset-v1.json',
  benchmark: 'hit-benchmark-dataset-v1.json',
  fixed: 'hit-recency-evaluation-v1.json',
  walkForward: 'hit-recency-walk-forward-v1.json',
});

function nonEmptyString(value, label) {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new TypeError(`${label} must be a non-empty string.`);
  }
  return value.trim();
}

function object(value, label) {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new TypeError(`${label} must be an object.`);
  }
  return value;
}

function exactMatches(files, suffix, label, { allowMissing = false } = {}) {
  const matches = files.filter((file) => file.endsWith(suffix));
  const minimum = allowMissing ? 0 : 1;

  if (matches.length < minimum || matches.length > 1) {
    throw new Error(
      `${label} requires ${allowMissing ? 'zero or one' : 'exactly one'} file ending in ${suffix}; found ${matches.length}: ${matches.join(', ')}`,
    );
  }

  return matches[0] ?? null;
}

function validateReservation(value, label) {
  const reservation = object(value, label);

  if (
    reservation.startDate !== EXPECTED_UNTOUCHED_START ||
    reservation.endDate !== EXPECTED_UNTOUCHED_END ||
    reservation.rowsIncluded !== false ||
    Object.hasOwn(reservation, 'rows')
  ) {
    throw new Error(
      `${label} must preserve the sealed ${EXPECTED_UNTOUCHED_START} through ${EXPECTED_UNTOUCHED_END} untouched period.`,
    );
  }
}

function selectedCandidateId(evaluation, label) {
  return nonEmptyString(
    evaluation.selection?.selectedCandidate?.candidateId,
    `${label}.selection.selectedCandidate.candidateId`,
  );
}

function validatePreparedRecency({ benchmark, fixed, walkForward }) {
  const benchmarkValue = object(benchmark, 'V5 Hit benchmark');
  const fixedValue = object(fixed, 'V5 fixed recency evaluation');
  const walkValue = object(walkForward, 'V5 recency walk-forward evaluation');

  validateReservation(
    benchmarkValue.untouchedTestReservation,
    'V5 Hit benchmark untouchedTestReservation',
  );
  validateReservation(
    fixedValue.untouchedTestReservation,
    'V5 fixed recency untouchedTestReservation',
  );
  validateReservation(
    walkValue.untouchedTestReservation,
    'V5 recency walk-forward untouchedTestReservation',
  );

  const benchmarkSha = nonEmptyString(
    benchmarkValue.benchmarkSha256,
    'V5 Hit benchmark SHA-256',
  );

  if (
    fixedValue.sourceBenchmarkSha256 !== benchmarkSha ||
    walkValue.sourceBenchmarkSha256 !== benchmarkSha
  ) {
    throw new Error(
      'V5 recency evaluations do not reference the generated Hit benchmark.',
    );
  }

  const fixedCandidate = selectedCandidateId(fixedValue, 'fixed recency');
  const walkCandidate = selectedCandidateId(walkValue, 'walk-forward recency');

  if (
    fixedCandidate !== EXPECTED_RECENCY_CANDIDATE ||
    walkCandidate !== EXPECTED_RECENCY_CANDIDATE
  ) {
    throw new Error(
      `V5 recency evidence must select ${EXPECTED_RECENCY_CANDIDATE}; fixed=${fixedCandidate}; walk-forward=${walkCandidate}.`,
    );
  }

  if (!Array.isArray(walkValue.folds) || walkValue.folds.length < 2) {
    throw new Error('V5 recency walk-forward must contain at least two folds.');
  }
}

export async function ensureM9BatterHitsV5RecencyArtifacts({
  rootPath,
  files: rawFiles,
  buildBenchmark = buildM8HitBenchmarkDataset,
  evaluateFixed = evaluateM8HitRecencyCandidates,
  evaluateWalkForward = evaluateM8HitRecencyWalkForward,
  writeArtifact = writeJsonAtomic,
}) {
  const root = nonEmptyString(rootPath, 'rootPath');
  if (!Array.isArray(rawFiles)) {
    throw new TypeError('files must be an array.');
  }
  const files = rawFiles.map((file, index) =>
    nonEmptyString(file, `files[${index}]`),
  );

  const existingFixed = exactMatches(
    files,
    SUFFIXES.fixed,
    'recency fixed evaluation',
    { allowMissing: true },
  );
  const existingWalk = exactMatches(
    files,
    SUFFIXES.walkForward,
    'recency walk-forward evaluation',
    { allowMissing: true },
  );

  if (existingFixed !== null && existingWalk !== null) {
    return Object.freeze({
      generated: false,
      fixedPath: existingFixed,
      walkForwardPath: existingWalk,
      benchmarkPath: exactMatches(
        files,
        SUFFIXES.benchmark,
        'Hit benchmark',
        { allowMissing: true },
      ),
    });
  }

  const sourceDatasetPath = exactMatches(
    files,
    SUFFIXES.sourceDataset,
    'V5 recency evaluation dataset',
  );
  const existingBenchmark = exactMatches(
    files,
    SUFFIXES.benchmark,
    'Hit benchmark',
    { allowMissing: true },
  );

  const benchmarkPath =
    existingBenchmark ??
    path.join(root, 'm9-batter-hits-v5-hit-benchmark-dataset-v1.json');
  const fixedPath =
    existingFixed ??
    path.join(root, 'm9-batter-hits-v5-hit-recency-evaluation-v1.json');
  const walkForwardPath =
    existingWalk ??
    path.join(root, 'm9-batter-hits-v5-hit-recency-walk-forward-v1.json');

  const benchmark = await buildBenchmark({ sourceDatasetPath });
  await writeArtifact(benchmarkPath, benchmark);

  const [fixed, walkForward] = await Promise.all([
    evaluateFixed({ benchmarkPath }),
    evaluateWalkForward({ benchmarkPath }),
  ]);

  validatePreparedRecency({ benchmark, fixed, walkForward });

  await Promise.all([
    writeArtifact(fixedPath, fixed),
    writeArtifact(walkForwardPath, walkForward),
  ]);

  return Object.freeze({
    generated: true,
    sourceDatasetPath,
    benchmarkPath,
    fixedPath,
    walkForwardPath,
    selectedCandidateId: EXPECTED_RECENCY_CANDIDATE,
    foldCount: walkForward.folds.length,
  });
}
