import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

import {
  verifyM8_5BatterHitsFactorArtifactV1,
} from '../dist/src/features/batter-hits/index.js';

const ARTIFACT_PATH = 'model-artifacts/m8-5-team-bullpen-outcome-v1.json';
const EXPECTED_FILE_SHA256 =
  '5eedb8c4c6485b2d90e86b7d2070e5f07cd54eeb8b7cc412323346e3e896a1f5';
const EXPECTED_ARTIFACT_SHA256 =
  '156dd99ea37aea2272fcd300b8512ad9dc27905c458b6033eeb330759f74cd9d';
const EXPECTED_EVIDENCE_SHA256 =
  '3056b9fd5b8258cdc222d1cd2e5b9fb02183f0a9d72b5625776f367132538a31';

function sha256(value) {
  return createHash('sha256').update(value).digest('hex');
}

test('locks the validated real M8.5 team-bullpen factor artifact and safety boundary', async () => {
  const text = await readFile(ARTIFACT_PATH, 'utf8');
  assert.equal(sha256(text), EXPECTED_FILE_SHA256);

  const artifact = verifyM8_5BatterHitsFactorArtifactV1(JSON.parse(text));
  assert.equal(artifact.artifactSha256, EXPECTED_ARTIFACT_SHA256);
  assert.equal(artifact.factorKey, 'teamSpecificBullpen');
  assert.equal(artifact.status, 'validated');
  assert.equal(
    artifact.modelVersion,
    'm8-5-team-bullpen-outcome-team-hand-pool-2500-v1',
  );
  assert.equal(artifact.activeSeason, 2026);
  assert.equal(artifact.validationStatus, 'current-season-validated');
  assert.equal(artifact.productionEnabled, false);
  assert.equal(artifact.selectedSideInputAllowed, false);
  assert.equal(artifact.directProbabilityEffectAllowed, false);
  assert.equal(artifact.validationEvidence?.walkForwardEvaluated, true);
  assert.equal(artifact.validationEvidence?.untouchedRowsIncluded, false);
  assert.equal(
    artifact.validationEvidence?.evidenceArtifactSha256,
    EXPECTED_EVIDENCE_SHA256,
  );
  assert.equal(artifact.untouchedTestReservation.rowsIncluded, false);
  assert.deepEqual(artifact.validationEvidence?.fitPeriod, {
    start: '2026-03-26',
    end: '2026-06-21',
  });
  assert.deepEqual(artifact.validationEvidence?.validationPeriod, {
    start: '2026-06-22',
    end: '2026-07-05',
  });

  assert.equal(artifact.effects.length, 60);
  const teamHands = new Map();
  for (const effect of artifact.effects) {
    assert.equal(effect.kind, 'terminal-outcome-vector');
    assert.equal(effect.scope, 'bullpen');
    assert.equal(
      effect.applicationStage,
      'terminal-outcome-before-statistic-distribution',
    );
    assert.equal(Object.hasOwn(effect, 'selectedSide'), false);
    assert.equal(Object.hasOwn(effect, 'probabilityDelta'), false);
    assert.equal(Object.hasOwn(effect, 'coefficient'), false);

    const match = /^pitching-team:(\d+)\|pitcher-hand:([LR])$/u.exec(
      effect.matchupKey,
    );
    assert.notEqual(match, null);
    const teamId = Number(match?.[1]);
    const hand = match?.[2];
    const hands = teamHands.get(teamId) ?? new Set();
    assert.equal(hands.has(hand), false);
    hands.add(hand);
    teamHands.set(teamId, hands);
  }

  assert.equal(teamHands.size, 30);
  for (const hands of teamHands.values()) {
    assert.deepEqual([...hands].sort(), ['L', 'R']);
  }
});
