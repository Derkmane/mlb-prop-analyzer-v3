# MLB Prop Analyzer — Canonical Math & Statistics Reference

**Version:** 1.6
**Status:** Canonical probability mathematics
**Empirical status:** Mathematical framework verified where marked; predictive accuracy not yet validated

---

## 1. Honesty standard

Two different claims must remain separate:

### Mathematically verified

A formula, identity, dynamic-programming implementation, or worked example has been checked for internal arithmetic and coherence.

### Empirically validated

A model has been fitted and tested chronologically against real current-season outcomes.

A mathematically coherent model is not automatically a good baseball predictor. Placeholder inputs may be used only for mathematical tests and must never be presented as fitted production probabilities.

---

## 2. Golden Rule and core principles

### Golden Rule

The model exists to identify the eligible pick with the highest probability that its **selected side wins**, within each approved category.

The model does not reward player performance in the abstract. It rewards only probability movement toward the posted side winning.

1. Produce one explicit side-aware probability for each prop.
2. Model the distribution of the official settlement statistic before applying Higher or Lower settlement logic.
3. Treat every factor directionally: an upward shift helps Higher and hurts Lower; a downward shift helps Lower and hurts Higher.
4. Never label a factor as globally positive or negative without reference to the selected side.
5. Keep calculations in baseball units until settlement.
6. Use deterministic runtime calculations.
7. Use exact discrete distributions for self-contained markets.
8. Use one shared game structure per game.
9. Derive Hits and Total Bases from the same per-PA categorical outcomes.
10. Rank only by side-specific conditional win probability among graded picks.
11. Keep win, loss, and void probabilities distinct.
12. Never silently invent coefficients.
13. Never substitute a booster total, risk score, player-quality label, or Over/Lower preference for the actual side-aware probability.

---

## 3. Universal terminal plate-appearance outcome vector

All foundational rates are per plate appearance, never per at-bat.

The terminal PA categories must be mutually exclusive and collectively exhaustive.

A canonical conceptual vector is:

```text
K
UBB
IBB
HBP
1B
2B
3B
HR
ROE
FC
SF
SH
BIP_OUT
CATCHER_INTERFERENCE
OTHER_PA
```

Definitions:

- `UBB` means unintentional walk.
- `BIP_OUT` excludes separately represented `FC`, `SF`, and `SH`.
- Raw API events must be mapped into exactly one terminal PA category.
- The normalized vector must sum to 1 within tolerance.

Baserunning events are a separate event layer:

```text
SB
CS
PICKOFF
OTHER_BASERUNNING
```

A stolen base is not a terminal plate-appearance outcome and must not be placed inside the PA vector.

Market adapters combine the terminal PA categories as needed:

```text
Hits        = 1B + 2B + 3B + HR
Total Bases = 1×1B + 2×2B + 3×3B + 4×HR
```

---

## 4. Current-season baseline rates

**Current-season-only policy approved; exact weighting and pooling definitions still require fitting and versioning.**

Each player's per-PA categorical vector may use only observations from the active MLB regular season.

The approved structure may use:

- current-season plate appearances only
- recency weighting within the current season
- one coherent current-season partial-pooling method
- continuous current-season platoon partial pooling

Do not use:

- any prior MLB season
- career statistics
- Marcel or any other multi-season estimator
- age curves that import expectations from prior seasons
- prior-season priors or regression targets
- batting average as a per-PA hit probability
- raw last-five-game overrides
- raw batter-versus-pitcher samples as a production factor
- hard sample-size cutoffs for platoon splits

### Single-shrinkage rule

A fitted hierarchical or random-effects model already performs partial pooling. Do not apply a second player-to-league shrinkage step to parameters that have already been partially pooled by that model.

Use exactly one coherent talent-estimation path for each modeled parameter:

```text
raw current-season observations
→ one approved hierarchical or explicit pooling model
→ fitted player and matchup probabilities
```

An explicit weighted player-to-league pooling formula may be used only when it is the approved pooling model for that parameter, not as an additional post-fit adjustment to a hierarchical estimate.

Probability calibration is a separate operation from talent shrinkage. Approved calibration may be applied after the baseball model because it corrects probability reliability rather than estimating player talent again.

### Current-season platoon partial pooling

Player-specific current-season handedness performance may shrink continuously toward:

```text
player current-season overall talent + current-season league platoon effect
```

Small current-season samples remain close to the current-season pooled estimate. Larger current-season samples receive more player-specific weight while retaining some current-season pooling.

Prior-season information may not be used to fill a small or missing current-season sample. When current-season evidence is insufficient, the affected model component must remain explicitly insufficient or unvalidated.

Still requiring fitted definitions:

- within-current-season recency weights
- the single approved current-season pooling structure by outcome
- current-season platoon interaction structure
- minimum current-season evidence and fail-closed behavior

---

## 5. Matchup combination

### 5.1 Binary log5 benchmark — verified identities

For a single binary outcome:

```text
b = batter rate
p = pitcher-allowed rate
l = league rate
```

Combine them using:

```text
e = (b·p/l) / [ (b·p/l) + ((1−b)(1−p)/(1−l)) ]
```

Verified identities:

```text
if p = l, then e = b
if b = l, then e = p
if b = p = l, then e = l
```

