import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

import { authorizeActiveSourceOfferForResearch } from '../scripts/active-source-settlement-authorization.mjs';

const SOURCE_VERIFIED_AT = '2026-08-25T21:03:38Z';
const registry = Object.freeze({
  rules: Object.freeze([
    Object.freeze({
      version: 'pick6-hits-v1',
      boardSource: 'pick6',
      baseMarketKey: 'batter-hits',
      sourceVerifiedAt: SOURCE_VERIFIED_AT,
    }),
    Object.freeze({
      version: 'draftkings-hits-v1',
      boardSource: 'draftkings',
      baseMarketKey: 'batter-hits',
      sourcePublishedAt: '2025-08-26',
    }),
  ]),
});

function offer(overrides = {}) {
  return Object.freeze({
    boardSource: 'pick6',
    providerBookmakerKey: 'pick6',
    providerRegion: 'us_dfs',
    settlementRuleVersion: 'pick6-hits-v1',
    baseMarketKey: 'batter-hits',
    selectedSide: 'lower',
    ...overrides,
  });
}

test('Pick6 Lower is authorized only at or after sourceVerifiedAt while Higher remains Pardon-blocked', () => {
  assert.deepEqual(
    authorizeActiveSourceOfferForResearch({
      settlementRegistry: registry,
      offer: offer(),
      evaluatedAt: '2026-08-25T21:03:37Z',
    }),
    Object.freeze({
      authorized: false,
      reason: 'pick6-settlement-rule-temporal-evidence-unavailable',
    }),
  );

  const lower = authorizeActiveSourceOfferForResearch({
    settlementRegistry: registry,
    offer: offer(),
    evaluatedAt: SOURCE_VERIFIED_AT,
  });
  assert.equal(lower.authorized, true);
  assert.equal(lower.boardSource, 'pick6');
  assert.equal(lower.temporalBoundaryKind, 'sourceVerifiedAt');

  assert.deepEqual(
    authorizeActiveSourceOfferForResearch({
      settlementRegistry: registry,
      offer: offer({ selectedSide: 'higher' }),
      evaluatedAt: '2026-08-25T21:03:39Z',
    }),
    Object.freeze({
      authorized: false,
      reason: 'pick6-pardon-eligibility-unmodeled',
    }),
  );
});

test('DraftKings active-source identity remains authorized and source mismatches fail closed', () => {
  const draftkings = authorizeActiveSourceOfferForResearch({
    settlementRegistry: registry,
    offer: offer({
      boardSource: 'draftkings',
      providerBookmakerKey: 'draftkings',
      providerRegion: 'us',
      settlementRuleVersion: 'draftkings-hits-v1',
      selectedSide: 'higher',
    }),
    evaluatedAt: '2026-08-25T21:03:39Z',
  });
  assert.equal(draftkings.authorized, true);

  assert.deepEqual(
    authorizeActiveSourceOfferForResearch({
      settlementRegistry: registry,
      offer: offer({ providerRegion: 'us' }),
      evaluatedAt: '2026-08-25T21:03:39Z',
    }),
    Object.freeze({ authorized: false, reason: 'active-source-identity-mismatch' }),
  );
});

test('Hits/HHR archivers use the shared gate and candidate archive identity preserves bookmaker source', async () => {
  const [hits, hhr, archiveUtils] = await Promise.all([
    readFile('scripts/archive-m9-batter-hits-board.mjs', 'utf8'),
    readFile('scripts/archive-m10-batter-hhr-board.mjs', 'utf8'),
    readFile('scripts/m9-board-archive-utils.mjs', 'utf8'),
  ]);

  assert.match(hits, /authorizeActiveSourceOfferForResearch/u);
  assert.doesNotMatch(hits, /reason: 'pick6-settlement-rule-temporal-evidence-unavailable'/u);
  assert.match(hhr, /authorizeActiveSourceOfferForResearch/u);
  assert.doesNotMatch(
    hhr,
    /if \(source\.boardSource === 'pick6'\)[\s\S]{0,1200}reason: 'pick6-settlement-rule-temporal-evidence-unavailable'/u,
  );
  assert.match(
    archiveUtils,
    /function candidateKey\(candidate\)[\s\S]*details\.providerBookmakerKey,[\s\S]*details\.providerMarketKey/u,
  );
});
