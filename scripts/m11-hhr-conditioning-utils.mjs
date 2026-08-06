export const HHR_TERMINAL_CATEGORIES = Object.freeze([
  'K','UBB','IBB','HBP','1B','2B','3B','HR','ROE','FC','SF','SH','BIP_OUT','CATCHER_INTERFERENCE',
]);
export const HHR_HIT_CATEGORIES = new Set(['1B','2B','3B','HR']);
export const HHR_ON_BASE_CATEGORIES = new Set(['UBB','IBB','HBP','1B','2B','3B','HR','ROE','FC','CATCHER_INTERFERENCE']);

export function normalizeHhrVector(raw, label) {
  const values = HHR_TERMINAL_CATEGORIES.map((category) => Number(raw?.[category]));
  if (values.some((value) => !Number.isFinite(value) || value <= 0)) throw new Error(`${label} has invalid positive mass.`);
  const total = values.reduce((sum, value) => sum + value, 0);
  return Object.freeze(Object.fromEntries(HHR_TERMINAL_CATEGORIES.map((category, index) => [category, values[index] / total])));
}

function stableSoftmax(scores) {
  const maximum = Math.max(...HHR_TERMINAL_CATEGORIES.map((category) => scores[category]));
  return normalizeHhrVector(Object.fromEntries(HHR_TERMINAL_CATEGORIES.map((category) => [category, Math.exp(scores[category] - maximum)])), 'softmax vector');
}

export function hhrVectorMass(vector, categories) {
  return HHR_TERMINAL_CATEGORIES.reduce((sum, category) => sum + (categories.has(category) ? vector[category] : 0), 0);
}

export function hhrLogit(value) {
  const p = Math.min(1 - 1e-12, Math.max(1e-12, value));
  return Math.log(p / (1 - p));
}

export function declaredBatterHand(raw) {
  const hand = typeof raw === 'string' ? raw.split('/')[0] : null;
  return hand === 'L' || hand === 'R' || hand === 'B' ? hand : null;
}

export function declaredPitcherHand(raw) {
  const hand = typeof raw === 'string' ? raw.split('/')[1] : null;
  return hand === 'L' || hand === 'R' ? hand : null;
}

export function resolveBatterHand(declared, pitcherHand) {
  if (declared === 'B') return pitcherHand === 'R' ? 'L' : 'R';
  return declared;
}

function playerAdjustedTarget(overall, leagueMatchup, leagueTarget) {
  return normalizeHhrVector(Object.fromEntries(HHR_TERMINAL_CATEGORIES.map((category) => [
    category, overall[category] * leagueMatchup[category] / leagueTarget[category],
  ])), 'player platoon target');
}

export function hhrPlatoonBatterVector(terminal, batterId, declared, batterSide, pitcherHand) {
  const overall = terminal.batterOverall[String(batterId)] ?? terminal.unseenBatter;
  if (declared === 'B' || terminal.selectedPlatoonCandidate.platoonCoefficient === 0) return overall;
  const matchup = `${batterSide}-vs-${pitcherHand}`;
  const leagueMatchup = terminal.leaguePlatoonByMatchup[matchup];
  if (!leagueMatchup) throw new Error(`missing league platoon ${matchup}`);
  const split = terminal.batterSplitByMatchup[`${batterId}|${matchup}`] ?? playerAdjustedTarget(overall, leagueMatchup, terminal.leagueTarget);
  const coefficient = terminal.selectedPlatoonCandidate.platoonCoefficient;
  return stableSoftmax(Object.fromEntries(HHR_TERMINAL_CATEGORIES.map((category) => [
    category,
    Math.log(overall[category]) + coefficient * (Math.log(split[category]) - Math.log(overall[category])),
  ])));
}

export function hhrCoherentVector(terminal, batterVector, pitcherVector) {
  return stableSoftmax(Object.fromEntries(HHR_TERMINAL_CATEGORIES.map((category) => {
    const leagueLog = Math.log(terminal.leagueTarget[category]);
    return [category, leagueLog +
      terminal.baseParameters.batterCoefficient * (Math.log(batterVector[category]) - leagueLog) +
      terminal.baseParameters.pitcherAllowedCoefficient * (Math.log(pitcherVector[category]) - leagueLog)];
  })));
}

