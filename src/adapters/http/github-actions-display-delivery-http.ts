import { createPublicKey, verify } from 'node:crypto';
import type { IncomingMessage, ServerResponse } from 'node:http';

import {
  DisplayStoreUnavailableError,
  InvalidDisplayDeliveryBundleError,
  type DisplayDeliveryService,
} from '../display-archives/replit-display-delivery.js';

export const DISPLAY_DELIVERY_HTTP_PATH = '/internal/display-delivery-v1' as const;
export const DISPLAY_DELIVERY_OIDC_AUDIENCE = 'mlb-prop-analyzer-v3-display-delivery-v1' as const;
export const GITHUB_OIDC_ISSUER = 'https://token.actions.githubusercontent.com' as const;
export const GITHUB_OIDC_JWKS_URL =
  'https://token.actions.githubusercontent.com/.well-known/jwks' as const;
export const DISPLAY_DELIVERY_REPOSITORY = 'Derkmane/mlb-prop-analyzer-v3' as const;
export const DISPLAY_DELIVERY_REPOSITORY_ID = '1309982123' as const;
export const DISPLAY_DELIVERY_REF = 'refs/heads/main' as const;
export const DISPLAY_DELIVERY_WORKFLOW_REF =
  'Derkmane/mlb-prop-analyzer-v3/.github/workflows/m9-board-archive.yml@refs/heads/main' as const;

const MAX_DELIVERY_BODY_BYTES = 20 * 1024 * 1024;
const CLOCK_SKEW_SECONDS = 60;

export class GitHubActionsOidcVerificationError extends Error {
  constructor(message: string, options: ErrorOptions = {}) {
    super(message, options);
    this.name = 'GitHubActionsOidcVerificationError';
  }
}

export type VerifyGitHubActionsOidcToken = (token: string) => Promise<void>;

interface JsonWebKeyRecord {
  readonly kid?: unknown;
  readonly kty?: unknown;
  readonly alg?: unknown;
  readonly use?: unknown;
  readonly [key: string]: unknown;
}

function jsonObject(value: unknown, label: string): Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new GitHubActionsOidcVerificationError(`${label} must be an object.`);
  }
  return value as Record<string, unknown>;
}

function decodeSegment(segment: string, label: string): Record<string, unknown> {
  try {
    return jsonObject(JSON.parse(Buffer.from(segment, 'base64url').toString('utf8')) as unknown, label);
  } catch (error) {
    if (error instanceof GitHubActionsOidcVerificationError) throw error;
    throw new GitHubActionsOidcVerificationError(`${label} is not valid JWT JSON.`, { cause: error });
  }
}

function stringClaim(claims: Record<string, unknown>, name: string): string {
  const value = claims[name];
  if (typeof value !== 'string' || value.length === 0) {
    throw new GitHubActionsOidcVerificationError(`GitHub OIDC ${name} claim is missing.`);
  }
  return value;
}

function numericClaim(claims: Record<string, unknown>, name: string): number {
  const value = claims[name];
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new GitHubActionsOidcVerificationError(`GitHub OIDC ${name} claim is missing.`);
  }
  return value;
}

function audienceIncludes(value: unknown, expected: string): boolean {
  return value === expected || (Array.isArray(value) && value.includes(expected));
}

