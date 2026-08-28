import { createHash, randomUUID } from 'node:crypto';
import { access, mkdir, rename, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';

export const DISPLAY_DELIVERY_BUNDLE_VERSION = 1 as const;
export const REPLIT_DISPLAY_BUNDLE_OBJECT =
  'mlb-prop-analyzer-v3/display/current-board-v1.json' as const;

export type DisplayDeliveryMarket = 'batter-hits' | 'batter-hhr';

export interface DisplayDeliveryArchiveV1 {
  readonly market: DisplayDeliveryMarket;
  readonly filename: string;
  readonly sha256: string;
  readonly bytesBase64: string;
}

export interface DisplayDeliveryBundleV1 {
  readonly deliveryVersion: typeof DISPLAY_DELIVERY_BUNDLE_VERSION;
  readonly capturedAt: string;
  readonly archives: readonly [DisplayDeliveryArchiveV1, DisplayDeliveryArchiveV1];
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

const CAPTURE_FILE = /^(\d{8}T\d{9}Z)--[a-f0-9]{64}\.json$/u;
const SHA256 = /^[a-f0-9]{64}$/u;
const BASE64 = /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/u;

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

function expectedPersistedMarket(market: DisplayDeliveryMarket): string {
  return market;
}

function parseArchiveEnvelope(raw: unknown, index: number, capturedAt: string): DisplayDeliveryArchiveV1 {
  const source = objectRecord(raw, `archives[${index}]`);
  const market = source['market'];
  if (market !== 'batter-hits' && market !== 'batter-hhr') {
    throw new InvalidDisplayDeliveryBundleError(`archives[${index}].market is unsupported.`);
  }
  const filename = nonemptyString(source['filename'], `archives[${index}].filename`);
  const match = CAPTURE_FILE.exec(filename);
  if (match === null) {
    throw new InvalidDisplayDeliveryBundleError(`archives[${index}].filename is invalid.`);
  }
  if (match[1] !== capturedAtIdentity(capturedAt)) {
    throw new InvalidDisplayDeliveryBundleError(
      `archives[${index}].filename does not match bundle capturedAt.`,
    );
  }
  const sha256 = nonemptyString(source['sha256'], `archives[${index}].sha256`);
  if (!SHA256.test(sha256)) {
    throw new InvalidDisplayDeliveryBundleError(`archives[${index}].sha256 is invalid.`);
  }
  const bytesBase64 = nonemptyString(source['bytesBase64'], `archives[${index}].bytesBase64`);
  if (!BASE64.test(bytesBase64)) {
    throw new InvalidDisplayDeliveryBundleError(`archives[${index}].bytesBase64 is invalid.`);
  }
  const bytes = Buffer.from(bytesBase64, 'base64');
  if (bytes.toString('base64') !== bytesBase64) {
    throw new InvalidDisplayDeliveryBundleError(`archives[${index}].bytesBase64 is not canonical.`);
  }
  const digest = createHash('sha256').update(bytes).digest('hex');
  if (digest !== sha256) {
    throw new InvalidDisplayDeliveryBundleError(`archives[${index}] SHA-256 mismatch.`);
  }

  let archiveUnknown: unknown;
  try {
    archiveUnknown = JSON.parse(bytes.toString('utf8')) as unknown;
  } catch (error) {
    throw new InvalidDisplayDeliveryBundleError(
      `archives[${index}] is not valid JSON.`,
      { cause: error },
    );
  }
  const archive = objectRecord(archiveUnknown, `archives[${index}] display archive`);
  if (
    archive['displayArchiveVersion'] !== 1 ||
    archive['displayArchiveContract'] !== 'phase1-trimmed-board-display-v1' ||
    archive['market'] !== expectedPersistedMarket(market) ||
    archive['productionEnabled'] !== false ||
    archive['productionRankingEnabled'] !== false
  ) {
    throw new InvalidDisplayDeliveryBundleError(
      `archives[${index}] display archive contract is invalid.`,
    );
  }
  if (archive['capturedAt'] !== capturedAt) {
    throw new InvalidDisplayDeliveryBundleError(
      `archives[${index}] capturedAt does not match bundle capturedAt.`,
    );
  }
  const captureKey = nonemptyString(archive['captureKey'], `archives[${index}] captureKey`);
  if (captureKey !== filename.slice(0, -'.json'.length)) {
    throw new InvalidDisplayDeliveryBundleError(
      `archives[${index}] captureKey does not match filename.`,
    );
  }
  if (!Array.isArray(archive['rows']) || archive['rows'].length === 0) {
    throw new InvalidDisplayDeliveryBundleError(`archives[${index}] rows must be nonempty.`);
  }

  return Object.freeze({ market, filename, sha256, bytesBase64 });
}

export function validateDisplayDeliveryBundle(value: unknown): DisplayDeliveryBundleV1 {
  const source = objectRecord(value, 'display delivery bundle');
  if (source['deliveryVersion'] !== DISPLAY_DELIVERY_BUNDLE_VERSION) {
    throw new InvalidDisplayDeliveryBundleError('display delivery bundle version is unsupported.');
  }
  const capturedAt = nonemptyString(source['capturedAt'], 'display delivery capturedAt');
  if (!Number.isFinite(Date.parse(capturedAt))) {
    throw new InvalidDisplayDeliveryBundleError('display delivery capturedAt must be an ISO timestamp.');
  }
  const rawArchives = source['archives'];
  if (!Array.isArray(rawArchives) || rawArchives.length !== 2) {
    throw new InvalidDisplayDeliveryBundleError(
      'display delivery bundle must contain exactly two archives.',
    );
  }
  const archives = rawArchives.map((archive, index) =>
    parseArchiveEnvelope(archive, index, capturedAt));
  const markets = new Set(archives.map((archive) => archive.market));
  if (!markets.has('batter-hits') || !markets.has('batter-hhr') || markets.size !== 2) {
    throw new InvalidDisplayDeliveryBundleError(
      'display delivery bundle must contain exactly one Batter Hits and one HHR archive.',
    );
  }
  const hits = archives.find((archive) => archive.market === 'batter-hits');
  const hhr = archives.find((archive) => archive.market === 'batter-hhr');
  if (hits === undefined || hhr === undefined) {
    throw new InvalidDisplayDeliveryBundleError('display delivery market pair is incomplete.');
  }
  return Object.freeze({
    deliveryVersion: DISPLAY_DELIVERY_BUNDLE_VERSION,
    capturedAt,
    archives: Object.freeze([hits, hhr]) as readonly [DisplayDeliveryArchiveV1, DisplayDeliveryArchiveV1],
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
  const targets = bundle.archives.map((archive) => {
    const directory = path.join(rootDirectory, archive.market, 'captures');
    return Object.freeze({
      archive,
      directory,
      finalPath: path.join(directory, archive.filename),
      tempPath: path.join(directory, `.${archive.filename}.${process.pid}.${randomUUID()}.tmp`),
    });
  });
  if ((await Promise.all(targets.map((target) => exists(target.finalPath)))).every(Boolean)) return;

  await Promise.all(targets.map(async (target) => {
    await mkdir(target.directory, { recursive: true });
    await writeFile(target.tempPath, Buffer.from(target.archive.bytesBase64, 'base64'), { flag: 'wx' });
  }));

  const renamed: string[] = [];
  try {
    for (const target of targets) {
      await rename(target.tempPath, target.finalPath);
      renamed.push(target.finalPath);
    }
  } catch (error) {
    await Promise.all(renamed.map((filePath) => rm(filePath, { force: true })));
    throw error;
  } finally {
    await Promise.all(targets.map((target) => rm(target.tempPath, { force: true })));
  }
}

interface ReplitObjectStorageClient {
  downloadAsText(objectName: string): Promise<unknown>;
  uploadFromText(objectName: string, contents: string): Promise<unknown>;
}

type ReplitObjectStorageClientConstructor = new () => ReplitObjectStorageClient;

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
    const client = new (Client as ReplitObjectStorageClientConstructor)();
    return Object.freeze({
      async downloadAsText(objectName: string): Promise<TextObjectStoreResult<string>> {
        try {
          return normalizeSdkResult<string>(await client.downloadAsText(objectName), 'App Storage download');
        } catch (error) {
          return Object.freeze({ ok: false, error });
        }
      },
      async uploadFromText(objectName: string, contents: string): Promise<TextObjectStoreResult<null>> {
        try {
          return normalizeSdkResult<null>(await client.uploadFromText(objectName, contents), 'App Storage upload');
        } catch (error) {
          return Object.freeze({ ok: false, error });
        }
      },
    });
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
