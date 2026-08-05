import { execFileSync } from 'node:child_process';
import { readFile, writeFile } from 'node:fs/promises';

const expectedBlobs = Object.freeze({
  'scripts/archive-m9-batter-hits-board.mjs': 'a4aeaa0dff36222553ceda01b9634cccd38e7a46',
  'scripts/m9-board-archive-utils.mjs': '246c5a21d8a857879d41fde9e7312b19b49d6918',
  'scripts/m9-board-archive-funnel-utils.mjs': '790afd38db9fffd04872b3e51033d4730e70b12e',
  'test/m9-board-archive-funnel.test.mjs': 'a88dda7814eae70c5e9af26ff000b355f8e80f44',
  'test/m9-board-archive-live-boundary.test.mjs': 'abfa3579567aba137d3989f950abb8b0e6b0b349',
  'test/m9-board-archive.test.mjs': 'de641a422ae09da45dc8824d4f5ccc0227c4851b',
});

function blobSha(filePath) {
  return execFileSync('git', ['hash-object', filePath], { encoding: 'utf8' }).trim();
}

function replaceOnce(source, before, after, label) {
  const first = source.indexOf(before);
  if (first < 0 || source.indexOf(before, first + before.length) >= 0) {
    throw new Error(`${label} must match exactly once.`);
  }
  return `${source.slice(0, first)}${after}${source.slice(first + before.length)}`;
}

function replaceRegexOnce(source, pattern, after, label) {
  const matches = [...source.matchAll(new RegExp(pattern.source, pattern.flags.includes('g') ? pattern.flags : `${pattern.flags}g`))];
  if (matches.length !== 1) {
    throw new Error(`${label} must match exactly once; found ${matches.length}.`);
  }
  return source.replace(pattern, after);
}

for (const [filePath, expected] of Object.entries(expectedBlobs)) {
  const actual = blobSha(filePath);
  if (actual !== expected) {
    throw new Error(`${filePath} blob drifted: expected ${expected}, received ${actual}.`);
  }
}

