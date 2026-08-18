# MLB Prop Analyzer — Canonical Math & Statistics Reference

**Version:** 1.14
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

### 8.3 Tagged-player and composite game-state markets

Runs, RBIs, and Hits + Runs + RBIs depend on lineup and
base-out state. They may not be modeled as self-contained
hitter PA markets.

Two model families are approved. Each market's active
family is recorded in the versioned market registry in
Section 12.2. No module may infer or substitute a family
at runtime.

#### 8.3.1 Family A — tagged-player base-out joint model

The state must preserve at least:

```text
inning and half-inning
outs
occupied bases
runner identities or target-player tags
lineup position
score context when required
```

Hits + Runs + RBIs under Family A comes from the joint
distribution:

P(H = h, R = r, RBI = b)

and then:

P(H + R + RBI = t)
  = Σ_(h+r+b=t) P(H=h, R=r, RBI=b)

#### 8.3.2 Family B — directly fitted composite distribution

A market may instead be modeled as a single distribution
fitted directly over its own official settlement statistic,
conditioned on context-adjusted baseball inputs.

Under Family B:

1. The distribution is fitted directly over the settlement
   statistic — T = H+R+RBI for Hits+Runs+RBIs, R for Batter
   Runs. The triple joint P(H=h,R=r,RBI=b) is NOT formed
   and is not required.

2. Conditioning inputs must be baseball-unit quantities
   only: context-adjusted terminal outcome vector, expected
   plate appearances, lineup slot, platoon split cell,
   opposing starter pooling, team implied run total, and
   on-base quality of preceding lineup slots. Context
   factors act only on these inputs. No context factor may
   adjust a probability directly, and no factor may read
   the selected side.

3. Runtime evaluation must be exact and analytic.
   No Monte Carlo.

4. Baseline and alternate offers settle off the same fitted
   distribution. Alternate lines are settled independently
   at their own posted line. Never interpolate between
   lines. Never substitute a standard line when an
   alternate is unavailable.

5. INDEPENDENT MARGINAL CONVOLUTION REMAINS PROHIBITED.
   A Family B distribution may not be constructed by
   convolving separate Hits, Runs, and RBI distributions.
   Family B is a direct fit of one statistic, not a
   combination of marginals. This prohibition is unchanged
   from Version 1.7.

6. Family B calibration is governed by Section 14.2 and
   must be evaluated independently for each posted-line
   cohort. Lines at 2.5 and above remain bucketed
   separately from 0.5 and 1.5. Each cohort must report
   sample sufficiency and calibration agreement as distinct
   states. Aggregate calibration that passes only because
   shallow lines dominate the sample is not acceptance.

7. When two or more Family B markets are fitted separately
   over related statistics, a cross-market coherence
   diagnostic must be computed and reported. Deviation
   beyond the declared versioned tolerance fails closed.

8. A Family B distribution fails its calibration gate when
   any required posted-line cohort fails either required
   Section 14.2 condition. A cohort with sufficient sample
   volume but failed calibration agreement remains
   calibration-failed and may not be reported as sufficient
   overall. A failed cohort may not be replaced by a
   shallower line, a standard line, a Family A
   approximation, or any fallback.

9. A Family B count distribution may include one explicit
   zero-mass correction when current-season fitting evidence
   demonstrates systematic misspecification of P(T=0).
   Approved forms are zero-inflated and hurdle
   distributions.

   Let Q(t | x) be an exact analytic directly fitted count
   PMF over nonnegative integer T, conditioned on the
   declared baseball-unit inputs x.

   A zero-inflated form is:

   P(T=0 | x)
     = pi(x) + [1-pi(x)] Q(0 | x)

   P(T=t | x)
     = [1-pi(x)] Q(t | x), for t >= 1

   with:

   0 <= pi(x) < 1.

   A hurdle form is:

   P(T=0 | x)
     = rho(x)

   P(T=t | x)
     = [1-rho(x)] Q(t | x) / [1-Q(0 | x)],
       for t >= 1

   with:

   0 <= rho(x) <= 1
   Q(0 | x) < 1.

   The zero-mass component and the positive-count component
   together produce one final normalized PMF for T. They
   are not separate settlement distributions.

   Under a hurdle form, the positive-count component may be
   fitted only on observations with T >= 1 using the
   corresponding zero-truncated likelihood:

   Q_pos(t | x)
     = Q(t | x) / [1-Q(0 | x)],
       for t >= 1.

   The positive-count component may estimate its mean
   coefficients and dispersion parameter separately from
   the zero-mass component under that zero-truncated
   likelihood.

   This positive-row fitting path does not authorize a new
   conditioning-input contract or a different model
   structure. The declared Family B conditioning inputs,
   link function, offset role and fixed offset coefficient,
   predictor order, and predictor standardization or other
   declared transforms must remain unchanged unless a
   separate canonical revision explicitly authorizes their
   change.

   Restricting the positive-component fitting likelihood to
   T >= 1 changes only the fitting subset and likelihood for
   that component. It does not authorize selected-side,
   posted-line, multiplier, price, category, or settlement-
   result inputs, line-specific statistic distributions, or
   a runtime fallback.

10. The zero-mass parameter pi(x) or rho(x) must be fitted
    and versioned from active-current-season evidence under
    a declared conditioning-input contract. It may use the
    approved Family B baseball-unit inputs or a declared
    subset of them. It may not read the posted selected
    side, posted line, multiplier, price, category, or
    settlement result.

11. A zero-mass correction is part of the baseball
    statistic distribution. It is not a direct probability
    adjustment or post-settlement calibration. After the
    final PMF is formed, every Higher and Lower offer is
    settled through the same generic settlement path.

12. Zero-inflated and hurdle forms remain subject to the
    exact analytic runtime requirement in item 3 and the
    independent-marginal-convolution prohibition in item 5.
    Their introduction does not authorize Monte Carlo,
    line-specific statistic distributions, independent
    Hits/Runs/RBI convolution, or any fallback distribution.

