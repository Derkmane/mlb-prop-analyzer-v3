import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

import {
  M8_5_FROZEN_SUCCESSOR_ARTIFACT_SHA256,
  M8_5_UNTOUCHED_COHORT_IDENTITY_SHA256,
  M8_5_UNTOUCHED_LIMITATION,
  M8_5_UNTOUCHED_RESERVATION_ARTIFACT_SHA256,
  verifyM8_5UntouchedAcceptanceArtifact,
} from '../scripts/m8-5-untouched-acceptance-utils.mjs';

const ARTIFACT_PATH =
  'model-artifacts/m8-5-batter-hits-untouched-acceptance-v1.json';
const EXPECTED_FILE_SHA256 =
  '38603400cf77cb5f0ade13077fb8215e59ac7ad7b1d2fb8b13adf18491cb0497';
const EXPECTED_ARTIFACT_SHA256 =
  '9c7ba5ae6b7b77334e2e5c444b680261fa8e0e82ef9ce621091c30f64ec3f321';
const EXPECTED_OBSERVATION_IDS_SHA256 =
  'e35daddc97e7a63e5dc1973a7c543633b1befeee4dcc6631d5e331e56e0c998a';

function sha256(value) {
  return createHash('sha256').update(value).digest('hex');
}

test('locks the immutable one-time M8.5 untouched acceptance result and safety boundary', async () => {
  const text = await readFile(ARTIFACT_PATH, 'utf8');
  assert.equal(sha256(text), EXPECTED_FILE_SHA256);

  const artifact = JSON.parse(text);
  assert.equal(
    verifyM8_5UntouchedAcceptanceArtifact(artifact),
    artifact,
  );
  assert.equal(artifact.artifactSha256, EXPECTED_ARTIFACT_SHA256);
  assert.equal(artifact.artifactVersion, 1);
  assert.equal(artifact.evaluationVersion, 1);
  assert.equal(
    artifact.status,
    'untouched-acceptance-d-final-proper-score-dominates-d-base',
  );
  assert.equal(artifact.evaluationRunCount, 1);
  assert.equal(artifact.productionEnabled, false);
  assert.equal(artifact.rankingEnabled, false);
  assert.equal(artifact.hardDiscoveryFilterEnabled, false);
  assert.equal(artifact.limitation, M8_5_UNTOUCHED_LIMITATION);

  assert.deepEqual(artifact.reservedCohort.dateRange, {
    startDate: '2026-07-26',
    endDate: '2026-07-29',
    dateCount: 4,
  });
  assert.equal(
    artifact.reservedCohort.cohortIdentitySha256,
    M8_5_UNTOUCHED_COHORT_IDENTITY_SHA256,
  );
  assert.equal(
    artifact.reservedCohort.reservationArtifactSha256,
    M8_5_UNTOUCHED_RESERVATION_ARTIFACT_SHA256,
  );
  assert.equal(artifact.reservedCohort.gameCount, 54);
  assert.equal(artifact.reservedCohort.sourcePlateAppearanceCount, 4159);
  assert.equal(
    artifact.frozenSuccessor.artifactSha256,
    M8_5_FROZEN_SUCCESSOR_ARTIFACT_SHA256,
  );

  assert.deepEqual(artifact.evidenceCounts, {
    reservedDateCount: 4,
    reservedGameCount: 54,
    sourcePlateAppearanceCount: 4159,
    reservedRawPlateAppearanceCount: 4159,
    reservedPayloadReadCount: 54,
    candidateTeamSideCount: 108,
    excludedTeamSideCount: 8,
    scoredObservationCount: 900,
    terminalPlateAppearanceCount: 4152,
    ignoredBaserunningRowCount: 3,
    reservedHistoryUpdateGameCount: 50,
  });
  assert.deepEqual(artifact.exclusionReasonCounts, {
    'history-update-incomplete-terminal-game': 4,
    'simultaneous-multi-slot-phase-shift': 4,
    'terminal-row-unknown-result': 4,
  });

  assert.equal(artifact.scoring.dFinal.observationCount, 900);
  assert.equal(artifact.scoring.dBase.observationCount, 900);
  assert.equal(
    artifact.scoring.dFinal.categoricalLogLoss,
    1.1963378032363834,
  );
  assert.equal(
    artifact.scoring.dBase.categoricalLogLoss,
    1.1969075916539054,
  );
  assert.equal(
    artifact.scoring.dFinal.categoricalBrier,
    0.6558780914218736,
  );
  assert.equal(
    artifact.scoring.dBase.categoricalBrier,
    0.656181484212015,
  );
  assert.equal(
    artifact.scoring.comparison.categoricalLogLossDelta,
    -0.000569788417521977,
  );
  assert.equal(
    artifact.scoring.comparison.categoricalBrierDelta,
    -0.0003033927901414657,
  );
  assert.equal(
    artifact.scoring.comparison.dFinalProperScoreDominatesDBase,
    true,
  );
  assert.equal(
    artifact.scoring.observationIdsSha256,
    EXPECTED_OBSERVATION_IDS_SHA256,
  );
  assert.equal(
    artifact.scoring.dFinal.diagnosticOnly.label,
    'DIAGNOSTIC ONLY',
  );
  assert.equal(
    artifact.scoring.dBase.diagnosticOnly.label,
    'DIAGNOSTIC ONLY',
  );

  assert.deepEqual(
    artifact.factorDispositions.map((factor) => ({
      factorKey: factor.factorKey,
      disposition: factor.disposition,
      includedInCanonicalDFinalComposition:
        factor.includedInCanonicalDFinalComposition,
    })),
    [
      {
        factorKey: 'gameSpecificOffensiveEnvironment',
        disposition: 'applied',
        includedInCanonicalDFinalComposition: true,
      },
      {
        factorKey: 'teamSpecificBullpen',
        disposition: 'applied',
        includedInCanonicalDFinalComposition: true,
      },
      {
        factorKey: 'timesThroughOrder',
        disposition: 'identity',
        includedInCanonicalDFinalComposition: true,
      },
      {
        factorKey: 'park',
        disposition: 'validated-not-applied',
        includedInCanonicalDFinalComposition: true,
      },
      {
        factorKey: 'defenseToBattedBall',
        disposition: 'identity',
        includedInCanonicalDFinalComposition: false,
      },
    ],
  );

  assert.equal(
    artifact.acceptanceDecision.dFinalProperScoreDominatesDBase,
    true,
  );
  assert.equal(
    artifact.acceptanceDecision.productionAuthorizationGranted,
    false,
  );
  assert.equal(artifact.acceptanceDecision.retuningAuthorized, false);
  assert.equal(Object.hasOwn(artifact, 'selectedSide'), false);
  assert.equal(Object.hasOwn(artifact, 'candidateSetRevision'), false);
  assert.equal(Object.hasOwn(artifact, 'productionAuthorization'), false);
});