let archiveUtils = await readFile('scripts/m9-board-archive-utils.mjs', 'utf8');
archiveUtils = replaceOnce(
  archiveUtils,
  `export const M9_BOARD_ARCHIVE_VERSION = 1;\nexport const M9_BOARD_ARCHIVE_CONTRACT =\n  'm9-batter-hits-prospective-board-archive-v1';\nexport const M9_BOARD_ARCHIVE_TIME_ZONE = 'America/Chicago';`,
  `export const M9_BOARD_ARCHIVE_VERSION = 2;\nexport const M9_BOARD_ARCHIVE_CONTRACT =\n  'm9-batter-hits-prospective-capture-snapshot-v2';`,
  'archive version and contract',
);
archiveUtils = replaceOnce(
  archiveUtils,
  `const DATE_PATTERN = /^\\d{4}-\\d{2}-\\d{2}$/u;\nconst SHA256_PATTERN = /^[a-f0-9]{64}$/u;`,
  `const SHA256_PATTERN = /^[a-f0-9]{64}$/u;\nconst CAPTURE_KEY_PATTERN = /^\\d{8}T\\d{9}Z--[a-f0-9]{64}$/u;`,
  'archive patterns',
);
archiveUtils = replaceRegexOnce(
  archiveUtils,
  /function archiveDate\(value\) \{[\s\S]*?\n\}\n\nfunction sha256Value/u,
  `export function createM9CaptureIdentity({\n  capturedAt,\n  rawProviderSnapshotSha256,\n}) {\n  const timestamp = new Date(\n    isoTimestamp(capturedAt, 'captureIdentity.capturedAt'),\n  ).toISOString();\n  const snapshotSha256 = sha256Value(\n    rawProviderSnapshotSha256,\n    'captureIdentity.rawProviderSnapshotSha256',\n  );\n  const captureKey = \\`${'${timestamp.replace(/[-:.]/gu, \'\')}'}--${'${snapshotSha256}'}\\`;\n  if (!CAPTURE_KEY_PATTERN.test(captureKey)) {\n    throw new Error('Capture identity key failed canonical construction.');\n  }\n  return Object.freeze({\n    capturedAt: timestamp,\n    rawProviderSnapshotSha256: snapshotSha256,\n    captureKey,\n  });\n}\n\nfunction sha256Value`,
  'archive date helper replacement',
);
archiveUtils = replaceOnce(
  archiveUtils,
  `function sortSnapshots(snapshots) {\n  return Object.freeze(\n    [...snapshots]\n      .map((snapshot) => immutableJson(snapshot, 'provider snapshot'))\n      .sort(\n        (left, right) =>\n          String(left.capturedAt).localeCompare(String(right.capturedAt)) ||\n          String(left.label).localeCompare(String(right.label)),\n      ),\n  );\n}\n\n/**`,
  `function sortSnapshots(snapshots) {\n  return Object.freeze(\n    [...snapshots]\n      .map((snapshot) => immutableJson(snapshot, 'provider snapshot'))\n      .sort(\n        (left, right) =>\n          String(left.capturedAt).localeCompare(String(right.capturedAt)) ||\n          String(left.label).localeCompare(String(right.label)),\n      ),\n  );\n}\n\nfunction pregameEventRecord(event) {\n  const value = object(event, 'pregame event');\n  return Object.freeze({\n    eventId: nonemptyString(value.eventId, 'pregame event eventId'),\n    commenceTimeUtc: isoTimestamp(\n      value.commenceTimeUtc,\n      'pregame event commenceTimeUtc',\n    ),\n    homeTeamName: nonemptyString(\n      value.homeTeamName,\n      'pregame event homeTeamName',\n    ),\n    awayTeamName: nonemptyString(\n      value.awayTeamName,\n      'pregame event awayTeamName',\n    ),\n  });\n}\n\n/**`,
  'pregame event record insertion',
);
archiveUtils = replaceOnce(
  archiveUtils,
  `export function buildM9ProspectiveBoardArchive({\n  archiveDate: dateInput,\n  capturedAt,\n  providerSnapshots,`,
  `export function buildM9ProspectiveBoardArchive({\n  capturedAt,\n  captureSnapshotSha256,\n  pregameEvents,\n  providerSnapshots,`,
  'archive build signature',
);
archiveUtils = replaceOnce(
  archiveUtils,
  `}) {\n  const date = archiveDate(dateInput);\n  const timestamp = isoTimestamp(capturedAt, 'capturedAt');\n  const snapshots = sortSnapshots(`,
  `}) {\n  const captureIdentity = createM9CaptureIdentity({\n    capturedAt,\n    rawProviderSnapshotSha256: captureSnapshotSha256,\n  });\n  const timestamp = captureIdentity.capturedAt;\n  const snapshots = sortSnapshots(`,
  'archive build identity',
);
archiveUtils = replaceOnce(
  archiveUtils,
  `  if (snapshots.length === 0) {\n    throw new Error('A prospective archive requires provider snapshots.');\n  }\n  const sourceOffers = array(normalizedOffers, 'normalizedOffers');`,
  `  if (snapshots.length === 0) {\n    throw new Error('A prospective archive requires provider snapshots.');\n  }\n  if (\n    !snapshots.some(\n      (snapshot) =>\n        snapshot.rawBody?.sha256 ===\n        captureIdentity.rawProviderSnapshotSha256,\n    )\n  ) {\n    throw new Error(\n      'Capture identity SHA-256 must reference one preserved raw provider snapshot.',\n    );\n  }\n  const events = Object.freeze(\n    [...array(pregameEvents, 'pregameEvents')]\n      .map(pregameEventRecord)\n      .sort(\n        (left, right) =>\n          left.commenceTimeUtc.localeCompare(right.commenceTimeUtc) ||\n          left.eventId.localeCompare(right.eventId),\n      ),\n  );\n  if (events.length === 0) {\n    throw new Error('A prospective archive requires at least one pregame event.');\n  }\n  const sourceOffers = array(normalizedOffers, 'normalizedOffers');`,
  'archive event validation',
);
archiveUtils = replaceOnce(
  archiveUtils,
  `    archiveVersion: M9_BOARD_ARCHIVE_VERSION,\n    archiveContract: M9_BOARD_ARCHIVE_CONTRACT,\n    archiveDate: date,\n    capturedAt: timestamp,\n    timeZone: M9_BOARD_ARCHIVE_TIME_ZONE,`,
  `    archiveVersion: M9_BOARD_ARCHIVE_VERSION,\n    archiveContract: M9_BOARD_ARCHIVE_CONTRACT,\n    captureIdentity,\n    capturedAt: timestamp,\n    captureDateUtc: timestamp.slice(0, 10),`,
  'archive identity fields',
);
archiveUtils = replaceOnce(
  archiveUtils,
  `    providerSnapshots: snapshots,\n    normalizedOffers: offers,`,
  `    providerSnapshots: snapshots,\n    pregameEvents: events,\n    normalizedOffers: offers,`,
  'archive event contents',
);
archiveUtils = replaceOnce(
  archiveUtils,
  `export function m9ArchiveFilePath(rootDirectory, dateInput) {\n  return path.join(rootDirectory, \\`${'${archiveDate(dateInput)}'}.json\\`);\n}`,
  `export function m9ArchiveFilePath(rootDirectory, captureIdentityInput) {\n  const identity = object(captureIdentityInput, 'captureIdentity');\n  const captureKey = nonemptyString(identity.captureKey, 'captureIdentity.captureKey');\n  if (!CAPTURE_KEY_PATTERN.test(captureKey)) {\n    throw new TypeError('captureIdentity.captureKey is not canonical.');\n  }\n  return path.join(rootDirectory, 'captures', \\`${'${captureKey}'}.json\\`);\n}`,
  'archive file path',
);
archiveUtils = archiveUtils.replace(
  'atomically and can never replace an existing daily archive, even when the',
  'atomically and can never replace an existing capture identity, even when the',
);
archiveUtils = archiveUtils.replace(
  'Immutable board archive already exists; rerun refused without overwrite:',
  'Immutable board capture already exists; capture identity rewrite refused without overwrite:',
);
await writeFile('scripts/m9-board-archive-utils.mjs', archiveUtils);

