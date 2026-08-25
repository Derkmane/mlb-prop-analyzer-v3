import type { ProductionRegistrySnapshot } from '../application/market-registry-gate.js';
import type { FeatureRegistration } from '../domain/feature-status.js';
import type { ImplementedMarketRegistration, PlannedMarketDefinition } from '../domain/market.js';
import type { SettlementRegistry, SettlementRuleRegistration } from '../domain/settlement-rule.js';
import {
  BATTER_HHR_ALTERNATE_PROVIDER_MARKET_KEY,
  BATTER_HHR_BASELINE_PROVIDER_MARKET_KEY,
  BATTER_HHR_FEATURE_ID,
  BATTER_HHR_MARKET_KEY,
} from '../features/batter-hhr/manifest.js';
import {
  BATTER_HHR_DISTRIBUTION_BUILDER_VERSION,
  BATTER_HHR_DRAFTKINGS_SETTLEMENT_RULE_SOURCE_REFERENCE,
  BATTER_HHR_DRAFTKINGS_SETTLEMENT_RULE_VERSION,
  BATTER_HHR_PICK6_SETTLEMENT_RULE_SOURCE_REFERENCE,
  BATTER_HHR_PICK6_SETTLEMENT_RULE_VERSION,
  BATTER_HHR_SETTLEMENT_RULE_VERSION,
} from '../features/batter-hhr/contracts.js';
import {
  BATTER_HITS_FEATURE_ID,
  BATTER_HITS_MARKET_KEY,
} from '../features/batter-hits/manifest.js';
import { BATTER_HITS_PROVIDER_MARKET_KEYS } from '../features/batter-hits/normalized-board-offer.js';
import {
  BATTER_HITS_DRAFTKINGS_SETTLEMENT_RULE_SOURCE_REFERENCE,
  BATTER_HITS_DRAFTKINGS_SETTLEMENT_RULE_VERSION,
  BATTER_HITS_PICK6_SETTLEMENT_RULE_SOURCE_REFERENCE,
  BATTER_HITS_PICK6_SETTLEMENT_RULE_VERSION,
  BATTER_HITS_SETTLEMENT_RULE_SOURCE_REFERENCE,
  BATTER_HITS_SETTLEMENT_RULE_VERSION,
} from '../features/batter-hits/settlement.js';
import { PLANNED_MARKET_CATALOG } from './planned-market-catalog.js';

export const SETTLEMENT_REGISTRY_VERSION = 'settlement-registry-v6';
const HHR_INPUTS = Object.freeze([
  'context-adjusted-terminal-outcome-vector','expected-plate-appearances','lineup-slot','platoon-split-cell',
  'opposing-starter-pooling','team-implied-run-total','preceding-lineup-slots-on-base-quality',
]);
const HISTORICAL_UNDERDOG_HHR_SETTLEMENT_RULE_SOURCE_REFERENCE =
  'fixtures/sanitized/m11/hhr/settlement/underdog-batter-hhr-settlement-v1.json';

const BATTER_HITS_DRAFTKINGS_SETTLEMENT_RULE = Object.freeze({
  version: BATTER_HITS_DRAFTKINGS_SETTLEMENT_RULE_VERSION,
  boardSource: 'draftkings',
  baseMarketKey: BATTER_HITS_MARKET_KEY,
  officialSettlementStatistic: 'hits',
  startRequirement: 'DraftKings Sportsbook pregame position-player props require the player to be listed in the official starting lineup and Participate.',
  minimumParticipation: 'DraftKings defines position-player Participation as recording at least one plate appearance.',
  reliefAppearanceHandling: 'A position player who does not start but later enters as a substitute is void for a DraftKings Sportsbook pregame player prop.',
  intentionalWalkHandling: 'No separate Hits intentional-walk exception changes the official MLB Hits statistic; settle the official Hits statistic.',
  tieHandling: 'An exact tie with the posted projection is a push/void; half-point lines cannot tie.',
  postponementHandling: 'Apply the official DraftKings Baseball and General Rules for postponed games; do not substitute another operator rule.',
  suspensionHandling: 'Apply the official DraftKings Baseball and General Rules for suspended or shortened games; do not substitute another operator rule.',
  voidConditions: Object.freeze([
    'batter not listed in the official starting lineup',
    'batter records no plate appearance',
    'observed hits equals an integer posted projection',
    'DraftKings Baseball or General Rules require the pregame player prop to be void',
  ]),
  sourcePublishedAt: '2025-08-26',
  ruleSourceReference: BATTER_HITS_DRAFTKINGS_SETTLEMENT_RULE_SOURCE_REFERENCE,
}) satisfies SettlementRuleRegistration;

