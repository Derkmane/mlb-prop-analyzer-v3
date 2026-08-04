import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import test from 'node:test';

import {
  M8_5_FROZEN_SUCCESSOR_ARTIFACT_SHA256,
  M8_5_UNTOUCHED_COHORT_IDENTITY_SHA256,
  M8_5_UNTOUCHED_LIMITATION,
  M8_5_UNTOUCHED_RESERVATION_ARTIFACT_SHA256,
  createM8_5UntouchedAcceptanceArtifact,
  scoreM8_5UntouchedDistributions,
  verifyM8_5UntouchedAcceptanceArtifact,
} from '../scripts/m8-5-untouched-acceptance-utils.mjs';
import { selectManifestFinalGameMap } from '../scripts/run-m8-5-untouched-acceptance.mjs';

function reservation() {
  return {
    cohortVersion: 'm8-5-untouched-current-season-cohort-v1',
    cohortIdentitySha256: M8_5_UNTOUCHED_COHORT_IDENTITY_SHA256,
    artifactSha256: M8_5_UNTOUCHED_RESERVATION_ARTIFACT_SHA256,
    dateRange: {
      startDate: '2026-07-26',
      endDate: '2026-07-29',
      dateCount: 4,
    },
    gameCount: 54,
    plateAppearanceCount: 4159,
    rowsIncluded: false,
    outcomesRead: false,
    evaluationRunCount: 0,
  };
}

function freeze() {
  return {
    modelVersion: 'm8-5-batter-hits-successor-freeze-v1',
    artifactSha256: M8_5_FROZEN_SUCCESSOR_ARTIFACT_SHA256,
    productionEnabled: false,
    rankingEnabled: false,
    untouchedTestAccessed: false,
    factors: [
      { factorKey: 'gameSpecificOffensiveEnvironment', disposition: 'applied' },
      { factorKey: 'teamSpecificBullpen', disposition: 'applied' },
      { factorKey: 'timesThroughOrder', disposition: 'identity' },
      { factorKey: 'park', disposition: 'validated-not-applied' },
      { factorKey: 'defenseToBattedBall', disposition: 'identity' },
    ],
  };
}

function score() {
  return scoreM8_5UntouchedDistributions([
    {
      observationId: '2026-07-26:1:away:slot:1',
      actualHits: 0,
      dBase: [0.7, 0.3],
      dFinal: [0.8, 0.2],
    },
    {
      observationId: '2026-07-26:1:home:slot:1',
      actualHits: 1,
      dBase: { probabilities: [0.4, 0.6] },
      dFinal: { probabilities: [0.3, 0.7] },
    },
  ]);
}

test('scores D_final and D_base on identical Hits-count observations with diagnostics separated', () => {
  const result = score();
  assert.equal(result.dFinal.observationCount, 2);
  assert.equal(result.dBase.observationCount, 2);
  assert.ok(result.dFinal.categoricalLogLoss < result.dBase.categoricalLogLoss);
  assert.ok(result.dFinal.categoricalBrier < result.dBase.categoricalBrier);
  assert.equal(result.dFinal.diagnosticOnly.label, 'DIAGNOSTIC ONLY');
  assert.equal(result.dBase.diagnosticOnly.label, 'DIAGNOSTIC ONLY');
  assert.equal(result.comparison.dFinalProperScoreDominatesDBase, true);
  assert.match(result.observationIdsSha256, /^[a-f0-9]{64}$/u);
});

test('does not claim dominance when D_final worsens one primary proper score', () => {
  const result = scoreM8_5UntouchedDistributions([
    {
      observationId: 'one',
      actualHits: 0,
      dBase: [0.8, 0.2],
      dFinal: [0.7, 0.3],
    },
  ]);
  assert.equal(result.comparison.dFinalProperScoreDominatesDBase, false);
  assert.ok(result.comparison.categoricalLogLossDelta > 0);
  assert.ok(result.comparison.categoricalBrierDelta > 0);
});

test('fails closed on duplicate observation identity or malformed probability mass', () => {
  assert.throws(
    () =>
      scoreM8_5UntouchedDistributions([
        { observationId: 'same', actualHits: 0, dBase: [1], dFinal: [1] },
        { observationId: 'same', actualHits: 0, dBase: [1], dFinal: [1] },
      ]),
    /duplicate acceptance observation ID/,
  );
  assert.throws(
    () =>
      scoreM8_5UntouchedDistributions([
        { observationId: 'bad', actualHits: 0, dBase: [0.7, 0.2], dFinal: [1] },
      ]),
    /must sum to one/,
  );
});

test('creates and verifies one immutable acceptance artifact with the explicit small-cohort limitation', () => {
  const scoring = score();
  const artifact = createM8_5UntouchedAcceptanceArtifact({
    reservation: reservation(),
    freeze: freeze(),
    score: scoring,
    evidenceCounts: {
      reservedDateCount: 4,
      reservedGameCount: 54,
      sourcePlateAppearanceCount: 4159,
      reservedRawPlateAppearanceCount: 4159,
      reservedPayloadReadCount: 54,
      candidateTeamSideCount: 108,
      excludedTeamSideCount: 0,
      scoredObservationCount: 2,
      terminalPlateAppearanceCount: 4159,
      ignoredBaserunningRowCount: 0,
      reservedHistoryUpdateGameCount: 54,
    },
    exclusionReasonCounts: {},
    sourceEvidence: { synthetic: true },
  });
  assert.equal(artifact.evaluationRunCount, 1);
  assert.equal(artifact.limitation, M8_5_UNTOUCHED_LIMITATION);
  assert.equal(artifact.productionEnabled, false);
  assert.equal(artifact.rankingEnabled, false);
  assert.equal(
    artifact.acceptanceDecision.dFinalProperScoreDominatesDBase,
    true,
  );
  assert.equal(verifyM8_5UntouchedAcceptanceArtifact(artifact), artifact);

  const tampered = structuredClone(artifact);
  tampered.scoring.dFinal.categoricalLogLoss += 0.01;
  assert.throws(
    () => verifyM8_5UntouchedAcceptanceArtifact(tampered),
    /artifact SHA-256 is invalid/,
  );
});

test('ignores an unrelated postponed snapshot row but rejects a selected unfinished game', () => {
  const finalGame = {
    id: 5057862,
    season: 2026,
    postseason: false,
    status: 'STATUS_FINAL',
  };
  const postponedGame = {
    id: 5057863,
    season: 2026,
    postseason: false,
    status: 'STATUS_POSTPONED',
  };
  const snapshot = { data: [finalGame, postponedGame] };

  const selected = selectManifestFinalGameMap(
    snapshot,
    '2026-04-02',
    [{ gameId: finalGame.id }],
  );
  assert.deepEqual([...selected.keys()], [finalGame.id]);
  assert.equal(selected.has(postponedGame.id), false);

  assert.throws(
    () =>
      selectManifestFinalGameMap(
        snapshot,
        '2026-04-02',
        [{ gameId: postponedGame.id }],
      ),
    /game 5057863 is not a final 2026 regular-season game/,
  );
});

test('one-time acceptance runner passes Node syntax checking', () => {
  execFileSync(
    process.execPath,
    [
      '--check',
      path.resolve('scripts/run-m8-5-untouched-acceptance.mjs'),
    ],
    { stdio: 'pipe' },
  );
});