const funnelUtils = String.raw`const FUNNEL_STAGE_DEFINITIONS = Object.freeze([
  Object.freeze({ key: 'providerEvents', label: 'provider events returned', unit: 'events' }),
  Object.freeze({ key: 'pregameEvents', label: 'pregame events surviving the started-game gate', unit: 'events' }),
  Object.freeze({ key: 'rawOffers', label: 'raw Underdog Batter Hits offers', unit: 'offers' }),
  Object.freeze({ key: 'resolvedIdentityOffers', label: 'offers with a resolved unique player identity', unit: 'offers' }),
  Object.freeze({ key: 'matchedGameOffers', label: 'offers with a matched current-season game', unit: 'offers' }),
  Object.freeze({ key: 'lineupEvidenceOffers', label: 'offers with lineup evidence (confirmed or projected)', unit: 'offers' }),
  Object.freeze({ key: 'verifiedStarterOffers', label: 'offers with a verified opposing starter', unit: 'offers' }),
  Object.freeze({ key: 'historyOffers', label: 'offers with sufficient strictly-earlier current-season history', unit: 'offers' }),
  Object.freeze({ key: 'composedCandidates', label: 'candidates successfully composed through D_final', unit: 'candidates' }),
  Object.freeze({ key: 'rankedCandidates', label: 'candidates ranked', unit: 'candidates' }),
]);

const STAGE_BY_KEY = new Map(FUNNEL_STAGE_DEFINITIONS.map((definition) => [definition.key, definition]));

function object(value, label) {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new TypeError(\`${label} must be an object.\`);
  }
  return value;
}

function array(value, label) {
  if (!Array.isArray(value)) throw new TypeError(\`${label} must be an array.\`);
  return value;
}

function nonnegativeInteger(value, label) {
  if (!Number.isSafeInteger(value) || value < 0) throw new TypeError(\`${label} must be a nonnegative integer.\`);
  return value;
}

function nonemptyString(value, label) {
  if (typeof value !== 'string' || value.trim().length === 0) throw new TypeError(\`${label} must be a nonempty string.\`);
  return value.trim();
}

function isoTimestamp(value, label) {
  const timestamp = nonemptyString(value, label);
  const milliseconds = Date.parse(timestamp);
  if (!Number.isFinite(milliseconds)) throw new TypeError(\`${label} must be an ISO timestamp.\`);
  return new Date(milliseconds).toISOString();
}

function exactName(value, label) {
  return nonemptyString(value, label).replace(/\s+/gu, ' ');
}

function stageDefinition(stageKey) {
  const definition = STAGE_BY_KEY.get(stageKey);
  if (definition === undefined) throw new Error(\`Unknown M9 archive funnel stage: ${String(stageKey)}\`);
  return definition;
}

export function selectM9PregameEventsForCapture({ rawEvents, capturedAt }) {
  const rows = array(rawEvents, 'The Odds API events');
  const captureTimestamp = isoTimestamp(capturedAt, 'capturedAt');
  const capturedMilliseconds = Date.parse(captureTimestamp);
  const events = [];
  const drops = [];

  rows.forEach((raw, index) => {
    const event = object(raw, \`events[${index}]\`);
    const eventId = nonemptyString(event.id, \`events[${index}].id\`);
    const sportKey = nonemptyString(event.sport_key, \`events[${index}].sport_key\`);
    const commenceTimeUtc = isoTimestamp(event.commence_time, \`events[${index}].commence_time\`);
    const normalized = Object.freeze({
      id: eventId,
      eventId,
      sportKey,
      commenceTime: commenceTimeUtc,
      commenceTimeUtc,
      homeTeamName: exactName(event.home_team, \`events[${index}].home_team\`),
      awayTeamName: exactName(event.away_team, \`events[${index}].away_team\`),
    });
    if (sportKey !== 'baseball_mlb') {
      drops.push(Object.freeze({ eventId, commenceTimeUtc, reason: 'unexpected sport key' }));
      return;
    }
    if (Date.parse(commenceTimeUtc) <= capturedMilliseconds) {
      drops.push(Object.freeze({ eventId, commenceTimeUtc, reason: 'game already in progress' }));
      return;
    }
    events.push(normalized);
  });

  events.sort((left, right) => left.commenceTimeUtc.localeCompare(right.commenceTimeUtc) || left.eventId.localeCompare(right.eventId));
  drops.sort((left, right) => left.commenceTimeUtc.localeCompare(right.commenceTimeUtc) || left.eventId.localeCompare(right.eventId) || left.reason.localeCompare(right.reason));
  return Object.freeze({ providerEventCount: rows.length, captureTimestamp, events: Object.freeze(events), drops: Object.freeze(drops) });
}

export function createM9ArchiveFunnel({ captureTimestamp, dryRun }) {
  const state = new Map(FUNNEL_STAGE_DEFINITIONS.map((definition) => [definition.key, { entered: 0, survived: 0, drops: new Map() }]));
  const eventDrops = [];

  function add(stageKey, { entered = 0, survived = 0 } = {}) {
    stageDefinition(stageKey);
    const stage = state.get(stageKey);
    stage.entered += nonnegativeInteger(entered, \`${stageKey}.entered\`);
    stage.survived += nonnegativeInteger(survived, \`${stageKey}.survived\`);
    if (stage.survived > stage.entered) throw new Error(\`${stageKey} surviving count cannot exceed its entering count.\`);
  }

  function drop(stageKey, reason, count = 1) {
    stageDefinition(stageKey);
    const stage = state.get(stageKey);
    const key = nonemptyString(reason, \`${stageKey}.dropReason\`);
    const amount = nonnegativeInteger(count, \`${stageKey}.dropCount\`);
    stage.drops.set(key, (stage.drops.get(key) ?? 0) + amount);
  }

  function dropEvent(stageKey, { eventId, commenceTimeUtc, reason }) {
    stageDefinition(stageKey);
    const detail = Object.freeze({
      stageKey,
      eventId: nonemptyString(eventId, \`${stageKey}.eventId\`),
      commenceTimeUtc: isoTimestamp(commenceTimeUtc, \`${stageKey}.commenceTimeUtc\`),
      reason: nonemptyString(reason, \`${stageKey}.eventDropReason\`),
    });
    drop(stageKey, detail.reason, 1);
    eventDrops.push(detail);
  }

  function snapshot() {
    const stages = FUNNEL_STAGE_DEFINITIONS.map((definition) => {
      const stage = state.get(definition.key);
      const drops = [...stage.drops.entries()].map(([reason, count]) => Object.freeze({ reason, count })).sort((left, right) => left.reason.localeCompare(right.reason));
      const attributedDropCount = drops.reduce((sum, entry) => sum + entry.count, 0);
      const actualDropCount = stage.entered - stage.survived;
      if (attributedDropCount > actualDropCount) throw new Error(\`${definition.key} attributes more drops than entered minus survived.\`);
      if (attributedDropCount < actualDropCount) drops.push(Object.freeze({ reason: 'stage failed closed before a narrower cause was available', count: actualDropCount - attributedDropCount }));
      return Object.freeze({ ...definition, entered: stage.entered, survived: stage.survived, dropped: actualDropCount, drops: Object.freeze(drops) });
    });
    return Object.freeze({
      version: 2,
      captureTimestamp: isoTimestamp(captureTimestamp, 'captureTimestamp'),
      dryRun: Boolean(dryRun),
      stages: Object.freeze(stages),
      eventDrops: Object.freeze([...eventDrops].sort((left, right) => left.commenceTimeUtc.localeCompare(right.commenceTimeUtc) || left.eventId.localeCompare(right.eventId) || left.reason.localeCompare(right.reason))),
    });
  }

  return Object.freeze({ add, drop, dropEvent, snapshot });
}

export function formatM9ArchiveFunnelReport({ funnel, status }) {
  const snapshot = typeof funnel?.snapshot === 'function' ? funnel.snapshot() : funnel;
  if (snapshot === null || typeof snapshot !== 'object') throw new TypeError('funnel must be a funnel instance or snapshot.');
  const normalizedStatus = nonemptyString(status, 'status');
  const lines = [
    'M9 BOARD ARCHIVE FUNNEL',
    \`MODE: ${snapshot.dryRun ? 'DRY RUN — NO ARCHIVE WRITE' : 'IMMUTABLE CAPTURE SNAPSHOT'}\`,
    \`STATUS: ${normalizedStatus}\`,
    \`CAPTURE TIMESTAMP: ${snapshot.captureTimestamp}\`,
  ];
  for (const stage of snapshot.stages) {
    lines.push(\`${stage.label}: entering ${stage.entered} ${stage.unit}; surviving ${stage.survived}; dropped ${stage.dropped}\`);
    for (const drop of stage.drops) lines.push(\`  dropped: ${drop.count} (${drop.reason})\`);
    for (const detail of snapshot.eventDrops.filter((entry) => entry.stageKey === stage.key)) {
      lines.push(\`  event drop: ${detail.eventId} | ${detail.commenceTimeUtc} | ${detail.reason}\`);
    }
  }
  lines.push('');
  return \`${lines.join('\n')}\n\`;
}

export function printM9ArchiveFunnelReport({ funnel, status, write = (text) => process.stdout.write(text) }) {
  const report = formatM9ArchiveFunnelReport({ funnel, status });
  write(report);
  return report;
}

export async function persistM9ArchiveForMode({ dryRun, filePath, archive, persist }) {
  if (dryRun) return null;
  if (typeof persist !== 'function') throw new TypeError('persist must be a function for a real archive run.');
  return persist({ filePath, archive });
}

export { FUNNEL_STAGE_DEFINITIONS };
`;
await writeFile('scripts/m9-board-archive-funnel-utils.mjs', funnelUtils);

