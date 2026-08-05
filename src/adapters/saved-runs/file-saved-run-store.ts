import { createHash } from 'node:crypto';
import { link, mkdir, open, readFile, unlink } from 'node:fs/promises';
import path from 'node:path';

import {
  parseSavedRunSnapshotV1,
  serializeSavedRunSnapshotV1,
  type SavedRunSnapshotV1,
} from '../../domain/saved-run.js';

const RUN_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/u;

function sha256(value: string): string {
  return createHash('sha256').update(value, 'utf8').digest('hex');
}

function validateRunId(runId: string): void {
  if (!RUN_ID_PATTERN.test(runId)) {
    throw new TypeError('Saved-run ID contains unsupported path characters.');
  }
}

export function savedRunFilePath(rootDirectory: string, runId: string): string {
  validateRunId(runId);
  return path.join(rootDirectory, 'runs', `${runId}.json`);
}

async function syncDirectory(directory: string): Promise<void> {
  const handle = await open(directory, 'r');
  try {
    await handle.sync();
  } finally {
    await handle.close();
  }
}

/**
 * Publishes an immutable saved run through an exclusive hard link. The target
 * path appears atomically and an existing run identity can never be replaced,
 * even when the proposed bytes are identical.
 */
export async function persistImmutableSavedRunV1(input: Readonly<{
  rootDirectory: string;
  run: SavedRunSnapshotV1;
}>): Promise<Readonly<{
  filePath: string;
  byteLength: number;
  fileSha256: string;
  runId: string;
}>> {
  const filePath = savedRunFilePath(input.rootDirectory, input.run.runId);
  const bytes = serializeSavedRunSnapshotV1(input.run);
  const directory = path.dirname(filePath);
  await mkdir(directory, { recursive: true });
  const temporaryPath = `${filePath}.tmp-${process.pid}-${Date.now()}`;
  const handle = await open(temporaryPath, 'wx');
  try {
    await handle.writeFile(bytes, 'utf8');
    await handle.sync();
  } finally {
    await handle.close();
  }

  try {
    await link(temporaryPath, filePath);
    await syncDirectory(directory);
  } catch (error: unknown) {
    if (
      typeof error === 'object' &&
      error !== null &&
      'code' in error &&
      error.code === 'EEXIST'
    ) {
      throw new Error(
        `Immutable saved run already exists; overwrite refused: ${filePath}`,
      );
    }
    throw error;
  } finally {
    await unlink(temporaryPath).catch((error: unknown) => {
      if (
        typeof error !== 'object' ||
        error === null ||
        !('code' in error) ||
        error.code !== 'ENOENT'
      ) {
        throw error;
      }
    });
  }

  const persisted = await readFile(filePath, 'utf8');
  if (persisted !== bytes) {
    throw new Error(`Persisted saved-run bytes failed exact verification: ${filePath}`);
  }
  parseSavedRunSnapshotV1(persisted);
  return Object.freeze({
    filePath,
    byteLength: Buffer.byteLength(bytes),
    fileSha256: sha256(bytes),
    runId: input.run.runId,
  });
}

export async function readImmutableSavedRunV1(
  filePath: string,
): Promise<SavedRunSnapshotV1> {
  return parseSavedRunSnapshotV1(await readFile(filePath, 'utf8'));
}
