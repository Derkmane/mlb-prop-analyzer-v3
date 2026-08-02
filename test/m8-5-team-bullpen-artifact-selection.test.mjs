import assert from 'node:assert/strict';
import test from 'node:test';

import { selectM8_5TeamBullpenArtifactPair } from '../scripts/m8-5-team-bullpen-artifact-selection-utils.mjs';
import { buildM8StarterBullpenDataset } from '../scripts/m8-starter-bullpen-transition-utils.mjs';

function row({ date, gameId, pa, pitcherId }) {
  return Object.freeze({
    rowId: `${date}:${gameId}:${pa}`,
    observedDate: date,
    providerGameId: gameId,
    providerPaNumber: pa,
    providerPitcherId: pitcherId,
    halfInning: 'top',
    mappingStatus: 'classified-terminal',
    normalizedPitcherHand: 'R',
    normalizedBatterSide: 'R',
    terminalCategory: 'BIP_OUT',
  });
}

function resolvedDataset(datasetSha256) {
  return Object.freeze({
    datasetVersion: 3,
    activeSeason: 2026,
    datasetSha256,
    periods: Object.freeze({
      fit: Object.freeze({
        rows: Object.freeze([
          row({ date: '2026-04-01', gameId: 1, pa: 1, pitcherId: 101 }),
          row({ date: '2026-04-01', gameId: 1, pa: 2, pitcherId: 102 }),
        ]),
      }),
      validation: Object.freeze({
        rows: Object.freeze([
          row({ date: '2026-06-22', gameId: 2, pa: 1, pitcherId: 201 }),
          row({ date: '2026-06-22', gameId: 2, pa: 2, pitcherId: 202 }),
        ]),
      }),
    }),
    untouchedTestReservation: Object.freeze({ rowsIncluded: false }),
  });
}

function artifact(path, value) {
  return Object.freeze({ path, text: JSON.stringify(value), value });
}

function environment(datasetSha256, sourceResolvedDatasetSha256) {
  return Object.freeze({
    datasetVersion: 2,
    activeSeason: 2026,
    datasetSha256,
    sourceResolvedDatasetSha256,
  });
}

test('selects the resolved and team-environment pair whose rebuilt workload dataset matches frozen lineage', () => {
  const selectedDataset = resolvedDataset('a'.repeat(64));
  const staleDataset = resolvedDataset('b'.repeat(64));
  const frozenLineageSha256 =
    buildM8StarterBullpenDataset(selectedDataset).datasetSha256;

  const selection = selectM8_5TeamBullpenArtifactPair({
    resolvedCandidates: [
      artifact('artifacts/stale.json', staleDataset),
      artifact('artifacts/selected-copy-b.json', selectedDataset),
      artifact('artifacts/selected-copy-a.json', selectedDataset),
    ],
    environmentCandidates: [
      artifact(
        'artifacts/stale-environment.json',
        environment('c'.repeat(64), staleDataset.datasetSha256),
      ),
      artifact(
        'artifacts/selected-environment.json',
        environment('d'.repeat(64), selectedDataset.datasetSha256),
      ),
    ],
    frozenStarterBullpenDatasetSha256: frozenLineageSha256,
  });

  assert.equal(selection.resolved.path, 'artifacts/selected-copy-a.json');
  assert.equal(
    selection.teamEnvironment.path,
    'artifacts/selected-environment.json',
  );
  assert.equal(selection.resolvedCandidateCount, 3);
  assert.equal(selection.frozenLineageCopyCount, 2);
  assert.equal(selection.matchingEnvironmentCopyCount, 1);
});

test('fails closed when no resolved dataset matches frozen workload lineage', () => {
  const candidate = resolvedDataset('a'.repeat(64));

  assert.throws(
    () =>
      selectM8_5TeamBullpenArtifactPair({
        resolvedCandidates: [artifact('artifacts/candidate.json', candidate)],
        environmentCandidates: [],
        frozenStarterBullpenDatasetSha256: 'f'.repeat(64),
      }),
    /No resolved categorical dataset matching the frozen starter-bullpen dataset lineage artifacts were found/u,
  );
});

test('fails closed when frozen-lineage evidence has multiple team-environment identities', () => {
  const candidate = resolvedDataset('a'.repeat(64));
  const frozenLineageSha256 =
    buildM8StarterBullpenDataset(candidate).datasetSha256;

  assert.throws(
    () =>
      selectM8_5TeamBullpenArtifactPair({
        resolvedCandidates: [artifact('artifacts/candidate.json', candidate)],
        environmentCandidates: [
          artifact(
            'artifacts/environment-a.json',
            environment('c'.repeat(64), candidate.datasetSha256),
          ),
          artifact(
            'artifacts/environment-b.json',
            environment('d'.repeat(64), candidate.datasetSha256),
          ),
        ],
        frozenStarterBullpenDatasetSha256: frozenLineageSha256,
      }),
    /Expected exactly one team offensive-environment dataset matching the frozen-lineage resolved dataset identity; found 2/u,
  );
});
