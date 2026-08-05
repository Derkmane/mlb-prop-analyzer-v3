const FUNNEL_STAGE_DEFINITIONS = Object.freeze([
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
    throw new TypeError(\`\${label} must be an object.\`);
  }
  return value;
}

function array(value, label) {
  if (!Array.isArray(value)) throw new TypeError(\`\${label} must be an array.\`);
  return value;
}

function nonnegativeInteger(value, label) {
  if (!Number.isSafeInteger(value) || value < 0) throw new TypeError(\`\${label} must be a nonnegative integer.\`);
  return value;
}

function nonemptyString(value, label) {
  if (typeof value !== 'string' || value.trim().length === 0) throw new TypeError(\`\${label} must be a nonempty string.\`);
  return value.trim();
}

function isoTimestamp(value, label) {
  const timestamp = nonemptyString(value, label);
  const milliseconds = Date.parse(timestamp);
  if (!Number.isFinite(milliseconds)) throw new TypeError(\`\${label} must be an ISO timestamp.\`);
  return new Date(milliseconds).toISOString();
}

function exactName(value, label) {
  return nonemptyString(value, label).replace(/\s+/gu, ' ');
}

function stageDefinition(stageKey) {
  const definition = STAGE_BY_KEY.get(stageKey);
  if (definition === undefined) throw new Error(\`Unknown M9 archive funnel stage: \${String(stageKey)}\`);
  return definition;
}

export function selectM9PregameEventsForCapture({ rawEvents, capturedAt }) {
  const rows = array(rawEvents, 'The Odds API events');
  const captureTimestamp = isoTimestamp(capturedAt, 'capturedAt');
  const capturedMilliseconds = Date.parse(captureTimestamp);
  const events = [];
  const drops = [];

  rows.forEach((raw, index) => {
    const event = object(raw, \`events[\${index}]\`);
    const eventId = nonemptyString(event.id, \`events[\${index}].id\`);
    const sportKey = nonemptyString(event.sport_key, \`events[\${index}].sport_key\`);
    const commenceTimeUtc = isoTimestamp(event.commence_time, \`events[\${index}].commence_time\`);
    const normalized = Object.freeze({
      id: eventId,
      eventId,
      sportKey,
      commenceTime: commenceTimeUtc,
      commenceTimeUtc,
      homeTeamName: exactName(event.home_team, \`events[\${index}].home_team\`),
      awayTeamName: exactName(event.away_team, \`events[\${index}].away_team\`),
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
    stage.entered += nonnegativeInteger(entered, \`\${stageKey}.entered\`);
    stage.survived += nonnegativeInteger(survived, \`\${stageKey}.survived\`);
    if (stage.survived > stage.entered) throw new Error(\`\${stageKey} surviving count cannot exceed its entering count.\`);
  }

  function drop(stageKey, reason, count = 1) {
    stageDefinition(stageKey);
    const stage = state.get(stageKey);
    const key = nonemptyString(reason, \`\${stageKey}.dropReason\`);
    const amount = nonnegativeInteger(count, \`\${stageKey}.dropCount\`);
    stage.drops.set(key, (stage.drops.get(key) ?? 0) + amount);
  }

  function dropEvent(stageKey, { eventId, commenceTimeUtc, reason }) {
    stageDefinition(stageKey);
    const detail = Object.freeze({
      stageKey,
      eventId: nonemptyString(eventId, \`\${stageKey}.eventId\`),
      commenceTimeUtc: isoTimestamp(commenceTimeUtc, \`\${stageKey}.commenceTimeUtc\`),
      reason: nonemptyString(reason, \`\${stageKey}.eventDropReason\`),
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
      if (attributedDropCount > actualDropCount) throw new Error(\`\${definition.key} attributes more drops than entered minus survived.\`);
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
    \`MODE: \${snapshot.dryRun ? 'DRY RUN — NO ARCHIVE WRITE' : 'IMMUTABLE CAPTURE SNAPSHOT'}\`,
    \`STATUS: \${normalizedStatus}\`,
    \`CAPTURE TIMESTAMP: \${snapshot.captureTimestamp}\`,
  ];
  for (const stage of snapshot.stages) {
    lines.push(\`\${stage.label}: entering \${stage.entered} \${stage.unit}; surviving \${stage.survived}; dropped \${stage.dropped}\`);
    for (const drop of stage.drops) lines.push(\`  dropped: \${drop.count} (\${drop.reason})\`);
    for (const detail of snapshot.eventDrops.filter((entry) => entry.stageKey === stage.key)) {
      lines.push(\`  event drop: \${detail.eventId} | \${detail.commenceTimeUtc} | \${detail.reason}\`);
    }
  }
  lines.push('');
  return \`\${lines.join('\n')}\n\`;
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
