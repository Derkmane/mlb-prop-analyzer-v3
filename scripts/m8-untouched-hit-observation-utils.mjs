const HIT_CATEGORIES = new Set(['1B', '2B', '3B', 'HR']);
const VERIFIED_CONTEXTUAL_NON_HIT_RESULTS = new Set([
  'Fielders Choice',
  'Fielders Choice Out',
  'Forceout',
  'Double Play',
  'Triple Play',
  'Strikeout Double Play',
]);
const SIDES = Object.freeze([
  Object.freeze({ halfInning: 'top', side: 'away' }),
  Object.freeze({ halfInning: 'bottom', side: 'home' }),
]);

function object(value, label) {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new TypeError(`${label} must be an object.`);
  }
  return value;
}

function string(value, label) {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new TypeError(`${label} must be a non-empty string.`);
  }
  return value.trim();
}

function positiveInteger(value, label) {
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new TypeError(`${label} must be a positive integer.`);
  }
  return value;
}

export function gradeM8UntouchedPlateAppearance({ rawPlateAppearance, classification }) {
  const raw = object(rawPlateAppearance, 'raw plate appearance');
  const result = object(classification, 'terminal classification');
  const common = Object.freeze({
    providerPaNumber: positiveInteger(raw.pa_number, 'pa_number'),
    halfInning: string(raw.half_inning, 'half_inning').toLowerCase(),
    batterId: positiveInteger(raw.batter_id, 'batter_id'),
    pitcherId: positiveInteger(raw.pitcher_id, 'pitcher_id'),
    batterSide: raw.batter_side === 'L' || raw.batter_side === 'R' ? raw.batter_side : 'U',
    pitcherHand: raw.pitcher_hand === 'L' || raw.pitcher_hand === 'R' ? raw.pitcher_hand : 'U',
    rawResult: raw.result,
  });

  if (result.status === 'baserunning-only') {
    return Object.freeze({ kind: 'ignore-baserunning', ...common });
  }
  if (result.status === 'classified-terminal') {
    return Object.freeze({
      kind: 'terminal',
      ...common,
      terminalCategory: result.terminalPa.terminalCategory,
      hit: HIT_CATEGORIES.has(result.terminalPa.terminalCategory),
      gradingBasis: 'verified-terminal-category',
    });
  }
  if (
    result.status === 'unresolved' &&
    result.reason === 'context-required' &&
    VERIFIED_CONTEXTUAL_NON_HIT_RESULTS.has(result.rawResult)
  ) {
    return Object.freeze({
      kind: 'terminal',
      ...common,
      terminalCategory: null,
      hit: false,
      gradingBasis: 'verified-contextual-terminal-label-that-cannot-be-an-official-hit',
    });
  }
  return Object.freeze({
    kind: 'reject',
    ...common,
    reason: result.reason ?? 'unsupported-classification-state',
  });
}

function recoverSide({ observedDate, gameId, side, halfInning, rows }) {
  const sideRows = rows.filter((row) => row.halfInning === halfInning);
  const rejected = sideRows.find((row) => row.kind === 'reject');
  if (rejected) {
    return Object.freeze({
      observations: Object.freeze([]),
      exclusion: Object.freeze({ side, reason: `terminal-row-${rejected.reason}` }),
    });
  }
  const terminalRows = sideRows
    .filter((row) => row.kind === 'terminal')
    .sort((left, right) => left.providerPaNumber - right.providerPaNumber);
  if (terminalRows.length < 9) {
    return Object.freeze({
      observations: Object.freeze([]),
      exclusion: Object.freeze({ side, reason: 'fewer-than-nine-terminal-plate-appearances' }),
    });
  }
  const seenNumbers = new Set();
  for (const row of terminalRows) {
    if (seenNumbers.has(row.providerPaNumber)) {
      return Object.freeze({
        observations: Object.freeze([]),
        exclusion: Object.freeze({ side, reason: 'duplicate-pa-number' }),
      });
    }
    seenNumbers.add(row.providerPaNumber);
  }

  const opposingStarter = terminalRows[0];
  const observations = [];
  const replacementTurns = [];
  for (let lineupSlot = 1; lineupSlot <= 9; lineupSlot += 1) {
    const sequence = terminalRows.filter(
      (unused, index) => index % 9 === lineupSlot - 1,
    );
    const first = sequence[0];
    if (!first) {
      return Object.freeze({
        observations: Object.freeze([]),
        exclusion: Object.freeze({ side, reason: 'missing-lineup-slot-sequence' }),
      });
    }
    const batterId = first.batterId;
    let prefixLength = 0;
    while (prefixLength < sequence.length && sequence[prefixLength].batterId === batterId) {
      prefixLength += 1;
    }
    if (sequence.slice(prefixLength).some((row) => row.batterId === batterId)) {
      return Object.freeze({
        observations: Object.freeze([]),
        exclusion: Object.freeze({ side, reason: 'starter-reappeared-after-replacement' }),
      });
    }
    if (prefixLength < sequence.length) replacementTurns.push(prefixLength + 1);
    const actualHits = sequence
      .slice(0, prefixLength)
      .reduce((sum, row) => sum + (row.hit ? 1 : 0), 0);
    observations.push(
      Object.freeze({
        observationId: `${observedDate}:${gameId}:${side}:slot:${lineupSlot}`,
        observedDate,
        gameId,
        side,
        lineupSlot,
        batterId,
        starterPitcherId: opposingStarter.pitcherId,
        batterSide: first.batterSide,
        starterPitcherHand: opposingStarter.pitcherHand,
        actualHits,
        observedStarterPlateAppearances: prefixLength,
        observedSlotTurns: sequence.length,
      }),
    );
  }

  const byTurn = new Map();
  for (const turn of replacementTurns) {
    byTurn.set(turn, (byTurn.get(turn) ?? 0) + 1);
  }
  if ([...byTurn.values()].some((count) => count >= 5)) {
    return Object.freeze({
      observations: Object.freeze([]),
      exclusion: Object.freeze({ side, reason: 'simultaneous-multi-slot-phase-shift' }),
    });
  }
  return Object.freeze({ observations: Object.freeze(observations), exclusion: null });
}

export function buildM8UntouchedGameObservations({ observedDate, gameId, gradedRows }) {
  const date = string(observedDate, 'observedDate');
  const id = positiveInteger(gameId, 'gameId');
  const rows = gradedRows.map((row) => object(row, 'graded row'));
  const observations = [];
  const exclusions = [];
  for (const definition of SIDES) {
    const recovered = recoverSide({
      observedDate: date,
      gameId: id,
      side: definition.side,
      halfInning: definition.halfInning,
      rows,
    });
    if (recovered.exclusion) exclusions.push(recovered.exclusion);
    else observations.push(...recovered.observations);
  }
  return Object.freeze({
    observations: Object.freeze(observations),
    exclusions: Object.freeze(exclusions),
    ignoredBaserunningRowCount: rows.filter(
      (row) => row.kind === 'ignore-baserunning',
    ).length,
  });
}