let live = await readFile('scripts/archive-m9-batter-hits-board.mjs', 'utf8');
live = replaceOnce(
  live,
  `  buildM9ProspectiveBoardArchive,\n  createM9RawProviderSnapshot,\n  m9ArchiveFilePath,`,
  `  buildM9ProspectiveBoardArchive,\n  createM9CaptureIdentity,\n  createM9RawProviderSnapshot,\n  m9ArchiveFilePath,`,
  'live archive utility imports',
);
live = replaceOnce(
  live,
  `  createM9ArchiveFunnel,\n  persistM9ArchiveForMode,\n  printM9ArchiveFunnelReport,`,
  `  createM9ArchiveFunnel,\n  persistM9ArchiveForMode,\n  printM9ArchiveFunnelReport,\n  selectM9PregameEventsForCapture,`,
  'live funnel imports',
);
live = replaceOnce(live, `const ARCHIVE_TIME_ZONE = 'America/Chicago';\n`, '', 'Chicago constant removal');
live = replaceRegexOnce(live, /function chicagoDate\(value\) \{[\s\S]*?\n\}\n\nfunction selectedResponseHeaders/u, 'function selectedResponseHeaders', 'Chicago date helper removal');
live = replaceRegexOnce(live, /function prospectiveEvents\([\s\S]*?\n\}\n\nfunction matchGame/u, 'function matchGame', 'prospective date-window helper removal');
live = replaceOnce(
  live,
  `  provider,\n  label,\n  url,`,
  `  provider,\n  label,\n  url,\n  capturedAt,`,
  'snapshot capturedAt input',
);
live = replaceOnce(
  live,
  `  if (beforeRequest) await beforeRequest();\n  const capturedAt = new Date().toISOString();\n  const response = await fetch(url, { headers });`,
  `  if (beforeRequest) await beforeRequest();\n  const snapshotCapturedAt = capturedAt ?? new Date().toISOString();\n  const response = await fetch(url, { headers });`,
  'snapshot capturedAt assignment',
);
live = replaceOnce(live, `    capturedAt,\n    request: {`, `    capturedAt: snapshotCapturedAt,\n    request: {`, 'snapshot capturedAt record');
let historyBlockMatch = live.match(/async function buildStrictlyEarlierTeamHistories\([\s\S]*?\n\}\n\nfunction gameEnvironmentFeatures/u);
if (historyBlockMatch === null) throw new Error('history function block was not found.');
const historyBlock = historyBlockMatch[0]
  .replaceAll('archiveDate', 'historyCutoffDate')
  .replace('function gameEnvironmentFeatures', 'function gameEnvironmentFeatures');
