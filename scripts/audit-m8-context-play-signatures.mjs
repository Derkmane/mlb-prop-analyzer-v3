import { writeJsonAtomic } from './provider-probe-utils.mjs';
import { runM8ContextPlaySignatureAudit } from './m8-context-play-signature-audit-run-utils.mjs';

function requireEnvironmentValue(name) {
  const value = process.env[name]?.trim();
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

const datasetPath = requireEnvironmentValue('M8_RECENCY_DATASET_PATH');
const captureRoot = requireEnvironmentValue('M8_CONTEXT_PLAY_CAPTURE_ROOT');
const outputPath = requireEnvironmentValue(
  'M8_CONTEXT_PLAY_SIGNATURE_AUDIT_OUTPUT_PATH',
);

const audit = await runM8ContextPlaySignatureAudit({
  datasetPath,
  captureRoot,
});
await writeJsonAtomic(outputPath, audit);

console.log('=== M8 CONTEXT PLAY SIGNATURE AUDIT ===');
console.log(`Output: ${outputPath}`);
console.log(`Source dataset SHA-256: ${audit.sourceDatasetSha256}`);
console.log(`Source play capture SHA-256: ${audit.sourceCaptureSha256}`);
console.log(`Verified games: ${audit.verifiedGameCount}`);
console.log(`Verified pages: ${audit.verifiedPageCount}`);
console.log(`Verified plays: ${audit.verifiedPlayCount}`);
console.log(`Context rows conserved: ${audit.contextRowCount}`);
console.log(`Result counts: ${JSON.stringify(audit.resultCounts)}`);
console.log(`Segment match counts: ${JSON.stringify(audit.matchStatusCounts)}`);
console.log(`Distinct diagnostic signatures: ${audit.signatureCount}`);
console.log(
  `Untouched test sealed: ${audit.untouchedTestReservation.startDate} through ${audit.untouchedTestReservation.endDate} — ${audit.untouchedTestReservation.plateAppearanceCount} rows excluded`,
);
console.log(`Audit SHA-256: ${audit.auditSha256}`);
console.log(
  'No batter disposition or terminal category was inferred. This audit only measures whether the frozen play sequence supports a deterministic resolver.',
);
