import { readFile, writeFile } from 'node:fs/promises';

const filePath = 'scripts/__apply-m9-capture-snapshot-identity.mjs';
const source = await readFile(filePath, 'utf8');
const anchor = "  const snapshotSha256 = sha256Value(";
const startMarker = '  const captureKey = ';
const endMarker = '\\n  if (!CAPTURE_KEY_PATTERN.test(captureKey))';
const anchorStart = source.indexOf(anchor);
const duplicateAnchor = source.indexOf(anchor, anchorStart + anchor.length);
const start = source.indexOf(startMarker, anchorStart);
const end = source.indexOf(endMarker, start);
if (
  anchorStart < 0 ||
  duplicateAnchor >= 0 ||
  start < anchorStart ||
  end < start
) {
  throw new Error(
    'Temporary capture-key template could not be uniquely anchored to the capture-identity function.',
  );
}
const replacement =
  "  const captureKey = timestamp.replace(/[-:.]/gu, '') + '--' + snapshotSha256;";
await writeFile(
  filePath,
  `${source.slice(0, start)}${replacement}${source.slice(end)}`,
);
