import assert from 'node:assert/strict';
import {
  mkdir,
  mkdtemp,
  rm,
  writeFile,
} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import {
  buildM8StatsLineupCaptureManifest,
  deriveM8PlateAppearanceCandidate,
  summarizeM8StatsLineupGame,
} from '../scripts/m8-stats-lineup-capture-utils.mjs';
import {
  buildM8StatsLineupCaptureReference,
  resolveM8StatsLineupCapture,
} from '../scripts/m8-stats-lineup-capture-reference-utils.mjs';
import {
  sha256,
} from '../scripts/provider-probe-utils.mjs';

const player = (id, name) => ({
  id,
  full_name: name,
});
const awayTeam = {
  id: 1,
  display_name: 'Away',
};
const homeTeam = {
  id: 2,
  display_name: 'Home',
};

function lineupRowsFor(
  team,
  offset = 0,
  missing = [],
) {
  return Array.from(
    {
      length: 9,
    },
    (_, index) => index + 1,
  )
    .filter((slot) => !missing.includes(slot))
    .map((slot) => ({
      game_id: 99,
      team,
      player: player(
        offset + slot,
        `${team.display_name} ${slot}`,
      ),
      batting_order: slot,
      is_probable_pitcher: false,
    }));
}

function statsRow(
  id,
  plateAppearances,
  overrides = {},
) {
  return {
    game_id: 99,
    player: player(id, `Player ${id}`),
    plate_appearances: plateAppearances,
    at_bats: plateAppearances,
    bb: 0,
    hit_by_pitch: 0,
    sac_flies: 0,
    sac_bunts: 0,
    hits: 0,
    runs: 0,
    rbi: 0,
    ...overrides,
  };
}

function plannedGame() {
  return {
    gameId: 99,
    observedDate: '2026-04-01',
    periodId: 'fit',
    sourceRowCount: 70,
  };
}

function gameBody() {
  return {
    id: 99,
    status: 'STATUS_FINAL',
    season: 2026,
    season_type: 'regular',
    away_team: awayTeam,
    home_team: homeTeam,
  };
}

function snapshots() {
  return {
    gameSha256: 'a'.repeat(64),
    statsSha256: 'b'.repeat(64),
    lineupsSha256: 'c'.repeat(64),
  };
}

test(
  'derives a PA arithmetic candidate only from complete nonnegative components',
  () => {
    assert.deepEqual(
      deriveM8PlateAppearanceCandidate({
        at_bats: 3,
        bb: 1,
        hit_by_pitch: 0,
        sac_flies: 1,
        sac_bunts: 0,
      }),
      {
        available: true,
        value: 5,
        components: {
          atBats: 3,
          walks: 1,
          hitByPitch: 0,
          sacFlies: 1,
          sacBunts: 0,
        },
      },
    );
    assert.equal(
      deriveM8PlateAppearanceCandidate({
        at_bats: 4,
        bb: 0,
        hit_by_pitch: null,
        sac_flies: null,
        sac_bunts: null,
      }).available,
      false,
    );
  },
);

test(
  'classifies complete and incomplete official lineup coverage without inventing slots',
  () => {
    const lineups = [
      ...lineupRowsFor(awayTeam, 0),
      ...lineupRowsFor(homeTeam, 100, [5]),
    ];
    const stats = [
      ...Array.from(
        {
          length: 9,
        },
        (_, index) => statsRow(index + 1, 4),
      ),
      ...Array.from(
        {
          length: 9,
        },
        (_, index) => statsRow(101 + index, 4),
      ),
    ];
    const summary = summarizeM8StatsLineupGame({
      plannedGame: plannedGame(),
      gameBody: gameBody(),
      statsRows: stats,
      lineupRows: lineups,
      snapshots: snapshots(),
    });

    assert.equal(
      summary.teams[0].completeOfficialSlots,
      true,
    );
    assert.equal(
      summary.teams[1].completeOfficialSlots,
      false,
    );
    assert.deepEqual(
      summary.teams[1].missingSlots,
      [5],
    );
    assert.equal(
      summary.stats.arithmeticMismatchCount,
      0,
    );
  },
);

