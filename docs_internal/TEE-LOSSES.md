# Tee losses — the largest known approximation in the engine

**Status: DECIDED, NOT BUILT.** Michael chose the middle path on 2026-08-26.
This file exists because he expects to come back to it: *"I'll probably come
back to this issue in future. Is it fully logged?"*

Carried in `Human-Test.md` as open engineering question **EQ.3** and in
`WORKLIST.md` as **TEE.1**.

**Read §6A first if you are picking this up.** Two research passes commissioned
by Michael on 2026-08-26 (`TEE-LOSSES-RESEARCH.md` and
`TEE-LOSSES-RESEARCH-B.md`) changed the plan materially: the solver risk this
file feared in §6 has a standard answer, and the build order is now staged.

---

## 1. The decision

> *"I'm inclined to the middle path, mixing in Idelchik data may be confusing
> for consistency (we are already mixing in Carrier data)... take the middle
> path, but document it properly in the Engine page."* — Michael, 2026-08-26

**Make only the BRANCH coefficient a function of the flow ratio Qb/Qc. Leave the
run flat.**

Rejected, and why:

| Option | Verdict |
|---|---|
| Full treatment from **Idelchik** — K as a function of flow ratio *and* area ratio, all four cases | Best data, wrong fit. A third provenance on top of ASHRAE and Carrier, a large data-entry job, and its own verification burden. Michael: mixing it in "may be confusing for consistency". |
| Full treatment from **ASHRAE Ch 22 Table 7** | Same provenance as the rest, but sparse, and it reports one "100 % mix" figure for combining where this engine charges two inlets independently. Mapping one number onto two is an interpretation — and a previous attempt at exactly that (a guessed 1.5x multiplier) is what left this open for weeks. |
| **Middle path — branch only** | Chosen. Nearly all the variation is in the branch, and the branch is where most of the tees are. Defers the reference-velocity problem to one coefficient instead of four. |
| Leave it alone | The exposure below is too large to ignore indefinitely. |

---

## 2. What the engine does today

At every tee the three legs are classified by **geometry**: the two most nearly
collinear pipes are the *run*, the odd one out is the *branch*. A symmetric
split (bullhead) has no run, so both charged legs count as branch
(`isSymmetricSplit`).

**Dividing vs combining is decided from FLOW**, on the second pass, and the
charging rule differs:

| Case | Charged legs | Why |
|---|---|---|
| Dividing — one in, two out | both **outlets** | each leaving stream pays for the split it went through |
| Combining — two in, one out | both **inlets** | the branch *inflow* suffers most of the loss, and used to be charged nothing at all |

That charging rule is a real, separate correction and it stands. It is **not**
part of what is approximate here.

### The numbers actually charged

Two tables are in play. Which is used depends on the friction method's
`fittingMode`.

**(a) L/D fallback** — `FD.fittings.types`, spec §3.3:

| Type | L/D | `sourced` |
|---|---|---|
| `TRUN`, `TRUN_DIV`, `TRUN_CONV` | 20 | yes |
| `TBRANCH`, `TBRANCH_DIV`, `TBRANCH_CONV` | 60 | yes |

Combining equals dividing by **Michael's decision of 2026-07-31**, following
2021 ASHRAE Fundamentals Ch 22 Tables 3 and 4, which tabulate a single tee-line
and a single tee-branch figure and do not split the two cases.

**(b) Carrier Design Handbook Table 11** — "Fitting Losses in Equivalent Feet of
Pipe", supplied by Michael 2026-08-02, in feet by nominal size. This is the
operative table for the default method:

| DN | 25 | 32 | 40 | 50 | 65 | 80 | 90 | 100 | 125 | 150 | 200 | 250 | 300 |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| **TBRANCH** ft | 5.0 | 7.0 | 8.0 | 10 | 12 | 15 | 18 | 21 | 25 | 30 | 40 | 50 | 60 |
| **TRUN** ft | 1.7 | 2.3 | 2.6 | 3.3 | 4.1 | 5.0 | 5.9 | 6.7 | 8.2 | 10 | 13 | 16 | 19 |