Binary log5 remains a permanent validation benchmark for Hit versus No Hit.

### 5.2 Coherent categorical production model

Do not independently run binary log5 for every outcome category and renormalize.

Production must use one coherent hierarchical or multinomial model that outputs the complete terminal PA vector at once.

That single vector feeds Hits, Total Bases, and every other self-contained PA-based market.

Still requiring an explicit fitted definition:

- hierarchy or multinomial structure
- linear predictors
- regularization
- fitting method
- rare-outcome treatment
- calibration checks for HR and 3B

---

## 6. Environmental adjustments

Environmental effects belong inside the categorical model's predictors or another explicitly defined probabilistic layer.

Do not apply arbitrary percentage-point bonuses.

Required conceptual treatment:

- park effects are handedness- and outcome-specific
- neutralize current-season player context before applying the game environment when necessary
- defense affects balls in play, not K, BB, HBP, or HR
- weather coefficients must be learned and validated
- no environmental effect may be double-applied

Only approved and versioned inputs may be used.

Still requiring fitted definitions:

- park neutralization and application
- balls-in-play defensive translation
- weather coefficients
- interaction terms

---

## 7. Opportunity and stopping distributions — verified hitter conversion; pitcher structure specified

### 7.1 Hitter plate-appearance survival

Let:

```text
N   = total hitter plate appearances
q_k = P(N ≥ k)
```

The survival sequence must satisfy:

```text
1 ≥ q_1 ≥ q_2 ≥ ... ≥ q_K ≥ 0
```

Convert survival probabilities into an exact count distribution:

```text
P(N = 0) = 1 − q_1
P(N = n) = q_n − q_(n+1)    for 1 ≤ n < K
P(N = K) = q_K
```

Do not use:

```text
r_k = q_k × p_k
```

as independent Bernoulli trials. Opportunity events are nested.

### 7.2 Pitcher workload is an endogenous stopping process

Pitcher batters faced may not be treated as independent of the same outcomes being counted. Hits, walks, strikeouts, outs, pitch count, baserunners, runs, times through the order, and removal risk evolve together.

For batter index `m`, use a sequential state such as:

```text
S_m = (
  batters faced,
  total outs,
  inning outs,
  occupied bases,
  runs allowed,
  pitch count,
  times through order,
  removed
)
```

Then:

```text
Y_m ~ P(terminal PA outcome | S_m, batter, pitcher, shared scenario)
S_(m+1) = T(S_m, Y_m, pitch-count increment, game-state transition)
```

After each transition, apply the versioned continuation or removal probability. Pitcher Strikeouts and any future pitcher Hits Allowed, Walks Allowed, or Outs market must be obtained as marginals of this joint path distribution.

A separate batters-faced mixture may be retained only as a labeled benchmark or approximation. It may not be called exact or used in production unless current-season tests show that the approximation preserves the relevant market probabilities and tails within an approved tolerance.

### Monotonicity handling

Preserve both raw and adjusted hitter `q_k` curves.

If small sampling noise violates monotonicity, use a documented monotone projection such as weighted isotonic regression.

Do not independently clip values until they appear valid.

Large violations indicate a model or data defect and must fail validation.

Still requiring fitted definitions:

- hitter PA survival by lineup slot, shared offensive environment, and home/away
- pitcher joint continuation/removal hazard
- pitch-count increment distribution
- state-transition support and compression rules
- uncertainty and covariates

---

## 8. Market-family distributions

Every supported market must be assigned to one mathematical family before production implementation. A market may not reuse another family's shortcut merely because both settlement statistics are counts.

### 8.1 Self-contained hitter PA markets

For shared scenario `s` and exact hitter opportunity count `n`, convolve the first `n` opportunity-level distributions.

#### Batter Hits

Let `p_k` be the hit probability at opportunity `k`.

```text
P(H = h | s)
  = Σ_n P(N = n | s)
      · PoissonBinomial_h(p_1, ..., p_n | s)
```

Then mix across shared game scenarios:

```text
P(H = h)
  = Σ_s π_s · P(H = h | s)
```

where:

```text
π_s ≥ 0
Σ_s π_s = 1
```

The Poisson-binomial PMF is computed by exact convolution or dynamic programming.

#### Batter Total Bases

For each opportunity, use the base-value distribution:

```text
0, 1, 2, 3, 4
```

For exact `n`, convolve the first `n` base-value distributions, then mix over `P(N=n|s)` and `π_s`.

Hits and Total Bases must use the same terminal PA vectors.

#### Walk markets

Unintentional walks may use the self-contained hitter PA family when the verified settlement statistic excludes intentional walks.

When the verified settlement statistic includes intentional walks, the market requires a game-state intentional-walk component because intentional-walk probability depends on base-out state, score, inning, batter quality, and the following hitter. Such a market is not production-ready until the settlement definition and game-state component are verified.

### 8.2 Joint pitcher workload-and-outcome markets

Pitcher Strikeouts belongs to the joint pitcher workload-and-outcome family.

For each reachable pitcher state, propagate probability mass through the next batter outcome, state transition, and removal decision. Accumulate the joint distribution of at least:

```text
strikeouts
hits allowed
walks allowed
outs recorded
batters faced
pitch count
removal state
```