13. A Family B market may use a continuation-ratio
    directly fitted discrete distribution when a prior
    approved count-family candidate has demonstrated
    settlement-tail misspecification that is not repaired by
    an approved zero-mass correction or refitted positive
    count component.

    For nonnegative integer settlement statistic T, define
    the continuation probability at threshold k as:

        c_k(x)
          = P(T >= k+1 | T >= k, x)

    with:

        0 < c_k(x) < 1.

    For the HHR continuation-ratio candidate authorized in
    Section 15.3, thresholds k = 0,...,7 are modeled as:

        logit(c_k(x))
          = a_k + beta' z(x)

    where a_k is threshold-specific and beta is one shared
    slope vector across thresholds.

    The resulting exact probabilities over the supported
    settlement partition are:

        P(T=0 | x)
          = 1 - c_0(x)

        P(T=t | x)
          = [ product_{j=0}^{t-1} c_j(x) ]
            [ 1 - c_t(x) ],
            for t = 1,...,7

        P(T>=8 | x)
          = product_{j=0}^{7} c_j(x).

    These probabilities are one directly fitted Family B
    distribution over the settlement statistic. They are
    not separate binary settlement models and are not a
    post-settlement calibration layer.

    The same distribution must settle every supported
    Higher and Lower baseline or alternate offer. Posted
    side, posted line, multiplier, price, category, and
    settlement result may not enter x, z(x), a_k, or beta.

    The T>=8 terminal tail is sufficient only for settlement
    thresholds that do not require distinguishing exact
    values within that tail. A posted offer requiring an
    exact distinction inside T>=8 fails closed unless a
    later canonical revision extends the continuation
    sequence. No probability mass may be invented or
    redistributed inside the terminal tail at runtime.

    The continuation-ratio survival curve is monotone by
    construction. Let:

        S_0(x) = 1
        S_k(x) = P(T >= k | x)
               = product_{j=0}^{k-1} c_j(x), for k >= 1.

    Because every c_k(x) is strictly between 0 and 1:

        S_(k+1)(x) = S_k(x) c_k(x) < S_k(x).

    Therefore Higher settlement probability cannot increase
    as the posted line rises, and the complementary Lower
    settlement probability cannot decrease. The fit report
    must nevertheless verify this numerically within every
    required fitted-mu bin across every supported required
    settlement threshold. The mean predicted survival in
    each required bin must be strictly decreasing as the
    threshold deepens, with complementary lower tails
    strictly increasing. Any non-finite value, equality from
    numerical saturation, or increase in a deeper survival
    threshold is a numerical defect and fails closed.

    A continuation-ratio Family B form remains subject to
    the exact analytic runtime requirement and the
    prohibition on independent Hits/Runs/RBI marginal
    convolution.

Family B is an approved production family, not a
provisional shortcut. Family A remains approved and may
later replace Family B for any market through the normal
canonical revision process.

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

### 11.2 Context-factor composition order

When multiple validated context factors apply to one base evaluation, they
compose in a fixed order determined by their declared `applicationStage`
and by whether they replace or transform a terminal outcome vector.

A factor whose stage is `shared-scenario-before-statistic-distribution`
applies first. It changes scenario mixture weights only and must jointly
affect opportunity counts and per-opportunity outcome conditioning as
required by Section 10.

Factors whose stage is `terminal-outcome-before-statistic-distribution`
apply next, distinguished by operation.

A **replacement** factor supplies a complete terminal vector for a defined
subset of plate appearances. It substitutes an input to the coherent
matchup combination and applies only to its declared subset. The
team-specific bullpen factor replaces the pitcher-allowed vector for plate
appearances against relievers and may not affect plate appearances against
the starter.

A **transformation** factor multiplies a resulting terminal vector
elementwise and renormalizes once. It applies to every plate appearance
within its declared scope, on both the starter and reliever branches. The
park factor is a transformation.

Replacement precedes transformation on any branch where both apply. A
replacement changes an input to coherent combination; a transformation
changes its output. No plate appearance may receive the same factor twice.

#### Category-support boundary

A factor artifact may declare multipliers for canonical terminal categories
that the active base model does not carry. Composition applies a factor only
over the categories present in the base model. For every category the factor
declares that the base model omits, the factor effect must be exactly
identity; a non-identity effect on an omitted category fails closed rather
than being silently discarded.

The active M8 Batter Hits base model carries fourteen terminal categories and
omits `OTHER_PA`, which remains unobserved in approved provider evidence and
fails closed under Section 19 of the project rules.

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
- temporal applicability, recorded as exactly one of:
  (a) operator-designated effective date, permitted ONLY when the rule source
      states an effective date explicitly; or
  (b) verified rule-version publication boundary, when the source states a
      publication or version date but no effective date.
  The stored field name MUST state which of (a) or (b) it is. A publication
  boundary MUST NOT be stored in a field named or documented as an effective
  date. If the source supplies neither, the rule MUST NOT be registered.
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
| Batter Hits | self-contained hitter PA | BUILT; production fit validation ongoing |
| Batter Hits + Runs + RBIs | Family B directly fitted composite (8.3.2) | PLANNED; primary V1 market; approved-source data sufficiency and per-line calibration validation required |
| Batter Runs | Family B directly fitted composite (8.3.2) | PLANNED; approved-source data sufficiency and per-line calibration validation required |
| Batter Total Bases | self-contained hitter PA using the same terminal PA vectors as Hits | PLANNED; post-V1; requires the shared categorical fit and validation |
| Pitcher Strikeouts | joint pitcher workload-and-outcome | PLANNED; post-V1; sequential workload/removal model and validation required |

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

### 14.2 Family B per-line calibration evidence gate

For every required Family B posted-line cohort, calibration
evidence is evaluated independently. A cohort contains the
selected-side predictions assigned to that posted-line
bucket. Voids are excluded from calibration. Only decided
win/loss picks are calibration-eligible.

Let:

n = number of calibration-eligible decided picks
W = observed number of wins
p_i = archived P(Win | grades) for decided pick i

The line-cohort gate has two distinct required conditions.

#### A. Sample sufficiency

n >= 30

passes the sample-sufficiency condition.

A cohort with fewer than 30 calibration-eligible decided
picks is sample-insufficient. It cannot pass the overall
line-cohort calibration evidence gate regardless of its
observed agreement.

#### B. Calibration agreement

When the individual archived probabilities p_i are
available, the primary calibration-agreement calculation is:

E = sum_i p_i

V = sum_i p_i(1-p_i)

Z = (W-E) / sqrt(V)

Calibration agreement passes when:

|Z| <= 1.96

and fails when:

|Z| > 1.96.

This heterogeneous-probability Poisson-binomial variance
form is primary. Family B HHR picks do not in general share
one common predicted probability, so their individual p_i
values must be preserved and used whenever available.

A pooled standard-error fallback is permitted ONLY when the
individual per-pick probabilities are unavailable.

For that fallback, let:

