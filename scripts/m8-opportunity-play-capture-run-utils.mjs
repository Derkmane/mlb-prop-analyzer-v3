import {
  access,
  readFile,
  rm,
} from 'node:fs/promises';
import path from 'node:path';

import {
  sha256,
  writeJsonAtomic,
} from './provider-probe-utils.mjs';
import {
  promoteM8ContextPlayGameCapture,
  verifyM8ContextPlayGameCapture,
} from './m8-context-play-capture-utils.mjs';

const SHA256_PATTERN =
  /^[a-f0-9]{64}$/;

const INCLUDED_PERIODS =
  Object.freeze([
    'fit',
    'validation',
  ]);

export const M8_OPPORTUNITY_GAME_CAPTURE_PURPOSE =
  'Preserve complete paginated BALLDONTLIE play evidence for one current-season fit-validation game used to construct hitter opportunity sequences.';

function assertPlainObject(
  value,
  label,
) {
  if (
    value === null ||
    typeof value !== 'object' ||
    Array.isArray(value)
  ) {
    throw new TypeError(
      `${label} must be an object.`,
    );
  }

  return value;
}

function assertArray(
  value,
  label,
) {
  if (!Array.isArray(value)) {
    throw new TypeError(
      `${label} must be an array.`,
    );
  }

  return value;
}

function assertNonEmptyString(
  value,
  label,
) {
  if (
    typeof value !== 'string' ||
    value.trim().length === 0
  ) {
    throw new TypeError(
      `${label} must be a non-empty string.`,
    );
  }

  return value.trim();
}

function assertInteger(
  value,
  label,
) {
  if (!Number.isSafeInteger(value)) {
    throw new TypeError(
      `${label} must be an integer.`,
    );
  }

  return value;
}

function assertPositiveInteger(
  value,
  label,
) {
  const integer =
    assertInteger(
      value,
      label,
    );

  if (integer <= 0) {
    throw new RangeError(
      `${label} must be positive.`,
    );
  }

  return integer;
}

function assertNonNegativeInteger(
  value,
  label,
) {
  const integer =
    assertInteger(
      value,
      label,
    );

  if (integer < 0) {
    throw new RangeError(
      `${label} must be non-negative.`,
    );
  }

  return integer;
}

function assertSha256(
  value,
  label,
) {
  if (
    typeof value !== 'string' ||
    !SHA256_PATTERN.test(value)
  ) {
    throw new TypeError(
      `${label} must be a lowercase SHA-256 digest.`,
    );
  }

  return value;
}

function parseJson(
  text,
  label,
) {
  try {
    return JSON.parse(text);
  } catch {
    throw new Error(
      `${label} is not valid JSON.`,
    );
  }
}

