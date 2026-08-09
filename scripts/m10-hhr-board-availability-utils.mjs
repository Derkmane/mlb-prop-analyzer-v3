export const NO_UNDERDOG_HHR_OFFERS_REASON = 'no-underdog-hhr-offers';

export function classifyHhrUnderdogBookmakerAvailability(capture) {
  const response =
    capture !== null && typeof capture === 'object' && !Array.isArray(capture)
      ? capture.response
      : null;
  if (response === null || typeof response !== 'object' || Array.isArray(response)) {
    return Object.freeze({ status: 'normalize' });
  }

  const bookmakers = response.bookmakers;
  if (!Array.isArray(bookmakers)) {
    return Object.freeze({ status: 'normalize' });
  }
  if (
    bookmakers.some(
      (bookmaker) =>
        bookmaker === null ||
        typeof bookmaker !== 'object' ||
        Array.isArray(bookmaker),
    )
  ) {
    return Object.freeze({ status: 'normalize' });
  }

  const underdogBookmakerCount = bookmakers.filter(
    (bookmaker) => bookmaker.key === 'underdog',
  ).length;
  return underdogBookmakerCount === 0
    ? Object.freeze({ status: 'exclude', reason: NO_UNDERDOG_HHR_OFFERS_REASON })
    : Object.freeze({ status: 'normalize' });
}
