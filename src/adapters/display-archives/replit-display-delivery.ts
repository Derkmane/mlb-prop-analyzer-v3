import { createHash, randomUUID } from 'node:crypto';
import { access, mkdir, rename, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';

import {
  RESEARCH_BATTER_HHR_MARKET,
  RESEARCH_BATTER_HITS_MARKET,
  type ResearchDisplayMarket,
} from '../../application/research-display-archive.js';
import { HHR_DISPLAY_ARCHIVE_ROOT } from './hhr-display-archive-repository.js';

export const DISPLAY_DELIVERY_BUNDLE_VERSION = 1 as const;
export const REPLIT_DISPLAY_BUNDLE_OBJECT =
  'mlb-prop-analyzer-v3/display/current-board-v1.json' as const;
/** Deployment value: player-analytics-display. Unset keeps the SDK default-bucket path. */
export const REPLIT_DISPLAY_BUCKET_ID_ENV = 'REPLIT_DISPLAY_BUCKET_ID' as const;

export type DisplayDeliveryMarket = ResearchDisplayMarket;

export interface DisplayDeliveryArchiveV1 {
  readonly market: DisplayDeliveryMarket;
  readonly filename: string;
  readonly sha256: string;
  readonly bytesBase64: string;
}

export interface DisplayDeliverySupplementalFileV1 {
  readonly filename: string;
  readonly sha256: string;
  readonly bytesBase64: string;
}

export interface DisplayDeliveryBundleV1 {
  readonly deliveryVersion: typeof DISPLAY_DELIVERY_BUNDLE_VERSION;
  readonly displayDateUtc: string;
  readonly capturedAt: string;
  readonly archives: readonly DisplayDeliveryArchiveV1[];
  readonly categoryPerformance: DisplayDeliverySupplementalFileV1 | null;
}

export type TextObjectStoreResult<T> =
  | Readonly<{ ok: true; value: T }>
  | Readonly<{ ok: false; error: unknown }>;

export interface TextObjectStore {
  downloadAsText(objectName: string): Promise<TextObjectStoreResult<string>>;
  uploadFromText(objectName: string, contents: string): Promise<TextObjectStoreResult<null>>;
}

export interface DisplayDeliveryService {
  refreshFromStore(): Promise<DisplayDeliveryBundleV1>;
  deliver(bundle: unknown): Promise<DisplayDeliveryBundleV1>;
}

export class DisplayStoreUnavailableError extends Error {
  constructor(message: string, options: ErrorOptions = {}) {
    super(message, options);
    this.name = 'DisplayStoreUnavailableError';
  }
}

export class InvalidDisplayDeliveryBundleError extends Error {
  constructor(message: string, options: ErrorOptions = {}) {
    super(message, options);
    this.name = 'InvalidDisplayDeliveryBundleError';
  }
}

const HHR_DISPLAY_ARCHIVE_DIRECTORY = path.basename(path.dirname(HHR_DISPLAY_ARCHIVE_ROOT));
const CAPTURE_FILE = /^(\d{8}T\d{9}Z)--[a-f0-9]{64}\.json$/u;
const CATEGORY_PERFORMANCE_FILE = /^product-category-performance-v1--([a-f0-9]{64})\.json$/u;
const SHA256 = /^[a-f0-9]{64}$/u;
const BASE64 = /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/u;
const UTC_DATE = /^\d{4}-\d{2}-\d{2}$/u;

function persistedIdentityForMarket(market: DisplayDeliveryMarket): string {
  return market === RESEARCH_BATTER_HHR_MARKET ? HHR_DISPLAY_ARCHIVE_DIRECTORY : market;
}

function objectRecord(value: unknown, label: string): Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new InvalidDisplayDeliveryBundleError(`${label} must be an object.`);
  }
  return value as Record<string, unknown>;
}

function nonemptyString(value: unknown, label: string): string {
  if (typeof value !== 'string' || value.length === 0) {
    throw new InvalidDisplayDeliveryBundleError(`${label} must be a nonempty string.`);
  }
  return value;
}

function capturedAtIdentity(capturedAt: string): string {
  return capturedAt.replaceAll('-', '').replaceAll(':', '').replace('.', '');
}

function filenameDateUtc(filename: string): string {
  return `${filename.slice(0, 4)}-${filename.slice(4, 6)}-${filename.slice(6, 8)}`;
}

