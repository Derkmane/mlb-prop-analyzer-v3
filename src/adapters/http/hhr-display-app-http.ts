import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import type { IncomingMessage, ServerResponse } from 'node:http';

import {
  createHhrDisplayBoardHttpHandler,
  HHR_DISPLAY_BOARD_HTTP_PATH,
  type ReadHhrDisplayBoard,
} from './hhr-display-board-http.js';
import {
  renderHhrDisplayAppPage,
  renderHhrDisplayLoginPage,
} from '../ui/hhr-display-page.js';
import {
  HHR_DISPLAY_APP_CSS,
  HHR_DISPLAY_APP_JS,
} from '../ui/product-board-layout.js';

export const HHR_DISPLAY_LOGIN_PATH = '/login' as const;
export const HHR_DISPLAY_LOGOUT_PATH = '/logout' as const;
export const HHR_DISPLAY_APP_PATH = '/' as const;
export const HHR_DISPLAY_HEALTH_PATH = '/healthz' as const;
export const HHR_DISPLAY_CSS_PATH = '/app.css' as const;
export const HHR_DISPLAY_JS_PATH = '/app.js' as const;
export const HHR_DISPLAY_SESSION_COOKIE = 'hhr_display_session' as const;
const MAX_LOGIN_BODY_BYTES = 4_096;
const SESSION_MAX_AGE_SECONDS = 43_200;

export interface HhrDisplayAppHttpOptions {
  readonly readBoard: ReadHhrDisplayBoard;
  readonly password: string;
  readonly sessionToken?: string;
}

export type HhrDisplayAppHttpHandler = (
  request: IncomingMessage,
  response: ServerResponse,
) => void;

function applySecurityHeaders(response: ServerResponse): void {
  response.setHeader('cache-control', 'no-store');
  response.setHeader(
    'content-security-policy',
    "default-src 'self'; style-src 'self'; script-src 'self'; connect-src 'self'; img-src 'self' data:; base-uri 'none'; frame-ancestors 'none'; form-action 'self'",
  );
  response.setHeader('x-content-type-options', 'nosniff');
  response.setHeader('referrer-policy', 'no-referrer');
  response.setHeader('x-frame-options', 'DENY');
}

function write(
  response: ServerResponse,
  statusCode: number,
  contentType: string,
  body: string,
  headers: Readonly<Record<string, string>> = {},
): void {
  applySecurityHeaders(response);
  response.statusCode = statusCode;
  response.setHeader('content-type', contentType);
  response.setHeader('content-length', Buffer.byteLength(body));
  for (const [name, value] of Object.entries(headers)) response.setHeader(name, value);
  response.end(body);
}

function writeJson(response: ServerResponse, statusCode: number, value: unknown): void {
  write(response, statusCode, 'application/json; charset=utf-8', JSON.stringify(value));
}

function redirect(response: ServerResponse, location: string, extraHeaders: Readonly<Record<string, string>> = {}): void {
  write(response, 303, 'text/plain; charset=utf-8', '', { location, ...extraHeaders });
}

function requestPath(request: IncomingMessage): string | null {
  if (request.url === undefined) return null;
  try {
    return new URL(request.url, 'http://localhost').pathname;
  } catch {
    return null;
  }
}

function digest(value: string): Buffer {
  return createHash('sha256').update(value, 'utf8').digest();
}

function secureEqual(left: string, right: string): boolean {
  return timingSafeEqual(digest(left), digest(right));
}

function cookieValue(request: IncomingMessage, name: string): string | null {
  const header = request.headers.cookie;
  if (header === undefined) return null;
  for (const part of header.split(';')) {
    const separator = part.indexOf('=');
    if (separator < 0) continue;
    if (part.slice(0, separator).trim() !== name) continue;
    try {
      return decodeURIComponent(part.slice(separator + 1).trim());
    } catch {
      return null;
    }
  }
  return null;
}

function forwardedHttps(request: IncomingMessage): boolean {
  const value = request.headers['x-forwarded-proto'];
  if (Array.isArray(value)) return value.some((entry) => entry.split(',').some((item) => item.trim() === 'https'));
  return value?.split(',').some((item) => item.trim() === 'https') ?? false;
}

function sessionCookie(token: string, request: IncomingMessage): string {
  const secure = forwardedHttps(request) ? '; Secure' : '';
  return `${HHR_DISPLAY_SESSION_COOKIE}=${encodeURIComponent(token)}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${SESSION_MAX_AGE_SECONDS}${secure}`;
}

