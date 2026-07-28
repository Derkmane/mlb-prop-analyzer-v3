function assertArray(value, label) {
  if (!Array.isArray(value)) {
    throw new TypeError(`${label} must be an array.`);
  }
  return value;
}

function assertPositiveInteger(value, label) {
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new TypeError(`${label} must be a positive integer.`);
  }
  return value;
}

function assertNonNegativeInteger(value, label) {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new TypeError(`${label} must be a non-negative integer.`);
  }
  return value;
}

function gameIdFor(value, label) {
  if (value !== null && typeof value === 'object' && !Array.isArray(value)) {
    return assertPositiveInteger(value.gameId, `${label}.gameId`);
  }
  return assertPositiveInteger(value, label);
}

export function selectM8ContextPlayCaptureBatch({
  plannedGames,
  verifiedGameIds,
  maxNewGames = 0,
}) {
  const games = assertArray(plannedGames, 'plannedGames');
  const verifiedValues = assertArray(verifiedGameIds, 'verifiedGameIds');
  const limit = assertNonNegativeInteger(maxNewGames, 'maxNewGames');

  const plannedIds = new Set();
  for (const [index, game] of games.entries()) {
    const gameId = gameIdFor(game, `plannedGames[${index}]`);
    if (plannedIds.has(gameId)) {
      throw new Error(`duplicate planned gameId: ${gameId}.`);
    }
    plannedIds.add(gameId);
  }

  const verifiedIds = new Set();
  for (const [index, value] of verifiedValues.entries()) {
    const gameId = gameIdFor(value, `verifiedGameIds[${index}]`);
    if (!plannedIds.has(gameId)) {
      throw new Error(`verified gameId ${gameId} is not in the capture plan.`);
    }
    if (verifiedIds.has(gameId)) {
      throw new Error(`duplicate verified gameId: ${gameId}.`);
    }
    verifiedIds.add(gameId);
  }

  const missingGames = games.filter((game) => !verifiedIds.has(game.gameId));
  const selectedGames =
    limit === 0 ? missingGames : missingGames.slice(0, limit);
  const remainingAfterBatchCount = missingGames.length - selectedGames.length;

  return Object.freeze({
    planGameCount: games.length,
    verifiedBeforeCount: verifiedIds.size,
    missingBeforeCount: missingGames.length,
    maxNewGames: limit,
    selectedGames: Object.freeze([...selectedGames]),
    selectedNewGameCount: selectedGames.length,
    remainingAfterBatchCount,
    completesPlan: remainingAfterBatchCount === 0,
  });
}