function decodeVerifiedBytes(
  source: Record<string, unknown>,
  label: string,
): Readonly<{ sha256: string; bytesBase64: string; bytes: Buffer }> {
  const sha256 = nonemptyString(source['sha256'], `${label}.sha256`);
  if (!SHA256.test(sha256)) {
    throw new InvalidDisplayDeliveryBundleError(`${label}.sha256 is invalid.`);
  }
  const bytesBase64 = nonemptyString(source['bytesBase64'], `${label}.bytesBase64`);
  if (!BASE64.test(bytesBase64)) {
    throw new InvalidDisplayDeliveryBundleError(`${label}.bytesBase64 is invalid.`);
  }
  const bytes = Buffer.from(bytesBase64, 'base64');
  if (bytes.toString('base64') !== bytesBase64) {
    throw new InvalidDisplayDeliveryBundleError(`${label}.bytesBase64 is not canonical.`);
  }
  const digest = createHash('sha256').update(bytes).digest('hex');
  if (digest !== sha256) {
    throw new InvalidDisplayDeliveryBundleError(`${label} SHA-256 mismatch.`);
  }
  return Object.freeze({ sha256, bytesBase64, bytes });
}

function parseJsonBytes(bytes: Buffer, label: string): Record<string, unknown> {
  try {
    return objectRecord(JSON.parse(bytes.toString('utf8')) as unknown, label);
  } catch (error) {
    if (error instanceof InvalidDisplayDeliveryBundleError) throw error;
    throw new InvalidDisplayDeliveryBundleError(`${label} is not valid JSON.`, { cause: error });
  }
}

function parseArchiveEnvelope(
  raw: unknown,
  index: number,
  displayDateUtc: string,
): Readonly<{
  envelope: DisplayDeliveryArchiveV1;
  capturedAt: string;
  capturePrefix: string;
}> {
  const label = `archives[${index}]`;
  const source = objectRecord(raw, label);
  const marketValue = source['market'];
  if (marketValue !== RESEARCH_BATTER_HITS_MARKET && marketValue !== RESEARCH_BATTER_HHR_MARKET) {
    throw new InvalidDisplayDeliveryBundleError(`${label}.market is unsupported.`);
  }
  const market: DisplayDeliveryMarket = marketValue;
  const filename = nonemptyString(source['filename'], `${label}.filename`);
  const match = CAPTURE_FILE.exec(filename);
  if (match === null || filenameDateUtc(filename) !== displayDateUtc) {
    throw new InvalidDisplayDeliveryBundleError(`${label}.filename is outside the bundle display date.`);
  }
  const verified = decodeVerifiedBytes(source, label);
  const archive = parseJsonBytes(verified.bytes, `${label} display archive`);
  if (
    archive['displayArchiveVersion'] !== 1 ||
    archive['displayArchiveContract'] !== 'phase1-trimmed-board-display-v1' ||
    archive['market'] !== persistedIdentityForMarket(market) ||
    archive['productionEnabled'] !== false ||
    archive['productionRankingEnabled'] !== false
  ) {
    throw new InvalidDisplayDeliveryBundleError(`${label} display archive contract is invalid.`);
  }
  const capturedAt = nonemptyString(archive['capturedAt'], `${label} capturedAt`);
  if (!Number.isFinite(Date.parse(capturedAt)) || capturedAtIdentity(capturedAt) !== match[1]) {
    throw new InvalidDisplayDeliveryBundleError(`${label} capturedAt does not match its filename.`);
  }
  if (archive['captureDateUtc'] !== displayDateUtc) {
    throw new InvalidDisplayDeliveryBundleError(`${label} captureDateUtc does not match the bundle date.`);
  }
  const captureKey = nonemptyString(archive['captureKey'], `${label} captureKey`);
  if (captureKey !== filename.slice(0, -'.json'.length)) {
    throw new InvalidDisplayDeliveryBundleError(`${label} captureKey does not match filename.`);
  }
  if (!Array.isArray(archive['rows']) || archive['rows'].length === 0) {
    throw new InvalidDisplayDeliveryBundleError(`${label} rows must be nonempty.`);
  }
  return Object.freeze({
    envelope: Object.freeze({
      market,
      filename,
      sha256: verified.sha256,
      bytesBase64: verified.bytesBase64,
    }),
    capturedAt,
    capturePrefix: match[1],
  });
}

