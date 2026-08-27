# Tee losses — the largest known approximation in the engine

**Status: DECIDED, NOT BUILT.** Michael chose the middle path on 2026-08-26.
This file exists because he expects to come back to it: *"I'll probably come
back to this issue in future. Is it fully logged?"*

Carried in `Human-Test.md` as open engineering question **EQ.3** and in
`WORKLIST.md` as **TEE.1**.

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
