import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { authorizeMarketForPrediction } from '../src/application/index.js';
import {
  connectFrozenBatterHitsProbabilityOutput,
  PRODUCTION_REGISTRIES,
} from '../src/composition/index.js';
import { settleDiscreteStatistic } from '../src/core/index.js';
import {
  BATTER_HITS_MARKET_KEY,
  createDisabledM8_5BatterHitsFactorArtifactV1,
} from '../src/features/batter-hits/index.js';
import {
  m9FinalProbabilityInput,
  m9Offer,
  m9PregameBoard,
  m9SyntheticOffer,
} from './helpers/m9-batter-hits-final-runtime-fixture.js';

const TEAM_BULLPEN_ARTIFACT_PATH = path.resolve(
  'model-artifacts/m8-5-team-bullpen-outcome-v1.json',
);
const TOLERANCE = 1e-12;

function batterHitsDetails(
  result: Awaited<ReturnType<typeof connectFrozenBatterHitsProbabilityOutput>>,
) {
  const details = result.candidate.featureData.values.batterHits;
  assert.ok(details !== null && typeof details === 'object');
  return details;
}

async function withTemporaryDirectory<T>(
  action: (directory: string) => Promise<T>,
): Promise<T> {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'm9-d-final-'));
  try {
    return await action(directory);
  } finally {
    await fs.rm(directory, { recursive: true, force: true });
  }
}

test('public Batter Hits candidate probabilities come from exact settlement of D_final', async () => {
  const board = m9PregameBoard();
  const offer = m9Offer(board, 'Gavin Sheets', 'baseline', 0.5, 'higher');
  const result = await connectFrozenBatterHitsProbabilityOutput(
    await m9FinalProbabilityInput(board, offer),
  );
  const manual = settleDiscreteStatistic({
    statisticDistribution: result.finalEvaluation.dFinal.statisticDistribution,
    eligibilityProbability:
      result.finalEvaluation.sourceM8Evaluation.baseDistribution.baseballInputs
        .eligibilityProbability,
    line: offer.line,
    selectedSide: offer.selectedSide,
  });

  assert.deepEqual(result.distribution, result.finalEvaluation.dFinal);
  assert.deepEqual(
    result.candidate.statisticDistribution,
    result.finalEvaluation.dFinal.statisticDistribution,
  );
  assert.equal(result.candidate.pWin, manual.winProbability);
  assert.equal(result.candidate.pLoss, manual.lossProbability);
  assert.equal(result.candidate.pVoid, manual.voidProbability);
  assert.equal(
    result.candidate.pWinGivenGrades,
    manual.winProbabilityGivenGrades,
  );
  assert.equal(
    result.candidate.pWinGivenGrades,
    result.finalEvaluation.probabilities.pFinal,
  );
  assert.equal(
    Math.abs(
      result.candidate.pWin +
        result.candidate.pLoss +
        result.candidate.pVoid -
        1,
    ) <= TOLERANCE,
    true,
  );
  assert.equal(
    result.candidate.modelVersion,
    'm8-5-batter-hits-successor-freeze-v1',
  );
});

test('a real p_final difference is reported diagnostically while candidate probabilities use p_final', async () => {
  const board = m9PregameBoard();
  const offer = m9Offer(board, 'Gavin Sheets', 'baseline', 0.5, 'higher');
  const result = await connectFrozenBatterHitsProbabilityOutput(
    await m9FinalProbabilityInput(board, offer),
  );
  const details = batterHitsDetails(result);
  const pBase = result.finalEvaluation.probabilities.pBase;
  const pFinal = result.finalEvaluation.probabilities.pFinal;
  assert.notEqual(pBase, null);
  assert.notEqual(pFinal, null);
  assert.notEqual(pFinal, pBase);
  assert.equal(result.candidate.pWinGivenGrades, pFinal);
  assert.equal(details['pBase'], pBase);
  assert.equal(details['pFinal'], pFinal);
  assert.equal(
    details['contextProbabilityDelta'],
    result.finalEvaluation.probabilities.contextProbabilityDelta,
  );
  assert.equal(
    details['baseDistributionSha256'],
    result.finalEvaluation.baseDistributionSha256,
  );
  assert.equal(
    details['finalDistributionSha256'],
    result.finalEvaluation.finalDistributionSha256,
  );
  assert.equal(
    details['contextModelVersion'],
    result.finalEvaluation.contextModelVersion,
  );
  const dispositions = details['factorDispositions'];
  assert.ok(Array.isArray(dispositions));
  assert.deepEqual(
    dispositions.map((entry) =>
      typeof entry === 'object' && entry !== null
        ? (entry as { readonly factorKey?: unknown }).factorKey
        : null,
    ),
    [
      'gameSpecificOffensiveEnvironment',
      'teamSpecificBullpen',
      'timesThroughOrder',
      'park',
      'defenseToBattedBall',
    ],
  );
});