Pitcher market distributions are marginals of that joint distribution. Do not first fit an unconditional batters-faced distribution and then convolve outcomes as though workload were independent of those outcomes.

### 8.3 Tagged-player base-out markets

Runs, RBIs, and Hits + Runs + RBIs require a tagged-player base-out and lineup-state model.

The state must preserve at least:

```text
inning and half-inning
outs
occupied bases
runner identities or target-player tags
lineup position
score context when required
```

Hits + Runs + RBIs must come from the joint distribution:

```text
P(H = h, R = r, RBI = b)
```

and then:

```text
P(H + R + RBI = t)
  = Σ_(h+r+b=t) P(H=h, R=r, RBI=b)
```

Never convolve independent marginal Hits, Runs, and RBI distributions.

### 8.4 Official-scoring reconstruction markets

A market such as Pitcher Earned Runs requires official-scoring reconstruction, runner responsibility, errors, inherited runners, and earned-versus-unearned logic. It must remain not production-ready when the approved production data cannot support a reproducible official-statistic distribution.

### 8.5 Runtime determinism

Displayed probabilities must come from deterministic analytic calculations or deterministic propagation of a frozen versioned state model.

Offline fitting may use approved optimization, resampling, or Bayesian estimation methods, provided fitted parameters are frozen and versioned before prediction time. Random runtime simulation may not generate displayed production probabilities unless a future canonical revision explicitly approves a deterministic seeded and error-bounded method.

---

## 9. Scenario handling

Do not hardcode a permanent fixed scenario count.

Preserve a full tractable integer distribution when possible.

Examples:

- hitter PA count
- starter batters faced
- starter pitch count bands when explicitly modeled

Compression is allowed only when:

1. the uncompressed distribution is available as a benchmark
2. testing shows compression does not materially move the prop probability
3. tails are preserved
4. the compression rule is versioned

Never replace a workload distribution with only low, medium, and high averages without evidence.

---

## 10. Shared game and offensive-environment model

One shared game model must supply all markets from the same game.

The shared model includes or references:

- lineup state
- home/away state
- shared offensive environment
- run environment
- starter workload
- bullpen sequence assumptions
- expected team batters faced
- scenario weights

Hitter and pitcher props may not use independent contradictory game assumptions.

### Joint opportunity-outcome conditioning

The shared scenario must carry enough common offensive information to affect both:

```text
P(N = n | s)
```

and:

```text
P(Y_k = c | N, s, pitcher faced, modeled covariates)
```

A high team-PA scenario cannot increase a hitter's opportunity count while leaving the outcome distribution unconditionally fixed if the same offensive environment is evidence of stronger or weaker team performance.

The approved production approximation must therefore either:

1. propagate the full team batting process, or
2. use an explicit shared offensive-environment variable that jointly changes opportunity and outcome distributions.

Any simpler conditional-independence approximation must be labeled, compared with an uncompressed or more complete benchmark, and shown not to materially compress tails at the posted baseline and alternate lines.

Cross-batter PA counts must be checked for consistency with total team batters faced. Hitter and pitcher outcomes must agree under the same shared scenario.

---

## 11. Generic settlement mathematics — verified

Let:

```text
A = event that the market is eligible to settle under participation and rule requirements
X = modeled official settlement statistic conditional on A
L = posted line
```

### Higher

```text
P(Win)  = P(A) · P(X > L | A)
P(Loss) = P(A) · P(X < L | A)
P(Void) = 1 − P(A) + P(A) · P(X = L | A)
```

### Lower

```text
P(Win)  = P(A) · P(X < L | A)
P(Loss) = P(A) · P(X > L | A)
P(Void) = 1 − P(A) + P(A) · P(X = L | A)
```

For half-point lines and integer-valued statistics:

```text
P(X = L | A) = 0
```

The three probabilities must satisfy:

```text
P(Win) + P(Loss) + P(Void) = 1
```

### Conditional ranking probability

```text
P(Win | grades)
  = P(Win) / [P(Win) + P(Loss)]
```

This conditions on the pick not voiding.

When participation is the only external void source and no tie is possible, participation probability cancels from the ranking probability.

Display separately when available:

- approved projected-start or lineup-projection diagnostic evidence
- chance the pick grades
- projected void probability
- `P(Win | grades)`

An approved projection model may report projected-start probability,
coverage, exact-slot accuracy, or historical projected-versus-confirmed
accuracy as diagnostics. Those diagnostics may not alter `P(A)`,
`P(Win)`, `P(Loss)`, `P(Void)`, `P(Win | grades)`, eligibility, or
ranking solely because the active lineup status is projected. Until
confirmed information replaces it, the approved projected lineup is the
active baseball assumption. Only an actual change in player identity,
batting order, opposing starter, or another approved baseball input may
change the modeled distribution.

These displayed quantities may be numerically close but are not
interchangeable concepts.

### Side-direction invariant

Let `X_up` be a modeled settlement-statistic distribution that is shifted upward relative to `X_down` in the sense of first-order stochastic dominance.

For the same eligibility event and line:

```text
Higher: P(X_up > L | A) ≥ P(X_down > L | A)
Lower:  P(X_up < L | A) ≤ P(X_down < L | A)
```

