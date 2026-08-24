import { createServer, type Server } from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  createCommittedDisplayArchiveRefresher,
  createHhrCumulativeDisplayEvidenceRepository,
  createHhrDisplayAppHttpHandler,
  createHhrDisplayArchiveRepository,
  createHhrDisplayBoardHttpHandler,
  createResearchDisplayArchiveRepository,
} from '../adapters/index.js';
import {
  readLatestHhrDisplayBoard,
  readLatestHhrDisplayUiBoard,
  type HhrCumulativeDisplayEvidenceRepository,
  type HhrDisplayArchiveRepository,
  type ResearchDisplayArchiveRepository,
} from '../application/index.js';

export const DEFAULT_HHR_DISPLAY_SERVER_HOST = '0.0.0.0' as const;
export const DEFAULT_HHR_DISPLAY_SERVER_PORT = 3000 as const;

const PRIVATE_REPOSITORY_TREE_NOT_FOUND =
  'Unable to refresh current display board from GitHub tree: HTTP 404.';

export function resolveHhrDisplayServerPort(rawPort: string | undefined): number {
  if (rawPort === undefined) return DEFAULT_HHR_DISPLAY_SERVER_PORT;
  if (!/^\d+$/u.test(rawPort)) throw new Error('HHR display server PORT must be an integer.');
  const port = Number(rawPort);
  if (!Number.isSafeInteger(port) || port < 1 || port > 65_535) {
    throw new Error('HHR display server PORT must be between 1 and 65535.');
  }
  return port;
}

export function resolveHhrDisplayServerPassword(rawPassword: string | undefined): string {
  if (rawPassword === undefined || rawPassword.length === 0) {
    throw new Error('HHR display server requires HHR_DISPLAY_PASSWORD.');
  }
  return rawPassword;
}

/** Lower-level transport retained for focused API-boundary verification. */
export function createHhrDisplayBoardServer(
  repository: HhrDisplayArchiveRepository = createHhrDisplayArchiveRepository(),
): Server {
  const handler = createHhrDisplayBoardHttpHandler(
    () => readLatestHhrDisplayBoard(repository),
  );
  return createServer(handler);
}

export interface HhrDisplayAppServerOptions {
  readonly password: string;
  readonly repository?: HhrDisplayArchiveRepository;
  readonly cumulativeRepository?: HhrCumulativeDisplayEvidenceRepository;
  readonly researchRepository?: ResearchDisplayArchiveRepository;
  readonly refreshDisplayArchives?: () => Promise<void>;
  readonly sessionToken?: string;
}

/** Deployable composition: current committed archives -> password-gated read-only product UI/API. */
export function createHhrDisplayAppServer(options: HhrDisplayAppServerOptions): Server {
  const repository = options.repository ?? createHhrDisplayArchiveRepository();
  const cumulativeRepository = options.cumulativeRepository ??
    createHhrCumulativeDisplayEvidenceRepository();
  const researchRepository = options.researchRepository ??
    createResearchDisplayArchiveRepository();
  const usesDefaultDisplayRepositories =
    options.repository === undefined && options.researchRepository === undefined;
  const refreshDisplayArchives = options.refreshDisplayArchives ??
    (usesDefaultDisplayRepositories
      ? createCommittedDisplayArchiveRefresher()
      : async () => undefined);
  const readBoard = async () => {
    try {
      await refreshDisplayArchives();
    } catch (error) {
      if (!(error instanceof Error) || error.message !== PRIVATE_REPOSITORY_TREE_NOT_FOUND) {
        throw error;
      }
      // A private-repository 404 means mid-session refresh is unavailable.
      // Continue only with the already-committed deployment archives.
    }
    return readLatestHhrDisplayUiBoard(
      repository,
      cumulativeRepository,
      researchRepository,
    );
  };
  const handler = options.sessionToken === undefined
    ? createHhrDisplayAppHttpHandler({ readBoard, password: options.password })
    : createHhrDisplayAppHttpHandler({
        readBoard,
        password: options.password,
        sessionToken: options.sessionToken,
      });
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

export function startHhrDisplayAppServer(
  password = resolveHhrDisplayServerPassword(process.env['HHR_DISPLAY_PASSWORD']),
  port = resolveHhrDisplayServerPort(process.env['PORT']),
  host = DEFAULT_HHR_DISPLAY_SERVER_HOST,
): Server {
  const server = createHhrDisplayAppServer({ password });
  server.listen(port, host);
  return server;
}

function isDirectInvocation(): boolean {
  const entrypoint = process.argv[1];
  return entrypoint !== undefined && path.resolve(entrypoint) === fileURLToPath(import.meta.url);
}

if (isDirectInvocation()) {
  const password = resolveHhrDisplayServerPassword(process.env['HHR_DISPLAY_PASSWORD']);
  const port = resolveHhrDisplayServerPort(process.env['PORT']);
  const server = startHhrDisplayAppServer(password, port);
  server.once('listening', () => {
    console.log(`MLB prop analyzer listening on port ${port}`);
  });
}