test('baseline and alternate offers for one player and game settle one identical D_final', async () => {
  const originalBoard = m9PregameBoard();
  const baseline = m9Offer(
    originalBoard,
    'Gavin Sheets',
    'baseline',
    0.5,
    'higher',
  );
  const alternate = m9SyntheticOffer(baseline, 'lower', 1.5);
  const board = Object.freeze({
    ...originalBoard,
    offers: Object.freeze([...originalBoard.offers, alternate]),
  });
  const [baselineResult, alternateResult] = await Promise.all([
    connectFrozenBatterHitsProbabilityOutput(
      await m9FinalProbabilityInput(board, baseline),
    ),
    connectFrozenBatterHitsProbabilityOutput(
      await m9FinalProbabilityInput(board, alternate),
    ),
  ]);

  assert.equal(
    baselineResult.finalEvaluation.finalDistributionSha256,
    alternateResult.finalEvaluation.finalDistributionSha256,
  );
  assert.deepEqual(
    baselineResult.finalEvaluation.dFinal,
    alternateResult.finalEvaluation.dFinal,
  );
  assert.deepEqual(
    baselineResult.candidate.statisticDistribution,
    alternateResult.candidate.statisticDistribution,
  );
  assert.equal(baselineResult.candidate.line, 0.5);
  assert.equal(alternateResult.candidate.line, 1.5);
  assert.equal(baselineResult.candidate.selectedSide, 'higher');
  assert.equal(alternateResult.candidate.selectedSide, 'lower');
});

test('factor artifact hash drift fails closed before a candidate exists', async () => {
  await withTemporaryDirectory(async (directory) => {
    const raw = JSON.parse(
      await fs.readFile(TEAM_BULLPEN_ARTIFACT_PATH, 'utf8'),
    ) as Record<string, unknown>;
    const tamperedPath = path.join(directory, 'team-bullpen-tampered.json');
    await fs.writeFile(
      tamperedPath,
      `${JSON.stringify({ ...raw, artifactSha256: '0'.repeat(64) }, null, 2)}\n`,
      'utf8',
    );
    const board = m9PregameBoard();
    const offer = m9Offer(board, 'Gavin Sheets', 'baseline', 0.5, 'higher');
    await assert.rejects(
      connectFrozenBatterHitsProbabilityOutput({
        ...(await m9FinalProbabilityInput(board, offer)),
        successorArtifactPaths: {
          teamBullpenArtifactPath: tamperedPath,
        },
      }),
      /SHA-256|artifact/u,
    );
  });
});

test('missing or unvalidated frozen factors fail closed with no D_base fallback', async () => {
  await withTemporaryDirectory(async (directory) => {
    const board = m9PregameBoard();
    const offer = m9Offer(board, 'Gavin Sheets', 'baseline', 0.5, 'higher');
    const baseInput = await m9FinalProbabilityInput(board, offer);

    await assert.rejects(
      connectFrozenBatterHitsProbabilityOutput({
        ...baseInput,
        successorArtifactPaths: {
          defenseArtifactPath: path.join(directory, 'missing-defense.json'),
        },
      }),
      /ENOENT|no such file/u,
    );

    const unvalidatedPath = path.join(
      directory,
      'team-bullpen-unvalidated.json',
    );
    const unvalidated = createDisabledM8_5BatterHitsFactorArtifactV1({
      factorKey: 'teamSpecificBullpen',
      requiredInputs: ['opposing-pitching-team-id', 'bullpen-pitcher-hand'],
      sourceEvidenceVersion: 'm9-unvalidated-factor-protective-test',
    });
    await fs.writeFile(
      unvalidatedPath,
      `${JSON.stringify(unvalidated, null, 2)}\n`,
      'utf8',
    );
    await assert.rejects(
      connectFrozenBatterHitsProbabilityOutput({
        ...baseInput,
        successorArtifactPaths: {
          teamBullpenArtifactPath: unvalidatedPath,
        },
      }),
      /successor freeze|teamSpecificBullpen|validated/u,
    );
  });
});

test('identical inputs produce deterministic final output while production and ranking remain disabled', async () => {
  const board = m9PregameBoard();
  const offer = m9Offer(board, 'Gavin Sheets', 'baseline', 0.5, 'higher');
  const input = await m9FinalProbabilityInput(board, offer);
  const [first, second] = await Promise.all([
    connectFrozenBatterHitsProbabilityOutput(input),
    connectFrozenBatterHitsProbabilityOutput(input),
  ]);

  assert.deepEqual(first, second);
  assert.equal(first.productionEnabled, false);
  assert.equal(first.rankingEnabled, false);
  assert.equal(first.hardDiscoveryFilterEnabled, false);
  assert.equal(first.finalEvaluation.productionEnabled, false);
  assert.equal(first.finalEvaluation.hardDiscoveryFilterEnabled, false);
  assert.throws(
    () =>
      authorizeMarketForPrediction(
        PRODUCTION_REGISTRIES,
        BATTER_HITS_MARKET_KEY,
      ),
    (error: unknown) =>
      (error as { readonly code?: unknown }).code ===
      'MARKET_NOT_PRODUCTION_ENABLED',
  );
});
