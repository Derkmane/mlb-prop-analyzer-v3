import { readFile } from 'node:fs/promises';
import path from 'node:path';

import { sha256 } from './provider-probe-utils.mjs';

function assertObject(value, label) {
  if (
    value === null ||
    typeof value !== 'object' ||
    Array.isArray(value)
  ) {
    throw new TypeError(`${label} must be an object.`);
  }
  return value;
}

function assertArray(value, label) {
  if (!Array.isArray(value)) {
    throw new TypeError(`${label} must be an array.`);
  }
  return value;
}

function assertPositiveInteger(value, label) {
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new TypeError(`${label} must be a positive integer.`);
  }
  return value;
}

function assertNonEmptyString(value, label) {
  if (
    typeof value !== 'string' ||
    value.trim().length === 0
  ) {
    throw new TypeError(`${label} must be a non-empty string.`);
  }
  return value.trim();
}

function verifyUntouchedReservation(value, label) {
  const reservation = assertObject(value, label);

  if (
    reservation.rowsIncluded !== false ||
    Object.hasOwn(reservation, 'rows')
  ) {
    throw new Error(`${label} exposes untouched-test rows.`);
  }

  return reservation;
}

async function readJson(filePath, label) {
  const text = await readFile(filePath, 'utf8');

  let value;
  try {
    value = JSON.parse(text);
  } catch {
    throw new Error(`${label} is not valid JSON.`);
  }

  return { text, value };
}

export function m8StatsLineupCaptureIdentity(value) {
  return {
    captureVersion: value.captureVersion,
    provider: value.provider,
    sourcePlanSha256: value.sourcePlanSha256,
    plannedGame: value.plannedGame,
    gameSnapshot: value.gameSnapshot,
    statsPages: value.statsPages,
    lineupPages: value.lineupPages,
    summary: value.summary,
    untouchedTestReservation:
      value.untouchedTestReservation,
  };
}

export function m8StatsLineupManifestIdentity(value) {
  return {
    manifestVersion: value.manifestVersion,
    provider: value.provider,
    sourcePlanSha256: value.sourcePlanSha256,
    sourceResolvedDatasetSha256:
      value.sourceResolvedDatasetSha256,
    sourceRowCount: value.sourceRowCount,
    gameCount: value.gameCount,
    includedPeriods: value.includedPeriods,
    untouchedTestReservation:
      value.untouchedTestReservation,
    totals: value.totals,
    games: value.games,
  };
}

export function verifyM8StatsLineupCaptureManifest(
  rawManifest,
) {
  const manifest = assertObject(
    rawManifest,
    'stats-lineup capture manifest',
  );

  if (manifest.manifestVersion !== 1) {
    throw new Error(
      'stats-lineup capture manifestVersion must equal 1.',
    );
  }

  verifyUntouchedReservation(
    manifest.untouchedTestReservation,
    'stats-lineup capture manifest reservation',
  );

  const games = assertArray(
    manifest.games,
    'stats-lineup capture manifest games',
  );

  if (games.length !== manifest.gameCount) {
    throw new Error(
      'stats-lineup capture manifest gameCount does not match games.',
    );
  }

  const expected = sha256(
    JSON.stringify(
      m8StatsLineupManifestIdentity(manifest),
    ),
  );

  if (manifest.manifestSha256 !== expected) {
    throw new Error(
      'stats-lineup capture manifest SHA-256 is invalid.',
    );
  }

  return manifest;
}

export function verifyM8StatsLineupCapture({
  rawCapture,
  expectedGameId,
  expectedSourcePlanSha256 = null,
}) {
  const capture = assertObject(
    rawCapture,
    `stats-lineup capture game ${expectedGameId}`,
  );

  if (capture.captureVersion !== 1) {
    throw new Error(
      `stats-lineup capture game ${expectedGameId} must use captureVersion 1.`,
    );
  }

  if (
    capture.plannedGame?.gameId !== expectedGameId ||
    capture.summary?.gameId !== expectedGameId
  ) {
    throw new Error(
      `stats-lineup capture identity mismatch for game ${expectedGameId}.`,
    );
  }

  if (
    expectedSourcePlanSha256 !== null &&
    capture.sourcePlanSha256 !==
      expectedSourcePlanSha256
  ) {
    throw new Error(
      `stats-lineup capture plan mismatch for game ${expectedGameId}.`,
    );
  }

  verifyUntouchedReservation(
    capture.untouchedTestReservation,
    `stats-lineup capture game ${expectedGameId} reservation`,
  );

  const expected = sha256(
    JSON.stringify(
      m8StatsLineupCaptureIdentity(capture),
    ),
  );

  if (capture.captureSha256 !== expected) {
    throw new Error(
      `stats-lineup capture SHA-256 mismatch for game ${expectedGameId}.`,
    );
  }

  return capture;
}

