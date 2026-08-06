import { buildM9RankedFixtureEvidence } from '../../scripts/print-m9-ranked-batter-hits-fixture.mjs';

export const M11_STEP1_BASE_MAIN_SHA =
  '7e9e2628c4cd8174463786f3eadec2fa2ce83da5';

function object(value, label) {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new TypeError(`${label} must be an object.`);
  }
  return value;
}

function batterHitsDetails(candidate) {
  return object(
    object(candidate.featureData.values, 'candidate feature values')
      .batterHits,
    'candidate Batter Hits details',
  );
}

export async function buildM11BatterHitsByteIdentityEvidence() {
  const evidence = await buildM9RankedFixtureEvidence();

  const distributions = Object.freeze(
    evidence.candidateResults.map((result) => {
      const candidate = result.candidate;
      return Object.freeze({
        eventId: candidate.eventId,
        gameId: candidate.gameId,
        playerId: candidate.playerId,
        playerName: candidate.playerName,
        selectedSide: candidate.selectedSide,
        line: candidate.line,
        distributionBuilderVersion: candidate.distributionBuilderVersion,
        statisticDistribution: candidate.statisticDistribution,
      });
    }),
  );

  const alternateLineSettlements = Object.freeze(
    evidence.candidateResults.flatMap((result) => {
      const candidate = result.candidate;
      const details = batterHitsDetails(candidate);
      if (details.offerType !== 'alternate') return [];
      return [
        Object.freeze({
          eventId: candidate.eventId,
          gameId: candidate.gameId,
          playerId: candidate.playerId,
          playerName: candidate.playerName,
          providerMarketKey: details.providerMarketKey,
          selectedSide: candidate.selectedSide,
          line: candidate.line,
          pWin: candidate.pWin,
          pLoss: candidate.pLoss,
          pVoid: candidate.pVoid,
          pWinGivenGrades: candidate.pWinGivenGrades,
          settlementRuleVersion: candidate.settlementRuleVersion,
        }),
      ];
    }),
  );

  const expectedAlternateCount = evidence.board.offers.filter(
    (offer) => offer.offerType === 'alternate',
  ).length;
  if (alternateLineSettlements.length !== expectedAlternateCount) {
    throw new Error(
      `byte-identity evidence omitted alternate settlements: expected ${expectedAlternateCount}, received ${alternateLineSettlements.length}.`,
    );
  }

  const payload = Object.freeze({
    schemaVersion: 1,
    baseMainSha: M11_STEP1_BASE_MAIN_SHA,
    distributions,
    alternateLineSettlements,
    rankedOutput: evidence.output,
  });

  return Object.freeze({
    payload,
    distributionCount: distributions.length,
    alternateLineSettlementCount: alternateLineSettlements.length,
    rankedRowCount: evidence.output.rows.length,
  });
}

export function serializeM11BatterHitsByteIdentityPayload(payload) {
  return Buffer.from(JSON.stringify(payload), 'utf8');
}