const HHR_DRAFTKINGS_SETTLEMENT_RULE = Object.freeze({
  version: BATTER_HHR_DRAFTKINGS_SETTLEMENT_RULE_VERSION,
  boardSource: 'draftkings',
  baseMarketKey: BATTER_HHR_MARKET_KEY,
  officialSettlementStatistic: 'hits+runs+rbis',
  startRequirement: 'DraftKings Sportsbook pregame position-player props require the player to be listed in the official starting lineup and Participate.',
  minimumParticipation: 'DraftKings defines position-player Participation as recording at least one plate appearance.',
  reliefAppearanceHandling: 'A position player who does not start but later enters as a substitute is void for a DraftKings Sportsbook pregame player prop.',
  intentionalWalkHandling: 'No separate H+R+RBI intentional-walk exception changes the official MLB component statistics; settle official Hits + Runs + RBIs.',
  tieHandling: 'An exact tie with the posted projection is a push/void; half-point lines cannot tie.',
  postponementHandling: 'Apply the official DraftKings Baseball and General Rules for postponed games; do not substitute another operator rule.',
  suspensionHandling: 'Apply the official DraftKings Baseball and General Rules for suspended or shortened games; do not substitute another operator rule.',
  voidConditions: Object.freeze([
    'batter not listed in the official starting lineup',
    'batter records no plate appearance',
    'observed hits+runs+rbis equals an integer posted projection',
    'DraftKings Baseball or General Rules require the pregame player prop to be void',
  ]),
  sourcePublishedAt: '2025-08-26',
  ruleSourceReference: BATTER_HHR_DRAFTKINGS_SETTLEMENT_RULE_SOURCE_REFERENCE,
}) satisfies SettlementRuleRegistration;

const BATTER_HITS_PICK6_SETTLEMENT_RULE = Object.freeze({
  version: BATTER_HITS_PICK6_SETTLEMENT_RULE_VERSION,
  boardSource: 'pick6',
  baseMarketKey: BATTER_HITS_MARKET_KEY,
  officialSettlementStatistic: 'hits',
  startRequirement: 'Ordinary Pick6 MLB Hits uses the batting-stat minimum-play rule rather than a separate starting-lineup requirement; the app remains pregame starter-scoped under its own lineup eligibility boundary.',
  minimumParticipation: 'The player must record at least one plate appearance for the batting-stat pick to meet Pick6 minimum play requirements.',
  reliefAppearanceHandling: 'A player who records at least one plate appearance can satisfy the ordinary batting-stat minimum-play rule; the app does not broaden its pregame starter-scoped candidate pool on this basis.',
  intentionalWalkHandling: 'No separate Hits intentional-walk exception changes the official Hits statistic; settle the official statistic supplied by DraftKings scoring.',
  tieHandling: 'If the final Hits result exactly matches the projection line, the pick is void regardless of selected outcome.',
  postponementHandling: 'Only statistics from games declared Official Games within the Pick Group Scoring Period count; otherwise affected picks are void under the Pick6 MLB rule.',
  suspensionHandling: 'Suspended or shortened games follow the Pick6 MLB Scoring Period and Official Game definitions; statistics outside the Scoring Period do not count.',
  voidConditions: Object.freeze([
    'batter records no plate appearance',
    'observed hits equals the posted projection',
    'the game does not become an Official Game within the Pick Group Scoring Period',
    'for a More full-game hitter pick, Pick6 Pardon applies when the hitter exits early before recording a second plate appearance',
  ]),
  sourceVerifiedAt: '2026-08-25T21:03:38Z',
  ruleSourceReference: BATTER_HITS_PICK6_SETTLEMENT_RULE_SOURCE_REFERENCE,
}) satisfies SettlementRuleRegistration;

