#!/usr/bin/env node
/**
 * READ-ONLY artifact lineage dump.
 *
 * Writes nothing. Modifies nothing. Asserts nothing. Loads no dataset.
 * Its only job is to print what every SHA-256 in the artifact tree
 * actually is, so provenance mapping stops being inferred.
 *
 * Usage:
 *   node scripts/dump-artifact-lineage.mjs
 *   node scripts/dump-artifact-lineage.mjs 3e3e30150bee91e612798f39a449ef9f2adb682ce43fe1835a17f46a5bed4e82
 *
 * Any hashes passed as arguments get a focused "where does this live" report.
 */

import { createHash } from 'node:crypto';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

const ROOTS = ['model-artifacts', 'artifacts'];
const SHA_RE = /^[0-9a-f]{64}$/;
const targets = process.argv.slice(2).filter((a) => SHA_RE.test(a));

/** hash -> [{ kind, file, path }] */
const index = new Map();

function record(hash, entry) {
  if (!index.has(hash)) index.set(hash, []);
  index.get(hash).push(entry);
}

function walkDir(dir, out = []) {
  let entries;
  try {
    entries = readdirSync(dir);
  } catch {
    return out;
  }
  for (const name of entries) {
    const full = join(dir, name);
    let st;
    try {
      st = statSync(full);
    } catch {
      continue;
    }
    if (st.isDirectory()) walkDir(full, out);
    else if (name.endsWith('.json')) out.push(full);
  }
  return out;
}

/** Collect every 64-hex string inside a JSON value, with its dotted path. */
function collectShas(value, path, file) {
  if (typeof value === 'string') {
    if (SHA_RE.test(value)) {
      record(value, { kind: 'FIELD', file, path });
    }
    return;
  }
  if (Array.isArray(value)) {
    value.forEach((v, i) => collectShas(v, `${path}[${i}]`, file));
    return;
  }
  if (value && typeof value === 'object') {
    for (const [k, v] of Object.entries(value)) {
      collectShas(v, path ? `${path}.${k}` : k, file);
    }
  }
}

const files = ROOTS.flatMap((r) => walkDir(r));

if (files.length === 0) {
  console.error('No JSON artifacts found under:', ROOTS.join(', '));
  console.error('Run this from the repository root.');
  process.exit(1);
}

const fileInfo = [];

for (const file of files) {
  const rel = relative(process.cwd(), file);
  const raw = readFileSync(file);

  // Raw file identity: SHA-256 of the exact bytes on disk.
  const fileSha = createHash('sha256').update(raw).digest('hex');
  record(fileSha, { kind: 'FILE_BYTES', file: rel, path: '(raw bytes)' });

  let parsed = null;
  let parseError = null;
  try {
    parsed = JSON.parse(raw.toString('utf8'));
  } catch (err) {
    parseError = err.message;
  }

  if (parsed) collectShas(parsed, '', rel);

  fileInfo.push({
    rel,
    bytes: raw.length,
    fileSha,
    parseError,
    // Useful byte-level forensics for reformat detection.
    endsWithNewline: raw.length > 0 && raw[raw.length - 1] === 0x0a,
    hasCRLF: raw.includes(Buffer.from('\r\n')),
  });
}

console.log('='.repeat(78));
console.log('ARTIFACT FILES — raw byte identity');
console.log('='.repeat(78));
for (const f of fileInfo.sort((a, b) => a.rel.localeCompare(b.rel))) {
  console.log();
  console.log(f.rel);
  console.log(`  fileSha256      ${f.fileSha}`);
  console.log(`  bytes           ${f.bytes}`);
  console.log(`  trailingNewline ${f.endsWithNewline}`);
  console.log(`  containsCRLF    ${f.hasCRLF}`);
  if (f.parseError) console.log(`  PARSE ERROR     ${f.parseError}`);
}

console.log();
console.log('='.repeat(78));
console.log('CROSS-REFERENCE — every SHA and everywhere it appears');
console.log('='.repeat(78));

const sorted = [...index.entries()].sort((a, b) => b[1].length - a[1].length);

for (const [hash, entries] of sorted) {
  const isFileBytes = entries.some((e) => e.kind === 'FILE_BYTES');
  const fieldRefs = entries.filter((e) => e.kind === 'FIELD');

  // A hash that appears only once, as a field, references something
  // outside this tree — or something that has since been rewritten.
  const orphan = !isFileBytes && fieldRefs.length > 0;

  console.log();
  console.log(`${hash}${orphan ? '   <-- NO FILE IN TREE HAS THESE BYTES' : ''}`);
  for (const e of entries) {
    if (e.kind === 'FILE_BYTES') {
      console.log(`   FILE BYTES OF   ${e.file}`);
    } else {
      console.log(`   field           ${e.file} :: ${e.path}`);
    }
  }
}

if (targets.length > 0) {
  console.log();
  console.log('='.repeat(78));
  console.log('FOCUSED REPORT');
  console.log('='.repeat(78));
  for (const t of targets) {
    console.log();
    console.log(t);
    const entries = index.get(t);
    if (!entries) {
      console.log('   NOT FOUND ANYWHERE IN THE ARTIFACT TREE.');
      console.log('   Not the bytes of any committed file.');
      console.log('   Not the value of any field in any committed artifact.');
      console.log('   => The expected value is hard-coded in script/test source,');
      console.log('      or the referenced file has been rewritten since the');
      console.log('      SHA was recorded. Check git history for the file.');
      continue;
    }
    const asFile = entries.filter((e) => e.kind === 'FILE_BYTES');
    const asField = entries.filter((e) => e.kind === 'FIELD');
    if (asFile.length > 0) {
      console.log('   IS THE RAW BYTES OF:');
      for (const e of asFile) console.log(`      ${e.file}`);
    } else {
      console.log('   IS NOT the raw bytes of any committed artifact file.');
    }
    if (asField.length > 0) {
      console.log('   APPEARS AS A FIELD VALUE IN:');
      for (const e of asField) console.log(`      ${e.file} :: ${e.path}`);
    } else {
      console.log('   Does not appear as any field value.');
    }
  }
}

console.log();
console.log('Read-only dump complete. Nothing was written or modified.');
