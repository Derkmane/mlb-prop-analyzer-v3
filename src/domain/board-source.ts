export const ACTIVE_BOARD_SOURCES = ['pick6', 'draftkings'] as const;

export type ActiveBoardSource = (typeof ACTIVE_BOARD_SOURCES)[number];

export function isActiveBoardSource(value: unknown): value is ActiveBoardSource {
  return (
    typeof value === 'string' &&
    ACTIVE_BOARD_SOURCES.includes(value as ActiveBoardSource)
  );
}
