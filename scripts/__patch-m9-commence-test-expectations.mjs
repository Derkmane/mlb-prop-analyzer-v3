import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';

const path = 'test/m9-board-archive-live-boundary.test.mjs';
let text = await readFile(path, 'utf8');

const replacements = [
  [
    '/DUPLICATE FETCH ARTIFACT — deduplicated by exact provider game ID/u',
    '/repeated raw rows deduplicated by exact provider game ID/u',
  ],
  [
    '/GENUINE AMBIGUITY — no deduplication or arbitrary selection/u',
    '/GENUINE AMBIGUITY — two or more distinct provider game IDs are within tolerance; no nearest-game selection/u',
  ],
];

for (const [before, after] of replacements) {
  const index = text.indexOf(before);
  assert.notEqual(index, -1, `missing expected test assertion: ${before}`);
  assert.equal(text.indexOf(before, index + 1), -1, `duplicate test assertion: ${before}`);
  text = `${text.slice(0, index)}${after}${text.slice(index + before.length)}`;
}

await writeFile(path, text);