p_bar = cohort mean predicted win probability

E_pool = n p_bar

V_pool = n p_bar(1-p_bar)

Z_pool = (W-E_pool) / sqrt(V_pool)

and apply the same agreement rule:

|Z_pool| <= 1.96.

The calibration report must state whether the primary
per-pick calculation or the pooled fallback was used.
Using the pooled fallback when the individual p_i values
are available fails the evidence gate.

Missing or non-finite required inputs, or a variance that
does not permit the declared Z statistic to be evaluated,
fails closed rather than being assigned a passing
calibration status.

#### Distinct reporting states and final verdict

Every required line cohort must report at least:

calibrationEligibleDecidedPicks
sampleSufficiency
calibrationAgreement
observedWins
expectedWins
variance
zStatistic
absoluteZ
calculationMethod
overallCalibrationGate

Sample sufficiency and calibration agreement are distinct
states.

A cohort with n >= 30 but |Z| > 1.96 is:

sampleSufficiency = SUFFICIENT
calibrationAgreement = FAIL
overallCalibrationGate = FAIL

It may not be described as calibrated, sufficient overall,
accepted, or production-valid merely because its sample
count reached 30.

A line cohort passes this calibration evidence gate only
when BOTH conditions pass:

n >= 30
AND
|Z| <= 1.96

Family B lines remain independent for this gate. Evidence
from another line may not make a failing or insufficient
line pass. Lines at 2.5 and above remain bucketed
separately from 0.5 and 1.5 as required by Section 8.3.2.

#### Current documented HHR evidence

The current prospective out-of-fit HHR evidence uses the
primary per-pick heterogeneous-probability calculation
above. Voids are excluded.

0.5 Higher:

n = 85
W = 46
E = 55.705934323091086
V = 19.147632302489143
Z = -2.21809329367959
|Z| = 2.21809329367959

sampleSufficiency = SUFFICIENT
calibrationAgreement = FAIL
overallCalibrationGate = FAIL

The 0.5 cohort therefore fails even though it exceeds the
30-pick minimum. Its sample volume and its calibration
agreement are separate facts.

1.5 mixed:

n = 322
W = 180
E = 178.71045438559202
V = 79.15410537020644
Z = 0.14494391461076958
|Z| = 0.14494391461076958

sampleSufficiency = SUFFICIENT
calibrationAgreement = PASS
overallCalibrationGate = PASS

The 1.5 result is a pass of this line-cohort calibration
evidence gate only. It does not by itself validate the
Family B distribution or authorize production or ranking.

2.5+ Lower:

n = 11
W = 3
E = 7.395612920080345
V = 2.4209433645934486
Z = -2.8250564247543686
|Z| = 2.8250564247543686

sampleSufficiency = INSUFFICIENT
calibrationAgreement = FAIL
overallCalibrationGate = FAIL

The 2.5+ cohort fails sample sufficiency independently of
its calibration-agreement result. Its agreement statistic
is reported but may not substitute for the required minimum
sample volume.

These previously evaluated observations document the
current model's calibration status. They do not constitute
a newly reserved untouched period for a later candidate
revision. Section 14.1 continues to require a newly
reserved untouched active-current-season test period that
was not used to evaluate the prior version before a revised
post-freeze candidate may receive its untouched
evaluation.

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

### 15.3 Residual overdispersion, zero-mass misspecification, and tail compression

Test current-season distributions and line probabilities for overdispersion, zero-mass misspecification, and tail compression.

Possible residual correlation or distribution-shape sources:

- unmodeled game environment
- pitcher condition
- umpire zone
- batter condition
- bullpen quality
- game-state feedback
- cross-batter PA coupling
- team-level offensive shocks
- removal-hazard misspecification
- an omitted zero-occurrence process not represented by a single-component count distribution

If observed variance materially exceeds the analytic model, observed zero mass materially differs from the analytic model, or altline tails are compressed or otherwise materially misspecified:

1. document the failure
2. identify the specific omitted dependence or distributional structure
3. propose a shared random effect, fuller state process, zero-inflated form, hurdle form, or another explicit correction
4. update this specification before changing production code
5. revalidate chronologically

#### Documented Hits + Runs + RBIs Family B failure — 2026-08-12

The current HHR Family B fitting cohort contains 5,964
current-season rows from 340 games over 2026-07-06 through
2026-08-05.

The fitted single-component NB2 distribution materially
misspecifies the low-count PMF:

T     observed   model     gap
0     0.3315     0.3022   -0.0293
1     0.2237     0.2587   +0.0350
2     0.1636     0.1761   +0.0124
3     0.1157     0.1099   -0.0058
4     0.0733     0.0655   -0.0077
5     0.0431     0.0381   -0.0050
6     0.0228     0.0218   -0.0010
7     0.0132     0.0123   -0.0010
8+    0.0131     0.0155   +0.0024

Maximum observed T is 17.

The error is concentrated at T=0 and T=1 with opposite
signs. The model understates P(T=0) by 0.0293 and
overstates P(T=1) by 0.0350. For a 0.5 Higher offer,
P(T>=1)=1-P(T=0), so the fitted PMF mechanically
overstates that tail by 0.0293 before any later calibration.

Dispersion respecification was tested and rejected as the
active correction. Under the tested NB1 alternative, the
P(T>=1) tail gap changed only from +0.0293 under NB2 to
+0.0267 under NB1. Changing the variance law did not remove
the low-count error.

Prospective out-of-fit graded evidence, six archives,
422 retained selected-side rows, 418 decided:

cohort        n     predicted  observed   gap      log loss
0.5  Higher   85    0.6554     0.5412    -0.1142   0.7294
1.5  mixed    322   0.5550     0.5590    +0.0040   0.6817
2.5+ Lower    11    0.6723     0.2727    -0.3996   0.9174
global        418   0.5785     0.5478    -0.0307   0.6976

Reference: a coin flip scores 0.693 log loss. The 0.5
cohort and the global result are worse than a coin flip.

The 0.5 cohort is overconfident by 11.4 points on 85
decided picks, approximately 2.2 binomial standard
errors. The 1.5 cohort, which settles near the center of
the distribution, is calibrated. The observed failure is
confined to the cohorts settling on P(T>=1) and P(T<=2)
— exactly the two thresholds where the in-sample PMF
error is concentrated.

The 2.5+ cohort is n=11 and is reported for direction
only; it is not independently conclusive.

