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

The first-party rule page was directly reverified at `2026-08-25T21:03:38Z`. The page exposed no operator-designated effective date and no publication/version date. Under `CANONICAL_MATH_SPEC.md` Version 1.17, this exact timestamp is stored as the `sourceVerifiedAt` observation boundary. It may authorize only predictions evaluated at or after that timestamp and may not be used to infer or backdate an earlier Pick6 rule.

Verified current rule content:

- Hits and Hits + Runs + RBIs are supported batting stats.
- If the final result exactly equals the posted projection, the pick is void regardless of selected outcome.
- Ordinary MLB batting-stat picks require at least one plate appearance to meet minimum play requirements.
- Pick6 Pardon applies to a **More** full-game hitter pick when the hitter exits early before recording a second plate appearance; qualifying picks are void. The policy is side-specific and does not apply to Less picks.
- Canceled, postponed, suspended, and shortened games are governed by the Pick6 MLB Scoring Period and Official Game rules on the same first-party page.
- Pick stats and More/Less outcomes are intended to align with final game box scores at Pick6 payout finalization, using DraftKings' official scoring validation process and official third-party stat providers.

Repository rule IDs:

- `draftkings-pick6-batter-hits-2026-08-25-v1`
- `draftkings-pick6-batter-hhr-2026-08-25-v1`

### Research-ranking eligibility boundary

Temporal registration does **not** solve the Pick6 Pardon eligibility event. The active model does not currently represent the event that a hitter exits early before recording a second plate appearance. Therefore:

- Pick6 **More/Higher** full-game hitter offers remain fail-closed for research ranking under the current eligibility model.
- Pick6 **Less/Lower** offers may use the verified ordinary batting-stat settlement contract when every other research-ranking requirement is satisfied.
- No More/Higher void probability is invented, approximated, copied from DraftKings Sportsbook, or treated as zero.
- The source-specific settlement registration may be preserved in captured evidence even when an affected More/Higher offer remains ineligible for ranking.

This preserves the Pick6 board and ladder evidence while keeping the side-specific Pardon policy fail-closed until a verified eligibility model represents it.
