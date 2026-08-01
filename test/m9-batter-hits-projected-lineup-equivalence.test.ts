import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';

import {
  connectFrozenBatterHitsProbabilityOutput,
  connectM8BatterHitsBaseDistribution,
  connectM8BatterHitsBaseEvaluationFromDistribution,
  connectPregameBatterHitsBoard,
} from '../src/composition/index.js';
import type {
  BatterHitsPlayerIdentity,
  BatterHitsRuntimeObservation,
  NormalizedBatterHitsBoardOffer,
} from '../src/features/batter-hits/index.js';

const FIXTURE_DIRECTORY = path.resolve(
  'fixtures/sanitized/provider-capabilities/2026-07-23/player-identity',
);
const ODDS_FIXTURE_PATH = path.join(
  FIXTURE_DIRECTORY,
  'the-odds-api-22fc220be6958e93fba4354054d8fd16-underdog-batter-hits.json',
);
const GAMES_FIXTURE_PATH = path.join(
  FIXTURE_DIRECTORY,
  'balldontlie-games-2026-07-23.json',
);
const LINEUPS_FIXTURE_PATH = path.join(
  FIXTURE_DIRECTORY,
  'balldontlie-lineups-5059315.json',
);
const LINKAGE_FIXTURE_PATH = path.join(
  FIXTURE_DIRECTORY,
  'cross-provider-player-linkage-5059315.json',
);

const BOARD_SOURCE_SNAPSHOT_SHA256 =
  '250c1b9c02bb1334c0dce563d14194cabc404dbb48da08a9d49fcd3f457b7db7';
const GAME_SOURCE_SNAPSHOT_SHA256 =
  'f794c97cda6ad78e239c2b6efc9efd64ae2414a9c627672d9db166f7b05a3185';
const LINEUP_SOURCE_SNAPSHOT_SHA256 =
  'e22f4601fd95c74f2cb692f9f3db322f6a43c3f2b26026bcc23311e3c40ca7cd';
const SOURCE_CAPTURED_AT = '2026-07-23T15:12:25.190Z';
const MATCHED_GAME_ID = 5059315;

type Hand = 'L' | 'R';

interface LinkageMatch {
  readonly playerId: number;
  readonly fullName: string;
  readonly teamId: number;
  readonly teamDisplayName: string;
}

interface LinkageFixture {
  readonly oddsEvent: { readonly eventId: string };
  readonly balldontlieGame: { readonly gameId: number };
  readonly matches: readonly {
    readonly offerPlayer: string;
    readonly matchCount: number;
    readonly matches: readonly LinkageMatch[];
  }[];
}

interface GameRecord {
  readonly id: number;
  readonly home_team: { readonly id: number };
  readonly away_team: { readonly id: number };
}

interface LineupRecord {
  readonly game_id: number;
  readonly player: {
    readonly id: number;
    readonly bats_throws: string;
  };
  readonly team: { readonly id: number };
  readonly batting_order: number | null;
  readonly is_probable_pitcher: boolean;
}

function readJson(filePath: string): unknown {
  return JSON.parse(fs.readFileSync(filePath, 'utf8')) as unknown;
}

function resolvedIdentities(): BatterHitsPlayerIdentity[] {
  const linkage = readJson(LINKAGE_FIXTURE_PATH) as LinkageFixture;
  return linkage.matches.flatMap((record) => {
    const match = record.matches[0];
    if (record.matchCount !== 1 || record.matches.length !== 1 || match === undefined) {
      return [];
    }
    return [{
      providerEventId: linkage.oddsEvent.eventId,
      offerPlayerName: record.offerPlayer,
      providerGameId: linkage.balldontlieGame.gameId,
      providerPlayerId: match.playerId,
      providerTeamId: match.teamId,
      playerName: match.fullName,
      teamName: match.teamDisplayName,
    }];
  });
}