Therefore:

- an upward statistical effect cannot be treated as a booster for Lower
- a downward statistical effect cannot be treated as a booster for Higher
- the same baseball fact may lift one side and knock down the opposite side

Production factors must be applied in this order:

1. estimate the factor's effect on eligibility, workload, scenarios, or the distribution of `X`
2. recompute the distribution
3. apply the exact Higher or Lower settlement mapping
4. derive `P(Win)`, `P(Loss)`, `P(Void)`, and `P(Win | grades)`

Do not assign a direct side-independent booster or penalty score.

### 11.1 Base soft-line discovery and final context-adjusted probability

When the approved prediction path uses a base model for discovery before
a later validated context model, the two stages must remain
mathematically distinct.

Let:

```text
D_base = approved versioned base distribution of X
D_final = approved versioned context-adjusted final distribution of X
d = exact posted selected side
L = exact posted line
```

Settle each distribution through the same versioned eligibility and
settlement rules:

```text
p_base(d,L)
  = P_base(Win | grades; d,L)

p_final(d,L)
  = P_final(Win | grades; d,L)
```

For a Higher offer:

```text
p_base(Higher,L)
  = P_base(X > L | A)
    / [P_base(X > L | A) + P_base(X < L | A)]

p_final(Higher,L)
  = P_final(X > L | A)
    / [P_final(X > L | A) + P_final(X < L | A)]
```

For a Lower offer:

```text
p_base(Lower,L)
  = P_base(X < L | A)
    / [P_base(X < L | A) + P_base(X > L | A)]

p_final(Lower,L)
  = P_final(X < L | A)
    / [P_final(X < L | A) + P_final(X > L | A)]
```

A **soft-line candidate** is an exact posted offer whose `p_base(d,L)`
satisfies an approved, versioned discovery rule. A line may be soft to
Higher or soft to Lower. Neither direction receives preference.

The discovery rule may be expressed as a threshold or another
chronologically validated side-aware predicate. When a threshold
`tau_soft` is used:

```text
softnessMargin(d,L)
  = p_base(d,L) - tau_soft
```

The threshold is a versioned model-selection quantity. It is not fixed
at `0.50` by this specification and may not be invented during runtime.

The context probability delta is:

```text
contextProbabilityDelta(d,L)
  = p_final(d,L) - p_base(d,L)
```

This delta is diagnostic evidence only. It may explain how validated
context strengthened or weakened the exact posted side, but it may not
replace `p_final(d,L)` in ranking.

Required invariants:

1. `D_base` and `D_final` are explicit versioned distributions.
2. Every context factor acts through eligibility, workload, shared
   scenarios, or the distribution of `X`; no factor directly adds or
   subtracts probability points.
3. Context-factor models may not use the selected side as a model input.
   Side awareness appears when the resulting distribution is settled
   against the exact posted side and line.
4. The exact same final distribution is used for baseline and alternate
   offers for the same player, game, and settlement statistic; only
   posted offer attributes and settlement differ.
5. Category ranking uses only final `P(Win | grades)`, then `P(Void)`.
   `p_base`, softness margin, context probability delta, price,
   multiplier, and discovery labels are not ranking quantities.
6. A hard discovery filter may prevent full context evaluation only
   after chronological current-season validation establishes an
   approved recall standard for the strongest `p_final` candidates.
   Without that evidence, every supported offer must receive the full
   model or pass only through a broad high-recall discovery screen.

---

## 12. Settlement and market model registry

The mathematics above is generic.

### 12.1 Versioned settlement registry

Each market must use a versioned settlement registry defining:

- official settling statistic
- start requirement
- minimum participation
- relief-appearance handling
- intentional-walk inclusion or exclusion when relevant
- tie handling
- postponement handling
- suspension handling
- void conditions
- effective date
- rule-source snapshot or reference

The registry must define the market-specific eligibility event `A` used in:

```text
P(Void) = 1 − P(A) + P(A)P(X=L | A)
```

The generic void formula is verified. The market-specific `P(A)` model is not complete until the exact operator rule and required participation event are versioned.

Never hardcode current operator rules from memory.

The rule version used at prediction time must be saved with the prediction.

### 12.2 Versioned market model registry

Every supported baseline and alternate market must map to one base market definition containing:

- provider market key
- base market key
- official settlement statistic
- mathematical family
- required normalized inputs
- required shared scenario fields
- distribution builder version
- settlement-rule version
- validation status
- production status
- explicit blocker when not production-ready

Baseline and alternate offers for the same statistic use the same official-statistic distribution. The posted line and selected side change settlement; they do not create a different baseball model.

The initial V3 planned market catalog is:

| Base market | Mathematical family | Initial status |
|---|---|---|
| Batter Hits | self-contained hitter PA | PLANNED; first vertical slice; production fit not yet validated |
| Batter Total Bases | self-contained hitter PA using the same terminal PA vectors as Hits | PLANNED; requires the shared categorical fit and validation |
| Batter Hits + Runs + RBIs | tagged-player base-out joint distribution | PLANNED; approved-source data sufficiency and joint model validation required |
| Pitcher Strikeouts | joint pitcher workload-and-outcome | PLANNED; sequential workload/removal model and validation required |