const HHR_PICK6_SETTLEMENT_RULE = Object.freeze({
  version: BATTER_HHR_PICK6_SETTLEMENT_RULE_VERSION,
  boardSource: 'pick6',
  baseMarketKey: BATTER_HHR_MARKET_KEY,
  officialSettlementStatistic: 'hits+runs+rbis',
  startRequirement: 'Ordinary Pick6 MLB Hits + Runs + RBIs uses the batting-stat minimum-play rule rather than a separate starting-lineup requirement; the app remains pregame starter-scoped under its own lineup eligibility boundary.',
  minimumParticipation: 'The player must record at least one plate appearance for the batting-stat pick to meet Pick6 minimum play requirements.',
  reliefAppearanceHandling: 'A player who records at least one plate appearance can satisfy the ordinary batting-stat minimum-play rule; the app does not broaden its pregame starter-scoped candidate pool on this basis.',
  intentionalWalkHandling: 'No separate H+R+RBI intentional-walk exception changes the official component statistics; settle official Hits + Runs + RBIs supplied by DraftKings scoring.',
  tieHandling: 'If the final Hits + Runs + RBIs result exactly matches the projection line, the pick is void regardless of selected outcome.',
  postponementHandling: 'Only statistics from games declared Official Games within the Pick Group Scoring Period count; otherwise affected picks are void under the Pick6 MLB rule.',
  suspensionHandling: 'Suspended or shortened games follow the Pick6 MLB Scoring Period and Official Game definitions; statistics outside the Scoring Period do not count.',
  voidConditions: Object.freeze([
    'batter records no plate appearance',
    'observed hits+runs+rbis equals the posted projection',
    'the game does not become an Official Game within the Pick Group Scoring Period',
    'for a More full-game hitter pick, Pick6 Pardon applies when the hitter exits early before recording a second plate appearance',
  ]),
  sourceVerifiedAt: '2026-08-25T21:03:38Z',
  ruleSourceReference: BATTER_HHR_PICK6_SETTLEMENT_RULE_SOURCE_REFERENCE,
}) satisfies SettlementRuleRegistration;

const BATTER_HITS_HISTORICAL_UNDERDOG_SETTLEMENT_RULE = Object.freeze({
  version: BATTER_HITS_SETTLEMENT_RULE_VERSION,
  boardSource: null,
  baseMarketKey: BATTER_HITS_MARKET_KEY,
  officialSettlementStatistic: 'hits',
  startRequirement: 'MLB batter must appear in the official starting lineup for the pick to grade.',
  minimumParticipation: 'No separate Batter Hits plate-appearance minimum is stated after the official-start requirement; a player who plays and exits early remains valid.',
  reliefAppearanceHandling: 'A batter absent from the official starting lineup remains void even if entering later as a pinch hitter or substitute.',
  intentionalWalkHandling: 'No separate Batter Hits intentional-walk settlement exception is stated; settle the official Hits statistic.',
  tieHandling: 'A selection that ties its posted projection is void.',
  postponementHandling: 'A baseball game postponed before starting is void unless played on the originally scheduled local calendar day.',
  suspensionHandling: 'If suspended after starting, grade when resumed within 36 hours; otherwise void unless the outcome was unequivocally determined before suspension.',
  voidConditions: Object.freeze([
    'batter absent from the official starting lineup',
    'observed hits equals the posted projection',
    'game postponed before starting and not played on the originally scheduled local calendar day',
    'game suspended after starting, not resumed within 36 hours, and outcome not unequivocally determined before suspension',
    'scheduled venue changed after entry',
    'player projection associated with the incorrect team',
    'pick used after the game or event started',
    'operator-determined projection error',
  ]),
  sourcePublishedAt: '2026-06-22',
  ruleSourceReference: BATTER_HITS_SETTLEMENT_RULE_SOURCE_REFERENCE,
}) satisfies SettlementRuleRegistration;

