import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const WORKFLOW = '.github/workflows/m9-board-archive.yml';

test('artifact quota failure cannot block display persistence or coverage while immutable ledgers remain mandatory', async () => {
  const workflow = await readFile(WORKFLOW, 'utf8');

  assert.match(
    workflow,
    /id: upload-full-archives\n\s+if: always\(\)\n\s+continue-on-error: true/u,
  );

  assert.match(
    workflow,
    /id: persist-display-archives\n\s+if:[^\n]*build-display-archives\.outcome == 'success'[^\n]*upload-full-archives\.outcome == 'success'[^\n]*upload-full-archives\.outcome == 'failure'/u,
  );

  const precoverageStart = workflow.indexOf(
    'name: Verify capture prerequisites before coverage',
  );
  const finalizeStart = workflow.indexOf(
    'name: Finalize game coverage',
  );
  assert.ok(precoverageStart >= 0 && finalizeStart > precoverageStart);

  const precoverage = workflow.slice(precoverageStart, finalizeStart);
  assert.doesNotMatch(precoverage, /UPLOAD_OUTCOME/u);
  assert.doesNotMatch(precoverage, /Full evidence upload/u);

  assert.match(
    workflow,
    /id: save-hhr-board-archives\n\s+if:[^\n]*finalize-coverage\.outcome == 'success'/u,
  );
  assert.match(
    workflow,
    /id: save-hits-board-archives\n\s+if:[^\n]*finalize-coverage\.outcome == 'success'[^\n]*save-hhr-board-archives\.outcome == 'success'/u,
  );

  const statusStart = workflow.indexOf('name: Verify archive run status');
  assert.ok(statusStart >= 0);
  const status = workflow.slice(statusStart);
  assert.match(status, /HHR ledger durability:\$\{HHR_LEDGER_OUTCOME\}/u);
  assert.match(status, /Batter Hits ledger durability:\$\{HITS_LEDGER_OUTCOME\}/u);
  assert.doesNotMatch(status, /Full evidence upload/u);
});
