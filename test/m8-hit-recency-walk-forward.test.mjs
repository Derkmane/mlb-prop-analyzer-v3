import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { evaluateM8HitRecencyWalkForward } from '../scripts/m8-hit-recency-walk-forward-utils.mjs';
import { sha256 } from '../scripts/provider-probe-utils.mjs';

const candidates = Object.freeze([
  Object.freeze({ candidateId: 'uniform', kind: 'uniform' }),
  Object.freeze({
    candidateId: 'half-life-7',
    kind: 'exponential-half-life',
    halfLifeDays: 7,
  }),
]);

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
  const hitCount = observations.reduce((sum, row) => sum + row.hit, 0);
  return {
    startDate,
    endDate,
    sourceRowCount: observations.length,
    observationCount: observations.length,
    hitCount,
    noHitCount: observations.length - hitCount,
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
      '2026-06-24',
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
    sourceDatasetSha256: 'a'.repeat(64),
    sourceDatasetFileSha256: 'b'.repeat(64),
    sourcePartitionSha256: 'c'.repeat(64),
    sourceEvidenceSetSha256: 'd'.repeat(64),
    periods,
    untouchedTestReservation,
  };
  const benchmark = {
    benchmarkVersion: 1,
    purpose: 'walk-forward test benchmark',
    ...identity,
    totals: {
      sourceRowCount: fitObservations.length + validationObservations.length,
      observationCount: fitObservations.length + validationObservations.length,
      hitCount: periods.fit.hitCount + periods.validation.hitCount,
      noHitCount: periods.fit.noHitCount + periods.validation.noHitCount,
      contextualNonHitCount: 0,
      platoonEligibleCount:
        fitObservations.length + validationObservations.length,
      excludedCount: 0,
    },
    benchmarkSha256: sha256(JSON.stringify(identity)),
  };
  const benchmarkPath = path.join(root, 'benchmark.json');
  await writeFile(
    benchmarkPath,
    `${JSON.stringify(benchmark, null, 2)}\n`,
    'utf8',
  );
  return benchmarkPath;
}

async function withTempRoot(run) {
  const root = await mkdtemp(
    path.join(os.tmpdir(), 'm8-hit-recency-walk-forward-test-'),
  );
  try {
    await run(root);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

test('selects recent weighting across expanding daily folds without future leakage', async () => {
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

    const first = await evaluateM8HitRecencyWalkForward({
      benchmarkPath,
      candidates,
    });
    const second = await evaluateM8HitRecencyWalkForward({
      benchmarkPath,
      candidates,
    });

    assert.deepEqual(first, second);
    assert.equal(first.selection.status, 'validated-recency-selected');
    assert.equal(first.selection.selectedCandidate.candidateId, 'half-life-7');
    assert.deepEqual(
      first.folds.map((fold) => fold.trainingObservationCount),
      [6, 7, 8],
    );
    assert.ok(
      first.folds.every(
        (fold) => fold.trainingEndDate < fold.validationDate,
      ),
    );
    assert.ok(
      first.aggregateResults.every(
        (result) => result.validationObservationCount === 3,
      ),
    );
    assert.match(first.walkForwardSha256, /^[a-f0-9]{64}$/);
  });
});

test('earlier validation outcomes may unlock later folds but never the same fold', async () => {
  await withTempRoot(async (root) => {
    const fitObservations = [
      observation({ id: 'fit-1', date: '2026-06-20', batterId: 1, pitcherId: 10, hit: 1 }),
      observation({ id: 'fit-2', date: '2026-06-21', batterId: 1, pitcherId: 10, hit: 0 }),
      observation({ id: 'fit-3', date: '2026-06-21', batterId: 2, pitcherId: 20, hit: 1 }),
    ];
    const validationObservations = [
      observation({ id: 'validation-1', date: '2026-06-22', batterId: 1, pitcherId: 10, hit: 0 }),
      observation({ id: 'validation-2', date: '2026-06-22', batterId: 2, pitcherId: 20, hit: 0 }),
      observation({ id: 'validation-3', date: '2026-06-23', batterId: 1, pitcherId: 10, hit: 1 }),
      observation({ id: 'validation-4', date: '2026-06-23', batterId: 2, pitcherId: 20, hit: 1 }),
    ];
    const benchmarkPath = await writeBenchmark(root, {
      fitObservations,
      validationObservations,
    });

    const evaluation = await evaluateM8HitRecencyWalkForward({
      benchmarkPath,
      candidates,
    });

    assert.equal(evaluation.folds[0].eligibleObservationCount, 1);
    assert.equal(evaluation.folds[1].eligibleObservationCount, 2);
    assert.equal(
      evaluation.folds[0].exclusionsByReason[
        'batter-and-pitcher-single-class-history'
      ],
      1,
    );
  });
});

test('rejects duplicate observation identities across source periods', async () => {
  await withTempRoot(async (root) => {
    const duplicate = observation({
      id: 'duplicate',
      date: '2026-06-21',
      batterId: 1,
      pitcherId: 10,
      hit: 1,
    });
    const benchmarkPath = await writeBenchmark(root, {
      fitObservations: [
        duplicate,
        observation({ id: 'fit-2', date: '2026-06-20', batterId: 1, pitcherId: 10, hit: 0 }),
      ],
      validationObservations: [
        { ...duplicate, observedDate: '2026-06-22' },
        observation({ id: 'validation-2', date: '2026-06-23', batterId: 1, pitcherId: 10, hit: 0 }),
      ],
    });

    await assert.rejects(
      evaluateM8HitRecencyWalkForward({ benchmarkPath, candidates }),
      /duplicate observationId across benchmark periods/,
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
        observation({ id: 'validation-2', date: '2026-06-23', batterId: 1, pitcherId: 10, hit: 0 }),
      ],
      untouchedRows: [{ forbidden: true }],
    });

    await assert.rejects(
      evaluateM8HitRecencyWalkForward({ benchmarkPath, candidates }),
      /test rows must remain absent/,
    );
  });
});
