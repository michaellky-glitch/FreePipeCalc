# Calculation engine — derivation and implementation notes

This documents the maths behind `src/solver.js` so the numbers in the
calculation sheet can be checked by hand or by another engineer.

---

## 1. Why classic `<script>` tags and not ES modules

The spec requires the app to run from disk (`file://`) with zero network
access. Browsers apply CORS to ES module loading, and `file://` origins are
treated as opaque — so `<script type="module">` fails outright when the folder
is opened by double-clicking `index.html`. There is no workaround that keeps
the "no build step" requirement.

Consequently every source file is a classic script that attaches to a single
global namespace `FD`, wrapped in an IIFE. Load order is fixed in
`index.html`; `test/harness.js` reproduces that order under Node.

---

## 2. Friction loss — Hazen-Williams (ASHRAE form, SI)

    hf = 10.67 · L_eff · Q^1.852 / (C^1.852 · d^4.8704)      [m of water]

Implemented as a pure power law `hf = r·|Q|^(n−1)·Q` with

    r = 10.67 · L_eff / (C^1.852 · d^4.8704)        n = 1.852

* `L_eff` = drawn length + Σ fitting equivalent lengths [m]
* `d` = inner diameter [m], `Q` = flow [m³/s], `C` = roughness coefficient
* `ΔP = ρ·g·hf` with ρ = 998 kg/m³, g = 9.81 m/s²

Writing it signed in `Q` (rather than `|Q|^n`) makes the loss an odd function,
which is what lets the solver handle flow reversal in loops without special
cases.

**Worked check** — 100 m of DN50 Schedule 40 (52.48 mm bore), C = 120, 5 L/s:

    r  = 10.67 × 100 / (120^1.852 × 0.05248^4.8704) = 258 025.6
    hf = 258 025.6 × 0.005^1.852                    = 14.130 m
    ΔP = 998 × 9.81 × 14.130                        = 138.3 kPa
    V  = 0.005 / (π × 0.05248² / 4)                 = 2.312 m/s

This case is asserted in `test/engine.test.js`.

### Zero-flow linearisation

At `Q = 0` the derivative `dhf/dQ = n·r·|Q|^(n−1)` vanishes (n < 2), so the
Newton step `1/(dh/dQ)` is singular. Below `Q_MIN = 1e-6 m³/s` the loss curve is
replaced by its tangent at `Q_MIN` through the origin. This keeps the loss
continuous, odd and monotonic while bounding the derivative.

---

## 3. Network solver — Global Gradient Algorithm

Todini–Pilati, the method EPANET uses. Unknowns are head `H` at each junction
and flow `Q` in each link. Link flow is positive from `from` to `to`.

`H` is **total head** (elevation + pressure head), so static lift is handled
implicitly; gauge pressure at a node is `ρ·g·(H − z)`.

### Linearising a link

For a link from `s` to `e` carrying `Q`, with loss function `h(Q)`:

    dh   = dh/dQ                    (always > 0)
    p    = 1 / dh
    y    = p · h(Q)

Newton's step asks that the *next* flow satisfy `h(Q') = H_s − H_e`:

    h(Q) + dh·(Q' − Q) = H_s − H_e
    ⟹  Q' = p·(H_s − H_e) + Q − y
    ⟹  Q' = p·H_s − p·H_e − c        where  c = y − Q

### Assembling the nodal equations

Continuity at junction `i` (net inflow = demand `D_i`):

    Σ(links ending at i) Q'  −  Σ(links starting at i) Q'  =  D_i

Substituting `Q'` and collecting terms gives, for every unknown-head node `i`:

    H_i · Σp  −  Σ p·H_other  =  Σ(±c)  −  D_i

where the sign of `c` is **+** for links starting at `i` and **−** for links
ending at `i`. Links to a fixed-head node move `p·H_fixed` to the right-hand
side. This is a symmetric positive-definite system `A·H = F`, solved by dense
Gaussian elimination with partial pivoting (networks here are at most a few
hundred junctions, so O(n³) is irrelevant next to shipping a sparse library).

Flows are then updated with `Q' = p·(H_s − H_e) − c` and the process repeats.

### Link types