test(
  'preserves null reported PA and flags arithmetic mismatches instead of filling values',
  () => {
    const lineups = [
      ...lineupRowsFor(awayTeam, 0),
      ...lineupRowsFor(homeTeam, 100),
    ];
    const stats = [
      ...Array.from(
        {
          length: 9,
        },
        (_, index) => statsRow(index + 1, 4),
      ),
      ...Array.from(
        {
          length: 9,
        },
        (_, index) => statsRow(101 + index, 4),
      ),
      statsRow(999, null, {
        at_bats: 4,
        hit_by_pitch: null,
        sac_flies: null,
        sac_bunts: null,
      }),
      statsRow(998, 4, {
        at_bats: 3,
        bb: 0,
      }),
    ];
    const summary = summarizeM8StatsLineupGame({
      plannedGame: plannedGame(),
      gameBody: gameBody(),
      statsRows: stats,
      lineupRows: lineups,
      snapshots: snapshots(),
    });

    assert.equal(
      summary.stats.nullPaBattingRowCount,
      1,
    );
    assert.equal(
      summary.stats.nullPaBattingPlayers[0]
        .componentCandidate,
      null,
    );
    assert.equal(
      summary.stats.arithmeticMismatchCount,
      1,
    );
  },
);

test(
  'builds a deterministic manifest and preserves the sealed untouched-test reservation',
  () => {
    const lineups = [
      ...lineupRowsFor(awayTeam, 0),
      ...lineupRowsFor(homeTeam, 100),
    ];
    const stats = [
      ...Array.from(
        {
          length: 9,
        },
        (_, index) => statsRow(index + 1, 4),
      ),
      ...Array.from(
        {
          length: 9,
        },
        (_, index) => statsRow(101 + index, 4),
      ),
    ];
    const game = summarizeM8StatsLineupGame({
      plannedGame: plannedGame(),
      gameBody: gameBody(),
      statsRows: stats,
      lineupRows: lineups,
      snapshots: snapshots(),
    });
    const plan = {
      planSha256: 'd'.repeat(64),
      sourceResolvedDatasetSha256:
        'e'.repeat(64),
      sourceRowCount: 70,
      gameCount: 1,
      includedPeriods: [
        'fit',
        'validation',
      ],
      untouchedTestReservation: {
        startDate: '2026-07-06',
        endDate: '2026-07-25',
        plateAppearanceCount: 16830,
        rowsIncluded: false,
      },
    };
    const first =
      buildM8StatsLineupCaptureManifest({
        plan,
        capturedGames: [game],
      });
    const second =
      buildM8StatsLineupCaptureManifest({
        plan,
        capturedGames: [game],
      });

    assert.deepEqual(first, second);
    assert.equal(
      first.untouchedTestReservation.rowsIncluded,
      false,
    );
    assert.equal(
      first.totals.completeLineupGames,
      1,
    );
  },
);

async function makeStatsLineupReferenceFixture() {
  const root = await mkdtemp(
    path.join(
      os.tmpdir(),
      'm8-stats-lineup-reference-',
    ),
  );
  const sourceCapturePath = path.join(
    root,
    'source',
    'games',
    '99',
    'capture.json',
  );
  const targetCapturePath = path.join(
    root,
    'target',
    'games',
    '99',
    'capture.json',
  );

  await mkdir(path.dirname(sourceCapturePath), {
    recursive: true,
  });
  await mkdir(path.dirname(targetCapturePath), {
    recursive: true,
  });

  const sourcePlannedGame = {
    ...plannedGame(),
    periodId: 'validation',
    sourceSnapshotPath:
      '2026-04-01/plate-appearances/game-99.json',
    sourceSnapshotSha256: 'f'.repeat(64),
    rowIdsSha256: '1'.repeat(64),
  };
  const targetPlannedGame = {
    ...sourcePlannedGame,
    periodId: 'fit',
  };

  const lineups = [
    ...lineupRowsFor(awayTeam, 0),
    ...lineupRowsFor(homeTeam, 100),
  ];
  const stats = [
    ...Array.from(
      { length: 9 },
      (_, index) => statsRow(index + 1, 4),
    ),
    ...Array.from(
      { length: 9 },
      (_, index) => statsRow(101 + index, 4),
    ),
  ];
  const game = gameBody();
  const summary = summarizeM8StatsLineupGame({
    plannedGame: sourcePlannedGame,
    gameBody: game,
    statsRows: stats,
    lineupRows: lineups,
    snapshots: snapshots(),
  });

  const sourceIdentity = {
    captureVersion: 1,
    provider: 'BALLDONTLIE MLB API',
    sourcePlanSha256: 'a'.repeat(64),
    plannedGame: sourcePlannedGame,
    gameSnapshot: {
      rawBodySha256: '2'.repeat(64),
      responseStatus: 200,
      body: {
        data: game,
      },
    },
    statsPages: [
      {
        pageNumber: 1,
        cursor: null,
        rawBodySha256: '3'.repeat(64),
        responseStatus: 200,
        responseHeaders: {},
        body: {
          data: stats,
          meta: {},
        },
      },
    ],
    lineupPages: [
      {
        pageNumber: 1,
        cursor: null,
        rawBodySha256: '4'.repeat(64),
        responseStatus: 200,
        responseHeaders: {},
        body: {
          data: lineups,
          meta: {},
        },
      },
    ],
    summary,
    untouchedTestReservation: {
      startDate: '2026-07-06',
      endDate: '2026-07-25',
      plateAppearanceCount: 100,
      rowsIncluded: false,
    },
  };
  const sourceCapture = {
    ...sourceIdentity,
    captureSha256: sha256(
      JSON.stringify(sourceIdentity),
    ),
  };
  const sourceCaptureText =
    `${JSON.stringify(sourceCapture)}\n`;

  await writeFile(
    sourceCapturePath,
    sourceCaptureText,
    'utf8',
  );

  const targetUntouchedTestReservation = {
    startDate: '2026-07-30',
    endDate: '2026-08-04',
    plateAppearanceCount: 0,
    rowsIncluded: false,
  };

  const reference =
    buildM8StatsLineupCaptureReference({
      sourceCapture,
      sourceCaptureText,
      sourceCapturePath,
      targetCapturePath,
      targetPlannedGame,
      targetSourcePlanSha256:
        'b'.repeat(64),
      targetUntouchedTestReservation,
    });

  await writeFile(
    targetCapturePath,
    `${JSON.stringify(reference)}\n`,
    'utf8',
  );

  return {
    root,
    sourceCapture,
    sourceCapturePath,
    targetCapturePath,
    targetPlannedGame,
    targetUntouchedTestReservation,
  };
}