function expiredSessionCookie(request: IncomingMessage): string {
  const secure = forwardedHttps(request) ? '; Secure' : '';
  return `${HHR_DISPLAY_SESSION_COOKIE}=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0${secure}`;
}

function contentType(request: IncomingMessage): string {
  const value = request.headers['content-type'];
  return Array.isArray(value) ? value[0] ?? '' : value ?? '';
}

async function readLoginPassword(request: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    let bytes = 0;
    let oversized = false;
    const chunks: string[] = [];
    request.setEncoding('utf8');
    request.on('data', (chunk: string) => {
      bytes += Buffer.byteLength(chunk);
      if (bytes > MAX_LOGIN_BODY_BYTES) {
        oversized = true;
        return;
      }
      chunks.push(chunk);
    });
    request.once('error', reject);
    request.once('end', () => {
      if (oversized) {
        reject(new Error('login body too large'));
        return;
      }
      resolve(new URLSearchParams(chunks.join('')).get('password') ?? '');
    });
  });
}

/** Password/session wrapper around the already-verified read-only HHR board transport. */
export function createHhrDisplayAppHttpHandler(
  options: HhrDisplayAppHttpOptions,
): HhrDisplayAppHttpHandler {
  if (options.password.length === 0) throw new Error('HHR display password must be configured.');
  const sessionToken = options.sessionToken ?? randomBytes(32).toString('base64url');
  if (sessionToken.length === 0) throw new Error('HHR display session token must not be empty.');
  const boardHandler = createHhrDisplayBoardHttpHandler(options.readBoard);

  return (request, response) => {
    applySecurityHeaders(response);
    const path = requestPath(request);
    const authenticated = secureEqual(cookieValue(request, HHR_DISPLAY_SESSION_COOKIE) ?? '', sessionToken);

    if (path === HHR_DISPLAY_HEALTH_PATH && request.method === 'GET') {
      void Promise.resolve()
        .then(() => options.readBoard())
        .then(() => writeJson(response, 200, { status: 'ok' }))
        .catch(() => writeJson(response, 503, { status: 'unavailable' }));
      return;
    }
    if (path === HHR_DISPLAY_CSS_PATH && request.method === 'GET') {
      write(response, 200, 'text/css; charset=utf-8', HHR_DISPLAY_APP_CSS);
      return;
    }
    if (path === HHR_DISPLAY_LOGIN_PATH && request.method === 'GET') {
      if (authenticated) redirect(response, HHR_DISPLAY_APP_PATH);
      else write(response, 200, 'text/html; charset=utf-8', renderHhrDisplayLoginPage());
      return;
    }
    if (path === HHR_DISPLAY_LOGIN_PATH && request.method === 'POST') {
      if (!contentType(request).toLowerCase().startsWith('application/x-www-form-urlencoded')) {
        writeJson(response, 415, { error: 'unsupported-media-type' });
        return;
      }
      void readLoginPassword(request)
        .then((submittedPassword) => {
          if (!secureEqual(submittedPassword, options.password)) {
            write(response, 401, 'text/html; charset=utf-8', renderHhrDisplayLoginPage(true));
            return;
          }
          redirect(response, HHR_DISPLAY_APP_PATH, { 'set-cookie': sessionCookie(sessionToken, request) });
        })
        .catch(() => writeJson(response, 400, { error: 'invalid-login-request' }));
      return;
    }
    if (path === HHR_DISPLAY_LOGOUT_PATH && request.method === 'POST') {
      redirect(response, HHR_DISPLAY_LOGIN_PATH, { 'set-cookie': expiredSessionCookie(request) });
      return;
    }

    if (path === HHR_DISPLAY_APP_PATH && request.method === 'GET') {
      if (!authenticated) {
        redirect(response, HHR_DISPLAY_LOGIN_PATH);
        return;
      }
      write(response, 200, 'text/html; charset=utf-8', renderHhrDisplayAppPage());
      return;
    }
    if (path === HHR_DISPLAY_JS_PATH && request.method === 'GET') {
      if (!authenticated) {
        writeJson(response, 401, { error: 'authentication-required' });
        return;
      }
      write(response, 200, 'text/javascript; charset=utf-8', HHR_DISPLAY_APP_JS);
      return;
    }
    if (path === HHR_DISPLAY_BOARD_HTTP_PATH) {
      if (!authenticated) {
        writeJson(response, 401, { error: 'authentication-required' });
        return;
      }
      boardHandler(request, response);
      return;
    }

    writeJson(response, 404, { error: 'not-found' });
  };
}
