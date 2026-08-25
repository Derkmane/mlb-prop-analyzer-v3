import type { BoardSource } from './board-source.js';

export type SettlementRuleRegistration = {
  readonly version: string;
  /** Active sources are pick6/draftkings; null is reserved for explicit historical-only rule registrations. */
  readonly boardSource: BoardSource;
  readonly baseMarketKey: string;
  readonly officialSettlementStatistic: string;
  readonly startRequirement: string;
  readonly minimumParticipation: string;
  readonly reliefAppearanceHandling: string;
  readonly intentionalWalkHandling: string;
  readonly tieHandling: string;
  readonly postponementHandling: string;
  readonly suspensionHandling: string;
  readonly voidConditions: readonly string[];
  readonly ruleSourceReference: string;
} & (
  | {
      readonly effectiveDate: string;
      readonly sourcePublishedAt?: never;
      readonly sourceVerifiedAt?: never;
    }
  | {
      readonly sourcePublishedAt: string;
      readonly effectiveDate?: never;
      readonly sourceVerifiedAt?: never;
    }
  | {
      readonly sourceVerifiedAt: string;
      readonly effectiveDate?: never;
      readonly sourcePublishedAt?: never;
    }
);

export interface SettlementRegistry {
  readonly version: string;
  readonly rules: readonly SettlementRuleRegistration[];
}
