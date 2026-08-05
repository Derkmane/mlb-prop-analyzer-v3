import { execFileSync } from 'node:child_process';
import { readFile, writeFile } from 'node:fs/promises';

const filePath = 'scripts/__apply-m9-capture-snapshot-identity.mjs';
const source = await readFile(filePath, 'utf8');
const rawBlockStartMarker = 'const funnelUtils = String.raw`';
const rawBlockEndMarker =
  "`;\nawait writeFile('scripts/m9-board-archive-funnel-utils.mjs', funnelUtils);";
const rawStart = source.indexOf(rawBlockStartMarker);
const rawEndMarkerStart = source.indexOf(rawBlockEndMarker, rawStart);
if (
  rawStart < 0 ||
  rawEndMarkerStart < rawStart ||
  source.indexOf(rawBlockStartMarker, rawStart + 1) >= 0
) {
  throw new Error('The raw funnel source block could not be isolated exactly once.');
}
const rawEnd = rawEndMarkerStart + rawBlockEndMarker.length;
const overescapedBacktick = '\\\\`';
const escapedBacktick = '\\`';
const normalizeOrdinaryTemplates = (value) =>
  value.replaceAll(overescapedBacktick, escapedBacktick);
const rawBlock = source
  .slice(rawStart, rawEnd)
  .replaceAll('${', '\\${');
let corrected =
  normalizeOrdinaryTemplates(source.slice(0, rawStart)) +
  rawBlock +
  normalizeOrdinaryTemplates(source.slice(rawEnd));
const correctedCount =
  source.slice(0, rawStart).split(overescapedBacktick).length - 1 +
  (source.slice(rawEnd).split(overescapedBacktick).length - 1);
if (correctedCount < 8) {
  throw new Error(
    `Expected at least eight ordinary generated backticks to normalize; found ${correctedCount}.`,
  );
}
if (!rawBlock.includes('\\${label}')) {
  throw new Error('The raw funnel block did not preserve literal interpolation markers.');
}
const incorrectHistoryMarker =
  '    const histories = await buildStrictlyEarlierTeamHistories({\\n' +
  '      historyCutoffDate,\\n' +
  '      shardRoot,\\n' +
  '    });\\n' +
  '    const providerSnapshots = [];';
const originalHistoryMarker =
  '    const histories = await buildStrictlyEarlierTeamHistories({\\n' +
  '      archiveDate,\\n' +
  '      shardRoot,\\n' +
  '    });\\n' +
  '    const providerSnapshots = [];';
const historyMarkerCount = corrected.split(incorrectHistoryMarker).length - 1;
if (historyMarkerCount !== 1) {
  throw new Error(
    `Expected one incorrect history relocation marker; found ${historyMarkerCount}.`,
  );
}
corrected = corrected.replace(incorrectHistoryMarker, originalHistoryMarker);
await writeFile(filePath, corrected);
execFileSync(process.execPath, ['--check', filePath], { stdio: 'inherit' });
