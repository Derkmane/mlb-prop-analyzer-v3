import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

test('HHR final grader uses the verified exact BALLDONTLIE single-game endpoint', async () => {
  const script = await readFile('scripts/grade-m10-hhr-pending-archives.mjs', 'utf8');
  const fetchGamesStart = script.indexOf('async function fetchGames(gameIds)');
  const fetchStatsStart = script.indexOf('async function fetchStatsForGames(gameIds)');
  assert.ok(fetchGamesStart >= 0);
  assert.ok(fetchStatsStart > fetchGamesStart);
  const fetchGamesBlock = script.slice(fetchGamesStart, fetchStatsStart);

  assert.match(fetchGamesBlock, /for \(const gameId of gameIds\)/u);
  assert.match(
    fetchGamesBlock,
    /https:\/\/api\.balldontlie\.io\/mlb\/v1\/games\/\$\{gameId\}/u,
  );
  assert.match(fetchGamesBlock, /data must be an object/u);
  assert.match(fetchGamesBlock, /rows\.push\(game\)/u);
  assert.doesNotMatch(fetchGamesBlock, /searchParams\.append\('ids\[\]'/u);
  assert.doesNotMatch(fetchGamesBlock, /searchParams\.set\('per_page'/u);
});