function assertCompatibleEvidenceIdentity({
  sourcePlannedGame,
  targetPlannedGame,
}) {
  const source = assertObject(
    sourcePlannedGame,
    'source plannedGame',
  );
  const target = assertObject(
    targetPlannedGame,
    'target plannedGame',
  );

  const gameId = assertPositiveInteger(
    target.gameId,
    'target gameId',
  );

  const fields = [
    'gameId',
    'observedDate',
    'sourceRowCount',
    'rowIdsSha256',
  ];

  for (const field of fields) {
    if (source[field] !== target[field]) {
      throw new Error(
        `stats-lineup source evidence ${field} mismatch for game ${gameId}.`,
      );
    }
  }

  for (const field of [
    'sourceSnapshotPath',
    'sourceSnapshotSha256',
  ]) {
    if (
      source[field] !== undefined &&
      target[field] !== undefined &&
      source[field] !== target[field]
    ) {
      throw new Error(
        `stats-lineup source evidence ${field} mismatch for game ${gameId}.`,
      );
    }
  }
}

function rebaseSummary({
  sourceSummary,
  targetPlannedGame,
}) {
  const source = assertObject(
    sourceSummary,
    'source stats-lineup summary',
  );

  const identity = {
    gameId: targetPlannedGame.gameId,
    observedDate: targetPlannedGame.observedDate,
    periodId: targetPlannedGame.periodId,
    sourceRowCount:
      targetPlannedGame.sourceRowCount,
    status: source.status,
    season: source.season,
    seasonType: source.seasonType,
    teams: source.teams,
    stats: source.stats,
    snapshots: source.snapshots,
  };

  return Object.freeze({
    ...identity,
    summarySha256: sha256(
      JSON.stringify(identity),
    ),
  });
}

function referenceIdentity(value) {
  return {
    captureVersion: value.captureVersion,
    provider: value.provider,
    sourcePlanSha256: value.sourcePlanSha256,
    plannedGame: value.plannedGame,
    sourceCaptureReference:
      value.sourceCaptureReference,
    summary: value.summary,
    untouchedTestReservation:
      value.untouchedTestReservation,
  };
}

export function buildM8StatsLineupCaptureReference({
  sourceCapture,
  sourceCaptureText,
  sourceCapturePath,
  targetCapturePath,
  targetPlannedGame,
  targetSourcePlanSha256,
  targetUntouchedTestReservation,
}) {
  const source = verifyM8StatsLineupCapture({
    rawCapture: sourceCapture,
    expectedGameId: targetPlannedGame.gameId,
  });

  assertCompatibleEvidenceIdentity({
    sourcePlannedGame: source.plannedGame,
    targetPlannedGame,
  });

  verifyUntouchedReservation(
    targetUntouchedTestReservation,
    'target untouched-test reservation',
  );

  const relativePath = path
    .relative(
      path.dirname(targetCapturePath),
      sourceCapturePath,
    )
    .split(path.sep)
    .join('/');

  if (
    relativePath.length === 0 ||
    path.isAbsolute(relativePath)
  ) {
    throw new Error(
      'source capture reference path must be relative.',
    );
  }

  const identity = {
    captureVersion: 2,
    provider: source.provider,
    sourcePlanSha256:
      assertNonEmptyString(
        targetSourcePlanSha256,
        'target sourcePlanSha256',
      ),
    plannedGame: targetPlannedGame,
    sourceCaptureReference: {
      relativePath,
      sourcePlanSha256:
        source.sourcePlanSha256,
      sourceCaptureSha256:
        source.captureSha256,
      sourceCaptureFileSha256:
        sha256(sourceCaptureText),
    },
    summary: rebaseSummary({
      sourceSummary: source.summary,
      targetPlannedGame,
    }),
    untouchedTestReservation:
      targetUntouchedTestReservation,
  };

  return Object.freeze({
    ...identity,
    captureSha256: sha256(
      JSON.stringify(identity),
    ),
  });
}