live = live.replace(historyBlockMatch[0], historyBlock);
live = replaceOnce(
  live,
  `  const capturedAt = now.toISOString();\n  const archiveDate = chicagoDate(now);\n  const filePath = m9ArchiveFilePath(outputRoot, archiveDate);\n  const funnel = createM9ArchiveFunnel({ archiveDate, dryRun });`,
  `  const capturedAt = now.toISOString();\n  const captureDateUtc = capturedAt.slice(0, 10);\n  let captureIdentity = null;\n  let filePath = null;\n  const funnel = createM9ArchiveFunnel({\n    captureTimestamp: capturedAt,\n    dryRun,\n  });`,
  'live run identity initialization',
);
live = replaceOnce(live, `    if (!dryRun) await assertArchiveAbsent(filePath);\n\n`, '', 'early immutable date check removal');
live = replaceOnce(
  live,
  `    const histories = await buildStrictlyEarlierTeamHistories({\n      historyCutoffDate,\n      shardRoot,\n    });\n    const providerSnapshots = [];`,
  `    const providerSnapshots = [];`,
  'history load relocation',
);
live = replaceOnce(
  live,
  `    const eventsSnapshot = await fetchOdds({\n      label: 'The Odds API MLB events',\n      url: eventsUrl,\n      requireNonemptyRecords: true,\n    });`,
  `    const eventsSnapshot = await fetchOdds({\n      label: 'The Odds API MLB events',\n      url: eventsUrl,\n      capturedAt,\n      requireNonemptyRecords: true,\n    });`,
  'events snapshot capture time',
);
live = replaceRegexOnce(
  live,
  /    const eventSelection = prospectiveEvents\([\s\S]*?    \}\n\n    const gamesUrl/u,
  `    captureIdentity = createM9CaptureIdentity({\n      capturedAt,\n      rawProviderSnapshotSha256: eventsSnapshot.rawBody.sha256,\n    });\n    filePath = m9ArchiveFilePath(outputRoot, captureIdentity);\n    if (!dryRun) await assertArchiveAbsent(filePath);\n\n    const eventSelection = selectM9PregameEventsForCapture({\n      rawEvents: eventsSnapshot.parsedBody,\n      capturedAt,\n    });\n    funnel.add('providerEvents', {\n      entered: eventSelection.providerEventCount,\n      survived: eventSelection.providerEventCount,\n    });\n    funnel.add('pregameEvents', {\n      entered: eventSelection.providerEventCount,\n      survived: eventSelection.events.length,\n    });\n    eventSelection.drops.forEach((drop) =>\n      funnel.dropEvent('pregameEvents', drop),\n    );\n    if (eventSelection.events.length === 0) {\n      throw new Error(\n        \\`No pregame MLB events survived the started-game gate at ${'${capturedAt}'}.\\`,\n      );\n    }\n\n    const histories = await buildStrictlyEarlierTeamHistories({\n      historyCutoffDate: captureDateUtc,\n      shardRoot,\n    });\n\n    const gamesUrl`,
  'live event selection and capture identity',
);
live = replaceOnce(
  live,
  `    gamesUrl.searchParams.append('dates[]', archiveDate);\n    gamesUrl.searchParams.set('season_type', 'regular');\n    gamesUrl.searchParams.set('per_page', '100');\n    const gamesSnapshot = await fetchBdl({\n      label: \\`BALLDONTLIE games ${'${archiveDate}'}\\`,`,
  `    const eventUtcDates = [\n      ...new Set(\n        eventSelection.events.map((event) => event.commenceTimeUtc.slice(0, 10)),\n      ),\n    ].sort();\n    eventUtcDates.forEach((date) => gamesUrl.searchParams.append('dates[]', date));\n    gamesUrl.searchParams.set('season_type', 'regular');\n    gamesUrl.searchParams.set('per_page', '100');\n    const gamesSnapshot = await fetchBdl({\n      label: \\`BALLDONTLIE games for pregame event UTC dates ${'${eventUtcDates.join(\',\')}'}\\`,`,
  'BDL pregame event date requests',
);
live = replaceOnce(
  live,
  `    const archive = buildM9ProspectiveBoardArchive({\n      archiveDate,\n      capturedAt,\n      providerSnapshots,`,
  `    const archive = buildM9ProspectiveBoardArchive({\n      capturedAt,\n      captureSnapshotSha256: eventsSnapshot.rawBody.sha256,\n      pregameEvents: eventSelection.events.map((event) =>\n        Object.freeze({\n          eventId: event.eventId,\n          commenceTimeUtc: event.commenceTimeUtc,\n          homeTeamName: event.homeTeamName,\n          awayTeamName: event.awayTeamName,\n        }),\n      ),\n      providerSnapshots,`,
  'archive capture inputs',
);
live = replaceOnce(
  live,
  `        'M9 Prospective Batter Hits Board Archive',\n        'PRODUCTION RANKING: DISABLED',\n        \\`MODE: ${'${dryRun ? \'DRY RUN — NO ARCHIVE WRITTEN\' : \'IMMUTABLE ARCHIVE\'}'}\\`,\n        \\`ARCHIVE: ${'${persisted === null ? \'NOT WRITTEN (--dry-run)\' : persisted.filePath}'}\\`,`,
  `        'M9 Prospective Batter Hits Board Capture Snapshot',\n        'PRODUCTION RANKING: DISABLED',\n        \\`MODE: ${'${dryRun ? \'DRY RUN — NO ARCHIVE WRITTEN\' : \'IMMUTABLE CAPTURE SNAPSHOT\'}'}\\`,\n        \\`CAPTURE IDENTITY: ${'${captureIdentity.captureKey}'}\\`,\n        \\`CAPTURE TIMESTAMP: ${'${captureIdentity.capturedAt}'}\\`,\n        \\`RAW EVENTS SNAPSHOT SHA-256: ${'${captureIdentity.rawProviderSnapshotSha256}'}\\`,\n        \\`ARCHIVE: ${'${persisted === null ? \'NOT WRITTEN (--dry-run)\' : persisted.filePath}'}\\`,`,
  'live success output identity',
);
live = live.replace(
  'Immutable board archive already exists; live capture refused before provider calls:',
  'Immutable board capture already exists; capture identity rewrite refused before downstream provider calls:',
);
for (const forbidden of ['America/Chicago', 'chicagoDate', 'outside the requested Chicago archive date', 'ARCHIVE_TIME_ZONE']) {
  if (live.includes(forbidden)) throw new Error(`live archive still contains forbidden timezone filter token: ${forbidden}`);
}
await writeFile('scripts/archive-m9-batter-hits-board.mjs', live);