The two tables agree closely. Carrier's DN50 branch is 10 ft = 3.05 m against a
52.48 mm bore, i.e. **58 L/D**; DN100 is 21 ft = 6.40 m against 102.26 mm, i.e.
**63 L/D**. The run works out at **19–20 L/D** across the range. So Carrier is
the same figures made size-specific, not a different opinion.

**Code:** `data/fittings.js` (both tables), `src/network.js` `teeFittings` /
`fittingsByPipe` (classification and charging).

---

## 3. What is approximate — two separate things

### 3.1 The coefficient is flat

A real tee's loss coefficient is a function of **Qb/Qc** — branch flow over
combined flow — and it varies by **more than a factor of ten** across that
range. One number cannot track it. A branch bleeding 5 % off a fast main and a
branch taking nearly all the flow are physically different fittings, and the
engine charges them identically.

### 3.2 The reference velocity does not match the published data

**This one is structural, not a wrong number.** Equivalent length converts to a
resistance *in that leg's own pipe, at that leg's own velocity*. Published tee
coefficients are normally referenced to the **common (combined) leg's
velocity**. So a correct K cannot simply be dropped into the L/D framework — the
conversion depends on the area ratio **and** the flow ratio.

This is why the earlier 1.5x attempt went nowhere. The mapping, not the
magnitude, is the hard part.

---

## 3.3 Does the friction method change this? — NO, but it matters anyway

Michael asked, 2026-08-26: *"Does DW & HW calculations change how PD is
calculated at tees? i.e. if the problem exists mostly in HW, then we should push
users to DW instead."*

The two methods use **entirely different fitting datasets**:

