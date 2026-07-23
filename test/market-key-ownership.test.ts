import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';

import {
  assertSingleSourceMarketKeyOwnership,
  DuplicateMarketKeyOwnershipError,
  MARKET_KEY_OWNERSHIP,
} from '../src/composition/registries.js';
import {
  PLANNED_MARKET_CATALOG,
  PLANNED_MARKET_KEYS,
} from '../src/composition/planned-market-catalog.js';
import type { ImplementedMarketRegistration } from '../src/domain/market.js';

function collectTypeScriptFiles(directory: string): string[] {
  const files: string[] = [];
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) {
      files.push(...collectTypeScriptFiles(path));
    } else if (entry.isFile() && entry.name.endsWith('.ts')) {
      files.push(path);
    }
  }
  return files;
}

function countExactQuotedLiteral(source: string, value: string): number {
  return (
    source.split(`'${value}'`).length -
    1 +
    (source.split(`"${value}"`).length - 1)
  );
}

test('every planned base-market key has exactly one production-source declaration', () => {
  const source = collectTypeScriptFiles(join(process.cwd(), 'src'))
    .map((path) => readFileSync(path, 'utf8'))
    .join('\n');

  for (const key of Object.values(PLANNED_MARKET_KEYS)) {
    assert.equal(
      countExactQuotedLiteral(source, key),
      1,
      `${key} must have exactly one literal declaration under src`,
    );
  }

  assert.equal(MARKET_KEY_OWNERSHIP.length, PLANNED_MARKET_CATALOG.length);
  assert.equal(new Set(MARKET_KEY_OWNERSHIP.map((entry) => entry.baseMarketKey)).size, 4);
});

test('duplicate ownership across the planned catalog and a feature manifest is rejected', () => {
  const duplicate: ImplementedMarketRegistration = Object.freeze({
    baseMarketKey: PLANNED_MARKET_KEYS.BATTER_HITS,
    providerMarketKeys: Object.freeze(['synthetic-provider-key']),
    featureId: 'synthetic-feature',
    officialSettlementStatistic: 'hits',
    mathematicalFamily: 'self-contained-hitter-pa',
    requiredNormalizedInputs: Object.freeze([]),
    requiredSharedScenarioFields: Object.freeze([]),
    distributionBuilderVersion: 'synthetic-v1',
    distributionBuilderValidated: false,
    settlementRuleVersion: 'synthetic-rule-v1',
    status: 'model-under-development',
    blocker: 'synthetic duplicate ownership test',
  });

  assert.throws(
    () => assertSingleSourceMarketKeyOwnership(PLANNED_MARKET_CATALOG, [duplicate]),
    (error: unknown) => error instanceof DuplicateMarketKeyOwnershipError,
  );
});
