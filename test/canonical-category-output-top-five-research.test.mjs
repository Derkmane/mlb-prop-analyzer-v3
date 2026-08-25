import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

test('PROJECT_RULES 2.17 separates full category output from the Top Five research subset', () => {
  const rules = readFileSync('PROJECT_RULES.md', 'utf8');

  assert.match(rules, /\*\*Version:\*\* 2\.17/u);
  assert.match(rules, /category eligibility requires `P\(Win \| grades\) > 0\.50`/u);
  assert.match(rules, /maximum of 20/u);
  assert.match(rules, /when at least 10 eligible picks exist, the category must\s+return at least the first 10/u);
  assert.match(rules, /never pad with a pick at or below 0\.50/u);
  assert.match(rules, /Top Five is a separate research-analysis subset/u);
  assert.match(rules, /first\s+five picks from an already-built category after approved sorting/u);
  assert.match(rules, /does not cap category\s+size, change eligibility, alter probability, or reorder the category/u);
});
