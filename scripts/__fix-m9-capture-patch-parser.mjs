import { execFileSync } from 'node:child_process';
import { readFile, writeFile } from 'node:fs/promises';

const filePath = 'scripts/__apply-m9-capture-snapshot-identity.mjs';
const source = await readFile(filePath, 'utf8');
const overescapedBacktick = '\\\\`';
const escapedBacktick = '\\`';
const occurrenceCount = source.split(overescapedBacktick).length - 1;
if (occurrenceCount < 8) {
  throw new Error(
    `Expected the generated patch to contain at least eight overescaped backticks; found ${occurrenceCount}.`,
  );
}
const corrected = source.replaceAll(overescapedBacktick, escapedBacktick);
await writeFile(filePath, corrected);
execFileSync(process.execPath, ['--check', filePath], { stdio: 'inherit' });
