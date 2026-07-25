import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';

import {
  assertSingleSourceMarketKeyOwnership,
  DuplicateMarketKeyOwnershipError,
  FEATURE_REGISTRY,
  IMPLEMENTED_MARKET_REGISTRY,
  MARKET_KEY_OWNERSHIP,
  SETTLEMENT_REGISTRY,
} from '../src/composition/registries.js';
import {
  PLANNED_MARKET_CATALOG,
  PLANNED_MARKET_KEYS,
} from '../src/composition/planned-market-catalog.js';
import type { ImplementedMarketRegistration } from '../src/domain/market.js';
import {
  BATTER_HITS_FEATURE_ID,
  BATTER_HITS_MARKET_KEY,
} from '../src/features/batter-hits/manifest.js';

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

test('every base-market key has exactly one canonical production-source declaration', () => {
  const source = collectTypeScriptFiles(join(process.cwd(), 'src'))
    .map((path) => readFileSync(path, 'utf8'))
    .join('\n');
  const canonicalMarketKeys = [
    ...Object.values(PLANNED_MARKET_KEYS),
    BATTER_HITS_MARKET_KEY,
  ];

  for (const key of canonicalMarketKeys) {
    assert.equal(
      countExactQuotedLiteral(source, key),
      1,
      `${key} must have exactly one literal declaration under src`,
    );
  }

  assert.equal(PLANNED_MARKET_CATALOG.length, 3);
  assert.equal(IMPLEMENTED_MARKET_REGISTRY.length, 1);
  assert.equal(MARKET_KEY_OWNERSHIP.length, 4);
  assert.equal(new Set(MARKET_KEY_OWNERSHIP.map((entry) => entry.baseMarketKey)).size, 4);
  assert.deepEqual(
    MARKET_KEY_OWNERSHIP.find(
      (entry) => entry.baseMarketKey === BATTER_HITS_MARKET_KEY,
    ),
    {
      baseMarketKey: BATTER_HITS_MARKET_KEY,
      ownerType: 'feature-manifest',
      ownerId: BATTER_HITS_FEATURE_ID,
    },
  );
});

test('implemented Batter Hits remains disabled and fails closed for production', () => {
  assert.deepEqual(FEATURE_REGISTRY, [
    {
      featureId: BATTER_HITS_FEATURE_ID,
      enabled: false,
      status: 'model-under-development',
    },
  ]);

  assert.deepEqual(IMPLEMENTED_MARKET_REGISTRY, [
    {
      baseMarketKey: BATTER_HITS_MARKET_KEY,
      providerMarketKeys: [],
      featureId: BATTER_HITS_FEATURE_ID,
      officialSettlementStatistic: 'hits',
      mathematicalFamily: 'self-contained-hitter-pa',
      requiredNormalizedInputs: [],
      requiredSharedScenarioFields: ['GameScenarioSet'],
      distributionBuilderVersion: 'batter-hits-synthetic-v1',
      distributionBuilderValidated: false,
      settlementRuleVersion: 'batter-hits-settlement-not-production-validated',
      status: 'model-under-development',
      blocker:
        'Batter Hits is synthetic-test-only; no provider contract, production distribution fit, validated settlement rule, or production prediction authorization exists.',
    },
  ]);
  assert.deepEqual(SETTLEMENT_REGISTRY.rules, []);
});

test('duplicate ownership across the planned catalog and a feature manifest is rejected', () => {
  const duplicate: ImplementedMarketRegistration = Object.freeze({
    baseMarketKey: PLANNED_MARKET_KEYS.BATTER_TOTAL_BASES,
    providerMarketKeys: Object.freeze(['synthetic-provider-key']),
    featureId: 'synthetic-feature',
    officialSettlementStatistic: 'total-bases',
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
