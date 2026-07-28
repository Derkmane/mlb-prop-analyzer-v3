import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { evaluateM8HitRecencyCandidates } from '../scripts/m8-hit-recency-evaluation-utils.mjs';
import { sha256 } from '../scripts/provider-probe-utils.mjs';

const hashes = Object.freeze({
  dataset: 'a'.repeat(64),
  datasetFile: 'b'.repeat(64),
  partition: 'c'.repeat(64),
  evidence: 'd'.repeat(64),
});

function observation({ id, date, batterId, pitcherId, hit }) {
  return {
    observationId: id,
    observedDate: date,
    providerGameId: 1,
    providerPaNumber: Number(id.replace(/\D/g, '').slice(-4)) || 1,
    providerBatterId: batterId,
    providerPitcherId: pitcherId,
    rawBatterSide: 'R',
    rawPitcherHand: 'L',
    rawResult: hit === 1 ? 'Single' : 'Groundout',
    sourceSnapshotPath: `${date}/snapshot.json`,
    sourceSnapshotSha256: 'e'.repeat(64),
    hit,
    labelSource: 'canonical-terminal-category',
    terminalCategory: hit === 1 ? '1B' : 'BIP_OUT',
    platoonEligible: true,
  };
}

function period(startDate, endDate, observations) {
  return {
    startDate,
    endDate,
    sourceRowCount: observations.length,
    observationCount: observations.length,
    hitCount: observations.reduce((sum, row) => sum + row.hit, 0),
    noHitCount: observations.reduce((sum, row) => sum + (1 - row.hit), 0),
    contextualNonHitCount: 0,
    platoonEligibleCount: observations.length,
    excludedCount: 0,
    observations,
    exclusions: [],
  };
}

async function writeBenchmark(root, {
  fitObservations,
  validationObservations,
  untouchedRows = undefined,
}) {
  const periods = {
    fit: period('2026-03-26', '2026-06-21', fitObservations),
    validation: period(
      '2026-06-22',
      '2026-07-05',
      validationObservations,
    ),
  };
  const untouchedTestReservation = {
    startDate: '2026-07-06',
    endDate: '2026-07-25',
    plateAppearanceCount: 9,
    rowsIncluded: false,
    ...(untouchedRows === undefined ? {} : { rows: untouchedRows }),
  };
  const identity = {
    activeSeason: 2026,
    sourceDatasetSha256: hashes.dataset,
    sourceDatasetFileSha256: hashes.datasetFile,
    sourcePartitionSha256: hashes.partition,
    sourceEvidenceSetSha256: hashes.evidence,
    periods,
    untouchedTestReservation,
  };
  const benchmark = {
    benchmarkVersion: 1,
    purpose: 'test benchmark',
    ...identity,
    totals: {
      sourceRowCount: fitObservations.length + validationObservations.length,
      observationCount: fitObservations.length + validationObservations.length,
      hitCount: [...fitObservations, ...validationObservations].reduce(
        (sum, row) => sum + row.hit,
        0,
      ),
      noHitCount: [...fitObservations, ...validationObservations].reduce(
        (sum, row) => sum + (1 - row.hit),
        0,
      ),
      contextualNonHitCount: 0,
      platoonEligibleCount:
        fitObservations.length + validationObservations.length,
      excludedCount: 0,
    },
    benchmarkSha256: sha256(JSON.stringify(identity)),
  };
  const benchmarkPath = path.join(root, 'benchmark.json');
  await writeFile(benchmarkPath, `${JSON.stringify(benchmark, null, 2)}\n`, 'utf8');
  return benchmarkPath;
}

