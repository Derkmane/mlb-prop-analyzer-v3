# Pick6 + DraftKings ladder provider contract — v1

Captured: 2026-08-25T02:31:50.825Z

Provider: The Odds API. Secrets and request API keys are not stored.

Verified request contracts:
- Pick6: region `us_dfs`, bookmaker `pick6`.
- DraftKings Sportsbook: region `us`, bookmaker `draftkings`.
- Markets: `batter_hits`, `batter_hits_alternate`, `batter_hits_runs_rbis`, `batter_hits_runs_rbis_alternate`, `batter_total_bases`, `batter_total_bases_alternate`.
- `includeMultipliers=true`, `dateFormat=iso`, `oddsFormat=american`.

Verified JSON paths:
- event: `response`
- bookmakers: `response.bookmakers[]`
- markets: `response.bookmakers[].markets[]`
- outcomes: `response.bookmakers[].markets[].outcomes[]`

Observed live availability and shape:
```json
[
  {
    "source": "pick6",
    "region": "us_dfs",
    "bookmaker": "pick6",
    "eventId": "259b6ad0c039c2a2dd00d378d88eb549",
    "commenceTime": "2026-08-25T22:41:00Z",
    "targetOffersAvailable": false,
    "bookmakerCount": 0,
    "markets": []
  },
  {
    "source": "draftkings",
    "region": "us",
    "bookmaker": "draftkings",
    "eventId": "587e76b251f060a951bfa47ee07cf6ac",
    "commenceTime": "2026-08-25T23:08:00Z",
    "targetOffersAvailable": true,
    "bookmakerCount": 1,
    "markets": [
      {
        "key": "batter_hits",
        "outcomeCount": 36,
        "uniquePlayers": 18,
        "sides": [
          "Over",
          "Under"
        ],
        "uniquePoints": [
          0.5,
          1.5
        ],
        "exactDuplicateRows": 0,
        "pricePresence": [
          "number"
        ],
        "multiplierPresence": [
          "object"
        ],
        "sidPresence": [
          "absent"
        ]
      },
      {
        "key": "batter_hits_alternate",
        "outcomeCount": 58,
        "uniquePlayers": 18,
        "sides": [
          "Over"
        ],
        "uniquePoints": [
          0.5,
          1.5,
          2.5,
          3.5
        ],
        "exactDuplicateRows": 0,
        "pricePresence": [
          "number"
        ],
        "multiplierPresence": [
          "object"
        ],
        "sidPresence": [
          "absent"
        ]
      },
      {
        "key": "batter_hits_runs_rbis_alternate",
        "outcomeCount": 90,
        "uniquePlayers": 18,
        "sides": [
          "Over"
        ],
        "uniquePoints": [
          0.5,
          1.5,
          2.5,
          3.5,
          4.5
        ],
        "exactDuplicateRows": 0,
        "pricePresence": [
          "number"
        ],
        "multiplierPresence": [
          "object"
        ],
        "sidPresence": [
          "absent"
        ]
      },
      {
        "key": "batter_total_bases",
        "outcomeCount": 24,
        "uniquePlayers": 12,
        "sides": [
          "Over",
          "Under"
        ],
        "uniquePoints": [
          1.5
        ],
        "exactDuplicateRows": 0,
        "pricePresence": [
          "number"
        ],
        "multiplierPresence": [
          "object"
        ],
        "sidPresence": [
          "absent"
        ]
      },
      {
        "key": "batter_total_bases_alternate",
        "outcomeCount": 72,
        "uniquePlayers": 18,
        "sides": [
          "Over"
        ],
        "uniquePoints": [
          1.5,
          2.5,
          3.5,
          4.5,
          5.5
        ],
        "exactDuplicateRows": 0,
        "pricePresence": [
          "number"
        ],
        "multiplierPresence": [
          "object"
        ],
        "sidPresence": [
          "absent"
        ]
      }
    ]
  }
]
```

Contract behavior:
- Preserve source identity, event identity, provider market key, numerical point, exact posted side, price/multiplier when present, market timestamp, and snapshot lineage.
- Provider offer type comes only from exact base versus `_alternate` market key.
- Product Altline identity requires a numerically different rung from the unique same-source baseline.
- Pick6 exact duplicate tuples `(player, market, point, name)` may be deduplicated by keeping the first identical row; the observed duplication count remains diagnostic.
- Missing source availability, sides, markets, and rungs remain absent. No mirroring, synthesis, cross-source borrowing, or standard-book baseline inference.
- Price, multiplier, payout, and implied probability are evidence/display only and do not rank.
- A source returning no target offers is a normal fail-closed availability state, not permission to substitute another source.
- Forced live recapture run `32884230884` on 2026-08-25 verified that an active Pick6 bookmaker record may carry a non-null opaque `bookmaker.sid`. The exact raw response remains preserved in the immutable provider snapshot. That opaque bookmaker metadata is not interpreted as model/source identity and normalizes to `providerBookmakerSid: null`; DraftKings and historical sources continue to reject non-null source IDs unless separately verified.

Pick6 response SHA-256: `63263e9a074a94f98ab0891736f708cb509283a16d7afcf3eaca826e1249b749`
DraftKings response SHA-256: `c519c5d18bb7cf0c31762d0688e32b6599b34fe47de82408b6991f8991afb03`