function assertClaims(claims: Record<string, unknown>, nowSeconds: number): void {
  if (stringClaim(claims, 'iss') !== GITHUB_OIDC_ISSUER) {
    throw new GitHubActionsOidcVerificationError('GitHub OIDC issuer is invalid.');
  }
  if (!audienceIncludes(claims['aud'], DISPLAY_DELIVERY_OIDC_AUDIENCE)) {
    throw new GitHubActionsOidcVerificationError('GitHub OIDC audience is invalid.');
  }
  if (stringClaim(claims, 'repository') !== DISPLAY_DELIVERY_REPOSITORY) {
    throw new GitHubActionsOidcVerificationError('GitHub OIDC repository is invalid.');
  }
  if (stringClaim(claims, 'repository_id') !== DISPLAY_DELIVERY_REPOSITORY_ID) {
    throw new GitHubActionsOidcVerificationError('GitHub OIDC repository_id is invalid.');
  }
  if (stringClaim(claims, 'ref') !== DISPLAY_DELIVERY_REF || stringClaim(claims, 'ref_type') !== 'branch') {
    throw new GitHubActionsOidcVerificationError('GitHub OIDC ref is invalid.');
  }
  if (stringClaim(claims, 'workflow_ref') !== DISPLAY_DELIVERY_WORKFLOW_REF) {
    throw new GitHubActionsOidcVerificationError('GitHub OIDC workflow_ref is invalid.');
  }
  if (stringClaim(claims, 'repository_visibility') !== 'public') {
    throw new GitHubActionsOidcVerificationError('GitHub OIDC repository visibility is invalid.');
  }
  if (stringClaim(claims, 'runner_environment') !== 'github-hosted') {
    throw new GitHubActionsOidcVerificationError('GitHub OIDC runner environment is invalid.');
  }
  const exp = numericClaim(claims, 'exp');
  const nbf = numericClaim(claims, 'nbf');
  const iat = numericClaim(claims, 'iat');
  if (exp < nowSeconds - CLOCK_SKEW_SECONDS) {
    throw new GitHubActionsOidcVerificationError('GitHub OIDC token is expired.');
  }
  if (nbf > nowSeconds + CLOCK_SKEW_SECONDS || iat > nowSeconds + CLOCK_SKEW_SECONDS) {
    throw new GitHubActionsOidcVerificationError('GitHub OIDC token is not yet valid.');
  }
}

export function createGitHubActionsOidcVerifier(
  options: Readonly<{
    fetchImpl?: typeof fetch;
    now?: () => number;
  }> = {},
): VerifyGitHubActionsOidcToken {
  const fetchImpl = options.fetchImpl ?? fetch;
  const now = options.now ?? (() => Date.now());
  const keyCache = new Map<string, JsonWebKeyRecord>();

  async function signingKey(kid: string): Promise<JsonWebKeyRecord> {
    const cached = keyCache.get(kid);
    if (cached !== undefined) return cached;
    let response: Response;
    try {
      response = await fetchImpl(GITHUB_OIDC_JWKS_URL, {
        headers: { accept: 'application/json' },
      });
    } catch (error) {
      throw new GitHubActionsOidcVerificationError('Unable to fetch GitHub OIDC signing keys.', {
        cause: error,
      });
    }
    if (!response.ok) {
      throw new GitHubActionsOidcVerificationError(
        `Unable to fetch GitHub OIDC signing keys: HTTP ${response.status}.`,
      );
    }
    const body = jsonObject(await response.json() as unknown, 'GitHub OIDC JWKS');
    const keys = body['keys'];
    if (!Array.isArray(keys)) {
      throw new GitHubActionsOidcVerificationError('GitHub OIDC JWKS keys are missing.');
    }
    for (const rawKey of keys) {
      const key = jsonObject(rawKey, 'GitHub OIDC JWK') as JsonWebKeyRecord;
      if (typeof key.kid === 'string') keyCache.set(key.kid, key);
    }
    const resolved = keyCache.get(kid);
    if (resolved === undefined) {
      throw new GitHubActionsOidcVerificationError('GitHub OIDC signing key is unknown.');
    }
    return resolved;
  }

  return async (token: string): Promise<void> => {
    const segments = token.split('.');
    if (segments.length !== 3 || segments.some((segment) => segment.length === 0)) {
      throw new GitHubActionsOidcVerificationError('GitHub OIDC token is not a JWT.');
    }
    const [headerSegment, payloadSegment, signatureSegment] = segments as [string, string, string];
    const header = decodeSegment(headerSegment, 'GitHub OIDC JWT header');
    const claims = decodeSegment(payloadSegment, 'GitHub OIDC JWT claims');
    if (header['alg'] !== 'RS256' || typeof header['kid'] !== 'string') {
      throw new GitHubActionsOidcVerificationError('GitHub OIDC JWT header is unsupported.');
    }
    const jwk = await signingKey(header['kid']);
    if (jwk.kty !== 'RSA') {
      throw new GitHubActionsOidcVerificationError('GitHub OIDC signing key type is unsupported.');
    }
    let publicKey;
    try {
      publicKey = createPublicKey(
        { key: jwk, format: 'jwk' } as unknown as Parameters<typeof createPublicKey>[0],
      );
    } catch (error) {
      throw new GitHubActionsOidcVerificationError('GitHub OIDC signing key is invalid.', {
        cause: error,
      });
    }
    const validSignature = verify(
      'RSA-SHA256',
      Buffer.from(`${headerSegment}.${payloadSegment}`, 'utf8'),
      publicKey,
      Buffer.from(signatureSegment, 'base64url'),
    );
    if (!validSignature) {
      throw new GitHubActionsOidcVerificationError('GitHub OIDC JWT signature is invalid.');
    }
    assertClaims(claims, Math.floor(now() / 1000));
  };
}