let archiveTest = await readFile('test/m9-board-archive.test.mjs', 'utf8');
archiveTest = replaceOnce(
  archiveTest,
  `  buildM9ProspectiveBoardArchive,\n  createM9RawProviderSnapshot,`,
  `  buildM9ProspectiveBoardArchive,\n  createM9CaptureIdentity,\n  createM9RawProviderSnapshot,`,
  'archive test identity import',
);
archiveTest = replaceOnce(
  archiveTest,
  `function fixtureArchive() {\n  return buildM9ProspectiveBoardArchive({\n    archiveDate: '2026-07-23',\n    capturedAt: FIXED_CAPTURED_AT,\n    providerSnapshots,`,
  `function fixtureArchive(capturedAt = FIXED_CAPTURED_AT) {\n  return buildM9ProspectiveBoardArchive({\n    capturedAt,\n    captureSnapshotSha256: providerSnapshots[0].rawBody.sha256,\n    pregameEvents: [\n      Object.freeze({\n        eventId: evidence.board.offers[0].providerEventId,\n        commenceTimeUtc: evidence.board.offers[0].eventCommenceTime,\n        homeTeamName: evidence.board.offers[0].homeTeamName,\n        awayTeamName: evidence.board.offers[0].awayTeamName,\n      }),\n    ],\n    providerSnapshots,`,
  'fixture archive capture inputs',
);
archiveTest = replaceOnce(
  archiveTest,
  `test('re-archiving an existing date fails closed without overwriting even identical bytes', async () => {\n  const root = await mkdtemp(path.join(os.tmpdir(), 'm9-board-archive-'));\n  const filePath = m9ArchiveFilePath(root, '2026-07-23');\n  const archive = fixtureArchive();`,
  `test('re-writing an existing capture identity fails closed without overwriting even identical bytes', async () => {\n  const root = await mkdtemp(path.join(os.tmpdir(), 'm9-board-archive-'));\n  const archive = fixtureArchive();\n  const filePath = m9ArchiveFilePath(root, archive.captureIdentity);`,
  'archive immutability test identity',
);
archiveTest = archiveTest.replace(/rerun refused without overwrite/u, 'capture identity rewrite refused without overwrite');
archiveTest += String.raw`

test('two captures at different timestamps produce two distinct immutable records and neither overwrites the other', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'm9-board-captures-'));
  const firstArchive = fixtureArchive('2026-07-23T15:12:25.190Z');
  const secondArchive = fixtureArchive('2026-07-23T15:13:25.190Z');
  const firstPath = m9ArchiveFilePath(root, firstArchive.captureIdentity);
  const secondPath = m9ArchiveFilePath(root, secondArchive.captureIdentity);
  try {
    assert.notEqual(firstArchive.captureIdentity.captureKey, secondArchive.captureIdentity.captureKey);
    assert.notEqual(firstPath, secondPath);
    await persistImmutableM9BoardArchive({ filePath: firstPath, archive: firstArchive });
    await persistImmutableM9BoardArchive({ filePath: secondPath, archive: secondArchive });
    assert.deepEqual(JSON.parse(await readFile(firstPath, 'utf8')), firstArchive);
    assert.deepEqual(JSON.parse(await readFile(secondPath, 'utf8')), secondArchive);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('capture identity is exactly the capture timestamp plus the preserved raw provider snapshot SHA-256', () => {
  const archive = fixtureArchive();
  assert.deepEqual(
    archive.captureIdentity,
    createM9CaptureIdentity({
      capturedAt: FIXED_CAPTURED_AT,
      rawProviderSnapshotSha256: providerSnapshots[0].rawBody.sha256,
    }),
  );
  assert.equal(archive.pregameEvents.length, 1);
  assert.equal(archive.pregameEvents[0].eventId, evidence.board.offers[0].providerEventId);
  assert.equal(archive.pregameEvents[0].commenceTimeUtc, evidence.board.offers[0].eventCommenceTime);
});
`;
await writeFile('test/m9-board-archive.test.mjs', archiveTest);