function parseCategoryPerformance(raw: unknown): DisplayDeliverySupplementalFileV1 {
  const label = 'categoryPerformance';
  const source = objectRecord(raw, label);
  const filename = nonemptyString(source['filename'], `${label}.filename`);
  const match = CATEGORY_PERFORMANCE_FILE.exec(filename);
  if (match === null) {
    throw new InvalidDisplayDeliveryBundleError('categoryPerformance filename is invalid.');
  }
  const verified = decodeVerifiedBytes(source, label);
  const report = parseJsonBytes(verified.bytes, 'categoryPerformance report');
  if (
    report['reportVersion'] !== 1 ||
    report['reportType'] !== 'product-category-performance-v1' ||
    report['sourceSetSha256'] !== match[1]
  ) {
    throw new InvalidDisplayDeliveryBundleError('categoryPerformance report identity is invalid.');
  }
  if (typeof report['generatedAt'] !== 'string' || !Number.isFinite(Date.parse(report['generatedAt']))) {
    throw new InvalidDisplayDeliveryBundleError('categoryPerformance generatedAt is invalid.');
  }
  const safety = objectRecord(report['safety'], 'categoryPerformance safety');
  if (
    safety['evidenceOnly'] !== true ||
    safety['archivesModified'] !== false ||
    safety['probabilitiesModified'] !== false ||
    safety['rankingModified'] !== false
  ) {
    throw new InvalidDisplayDeliveryBundleError('categoryPerformance safety boundary drifted.');
  }
  return Object.freeze({
    filename,
    sha256: verified.sha256,
    bytesBase64: verified.bytesBase64,
  });
}

export function validateDisplayDeliveryBundle(value: unknown): DisplayDeliveryBundleV1 {
  const source = objectRecord(value, 'display delivery bundle');
  if (source['deliveryVersion'] !== DISPLAY_DELIVERY_BUNDLE_VERSION) {
    throw new InvalidDisplayDeliveryBundleError('display delivery bundle version is unsupported.');
  }
  const displayDateUtc = nonemptyString(source['displayDateUtc'], 'display delivery displayDateUtc');
  if (
    !UTC_DATE.test(displayDateUtc) ||
    new Date(`${displayDateUtc}T00:00:00.000Z`).toISOString().slice(0, 10) !== displayDateUtc
  ) {
    throw new InvalidDisplayDeliveryBundleError('display delivery displayDateUtc is invalid.');
  }
  const capturedAt = nonemptyString(source['capturedAt'], 'display delivery capturedAt');
  if (!Number.isFinite(Date.parse(capturedAt))) {
    throw new InvalidDisplayDeliveryBundleError('display delivery capturedAt must be an ISO timestamp.');
  }
  const rawArchives = source['archives'];
  if (!Array.isArray(rawArchives) || rawArchives.length < 2) {
    throw new InvalidDisplayDeliveryBundleError('display delivery bundle must contain both market archives.');
  }
  const parsed = rawArchives.map((archive, index) =>
    parseArchiveEnvelope(archive, index, displayDateUtc));
  const identities = new Set<string>();
  const timestampsByMarket = new Map<DisplayDeliveryMarket, Set<string>>([
    [RESEARCH_BATTER_HITS_MARKET, new Set<string>()],
    [RESEARCH_BATTER_HHR_MARKET, new Set<string>()],
  ]);
  for (const candidate of parsed) {
    const identity = `${candidate.envelope.market}:${candidate.envelope.filename}`;
    if (identities.has(identity)) {
      throw new InvalidDisplayDeliveryBundleError(`duplicate display archive identity: ${identity}.`);
    }
    identities.add(identity);
    const timestamps = timestampsByMarket.get(candidate.envelope.market)!;
    if (timestamps.has(candidate.capturePrefix)) {
      throw new InvalidDisplayDeliveryBundleError(
        `duplicate ${candidate.envelope.market} capture timestamp: ${candidate.capturePrefix}.`,
      );
    }
    timestamps.add(candidate.capturePrefix);
  }
  const byMarket = (market: DisplayDeliveryMarket) =>
    parsed.filter((candidate) => candidate.envelope.market === market)
      .sort((left, right) => left.capturePrefix.localeCompare(right.capturePrefix));
  const hits = byMarket(RESEARCH_BATTER_HITS_MARKET);
  const hhr = byMarket(RESEARCH_BATTER_HHR_MARKET);
  if (hits.length === 0 || hhr.length === 0) {
    throw new InvalidDisplayDeliveryBundleError('display delivery bundle must contain both markets.');
  }
  const newestHits = hits.at(-1)!;
  const newestHhr = hhr.at(-1)!;
  if (
    newestHits.capturePrefix !== newestHhr.capturePrefix ||
    newestHits.capturedAt !== capturedAt ||
    newestHhr.capturedAt !== capturedAt
  ) {
    throw new InvalidDisplayDeliveryBundleError(
      'newest Batter Hits and HHR display captures must share the bundle capturedAt.',
    );
  }
  const categoryPerformance = source['categoryPerformance'] === null
    ? null
    : parseCategoryPerformance(source['categoryPerformance']);
  return Object.freeze({
    deliveryVersion: DISPLAY_DELIVERY_BUNDLE_VERSION,
    displayDateUtc,
    capturedAt,
    archives: Object.freeze(parsed.map((candidate) => candidate.envelope)),
    categoryPerformance,
  });
}