| | Hazen-Williams (default) | Darcy-Weisbach (BETA) |
|---|---|---|
| `fittingMode` | `'EL'` — equivalent length | `'K'` — velocity-head coefficients |
| tee data | Carrier Table 11, feet by size (L/D 20 / 60 fallback) | ASHRAE Tables 3/4, K by size |
| tee K / L-D values | run 19–20 L/D, branch 58–63 L/D | run **K = 0.90** flat; branch **K = 2.7 → 1.1**, falling with size |
| how it enters the link | folded into the pipe: `r(L + el)` | a **separate** resistance `rK`, alongside |
| exponent on the fitting loss | **1.852** (inherits HW's) | **2** |

**Pushing users to Darcy does NOT fix the tee problem.** The defect is that the
coefficient does not vary with **Qb/Qc**, and *neither dataset does*. ASHRAE's K
varies with SIZE and connection type; Carrier's equivalent length varies with
size. Flow ratio appears in neither. The reference-velocity mismatch (§3.2) is
identical too — `K·V²/2g` uses the leg's own velocity exactly as equivalent
length does.

**But there is a separate and real argument for Darcy on fitting-heavy models.**
A fitting loss is a velocity head: it scales as **Q²**. Hazen-Williams folds the
equivalent length into the pipe, so every fitting is charged at **Q^1.852**.
That is the wrong exponent, and it is wrong for *all* fittings, not just tees.

It cancels at the design point — both are calibrated there — and only shows up
as flows move away from it, i.e. **in SIMULATION**. The size of it is
`2^(2−1.852) = 2^0.148 ≈ 1.11`: at double design flow the HW fitting term is
understated by about **11 %**, and at half flow overstated by the same factor.
On a model that is 39 % tee equivalent length that is roughly **4 % of total
loss** at 2x design flow — real, but an order of magnitude smaller than the
flow-ratio problem this file is about.

Two consequences for **TEE.1**:

1. **The fix has to be done twice, or once above both.** A flow-ratio-dependent
   branch coefficient has to reach the K table *and* the equivalent-length
   table, or be expressed once in a layer above them. Decide that before
   entering any data — it is the difference between one job and two.
2. **Recommending Darcy is a separate decision with its own baggage** — see
   EQ.1 and EQ.2 in `Human-Test.md`. Darcy is still marked BETA in the app, and
   at C = 120 against ε = 0.045 mm it reads 16–27 % lower on friction rate, so
   "just switch to Darcy" moves more than the fittings.

---

## 4. How much it matters — measured

Tee equivalent length as a share of total effective length, DESIGN mode,
measured 2026-08-26:

| Model | Drawn | All fittings | **Of which tees** | Tees (branch) |
|---|---|---|---|---|
| `Data Hall & Yard` | 685 m | 877 m (56 %) | **613 m (39 %)** | 102 (58) |
| `highrise-variable-primary` | 425 m | 299 m (41 %) | **220 m (30 %)** | 46 (23) |
| `tower-five-level` | 222 m | 94 m (30 %) | **53 m (17 %)** | 18 (9) |
| `Tutorial 01 - Basics` | 94 m | 9 m (8 %) | 4 m (4 %) | 2 (1) |

**On a headered system roughly a third of the friction is tee charges** — more
than the drawn pipe contributes beyond itself on the Data Hall.

---

## 5. What leaving the run flat means

Michael put the consequence and it is **correct**:

> *"If path of most resistance is down run: Slightly higher resistance
> calculated than actual. If path of most resistance is down branch: Correctly
> calculated down branch, higher resistance down run."*

Two additions worth keeping:

**It is conservative.** In the common case — a header where each tee bleeds off
a small fraction, so Qb/Qc is small — the real straight-through loss approaches
**zero** while a flat 20 L/D is charged at every tee along the way. The model
over-states, never under-states, so the pump comes out bigger rather than
smaller. That is the safe direction for a design tool and it is why shipping the
middle path needs no heavy caveat.

**It is not uniform across circuits.** A path running the length of a header
passes many run tees; one turning off early passes few. The over-charge
therefore scales with how far along a header a terminal sits, which
**exaggerates remoteness** and pushes index selection toward the far end. Same
direction as the conservative bias, so the two do not fight.

Neither point has been quantified. Doing so would be a good first step.

---

## 6. What building it involves

The good news: **the two-pass machinery already re-derives tee TYPE from flow**,
so a flow-dependent coefficient fits the existing shape rather than fighting it.
`fittingsByPipe(m, flows, warnings)` already takes the previous pass's flows.

The two hard parts, in order:

1. **The reference-velocity conversion** (§3.2). Decide once, write it down, and
   put a worked example in `engine.html` — this is where the previous attempt
   died.
2. **`r` becomes a function of Q.** Today equivalent length is folded into a
   link's resistance *before* the GGA runs, so `r` is constant during a solve. A
   K that depends on Qb/Qc breaks that. The Newton step's derivative
   (`linkDhdq`) assumes the current form. Given how much of 2026-08-24/25 went on
   control-loop convergence, expect the difficulty to land here rather than in
   the data.

Watch for the §18 frozen-active-set trap and the §6 check-valve lesson in
`HANDOVER.md`: a quantity that depends on the solution, fed back into the
solution, is exactly the shape that has bitten this project before. The
established remedy is to freeze it for the whole of a pass and re-derive between
passes — which is what the tee TYPE already does.

---

## 6A. The 2026-08-26 research — what it changes

Michael commissioned two research passes. Both are in `docs_internal/`:
**`TEE-LOSSES-RESEARCH.md`** (the substantial one) and
**`TEE-LOSSES-RESEARCH-B.md`** (shorter, partly redundant).

### It de-risks the hard part. §6 was too pessimistic.

§6 said the difficulty would land in the solver, because a flow-dependent K
makes a link's `r` a function of Q. **The research supplies the answer, and it is
the EPANET form**, which uses the same Global Gradient Algorithm this engine
does. EPANET writes each link as:

```
H_i - H_j  =  r * Q^n  +  m * Q^2
```

The fitting loss is a **separate additive term**, never folded into `r`. That one
change resolves three things at once:

1. **The Newton derivative stays trivial** — `d(m·Q²)/dQ = 2·m·Q`, added to
   `linkDhdq`. No new numerical hazard, which is what §6 feared.
2. **It fixes the exponent problem in §3.3** for free. The fitting term sits at
   exponent 2 while Hazen-Williams keeps 1.852 on the pipe, because they are now
   different terms.
3. **It makes the fix ONE job, not two** (the concern raised in §3.3). Express
   the branch coefficient once as `m(Qb/Qc)` and both friction methods share it.

**Confirmed against the code:** the Darcy path already carries exactly this —
`link.rK = FD.hydraulics.fittingR(sumK, d)`, a separate resistance alongside
`link.r`. So half the architecture exists; the work is bringing Hazen-Williams
onto it rather than inventing anything.

### It dissolves §3.2 rather than solving it

Do **not** convert the coefficient into each leg's frame. Compute the loss
directly at the combined-leg velocity:

```
dH = Kc * Vc^2 / (2g)
```

If a per-leg form is ever needed the conversion is exact and both research
documents agree on it:

```
Ki = Kc * (Vc/Vi)^2 = Kc * (Qc/Qi)^2 * (Ai/Ac)^2
```

**This is why the 1.5x attempt failed**: it put a combined-velocity number into
an equivalent-length slot in each leg. The remedy is to stop using equivalent
length for tees, not to find a better multiplier.

### Two findings that strengthen decisions already taken

* **A flat coefficient is the industry NORM, not a poor shortcut.** Crane TP-410
  and EPANET both use one. The middle path is therefore *more* accurate than the
  common baseline, not a compromise below it.
* **The true run coefficient can go NEGATIVE at low flow ratio** — real physics
  in a combining tee, where the fast stream gives kinetic energy to the slow one
  (total loss across the tee stays positive). So the run-flat over-charge
  described in §5 is **larger** than §5 states, and the conservative bias is
  stronger. Good news for shipping it; worth quantifying.

### Recommended source: Rennels & Hudson, Ch 16

Closed-form equations, no table digitisation, and it is what MathWorks Simscape's
T-Junction block uses (Rennels / Crane / custom — which is precisely the middle
path's shape). **Caveat carried by the research itself:** the combining-tee form
is the less exact of the two, and a combining tee is the case this engine charges
most (two inlets). Treat that as the main technical risk.

### TWO THINGS THE RESEARCH GETS WRONG OR MISSES

1. **The two documents contradict each other on ASHRAE, and B is the wrong one.**
   `TEE-LOSSES-RESEARCH-B.md` §3.4 claims ASHRAE Fundamentals **Ch 22** "maps
   branch loss coefficients against the flow ratio" and "gives precise curves".
   The main research attributes flow-ratio treatment to the ASHRAE **Duct Fitting
   Database** (air side), which matches what this codebase already records:
   Ch 22 Tables 3 and 4 give SINGLE values, and Table 7 gives one "100 % mix"
   figure. **Trust the main document.** The difference matters — it is
   "we already own the source" against "we need a new one".

2. **Nobody flagged what this does to existing Hazen-Williams answers.** Moving
   fittings out of the pipe length and into `m·Q²` **changes the numbers on every
   saved HW model**, not only at tees and not only off design. It is the right
   change and it fixes a real exponent error, but it is a re-baselining event: it
   needs its own before/after comparison on the frozen fixtures, and Michael has
   to know the sheet will not reproduce a previously issued one.

### Build order, revised

1. Bring Hazen-Williams onto the additive `m·Q²` fitting term, with the EXISTING
   flat coefficients. **Change nothing else.** Measure the shift on every frozen
   fixture and get Michael's acceptance of the re-baseline.
2. Only then make the branch `m` a function of Qb/Qc, from Rennels Ch 16.
3. Freeze `m` for the whole of a pass; re-derive between passes, exactly as the
   tee TYPE already is.
4. Add `2·m·Q` to `linkDhdq`.
5. Record the zero-flow discontinuity risk (Deltares WANDA reports the sign
   change as a solver hazard) in `engine.html` §10 before any simulation work
   leans on it.

Splitting step 1 from step 2 is the important part: it separates a re-baselining
change from a physics change, so that if the numbers move, it is known which one
moved them.

---

## 6B. ASHRAE Ch 22 Table 7 — checked, 2026-08-26

Michael supplied the chapter. **The source document is his and is NOT in this
repository and must never be** — this repo is published to GitHub Pages. Values
are quoted here as facts; the document stays out.

### It is a misdirect, as he suspected

Table 7 is *Summary of Test Data for Loss Coefficients K for Steel Pipe Tees*.
Its three rows per size are three **flow configurations**, not a curve:

| row | means | flow ratio |
|---|---|---|
| 100 % branch | all flow turns into the branch | Qb/Qc = 1 |
| 100 % line (flow-through) | all flow goes straight through | Qb/Qc = 0 |
| 100 % mix | the combining case | one figure only |

So it gives K at the **two endpoints** of the flow ratio and nothing between.
**It cannot supply the branch curve.** `TEE-LOSSES-RESEARCH-B.md` §3.4 — "maps
branch loss coefficients against the flow ratio... gives precise curves" — is
**wrong**, and the main research document and this codebase's own provenance
note are right. Rennels Ch 16 remains the route.

### But it is not useless: it is the ACCEPTANCE TEST

Measured endpoints are exactly what a fitted curve should be checked against.
Any Rennels branch curve must approach the "100 % branch" value as Qb/Qc → 1 and
the "100 % line" value as Qb/Qc → 0. That is a validation we did not have.

ASHRAE Research columns (Rahmeyer 1999b/2002b; Ding et al. 2005), at 2.4 m/s
except the 50 mm which is at 1.2 m/s:

| tee | 100 % branch | 100 % line | 100 % mix |
|---|---|---|---|
| 50 mm thread | 0.93 | 0.19 | 1.19 |
| 100 mm weld | 0.57 | 0.06 | 0.49 |
| 150 mm weld | 0.56 | 0.12 | 0.88 |
| 200 mm weld | 0.53 | 0.08 | 0.70 |
| 250 mm weld | 0.52 | 0.06 | 0.77 |
| 300 mm weld | 0.63 | 0.091 | 0.72 |
| 400 mm weld | 0.55 | 0.028 | 0.74 |

### AND IT FOUND SOMETHING ELSE — the engine's K values are the OLD column

Table 7 carries a "Past" column, attributed to Crane (1988), Freeman (1941) and
the Hydraulic Institute (1990), with parenthesised values marked as published in
the **1993** ASHRAE Handbook. At 50 mm thread that column reads **branch 1.4**
and **line 0.90**.

`data/ktable.js` THREADED holds **TBRANCH = 1.4 at 2 in** and **TRUN = 0.90
flat**. Those are the same numbers. **The engine is using the 1993 values, and
the same table's own newer measurements are far lower:**

| 50 mm thread tee | engine today (= "Past") | ASHRAE Research | change |
|---|---|---|---|
| branch | 1.4 | 0.93 | **−34 %** |
| line (run) | 0.90 | 0.19 | **−79 %** |

**This corroborates §5 with measurement rather than deduction.** "100 % line" IS
the Qb/Qc → 0 case — the header with a small take-off, the commonest case in a
real model — and ASHRAE measures 0.19 where the engine charges 0.90. The run is
over-charged by roughly a factor of five at that end, which is a much larger
conservative bias than §5 estimated.

**It is not a drop-in replacement**, for three reasons:

1. The Research columns are **velocity-dependent** (1.2 / 2.4 / 3.6 m/s) and
   sparse — most cells are blank.
2. Table 7 covers **thread at 50 mm only** and **weld from 100 mm up**. The
   engine has *threaded* and *flanged* sets and no welded set at all.
3. Changing them re-baselines every Darcy answer, the same class of event as
   §6A's Hazen-Williams warning.

**Recorded as a decision for Michael, separate from TEE.1:** should the K table
move from the 1993 values to the ASHRAE Research values where they exist? It is
an accuracy question with measured data behind it, and it is independent of the
flow-ratio work.

---

## 7. Open sub-questions

* Which source for the branch curve? ASHRAE Ch 22 Table 7 is the consistent
  choice; Idelchik is the better data. Michael leans ASHRAE for consistency.
* Does the branch curve need the area ratio Ab/Ac as well, or is Ab/Ac = 1
  acceptable given the app cannot know a tee's reduction ratio from geometry?
  (Note `data/fittings.js` already declines to carry Carrier's *reduced*
  straight-through columns for exactly this reason.)
* Should the run be revisited afterwards, or left flat permanently? Leaving it
  flat is a standing conservative bias, not a temporary state.

---

## 8. Documentation that must move with the code

* `docs/engine.html` §10 carries the limitation. Michael, 2026-08-26: *"document
  it properly in the Engine page."* When the middle path is built, §10 must say
  what is now flow-dependent, what is still flat, and which way the residual
  error points.
* `Human-Test.md` EQ.3 and `WORKLIST.md` TEE.1 both point here.
