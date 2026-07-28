import assert from 'node:assert/strict';
import {
  mkdir,
  mkdtemp,
  readFile,
  rm,
} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import {
  buildM8OpportunityPlayCaptureManifest,
  buildM8OpportunityPlayCaptureProgress,
  ensureM8OpportunityCapturePlan,
  M8_OPPORTUNITY_GAME_CAPTURE_PURPOSE,
  promoteM8OpportunityPlayGameCapture,
  summarizeM8OpportunityCapturedGame,
  verifyM8OpportunityPlayGameCapture,
} from '../scripts/m8-opportunity-play-capture-run-utils.mjs';
import {
  sha256,
  writeJsonAtomic,
} from '../scripts/provider-probe-utils.mjs';

function game({
  gameId,
  observedDate,
  periodId,
  sourceRowCount,
  marker,
}) {
  return Object.freeze({
    gameId,
    observedDate,
    periodId,
    sourceRowCount,
    sourceSnapshotPath:
      `${observedDate}/game-${gameId}.json`,
    sourceSnapshotSha256:
      marker.repeat(64),
    rowIdsSha256:
      marker
        .toUpperCase()
        .repeat(64)
        .toLowerCase(),
  });
}

function planIdentity(
  plan,
) {
  return {
    activeSeason:
      plan.activeSeason,
    sourceResolvedDatasetSha256:
      plan.sourceResolvedDatasetSha256,
    sourceResolvedDatasetFileSha256:
      plan.sourceResolvedDatasetFileSha256,
    includedPeriods:
      plan.includedPeriods,
    sourceRowCount:
      plan.sourceRowCount,
    gameCount:
      plan.gameCount,
    games:
      plan.games,
    untouchedTestReservation:
      plan.untouchedTestReservation,
  };
}

function buildPlan() {
  const games = [
    game({
      gameId: 10,
      observedDate:
        '2026-03-26',
      periodId: 'fit',
      sourceRowCount: 2,
      marker: '1',
    }),
    game({
      gameId: 20,
      observedDate:
        '2026-06-22',
      periodId:
        'validation',
      sourceRowCount: 1,
      marker: '2',
    }),
  ];

  const plan = {
    planVersion: 1,
    purpose: 'test',
    activeSeason: 2026,
    sourceResolvedDatasetSha256:
      'a'.repeat(64),
    sourceResolvedDatasetFileSha256:
      'b'.repeat(64),
    includedPeriods: [
      'fit',
      'validation',
    ],
    sourceRowCount: 3,
    gameCount:
      games.length,
    games,
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
    },
  };

  plan.planSha256 =
    sha256(
      JSON.stringify(
        planIdentity(
          plan,
        ),
      ),
    );

  return plan;
}

function verified({
  gameId,
  pageCount,
  recordCount,
  marker,
}) {
  return {
    status: 'verified',
    gameId,
    pageCount,
    recordCount,
    gameManifestSha256:
      marker.repeat(64),
  };
}

function collectedGame(
  gameId,
) {
  const body = {
    data: [
      {
        game_id: gameId,
        order: 1,
      },
    ],
    meta: {
      per_page: 100,
    },
  };

  return {
    gameId,
    perPage: 100,
    pageCount: 1,
    recordCount: 1,
    firstOrder: 1,
    lastOrder: 1,
    pages: [
      {
        pageNumber: 1,
        requestCursor: null,
        nextCursor: null,
        recordCount: 1,
        firstOrder: 1,
        lastOrder: 1,
        body,
        snapshot: {
          rawBodySha256:
            '3'.repeat(64),
          responseStatus: 200,
          request: {
            origin:
              'https://api.balldontlie.io',
            pathname:
              '/mlb/v1/plays',
            queryKeys: [
              'game_id',
              'per_page',
              'sort_order',
            ],
            headerNames: [
              'Authorization',
            ],
          },
        },
      },
    ],
  };
}

