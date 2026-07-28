import { execFileSync } from 'node:child_process';
import { readFile, rm, writeFile } from 'node:fs/promises';

const ledgerPath = 'docs/providers/balldontlie-quirks.md';
const helperPath = 'scripts/apply-m8-nullable-pitch-evidence.mjs';

function run(command, args, options = {}) {
  execFileSync(command, args, {
    cwd: process.cwd(),
    env: process.env,
    stdio: 'inherit',
    ...options,
  });
}

let ledger = await readFile(ledgerPath, 'utf8');

const evidenceSection = `## Q9 — Pitch description and pitch-call-code metadata may be null\n\n### V3 current-season evidence\n\n\`\`\`text\nVerified on: 2026-07-27\nEndpoint: GET /mlb/v1/plate_appearances\nRequest parameter: game_id=5057771\nRequested game date: 2026-03-26\nCaptured row identity: game_id=5057771, pa_number=1\nExact terminal result: result=\"Strikeout\"\nExact nullable fields: pitches[].description=null, pitches[].pitch_call_code=null\nPreserved non-null pitch type: pitches[].pitch_type=\"Sinker\"\nLocal verified shard: artifacts/m8-current-season-pa/shards-2026/2026-03-26\nProtecting test: test/balldontlie-nullable-pitch-metadata.test.ts\n\`\`\`\n\n### Verified conclusion\n\nBALLDONTLIE may return \`null\` for pitch-level descriptive metadata even when the plate-appearance identity and terminal \`result\` are complete. The raw pitch contract therefore accepts \`string | null\` for only \`description\` and \`pitch_call_code\`. Required plate-appearance identity, handedness, terminal result, pitch type, ball count, and strike count remain strict.\n\nA nullable pitch description or pitch-call code may not be used to guess a terminal result. Direct verified terminal labels such as \`Strikeout\` continue to map from the required PA \`result\` field; context-dependent compound labels still fail closed when their required context is absent.\n\n### Protecting-test status\n\nThe focused regression test preserves the observed nullable values, proves the exact row maps to canonical \`K\`, and proves an empty required terminal result still fails validation.\n\n**V3 evidence:** current-season captured shard and exact row inspected  \n**Verification status:** observed nullable pitch metadata accepted; terminal-result strictness retained\n\n---\n\n`;

const changelogEntry = `### Version 1.5 — 2026-07-27\n\n- Recorded current-season plate-appearance evidence that \`pitches[].description\` and \`pitches[].pitch_call_code\` may be \`null\`.\n- Limited the contract change to those two descriptive pitch fields while preserving strict required PA identity, result, pitch type, and count fields.\n- Added the focused nullable-pitch regression test and retained fail-closed terminal-result behavior.\n\n`;

if (!ledger.includes('## Q9 — Pitch description and pitch-call-code metadata may be null')) {
  if (!ledger.includes('**Version:** 1.4  ')) {
    throw new Error('Expected provider ledger version 1.4 before applying Q9 evidence.');
  }
  ledger = ledger.replace('**Version:** 1.4  ', '**Version:** 1.5  ');

  const metadataMarker = '## Confirmed access-capture metadata';
  if (!ledger.includes(metadataMarker)) {
    throw new Error('Provider ledger metadata marker is missing.');
  }
  ledger = ledger.replace(metadataMarker, `${evidenceSection}${metadataMarker}`);

  const changelogMarker = '### Version 1.4 — 2026-07-23';
  if (!ledger.includes(changelogMarker)) {
    throw new Error('Provider ledger changelog marker is missing.');
  }
  ledger = ledger.replace(changelogMarker, `${changelogEntry}${changelogMarker}`);
  await writeFile(ledgerPath, ledger, 'utf8');
}

console.log('=== NULLABLE PITCH CONTRACT VERIFICATION ===');
run('npm', ['run', 'build']);
run('node', [
  '--test',
  'dist/test/balldontlie-nullable-pitch-metadata.test.js',
]);

await rm(helperPath);
run('git', ['add', ledgerPath, helperPath]);

try {
  run('git', [
    'commit',
    '-m',
    'Document nullable BALLDONTLIE pitch metadata',
  ]);
} catch {
  console.log('No documentation commit was needed.');
}
run('git', ['push', 'origin', 'HEAD:agent/m8-recency-weighting']);

console.log('=== RETRYING M8 RECENCY DATASET ===');
run('npm', ['run', 'test:m8-recency-evaluation-dataset']);
run('npm', ['run', 'build:m8-recency-evaluation-dataset'], {
  env: {
    ...process.env,
    M8_RECENCY_PARTITION_MANIFEST_PATH:
      'artifacts/m8-current-season-pa/m8-chronological-partition-v1.json',
    M8_RECENCY_DATASET_OUTPUT_PATH:
      'artifacts/m8-current-season-pa/m8-recency-evaluation-dataset-v1.json',
  },
});

console.log('=== M8 NULLABLE PITCH CORRECTION COMPLETE ===');