function serializeBundle(bundle: DisplayDeliveryBundleV1): string {
  return JSON.stringify(bundle);
}

function parseStoredBundle(text: string): DisplayDeliveryBundleV1 {
  let value: unknown;
  try {
    value = JSON.parse(text) as unknown;
  } catch (error) {
    throw new InvalidDisplayDeliveryBundleError('stored display delivery bundle is not valid JSON.', {
      cause: error,
    });
  }
  return validateDisplayDeliveryBundle(value);
}

async function exists(filePath: string): Promise<boolean> {
  try {
    await access(filePath);
    return true;
  } catch {
    return false;
  }
}

async function materializeBundle(
  bundle: DisplayDeliveryBundleV1,
  rootDirectory: string,
): Promise<void> {
  const targets = bundle.archives.map((archive) => Object.freeze({
    bytesBase64: archive.bytesBase64,
    directory: path.join(rootDirectory, persistedIdentityForMarket(archive.market), 'captures'),
    filename: archive.filename,
  }));
  if (bundle.categoryPerformance !== null) {
    targets.push(Object.freeze({
      bytesBase64: bundle.categoryPerformance.bytesBase64,
      directory: path.join(rootDirectory, 'category-performance'),
      filename: bundle.categoryPerformance.filename,
    }));
  }
  const materializationTargets = targets.map((target) => Object.freeze({
    ...target,
    finalPath: path.join(target.directory, target.filename),
    tempPath: path.join(target.directory, `.${target.filename}.${process.pid}.${randomUUID()}.tmp`),
  }));
  if ((await Promise.all(materializationTargets.map((target) => exists(target.finalPath)))).every(Boolean)) return;

  await Promise.all(materializationTargets.map(async (target) => {
    await mkdir(target.directory, { recursive: true });
    await writeFile(target.tempPath, Buffer.from(target.bytesBase64, 'base64'), { flag: 'wx' });
  }));
  const renamed: string[] = [];
  try {
    for (const target of materializationTargets) {
      await rename(target.tempPath, target.finalPath);
      renamed.push(target.finalPath);
    }
  } catch (error) {
    await Promise.all(renamed.map((filePath) => rm(filePath, { force: true })));
    throw error;
  } finally {
    await Promise.all(materializationTargets.map((target) => rm(target.tempPath, { force: true })));
  }
}

interface ReplitObjectStorageClient {
  downloadAsText(objectName: string): Promise<unknown>;
  uploadFromText(objectName: string, contents: string): Promise<unknown>;
}

export type ReplitObjectStorageClientConstructor = new (
  options?: Readonly<{ bucketId?: string }>,
) => ReplitObjectStorageClient;

function normalizeSdkResult<T>(value: unknown, operation: string): TextObjectStoreResult<T> {
  if (value === null || typeof value !== 'object') {
    return Object.freeze({ ok: false, error: new Error(`${operation} returned a malformed result.`) });
  }
  const result = value as Record<string, unknown>;
  if (result['ok'] === true) {
    return Object.freeze({ ok: true, value: result['value'] as T });
  }
  return Object.freeze({ ok: false, error: result['error'] });
}

