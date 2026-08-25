# DraftKings MLB settlement contract v1

Captured for the active MLB Prop Analyzer V3 source switch on 2026-08-24 America/Chicago (provider verification occurred across the UTC date boundary on 2026-08-25).

## DraftKings Sportsbook (`us` / `draftkings`)

Official source: `https://sportsbook.draftkings.com/help/sport-rules/baseball`

The official Baseball Rules page states **As of August 26, 2025**. This is the verified rule-version publication boundary for repository registration; it is not represented as an operator-designated effective date.

Relevant normalized rules for pregame single-game batter props:

- Position-player Participation means recording at least one plate appearance, as determined by the game's official governing body.
- A pregame player-prop selection must both start the game and Participate. A substitute who did not start is void.
- A batter starts for settlement when listed in the starting lineup in the official box score.
- Official game/statistic handling follows the DraftKings Baseball Sport Rules and higher-precedence General Rules.
- Total Bases counts singles as one, doubles as two, triples as three, and home runs as four; other ways of reaching base do not count.

For Batter Hits and Hits + Runs + RBIs, the settlement statistic remains the official MLB box-score statistic already defined by the canonical market model. Half-point ladders have no equality outcome. Integer-line equality is a push/void under the general push settlement contract; exact source/bet-slip language remains authoritative if DraftKings changes a market-specific rule.

Repository rule IDs:

- `draftkings-sportsbook-batter-hits-2025-08-26-v1`
- `draftkings-sportsbook-batter-hhr-2025-08-26-v1`

## DraftKings Pick6 (`us_dfs` / `pick6`)

Official source: `https://pick6.draftkings.com/pick6-rules-and-scoring-mlb`

Verified current rule content:

- Hits and Hits + Runs + RBIs are supported batting stats.
- Exact equality with the posted projection is void.
- Ordinary MLB batting-stat picks require at least one plate appearance.
- Pick6 Pardon applies to **More** full-game hitter picks when a hitter exits early before recording a second plate appearance; qualifying picks are voided under that policy.
- Canceled/postponed/suspended/shortened-game treatment is governed by the Pick6 MLB Scoring Period and Official Game rules on the same page.

### Temporal registration gate

The official Pick6 MLB rules page exposed by the verified source contains neither an operator-designated effective date nor a rule-version publication date. `CANONICAL_MATH_SPEC.md` §12.1 prohibits settlement-rule registration when neither temporal boundary is supplied.

Therefore Pick6 remains an approved board source and may be captured as unavailable/available evidence, but **Pick6 offers fail closed before research ranking** until an official temporal boundary is verified. No DraftKings Sportsbook rule, Underdog rule, inferred date, crawl date, or capture date may be substituted.

This is intentional fail-closed behavior, not a provider fallback.