The documented omitted structure is therefore systematic
zero-mass behavior not represented by the current
single-component count law. Section 8.3.2 authorizes
zero-inflated and hurdle forms as explicit Family B
candidate corrections.

This finding does not select either candidate form and does
not authorize production use. Candidate selection,
freezing, chronological validation, untouched testing,
calibration, and production enablement remain subject to
Sections 14, 17, and 18.

#### HHR positive-count Stage 1 diagnostic — 2026-08-15

Subsequent zero-mass candidate evaluation refined the
earlier diagnosis above. The current defect is not adequately
described as an isolated excess-zero process.

The zero-mass-only development sequence tested scalar ZINB,
scalar hurdle, conditioned ZINB, and conditioned hurdle.
The conditioned-ZINB path included both the log(mu) form and
the approved three-input form. None satisfied the required
zero-mass and settlement-tail tolerances while the frozen
positive-count mean and dispersion were held fixed.

The conditioned hurdle isolated the positive-count
distribution from the zero-mass component for the first
time. A Stage 1 diagnostic therefore evaluated the 3,987
fitting observations with T >= 1 under the frozen
zero-truncated NB2 positive-count distribution. The
original five fitted-mu bins were retained from the complete
5,964-row fitting cohort.

Observed-minus-predicted conditional mean gaps for
E[T | T>=1] by fitted-mu bin were:

bin 0   +0.2458095465
bin 1   +0.0900069453
bin 2   +0.1193160366
bin 3   +0.1180341274
bin 4   -0.0266851731

Thus the frozen positive-count mean is systematically too
low through the first four fitted-mu bins, with the bias
approximately disappearing and slightly reversing only in
the highest-mu bin.

Observed-to-predicted conditional variance ratios by bin
were:

bin 0   1.3034204667
bin 1   0.9098898377
bin 2   0.9183746545
bin 3   0.9560479544
bin 4   0.8572370803

Observed conditional variance therefore does not exceed the
frozen zero-truncated NB2 prediction in most bins. General
positive-count overdispersion is not supported as the
primary remaining defect.

The aggregate positive-row conditional PMF also shows a
coherent shift away from the lowest positive count and
toward intermediate positive counts. Observed-minus-
predicted conditional PMF gaps were approximately:

T=1    -0.03499
T=2    -0.00734
T=3    +0.01544
T=4    +0.01540
T=5    +0.00963
T=6    +0.00273
T=7    +0.00206
T=8+   -0.00293

The conditional means are not approximately matched, so
the evidence does not support an isolated count-specific
NB-family defect as the primary explanation.

The resulting diagnosis is mean-structure misspecification
caused by using one mean fit across both zero and positive
observations. The all-row single-component fit allows the
1,977 zero observations to pull the fitted mean downward.
That depressed mean contributes simultaneously to the
observed zero-mass error and to insufficient positive-count
mass at higher counts. Zero-mass-only corrections cannot
repair the positive-count mean while that frozen mean
structure is retained.

For the next HHR hurdle candidate, the positive-count NB2
component is therefore authorized to refit its mean
coefficients and dispersion parameter on the 3,987 rows
with T >= 1 under the zero-truncated NB2 likelihood, as
permitted by Section 8.3.2. The existing HHR Family B
predictor set, predictor order, predictor standardization,
log link, and expected-plate-appearances offset with fixed
coefficient 1 remain unchanged. No new conditioning input
is authorized.

The successor candidate is accepted only if it satisfies the Section 17.46
zero-mass and settlement-tail tolerances on every required fitted-mu bin:
tau_zero <= 0.010 and tau_tail <= 0.010 at thresholds P(T=0), P(T>=1),
P(T>=2), and P(T>=3), with complementary lower tails reported.

The implied dispersion diagnostic remains reported but is not a rejection
criterion for this candidate under the previously logged Item O ruling.
Because the positive-count mean coefficients are refitted, alpha_implied may
change and must be reported from the candidate's fitted mu values. Section
17.46 alpha-gate scoping remains unresolved and is not amended in this
revision.

If the candidate fails any required bin at any required threshold, it is not
frozen, the reserved untouched period is not read, and HHR remains
production-disabled and ranking-disabled. A failed result may not be met by
relaxing a canonical tolerance within this model version.

The hurdle zero-mass component and the refitted
positive-count component must still combine into one exact
normalized PMF over T. This finding does not select or
freeze the successor candidate, does not authorize access
to reserved untouched evidence, and does not enable HHR
production or ranking.

#### HHR CONDITIONED-HURDLE ZERO COMPONENT RECOVERY

The successor hurdle candidate uses the previously approved conditioned-hurdle
zero component.

To recover the omitted frozen component reproducibly, fit exactly once on the
approved 5,964-row fitting cohort:

target:
    I(T = 0)

logistic predictors, in this exact order:
    1. intercept
    2. expectedPlateAppearances
    3. raw lineupSlot
    4. contextHitQualityLogit

raw lineupSlot is recovered from the frozen fitting fixture as:
    lineupSlot = 4 * centeredLineupSlot + 5

The recovered historical coefficient vector is:

    intercept                   = -0.3156807637
    expectedPlateAppearances    = -0.4421437692
    lineupSlot                  =  0.0101539499
    contextHitQualityLogit      = -1.0649822595

A deterministic reconstruction must reproduce each coefficient within 1e-8.
Otherwise fail closed and do not continue.

After successful reconstruction these coefficients are frozen. No further
zero-component fitting, predictor changes, model-family changes, coefficient
sweeps, or tolerance changes are permitted for this successor candidate.

This recovery changes no positive-count predictors, fitting period, reserved
untouched period, successor gate, calibration rule, ranking rule, or
production status.

#### HHR CONTINUATION-RATIO SUCCESSOR — 2026-08-17

The conditioned-hurdle successor authorized by Versions
1.12 and 1.13 was fitted on the approved 5,964-row
current-season fitting cohort.

Its numerical optimizer converged cleanly. The final
candidate nevertheless failed the predeclared fit-time
distribution-shape gate.

Worst required-bin absolute gaps were:

    P(T=0)     0.0206872
    P(T>=1)    0.0206872
    P(T>=2)    0.0212192
    P(T>=3)    0.0128291

all against the unchanged required tolerance of 0.010.

A subsequent diagnostic conditioned each fitted-mu bin on
T>=1, isolating the positive-count distribution from the
hurdle zero component.

Worst conditional positive-count absolute gaps were:

    P(T>=2 | T>=1)    0.0312144
    P(T>=3 | T>=1)    0.0232808

