import assert from 'node:assert/strict';
import {
  mkdtemp,
  rm,
  writeFile,
} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import {
  buildM8OpportunityPlayCapturePlan,
} from '../scripts/m8-opportunity-play-capture-plan-utils.mjs';
import {
  sha256,
} from '../scripts/provider-probe-utils.mjs';

function row({
  date,
  gameId,
  paNumber,
  snapshotPath,
  snapshotSha256,
  mappingStatus,
}) {
  return {
    rowId:
      `${date}:` +
      `${gameId}:` +
      `${paNumber}`,
    observedDate: date,
    providerGameId: gameId,
    providerPaNumber:
      paNumber,
    sourceSnapshotPath:
      snapshotPath,
    sourceSnapshotSha256:
      snapshotSha256,
    mappingStatus,
  };
}

function period({
  startDate,
  endDate,
  rows,
}) {
  return {
    startDate,
    endDate,
    rowCount:
      rows.length,
    rows,
  };
}

function datasetIdentity(
  dataset,
) {
  return {
    activeSeason:
      dataset.activeSeason,
    sourceDatasetSha256:
      dataset.sourceDatasetSha256,
    sourceDatasetFileSha256:
      dataset.sourceDatasetFileSha256,
    sourceResolutionSha256:
      dataset.sourceResolutionSha256,
    sourceResolutionFileSha256:
      dataset.sourceResolutionFileSha256,
    sourcePartitionSha256:
      dataset.sourcePartitionSha256,
    sourceEvidenceSetSha256:
      dataset.sourceEvidenceSetSha256,
    periods:
      dataset.periods,
    untouchedTestReservation:
      dataset.untouchedTestReservation,
  };
}

function buildDataset({
  exposeTestRows = false,
  snapshotDrift = false,
  crossPeriodGame = false,
} = {}) {
  const game10Path =
    '2026-03-26/plate-appearances/' +
    'game-10.json';

  const game10Sha =
    '1'.repeat(64);

  const fitRows = [
    row({
      date: '2026-03-26',
      gameId: 10,
      paNumber: 1,
      snapshotPath:
        game10Path,
      snapshotSha256:
        game10Sha,
      mappingStatus:
        'classified-terminal',
    }),
    row({
      date: '2026-03-26',
      gameId: 10,
      paNumber: 2,
      snapshotPath:
        snapshotDrift
          ? 'different.json'
          : game10Path,
      snapshotSha256:
        snapshotDrift
          ? '9'.repeat(64)
          : game10Sha,
      mappingStatus:
        'unresolved',
    }),
    row({
      date: '2026-04-01',
      gameId: 11,
      paNumber: 1,
      snapshotPath:
        '2026-04-01/plate-appearances/' +
        'game-11.json',
      snapshotSha256:
        '2'.repeat(64),
      mappingStatus:
        'baserunning-only',
    }),
  ];

  const validationRows = [
    row({
      date: '2026-06-22',
      gameId:
        crossPeriodGame
          ? 10
          : 20,
      paNumber: 1,
      snapshotPath:
        '2026-06-22/plate-appearances/' +
        'validation-game.json',
      snapshotSha256:
        '3'.repeat(64),
      mappingStatus:
        'classified-terminal',
    }),
  ];

  const dataset = {
    datasetVersion: 3,
    purpose:
      'synthetic resolved categorical dataset',
    activeSeason: 2026,
    sourceDatasetSha256:
      'a'.repeat(64),
    sourceDatasetFileSha256:
      'b'.repeat(64),
    sourceResolutionSha256:
      'c'.repeat(64),
    sourceResolutionFileSha256:
      'd'.repeat(64),
    sourcePartitionSha256:
      'e'.repeat(64),
    sourceEvidenceSetSha256:
      'f'.repeat(64),
    periods: {
      fit: period({
        startDate:
          '2026-03-26',
        endDate:
          '2026-06-21',
        rows:
          fitRows,
      }),
      validation: period({
        startDate:
          '2026-06-22',
        endDate:
          '2026-07-05',
        rows:
          validationRows,
      }),
    },
    untouchedTestReservation: {
      startDate:
        '2026-07-06',
      endDate:
        '2026-07-25',
      shardCount: 20,
      gameCount: 225,
      plateAppearanceCount:
        16830,
      rowsIncluded: false,
      allowedUse:
        'final-evaluation-only-after-candidate-selection',
      ...(exposeTestRows
        ? {
            rows: [
              {
                forbidden: true,
              },
            ],
          }
        : {}),
    },
    totals: {
      includedRowCount:
        fitRows.length +
        validationRows.length,
    },
  };

  dataset.datasetSha256 =
    sha256(
      JSON.stringify(
        datasetIdentity(
          dataset,
        ),
      ),
    );

  return dataset;
}

