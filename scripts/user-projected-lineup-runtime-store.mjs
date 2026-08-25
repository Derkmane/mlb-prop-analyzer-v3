import { existsSync, mkdirSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  USER_PROJECTED_LINEUP_SOURCE_TIME_ZONE,
  validateUserProjectedLineupArtifactBytes,
} from './user-projected-lineup-utils.mjs';

export const USER_PROJECTED_LINEUP_RUNTIME_ISSUE_TITLE =
  'Runtime: current user-projected MLB lineup payload';
export const USER_PROJECTED_LINEUP_RUNTIME_DEFAULT_ROOT =
  'artifacts/workflow-runtime/user-projected-lineups';

const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/u;
const MAX_ISSUE_BODY_BYTES = 65_536;

function localDate(now, timeZone = USER_PROJECTED_LINEUP_SOURCE_TIME_ZONE) {
  const date = now instanceof Date ? now : new Date(now);
  if (!Number.isFinite(date.getTime())) {
    throw new TypeError('Runtime lineup clock must be a valid date.');
  }
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(date);
  const values = Object.fromEntries(
    parts.filter((entry) => entry.type !== 'literal').map((entry) => [entry.type, entry.value]),
  );
  return `${values.year}-${values.month}-${values.day}`;
}

function runtimeRoot(rawRoot) {
  return path.resolve(
    rawRoot?.trim() ||
      process.env.USER_PROJECTED_LINEUP_ROOT?.trim() ||
      USER_PROJECTED_LINEUP_RUNTIME_DEFAULT_ROOT,
  );
}

function issueNumber(rawIssueNumber) {
  const value = typeof rawIssueNumber === 'number'
    ? rawIssueNumber
    : Number(rawIssueNumber);
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new TypeError('Runtime lineup issue number must be a positive integer.');
  }
  return value;
}

function repositoryName(rawRepository) {
  if (typeof rawRepository !== 'string' || !/^[^/\s]+\/[^/\s]+$/u.test(rawRepository.trim())) {
    throw new TypeError('Runtime lineup repository must be owner/name.');
  }
  return rawRepository.trim();
}

function result(status, fields = {}) {
  return Object.freeze({ status, ...fields });
}

export function materializeUserProjectedLineupIssueBody({
  body,
  now = new Date(),
  root,
}) {
  if (typeof body !== 'string' || body.trim().length === 0) {
    return result('invalid', { reason: 'issue-body-empty' });
  }
  const bytes = Buffer.from(body, 'utf8');
  if (bytes.length > MAX_ISSUE_BODY_BYTES) {
    return result('invalid', { reason: 'issue-body-too-large' });
  }

  let raw;
  try {
    raw = JSON.parse(body);
  } catch {
    return result('invalid', { reason: 'issue-body-invalid-json' });
  }
  const slateDate = raw?.slateDate;
  if (typeof slateDate !== 'string' || !DATE_PATTERN.test(slateDate)) {
    return result('invalid', { reason: 'issue-body-invalid-slate-date' });
  }

  const targetRoot = runtimeRoot(root);
  const filePath = path.join(targetRoot, `${slateDate}.json`);
  let artifact;
  try {
    artifact = validateUserProjectedLineupArtifactBytes(bytes, filePath);
  } catch (error) {
    return result('invalid', {
      reason: error instanceof Error ? error.message : 'artifact-validation-failed',
    });
  }

  const today = localDate(now);
  if (artifact.slateDate !== today) {
    return result('stale', {
      slateDate: artifact.slateDate,
      currentSlateDate: today,
      snapshotSha256: artifact.snapshotSha256,
    });
  }

  mkdirSync(targetRoot, { recursive: true });
  const tempPath = `${filePath}.${process.pid}.tmp`;
  try {
    writeFileSync(tempPath, bytes, { flag: 'wx' });
    renameSync(tempPath, filePath);
  } finally {
    if (existsSync(tempPath)) rmSync(tempPath, { force: true });
  }

  return result('current', {
    slateDate: artifact.slateDate,
    filePath,
    snapshotSha256: artifact.snapshotSha256,
    games: artifact.games.length,
    teams: artifact.games.reduce((count, game) => count + game.teams.length, 0),
    players: artifact.games.reduce(
      (count, game) => count + game.teams.reduce((teamCount, team) => teamCount + team.players.length, 0),
      0,
    ),
  });
}

export async function restoreUserProjectedLineupRuntimeIssue({
  token,
  repository,
  issueNumber: rawIssueNumber,
  now = new Date(),
  root,
  fetchImpl = globalThis.fetch,
}) {
  if (typeof token !== 'string' || token.length === 0) {
    return result('unavailable', { reason: 'github-token-missing' });
  }
  if (typeof fetchImpl !== 'function') {
    throw new TypeError('Runtime lineup fetch implementation must be a function.');
  }

  let repo;
  let number;
  try {
    repo = repositoryName(repository);
    number = issueNumber(rawIssueNumber);
  } catch (error) {
    return result('unavailable', {
      reason: error instanceof Error ? error.message : 'runtime-store-configuration-invalid',
    });
  }

  let response;
  try {
    response = await fetchImpl(`https://api.github.com/repos/${repo}/issues/${number}`, {
      headers: {
        accept: 'application/vnd.github+json',
        authorization: `Bearer ${token}`,
        'user-agent': 'mlb-prop-analyzer-v3-runtime-lineup-store',
        'x-github-api-version': '2022-11-28',
      },
    });
  } catch {
    return result('unavailable', { reason: 'github-issue-request-failed' });
  }
  if (!response?.ok) {
    return result('unavailable', {
      reason: `github-issue-http-${response?.status ?? 'unknown'}`,
    });
  }

  let issue;
  try {
    issue = await response.json();
  } catch {
    return result('unavailable', { reason: 'github-issue-response-invalid-json' });
  }
  if (issue?.pull_request !== undefined) {
    return result('unavailable', { reason: 'runtime-store-target-is-pull-request' });
  }
  if (issue?.title !== USER_PROJECTED_LINEUP_RUNTIME_ISSUE_TITLE) {
    return result('unavailable', { reason: 'runtime-store-title-mismatch' });
  }
  if (issue?.state !== 'open') {
    return result('unavailable', { reason: 'runtime-store-issue-not-open' });
  }

  return materializeUserProjectedLineupIssueBody({ body: issue.body, now, root });
}

function isDirectInvocation() {
  const entrypoint = process.argv[1];
  return entrypoint !== undefined && path.resolve(entrypoint) === fileURLToPath(import.meta.url);
}

async function main() {
  const restored = await restoreUserProjectedLineupRuntimeIssue({
    token: process.env.GITHUB_TOKEN,
    repository: process.env.GITHUB_REPOSITORY,
    issueNumber: process.env.USER_PROJECTED_LINEUP_RUNTIME_ISSUE_NUMBER,
  });
  const details = [
    restored.slateDate,
    restored.games === undefined ? undefined : `${restored.games} games`,
    restored.teams === undefined ? undefined : `${restored.teams} teams`,
    restored.players === undefined ? undefined : `${restored.players} players`,
    restored.reason,
  ].filter(Boolean).join('\t');
  console.log(`USER PROJECTED LINEUP RUNTIME STORE\t${restored.status.toUpperCase()}${details ? `\t${details}` : ''}`);

  if (process.env.USER_PROJECTED_LINEUP_RUNTIME_REQUIRED === '1' && restored.status !== 'current') {
    throw new Error(`Current user-projected lineup runtime payload required; got ${restored.status}.`);
  }
}

if (isDirectInvocation()) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