An observed provider market not listed in the approved registry is ineligible for production ranking.

### 12.3 Fail-closed requirement

```text
no validated distribution builder
→ no P(Win), P(Loss), or P(Void)
→ no eligible prop
→ no category ranking
```

There is no fallback to an audit model, deprecated model, generic projection, raw implied probability, or side-independent score.

---

## 13. Side-aware ranking — verified

### Golden Rule ranking

Within each approved category, rank the eligible posted picks by the probability that the **selected side** wins.

Primary sort:

```text
side-specific P(Win | grades) descending
```

Tiebreak:

```text
P(Void) ascending
```

A Higher pick may rank first because the modeled distribution is pushed upward relative to its line. A Lower pick may rank first because the modeled distribution is pushed downward relative to its line. Neither side receives preference.

Do not use:

- multipliers
- hidden scores
- booster totals outside the probability model
- secondary probability grades
- arbitrary risk penalties
- player reputation or star status
- a preference for Higher picks
- a preference for exciting or high-output outcomes
- raw expected-statistic direction without applying the selected side and line
- unapproved correlation penalties inside the individual-prop ranking probability

Every approved positive or negative attribute must influence the final order only through a versioned effect on eligibility, the modeled settlement-statistic distribution, settlement mapping, or approved calibration. Entry-level correlation analysis, if later approved, is separate from individual-prop probability ranking.

---

## 14. Calibration

Goal:

```text
Props predicted at X% should win about X% of the time among graded picks.
```

Use:

- reliability curves
- log loss
- Brier score
- sample counts and uncertainty intervals

Use hierarchical partial pooling:

```text
global
→ market
→ side
→ line range
```

Thin slices remain close to broader groups until sufficient evidence exists.

Validation must be chronological within the active season:

```text
earlier current-season training period
→ later current-season validation period
→ untouched latest current-season test period
```

Current-season walk-forward evaluation is preferred when practical. When an approved candidate-selection rule requires both fixed-window and expanding walk-forward validation, both are required inputs to that rule and neither overrides the other.

### 14.1 Candidate selection and stability for pooled predictive models

Candidate selection uses only active-current-season fitting and validation evidence. The untouched latest-current-season test period may not be read during candidate generation, fitting, selection, comparison, tie-breaking, corroboration, or candidate-set revision.

#### Candidate family

Candidates that differ only in the value of one pooling or regularization hyperparameter belong to one candidate family.

When a named candidate is the mathematical limiting case of that hyperparameter, it is a member of the same family. For the starter-batters-faced model, the league distribution is the infinite-pooling limit of the side-pooled distribution family.

This family relationship does not imply that a finite candidate grid identifies the global optimum over every untested finite hyperparameter value.

#### Candidate-set development, freezing, and revision

The discrete candidate set used for final selection must be explicit, ordered, versioned, and frozen before the untouched test period is evaluated.

Candidate-set revisions informed by fitting or validation evidence are model-development decisions and must be recorded honestly. Within a frozen model version, the candidate set may not be revised. Any revision after freezing requires a model-version increment and a written reason recorded before re-evaluation. It also requires a newly reserved untouched active-current-season test period that was not used to evaluate the prior version; otherwise production validation remains blocked.

Once a candidate set is frozen and its untouched test is evaluated, neither the candidate set nor the selection rule may be changed in response to that untouched-test result within the same model version.

#### Proper-score evaluation

Every candidate is evaluated under both:

- fixed later-period validation; and
- expanding chronological walk-forward validation.

Each method reports at least:

- multiclass log loss; and
- multiclass Brier score.

Neither score is an automatic decimal-precision tiebreaker for the other. Candidate admissibility is determined through joint proper-score dominance.

#### Dominance and nondominated sets

Under validation method `m`, candidate `a` dominates candidate `b` when:

```text
logLoss_m(a) ≤ logLoss_m(b)
and
Brier_m(a) ≤ Brier_m(b)
```

and at least one inequality is strict.

The nondominated set for method `m` contains every candidate that is not dominated by any other candidate under that method.

Nondominance means only that the evaluated proper scores do not unanimously prefer another candidate. It must not be described as statistical equivalence unless a separately approved uncertainty procedure establishes equivalence.

#### Stability across validation designs

Let:

```text
P_fixed = fixed-validation nondominated set
P_walk  = walk-forward nondominated set
A       = P_fixed ∩ P_walk
```

A stable candidate exists when and only when `A` is non-empty.

Exact agreement between the individual fixed-validation and walk-forward minimum-log-loss candidate identifiers is not required.

When `A` is empty, the component fails closed because the two required validation designs do not support a common nondominated candidate.

#### Deterministic selection from the stable set

When `A` is non-empty, select the candidate in `A` with the greatest pooling strength.

The infinite-pooling league candidate has greater pooling strength than every finite side-pooled candidate.

This direction is a deterministic parsimony rule: among candidates jointly nondominated under both required validation designs, prefer the candidate with the strongest pooling and therefore the least retained subgroup variation.

If two candidates have the same pooling strength, select by ascending canonical candidate identifier.

#### Final fitting and untouched testing

After selection, fit exactly one final model on the combined fit and validation periods using the selected candidate.