function pregameBoard() {
  return connectPregameBatterHitsBoard({
    rawEventSnapshot: readJson(ODDS_FIXTURE_PATH),
    sourceSnapshotSha256: BOARD_SOURCE_SNAPSHOT_SHA256,
    sourceCapturedAt: SOURCE_CAPTURED_AT,
    playerIdentities: resolvedIdentities(),
    rawGamesSnapshot: readJson(GAMES_FIXTURE_PATH),
    gameSourceSnapshotSha256: GAME_SOURCE_SNAPSHOT_SHA256,
    gameSourceCapturedAt: SOURCE_CAPTURED_AT,
    asOf: SOURCE_CAPTURED_AT,
  });
}

function explicitHand(value: string, index: number): Hand {
  const hand = value.split('/')[index];
  if (hand !== 'L' && hand !== 'R') {
    throw new Error('fixture hand must be explicit L or R');
  }
  return hand;
}

function observationFor(
  offer: NormalizedBatterHitsBoardOffer,
  lineupStatus: BatterHitsRuntimeObservation['lineupStatus'],
): BatterHitsRuntimeObservation {
  const lineups = (readJson(LINEUPS_FIXTURE_PATH) as { readonly data: readonly LineupRecord[] }).data;
  const games = (readJson(GAMES_FIXTURE_PATH) as { readonly data: readonly GameRecord[] }).data;
  const game = games.find((row) => row.id === MATCHED_GAME_ID);
  assert.ok(game);
  const hitter = lineups.find(
    (row) =>
      row.game_id === MATCHED_GAME_ID &&
      row.player.id === offer.providerPlayerId &&
      row.team.id === offer.providerTeamId &&
      row.batting_order !== null &&
      row.is_probable_pitcher === false,
  );
  assert.ok(hitter);
  assert.ok(
    hitter.batting_order !== null &&
      Number.isInteger(hitter.batting_order) &&
      hitter.batting_order >= 1 &&
      hitter.batting_order <= 9,
  );
  const starter = lineups.find(
    (row) =>
      row.game_id === MATCHED_GAME_ID &&
      row.is_probable_pitcher === true &&
      row.team.id !== hitter.team.id,
  );
  assert.ok(starter);
  const teamSide =
    hitter.team.id === game.home_team.id
      ? 'home'
      : hitter.team.id === game.away_team.id
        ? 'away'
        : null;
  assert.ok(teamSide !== null);

  return {
    lineupStatus,
    providerGameId: offer.providerGameId,
    providerPlayerId: offer.providerPlayerId,
    providerTeamId: offer.providerTeamId,
    teamSide,
    lineupSlot: hitter.batting_order as BatterHitsRuntimeObservation['lineupSlot'],
    batterSide: explicitHand(hitter.player.bats_throws, 0),
    opposingStarterPitcherId: starter.player.id,
    opposingStarterTeamId: starter.team.id,
    opposingStarterHand: explicitHand(starter.player.bats_throws, 1),
    eligibilityProbability: 1,
    lineupSourceCapturedAt: SOURCE_CAPTURED_AT,
    lineupSourceSnapshotSha256: LINEUP_SOURCE_SNAPSHOT_SHA256,
  };
}

function lineupStatusFromCandidate(
  result: Awaited<ReturnType<typeof connectFrozenBatterHitsProbabilityOutput>>,
): unknown {
  return result.candidate.featureData.values.batterHits?.['lineupStatus'];
}

test('projected and confirmed versions of one active lineup produce identical final probabilities', async () => {
  const board = pregameBoard();
  const offer = board.offers.find(
    (candidate) =>
      candidate.playerName === 'Gavin Sheets' &&
      candidate.offerType === 'baseline' &&
      candidate.line === 0.5 &&
      candidate.selectedSide === 'higher',
  );
  assert.ok(offer);

  const projected = await connectFrozenBatterHitsProbabilityOutput({
    pregameBoard: board,
    offer,
    observation: observationFor(offer, 'projected'),
  });
  const confirmed = await connectFrozenBatterHitsProbabilityOutput({
    pregameBoard: board,
    offer,
    observation: observationFor(offer, 'confirmed'),
  });

  assert.deepEqual(projected.distribution, confirmed.distribution);
  assert.deepEqual(
    projected.candidate.statisticDistribution,
    confirmed.candidate.statisticDistribution,
  );
  assert.equal(projected.candidate.eligibilityProbability, 1);
  assert.equal(
    projected.candidate.eligibilityProbability,
    confirmed.candidate.eligibilityProbability,
  );
  assert.equal(projected.candidate.pWin, confirmed.candidate.pWin);
  assert.equal(projected.candidate.pLoss, confirmed.candidate.pLoss);
  assert.equal(projected.candidate.pVoid, confirmed.candidate.pVoid);
  assert.equal(
    projected.candidate.pWinGivenGrades,
    confirmed.candidate.pWinGivenGrades,
  );
  assert.equal(lineupStatusFromCandidate(projected), 'projected');
  assert.equal(lineupStatusFromCandidate(confirmed), 'confirmed');
});

