import type { IncomingMessage, ServerResponse } from 'node:http';

import type { HhrDisplayBoard } from '../../application/index.js';

export const HHR_DISPLAY_BOARD_HTTP_PATH = '/api/hhr-display-board' as const;

export type ReadHhrDisplayBoard = () => Promise<HhrDisplayBoard>;
export type HhrDisplayBoardHttpHandler = (
  request: IncomingMessage,
  response: ServerResponse,
) => void;

function writeJson(
  response: ServerResponse,
  statusCode: number,
  value: unknown,
  extraHeaders: Readonly<Record<string, string>> = {},
): void {
  const body = JSON.stringify(value);
  response.statusCode = statusCode;
  response.setHeader('content-type', 'application/json; charset=utf-8');
  response.setHeader('cache-control', 'no-store');
  response.setHeader('content-length', Buffer.byteLength(body));
  for (const [name, headerValue] of Object.entries(extraHeaders)) {
    response.setHeader(name, headerValue);
  }
  response.end(body);
}

function requestPath(request: IncomingMessage): string | null {
  if (request.url === undefined) return null;
  try {
    return new URL(request.url, 'http://localhost').pathname;
  } catch {
    return null;
  }
}

/** HTTP-only transport for already-built HHR display evidence. */
export function createHhrDisplayBoardHttpHandler(
  readBoard: ReadHhrDisplayBoard,
): HhrDisplayBoardHttpHandler {
  return (request, response) => {
    if (requestPath(request) !== HHR_DISPLAY_BOARD_HTTP_PATH) {
      writeJson(response, 404, { error: 'not-found' });
      return;
    }
    if (request.method !== 'GET') {
      writeJson(response, 405, { error: 'method-not-allowed' }, { allow: 'GET' });
      return;
    }

    void readBoard()
      .then((board) => writeJson(response, 200, board))
      .catch(() => writeJson(response, 500, { error: 'hhr-display-board-unavailable' }));
  };
}