The positive-count errors vary in direction across fitted
bins. The evidence therefore rejects both a zero-only
correction and the refitted zero-truncated NB2 positive
component as sufficient descriptions of the remaining HHR
distribution shape.

The Version 1.12/1.13 successor is rejected. It is not
frozen. Its reserved untouched evidence remains sealed and
may not be used to select, fit, corroborate, or revise the
next candidate.

The next HHR Family B candidate is one continuation-ratio
direct discrete distribution over:

    T = Hits + Runs + RBIs.

For k = 0,...,7:

    c_k(x)
      = P(T >= k+1 | T >= k, x)

and:

    logit(c_k(x))
      = a_k + beta' z(x).

The candidate has one threshold-specific intercept a_k for
each k and one shared slope vector beta across all
thresholds.

The conditioning vector z(x), in exact order, is:

    1. log(expectedPlateAppearances)
    2. contextHitQualityLogit
    3. centeredLineupSlot
    4. platoonSplitCell
    5. opposingStarterPooling
    6. teamImpliedRunTotal
    7. precedingLineupSlotsOnBaseQuality

The six existing non-PA predictor definitions,
standardizations, and transforms remain exactly those of
the frozen HHR fitting evidence.

log(expectedPlateAppearances) retains the same transform
previously used by the NB2 offset, but it is now an ordinary
predictor with an estimated shared coefficient. Its
coefficient is no longer fixed at 1.

No additional conditioning input is authorized.

The candidate is fitted by deterministic maximum likelihood
using only the existing approved 5,964-row fitting cohort.
No later game, prospective grade, previously evaluated
untouched outcome, or newly reserved period may enter this
fit.

The model directly produces:

    P(T=0)
    P(T=1)
    ...
    P(T=7)
    P(T>=8)

through the continuation-ratio identities in Section
8.3.2.

The Version 1.13 conditioned-hurdle zero component is not
combined with this candidate. The continuation-ratio model
owns zero mass and every supported positive transition
inside one distribution. The Version 1.13 component remains
historical evidence for the rejected predecessor only.

No coefficient sweep, model-family fallback, line-specific
distribution, selected-side input, multiplier input, price
input, category input, or settlement-result input is
authorized.

No untouched period is reserved by this revision.

Before any freeze or untouched reservation may be proposed,
the fitted candidate must be reported against the existing
fit-time distribution-shape evidence.

The required zero-mass and settlement-tail tolerances remain
unchanged:

    tau_zero <= 0.010
    tau_tail <= 0.010

Required settlement targets remain at minimum:

    P(T=0)
    P(T>=1)
    P(T>=2)
    P(T>=3)

with the complementary lower tails reported.

The existing five-bin minimum, minimum row count, and
predeclared fit-time failure behavior remain in force.

Because this continuation-ratio candidate does not assume
an NB dispersion parameter, the Section 17.46
moment-equivalent alpha_implied calculation must still be
reported for every required bin as a residual variance
diagnostic, but alpha_implied is informational for this
specific HHR candidate and is not an acceptance or rejection
criterion. This candidate is accepted or rejected at fit
time by the structural requirements and the unchanged
zero-mass and settlement-tail requirements above.

The fit report must show the complete per-bin observed and
predicted zero mass and both upper and lower settlement
tails at every required threshold. It must also verify the
continuation-ratio survival curve numerically within every
required fitted-mu bin: mean predicted survival must be
strictly decreasing at each deeper supported threshold and
the complementary lower tail must be strictly increasing.
Any non-finite, equal, or reversed adjacent survival values
fail closed as a numerical monotonicity defect.

It must also provide an explicit comparison against every
previously evaluated HHR structural candidate for which the
corresponding fitting evidence exists, including at least:

    frozen v2 single-component NB2
    scalar ZINB
    scalar hurdle
    conditioned ZINB log(mu)
    conditioned ZINB approved-input form
    conditioned hurdle
    Version 1.13 conditioned-hurdle / refitted
      zero-truncated NB2 successor

The comparison must report the applicable per-bin gaps and
the worst-bin zero and settlement-tail gaps. Previously
recorded results may not be rewritten to improve
comparability.

A fit-time failure does not authorize a tolerance change.
The result must be reported before any candidate freeze,
new untouched reservation, or production-validation step is
proposed.

If any required zero or settlement-tail condition fails,
the candidate is not frozen.

If every required fit-time condition passes, the result is
still only a fitting-cohort pass. A separate later decision
is required before reserving a new untouched
active-current-season period or freezing the candidate.

HHR remains production-disabled and ranking-disabled.

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
30. Hits + Runs + RBIs is derived from either a
    tagged-player base-out joint distribution (Family A) or
    a directly fitted composite distribution over the
    settlement statistic (Family B), never from independent
    marginal convolution of separate Hits, Runs, and RBI
    distributions.
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
42. Every required Family B posted-line cohort independently
    verifies both Section 14.2 calibration-evidence
    conditions. Voids are excluded. The verification report
    must preserve the calibration-eligible decided-pick
    count, sample-sufficiency state, calibration-agreement
    state, observed wins, expected wins, variance,
    Z statistic, absolute Z, calculation method, and final
    line-cohort verdict.

    When individual per-pick probabilities are available,
    verification must use the primary heterogeneous-
    probability calculation defined in Section 14.2. The
    pooled standard-error fallback is permitted only when
    those individual probabilities are unavailable.

    A cohort that reaches the minimum sample volume but
    fails calibration agreement remains failed. Lines at
    2.5 and above remain bucketed separately. Aggregate
    calibration passing on shallow-line volume alone is not
    acceptance.
43. Family B cross-market coherence is computed and
    reported for related statistics fitted separately.
    Deviation beyond the declared versioned tolerance fails
    closed rather than being silently accepted.
44. A Family B distribution failing its calibration gate
    fails closed and cannot reach ranking. It may not be
    replaced by a shallower line, a standard line, a Family
    A approximation, or any fallback distribution.
45. Every market's mathematical family is read from the
    versioned registry in §12.2. No module infers,
    defaults, or substitutes a family at runtime.