async function withTempRoot(run) {
  const root = await mkdtemp(path.join(os.tmpdir(), 'm8-hit-recency-'));
  try {
    await run(root);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

const twoCandidateGrid = Object.freeze([
  Object.freeze({ candidateId: 'uniform', kind: 'uniform' }),
  Object.freeze({
    candidateId: 'half-life-7',
    kind: 'exponential-half-life',
    halfLifeDays: 7,
  }),
]);

test('selects a recent-signal half-life from later validation without clipping or pooling', async () => {
  await withTempRoot(async (root) => {
    const fitObservations = [
      observation({ id: 'fit-1', date: '2026-03-26', batterId: 1, pitcherId: 10, hit: 0 }),
      observation({ id: 'fit-2', date: '2026-03-27', batterId: 1, pitcherId: 10, hit: 0 }),
      observation({ id: 'fit-3', date: '2026-03-28', batterId: 1, pitcherId: 10, hit: 0 }),
      observation({ id: 'fit-4', date: '2026-03-29', batterId: 1, pitcherId: 10, hit: 0 }),
      observation({ id: 'fit-5', date: '2026-06-20', batterId: 1, pitcherId: 10, hit: 1 }),
      observation({ id: 'fit-6', date: '2026-06-21', batterId: 1, pitcherId: 10, hit: 0 }),
    ];
    const validationObservations = [
      observation({ id: 'validation-1', date: '2026-06-22', batterId: 1, pitcherId: 10, hit: 1 }),
      observation({ id: 'validation-2', date: '2026-06-23', batterId: 1, pitcherId: 10, hit: 1 }),
      observation({ id: 'validation-3', date: '2026-06-24', batterId: 1, pitcherId: 10, hit: 1 }),
    ];
    const benchmarkPath = await writeBenchmark(root, {
      fitObservations,
      validationObservations,
    });

    const first = await evaluateM8HitRecencyCandidates({
      benchmarkPath,
      candidates: twoCandidateGrid,
    });
    const second = await evaluateM8HitRecencyCandidates({
      benchmarkPath,
      candidates: twoCandidateGrid,
    });

    assert.deepEqual(first, second);
    assert.equal(first.selection.status, 'validated-recency-selected');
    assert.equal(first.selection.selectedCandidate.candidateId, 'half-life-7');
    assert.equal(first.cohort.eligibleObservationCount, 3);
    assert.ok(
      first.results.every(
        (result) =>
          result.minimumPrediction > 0 && result.maximumPrediction < 1,
      ),
    );
    assert.match(first.evaluationSha256, /^[a-f0-9]{64}$/);
  });
});

test('uses one fixed cohort and explicitly excludes unseen or single-class histories', async () => {
  await withTempRoot(async (root) => {
    const fitObservations = [
      observation({ id: 'fit-1', date: '2026-06-20', batterId: 1, pitcherId: 10, hit: 1 }),
      observation({ id: 'fit-2', date: '2026-06-21', batterId: 1, pitcherId: 10, hit: 0 }),
      observation({ id: 'fit-3', date: '2026-06-20', batterId: 2, pitcherId: 20, hit: 1 }),
      observation({ id: 'fit-4', date: '2026-06-21', batterId: 3, pitcherId: 20, hit: 0 }),
      observation({ id: 'fit-5', date: '2026-06-20', batterId: 3, pitcherId: 30, hit: 1 }),
    ];
    const validationObservations = [
      observation({ id: 'validation-1', date: '2026-06-22', batterId: 1, pitcherId: 10, hit: 0 }),
      observation({ id: 'validation-2', date: '2026-06-22', batterId: 99, pitcherId: 10, hit: 0 }),
      observation({ id: 'validation-3', date: '2026-06-22', batterId: 1, pitcherId: 99, hit: 0 }),
      observation({ id: 'validation-4', date: '2026-06-22', batterId: 2, pitcherId: 20, hit: 0 }),
      observation({ id: 'validation-5', date: '2026-06-22', batterId: 3, pitcherId: 30, hit: 0 }),
      observation({ id: 'validation-6', date: '2026-06-22', batterId: 98, pitcherId: 98, hit: 0 }),
    ];
    const benchmarkPath = await writeBenchmark(root, {
      fitObservations,
      validationObservations,
    });

    const evaluation = await evaluateM8HitRecencyCandidates({
      benchmarkPath,
      candidates: twoCandidateGrid,
    });

    assert.equal(evaluation.cohort.eligibleObservationCount, 1);
    assert.equal(evaluation.cohort.validationObservationCount, 6);
    assert.deepEqual(evaluation.cohort.exclusionsByReason, {
      'batter-single-class-history': 1,
      'pitcher-single-class-history': 1,
      'unseen-batter': 1,
      'unseen-batter-and-pitcher': 1,
      'unseen-pitcher': 1,
    });
    assert.ok(
      evaluation.results.every(
        (result) => result.validationObservationCount === 1,
      ),
    );
  });
});

test('rejects any benchmark that exposes untouched-test rows', async () => {
  await withTempRoot(async (root) => {
    const benchmarkPath = await writeBenchmark(root, {
      fitObservations: [
        observation({ id: 'fit-1', date: '2026-06-20', batterId: 1, pitcherId: 10, hit: 1 }),
        observation({ id: 'fit-2', date: '2026-06-21', batterId: 1, pitcherId: 10, hit: 0 }),
      ],
      validationObservations: [
        observation({ id: 'validation-1', date: '2026-06-22', batterId: 1, pitcherId: 10, hit: 1 }),
      ],
      untouchedRows: [{ forbidden: true }],
    });

    await assert.rejects(
      evaluateM8HitRecencyCandidates({
        benchmarkPath,
        candidates: twoCandidateGrid,
      }),
      /test rows must remain absent/,
    );
  });
});

test('rejects a validation period with no usable batter-pitcher cohort rather than smoothing it', async () => {
  await withTempRoot(async (root) => {
    const benchmarkPath = await writeBenchmark(root, {
      fitObservations: [
        observation({ id: 'fit-1', date: '2026-06-20', batterId: 1, pitcherId: 10, hit: 1 }),
        observation({ id: 'fit-2', date: '2026-06-21', batterId: 2, pitcherId: 20, hit: 0 }),
      ],
      validationObservations: [
        observation({ id: 'validation-1', date: '2026-06-22', batterId: 1, pitcherId: 10, hit: 1 }),
      ],
    });

    await assert.rejects(
      evaluateM8HitRecencyCandidates({
        benchmarkPath,
        candidates: twoCandidateGrid,
      }),
      /no validation observations have usable batter and pitcher histories/,
    );
  });
});
