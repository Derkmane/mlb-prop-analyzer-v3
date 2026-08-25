import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

test('PROJECT_RULES 2.17 preserves optional user projected lineup precedence and non-gating behavior', () => {
  const rules = readFileSync('PROJECT_RULES.md', 'utf8');
  assert.match(rules, /\*\*Version:\*\* 2\.17/u);
  assert.match(rules, /### User-supplied projected lineup evidence/u);
  assert.match(rules, /user-supplied projected lineup evidence is optional/u);
  assert.match(rules, /BALLDONTLIE current-game evidence has first precedence/u);
  assert.match(rules, /MLB\s+Stats API posted lineup has second precedence/u);
  assert.match(rules, /user-supplied projected\s+lineup evidence is used only when neither confirmed source/u);
  assert.match(rules, /every accepted user-supplied row has lineup status `projected`/u);
  assert.match(rules, /projection status alone may not change probability/u);
});
