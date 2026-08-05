import { readFile, writeFile } from 'node:fs/promises';

const filePath = 'scripts/__apply-m9-capture-snapshot-identity.mjs';
const source = await readFile(filePath, 'utf8');
const startMarker = '  const captureKey = ';
const endMarker = '\\n  if (!CAPTURE_KEY_PATTERN.test(captureKey))';
const start = source.indexOf(startMarker);
const end = source.indexOf(endMarker, start);
if (start < 0 || end < 0 || source.indexOf(startMarker, start + 1) >= 0) {
  throw new Error('Temporary capture-key template marker did not match exactly once.');
}
const replacement =
  "  const captureKey = timestamp.replace(/[-:.]/gu, '') + '--' + snapshotSha256;";
await writeFile(
  filePath,
  `${source.slice(0, start)}${replacement}${source.slice(end)}`,
);
