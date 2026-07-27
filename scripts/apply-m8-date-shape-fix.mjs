import { execFileSync } from 'node:child_process';
import { readFileSync, unlinkSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

function replaceExactlyOnce(source, before, after, label) {
  const first = source.indexOf(before);
  if (first < 0 || source.indexOf(before, first + before.length) >= 0) {
    throw new Error(`${label} was not found exactly once.`);
  }
  return source.replace(before, after);
}

const utilityPath = 'scripts/m8-recency-weighting-utils.mjs';
const testPath = 'test/m8-recency-weighting-utils.test.mjs';
const selfPath = fileURLToPath(import.meta.url);

let utility = readFileSync(utilityPath, 'utf8');
utility = replaceExactlyOnce(
  utility,
  "const ISO_DATE_PATTERN = /^\\d{4}-\\d{2}-\\d{2}$/;\n",
  "const ISO_DATE_PATTERN = /^\\d{4}-\\d{2}-\\d{2}$/;\nconst ISO_UTC_TIMESTAMP_PATTERN =\n  /^\\d{4}-\\d{2}-\\d{2}T\\d{2}:\\d{2}:\\d{2}\\.\\d{3}Z$/;\n",
  'ISO date header',
);

const helper = [
  'function normalizeProviderGameDate(value, activeSeason, label) {',
  '  const rawDate = assertNonEmptyString(value, label);',
  '  let utcDate;',
  '',
  '  if (ISO_DATE_PATTERN.test(rawDate)) {',
  '    utcDate = rawDate;',
  '  } else {',
  '    if (!ISO_UTC_TIMESTAMP_PATTERN.test(rawDate)) {',
  '      throw new TypeError(',
  '        `${label} must use YYYY-MM-DD or an ISO UTC timestamp ending in Z.`,',
  '      );',
  '    }',
  '    const parsed = new Date(rawDate);',
  '    if (Number.isNaN(parsed.getTime()) || parsed.toISOString() !== rawDate) {',
  '      throw new TypeError(`${label} must be a real ISO UTC timestamp.`);',
  '    }',
  "    utcDate = parsed.toISOString().slice(0, 10);",
  '  }',
  '',
  '  assertCurrentSeasonDate(utcDate, activeSeason, label);',
  '  return Object.freeze({ rawDate, utcDate });',
  '}',
  '',
].join('\n');

utility = replaceExactlyOnce(
  utility,
  'export function selectFinalGamesForDate(body, expectedDate, activeSeason) {',
  `${helper}export function selectFinalGamesForDate(body, expectedDate, activeSeason) {`,
  'selectFinalGamesForDate declaration',
);

const oldDateBlock = [
  '        const date = assertNonEmptyString(',
  '          game.date,',
  '          `games[${index}].date`,',
  '        );',
  '        assertCurrentSeasonDate(date, activeSeason, `games[${index}].date`);',
  '        if (date !== expectedDate) {',
  '          throw new RangeError(',
  '            `game ${game.id} date ${date} does not match requested date ${expectedDate}.`,',
  '          );',
  '        }',
].join('\n');

const newDateBlock = [
  '        const observedDate = normalizeProviderGameDate(',
  '          game.date,',
  '          activeSeason,',
  '          `games[${index}].date`,',
  '        );',
  '        if (observedDate.utcDate !== expectedDate) {',
  '          throw new RangeError(',
  '            `game ${game.id} UTC date ${observedDate.utcDate} from ${observedDate.rawDate} does not match requested date ${expectedDate}.`,',
  '          );',
  '        }',
].join('\n');

utility = replaceExactlyOnce(
  utility,
  oldDateBlock,
  newDateBlock,
  'provider date block',
);

utility = replaceExactlyOnce(
  utility,
  '        return Object.freeze({ id: game.id, date, status });',
  [
    '        return Object.freeze({',
    '          id: game.id,',
    '          date: observedDate.rawDate,',
    '          status,',
    '        });',
  ].join('\n'),
  'selected game return',
);

writeFileSync(utilityPath, utility);

let tests = readFileSync(testPath, 'utf8');
const timestampTest = [
  '',
  "test('accepts verified BALLDONTLIE UTC game timestamps and preserves the raw value', () => {",
  '  const selected = selectFinalGamesForDate(',
  '    {',
  '      data: [',
  '        {',
  '          id: 201,',
  "          date: '2026-07-01T19:45:00.000Z',",
  "          status: 'STATUS_FINAL',",
  '        },',
  '      ],',
  '    },',
  "    '2026-07-01',",
  '    activeSeason,',
  '  );',
  '',
  '  assert.deepEqual(selected, [',
  '    {',
  '      id: 201,',
  "      date: '2026-07-01T19:45:00.000Z',",
  "      status: 'STATUS_FINAL',",
  '    },',
  '  ]);',
  '',
  '  assert.throws(',
  '    () =>',
  '      selectFinalGamesForDate(',
  '        {',
  '          data: [',
  '            {',
  '              id: 202,',
  "              date: '2026-07-02T00:05:00.000Z',",
  "              status: 'STATUS_FINAL',",
  '            },',
  '          ],',
  '        },',
  "        '2026-07-01',",
  '        activeSeason,',
  '      ),',
  '    /does not match requested date/,',
  '  );',
  '',
  '  assert.throws(',
  '    () =>',
  '      selectFinalGamesForDate(',
  '        {',
  '          data: [',
  '            {',
  '              id: 203,',
  "              date: '2026-07-01T19:45:00.000-05:00',",
  "              status: 'STATUS_FINAL',",
  '            },',
  '          ],',
  '        },',
  "        '2026-07-01',",
  '        activeSeason,',
  '      ),',
  '    /ISO UTC timestamp ending in Z/,',
  '  );',
  '});',
  '',
].join('\n');

tests = replaceExactlyOnce(
  tests,
  "\ntest('counts only an explicit plate-appearance data array', () => {",
  `${timestampTest}test('counts only an explicit plate-appearance data array', () => {`,
  'countPlateAppearances test boundary',
);
writeFileSync(testPath, tests);

execFileSync('npm', ['run', 'test:m8-recency'], { stdio: 'inherit' });

unlinkSync(selfPath);
execFileSync('git', ['config', 'user.name', 'github-actions[bot]']);
execFileSync('git', [
  'config',
  'user.email',
  '41898282+github-actions[bot]@users.noreply.github.com',
]);
execFileSync(
  'git',
  [
    'add',
    utilityPath,
    testPath,
    'scripts/apply-m8-date-shape-fix.mjs',
  ],
  { stdio: 'inherit' },
);
execFileSync(
  'git',
  ['commit', '-m', 'Accept verified BALLDONTLIE UTC game dates'],
  { stdio: 'inherit' },
);
execFileSync(
  'git',
  ['push', 'origin', 'HEAD:agent/m8-recency-weighting'],
  { stdio: 'inherit' },
);

execFileSync('npm', ['run', 'capture:m8-current-season-pa'], {
  stdio: 'inherit',
  env: {
    ...process.env,
    M8_CAPTURE_START_DATE: '2026-07-08',
    M8_CAPTURE_END_DATE: '2026-07-08',
    M8_CAPTURE_MAX_GAMES: '1',
    M8_CAPTURE_OUTPUT_DIR:
      'artifacts/m8-current-season-pa/pilot-2026-07-08-v2',
  },
});
