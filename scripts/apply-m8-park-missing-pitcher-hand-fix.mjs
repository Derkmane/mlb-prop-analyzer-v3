import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { readFileSync, unlinkSync, writeFileSync } from 'node:fs';

const parts = [
  'scripts/.m8-park-fix-01.part',
  'scripts/.m8-park-fix-02.part',
  'scripts/.m8-park-fix-03.part',
  'scripts/.m8-park-fix-04.part',
  'scripts/.m8-park-fix-05.part',
  'scripts/.m8-park-fix-06.part',
];
const expectedSha256 = 'b80f3103742a23008350699e6b107aab9ee5b4a02bad42c4e54d563bfe152907';
const source = Buffer.concat(parts.map((part) => readFileSync(part)));
const actualSha256 = createHash('sha256').update(source).digest('hex');
if (actualSha256 !== expectedSha256) {
  throw new Error(`M8 park fix source identity mismatch: expected ${expectedSha256}, found ${actualSha256}.`);
}
const temporaryPath = `/tmp/apply-m8-park-missing-pitcher-hand-fix-${process.pid}.mjs`;
writeFileSync(temporaryPath, source);
try {
  const syntax = spawnSync(process.execPath, ['--check', temporaryPath], { stdio: 'inherit' });
  if (syntax.status !== 0) process.exit(syntax.status ?? 1);
  const result = spawnSync(process.execPath, [temporaryPath], { stdio: 'inherit' });
  process.exitCode = result.status ?? 1;
} finally {
  try {
    unlinkSync(temporaryPath);
  } catch {
    // The temporary executable is outside the repository and best-effort cleanup is sufficient.
  }
}
