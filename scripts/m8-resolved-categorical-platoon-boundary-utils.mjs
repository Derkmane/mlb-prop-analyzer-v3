import {
  DEFAULT_M8_PLATOON_CANDIDATES,
  evaluateM8ResolvedCategoricalPlatoon,
} from './m8-resolved-categorical-platoon-utils.mjs';

export const M8_EXACT_RAW_LEAGUE_PLATOON_PRIOR_ID =
  'league-raw-cell-limit';
export const M8_EXACT_RAW_LEAGUE_PLATOON_SENTINEL_PA = Number.MIN_VALUE;

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

const EXACT_RAW_LEAGUE_CELL = Object.freeze({
  priorId: M8_EXACT_RAW_LEAGUE_PLATOON_PRIOR_ID,
  leaguePlatoonEquivalentPa: M8_EXACT_RAW_LEAGUE_PLATOON_SENTINEL_PA,
  leaguePlatoonExactTarget: false,
});

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
    EXACT_RAW_LEAGUE_CELL,
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

function zeroSupportMatchupCells(evaluation) {
  const matchupCounts = evaluation?.cohorts?.matchupCounts;
  if (matchupCounts === null || typeof matchupCounts !== 'object') {
    throw new Error('platoon boundary evaluation is missing matchup support counts.');
  }
  const zeroSupport = [];
  for (const [matchupKey, cell] of Object.entries(matchupCounts)) {
    const categoryCounts = cell?.categoryCounts;
    if (categoryCounts === null || typeof categoryCounts !== 'object') {
      throw new Error(`platoon boundary matchup ${matchupKey} is missing category counts.`);
    }
    const zeroCategories = Object.entries(categoryCounts)
      .filter(([, count]) => count === 0)
      .map(([category]) => category)
      .sort((left, right) => left.localeCompare(right));
    if (zeroCategories.length > 0) {
      zeroSupport.push(
        Object.freeze({
          matchupKey,
          zeroCategories: Object.freeze(zeroCategories),
        }),
      );
    }
  }
  return Object.freeze(zeroSupport);
}

export function interpretM8PlatoonBoundaryEvaluation(evaluation) {
  const selected = evaluation?.selection?.selectedCandidate ?? null;
  const exactRawLeagueCellSelected =
    selected?.leaguePlatoonPriorId === M8_EXACT_RAW_LEAGUE_PLATOON_PRIOR_ID;
  const zeroSupportCells = zeroSupportMatchupCells(evaluation);
  if (exactRawLeagueCellSelected && zeroSupportCells.length > 0) {
    throw new Error(
      'exact raw league-platoon cell cannot be selected when a matchup cell has zero category support.',
    );
  }
  const finiteBoundaryFlag =
    evaluation?.selectedBoundaryFlags?.leaguePriorAtFiniteBoundary === true;
  return Object.freeze({
    exactRawLeagueCellSelected,
    exactRawLeagueCellSupportValid: zeroSupportCells.length === 0,
    zeroSupportCells,
    leaguePriorRequiresFurtherExtension:
      finiteBoundaryFlag && !exactRawLeagueCellSelected,
    sentinelEquivalentPa: M8_EXACT_RAW_LEAGUE_PLATOON_SENTINEL_PA,
    interpretation:
      'The raw-cell sentinel is JavaScript Number.MIN_VALUE. With positive counts in every modeled category, adding it changes neither numerator nor denominator in IEEE-754 arithmetic, so the evaluated probabilities equal the exact raw current-season matchup-cell distribution.',
  });
}

export async function evaluateM8ResolvedCategoricalPlatoonBoundary(options) {
  const evaluation = await evaluateM8ResolvedCategoricalPlatoon({
    ...options,
    candidates: M8_EXTENDED_PLATOON_BOUNDARY_CANDIDATES,
  });
  interpretM8PlatoonBoundaryEvaluation(evaluation);
  return evaluation;
}