async function withDataset(
  options,
  run,
) {
  const root =
    await mkdtemp(
      path.join(
        os.tmpdir(),
        'm8-opportunity-plan-',
      ),
    );

  try {
    const datasetPath =
      path.join(
        root,
        'dataset.json',
      );

    await writeFile(
      datasetPath,
      `${JSON.stringify(
        buildDataset(options),
        null,
        2,
      )}\n`,
      'utf8',
    );

    await run(
      datasetPath,
    );
  } finally {
    await rm(
      root,
      {
        recursive: true,
        force: true,
      },
    );
  }
}

test(
  'plans every fit-validation game deterministically while preserving source provenance and sealing test',
  async () => {
    await withDataset(
      {},
      async (datasetPath) => {
        const first =
          await buildM8OpportunityPlayCapturePlan({
            datasetPath,
          });

        const second =
          await buildM8OpportunityPlayCapturePlan({
            datasetPath,
          });

        assert.deepEqual(
          first,
          second,
        );

        assert.equal(
          first.sourceRowCount,
          4,
        );

        assert.equal(
          first.gameCount,
          3,
        );

        assert.deepEqual(
          first.games.map(
            (game) => ({
              gameId:
                game.gameId,
              observedDate:
                game.observedDate,
              periodId:
                game.periodId,
              sourceRowCount:
                game.sourceRowCount,
            }),
          ),
          [
            {
              gameId: 10,
              observedDate:
                '2026-03-26',
              periodId: 'fit',
              sourceRowCount: 2,
            },
            {
              gameId: 11,
              observedDate:
                '2026-04-01',
              periodId: 'fit',
              sourceRowCount: 1,
            },
            {
              gameId: 20,
              observedDate:
                '2026-06-22',
              periodId:
                'validation',
              sourceRowCount: 1,
            },
          ],
        );

        assert.equal(
          first
            .untouchedTestReservation
            .rowsIncluded,
          false,
        );

        assert.match(
          first.planSha256,
          /^[a-f0-9]{64}$/,
        );
      },
    );
  },
);

test(
  'rejects exposed untouched-test rows',
  async () => {
    await withDataset(
      {
        exposeTestRows: true,
      },
      async (datasetPath) => {
        await assert.rejects(
          buildM8OpportunityPlayCapturePlan({
            datasetPath,
          }),
          /untouched-test rows must remain excluded/,
        );
      },
    );
  },
);

test(
  'rejects cross-period game identity and inconsistent snapshot provenance',
  async () => {
    await withDataset(
      {
        crossPeriodGame: true,
      },
      async (datasetPath) => {
        await assert.rejects(
          buildM8OpportunityPlayCapturePlan({
            datasetPath,
          }),
          /multiple observed dates|multiple chronological periods/,
        );
      },
    );

    await withDataset(
      {
        snapshotDrift: true,
      },
      async (datasetPath) => {
        await assert.rejects(
          buildM8OpportunityPlayCapturePlan({
            datasetPath,
          }),
          /inconsistent source snapshot provenance/,
        );
      },
    );
  },
);