46. Every fitted Family B count model must pass a
    distribution-shape diagnostic on its fitting evidence
    before the candidate is frozen.

    The fitting rows must be partitioned into versioned
    bins by fitted mean mu. The binning rule, bin edges or
    quantile rule, settlement thresholds, and all gate
    tolerances must be declared before the diagnostic gate
    is evaluated and must be identical across candidates
    being compared under the same model version.

    The diagnostic must contain at least five fitted-mu
    bins, and every required bin must contain at least 200
    fitting rows. The declared binning rule must yield no
    fewer than five bins satisfying that minimum. A rule
    that yields fewer than five qualifying bins, or any
    required bin with fewer than 200 rows, fails the gate.

    For every fitted-mu bin, report at least:

    - row count
    - mean fitted mu
    - observed mean settlement statistic
    - implied dispersion alpha
    - observed zero mass
    - mean model-predicted zero mass
    - zero-mass observed-minus-predicted gap
    - observed and model-predicted lower-tail probability
      at every required settlement threshold
    - observed and model-predicted upper-tail probability
      at every required settlement threshold
    - the observed-minus-predicted tail gap for each
      threshold and direction

    At minimum, the required distribution-shape targets
    are:

    P(T=0)
    P(T>=1)
    P(T>=2)
    P(T>=3)

    These cover settlement at posted lines 0.5, 1.5, and
    2.5. Both Higher and Lower settlement tails must be
    reported, including the complementary lower tails
    P(T<=0), P(T<=1), and P(T<=2).

    If the supported live market posts a deeper line, every
    additional settlement threshold needed to settle that
    line is also required. A candidate may not omit a
    posted threshold from the diagnostic gate.

    For the NB2 variance law:

    Var(T_i | mu_i) = mu_i + alpha mu_i^2

    the raw per-bin moment-equivalent implied alpha is:

    alpha_implied(bin)
      = sum_i [ (T_i-mu_i)^2 - mu_i ]
        / sum_i mu_i^2

    over rows i in that bin.

    The reported implied alpha must not be clipped merely
    to make the diagnostic appear valid. If another
    analytic count form is evaluated, the same
    moment-equivalent diagnostic must still be reported so
    residual variance drift across fitted-mu bins remains
    visible.

    Let the versioned fitting artifact declare:

    tau_alpha
      = maximum permitted range of alpha_implied across
        required fitted-mu bins

    tau_zero
      = maximum permitted absolute observed-versus-model
        zero-mass gap in any required fitted-mu bin

    tau_tail
      = maximum permitted absolute observed-versus-model
        tail-probability gap at any required settlement
        threshold in any required fitted-mu bin

    The following are canonical ceilings on those declared
    tolerances:

    tau_zero  <= 0.010
    tau_tail  <= 0.010
    tau_alpha <= 0.150

    A versioned fitting artifact may declare a tighter
    tolerance but never a looser one. A candidate declaring
    tau_zero greater than 0.010, tau_tail greater than
    0.010, or tau_alpha greater than 0.150 fails the gate
    on that basis alone.

    The fit-time distribution-shape gate fails when:

    max_bin(alpha_implied)
      - min_bin(alpha_implied)
      > tau_alpha

    or when:

    max_bin |observed P(T=0)
             - predicted P(T=0)|
      > tau_zero

    or when any required settlement-threshold tail has:

    |observed tail probability
      - predicted tail probability|
      > tau_tail.

    A missing required bin, insufficient required-bin row
    count, missing required live settlement threshold,
    undeclared tolerance, tolerance looser than the
    canonical ceiling, post-hoc tolerance change, or
    incomplete diagnostic report also fails the gate.

    This gate is separate from later calibration and
    untouched-test evaluation. Its purpose is to prevent a
    candidate with visible in-sample distribution-shape
    error from remaining frozen for weeks before the error
    is discovered in prospective settlement results.

    Failure blocks candidate freeze and production
    validation. Any post-freeze respecification remains
    subject to Section 14.1 and therefore requires a new
    model version, a written reason recorded before
    re-evaluation, and a newly reserved untouched
    active-current-season test period not used to evaluate
    the prior version.

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

- tagged-player base-out model for any market assigned
  Family A in the §12.2 registry
- for any market assigned Family B: the versioned direct
  composite fit, its conditioning input contract, its
  exact analytic distribution form, any required
  zero-mass correction under §8.3.2, its required §17
  fit-time distribution-shape diagnostic and versioned
  tolerances, its per-line calibration report including
  separate deep-line buckets, its cross-market coherence
  tolerance, and its fail-closed gate
- when §15.3 or §17 establishes systematic zero-mass
  misspecification, the selected zero-inflated, hurdle, or
  later canonically approved explicit correction must be
  frozen and versioned before chronological validation and
  may not be replaced at runtime by the prior uncorrected
  distribution
- runner-identity and advancement data sufficiency
  (required for Family A; for Family B, required only to
  the extent it feeds the declared conditioning inputs)
- intentional-walk settlement handling for any Walk market
- market-specific eligibility event `P(A)`
- versioned settlement rules and their verified temporal applicability,
  recorded per §12.1

### Calibration

- overdispersion correction, if required
- zero-mass correction, if required by the §15.3 failure
  analysis and §17 fit-time distribution-shape gate
- hierarchical calibration method
- calibration pooling strength
- minimum calibration reporting volumes for families other
  than Family B
- recalibration schedule

For Family B, minimum per-line calibration evidence volume
and the calibration-agreement acceptance rule are fixed by
Section 14.2. This does not complete the still-required
hierarchical calibration method, calibration pooling
strength, or recalibration schedule, and does not define
minimum reporting volumes for any other family.

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

Family B per-line calibration evidence gate (§14.2):
n = calibration-eligible decided selected-side picks
voids excluded

sample sufficiency:
n >= 30

primary heterogeneous-probability agreement:
E = sum_i p_i
V = sum_i p_i(1-p_i)
Z = (observedWins-E) / sqrt(V)
PASS when |Z| <= 1.96

overall line-cohort gate:
n >= 30 AND |Z| <= 1.96

pooled fallback only when individual p_i are unavailable:
p_bar = cohort mean predicted win probability
E_pool = n p_bar
V_pool = n p_bar(1-p_bar)
Z_pool = (observedWins-E_pool) / sqrt(V_pool)

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

H+R+RBI — Family A (tagged-player base-out, §8.3.1):
P(T=t) = Σ_(h+r+b=t) P(H=h,R=r,RBI=b)

H+R+RBI — Family B (directly fitted composite, §8.3.2):
P(T=t) = fitted directly over the settlement statistic T,
         conditioned on the declared baseball-unit inputs.
         The triple joint P(H=h,R=r,RBI=b) is not formed.

Approved Family B zero-mass forms:
Let Q(t|x) be an exact analytic directly fitted count PMF.