| Kind | Loss `h(Q)` | `dh/dQ` |
|---|---|---|
| `pipe` | `r·|Q|^(n−1)·Q`, Hazen-Williams | `n·r·|Q|^(n−1)`, floored at `Q_MIN` |
| `equip` | `R·|Q|·Q`, `R = ΔP_rated/(ρg·Q_rated²)` | `2R·|Q|` |
| `pump` | `−H₀` (fixed head; curve is v2) | floored at 1.0 |

A fixed-head pump has `dh/dQ = 0` and is therefore singular. Flooring the
derivative at 1.0 m/(m³/s) makes it a very stiff — but finite — head-difference
constraint. At 5 L/s the resulting droop is 0.005 m, five times below the 1 mm
head tolerance, while keeping the matrix condition number reasonable. When pump
curves arrive in v2, `H = H₀ − a·Q²` gives a real derivative `2aQ` and this
regularisation falls away.

### Convergence

Three criteria, all of which must hold:

1. max head change < 1 mm
2. max nodal imbalance < 0.01 L/s
3. flow change settled — `max|ΔQ| < 1e-8 m³/s`, or < 1e-4 of the largest flow

**Criterion 3 is not in the spec but is required for correctness.** A flow
circulating around a closed loop satisfies continuity *exactly* at every node
and perturbs *no* head, so criteria 1 and 2 both pass while the loop flow is
still pure residue from the initial guess. Without it, a no-demand ring reports
a phantom circulation equal to the seed flow decayed by a single iteration.

Loop residue decays geometrically by `(1 − 1/n) ≈ 0.46` per iteration, so the
tight absolute floor costs only a handful of extra iterations on a degenerate
ring and nothing at all on a real network (the 3×3 test grid still converges in
4). Flows below `Q_MIN` are snapped to exactly zero afterwards, which is what
makes the "grey = no flow" pipe colouring stable.

Iteration is capped at 100; on failure the offending nodes are reported.

### Degenerate topologies

Connected components are found by union-find before iterating:

* component **with** a fixed head → solved normally
* component **without** a fixed head, carrying demand → `ISLAND_NO_SOURCE`
  error naming the nodes; the rest of the network still solves
* component without a fixed head and without demand → `Q = 0`, `H = z`; valid

This is what keeps a half-drawn network solving instead of throwing a singular
matrix at the user mid-edit.

---

## 3A. Darcy-Weisbach (experimental)

    hf = f · (L/d) · V²/2g  =  8·f·L·Q² / (π²·g·d⁵)

so `n = 2` and `r = 8·f·L/(π²·g·d⁵)`.

The complication is that `f` depends on Reynolds number and therefore on `Q`,
so `r` is not a constant the way it is for Hazen-Williams. It is refreshed
between solver passes from the previous pass's flow, reusing the same outer
loop that settles tee run/branch assignment and check-valve seating. Within a
single Newton iteration `f` is held fixed, which is standard practice and
converges without trouble.

### Friction factor — NOT YET DECIDED

Four correlations are implemented and selectable on the HYDRAULIC tab:

| Correlation | Form | Notes |
|---|---|---|
| Colebrook-White | implicit | The reference the others approximate; solved by fixed-point iteration seeded from Swamee-Jain |
| Swamee-Jain | explicit | ~1% of Colebrook over 5e3 < Re < 1e8 |
| Haaland | explicit | ~2% of Colebrook, simplest form |
| Churchill | explicit | Single expression covering laminar, transitional and turbulent |

Measured spread across realistic building-services cases (DN25–DN200, steel
and PPR, new and heavily fouled) is **at most 1.4%** — the choice barely moves
the answer. Laminar flow uses `f = 64/Re`; the transitional band 2300 < Re <
4000 is linearly blended between laminar and turbulent so the solver sees a
continuous curve rather than a step it cannot converge across. Churchill spans
all regimes natively and is left to handle itself.

**The method choice matters far more than the correlation choice.** Against
Hazen-Williams at C = 120, Darcy with ε = 0.045 mm (new commercial steel) runs
16–27% lower on friction rate. That is not an error in either method: C = 120
represents somewhat aged steel while ε = 0.045 mm is clean new pipe. Matching
the two requires either ε ≈ 0.15–0.25 mm or C ≈ 130–140. Any comparison between
the methods has to fix that equivalence first.

## 4. Fittings

Auto-detected from geometry (spec §3.3); the user never places a fitting.
Equivalent length is generated on an L/D basis against the **inner** diameter:

| Fitting | L/D |
|---|---|
| 90° elbow | 30 |
| 45° elbow | 16 |
| Tee, straight through (run) | 20 |
| Tee, branch | 60 |

This basis is **flat with size** — `EL = (L/D) × d`, nothing more. The real
ASHRAE tables do vary with size (small bores run a higher L/D), and a
correction curve was trialled, but it could not be sourced and an invented one
is not defensible to a checking engineer. See spec Q12.1.

All four L/D values are **user-editable** on the HYDRAULIC tab — jurisdictions
and in-house standards differ, so the built-ins are a starting point, not a
fixed authority.

Fitting EL is charged to the **downstream** pipe.

### Resistance coefficients K (for Darcy-Weisbach)

Darcy charges fittings as velocity heads instead: `h = K · V²/2g`.

Source: ASHRAE Handbook — Fundamentals, Pipe Sizing chapter, Table 1 (threaded)
and Table 2 (flanged/welded), transcribed from two independent copies of the
chapter and cross-checked. K is size-dependent, so each fitting carries a curve
against nominal size and is interpolated, clamped rather than extrapolated
outside the tabulated range.

Two cells did not survive cross-checking cleanly and are flagged in
`data/ktable.js`:

* **Threaded 45° elbow** — both copies returned a column identical to the 90°
  elbow, which is physically wrong. Shipped as `0.53 × the 90° value` (the
  Crane TP-410 L/D ratio, 16 D vs 30 D) and marked `derived` in the UI.
* **Threaded 2 in tee-branch** — copies disagreed, 1.4 vs 1.6. 1.4 is used
  because it keeps the column monotonic across the size range.

**The K lookup is keyed on NOMINAL size, not bore.** These are two different
numbers and confusing them is a real hazard: HDPE "110 mm" is an outside
diameter with a 90 mm bore, so keying on bore lands two rows off in the table.
`FD.schedules.nominalMm()` extracts the designation; the bore is used only for
velocity.

ASHRAE notes threaded 90° elbows vary ±20% above 2 in and ±40% below 2 in with
fitting pattern, so all of this is indicative. Every K is overridable.

## 4A. Flow regime

Reynolds number `Re = V·d/ν` is computed per section after the solve settles.

* `Re < 2300` — laminar. **Hazen-Williams does not apply**: it is an empirical
  correlation fitted to turbulent water flow, so in laminar flow it is the
  wrong equation, not merely an imprecise one. Warned, with a pointer to Darcy.
* `2300 ≤ Re < 4000` — transitional. Warned as inherently uncertain.
* `Re ≥ 4000` — turbulent, no warning.

Typically laminar sections show up on oversized pipe at low demand, or on a
branch that is nearly shut. The check is switchable on the HYDRAULIC tab.

## 4B. Fluid properties

Density, kinematic viscosity and temperature are model settings, defaulting to
water at 20 °C.

* **Density** — live. Head is in metres *of the working fluid*, so every
  head→pressure conversion uses it. Use `FD.units.headToPaWith(h, rho)`, never
  the bare `headToPa`, for anything that reports a result: the bare form
  assumes 998 kg/m³ and will silently report water numbers for another fluid.
* **Kinematic viscosity** — live for the laminar check under Hazen-Williams,
  and fully live under Darcy where it sets Reynolds number.
* **Temperature** — stored and displayed but **not implemented**. It does not
  drive density or viscosity; those are entered independently.

### Tee run/branch assignment

Which legs of a tee get "run" versus "branch" equivalent length depends on the
direction of flow, which is only known *after* solving. The engine therefore:

1. solves with a geometric guess (the straightest leg pair = run),
2. reassigns run/branch from the solved flow directions,
3. re-solves.

This converges in one or two passes; if the assignment oscillates the last
solution is kept and a warning is raised.

---

## 5. Conventions in reported results

* All reported pressures are **gauge pressure at the node**, `ρ·g·(H − z)`.
* **Velocity pressure is neglected** — appropriate for plumbing and hydronic
  work, and the reason the sheet carries a note discouraging fire-protection use.
* **PD/m** is computed on the *actual* drawn length excluding fitting
  equivalent length — this is the figure compared against the ~400 Pa/m rule.
  **Section PD** is the total including fittings.