const funnelTest = String.raw`import assert from 'node:assert/strict';
import { access, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import {
  createM9ArchiveFunnel,
  formatM9ArchiveFunnelReport,
  persistM9ArchiveForMode,
  selectM9PregameEventsForCapture,
} from '../scripts/m9-board-archive-funnel-utils.mjs';

const CAPTURED_AT = '2026-08-04T23:00:00.000Z';

function emptyFunnel(dryRun = false) {
  return createM9ArchiveFunnel({ captureTimestamp: CAPTURED_AT, dryRun });
}

function rawEvent({ id, commenceTime, sportKey = 'baseball_mlb' }) {
  return Object.freeze({
    id,
    sport_key: sportKey,
    commence_time: commenceTime,
    home_team: 'Home Club',
    away_team: 'Away Club',
  });
}

async function pathExists(filePath) {
  try { await access(filePath); return true; } catch (error) { if (error?.code === 'ENOENT') return false; throw error; }
}

test('a pregame event with a commence time on a later calendar date is included, not dropped', () => {
  const selection = selectM9PregameEventsForCapture({
    capturedAt: CAPTURED_AT,
    rawEvents: [rawEvent({ id: 'tomorrow', commenceTime: '2026-08-05T18:10:00Z' })],
  });
  assert.equal(selection.events.length, 1);
  assert.equal(selection.events[0].eventId, 'tomorrow');
  assert.equal(selection.events[0].commenceTimeUtc, '2026-08-05T18:10:00.000Z');
  assert.deepEqual(selection.drops, []);
});

test('an event whose commence time has passed is excluded as started', () => {
  const selection = selectM9PregameEventsForCapture({
    capturedAt: CAPTURED_AT,
    rawEvents: [rawEvent({ id: 'started', commenceTime: '2026-08-04T22:10:00Z' })],
  });
  assert.deepEqual(selection.events, []);
  assert.deepEqual(selection.drops, [{
    eventId: 'started',
    commenceTimeUtc: '2026-08-04T22:10:00.000Z',
    reason: 'game already in progress',
  }]);
});

test('the funnel report prints per-event drop detail on the failure path', () => {
  const funnel = emptyFunnel(true);
  funnel.add('providerEvents', { entered: 1, survived: 1 });
  funnel.add('pregameEvents', { entered: 1, survived: 0 });
  funnel.dropEvent('pregameEvents', {
    eventId: 'started',
    commenceTimeUtc: '2026-08-04T22:10:00Z',
    reason: 'game already in progress',
  });
  const output = formatM9ArchiveFunnelReport({ funnel, status: 'FAILED CLOSED' });
  assert.match(output, /STATUS: FAILED CLOSED/u);
  assert.match(output, /dropped: 1 \(game already in progress\)/u);
  assert.match(output, /event drop: started \| 2026-08-04T22:10:00.000Z \| game already in progress/u);
});

test('the funnel report prints on the success path', () => {
  const funnel = emptyFunnel(false);
  for (const key of ['providerEvents', 'pregameEvents']) funnel.add(key, { entered: 2, survived: 2 });
  for (const key of ['rawOffers', 'resolvedIdentityOffers', 'matchedGameOffers', 'lineupEvidenceOffers', 'verifiedStarterOffers', 'historyOffers']) funnel.add(key, { entered: 8, survived: 8 });
  funnel.add('composedCandidates', { entered: 8, survived: 8 });
  funnel.add('rankedCandidates', { entered: 8, survived: 8 });
  const output = formatM9ArchiveFunnelReport({ funnel, status: 'SUCCESS' });
  assert.match(output, /STATUS: SUCCESS/u);
  assert.match(output, /MODE: IMMUTABLE CAPTURE SNAPSHOT/u);
  assert.match(output, /CAPTURE TIMESTAMP: 2026-08-04T23:00:00.000Z/u);
  assert.match(output, /candidates ranked: entering 8 candidates; surviving 8; dropped 0/u);
});

test('--dry-run writes no archive file', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'm9-funnel-dry-run-'));
  const filePath = path.join(root, 'capture.json');
  let persistCalls = 0;
  try {
    const result = await persistM9ArchiveForMode({ dryRun: true, filePath, archive: Object.freeze({ archiveSha256: 'fixture' }), persist: async () => { persistCalls += 1; await writeFile(filePath, 'unexpected'); } });
    assert.equal(result, null);
    assert.equal(persistCalls, 0);
    assert.equal(await pathExists(filePath), false);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('--dry-run with an existing capture writes nothing and does not fail on immutability', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'm9-funnel-existing-'));
  const filePath = path.join(root, 'capture.json');
  const original = Buffer.from('{"immutable":true}\n');
  try {
    await writeFile(filePath, original);
    const result = await persistM9ArchiveForMode({ dryRun: true, filePath, archive: Object.freeze({ archiveSha256: 'different' }), persist: async () => { throw new Error('dry-run must never call persistence'); } });
    assert.equal(result, null);
    assert.deepEqual(await readFile(filePath), original);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('drop reasons are attributed to the correct stage', () => {
  const funnel = emptyFunnel(true);
  funnel.add('resolvedIdentityOffers', { entered: 4, survived: 0 });
  funnel.drop('resolvedIdentityOffers', 'zero matches', 3);
  funnel.drop('resolvedIdentityOffers', 'multiple matches', 1);
  const identity = funnel.snapshot().stages.find((stage) => stage.key === 'resolvedIdentityOffers');
  assert.deepEqual(identity.drops, [{ reason: 'multiple matches', count: 1 }, { reason: 'zero matches', count: 3 }]);
});

test('no secret value appears in any funnel output', () => {
  const secret = 'the-odds-secret-never-print';
  const funnel = emptyFunnel(true);
  funnel.add('providerEvents', { entered: 1, survived: 0 });
  funnel.drop('providerEvents', 'provider request failed closed', 1);
  const output = formatM9ArchiveFunnelReport({ funnel, status: 'FAILED CLOSED' });
  assert.doesNotMatch(output, new RegExp(secret, 'u'));
  assert.doesNotMatch(output, /apiKey=/u);
  assert.doesNotMatch(output, /Authorization:/u);
});

test('the live archive CLI wires capture identity, dry-run, and funnel output before either outcome', async () => {
  const source = await readFile('scripts/archive-m9-batter-hits-board.mjs', 'utf8');
  assert.match(source, /--dry-run/u);
  assert.match(source, /createM9CaptureIdentity/u);
  assert.match(source, /selectM9PregameEventsForCapture/u);
  assert.match(source, /funnel\.dropEvent\('pregameEvents'/u);
  assert.match(source, /persistM9ArchiveForMode/u);
  assert.match(source, /if \(!dryRun\) await assertArchiveAbsent/u);
  assert.match(source, /status: 'FAILED CLOSED'/u);
  assert.match(source, /printFunnel\('SUCCESS'\)/u);
});
`;
await writeFile('test/m9-board-archive-funnel.test.mjs', funnelTest);