async function pathExists(
  value,
) {
  try {
    await access(value);
    return true;
  } catch (error) {
    if (
      error?.code === 'ENOENT'
    ) {
      return false;
    }

    throw error;
  }
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

function validatePlanGame(
  rawGame,
  index,
) {
  const label =
    `plan.games[${index}]`;

  const game =
    assertPlainObject(
      rawGame,
      label,
    );

  const periodId =
    assertNonEmptyString(
      game.periodId,
      `${label}.periodId`,
    );

  if (
    !INCLUDED_PERIODS.includes(
      periodId,
    )
  ) {
    throw new Error(
      `${label}.periodId is unsupported.`,
    );
  }

  return Object.freeze({
    gameId:
      assertPositiveInteger(
        game.gameId,
        `${label}.gameId`,
      ),
    observedDate:
      assertNonEmptyString(
        game.observedDate,
        `${label}.observedDate`,
      ),
    periodId,
    sourceRowCount:
      assertPositiveInteger(
        game.sourceRowCount,
        `${label}.sourceRowCount`,
      ),
    sourceSnapshotPath:
      assertNonEmptyString(
        game.sourceSnapshotPath,
        `${label}.sourceSnapshotPath`,
      ),
    sourceSnapshotSha256:
      assertSha256(
        game.sourceSnapshotSha256,
        `${label}.sourceSnapshotSha256`,
      ),
    rowIdsSha256:
      assertSha256(
        game.rowIdsSha256,
        `${label}.rowIdsSha256`,
      ),
  });
}

function validatePlan(
  rawPlan,
) {
  const plan =
    assertPlainObject(
      rawPlan,
      'opportunity capture plan',
    );

  if (
    plan.planVersion !== 1
  ) {
    throw new Error(
      'opportunity capture planVersion must equal 1.',
    );
  }

  const includedPeriods =
    assertArray(
      plan.includedPeriods,
      'includedPeriods',
    ).map(
      (value, index) =>
        assertNonEmptyString(
          value,
          `includedPeriods[${index}]`,
        ),
    );

  if (
    JSON.stringify(
      includedPeriods,
    ) !==
    JSON.stringify(
      INCLUDED_PERIODS,
    )
  ) {
    throw new Error(
      'opportunity capture includedPeriods must be fit and validation.',
    );
  }

  const games =
    assertArray(
      plan.games,
      'plan.games',
    ).map(
      validatePlanGame,
    );

  if (
    games.length !==
    assertNonNegativeInteger(
      plan.gameCount,
      'plan.gameCount',
    )
  ) {
    throw new Error(
      'opportunity capture gameCount does not match games.',
    );
  }

  const seenGameIds =
    new Set();

  let sourceRowCount = 0;

  for (
    const [index, game] of
    games.entries()
  ) {
    if (
      seenGameIds.has(
        game.gameId,
      )
    ) {
      throw new Error(
        `duplicate planned gameId ${game.gameId}.`,
      );
    }

    seenGameIds.add(
      game.gameId,
    );

    sourceRowCount +=
      game.sourceRowCount;

    if (index > 0) {
      const previous =
        games[index - 1];

      const order =
        previous.observedDate.localeCompare(
          game.observedDate,
        ) ||
        previous.gameId -
          game.gameId;

      if (order >= 0) {
        throw new Error(
          'opportunity capture games are not in deterministic chronological order.',
        );
      }
    }
  }

  if (
    sourceRowCount !==
    assertNonNegativeInteger(
      plan.sourceRowCount,
      'plan.sourceRowCount',
    )
  ) {
    throw new Error(
      'opportunity capture sourceRowCount does not match games.',
    );
  }

  const untouched =
    assertPlainObject(
      plan.untouchedTestReservation,
      'untouchedTestReservation',
    );

  if (
    untouched.rowsIncluded !== false ||
    Object.hasOwn(
      untouched,
      'rows',
    )
  ) {
    throw new Error(
      'untouched-test rows must remain excluded from opportunity capture.',
    );
  }

  const normalized = {
    ...plan,
    activeSeason:
      assertPositiveInteger(
        plan.activeSeason,
        'activeSeason',
      ),
    sourceResolvedDatasetSha256:
      assertSha256(
        plan.sourceResolvedDatasetSha256,
        'sourceResolvedDatasetSha256',
      ),
    sourceResolvedDatasetFileSha256:
      assertSha256(
        plan.sourceResolvedDatasetFileSha256,
        'sourceResolvedDatasetFileSha256',
      ),
    includedPeriods:
      Object.freeze(
        includedPeriods,
      ),
    sourceRowCount,
    gameCount:
      games.length,
    games:
      Object.freeze(
        games,
      ),
    untouchedTestReservation:
      Object.freeze({
        ...untouched,
        rowsIncluded: false,
      }),
  };

  const expectedPlanSha256 =
    sha256(
      JSON.stringify(
        planIdentity(
          normalized,
        ),
      ),
    );

  if (
    assertSha256(
      plan.planSha256,
      'plan.planSha256',
    ) !==
    expectedPlanSha256
  ) {
    throw new Error(
      'opportunity capture plan SHA-256 is invalid.',
    );
  }

  return Object.freeze(
    normalized,
  );
}

function capturedGamesInPlanOrder({
  plan,
  capturedGames,
  requireComplete,
}) {
  const validatedPlan =
    validatePlan(plan);

  const rawCapturedGames =
    assertArray(
      capturedGames,
      'capturedGames',
    );

  const planByGameId =
    new Map(
      validatedPlan.games.map(
        (game, index) => [
          game.gameId,
          {
            game,
            index,
          },
        ],
      ),
    );

  const seen =
    new Set();

  const validated =
    rawCapturedGames.map(
      (rawCaptured, index) => {
        const label =
          `capturedGames[${index}]`;

        const captured =
          assertPlainObject(
            rawCaptured,
            label,
          );

        const gameId =
          assertPositiveInteger(
            captured.gameId,
            `${label}.gameId`,
          );

        if (
          seen.has(gameId)
        ) {
          throw new Error(
            `duplicate captured gameId ${gameId}.`,
          );
        }

        seen.add(gameId);

        const planned =
          planByGameId.get(
            gameId,
          );

        if (
          planned === undefined
        ) {
          throw new Error(
            `captured gameId ${gameId} is outside the opportunity plan.`,
          );
        }

        const expected =
          planned.game;

        const exactFields = [
          'observedDate',
          'periodId',
          'sourceRowCount',
          'sourceSnapshotPath',
          'sourceSnapshotSha256',
          'rowIdsSha256',
        ];

        for (
          const field of
          exactFields
        ) {
          if (
            captured[field] !==
            expected[field]
          ) {
            throw new Error(
              `captured game ${gameId} ${field} drifted from the plan.`,
            );
          }
        }

        return Object.freeze({
          gameId,
          observedDate:
            expected.observedDate,
          periodId:
            expected.periodId,
          sourceRowCount:
            expected.sourceRowCount,
          sourceSnapshotPath:
            expected.sourceSnapshotPath,
          sourceSnapshotSha256:
            expected.sourceSnapshotSha256,
          rowIdsSha256:
            expected.rowIdsSha256,
          pageCount:
            assertPositiveInteger(
              captured.pageCount,
              `${label}.pageCount`,
            ),
          recordCount:
            assertNonNegativeInteger(
              captured.recordCount,
              `${label}.recordCount`,
            ),
          gameManifestSha256:
            assertSha256(
              captured.gameManifestSha256,
              `${label}.gameManifestSha256`,
            ),
          planIndex:
            planned.index,
        });
      },
    );

  if (
    requireComplete &&
    validated.length !==
      validatedPlan.gameCount
  ) {
    throw new Error(
      'complete opportunity capture does not contain every planned game.',
    );
  }

  return Object.freeze(
    validated
      .sort(
        (left, right) =>
          left.planIndex -
          right.planIndex,
      )
      .map(
        ({
          planIndex,
          ...game
        }) =>
          Object.freeze(
            game,
          ),
      ),
  );
}

export async function ensureM8OpportunityCapturePlan({
  outputRoot,
  plan,
}) {
  const root =
    assertNonEmptyString(
      outputRoot,
      'outputRoot',
    );

  const validatedPlan =
    validatePlan(plan);

  const planPath =
    path.join(
      root,
      'capture-plan.json',
    );

  if (
    await pathExists(
      planPath,
    )
  ) {
    const existingText =
      await readFile(
        planPath,
        'utf8',
      );

    const existing =
      validatePlan(
        parseJson(
          existingText,
          'existing opportunity capture plan',
        ),
      );

    if (
      JSON.stringify(
        existing,
      ) !==
      JSON.stringify(
        validatedPlan,
      )
    ) {
      throw new Error(
        'existing opportunity capture plan differs from the requested plan.',
      );
    }

    return Object.freeze({
      planPath,
      planText:
        existingText,
      reused: true,
    });
  }

  await writeJsonAtomic(
    planPath,
    validatedPlan,
  );

  return Object.freeze({
    planPath,
    planText:
      await readFile(
        planPath,
        'utf8',
      ),
    reused: false,
  });
}

export async function promoteM8OpportunityPlayGameCapture({
  outputRoot,
  gameId,
  collected,
}) {
  const promoted =
    await promoteM8ContextPlayGameCapture({
      outputRoot,
      gameId,
      collected,
    });

  const manifest = {
    ...promoted.manifest,
    purpose:
      M8_OPPORTUNITY_GAME_CAPTURE_PURPOSE,
  };

  try {
    await writeJsonAtomic(
      path.join(
        promoted.finalDirectory,
        'game-manifest.json',
      ),
      manifest,
    );
  } catch (error) {
    await rm(
      promoted.finalDirectory,
      {
        recursive: true,
        force: true,
      },
    );

    throw error;
  }

  return Object.freeze({
    ...promoted,
    manifest:
      Object.freeze(
        manifest,
      ),
  });
}

export async function verifyM8OpportunityPlayGameCapture({
  gameDirectory,
  expectedGameId,
  secret = null,
}) {
  const verified =
    await verifyM8ContextPlayGameCapture({
      gameDirectory,
      expectedGameId,
      secret,
    });

  const manifestPath =
    path.join(
      gameDirectory,
      'game-manifest.json',
    );

  const manifestText =
    await readFile(
      manifestPath,
      'utf8',
    );

  const manifest =
    assertPlainObject(
      parseJson(
        manifestText,
        `game ${expectedGameId} opportunity manifest`,
      ),
      `game ${expectedGameId} opportunity manifest`,
    );

  if (
    manifest.purpose !==
    M8_OPPORTUNITY_GAME_CAPTURE_PURPOSE
  ) {
    throw new Error(
      `game ${expectedGameId} is not an opportunity-play capture.`,
    );
  }

  return Object.freeze({
    ...verified,
    gameManifestSha256:
      sha256(
        manifestText,
      ),
  });
}

export function summarizeM8OpportunityCapturedGame({
  game,
  verified,
}) {
  const planned =
    validatePlanGame(
      game,
      0,
    );

  const evidence =
    assertPlainObject(
      verified,
      'verified game capture',
    );

  if (
    evidence.status !==
    'verified'
  ) {
    throw new Error(
      'verified game capture status must equal verified.',
    );
  }

  if (
    assertPositiveInteger(
      evidence.gameId,
      'verified gameId',
    ) !==
    planned.gameId
  ) {
    throw new Error(
      'verified game identity differs from the opportunity plan.',
    );
  }

  return Object.freeze({
    ...planned,
    pageCount:
      assertPositiveInteger(
        evidence.pageCount,
        'verified pageCount',
      ),
    recordCount:
      assertNonNegativeInteger(
        evidence.recordCount,
        'verified recordCount',
      ),
    gameManifestSha256:
      assertSha256(
        evidence.gameManifestSha256,
        'verified gameManifestSha256',
      ),
  });
}

export function buildM8OpportunityPlayCaptureProgress({
  plan,
  capturedGames,
  selectedNewGameCount,
  remainingGameCount,
  maxNewGames,
}) {
  const validatedPlan =
    validatePlan(plan);

  const orderedGames =
    capturedGamesInPlanOrder({
      plan:
        validatedPlan,
      capturedGames,
      requireComplete: false,
    });

  const selectedCount =
    assertNonNegativeInteger(
      selectedNewGameCount,
      'selectedNewGameCount',
    );

  const remainingCount =
    assertNonNegativeInteger(
      remainingGameCount,
      'remainingGameCount',
    );

  const limit =
    assertNonNegativeInteger(
      maxNewGames,
      'maxNewGames',
    );

  if (
    remainingCount !==
    validatedPlan.gameCount -
      orderedGames.length
  ) {
    throw new Error(
      'opportunity capture remaining count disagrees with verified games.',
    );
  }

  if (
    selectedCount >
    orderedGames.length
  ) {
    throw new Error(
      'opportunity capture selected count exceeds verified games.',
    );
  }

  const identity = {
    activeSeason:
      validatedPlan.activeSeason,
    sourceResolvedDatasetSha256:
      validatedPlan
        .sourceResolvedDatasetSha256,
    sourceResolvedDatasetFileSha256:
      validatedPlan
        .sourceResolvedDatasetFileSha256,
    sourcePlanSha256:
      validatedPlan.planSha256,
    plannedSourceRowCount:
      validatedPlan.sourceRowCount,
    plannedGameCount:
      validatedPlan.gameCount,
    verifiedGameCount:
      orderedGames.length,
    newlyCapturedGameCount:
      selectedCount,
    remainingGameCount:
      remainingCount,
    maxNewGames:
      limit,
    verifiedGameIdsSha256:
      sha256(
        JSON.stringify(
          orderedGames.map(
            (game) =>
              game.gameId,
          ),
        ),
      ),
    untouchedTestReservation:
      validatedPlan
        .untouchedTestReservation,
  };

  return Object.freeze({
    captureVersion: 1,
    purpose:
      'Record resumable partial progress for complete fit-validation hitter-opportunity play capture.',
    provider:
      'BALLDONTLIE MLB API',
    status: 'partial',
    error: null,
    ...identity,
    progressSha256:
      sha256(
        JSON.stringify(
          identity,
        ),
      ),
  });
}

export function buildM8OpportunityPlayCaptureManifest({
  plan,
  planText,
  capturedGames,
}) {
  const validatedPlan =
    validatePlan(plan);

  const sourcePlanText =
    assertNonEmptyString(
      planText,
      'planText',
    );

  const parsedPlan =
    validatePlan(
      parseJson(
        sourcePlanText,
        'saved opportunity capture plan',
      ),
    );

  if (
    JSON.stringify(
      parsedPlan,
    ) !==
    JSON.stringify(
      validatedPlan,
    )
  ) {
    throw new Error(
      'saved opportunity capture plan differs from the supplied plan.',
    );
  }

  const orderedGames =
    capturedGamesInPlanOrder({
      plan:
        validatedPlan,
      capturedGames,
      requireComplete: true,
    });

  const identity = {
    activeSeason:
      validatedPlan.activeSeason,
    sourceResolvedDatasetSha256:
      validatedPlan
        .sourceResolvedDatasetSha256,
    sourceResolvedDatasetFileSha256:
      validatedPlan
        .sourceResolvedDatasetFileSha256,
    sourcePlanSha256:
      validatedPlan.planSha256,
    sourcePlanFileSha256:
      sha256(
        sourcePlanText,
      ),
    sourceRowCount:
      validatedPlan.sourceRowCount,
    gameCount:
      validatedPlan.gameCount,
    games:
      orderedGames,
    totalPageCount:
      orderedGames.reduce(
        (sum, game) =>
          sum +
          game.pageCount,
        0,
      ),
    totalPlayRecordCount:
      orderedGames.reduce(
        (sum, game) =>
          sum +
          game.recordCount,
        0,
      ),
    untouchedTestReservation:
      validatedPlan
        .untouchedTestReservation,
  };

  return Object.freeze({
    captureVersion: 1,
    purpose:
      'Preserve complete paginated BALLDONTLIE play evidence for every current-season fit-validation game used to construct hitter opportunity sequences.',
    provider:
      'BALLDONTLIE MLB API',
    status: 'complete',
    error: null,
    ...identity,
    captureSha256:
      sha256(
        JSON.stringify(
          identity,
        ),
      ),
  });
}
