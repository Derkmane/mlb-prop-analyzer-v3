import {
  DEFAULT_M8_PLATOON_CANDIDATES,
  evaluateM8ResolvedCategoricalPlatoon,
} from './m8-resolved-categorical-platoon-utils.mjs';

export const M8_EXTENDED_LEAGUE_PLATOON_EQUIVALENT_PA = Object.freeze([
  0.001,
  0.01,
  0.1,
  0.25,
  0.5,
  1,
  2,
  4,
  16,
  64,
  256,
  1024,
  4096,
]);

function finiteLeaguePrior(value) {
  return Object.freeze({
    priorId: `league-pa-${value}`,
    leaguePlatoonEquivalentPa: value,
    leaguePlatoonExactTarget: false,
  });
}

const EXACT_LEAGUE_TARGET = Object.freeze({
  priorId: 'league-only-target',
  leaguePlatoonEquivalentPa: null,
  leaguePlatoonExactTarget: true,
});

function splitCoefficientTemplates() {
  const templates = new Map();
  for (const candidate of DEFAULT_M8_PLATOON_CANDIDATES) {
    if (candidate.candidateId === 'no-platoon') continue;
    const key = JSON.stringify({
      playerSplitPriorId: candidate.playerSplitPriorId,
      playerSplitEquivalentPa: candidate.playerSplitEquivalentPa,
      playerSplitExactTarget: candidate.playerSplitExactTarget,
      platoonCoefficient: candidate.platoonCoefficient,
    });
    templates.set(
      key,
      Object.freeze({
        playerSplitPriorId: candidate.playerSplitPriorId,
        playerSplitEquivalentPa: candidate.playerSplitEquivalentPa,
        playerSplitExactTarget: candidate.playerSplitExactTarget,
        platoonCoefficient: candidate.platoonCoefficient,
      }),
    );
  }
  return Object.freeze([...templates.values()]);
}

export function buildM8ExtendedPlatoonBoundaryCandidates() {
  const baseline = DEFAULT_M8_PLATOON_CANDIDATES.find(
    (candidate) => candidate.candidateId === 'no-platoon',
  );
  if (!baseline) {
    throw new Error('default platoon grid is missing the no-platoon baseline.');
  }

  const leaguePriors = Object.freeze([
    ...M8_EXTENDED_LEAGUE_PLATOON_EQUIVALENT_PA.map(finiteLeaguePrior),
    EXACT_LEAGUE_TARGET,
  ]);
  const templates = splitCoefficientTemplates();
  const candidates = [baseline];

  for (const leaguePrior of leaguePriors) {
    for (const template of templates) {
      const candidateId = `${leaguePrior.priorId}-${template.playerSplitPriorId}-coefficient-${template.platoonCoefficient.toFixed(2)}`;
      candidates.push(
        Object.freeze({
          candidateId,
          leaguePlatoonPriorId: leaguePrior.priorId,
          leaguePlatoonEquivalentPa:
            leaguePrior.leaguePlatoonEquivalentPa,
          leaguePlatoonExactTarget: leaguePrior.leaguePlatoonExactTarget,
          playerSplitPriorId: template.playerSplitPriorId,
          playerSplitEquivalentPa: template.playerSplitEquivalentPa,
          playerSplitExactTarget: template.playerSplitExactTarget,
          platoonCoefficient: template.platoonCoefficient,
        }),
      );
    }
  }

  if (new Set(candidates.map((candidate) => candidate.candidateId)).size !== candidates.length) {
    throw new Error('extended platoon boundary grid produced duplicate candidate IDs.');
  }
  return Object.freeze(candidates);
}

export const M8_EXTENDED_PLATOON_BOUNDARY_CANDIDATES =
  buildM8ExtendedPlatoonBoundaryCandidates();

export async function evaluateM8ResolvedCategoricalPlatoonBoundary(options) {
  return evaluateM8ResolvedCategoricalPlatoon({
    ...options,
    candidates: M8_EXTENDED_PLATOON_BOUNDARY_CANDIDATES,
  });
}