async function withTempRoot(
  run,
) {
  const root =
    await mkdtemp(
      path.join(
        os.tmpdir(),
        'm8-opportunity-run-',
      ),
    );

  try {
    await run(root);
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
  'writes and reuses one exact capture plan while rejecting plan drift',
  async () => {
    await withTempRoot(
      async (root) => {
        const plan =
          buildPlan();

        const first =
          await ensureM8OpportunityCapturePlan({
            outputRoot: root,
            plan,
          });

        const second =
          await ensureM8OpportunityCapturePlan({
            outputRoot: root,
            plan,
          });

        assert.equal(
          first.reused,
          false,
        );

        assert.equal(
          second.reused,
          true,
        );

        assert.equal(
          first.planText,
          second.planText,
        );

        const drifted = {
          ...plan,
          sourceRowCount: 4,
        };

        drifted.planSha256 =
          sha256(
            JSON.stringify(
              planIdentity(
                drifted,
              ),
            ),
          );

        await assert.rejects(
          ensureM8OpportunityCapturePlan({
            outputRoot: root,
            plan: drifted,
          }),
          /sourceRowCount does not match games|differs from the requested plan/,
        );
      },
    );
  },
);

test(
  'builds deterministic partial progress and a complete conserved manifest',
  () => {
    const plan =
      buildPlan();

    const firstSummary =
      summarizeM8OpportunityCapturedGame({
        game:
          plan.games[0],
        verified:
          verified({
            gameId: 10,
            pageCount: 2,
            recordCount: 15,
            marker: '4',
          }),
      });

    const secondSummary =
      summarizeM8OpportunityCapturedGame({
        game:
          plan.games[1],
        verified:
          verified({
            gameId: 20,
            pageCount: 1,
            recordCount: 8,
            marker: '5',
          }),
      });

    const firstProgress =
      buildM8OpportunityPlayCaptureProgress({
        plan,
        capturedGames: [
          firstSummary,
        ],
        selectedNewGameCount: 1,
        remainingGameCount: 1,
        maxNewGames: 1,
      });

    const secondProgress =
      buildM8OpportunityPlayCaptureProgress({
        plan,
        capturedGames: [
          firstSummary,
        ],
        selectedNewGameCount: 1,
        remainingGameCount: 1,
        maxNewGames: 1,
      });

    assert.deepEqual(
      firstProgress,
      secondProgress,
    );

    assert.equal(
      firstProgress.verifiedGameCount,
      1,
    );

    assert.equal(
      firstProgress.remainingGameCount,
      1,
    );

    assert.equal(
      firstProgress
        .untouchedTestReservation
        .rowsIncluded,
      false,
    );

    const planText =
      `${JSON.stringify(
        plan,
        null,
        2,
      )}\n`;

    const firstManifest =
      buildM8OpportunityPlayCaptureManifest({
        plan,
        planText,
        capturedGames: [
          secondSummary,
          firstSummary,
        ],
      });

    const secondManifest =
      buildM8OpportunityPlayCaptureManifest({
        plan,
        planText,
        capturedGames: [
          firstSummary,
          secondSummary,
        ],
      });

    assert.deepEqual(
      firstManifest,
      secondManifest,
    );

    assert.equal(
      firstManifest.sourceRowCount,
      3,
    );

    assert.equal(
      firstManifest.gameCount,
      2,
    );

    assert.equal(
      firstManifest.totalPageCount,
      3,
    );

    assert.equal(
      firstManifest.totalPlayRecordCount,
      23,
    );

    assert.deepEqual(
      firstManifest.games.map(
        (value) =>
          value.gameId,
      ),
      [
        10,
        20,
      ],
    );

    assert.equal(
      firstManifest
        .untouchedTestReservation
        .rowsIncluded,
      false,
    );

    assert.throws(
      () =>
        buildM8OpportunityPlayCaptureManifest({
          plan,
          planText,
          capturedGames: [
            firstSummary,
          ],
        }),
      /does not contain every planned game/,
    );
  },
);

test(
  'promotes and verifies an opportunity-specific game capture',
  async () => {
    await withTempRoot(
      async (root) => {
        await mkdir(
          path.join(
            root,
            'games',
          ),
          {
            recursive: true,
          },
        );

        const promoted =
          await promoteM8OpportunityPlayGameCapture({
            outputRoot: root,
            gameId: 10,
            collected:
              collectedGame(10),
          });

        const verified =
          await verifyM8OpportunityPlayGameCapture({
            gameDirectory:
              promoted.finalDirectory,
            expectedGameId: 10,
            secret:
              'not-present-secret',
          });

        assert.equal(
          verified.status,
          'verified',
        );

        assert.equal(
          verified.recordCount,
          1,
        );

        const manifestPath =
          path.join(
            promoted.finalDirectory,
            'game-manifest.json',
          );

        const manifest =
          JSON.parse(
            await readFile(
              manifestPath,
              'utf8',
            ),
          );

        assert.equal(
          manifest.purpose,
          M8_OPPORTUNITY_GAME_CAPTURE_PURPOSE,
        );

        await writeJsonAtomic(
          manifestPath,
          {
            ...manifest,
            purpose:
              'wrong capture purpose',
          },
        );

        await assert.rejects(
          verifyM8OpportunityPlayGameCapture({
            gameDirectory:
              promoted.finalDirectory,
            expectedGameId: 10,
          }),
          /not an opportunity-play capture/,
        );
      },
    );
  },
);

test(
  'rejects capture identity drift and inconsistent progress accounting',
  () => {
    const plan =
      buildPlan();

    assert.throws(
      () =>
        summarizeM8OpportunityCapturedGame({
          game:
            plan.games[0],
          verified:
            verified({
              gameId: 99,
              pageCount: 1,
              recordCount: 1,
              marker: '6',
            }),
        }),
      /identity differs/,
    );

    const summary =
      summarizeM8OpportunityCapturedGame({
        game:
          plan.games[0],
        verified:
          verified({
            gameId: 10,
            pageCount: 1,
            recordCount: 1,
            marker: '7',
          }),
      });

    assert.throws(
      () =>
        buildM8OpportunityPlayCaptureProgress({
          plan,
          capturedGames: [
            summary,
          ],
          selectedNewGameCount: 1,
          remainingGameCount: 0,
          maxNewGames: 1,
        }),
      /remaining count disagrees/,
    );
  },
);