let boundaryTest = await readFile('test/m9-board-archive-live-boundary.test.mjs', 'utf8');
boundaryTest = replaceOnce(
  boundaryTest,
  `const ARCHIVE_UTILS = 'scripts/m9-board-archive-utils.mjs';`,
  `const ARCHIVE_UTILS = 'scripts/m9-board-archive-utils.mjs';\nconst FUNNEL_UTILS = 'scripts/m9-board-archive-funnel-utils.mjs';`,
  'boundary funnel constant',
);
boundaryTest = replaceOnce(
  boundaryTest,
  `  checkSyntax(ARCHIVE_UTILS);\n  checkSyntax(LIVE_SCRIPT);`,
  `  checkSyntax(ARCHIVE_UTILS);\n  checkSyntax(FUNNEL_UTILS);\n  checkSyntax(LIVE_SCRIPT);`,
  'boundary syntax checks',
);
boundaryTest = replaceOnce(
  boundaryTest,
  `  const [source, packageText] = await Promise.all([\n    readFile(LIVE_SCRIPT, 'utf8'),\n    readFile('package.json', 'utf8'),\n  ]);`,
  `  const [source, archiveUtils, funnelUtils, packageText] = await Promise.all([\n    readFile(LIVE_SCRIPT, 'utf8'),\n    readFile(ARCHIVE_UTILS, 'utf8'),\n    readFile(FUNNEL_UTILS, 'utf8'),\n    readFile('package.json', 'utf8'),\n  ]);`,
  'boundary source reads',
);
boundaryTest = replaceOnce(
  boundaryTest,
  `  assert.match(source, /allowNonOk = false/u);`,
  `  const archivePathSource = \\`${'${source}'}\\n${'${archiveUtils}'}\\n${'${funnelUtils}'}\\`;\n  assert.doesNotMatch(archivePathSource, /America\\/Chicago|chicagoDate|ARCHIVE_TIME_ZONE|outside the requested Chicago archive date/u);\n  assert.match(source, /eventUtcDates/u);\n  assert.match(source, /createM9CaptureIdentity/u);\n  assert.match(source, /allowNonOk = false/u);`,
  'boundary timezone exclusion guard',
);
await writeFile('test/m9-board-archive-live-boundary.test.mjs', boundaryTest);

for (const filePath of [
  'scripts/archive-m9-batter-hits-board.mjs',
  'scripts/m9-board-archive-utils.mjs',
  'scripts/m9-board-archive-funnel-utils.mjs',
]) {
  const source = await readFile(filePath, 'utf8');
  for (const forbidden of ['America/Chicago', 'chicagoDate', 'ARCHIVE_TIME_ZONE', 'outside the requested Chicago archive date']) {
    if (source.includes(forbidden)) throw new Error(`${filePath} retains forbidden timezone token ${forbidden}.`);
  }
}