test('M8 base evaluation preserves frozen math and reuses one D_base across exact offers', async () => {
  const board = pregameBoard();
  const baselineOffer = board.offers.find(
    (candidate) =>
      candidate.playerName === 'Gavin Sheets' &&
      candidate.offerType === 'baseline' &&
      candidate.line === 0.5 &&
      candidate.selectedSide === 'higher',
  );
  const observedAlternate = board.offers.find(
    (candidate) =>
      candidate.offerType === 'alternate' &&
      candidate.selectedSide === 'lower' &&
      candidate.line === 1.5,
  );
  assert.ok(baselineOffer);
  assert.ok(observedAlternate);

  const alternateOffer: NormalizedBatterHitsBoardOffer = Object.freeze({
    ...baselineOffer,
    providerMarketKey: observedAlternate.providerMarketKey,
    offerType: observedAlternate.offerType,
    selectedSide: observedAlternate.selectedSide,
    rawSide: observedAlternate.rawSide,
    line: observedAlternate.line,
    americanPrice: observedAlternate.americanPrice,
    multiplier: observedAlternate.multiplier,
    marketLastUpdate: observedAlternate.marketLastUpdate,
  });
  const integerHigher: NormalizedBatterHitsBoardOffer = Object.freeze({
    ...baselineOffer,
    line: 1,
    selectedSide: 'higher',
    rawSide: 'Over',
  });
  const integerLower: NormalizedBatterHitsBoardOffer = Object.freeze({
    ...baselineOffer,
    line: 1,
    selectedSide: 'lower',
    rawSide: 'Under',
  });
  const boardWithOffers = Object.freeze({
    ...board,
    offers: Object.freeze([
      ...board.offers,
      alternateOffer,
      integerHigher,
      integerLower,
    ]),
  });
  const observation = observationFor(baselineOffer, 'confirmed');

  const frozenResult = await connectFrozenBatterHitsProbabilityOutput({
    pregameBoard: board,
    offer: baselineOffer,
    observation,
  });
  const baseDistribution = await connectM8BatterHitsBaseDistribution({
    pregameBoard: board,
    offer: baselineOffer,
    observation,
    evaluatedAt: SOURCE_CAPTURED_AT,
  });
  const baselineEvaluation = connectM8BatterHitsBaseEvaluationFromDistribution({
    pregameBoard: boardWithOffers,
    offer: baselineOffer,
    baseDistribution,
  });
  const alternateEvaluation = connectM8BatterHitsBaseEvaluationFromDistribution({
    pregameBoard: boardWithOffers,
    offer: alternateOffer,
    baseDistribution,
  });
  const integerHigherEvaluation =
    connectM8BatterHitsBaseEvaluationFromDistribution({
      pregameBoard: boardWithOffers,
      offer: integerHigher,
      baseDistribution,
    });
  const integerLowerEvaluation =
    connectM8BatterHitsBaseEvaluationFromDistribution({
      pregameBoard: boardWithOffers,
      offer: integerLower,
      baseDistribution,
    });

  assert.deepEqual(baseDistribution.dBase, frozenResult.distribution);
  assert.strictEqual(baselineEvaluation.dBase, baseDistribution.dBase);
  assert.strictEqual(alternateEvaluation.dBase, baseDistribution.dBase);
  assert.strictEqual(integerHigherEvaluation.dBase, baseDistribution.dBase);
  assert.strictEqual(integerLowerEvaluation.dBase, baseDistribution.dBase);

  assert.deepEqual(baselineEvaluation.probabilities, {
    pWin: frozenResult.candidate.pWin,
    pLoss: frozenResult.candidate.pLoss,
    pVoid: frozenResult.candidate.pVoid,
    pBase: frozenResult.candidate.pWinGivenGrades,
  });
  assert.equal(baselineEvaluation.offer.selectedSide, 'higher');
  assert.equal(baselineEvaluation.offer.line, 0.5);
  assert.equal(alternateEvaluation.offer.selectedSide, 'lower');
  assert.equal(alternateEvaluation.offer.line, 1.5);
  assert.equal(integerHigherEvaluation.probabilities.pVoid > 0, true);
  assert.equal(
    integerHigherEvaluation.probabilities.pVoid,
    integerLowerEvaluation.probabilities.pVoid,
  );
  assert.equal(
    integerHigherEvaluation.probabilities.pWin,
    integerLowerEvaluation.probabilities.pLoss,
  );
  assert.equal(
    integerHigherEvaluation.probabilities.pLoss,
    integerLowerEvaluation.probabilities.pWin,
  );

  assert.equal(baseDistribution.productionEnabled, false);
  assert.equal(baseDistribution.hardDiscoveryFilterEnabled, false);
  assert.equal(baselineEvaluation.discoveryDecision, 'AUDIT_ONLY_UNTHRESHOLDED');
  assert.equal(baselineEvaluation.tauSoft, null);
  assert.equal(baselineEvaluation.softnessMargin, null);
  assert.equal(Object.isFrozen(baseDistribution), true);
  assert.equal(Object.isFrozen(baseDistribution.dBase), true);
  assert.equal(Object.isFrozen(baselineEvaluation), true);
  assert.equal(Object.isFrozen(baselineEvaluation.offer), true);
  assert.equal(Object.isFrozen(baselineEvaluation.probabilities), true);
});

