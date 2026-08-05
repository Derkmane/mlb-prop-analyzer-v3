import { constants } from 'node:fs';
import {
  access,
  copyFile,
  mkdir,
  readFile,
  readdir,
  unlink,
} from 'node:fs/promises';
import path from 'node:path';

import {
  sha256Bytes,
  verifyAndProjectM9ArchiveBytes,
} from './m10-scheduled-archive-grading-utils.mjs';

const CAPTURE_KEY =
  '20260805T160217812Z--235bac8c330999cccfe86b6037a1007eb06f8ec23d1aacdbc3131a70d18db353';
const EXPECTED_SOURCE_FILE_SHA256 =
  'a7feb694ee125293aa9e16eadf4bc66085e9d43ea3cc1a9d9721644460c97144';
const EXPECTED_ARCHIVE_SHA256 =
  'f817216794f98b3c842170507f10fa0c40526f67f1cdc08084188388e5ca5b26';
const CAPTURE_FILE_NAME = `${CAPTURE_KEY}.json`;
const CAPTURE_PATTERN = /^\d{8}T\d{9}Z--[a-f0-9]{64}\.json$/u;

function environment(name, fallback) {
  const value = process.env[name]?.trim();
  return value || fallback;
}

async function exists(filePath) {
  try {
    await access(filePath);
    return true;
  } catch (error) {
    if (error && typeof error === 'object' && error.code === 'ENOENT') {
      return false;
    }
    throw error;
  }
}

const archiveRoot = environment(
  'M10_ARCHIVE_ROOT',
  path.join('artifacts', 'board-archives', 'batter-hits'),
);
const bootstrapRoot = environment(
  'M10_ARCHIVE_BOOTSTRAP_ROOT',
  path.join('artifacts', 'bootstrap', 'm9-board-archive'),
);
const capturesDirectory = path.join(archiveRoot, 'captures');
const sourcePath = path.join(
  bootstrapRoot,
  'board-archives',
  'batter-hits',
  'captures',
  CAPTURE_FILE_NAME,
);
const destinationPath = path.join(capturesDirectory, CAPTURE_FILE_NAME);

await mkdir(capturesDirectory, { recursive: true });
const existingCaptures = (await readdir(capturesDirectory, { withFileTypes: true }))
  .filter((entry) => entry.isFile() && CAPTURE_PATTERN.test(entry.name))
  .map((entry) => entry.name)
  .sort();

console.log('--- M10 ARCHIVE LEDGER BOOTSTRAP ---');
console.log(`ARCHIVE ROOT\t${archiveRoot}`);
console.log(`EXISTING CAPTURES\t${existingCaptures.length}`);

if (existingCaptures.length > 0) {
  console.log('BOOTSTRAP\tNOT REQUIRED');
  console.log('ARCHIVES MODIFIED\t0');
  console.log('--- END M10 ARCHIVE LEDGER BOOTSTRAP ---');
  process.exit(0);
}

if (!(await exists(sourcePath))) {
  throw new Error(`Required verified bootstrap archive is missing: ${sourcePath}`);
}

const sourceBytes = await readFile(sourcePath);
const sourceFileSha256 = sha256Bytes(sourceBytes);
if (sourceFileSha256 !== EXPECTED_SOURCE_FILE_SHA256) {
  throw new Error(
    `Bootstrap source file SHA-256 drifted: expected ${EXPECTED_SOURCE_FILE_SHA256}, received ${sourceFileSha256}.`,
  );
}
const projection = verifyAndProjectM9ArchiveBytes({
  bytes: sourceBytes,
  archivePath: sourcePath,
  expectedCaptureKey: CAPTURE_KEY,
});
if (projection.sourceArchiveSha256 !== EXPECTED_ARCHIVE_SHA256) {
  throw new Error(
    `Bootstrap internal archive SHA-256 drifted: expected ${EXPECTED_ARCHIVE_SHA256}, received ${projection.sourceArchiveSha256}.`,
  );
}
if (projection.rows.length !== 78) {
  throw new Error(
    `Bootstrap archive must contain exactly 78 ranked rows; received ${projection.rows.length}.`,
  );
}

try {
  await copyFile(sourcePath, destinationPath, constants.COPYFILE_EXCL);
} catch (error) {
  if (error && typeof error === 'object' && error.code === 'EEXIST') {
    throw new Error(`Bootstrap destination unexpectedly exists: ${destinationPath}`);
  }
  throw error;
}

try {
  const readBack = await readFile(destinationPath);
  if (!readBack.equals(sourceBytes)) {
    throw new Error('Bootstrap archive read-back bytes differ from verified source.');
  }
  const readBackProjection = verifyAndProjectM9ArchiveBytes({
    bytes: readBack,
    archivePath: destinationPath,
    expectedCaptureKey: CAPTURE_KEY,
  });
  if (
    readBackProjection.sourceFileSha256 !== EXPECTED_SOURCE_FILE_SHA256 ||
    readBackProjection.sourceArchiveSha256 !== EXPECTED_ARCHIVE_SHA256
  ) {
    throw new Error('Bootstrap archive read-back lineage drifted.');
  }
} catch (error) {
  await unlink(destinationPath).catch(() => undefined);
  throw error;
}

console.log(`BOOTSTRAP\tPUBLISHED`);
console.log(`CAPTURE KEY\t${CAPTURE_KEY}`);
console.log(`SOURCE FILE SHA-256\t${EXPECTED_SOURCE_FILE_SHA256}`);
console.log(`ARCHIVE SHA-256\t${EXPECTED_ARCHIVE_SHA256}`);
console.log(`RANKED ROWS\t${projection.rows.length}`);
console.log('SOURCE ARCHIVE BYTES MODIFIED\tfalse');
console.log('PRODUCTION\tDISABLED');
console.log('RANKING\tDISABLED');
console.log('--- END M10 ARCHIVE LEDGER BOOTSTRAP ---');