const HHR_HISTORICAL_UNDERDOG_SETTLEMENT_RULE = Object.freeze({
  version: BATTER_HHR_SETTLEMENT_RULE_VERSION,
  boardSource: null,
  baseMarketKey: BATTER_HHR_MARKET_KEY,
  officialSettlementStatistic: 'hits+runs+rbis',
  startRequirement: 'MLB batter must appear in the official starting lineup for the pick to grade.',
  minimumParticipation: 'No separate HHR plate-appearance minimum is stated after the official-start requirement; a player who plays and exits early remains valid.',
  reliefAppearanceHandling: 'A batter absent from the official starting lineup remains void even if entering later as a pinch hitter or substitute.',
  intentionalWalkHandling: 'No separate HHR intentional-walk settlement exception is stated; settle the cumulative hits+runs+rbis statistic.',
  tieHandling: 'A selection that ties its posted projection is void.',
  postponementHandling: 'A baseball game postponed before starting is void unless played on the originally scheduled local calendar day.',
  suspensionHandling: 'If suspended after starting, grade when resumed within 36 hours; otherwise void unless the outcome was unequivocally determined before suspension.',
  voidConditions: Object.freeze([
    'batter absent from the official starting lineup',
    'observed hits+runs+rbis equals the posted projection',
    'game postponed before starting and not played on the originally scheduled local calendar day',
    'game suspended after starting, not resumed within 36 hours, and outcome not unequivocally determined before suspension',
    'scheduled venue changed after entry',
    'player projection associated with the incorrect team',
    'pick used after the game or event started',
    'operator-determined projection error',
  ]),
  sourcePublishedAt: '2026-06-22',
  ruleSourceReference: HISTORICAL_UNDERDOG_HHR_SETTLEMENT_RULE_SOURCE_REFERENCE,
}) satisfies SettlementRuleRegistration;

const implementedMarketRegistrations = [
  {
    baseMarketKey: BATTER_HITS_MARKET_KEY,
    providerMarketKeys: Object.freeze([...BATTER_HITS_PROVIDER_MARKET_KEYS]),
    featureId: BATTER_HITS_FEATURE_ID,
    officialSettlementStatistic: 'hits',
    mathematicalFamily: 'self-contained-hitter-pa',
    requiredNormalizedInputs: Object.freeze([]),
    requiredSharedScenarioFields: Object.freeze(['GameScenarioSet']),
    distributionBuilderVersion: 'm9-batter-hits-runtime-distribution-v1',
    distributionBuilderValidated: false,
    settlementRuleVersion: BATTER_HITS_DRAFTKINGS_SETTLEMENT_RULE_VERSION,
    status: 'model-under-development',
    blocker: 'M8.5 D_final passed untouched acceptance, but the canonical production calibration method, pooling strength, minimum reporting volume, recalibration schedule, and explicit production authorization remain incomplete.',
  },
  {
    baseMarketKey: BATTER_HHR_MARKET_KEY,
    providerMarketKeys: Object.freeze([BATTER_HHR_BASELINE_PROVIDER_MARKET_KEY, BATTER_HHR_ALTERNATE_PROVIDER_MARKET_KEY]),
    featureId: BATTER_HHR_FEATURE_ID,
    officialSettlementStatistic: 'hits+runs+rbis',
    mathematicalFamily: 'directly-fitted-composite',
    requiredNormalizedInputs: HHR_INPUTS,
    requiredSharedScenarioFields: HHR_INPUTS,
    distributionBuilderVersion: BATTER_HHR_DISTRIBUTION_BUILDER_VERSION,
    distributionBuilderValidated: false,
    settlementRuleVersion: BATTER_HHR_DRAFTKINGS_SETTLEMENT_RULE_VERSION,
    status: 'model-under-development',
    blocker: 'M11 step 3 box-score verification, per-line calibration including deep-line buckets, and production authorization are incomplete.',
  },
] satisfies readonly ImplementedMarketRegistration[];
export const IMPLEMENTED_MARKET_REGISTRY: readonly ImplementedMarketRegistration[] = Object.freeze(
  implementedMarketRegistrations.map((registration) => Object.freeze(registration)),
);