test('M8 base distribution is projected-status invariant and rejects contract tampering', async () => {
  const board = pregameBoard();
  const offer = board.offers.find(
    (candidate) =>
      candidate.playerName === 'Gavin Sheets' &&
      candidate.offerType === 'baseline' &&
      candidate.line === 0.5 &&
      candidate.selectedSide === 'higher',
  );
  assert.ok(offer);

  const projected = await connectM8BatterHitsBaseDistribution({
    pregameBoard: board,
    offer,
    observation: observationFor(offer, 'projected'),
    evaluatedAt: SOURCE_CAPTURED_AT,
  });
  const confirmed = await connectM8BatterHitsBaseDistribution({
    pregameBoard: board,
    offer,
    observation: observationFor(offer, 'confirmed'),
    evaluatedAt: SOURCE_CAPTURED_AT,
  });
  const confirmedAgain = await connectM8BatterHitsBaseDistribution({
    pregameBoard: board,
    offer,
    observation: observationFor(offer, 'confirmed'),
    evaluatedAt: SOURCE_CAPTURED_AT,
  });

  assert.deepEqual(projected.dBase, confirmed.dBase);
  assert.equal(projected.baseballInputs.lineupStatus, 'projected');
  assert.equal(confirmed.baseballInputs.lineupStatus, 'confirmed');
  assert.equal(projected.sharedScenarioIdentity, confirmed.sharedScenarioIdentity);
  assert.deepEqual(confirmedAgain, confirmed);
  assert.equal(
    confirmedAgain.baseDistributionSha256,
    confirmed.baseDistributionSha256,
  );
  assert.match(confirmed.baseDistributionSha256, /^[a-f0-9]{64}$/u);

  const tampered = Object.freeze({
    ...confirmed,
    baseDistributionContract: 'tampered-contract',
  }) as unknown as typeof confirmed;
  assert.throws(
    () =>
      connectM8BatterHitsBaseEvaluationFromDistribution({
        pregameBoard: board,
        offer,
        baseDistribution: tampered,
      }),
    /base distribution contract/u,
  );
});
