import { createHash } from 'node:crypto';
import { link, mkdir, open, readFile, unlink } from 'node:fs/promises';
import path from 'node:path';

export const M9_BOARD_ARCHIVE_VERSION = 2;
export const M9_BOARD_ARCHIVE_CONTRACT =
  'm9-batter-hits-prospective-capture-snapshot-v2';
export const M9_BOARD_ARCHIVE_PROJECT_RULES_VERSION = '2.9';
export const M9_BOARD_ARCHIVE_MATH_SPEC_VERSION = '1.7';
export const M9_BOARD_ARCHIVE_AUTHORIZATION_MODE =
  'TEST ONLY — EPHEMERAL SNAPSHOT';

const SHA256_PATTERN = /^[a-f0-9]{64}$/u;
const CAPTURE_KEY_PATTERN = /^\d{8}T\d{9}Z--[a-f0-9]{64}$/u;

function object(value, label) {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new TypeError(`${label} must be an object.`);
  }
  return value;
}

function array(value, label) {
  if (!Array.isArray(value)) {
    throw new TypeError(`${label} must be an array.`);
  }
  return value;
}

function nonemptyString(value, label) {
  if (typeof value !== 'string' || value.length === 0) {
    throw new TypeError(`${label} must be a nonempty string.`);
  }
  return value;
}

function finiteNumber(value, label) {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new TypeError(`${label} must be a finite number.`);
  }
  return value;
}

function finiteNumberOrNull(value, label) {
  return value === null ? null : finiteNumber(value, label);
}

function stringOrNull(value, label) {
  return value === null ? null : nonemptyString(value, label);
}

function activeBoardSourceOrNull(value, label) {
  if (value === null) return null;
  if (value !== 'pick6' && value !== 'draftkings') {
    throw new TypeError(`${label} must be pick6, draftkings, or null.`);
  }
  return value;
}

function isoTimestamp(value, label) {
  const timestamp = nonemptyString(value, label);
  if (!Number.isFinite(Date.parse(timestamp))) {
    throw new TypeError(`${label} must be an ISO timestamp.`);
  }
  return timestamp;
}

export function createM9CaptureIdentity({
  capturedAt,
  rawProviderSnapshotSha256,
}) {
  const timestamp = new Date(
    isoTimestamp(capturedAt, 'captureIdentity.capturedAt'),
  ).toISOString();
  const snapshotSha256 = sha256Value(
    rawProviderSnapshotSha256,
    'captureIdentity.rawProviderSnapshotSha256',
  );
  const captureKey = `${timestamp.replace(/[-:.]/gu, '')}--${snapshotSha256}`;
  if (!CAPTURE_KEY_PATTERN.test(captureKey)) {
    throw new Error('Capture identity key failed canonical construction.');
  }
  return Object.freeze({
    capturedAt: timestamp,
    rawProviderSnapshotSha256: snapshotSha256,
    captureKey,
  });
}

function sha256Value(value, label) {
  const digest = nonemptyString(value, label);
  if (!SHA256_PATTERN.test(digest)) {
    throw new TypeError(`${label} must be a lowercase SHA-256 digest.`);
  }
  return digest;
}

export function sha256Bytes(value) {
  return createHash('sha256').update(value).digest('hex');
}

function stableJson(value) {
  if (
    value === null ||
    typeof value === 'boolean' ||
    typeof value === 'number' ||
    typeof value === 'string'
  ) {
    if (typeof value === 'number' && !Number.isFinite(value)) {
      throw new TypeError('Archive values must contain only finite numbers.');
    }
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map((entry) => stableJson(entry)).join(',')}]`;
  }
  if (typeof value === 'object') {
    return `{${Object.keys(value)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${stableJson(value[key])}`)
      .join(',')}}`;
  }
  throw new TypeError('Archive values must be JSON-compatible.');
}