const featureRegistrations = [
  { featureId: BATTER_HITS_FEATURE_ID, enabled: false, status: 'model-under-development' },
  { featureId: BATTER_HHR_FEATURE_ID, enabled: false, status: 'model-under-development' },
] satisfies readonly FeatureRegistration[];
export const FEATURE_REGISTRY: readonly FeatureRegistration[] = Object.freeze(
  featureRegistrations.map((registration) => Object.freeze(registration)),
);
export const SETTLEMENT_REGISTRY: SettlementRegistry = Object.freeze({
  version: SETTLEMENT_REGISTRY_VERSION,
  rules: Object.freeze([
    BATTER_HITS_DRAFTKINGS_SETTLEMENT_RULE,
    HHR_DRAFTKINGS_SETTLEMENT_RULE,
    BATTER_HITS_PICK6_SETTLEMENT_RULE,
    HHR_PICK6_SETTLEMENT_RULE,
    BATTER_HITS_HISTORICAL_UNDERDOG_SETTLEMENT_RULE,
    HHR_HISTORICAL_UNDERDOG_SETTLEMENT_RULE,
  ]),
});
export const PRODUCTION_REGISTRIES: ProductionRegistrySnapshot = Object.freeze({
  implementedMarkets: IMPLEMENTED_MARKET_REGISTRY,
  features: FEATURE_REGISTRY,
  settlementRegistry: SETTLEMENT_REGISTRY,
});

export interface MarketKeyOwnership {
  readonly baseMarketKey: string;
  readonly ownerType: 'planned-market-catalog' | 'feature-manifest';
  readonly ownerId: string;
}
export class DuplicateMarketKeyOwnershipError extends Error {
  readonly baseMarketKey: string;
  constructor(baseMarketKey: string) {
    super(`Market key ${baseMarketKey} has more than one canonical owner.`);
    this.name = 'DuplicateMarketKeyOwnershipError';
    this.baseMarketKey = baseMarketKey;
  }
}
export function assertSingleSourceMarketKeyOwnership(
  plannedMarkets: readonly PlannedMarketDefinition[],
  implementedMarkets: readonly ImplementedMarketRegistration[],
): readonly MarketKeyOwnership[] {
  const ownership = new Map<string, MarketKeyOwnership>();
  for (const market of plannedMarkets) {
    if (ownership.has(market.baseMarketKey)) throw new DuplicateMarketKeyOwnershipError(market.baseMarketKey);
    ownership.set(market.baseMarketKey, Object.freeze({ baseMarketKey: market.baseMarketKey, ownerType: 'planned-market-catalog', ownerId: 'planned-market-catalog' }));
  }
  for (const market of implementedMarkets) {
    if (ownership.has(market.baseMarketKey)) throw new DuplicateMarketKeyOwnershipError(market.baseMarketKey);
    ownership.set(market.baseMarketKey, Object.freeze({ baseMarketKey: market.baseMarketKey, ownerType: 'feature-manifest', ownerId: market.featureId }));
  }
  return Object.freeze([...ownership.values()]);
}
export const MARKET_KEY_OWNERSHIP = assertSingleSourceMarketKeyOwnership(PLANNED_MARKET_CATALOG, IMPLEMENTED_MARKET_REGISTRY);
