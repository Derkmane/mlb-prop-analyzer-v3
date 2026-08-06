import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

const source = fs.readFileSync('scripts/capture-m11-hhr-respecified-evidence.mjs', 'utf8');

test('HHR historical starter source imports the shared M8 PA-order recovery and fails closed', () => {
  assert.match(source, /import \{ recoverM8ActualStarterFromOrderedPitcherAppearances \} from '\.\/m8-starter-bullpen-transition-utils\.mjs'/u);
  assert.match(source, /recoverM8ActualStarterFromOrderedPitcherAppearances\(orderedAppearances\)/u);
  assert.doesNotMatch(source, /is_probable_pitcher\s*===\s*true/u);
  assert.match(source, /starter_reappeared_after_bullpen/u);
  assert.match(source, /starter_absent_from_pitcher_allowed/u);
  assert.match(source, /const frozenStarterAllowed = terminal\.pitcherAllowed\[String\(starter\.playerId\)\]/u);
  assert.doesNotMatch(source, /terminal\.pitcherAllowed\[String\(starter\.playerId\)\]\s*\?\?\s*terminal\.unseenPitcher/u);
  assert.match(source, /pitcherAllowedDataEndDate: '2026-07-05'/u);
  assert.match(source, /hhrFitStartDate: FIT_DATES\[0\]/u);
  assert.match(source, /overlap: false/u);
});