function immutableJson(value, label) {
  try {
    return Object.freeze(JSON.parse(stableJson(value)));
  } catch (error) {
    throw new Error(
      `${label} must be JSON-compatible: ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
  }
}

function selectedHeaders(headers) {
  const source = object(headers ?? {}, 'response headers');
  return Object.freeze(
    Object.fromEntries(
      Object.entries(source)
        .filter(([, value]) => typeof value === 'string')
        .sort(([left], [right]) => left.localeCompare(right)),
    ),
  );
}

function parseJsonBytes(bytes, label) {
  if (bytes.length === 0) {
    throw new Error(`${label} returned an empty response body.`);
  }
  const text = bytes.toString('utf8');
  if (!Buffer.from(text, 'utf8').equals(bytes)) {
    throw new Error(`${label} response body must be valid UTF-8 JSON bytes.`);
  }
  try {
    return JSON.parse(text);
  } catch {
    throw new Error(`${label} returned malformed JSON.`);
  }
}

function providerRecordCount(parsedBody) {
  if (Array.isArray(parsedBody)) return parsedBody.length;
  if (parsedBody === null || typeof parsedBody !== 'object') return 0;
  if (Array.isArray(parsedBody.data)) return parsedBody.data.length;
  if (Array.isArray(parsedBody.bookmakers)) return parsedBody.bookmakers.length;
  return 1;
}

/**
 * Preserves exact provider response bytes. Parsed JSON exists only for audit
 * and validated downstream normalization; the byte payload and SHA-256 are
 * the authoritative snapshot identity.
 */
export function createM9RawProviderSnapshot({
  provider,
  label,
  capturedAt,
  request,
  response,
  rawBodyBytes,
  requireNonemptyRecords = false,
}) {
  const bytes = Buffer.isBuffer(rawBodyBytes)
    ? Buffer.from(rawBodyBytes)
    : Buffer.from(rawBodyBytes ?? '');
  const parsedBody = parseJsonBytes(bytes, label);
  if (requireNonemptyRecords && providerRecordCount(parsedBody) === 0) {
    throw new Error(`${label} returned no provider records.`);
  }

  const requestRecord = object(request, `${label} request`);
  const responseRecord = object(response, `${label} response`);
  return Object.freeze({
    provider: nonemptyString(provider, `${label} provider`),
    label: nonemptyString(label, `${label} label`),
    capturedAt: isoTimestamp(capturedAt, `${label} capturedAt`),
    request: Object.freeze({
      method: nonemptyString(requestRecord.method, `${label} request method`),
      origin: nonemptyString(requestRecord.origin, `${label} request origin`),
      pathname: nonemptyString(
        requestRecord.pathname,
        `${label} request pathname`,
      ),
      queryKeys: Object.freeze(
        [...array(requestRecord.queryKeys, `${label} request queryKeys`)]
          .map((entry, index) =>
            nonemptyString(entry, `${label} request queryKeys[${index}]`),
          )
          .sort(),
      ),
      headerNames: Object.freeze(
        [...array(requestRecord.headerNames, `${label} request headerNames`)]
          .map((entry, index) =>
            nonemptyString(entry, `${label} request headerNames[${index}]`),
          )
          .sort(),
      ),
    }),
    response: Object.freeze({
      status: finiteNumber(responseRecord.status, `${label} response status`),
      statusText:
        typeof responseRecord.statusText === 'string'
          ? responseRecord.statusText
          : '',
      headers: selectedHeaders(responseRecord.headers),
    }),
    rawBody: Object.freeze({
      encoding: 'base64',
      byteLength: bytes.length,
      sha256: sha256Bytes(bytes),
      base64: bytes.toString('base64'),
    }),
    parsedBody: immutableJson(parsedBody, `${label} parsed body`),
  });
}

function normalizedOfferRecord(offer) {
  const value = object(offer, 'normalized offer');
  return Object.freeze({
    provider: nonemptyString(value.provider, 'offer provider'),
    boardSource: activeBoardSourceOrNull(value.boardSource, 'offer boardSource'),
    providerBookmakerKey: nonemptyString(
      value.providerBookmakerKey,
      'offer providerBookmakerKey',
    ),
    providerRegion: nonemptyString(value.providerRegion, 'offer providerRegion'),
    settlementRuleVersion: stringOrNull(
      value.settlementRuleVersion,
      'offer settlementRuleVersion',
    ),
    providerEventId: nonemptyString(
      value.providerEventId,
      'offer providerEventId',
    ),
    providerGameId: finiteNumber(value.providerGameId, 'offer providerGameId'),
    providerPlayerId: finiteNumber(
      value.providerPlayerId,
      'offer providerPlayerId',
    ),
    providerTeamId: finiteNumber(value.providerTeamId, 'offer providerTeamId'),
    playerName: nonemptyString(value.playerName, 'offer playerName'),
    teamName: nonemptyString(value.teamName, 'offer teamName'),
    homeTeamName: nonemptyString(value.homeTeamName, 'offer homeTeamName'),
    awayTeamName: nonemptyString(value.awayTeamName, 'offer awayTeamName'),
    eventCommenceTime: isoTimestamp(
      value.eventCommenceTime,
      'offer eventCommenceTime',
    ),
    baseMarketKey: nonemptyString(value.baseMarketKey, 'offer baseMarketKey'),
    providerMarketKey: nonemptyString(
      value.providerMarketKey,
      'offer providerMarketKey',
    ),
    offerType: nonemptyString(value.offerType, 'offer offerType'),
    offerTypeReason: stringOrNull(value.offerTypeReason, 'offer offerTypeReason'),
    selectedSide: nonemptyString(value.selectedSide, 'offer selectedSide'),
    rawSide: nonemptyString(value.rawSide, 'offer rawSide'),
    postedLine: finiteNumber(value.line, 'offer postedLine'),
    americanPrice: finiteNumberOrNull(value.americanPrice, 'offer americanPrice'),
    multiplier: finiteNumberOrNull(value.multiplier, 'offer multiplier'),
    marketTimestamp: isoTimestamp(
      value.marketLastUpdate,
      'offer marketTimestamp',
    ),
    providerOutcomeSid: value.providerOutcomeSid,
    providerMarketSid: value.providerMarketSid,
    providerBookmakerSid: value.providerBookmakerSid,
    sourceCapturedAt: isoTimestamp(
      value.sourceCapturedAt,
      'offer sourceCapturedAt',
    ),
    sourceSnapshotSha256: sha256Value(
      value.sourceSnapshotSha256,
      'offer sourceSnapshotSha256',
    ),
    completeNormalizedOffer: immutableJson(value, 'complete normalized offer'),
  });
}

function sourceOfferKey(offer) {
  const value = object(offer, 'source normalized offer');
  return stableJson([
    value.boardSource ?? null,
    value.providerEventId,
    value.providerGameId,
    value.providerPlayerId,
    value.providerMarketKey,
    value.offerType,
    value.selectedSide,
    value.line,
  ]);
}

function archiveOfferKey(offer) {
  const value = object(offer, 'archive normalized offer');
  return stableJson([
    value.boardSource ?? null,
    value.providerEventId,
    value.providerGameId,
    value.providerPlayerId,
    value.providerMarketKey,
    value.offerType,
    value.selectedSide,
    value.postedLine,
  ]);
}

function candidateKey(candidate) {
  const value = object(candidate, 'candidate');
  const featureData = object(value.featureData, 'candidate featureData');
  const values = object(featureData.values, 'candidate featureData values');
  const detailEntries = Object.values(values);
  if (detailEntries.length !== 1) {
    throw new Error(
      'Batter Hits candidate feature data must contain exactly one details envelope.',
    );
  }
  const details = object(detailEntries[0], 'candidate Batter Hits details');
  return stableJson([
    value.eventId,
    Number(value.gameId),
    Number(value.playerId),
    details.providerMarketKey,
    details.offerType,
    value.selectedSide,
    value.line,
  ]);
}

function candidateDetails(candidate) {
  const featureData = object(candidate.featureData, 'candidate featureData');
  const values = object(featureData.values, 'candidate featureData values');
  const detailEntries = Object.values(values);
  if (detailEntries.length !== 1) {
    throw new Error(
      'Batter Hits candidate feature data must contain exactly one details envelope.',
    );
  }
  return object(detailEntries[0], 'candidate Batter Hits details');
}

function evaluationRecord(entry) {
  const value = object(entry, 'candidate evaluation');
  const offer = object(value.offer, 'candidate evaluation offer');
  const result = object(value.result, 'candidate evaluation result');
  const candidate = object(result.candidate, 'candidate evaluation candidate');
  const finalEvaluation = object(
    result.finalEvaluation,
    'candidate evaluation finalEvaluation',
  );
  const details = candidateDetails(candidate);

  if (
    result.productionEnabled !== false ||
    result.rankingEnabled !== false ||
    result.hardDiscoveryFilterEnabled !== false
  ) {
    throw new Error(
      'Archive input must remain production, ranking, and hard-discovery disabled.',
    );
  }
  if (
    candidate.eventId !== offer.providerEventId ||
    Number(candidate.gameId) !== offer.providerGameId ||
    Number(candidate.playerId) !== offer.providerPlayerId ||
    candidate.selectedSide !== offer.selectedSide ||
    candidate.line !== offer.line
  ) {
    throw new Error(
      'Candidate identity must preserve the exact normalized offer side and line.',
    );
  }
  if (
    candidate.pWin !== finalEvaluation.probabilities?.pWin ||
    candidate.pLoss !== finalEvaluation.probabilities?.pLoss ||
    candidate.pVoid !== finalEvaluation.probabilities?.pVoid ||
    candidate.pWinGivenGrades !== finalEvaluation.probabilities?.pFinal ||
    details.pBase !== finalEvaluation.probabilities?.pBase ||
    details.contextProbabilityDelta !==
      finalEvaluation.probabilities?.contextProbabilityDelta
  ) {
    throw new Error(
      'Archive input candidate probabilities must equal the existing final evaluation exactly.',
    );
  }

  return Object.freeze({
    key: candidateKey(candidate),
    offerKey: sourceOfferKey(offer),
    normalizedOffer: normalizedOfferRecord(offer),
    candidate,
    result,
    details,
  });
}

function rankedRow(record, rank) {
  const candidate = record.candidate;
  const details = record.details;
  return Object.freeze({
    rank,
    normalizedOffer: record.normalizedOffer,
    probabilities: Object.freeze({
      pWin: candidate.pWin,
      pLoss: candidate.pLoss,
      pVoid: candidate.pVoid,
      pWinGivenGrades: candidate.pWinGivenGrades,
    }),
    diagnosticOnly: Object.freeze({
      label: 'DIAGNOSTIC ONLY',
      pBase: details.pBase,
      contextProbabilityDelta: details.contextProbabilityDelta,
    }),
    lineage: Object.freeze({
      baseDistributionSha256: details.baseDistributionSha256,
      finalDistributionSha256: details.finalDistributionSha256,
      finalEvaluationSha256: details.finalEvaluationSha256,
      contextModelVersion: details.contextModelVersion,
      modelVersion: candidate.modelVersion,
      distributionBuilderVersion: candidate.distributionBuilderVersion,
      settlementRuleVersion: candidate.settlementRuleVersion,
      lineupStatus: details.lineupStatus,
      lineupSourceSnapshotSha256: details.lineupSourceSnapshotSha256,
      factorDispositions: immutableJson(
        details.factorDispositions,
        'factor dispositions',
      ),
      runtimeFactorReferences: immutableJson(
        details.runtimeFactorReferences,
        'runtime factor references',
      ),
    }),
    candidate: immutableJson(candidate, 'candidate'),
    baseEvaluation: immutableJson(record.result.baseEvaluation, 'baseEvaluation'),
    finalEvaluation: immutableJson(
      record.result.finalEvaluation,
      'finalEvaluation',
    ),
    distribution: immutableJson(record.result.distribution, 'distribution'),
  });
}

function sortOffers(offers) {
  return Object.freeze(
    [...offers]
      .map(normalizedOfferRecord)
      .sort((left, right) =>
        archiveOfferKey(left).localeCompare(archiveOfferKey(right)),
      ),
  );
}

function sortSnapshots(snapshots) {
  return Object.freeze(
    [...snapshots]
      .map((snapshot) => immutableJson(snapshot, 'provider snapshot'))
      .sort(
        (left, right) =>
          String(left.capturedAt).localeCompare(String(right.capturedAt)) ||
          String(left.label).localeCompare(String(right.label)),
      ),
  );
}

function pregameEventRecord(event) {
  const value = object(event, 'pregame event');
  return Object.freeze({
    eventId: nonemptyString(value.eventId, 'pregame event eventId'),
    commenceTimeUtc: isoTimestamp(
      value.commenceTimeUtc,
      'pregame event commenceTimeUtc',
    ),
    homeTeamName: nonemptyString(
      value.homeTeamName,
      'pregame event homeTeamName',
    ),
    awayTeamName: nonemptyString(
      value.awayTeamName,
      'pregame event awayTeamName',
    ),
  });
}

/**
 * Copies existing normalization, composition, final-evaluation, and ranking
 * outputs into one immutable record. This layer owns no probability,
 * settlement, model, or ranking calculation.
 */
export function buildM9ProspectiveBoardArchive({
  capturedAt,
  captureSnapshotSha256,
  pregameEvents,
  providerSnapshots,
  normalizedOffers,
  candidateEvaluations,
  ranking,
  exclusions = [],
  evidence = {},
}) {
  const captureIdentity = createM9CaptureIdentity({
    capturedAt,
    rawProviderSnapshotSha256: captureSnapshotSha256,
  });
  const timestamp = captureIdentity.capturedAt;
  const snapshots = sortSnapshots(
    array(providerSnapshots, 'providerSnapshots'),
  );
  if (snapshots.length === 0) {
    throw new Error('A prospective archive requires provider snapshots.');
  }
  if (
    !snapshots.some(
      (snapshot) =>
        snapshot.rawBody?.sha256 ===
        captureIdentity.rawProviderSnapshotSha256,
    )
  ) {
    throw new Error(
      'Capture identity SHA-256 must reference one preserved raw provider snapshot.',
    );
  }
  const events = Object.freeze(
    [...array(pregameEvents, 'pregameEvents')]
      .map(pregameEventRecord)
      .sort(
        (left, right) =>
          left.commenceTimeUtc.localeCompare(right.commenceTimeUtc) ||
          left.eventId.localeCompare(right.eventId),
      ),
  );
  if (events.length === 0) {
    throw new Error('A prospective archive requires at least one pregame event.');
  }
  const sourceOffers = array(normalizedOffers, 'normalizedOffers');
  const offers = sortOffers(sourceOffers);
  if (offers.length === 0) {
    throw new Error('A prospective archive requires normalized offers.');
  }

  const evaluations = array(
    candidateEvaluations,
    'candidateEvaluations',
  ).map(evaluationRecord);
  const byCandidate = new Map();
  for (const evaluation of evaluations) {
    if (byCandidate.has(evaluation.key)) {
      throw new Error(`Duplicate candidate evaluation ${evaluation.key}.`);
    }
    byCandidate.set(evaluation.key, evaluation);
  }

  const rankingValue = object(ranking, 'ranking');
  const rankedCandidates = array(
    rankingValue.rankedCandidates,
    'ranking.rankedCandidates',
  );
  if (
    Array.isArray(rankingValue.excludedCandidates) &&
    rankingValue.excludedCandidates.length !== 0
  ) {
    throw new Error(
      'Every composed archive candidate must survive the existing ranking adapter.',
    );
  }
  if (rankedCandidates.length !== evaluations.length) {
    throw new Error(
      'Ranked candidate count must equal composed candidate evaluation count.',
    );
  }

  const rankedRows = Object.freeze(
    rankedCandidates.map((candidate, index) => {
      const key = candidateKey(candidate);
      const evaluation = byCandidate.get(key);
      if (evaluation === undefined) {
        throw new Error(`Ranking contains unknown candidate ${key}.`);
      }
      if (evaluation.candidate !== candidate) {
        throw new Error(
          'Ranking must preserve the exact immutable candidate object from composition.',
        );
      }
      return rankedRow(evaluation, index + 1);
    }),
  );

  const normalizedOfferKeys = new Set(sourceOffers.map(sourceOfferKey));
  for (const evaluation of evaluations) {
    if (!normalizedOfferKeys.has(evaluation.offerKey)) {
      throw new Error(
        'Every candidate evaluation must correspond to one preserved normalized offer.',
      );
    }
  }

  const exclusionRecords = array(exclusions, 'exclusions');
  const evidenceRecord = immutableJson(evidence, 'archive evidence');
  const identity = Object.freeze({
    archiveVersion: M9_BOARD_ARCHIVE_VERSION,
    archiveContract: M9_BOARD_ARCHIVE_CONTRACT,
    captureIdentity,
    capturedAt: timestamp,
    captureDateUtc: timestamp.slice(0, 10),
    projectRulesVersion: M9_BOARD_ARCHIVE_PROJECT_RULES_VERSION,
    mathSpecVersion: M9_BOARD_ARCHIVE_MATH_SPEC_VERSION,
    productionEnabled: false,
    productionRankingEnabled: false,
    gradingPerformed: false,
    fixtureBackedEvidence: evidenceRecord.fixtureBackedEvidence === true,
    liveBoard: evidenceRecord.liveBoard === true,
    authorizationMode: M9_BOARD_ARCHIVE_AUTHORIZATION_MODE,
    notice:
      'Production ranking is DISABLED. Ranked order is preserved through a test-only ephemeral registry snapshot.',
    providerSnapshots: snapshots,
    pregameEvents: events,
    normalizedOffers: offers,
    rankedRows,
    exclusions: Object.freeze(
      [...exclusionRecords]
        .map((entry) => immutableJson(entry, 'exclusion'))
        .sort((left, right) => stableJson(left).localeCompare(stableJson(right))),
    ),
    evidence: evidenceRecord,
    counts: Object.freeze({
      providerSnapshotCount: snapshots.length,
      normalizedOfferCount: offers.length,
      composedCandidateCount: evaluations.length,
      rankedCandidateCount: rankedRows.length,
      exclusionCount: exclusionRecords.length,
    }),
  });
  return Object.freeze({
    ...identity,
    archiveSha256: sha256Bytes(stableJson(identity)),
  });
}

export function m9ArchiveFilePath(rootDirectory, captureIdentityInput) {
  const identity = object(captureIdentityInput, 'captureIdentity');
  const captureKey = nonemptyString(identity.captureKey, 'captureIdentity.captureKey');
  if (!CAPTURE_KEY_PATTERN.test(captureKey)) {
    throw new TypeError('captureIdentity.captureKey is not canonical.');
  }
  return path.join(rootDirectory, 'captures', `${captureKey}.json`);
}

/**
 * Publishes through an exclusive hard link. The final path is created
 * atomically and can never replace an existing capture identity, even when the
 * proposed bytes are identical.
 */
export async function persistImmutableM9BoardArchive({ filePath, archive }) {
  const target = nonemptyString(filePath, 'filePath');
  const bytes = `${JSON.stringify(archive, null, 2)}\n`;
  await mkdir(path.dirname(target), { recursive: true });
  const temporaryPath = `${target}.tmp-${process.pid}-${Date.now()}`;
  const handle = await open(temporaryPath, 'wx');
  try {
    await handle.writeFile(bytes, 'utf8');
  } finally {
    await handle.close();
  }

  try {
    await link(temporaryPath, target);
  } catch (error) {
    if (error?.code === 'EEXIST') {
      throw new Error(
        `Immutable board capture already exists; capture identity rewrite refused without overwrite: ${target}`,
      );
    }
    throw error;
  } finally {
    await unlink(temporaryPath).catch((error) => {
      if (error?.code !== 'ENOENT') throw error;
    });
  }

  const persisted = await readFile(target, 'utf8');
  if (persisted !== bytes) {
    throw new Error(`Persisted archive bytes failed exact verification: ${target}`);
  }
  return Object.freeze({
    filePath: target,
    byteLength: Buffer.byteLength(bytes),
    fileSha256: sha256Bytes(bytes),
    archiveSha256: sha256Value(archive.archiveSha256, 'archiveSha256'),
  });
}