Freeze and version that model before reading the untouched test period.

The untouched test is evaluated once as a final report. Its results may determine whether the frozen model passes the production-validation gate, but they may not select another candidate, modify the candidate set, alter the selection rule, or trigger hyperparameter retuning within the same model version.

Current-season box scores can validate the baseball distribution but cannot reconstruct the exact earlier Underdog board. Archive raw Underdog boards prospectively throughout the current season.

Still requiring explicit definition:

- calibration model
- pooling strength
- minimum reporting volumes
- recalibration schedule

---

## 15. Assumptions, dependence, and overdispersion

“Exact” means exact under the stated model assumptions.

### 15.1 Hitter conditional-independence assumption

The allowed self-contained hitter approximation is:

```text
Per-opportunity outcomes are independent conditional on
shared offensive scenario, pitcher faced, exact opportunity branch,
and modeled covariates.
```

The shared scenario must jointly affect opportunity counts and per-opportunity outcomes as required by Section 10.

### 15.2 Pitcher dependence requirement

Pitcher outcomes and workload are not conditionally separated by default. The production pitcher model must propagate the joint state and stopping process described in Sections 7 and 8.

### 15.3 Residual overdispersion

Test current-season distributions and line probabilities for overdispersion and tail compression.

Possible residual correlation sources:

- unmodeled game environment
- pitcher condition
- umpire zone
- batter condition
- bullpen quality
- game-state feedback
- cross-batter PA coupling
- team-level offensive shocks
- removal-hazard misspecification

If observed variance materially exceeds the analytic model or altline tails are compressed:

1. document the failure
2. identify the specific omitted dependence
3. propose a shared random effect, fuller state process, or another explicit correction
4. update this specification before changing production code
5. revalidate chronologically

---

## 16. Verified worked example — Batter Hits

Illustrative placeholder inputs only.

```text
q = [0.99, 0.97, 0.90, 0.70, 0.25]
p = [0.22, 0.24, 0.26, 0.25, 0.25]
```

where:

```text
q_k = P(N ≥ k)
p_k = per-PA hit probability at opportunity k
```

### PA-count distribution

```text
P(N=0) = 1.00%
P(N=1) = 2.00%
P(N=2) = 7.00%
P(N=3) = 20.00%
P(N=4) = 45.00%
P(N=5) = 25.00%
```

### Hit distribution

```text
P(H=0) = 36.46%
P(H=1) = 40.20%
P(H=2) = 18.54%
P(H=3) = 4.29%
P(H=4) = 0.49%
P(H=5) = 0.02%
```

Dynamic programming matches brute-force enumeration to approximately `1e-16`.

### Conditional line probabilities

```text
Higher 0.5: P(H ≥ 1) = 63.54%
Higher 1.5: P(H ≥ 2) = 23.34%
Higher 2.5: P(H ≥ 3) = 4.80%
```

### Deprecated shortcut comparison

The incorrect independent-trial method using `q_k × p_k` gives:

```text
P(H=0) = 35.55%
Higher 0.5 = 64.45%
Higher 1.5 = 22.99%
```

It overstates the common 0.5 line.

### Void layer example

Let:

```text
P(A) = 0.97
line = 0.5
side = Higher
```

Then:

```text
P(Win)  = 0.97 × 0.6354 = 61.64%
P(Loss) = 0.97 × 0.3646 = 35.36%
P(Void) = 1 − 0.97      =  3.00%
```

and:

```text
P(Win | grades)
  = 61.64 / (61.64 + 35.36)
  = 63.54%
```

---

## 17. Required verification suite

Before ranking any real prop:

1. Every normalized outcome vector sums to 1.
2. Every count or stat distribution sums to 1.
3. `P(Win)+P(Loss)+P(Void)=1`.
4. Higher probabilities decrease as the line rises.
5. Lower probabilities increase as the line rises.
6. Hitter survival probabilities are monotone non-increasing.
7. Hitter survival-to-count conversion produces nonnegative probabilities summing to 1.
8. Dynamic programming matches brute-force enumeration on small cases.
9. Scenario mixtures match manual weighted calculations.
10. Hits and Total Bases are coherent because they use the same PA outcomes.
11. Hitter and pitcher markets use the same shared game and starter-workload assumptions.
12. Identical versioned inputs produce identical outputs.
13. Extreme cases pass:
    - zero opportunities
    - one guaranteed opportunity
    - zero outcome probability
    - certain outcome
    - one scenario with weight 1
    - no eligibility probability
    - guaranteed eligibility
    - integer-line tie
    - half-point line