let defaultStorePromise: Promise<TextObjectStore> | undefined;

export function createReplitSdkTextObjectStore(
  Client: ReplitObjectStorageClientConstructor,
  bucketId: string | undefined,
): TextObjectStore {
  const usesExplicitBucket = bucketId !== undefined && bucketId.length > 0;
  const resolutionPath = usesExplicitBucket
    ? `${REPLIT_DISPLAY_BUCKET_ID_ENV} explicit-bucket path`
    : 'SDK default-bucket path';
  let client: ReplitObjectStorageClient;
  try {
    client = usesExplicitBucket ? new Client({ bucketId }) : new Client();
  } catch (error) {
    throw new DisplayStoreUnavailableError(
      `Replit App Storage client initialization failed using the ${resolutionPath}.`,
      { cause: error },
    );
  }
  return Object.freeze({
    async downloadAsText(objectName: string): Promise<TextObjectStoreResult<string>> {
      try {
        return normalizeSdkResult<string>(
          await client.downloadAsText(objectName),
          `App Storage download using the ${resolutionPath}`,
        );
      } catch (error) {
        return Object.freeze({
          ok: false,
          error: new Error(`App Storage download failed using the ${resolutionPath}.`, { cause: error }),
        });
      }
    },
    async uploadFromText(objectName: string, contents: string): Promise<TextObjectStoreResult<null>> {
      try {
        return normalizeSdkResult<null>(
          await client.uploadFromText(objectName, contents),
          `App Storage upload using the ${resolutionPath}`,
        );
      } catch (error) {
        return Object.freeze({
          ok: false,
          error: new Error(`App Storage upload failed using the ${resolutionPath}.`, { cause: error }),
        });
      }
    },
  });
}

async function loadDefaultReplitStore(): Promise<TextObjectStore> {
  defaultStorePromise ??= (async () => {
    const packageName = '@replit/object-storage';
    let loaded: unknown;
    try {
      loaded = await import(packageName);
    } catch (error) {
      throw new DisplayStoreUnavailableError(
        'Replit App Storage SDK is unavailable in this deployment.',
        { cause: error },
      );
    }
    if (loaded === null || typeof loaded !== 'object') {
      throw new DisplayStoreUnavailableError('Replit App Storage SDK module is malformed.');
    }
    const Client = (loaded as Record<string, unknown>)['Client'];
    if (typeof Client !== 'function') {
      throw new DisplayStoreUnavailableError('Replit App Storage SDK Client export is unavailable.');
    }
    return createReplitSdkTextObjectStore(
      Client as ReplitObjectStorageClientConstructor,
      process.env[REPLIT_DISPLAY_BUCKET_ID_ENV],
    );
  })();
  return defaultStorePromise;
}

export function createReplitDisplayDeliveryService(
  options: Readonly<{
    store?: TextObjectStore;
    rootDirectory?: string;
    objectName?: string;
  }> = {},
): DisplayDeliveryService {
  const rootDirectory = path.resolve(options.rootDirectory ?? 'artifacts/display-archives');
  const objectName = options.objectName ?? REPLIT_DISPLAY_BUNDLE_OBJECT;
  const resolveStore = async (): Promise<TextObjectStore> =>
    options.store ?? loadDefaultReplitStore();

  return Object.freeze({
    async refreshFromStore(): Promise<DisplayDeliveryBundleV1> {
      const store = await resolveStore();
      const result = await store.downloadAsText(objectName);
      if (!result.ok) {
        throw new DisplayStoreUnavailableError('Current display bundle is unavailable from App Storage.', {
          cause: result.error,
        });
      }
      const bundle = parseStoredBundle(result.value);
      await materializeBundle(bundle, rootDirectory);
      return bundle;
    },

    async deliver(value: unknown): Promise<DisplayDeliveryBundleV1> {
      const bundle = validateDisplayDeliveryBundle(value);
      const store = await resolveStore();
      const result = await store.uploadFromText(objectName, serializeBundle(bundle));
      if (!result.ok) {
        throw new DisplayStoreUnavailableError('Unable to persist current display bundle to App Storage.', {
          cause: result.error,
        });
      }
      await materializeBundle(bundle, rootDirectory);
      return bundle;
    },
  });
}