Zero-inflated:
P(T=0|x) = pi(x) + [1-pi(x)]Q(0|x)
P(T=t|x) = [1-pi(x)]Q(t|x), t>=1

Hurdle:
P(T=0|x) = rho(x)
P(T=t|x) = [1-rho(x)]Q(t|x)/[1-Q(0|x)], t>=1

Batter Runs — Family B (§8.3.2):
P(R=r) = fitted directly over the settlement statistic R,
         conditioned on the declared baseball-unit inputs.

Active family per market is read from the §12.2 registry.
Neither family may be constructed by convolving independent
Hits, Runs, and RBI marginals.

Fail closed:
no validated distribution → no ranked prop
```

---

## Changelog

### Version 1.14 — 2026-08-17

- Recorded the converged rejection of the Version 1.12/1.13
  HHR conditioned-hurdle successor: worst required-bin
  zero/tail gaps remained above the unchanged 0.010
  fit-time tolerance.
- Recorded the conditional-positive diagnostic showing the
  remaining defect is not zero-only: worst conditional
  positive-count gaps were 0.0312144 at T>=2 and 0.0232808
  at T>=3.
- Authorized one next HHR Family B structural candidate:
  an exact analytic continuation-ratio distribution fitted
  directly over T=Hits+Runs+RBIs with threshold-specific
  intercepts and one shared baseball-predictor slope vector.
- Retained the existing six HHR predictors and their frozen
  definitions and transforms; moved
  log(expectedPlateAppearances) from a fixed coefficient-1
  offset to an ordinary predictor with an estimated shared
  coefficient.
- Defined the continuation identities for T=0 through T=7
  and the terminal T>=8 tail, with fail-closed behavior for
  any posted settlement threshold requiring distinctions
  inside that terminal tail.
- Recorded that the continuation-ratio survival is strictly
  decreasing by construction because every continuation
  probability is in (0,1), and required per-bin numerical
  verification of monotone Higher/Lower settlement tails;
  non-finite, equal, or reversed adjacent survival values
  fail closed.
- Retired the Version 1.13 hurdle-zero component from the
  new candidate while preserving it as historical evidence
  for the rejected predecessor.
- Kept tau_zero <= 0.010 and tau_tail <= 0.010 unchanged.
  Required the moment-equivalent alpha diagnostic to remain
  reported but made it informational for this non-NB HHR
  candidate.
- Required a complete per-bin comparison against the
  previously evaluated HHR structural candidates before
  any freeze decision.
- Reserved no new untouched period, authorized no candidate
  freeze, read no untouched outcomes, and made no
  production, ranking, calibration, settlement, category,
  or provider change.

### Version 1.13 — 2026-08-17

- Repaired an omitted reproducibility contract for the already-approved HHR conditioned-hurdle zero component without changing the approved successor model.
- Declared the exact zero target, logistic predictor order, raw-lineup-slot reconstruction, recovered historical coefficient vector, and deterministic coefficient-reconstruction tolerance of `1e-8`.
- Froze the recovered zero component after successful reconstruction and prohibited any further zero-component refitting, predictor changes, model-family changes, coefficient sweeps, or tolerance changes for this successor candidate.
- Preserved the positive-count predictors and fitting period, reserved untouched period, successor distribution-shape gate, calibration rule, ranking rule, and production/ranking-disabled status.

### Version 1.12 — 2026-08-15

- Clarified the approved Family B hurdle fitting contract:
  the positive-count component may be fitted on T >= 1
  observations under its zero-truncated likelihood and may
  estimate its own mean coefficients and dispersion
  parameter separately from the hurdle zero-mass component.
- Required that positive-row hurdle fitting preserve the
  declared Family B conditioning-input contract, link,
  offset role and fixed offset coefficient, predictor
  order, and predictor standardization or other declared
  transforms unless a separate canonical revision
  explicitly authorizes their change.
- Recorded the 3,987-positive-row Stage 1 diagnostic and the mean-structure diagnosis.
- Recorded observed-to-predicted conditional variance
  ratios of 1.3034204667, 0.9098898377, 0.9183746545,
  0.9560479544, and 0.8572370803, rejecting general
  positive-count overdispersion as the primary remaining
  defect.
- Recorded that scalar ZINB, scalar hurdle, conditioned
  ZINB, and conditioned hurdle zero-mass-only development
  paths failed to satisfy the required distribution-shape
  tolerances while the frozen positive-count mean remained
  fixed. The conditioned-ZINB path included both evaluated
  conditioning forms.
- Refined the HHR diagnosis from an isolated zero-mass
  defect to single-mean misspecification: fitting one mean
  across zero and positive observations depresses the mean
  and contributes to both zero-mass error and insufficient
  positive-count mass.
- Authorized exactly one next HHR candidate path: retain
  the existing six positive-count predictors, their order
  and standardization, the log link, and expected-plate-
  appearances offset with coefficient 1, while refitting
  the positive-count mean coefficients and dispersionAlpha
  on T >= 1 rows under the zero-truncated NB2 likelihood.
- Preserved the requirement that the hurdle zero and
  positive components form one exact analytic normalized
  PMF and preserved all selected-side, line, multiplier,
  price, category, and settlement-result input
  prohibitions.
- Predeclared the successor acceptance condition before fitting:
  every required fitted-mu bin must satisfy tau_zero <= 0.010
  and tau_tail <= 0.010 at P(T=0), P(T>=1), P(T>=2), and
  P(T>=3), with complementary lower tails reported. Kept
  alpha_implied informational under the separately logged Item O
  ruling, required it to be recomputed from the candidate's fitted
  mu values, prohibited post-result tolerance relaxation within
  this model version, and left Section 17.46 unchanged.
- Did not select or freeze a candidate, read reserved
  untouched evidence, enable HHR production or ranking, or
  alter Section 17.46.

### Version 1.11 — 2026-08-12

- Defined the Family B per-line calibration evidence gate in
  Section 14.2 as the sole mathematical owner of the gate.
- Required at least 30 calibration-eligible decided
  selected-side picks per posted-line cohort, with voids
  excluded and every line cohort evaluated independently.
- Defined the primary heterogeneous-probability calibration
  agreement statistic as E=sum p_i,
  V=sum p_i(1-p_i), and
  Z=(observedWins-E)/sqrt(V), with agreement passing only
  when |Z|<=1.96.
- Permitted the pooled standard-error fallback only when
  individual per-pick probabilities are unavailable and
  required every report to identify which method was used.
- Required sample sufficiency, calibration agreement, and
  final gate verdict to remain distinct reported states. A
  sample-sufficient cohort that fails agreement remains
  calibration-failed and is not sufficient overall.
- Recorded the current HHR primary-form per-line evidence:
  the 0.5 Higher cohort has n=85, W=46,
  E=55.705934323091086, V=19.147632302489143,
  Z=-2.21809329367959 and therefore fails calibration
  agreement despite sufficient sample volume; the 1.5
  mixed cohort has n=322, W=180,
  E=178.71045438559202, V=79.15410537020644,
  Z=0.14494391461076958 and passes both conditions; the
  2.5+ Lower cohort has n=11, W=3,
  E=7.395612920080345, V=2.4209433645934486,
  Z=-2.8250564247543686 and fails both sample sufficiency
  and calibration agreement.
- Preserved per-line independence, separate 2.5+ bucketing,
  Family B fail-closed behavior, and production/ranking
  disablement.
- Preserved Section 14.1 unchanged: any post-freeze
  candidate revision still requires a new model version,
  a written pre-evaluation reason, and a newly reserved
  untouched active-current-season test period not used to
  evaluate the prior version. The previously evaluated HHR
  evidence recorded above does not satisfy that future
  untouched-period requirement.
- Retained minimum calibration reporting volumes as an open
  production-readiness definition for mathematical families
  other than Family B.

### Version 1.10 — 2026-08-12

- Added zero-inflated and hurdle distributions as approved
  explicit zero-mass forms within Family B while preserving
  one final PMF over the official settlement statistic,
  exact analytic runtime evaluation, shared baseline/altline
  distribution reuse, and the prohibition on independent
  Hits/Runs/RBI marginal convolution.
- Required the zero-mass component to use declared,
  versioned active-current-season baseball-unit inputs and
  prohibited selected side, posted line, price, multiplier,
  category, or settlement result from entering the
  zero-mass predictor.
- Documented the current HHR Family B single-component NB2
  failure on 5,964 fitting rows: observed P(T=0)=0.3315
  versus modeled 0.3022 and observed P(T=1)=0.2237 versus
  modeled 0.2587.
- Recorded prospective out-of-fit evidence from six
  archives and 418 decided selected-side rows: the 0.5
  Higher cohort was overconfident by 0.1142 with log loss
  0.7294, while the 1.5 cohort remained calibrated; the
  global log loss was 0.6976.
- Recorded that dispersion respecification was tested and
  rejected as the active correction because the tested NB1
  alternative changed the P(T>=1) tail gap only from
  +0.0293 to +0.0267.
- Added a required pre-freeze Family B fit-time
  distribution-shape diagnostic binned by fitted mu,
  including raw implied-alpha drift, observed-versus-model
  zero mass, and both settlement tails at every required
  threshold.
- Required at least five fitted-mu bins with at least 200
  rows per required bin and required, at minimum,
  P(T=0), P(T>=1), P(T>=2), and P(T>=3), with every
  additional threshold required by deeper live posted
  lines also included.
- Established canonical maximum tolerances of
  tau_zero <= 0.010, tau_tail <= 0.010, and
  tau_alpha <= 0.150. Fitting artifacts may declare
  tighter values but never looser values; a looser
  declaration fails the gate by itself.
- Added any evidence-required zero-mass correction and the
  fit-time distribution-shape gate to the production
  readiness requirements.
- This revision approves candidate forms and verification
  requirements only. It does not select a new HHR model,
  authorize use of the previously evaluated untouched
  cohort, or enable HHR production or ranking.

### Version 1.9 — 2026-08-11

- Replaced the mandatory settlement-rule effective-date requirement with
  evidence-bound temporal applicability recorded as exactly one of an
  explicitly operator-designated effective date or a verified rule-version
  publication boundary when no effective date is supplied.
- Required the stored field name to distinguish effective dates from
  publication boundaries and prohibited registration when the source supplies
  neither form of temporal applicability.
- Updated the Section 18 production-readiness requirement to reference the
  verified temporal applicability rule in Section 12.1.

### Version 1.8 — 2026-08-05

- Restructured Section 8.3 into two approved model families
  for lineup- and base-out-dependent markets.
- Family A retains the tagged-player base-out joint model
  unchanged.
- Added Family B, a directly fitted composite distribution
  over a market's own official settlement statistic,
  conditioned on context-adjusted baseball-unit inputs, as
  an approved production family.
- Recorded that Family B fits the settlement statistic
  directly and does not form the triple joint
  P(H=h,R=r,RBI=b).
- Preserved without change the prohibition on constructing
  Hits + Runs + RBIs from independent marginal convolution.
  Family B is a single direct fit, not a combination of
  marginals.
- Required per-line calibration for Family B markets with
  lines at 2.5 and above bucketed separately, on the
  grounds that the conditional independence assumption
  compresses distribution tails and can make deep alternate
  lines read as safer than they are.
- Required a cross-market coherence diagnostic with a
  declared versioned tolerance when related statistics are
  fitted separately under Family B.
- Required Family B calibration failure to fail closed with
  no fallback to shallower lines, standard lines, or a
  Family A approximation.
- Assigned Batter Hits + Runs + RBIs and Batter Runs to
  Family B in the §12.2 registry.
- Added Batter Runs to the §12.2 market registry. It was
  absent in Version 1.7, which would have rendered the
  market ineligible for production ranking.
- Moved Batter Total Bases and Pitcher Strikeouts to
  post-V1 status per the V1 scope section of
  PROJECT_CHECKLIST.md.
- Replaced Section 17 item 30 and appended items 42-45.
- Replaced the Section 18 game-state component requirement
  to be family-conditional.

### Version 1.7 — 2026-08-03

- Defined context-factor composition order for multiple validated factors
  applied to one base evaluation.
- Ordered shared-scenario factors before terminal-outcome factors and
  required replacement factors to precede transformation factors on any
  branch where both apply.
- Distinguished replacement factors, which substitute a complete terminal
  vector for a declared subset of plate appearances, from transformation
  factors, which multiply a resulting vector elementwise and renormalize
  once across every plate appearance in scope.
- Prohibited any plate appearance from receiving the same factor twice.
- Added the category-support boundary: composition applies a factor only
  over categories the base model carries, and a non-identity effect on an
  omitted category fails closed instead of being silently discarded.
- Recorded that the active M8 Batter Hits base model carries fourteen
  terminal categories and omits `OTHER_PA`.

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