14. Raw and monotone-adjusted hitter survival curves are retained.
15. Current-season observations are split and graded chronologically with an untouched later-period test.
16. An untouched test period is reported separately.
17. Probability buckets are checked for calibration.
18. Rare outcomes report current-season sample counts and uncertainty; prior seasons may not supplement them.
19. Compression approximations are compared with uncompressed benchmarks at baseline and alternate lines.
20. Shared-game consistency checks pass.
21. For identical `A`, `X`, and `L`, Higher and Lower correctly exchange win and loss mass, with tie and void mass preserved.
22. An upward distribution shift cannot reduce Higher win probability or increase Lower win probability; a downward shift obeys the opposite direction.
23. Every production factor reaches ranking only through eligibility, a versioned distributional effect, settlement logic, or approved calibration; no hidden score alters the order.
24. Both Higher and Lower paths receive focused tests for every market adapter.
25. A hierarchical talent model cannot receive an additional post-fit player-to-league shrinkage step.
26. Shared offensive-environment scenarios move hitter opportunity and outcome distributions together, and tail behavior is compared with a fuller benchmark.
27. Pitcher Strikeouts cannot use the self-contained hitter opportunity-mixture adapter in production.
28. Pitcher state propagation conserves probability mass across continue and remove transitions.
29. Pitcher outcome marginals are coherent with the same joint workload paths.
30. Hits + Runs + RBIs is derived from a joint distribution, never independent marginal convolution.
31. Walk markets verify whether intentional walks are included and require a game-state component when they are.
32. Every market-specific eligibility event `A` is linked to a versioned settlement rule.
33. Baseline and alternate offers for the same base market use the same statistic distribution and differ only by posted offer attributes and settlement.
34. Planned, disabled, or not-yet-production-validated markets fail closed and cannot reach ranking.
35. Production engine modules cannot import audit, deprecated, prior-season, or unapproved fallback models.
36. Base soft-line probability is produced by exact settlement of the
    versioned base distribution for the exact posted side and line.
37. Final context probability is produced by recomputing and exactly
    settling the versioned final distribution; no direct probability
    increment or decrement is allowed.
38. Context-factor modules cannot read selected side, and the same
    distributional shift helps one side while hurting the opposite side
    under exact settlement.
39. Final category ordering uses final `P(Win | grades)`, then `P(Void)`;
    base probability, softness margin, context delta, multiplier, and
    discovery labels cannot alter the order.
40. Any hard discovery cutoff demonstrates the approved current-season
    recall standard against full-model final probabilities before it may
    exclude offers from complete context evaluation.
41. Projected-lineup diagnostics cannot change model probabilities,
    eligibility, void, confidence, category access, or ranking solely
    because lineup status is projected.

---

## 18. Definitions still required before production ranking

The following must be fitted, documented, versioned, and validated before real-prop ranking:

### Shared and hitter components

- side-aware soft-line discovery rule, threshold or predicate, version,
  and current-season recall validation
- base-versus-final distribution contract and context probability-delta
  reporting
- within-current-season recency weighting by outcome
- single current-season talent-pooling model by outcome
- current-season platoon interaction structure
- minimum current-season evidence and fail-closed rules
- coherent categorical matchup model
- park neutralization and application
- defense-to-batted-ball translation
- weather coefficients if a weather source is later approved
- times-through-the-order adjustment
- shared offensive-environment scenarios
- hitter PA survival model
- bullpen scenario model
- hitter opportunity/outcome dependence benchmark

### Pitcher components

- joint pitcher state definition
- sequential terminal-outcome transition model
- pitch-count increment model
- continuation and removal hazard
- starter-to-bullpen transition handling
- probability-state compression tolerance
- pitcher joint-distribution validation

### Game-state and settlement components

- tagged-player base-out model for Runs, RBIs, and H+R+RBI
- runner-identity and advancement data sufficiency
- intentional-walk settlement handling for any Walk market
- market-specific eligibility event `P(A)`
- versioned settlement rules and effective dates

### Calibration

- overdispersion correction, if required
- hierarchical calibration method
- calibration pooling strength
- minimum calibration reporting volumes
- recalibration schedule

Infrastructure, interfaces, registries, fail-closed guards, and mathematical tests may be built earlier with labeled synthetic fixtures. No planned, disabled, or not-yet-production-validated market may appear as a production prediction.

---

## 19. Quick formula reference

```text
Binary log5 benchmark:
e = (b·p/l) / [(b·p/l) + ((1−b)(1−p)/(1−l))]

Hitter opportunity count:
P(N=0) = 1−q_1
P(N=n) = q_n−q_(n+1)
P(N=K) = q_K

Self-contained hitter stat distribution:
P(X=x) = Σ_s π_s Σ_n P(N=n|s) · ConditionalConvolution_x(n,s)

Pitcher joint process:
Y_m ~ P(outcome | S_m, batter_m, shared scenario)
S_(m+1) = T(S_m, Y_m, pitch increment, game-state transition)
Pitcher market PMFs = marginals of the joint terminal path distribution

Higher:
P(W) = P(A)P(X>L|A)
P(L) = P(A)P(X<L|A)
P(V) = 1−P(A)+P(A)P(X=L|A)

Lower:
P(W) = P(A)P(X<L|A)
P(L) = P(A)P(X>L|A)
P(V) = 1−P(A)+P(A)P(X=L|A)

Ranking:
P(Win|grades) = P(Win) / [P(Win)+P(Loss)]

Two-stage soft-line path:
p_base(d,L)  = exact selected-side settlement of D_base
p_final(d,L) = exact selected-side settlement of D_final
softnessMargin = p_base(d,L) - tau_soft
contextProbabilityDelta = p_final(d,L) - p_base(d,L)
rank by p_final(d,L), then P(Void)

Side direction:
upward shift in X  => Higher probability up, Lower probability down
downward shift in X => Higher probability down, Lower probability up

Hits:
1B+2B+3B+HR

Total Bases:
1·1B+2·2B+3·3B+4·HR

H+R+RBI:
P(T=t) = Σ_(h+r+b=t) P(H=h,R=r,RBI=b)

Fail closed:
no validated distribution → no ranked prop
```

