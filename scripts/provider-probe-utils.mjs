import { createHash } from 'node:crypto';
import { mkdir, rename, writeFile } from 'node:fs/promises';
import path from 'node:path';

export function requireSecret(name) {
  const value = process.env[name]?.trim();
  if (!value) {
    throw new Error(`Missing required secret: ${name}`);
  }
  return value;
}

export function sha256(value) {
  return createHash('sha256').update(value).digest('hex');
}

export function sanitizeText(value, secrets) {
  return secrets.reduce(
    (sanitized, secret) => sanitized.split(secret).join('[REDACTED]'),
    value,
  );
}

export async function writeTextAtomic(filePath, value) {
  await mkdir(path.dirname(filePath), { recursive: true });
  const temporaryPath = `${filePath}.tmp-${process.pid}-${Date.now()}`;
  await writeFile(temporaryPath, value, 'utf8');
  await rename(temporaryPath, filePath);
}

export async function writeJsonAtomic(filePath, value) {
  await writeTextAtomic(filePath, `${JSON.stringify(value, null, 2)}\n`);
}

function summarizeBody(body) {
  if (Array.isArray(body)) {
    return { type: 'array', recordCount: body.length };
  }

  if (body !== null && typeof body === 'object') {
    const data = body.data;
    return {
      type: 'object',
      topLevelKeys: Object.keys(body).sort(),
      dataRecordCount: Array.isArray(data) ? data.length : null,
    };
  }

  return { type: body === null ? 'null' : typeof body };
}

function selectedResponseHeaders(headers) {
  const selectedNames = [
    'content-type',
    'retry-after',
    'x-ratelimit-limit',
    'x-ratelimit-remaining',
    'x-ratelimit-reset',
    'x-requests-last',
    'x-requests-remaining',
    'x-requests-used',
  ];

  return Object.fromEntries(
    selectedNames
      .map((name) => [name, headers.get(name)])
      .filter(([, value]) => value !== null),
  );
}

export async function fetchJsonSnapshot({
  label,
  url,
  headers = {},
  secrets,
  timeoutMs = 30_000,
}) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(url, {
      headers,
      signal: controller.signal,
    });
    const rawText = await response.text();
    const sanitizedText = sanitizeText(rawText, secrets);

    let body;
    let sanitizedBodyText;
    try {
      body = JSON.parse(sanitizedText);
      sanitizedBodyText = `${JSON.stringify(body, null, 2)}\n`;
    } catch {
      body = sanitizedText;
      sanitizedBodyText = `${sanitizedText}\n`;
    }

    return {
      label,
      ok: response.ok,
      request: {
        origin: url.origin,
        pathname: url.pathname,
        queryKeys: [...url.searchParams.keys()].sort(),
        headerNames: Object.keys(headers).sort(),
      },
      response: {
        status: response.status,
        statusText: response.statusText,
        headers: selectedResponseHeaders(response.headers),
        rawBodySha256: sha256(rawText),
        bodySummary: summarizeBody(body),
      },
      sanitizedBodyText,
    };
  } finally {
    clearTimeout(timeout);
  }
}

export function timestampForPath(date) {
  return date.toISOString().replaceAll(':', '-').replaceAll('.', '-');
}
