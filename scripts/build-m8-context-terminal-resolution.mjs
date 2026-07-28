import { readFile } from 'node:fs/promises';

import { writeJsonAtomic, sha256 } from './provider-probe-utils.mjs';
import { buildM8ContextTerminalResolution } from './m8-context-terminal-resolution-utils.mjs';

function requireEnvironmentValue(name) {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`Missing required environment variable: ${name}`);
  return value;
}

const auditPath = requireEnvironmentValue('M8_CONTEXT_PLAY_SIGNATURE_AUDIT_PATH');
const outputPath = requireEnvironmentValue('M8_CONTEXT_TERMINAL_RESOLUTION_OUTPUT_PATH');
const auditText = await readFile(auditPath, 'utf8');
const audit = JSON.parse(auditText);
const resolution = buildM8ContextTerminalResolution({
  audit,
  sourceAuditFileSha256: sha256(auditText),
});
await writeJsonAtomic(outputPath, resolution);

console.log('=== M8 CONTEXT TERMINAL RESOLUTION ===');
console.log(`Output: ${outputPath}`);
console.log(`Source audit SHA-256: ${resolution.sourceAuditSha256}`);
console.log(`Context rows conserved: ${resolution.contextRowCount}`);
console.log(`Resolution statuses: ${JSON.stringify(resolution.resolutionStatusCounts)}`);
console.log(`Terminal categories: ${JSON.stringify(resolution.terminalCategoryCounts)}`);
console.log(`Unresolved reasons: ${JSON.stringify(resolution.unresolvedReasonCounts)}`);
console.log(
  `Untouched test sealed: ${resolution.untouchedTestReservation.startDate} through ${resolution.untouchedTestReservation.endDate} — ${resolution.untouchedTestReservation.plateAppearanceCount} rows excluded`,
);
console.log(`Resolution SHA-256: ${resolution.resolutionSha256}`);
console.log(
  'Only exact typed provider markers were used. Play-result descriptions were not used for terminal classification.',
);
