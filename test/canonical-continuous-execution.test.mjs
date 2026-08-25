import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

test('PROJECT_RULES 2.18 locks continuous execution until a real boundary', () => {
  const rules = readFileSync('PROJECT_RULES.md', 'utf8');

  assert.match(rules, /\*\*Version:\*\* 2\.18/u);
  assert.match(
    rules,
    /When work can continue with available tools[\s\S]*do not stop merely to report progress, remaining work, or[\s\S]*next steps\. Continue executing the approved task\./u,
  );
  assert.match(
    rules,
    /Progress updates are not handoffs\.[\s\S]*continue the same[\s\S]*work without requiring the user to reply unless user action is genuinely[\s\S]*required\./u,
  );
  assert.match(
    rules,
    /Do not ask the user to repeat, reconfirm, or re-authorize instructions or[\s\S]*information already given and still applicable to the current task\./u,
  );
  assert.match(
    rules,
    /When user action is genuinely required, stop at that exact boundary and give[\s\S]*exactly one concrete action that advances the same issue\./u,
  );
  assert.match(
    rules,
    /Continue the approved sequence until the task passes its evidence gate,[\s\S]*the user stops, or a real boundary is reached\./u,
  );
});
