import { readFile, writeFile } from 'node:fs/promises';

const livePath = 'scripts/archive-m9-batter-hits-board.mjs';
const packagePath = 'package.json';

function replaceExactlyOnce(source, before, after, label) {
  const first = source.indexOf(before);
  if (first === -1 || source.indexOf(before, first + before.length) !== -1) {
    throw new Error(`${label} must match exactly once.`);
  }
  return `${source.slice(0, first)}${after}${source.slice(first + before.length)}`;
}

let live = await readFile(livePath, 'utf8');
live = replaceExactlyOnce(
  live,
  `  beforeRequest,\n  afterResponse,\n}) {`,
  `  beforeRequest,\n  afterResponse,\n  allowNonOk = false,\n}) {`,
  'fetch option boundary',
);
live = replaceExactlyOnce(
  live,
  `  if (!response.ok) {\n`,
  `  if (!response.ok && !allowNonOk) {\n`,
  'non-OK rejection boundary',
);
live = replaceExactlyOnce(
  live,
  `        afterResponse: (response) => rateLimiter.afterResponse(response),\n      });\n      if (snapshot.response.status !== 429) return snapshot;\n      if (attempt === 8) {\n        throw new Error(\`${'${request.label}'} exceeded eight HTTP 429 retries.\`);\n      }\n      await rateLimiter.waitForRetry();\n`,
  `        afterResponse: (response) => rateLimiter.afterResponse(response),\n        allowNonOk: true,\n      });\n      if (snapshot.response.status === 429) {\n        if (attempt === 8) {\n          throw new Error(\`${'${request.label}'} exceeded eight HTTP 429 retries.\`);\n        }\n        await rateLimiter.waitForRetry();\n        continue;\n      }\n      if (\n        snapshot.response.status < 200 ||\n        snapshot.response.status >= 300\n      ) {\n        throw new Error(\n          \`${'${request.label}'} returned HTTP ${'${snapshot.response.status}'} ${'${snapshot.response.statusText}'}.\`,\n        );\n      }\n      return snapshot;\n`,
  'BALLDONTLIE retry boundary',
);
await writeFile(livePath, live, 'utf8');

const packageJson = JSON.parse(await readFile(packagePath, 'utf8'));
const checks = [
  'node --check scripts/m9-board-archive-utils.mjs',
  'node --check scripts/archive-m9-batter-hits-board.mjs',
];
for (const check of checks) {
  if (!packageJson.scripts['check:scripts'].includes(check)) {
    packageJson.scripts['check:scripts'] += ` && ${check}`;
  }
}
await writeFile(packagePath, `${JSON.stringify(packageJson, null, 2)}\n`, 'utf8');