function writeJson(response: ServerResponse, statusCode: number, body: unknown): void {
  const bytes = JSON.stringify(body);
  response.statusCode = statusCode;
  response.setHeader('cache-control', 'no-store');
  response.setHeader('content-type', 'application/json; charset=utf-8');
  response.setHeader('content-length', Buffer.byteLength(bytes));
  response.end(bytes);
}

function bearerToken(request: IncomingMessage): string | null {
  const header = request.headers.authorization;
  if (header === undefined) return null;
  const match = /^Bearer ([^\s]+)$/u.exec(header);
  return match?.[1] ?? null;
}

async function readJsonBody(request: IncomingMessage): Promise<unknown> {
  return new Promise((resolve, reject) => {
    let bytes = 0;
    let oversized = false;
    const chunks: Buffer[] = [];
    request.on('data', (chunk: Buffer | string) => {
      const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
      bytes += buffer.length;
      if (bytes > MAX_DELIVERY_BODY_BYTES) {
        oversized = true;
        return;
      }
      chunks.push(buffer);
    });
    request.once('error', reject);
    request.once('end', () => {
      if (oversized) {
        reject(new InvalidDisplayDeliveryBundleError('display delivery body is too large.'));
        return;
      }
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString('utf8')) as unknown);
      } catch (error) {
        reject(new InvalidDisplayDeliveryBundleError('display delivery body is not valid JSON.', {
          cause: error,
        }));
      }
    });
  });
}

export type DisplayDeliveryHttpHandler = (
  request: IncomingMessage,
  response: ServerResponse,
) => void;

export function createGitHubActionsDisplayDeliveryHttpHandler(
  options: Readonly<{
    service: Pick<DisplayDeliveryService, 'deliver'>;
    verifyToken?: VerifyGitHubActionsOidcToken;
  }>,
): DisplayDeliveryHttpHandler {
  const verifyToken = options.verifyToken ?? createGitHubActionsOidcVerifier();
  return (request, response) => {
    if (request.method !== 'POST') {
      writeJson(response, 405, { error: 'method-not-allowed' });
      return;
    }
    const contentType = request.headers['content-type'];
    const normalizedContentType = Array.isArray(contentType) ? contentType[0] ?? '' : contentType ?? '';
    if (!normalizedContentType.toLowerCase().startsWith('application/json')) {
      writeJson(response, 415, { error: 'unsupported-media-type' });
      return;
    }
    const token = bearerToken(request);
    if (token === null) {
      writeJson(response, 401, { error: 'display-delivery-authentication-required' });
      return;
    }
    void verifyToken(token)
      .then(() => readJsonBody(request))
      .then((body) => options.service.deliver(body))
      .then((bundle) => {
        response.statusCode = 204;
        response.setHeader('cache-control', 'no-store');
        response.setHeader('x-display-captured-at', bundle.capturedAt);
        response.end();
      })
      .catch((error: unknown) => {
        if (error instanceof GitHubActionsOidcVerificationError) {
          writeJson(response, 401, { error: 'invalid-display-delivery-identity' });
          return;
        }
        if (error instanceof InvalidDisplayDeliveryBundleError) {
          writeJson(response, 400, { error: 'invalid-display-delivery-bundle' });
          return;
        }
        if (error instanceof DisplayStoreUnavailableError) {
          writeJson(response, 503, { error: 'display-delivery-store-unavailable' });
          return;
        }
        writeJson(response, 500, { error: 'display-delivery-failed' });
      });
  };
}