export function buildHhrParkMultiplierMap(parkArtifact) {
  const effects = parkArtifact.typedFactorArtifact?.effects;
  const identities = parkArtifact.effectIdentities;
  if (!Array.isArray(effects) || !Array.isArray(identities)) throw new Error('park artifact identity contract is missing.');
  const result = new Map();
  for (const identity of identities) {
    const effect = effects[identity.effectIndex];
    if (!effect || effect.kind !== 'park-transformation' || effect.batterHand !== identity.batterHand) throw new Error('park effect identity drift.');
    result.set(`${identity.venue}\u0000${identity.batterHand}`, Object.freeze(Object.fromEntries(
      effect.relativeRateMultipliers
        .filter((entry) => HHR_TERMINAL_CATEGORIES.includes(entry.category))
        .map((entry) => [entry.category, entry.multiplier]),
    )));
  }
  return result;
}

export function applyHhrPark(vector, multipliers) {
  if (!multipliers || HHR_TERMINAL_CATEGORIES.some((category) => !Number.isFinite(multipliers[category]) || multipliers[category] <= 0)) throw new Error('missing or invalid exact park multipliers.');
  return normalizeHhrVector(Object.fromEntries(HHR_TERMINAL_CATEGORIES.map((category) => [category, vector[category] * multipliers[category]])), 'park transformed vector');
}

export function buildHhrTeamBullpenMap(artifact) {
  const result = new Map();
  if (!Array.isArray(artifact.effects)) throw new Error('team bullpen artifact effects are missing.');
  for (const effect of artifact.effects) {
    if (effect.kind !== 'terminal-outcome-vector' || effect.scope !== 'bullpen') continue;
    result.set(effect.matchupKey, normalizeHhrVector(Object.fromEntries(
      effect.categoryProbabilities
        .filter((entry) => HHR_TERMINAL_CATEGORIES.includes(entry.category))
        .map((entry) => [entry.category, entry.probability]),
    ), `team bullpen ${effect.matchupKey}`));
  }
  return result;
}

function erf(value) {
  const sign = value < 0 ? -1 : 1;
  const x = Math.abs(value);
  const t = 1 / (1 + 0.3275911 * x);
  const polynomial = (((((1.061405429 * t - 1.453152027) * t + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t);
  return sign * (1 - polynomial * Math.exp(-x * x));
}
const normalCdf = (value) => 0.5 * (1 + erf(value / Math.sqrt(2)));

function discreteNormalPmf(mean, sigma, maximum = 80) {
  const values = Array(maximum + 1).fill(0);
  for (let count = 0; count < maximum; count += 1) {
    values[count] = Math.max(0, normalCdf((count + 0.5 - mean) / sigma) - normalCdf((count - 0.5 - mean) / sigma));
  }
  values[maximum] = Math.max(0, 1 - normalCdf((maximum - 0.5 - mean) / sigma));
  const total = values.reduce((sum, value) => sum + value, 0);
  return values.map((value) => value / total);
}

function lineupSlotSurvival(teamPaPmf, slot, turnMaximum) {
  const result = [];
  for (let turn = 1; turn <= turnMaximum; turn += 1) {
    const required = slot + 9 * (turn - 1);
    result.push(teamPaPmf.slice(required).reduce((sum, value) => sum + value, 0));
  }
  return result;
}

function starterSurvival(starterBfPmf, requiredTeamPaIndex) {
  return starterBfPmf.slice(requiredTeamPaIndex).reduce((sum, value) => sum + value, 0);
}

export function buildHhrOpportunityContext(shared, retentionArtifact, teamSide, slot) {
  const retention = retentionArtifact.conditionalRetentionByGroup[`slot:${slot}`];
  if (!Array.isArray(retention) || retention.length === 0) throw new Error(`missing retention slot ${slot}`);
  const starterBf = shared.starterBullpenTransition.bySide[teamSide];
  let expectedPa = 0;
  let expectedStarterPa = 0;
  for (const scenario of shared.scenarios) {
    const state = scenario[teamSide];
    const survival = lineupSlotSurvival(discreteNormalPmf(state.meanPa, state.sigmaPa), slot, retention.length);
    for (let turnIndex = 0; turnIndex < survival.length; turnIndex += 1) {
      const occurrence = scenario.weight * survival[turnIndex] * retention[turnIndex];
      const requiredTeamPaIndex = slot + 9 * turnIndex;
      expectedPa += occurrence;
      expectedStarterPa += occurrence * starterSurvival(starterBf, requiredTeamPaIndex);
    }
  }
  if (!(expectedPa > 0) || !Number.isFinite(expectedStarterPa)) throw new Error('invalid M8 paSurvival expectation.');
  return Object.freeze({ expectedPlateAppearances: expectedPa, starterExposureShare: expectedStarterPa / expectedPa });
}

export function medianHhrValue(values) {
  const sorted = [...values].sort((a, b) => a - b);
  if (sorted.length === 0) throw new Error('median requires at least one value.');
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[middle - 1] + sorted[middle]) / 2 : sorted[middle];
}
