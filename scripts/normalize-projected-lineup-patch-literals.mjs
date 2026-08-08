import { readFile, writeFile } from 'node:fs/promises';

const PATCH_FILES = Object.freeze([
  'scripts/apply-projected-lineup-integration.mjs',
  'scripts/apply-projected-lineup-hhr.mjs',
]);

function normalizeStringRawBlocks(text, filePath) {
  const lines = text.split('\n');
  const output = [];
  let active = null;
  let blockCount = 0;

  for (const line of lines) {
    if (active === null) {
      const marker = 'String.raw`';
      const markerIndex = line.indexOf(marker);
      if (markerIndex === -1) {
        output.push(line);
        continue;
      }
      if (line.slice(markerIndex + marker.length).trim() !== '') {
        throw new Error(
          `${filePath}: String.raw block must start at end of line for deterministic normalization.`,
        );
      }
      active = {
        prefix: line.slice(0, markerIndex),
        lines: [],
      };
      continue;
    }

    if (line.trim() === '`;') {
      output.push(`${active.prefix}${JSON.stringify(active.lines.join('\n'))};`);
      active = null;
      blockCount += 1;
      continue;
    }

    active.lines.push(line);
  }

  if (active !== null) {
    throw new Error(`${filePath}: unterminated String.raw patch block.`);
  }
  if (blockCount === 0) {
    throw new Error(`${filePath}: no String.raw patch blocks were found.`);
  }

  return Object.freeze({
    text: output.join('\n'),
    blockCount,
  });
}

for (const filePath of PATCH_FILES) {
  const original = await readFile(filePath, 'utf8');
  const normalized = normalizeStringRawBlocks(original, filePath);
  await writeFile(filePath, normalized.text, 'utf8');
  process.stdout.write(
    `NORMALIZED PATCH LITERALS ${filePath}: ${normalized.blockCount}\n`,
  );
}