test(
  'V5 reference rebases only planning metadata while preserving immutable provider evidence',
  async () => {
    const fixture =
      await makeStatsLineupReferenceFixture();

    try {
      const resolved =
        await resolveM8StatsLineupCapture({
          capturePath:
            fixture.targetCapturePath,
          expectedGameId: 99,
          expectedSourcePlanSha256:
            'b'.repeat(64),
        });

      assert.equal(
        resolved.plannedGame.periodId,
        'fit',
      );
      assert.equal(
        resolved.summary.periodId,
        'fit',
      );
      assert.equal(
        resolved.plannedGame.rowIdsSha256,
        fixture.sourceCapture.plannedGame
          .rowIdsSha256,
      );
      assert.deepEqual(
        resolved.gameSnapshot,
        fixture.sourceCapture.gameSnapshot,
      );
      assert.deepEqual(
        resolved.statsPages,
        fixture.sourceCapture.statsPages,
      );
      assert.deepEqual(
        resolved.lineupPages,
        fixture.sourceCapture.lineupPages,
      );
      assert.deepEqual(
        resolved.untouchedTestReservation,
        fixture
          .targetUntouchedTestReservation,
      );
    } finally {
      await rm(fixture.root, {
        recursive: true,
        force: true,
      });
    }
  },
);

test(
  'V5 reference rejects a source capture whose file hash changed',
  async () => {
    const fixture =
      await makeStatsLineupReferenceFixture();

    try {
      await writeFile(
        fixture.sourceCapturePath,
        '{"tampered":true}\n',
        'utf8',
      );

      await assert.rejects(
        resolveM8StatsLineupCapture({
          capturePath:
            fixture.targetCapturePath,
          expectedGameId: 99,
          expectedSourcePlanSha256:
            'b'.repeat(64),
        }),
        /file hash mismatch/,
      );
    } finally {
      await rm(fixture.root, {
        recursive: true,
        force: true,
      });
    }
  },
);

test(
  'V5 reference rejects changed plate-appearance row identity',
  async () => {
    const fixture =
      await makeStatsLineupReferenceFixture();

    try {
      const sourceText =
        `${JSON.stringify(
          fixture.sourceCapture,
        )}\n`;

      assert.throws(
        () =>
          buildM8StatsLineupCaptureReference({
            sourceCapture:
              fixture.sourceCapture,
            sourceCaptureText:
              sourceText,
            sourceCapturePath:
              fixture.sourceCapturePath,
            targetCapturePath:
              fixture.targetCapturePath,
            targetPlannedGame: {
              ...fixture.targetPlannedGame,
              rowIdsSha256:
                '9'.repeat(64),
            },
            targetSourcePlanSha256:
              'b'.repeat(64),
            targetUntouchedTestReservation:
              fixture
                .targetUntouchedTestReservation,
          }),
        /rowIdsSha256 mismatch/,
      );
    } finally {
      await rm(fixture.root, {
        recursive: true,
        force: true,
      });
    }
  },
);