---

## Changelog

### Version 1.6 — 2026-08-01

- Defined side-aware soft-line discovery for exact posted Higher and
  Lower offers using a versioned base distribution and discovery rule.
- Separated base discovery probability from final context-adjusted
  probability and defined softness margin and context probability delta
  as auditable non-ranking quantities.
- Locked all context factors to eligibility, workload, shared scenarios,
  or statistic-distribution effects before exact settlement and
  prohibited direct probability-point boosters.
- Required context-factor models to remain side-independent in their
  inputs while preserving directional Higher/Lower effects through
  settlement.
- Required final category ranking to use final `P(Win | grades)`, then
  `P(Void)`, and prohibited base probability, softness margin, context
  delta, price, multiplier, or discovery labels from altering rank.
- Required a hard discovery filter to prove current-season recall for
  the strongest full-model final probabilities before excluding offers
  from complete context evaluation.
- Clarified that projected-lineup probability and accuracy measures are
  diagnostic only and cannot penalize probabilities, eligibility, void,
  confidence, category access, or ranking solely because status is
  projected.

### Version 1.5 — 2026-07-29

- Replaced exact fixed-validation and walk-forward candidate-ID agreement with a full pairwise proper-score nondominance rule for pooled predictive models.
- Defined stability as a non-empty intersection of fixed-validation and expanding walk-forward nondominated sets, followed by deterministic strongest-pooling selection.
- Classified mathematical limit candidates, including the league starter-batters-faced distribution, as members of the same pooling family without claiming a finite grid identifies the global continuous optimum.
- Reconciled the general walk-forward preference with component rules that require both fixed-window and walk-forward validation, so neither required design silently overrides the other.
- Required explicit, ordered, versioned candidate sets; prohibited revisions within a frozen model version; and required a new model version, written pre-evaluation reason, and newly reserved untouched current-season test period for any post-freeze revision.
- Preserved the untouched-test seal by prohibiting its use in candidate generation, selection, comparison, corroboration, or retuning.

### Version 1.4 — 2026-07-23

- Updated repository-era terminology for V3 without changing the verified mathematics.
- Replaced permanent-sounding “blocked market” language with planned and not-yet-production-validated statuses.
- Preserved Batter Hits + Runs + RBIs and Pitcher Strikeouts as intended markets while retaining their required joint model families and fail-closed production gates.
- Clarified that planned, disabled, and not-yet-production-validated markets cannot reach ranking.

### Version 1.3 — 2026-07-22

- Reclassified Pitcher Strikeouts and future pitcher count markets under one joint workload-and-outcome stopping process rather than an independent batters-faced mixture.
- Prohibited double shrinkage by requiring one coherent current-season talent-pooling model per parameter while preserving calibration as a separate layer.
- Required shared offensive scenarios to jointly affect hitter opportunity counts and per-opportunity outcome distributions, with explicit tail-compression testing for altlines.
- Required game-state handling for intentional walks whenever the verified settlement statistic includes them.
- Preserved the verified generic `P(Void)` formula and required every market to version its specific eligibility event `A`.
- Added a versioned market model registry, initial V2 market-family assignments, and fail-closed production status.
- Required H+R+RBI to come from a joint tagged-player distribution and prohibited independent marginal convolution.
- Added production import-boundary and blocked-market regression requirements.

### Version 1.2 — 2026-07-22

- Made the Golden Rule mathematically explicit: maximize the probability that the selected side wins within its category.
- Clarified that expected player performance is only an intermediate distribution, never the ranking objective.
- Added the side-direction invariant: upward shifts help Higher and hurt Lower; downward shifts help Lower and hurt Higher.
- Required all boosters and negative attributes to act through eligibility, workload/scenario assumptions, the official-statistic distribution, settlement logic, or approved calibration.
- Prohibited side-independent booster scores, player-quality preferences, and raw expected-statistic direction from altering ranking.
- Added focused Higher/Lower symmetry, monotonicity, and factor-path verification requirements.

### Version 1.1 — 2026-07-22

- Locked player, team, and league performance inputs to the active MLB season only.
- Removed multi-season weighting, Marcel estimators, prior-season priors, career statistics, and age-curve requirements.
- Replaced historical-season validation with chronological training, validation, untouched testing, and walk-forward evaluation inside the current season.
- Kept recency weighting and league/platoon pooling only when all observations and targets come from the current season.
- Required insufficient current-season samples to remain explicitly insufficient or unvalidated rather than borrowing prior-season data.

### Version 1.0

- Separated probability mathematics from project workflow rules.
- Replaced independent `q_k × p_k` trials with exact opportunity-count mixtures.
- Defined a mutually exclusive terminal PA vector and separate baserunning layer.
- Corrected generic settlement formulas for integer-line ties.
- Limited no-Monte-Carlo requirement to runtime displayed probabilities.
- Added monotone survival handling, full versioned determinism, and untouched chronological testing.
