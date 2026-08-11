import { createServer, type Server } from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  createHhrDisplayArchiveRepository,
  createHhrDisplayBoardHttpHandler,
} from '../adapters/index.js';
import {
  readLatestHhrDisplayBoard,
  type HhrDisplayArchiveRepository,
} from '../application/index.js';

export const DEFAULT_HHR_DISPLAY_SERVER_HOST = '0.0.0.0' as const;
export const DEFAULT_HHR_DISPLAY_SERVER_PORT = 3000 as const;

export function resolveHhrDisplayServerPort(rawPort: string | undefined): number {
  if (rawPort === undefined) return DEFAULT_HHR_DISPLAY_SERVER_PORT;
  if (!/^\d+$/u.test(rawPort)) throw new Error('HHR display server PORT must be an integer.');
  const port = Number(rawPort);
  if (!Number.isSafeInteger(port) || port < 1 || port > 65_535) {
    throw new Error('HHR display server PORT must be between 1 and 65535.');
  }
  return port;
}

/** Composition is the only layer that wires persistence, application, and HTTP. */
export function createHhrDisplayBoardServer(
  repository: HhrDisplayArchiveRepository = createHhrDisplayArchiveRepository(),
): Server {
  const handler = createHhrDisplayBoardHttpHandler(
    () => readLatestHhrDisplayBoard(repository),
  );
  return createServer(handler);
}

export function startHhrDisplayBoardServer(
  port = resolveHhrDisplayServerPort(process.env['PORT']),
  host = DEFAULT_HHR_DISPLAY_SERVER_HOST,
): Server {
  const server = createHhrDisplayBoardServer();
  server.listen(port, host);
  return server;
}

function isDirectInvocation(): boolean {
  const entrypoint = process.argv[1];
  return entrypoint !== undefined && path.resolve(entrypoint) === fileURLToPath(import.meta.url);
}

if (isDirectInvocation()) {
  const port = resolveHhrDisplayServerPort(process.env['PORT']);
  const server = startHhrDisplayBoardServer(port);
  server.once('listening', () => {
    console.log(`HHR display server listening on port ${port}`);
  });
}