function verifyReferenceCapture({
  rawCapture,
  expectedGameId,
  expectedSourcePlanSha256,
}) {
  const capture = assertObject(
    rawCapture,
    `stats-lineup reference game ${expectedGameId}`,
  );

  if (capture.captureVersion !== 2) {
    throw new Error(
      `stats-lineup reference game ${expectedGameId} must use captureVersion 2.`,
    );
  }

  if (
    capture.plannedGame?.gameId !== expectedGameId ||
    capture.summary?.gameId !== expectedGameId
  ) {
    throw new Error(
      `stats-lineup reference identity mismatch for game ${expectedGameId}.`,
    );
  }

  if (
    expectedSourcePlanSha256 !== null &&
    capture.sourcePlanSha256 !==
      expectedSourcePlanSha256
  ) {
    throw new Error(
      `stats-lineup reference plan mismatch for game ${expectedGameId}.`,
    );
  }

  verifyUntouchedReservation(
    capture.untouchedTestReservation,
    `stats-lineup reference game ${expectedGameId} reservation`,
  );

  const expected = sha256(
    JSON.stringify(referenceIdentity(capture)),
  );

  if (capture.captureSha256 !== expected) {
    throw new Error(
      `stats-lineup reference SHA-256 mismatch for game ${expectedGameId}.`,
    );
  }

  return capture;
}

export async function resolveM8StatsLineupCapture({
  capturePath,
  expectedGameId,
  expectedSourcePlanSha256 = null,
}) {
  const targetRead = await readJson(
    capturePath,
    `stats-lineup capture game ${expectedGameId}`,
  );

  if (targetRead.value?.captureVersion === 1) {
    return verifyM8StatsLineupCapture({
      rawCapture: targetRead.value,
      expectedGameId,
      expectedSourcePlanSha256,
    });
  }

  const reference = verifyReferenceCapture({
    rawCapture: targetRead.value,
    expectedGameId,
    expectedSourcePlanSha256,
  });

  const sourcePath = path.resolve(
    path.dirname(capturePath),
    assertNonEmptyString(
      reference.sourceCaptureReference
        ?.relativePath,
      'source capture relativePath',
    ),
  );

  const sourceRead = await readJson(
    sourcePath,
    `referenced stats-lineup capture game ${expectedGameId}`,
  );

  if (
    sha256(sourceRead.text) !==
    reference.sourceCaptureReference
      .sourceCaptureFileSha256
  ) {
    throw new Error(
      `referenced stats-lineup capture file hash mismatch for game ${expectedGameId}.`,
    );
  }

  const source = verifyM8StatsLineupCapture({
    rawCapture: sourceRead.value,
    expectedGameId,
    expectedSourcePlanSha256:
      reference.sourceCaptureReference
        .sourcePlanSha256,
  });

  if (
    source.captureSha256 !==
    reference.sourceCaptureReference
      .sourceCaptureSha256
  ) {
    throw new Error(
      `referenced stats-lineup capture identity mismatch for game ${expectedGameId}.`,
    );
  }

  assertCompatibleEvidenceIdentity({
    sourcePlannedGame: source.plannedGame,
    targetPlannedGame:
      reference.plannedGame,
  });

  const identity = {
    captureVersion: 1,
    provider: source.provider,
    sourcePlanSha256:
      reference.sourcePlanSha256,
    plannedGame: reference.plannedGame,
    gameSnapshot: source.gameSnapshot,
    statsPages: source.statsPages,
    lineupPages: source.lineupPages,
    summary: reference.summary,
    untouchedTestReservation:
      reference.untouchedTestReservation,
  };

  return verifyM8StatsLineupCapture({
    rawCapture: {
      ...identity,
      captureSha256: sha256(
        JSON.stringify(identity),
      ),
    },
    expectedGameId,
    expectedSourcePlanSha256,
  });
}
