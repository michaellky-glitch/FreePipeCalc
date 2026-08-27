# Branch `tee-fittings` — WORK IN PROGRESS, DO NOT MERGE YET

**Purpose:** TEE.1. Move fitting losses onto an additive `m·Q²` term and then
make the tee BRANCH coefficient a function of the flow ratio Qb/Qc.

**Why a branch** (Michael, 2026-08-28, option A): the change re-baselines every
Hazen-Williams answer, so master must stay shippable and the work must be
revertible in one step.

---

## Read these first

* `docs_internal/TEE-LOSSES.md` — the decision, both fitting tables, the measured
  exposure, and **§6A** (what the research changed) and **§6B** (ASHRAE Ch 22
  Table 7, checked).
* `docs_internal/TEE-LOSSES-RESEARCH.md` — the substantial research pass.
* `docs_internal/TEE-LOSSES-RESEARCH-B.md` — shorter. **Its §3.4 is WRONG about
  ASHRAE Ch 22.** See `TEE-LOSSES.md` §6B.

## Two things about this branch

1. **It does NOT deploy.** `pages.yml` is master-only, so nothing here reaches
   GitHub Pages. Michael cannot test it the way he normally does. Verify on
   loopback and report numbers, or hand him a build another way.
2. **`FD.VERSION` is `0.18.22-tee`** and the `?v=` tokens match it, deliberately,
   so a stale tab cannot be mistaken for a master build. A `?v=` token is spent
   once — see `HANDOVER.md` §4 — and `index.html` needs `?nc=<n>` to re-fetch.

CI: `tests.yml` (added to master) runs the suites on every push here. It is the
only automated check this branch gets.

---

## The build order — STAGED DELIBERATELY

Do not collapse steps 1 and 2. Step 1 is a **re-baselining** change and step 2 is
a **physics** change; running them together means that when the numbers move,
nobody can say which one moved them.

### FINDINGS BEFORE ANY CODE — 2026-08-28

**1. THE SOLVER ALREADY DOES THE ADDITIVE FORM. Step 1 is far smaller than the
plan below assumed.** `solver.js linkDhdq` already reads:

```js
var d = FD.hydraulics.dhdq(link.r, q, link.n);
if (link.rK) d += FD.hydraulics.dhdq(link.rK, q, 2);
```

That IS the EPANET form `r·Q^n + m·Q²`, derivative and all. And
`hydraulics.fittingR` carries a comment saying a K term "cannot be folded into a
Hazen-Williams pipe resistance (exponent 1.852) and has to ride alongside it as
a separate term". **No solver change is needed.** The only edit is the HW branch
of `network.js build()` populating `link.rK` instead of folding `el` into
`link.r`.

**2. AND THAT EDIT IS BLOCKED ON A DECISION ONLY MICHAEL CAN TAKE.**
`fittingR(sumK, d)` takes **ΣK**. Hazen-Williams' fitting data is equivalent
**LENGTH** (Carrier feet). Converting length to K needs `K = f·(L/D)` — a
FRICTION FACTOR — and **Hazen-Williams does not have one**. That is the defining
property of the method.

Worse, `hydraulics.js` records this as already decided:

> *"Hazen-Williams charges equivalent length, Darcy-Weisbach charges K velocity
> heads, and the fitting basis follows the method instead of being a third thing
> to pick."* — collapsed to two **at Michael's instruction**.

So migrating HW onto K reverses an explicit decision of his. **Do not do it
silently.**

#### The fork

| | What it means | Cost |
|---|---|---|
| **A — migrate HW to the additive K form** | Convert equivalent length to K by matching the loss at a reference flow: `m = r_HW(el) / Q_ref^0.148`. The 0.148 exponent is weak, so a 2x error in `Q_ref` moves `m` by only ~11 % — robust. | Reverses his "fitting basis follows the method" decision, and re-baselines **every** HW answer. |
| **B — leave HW on equivalent length** | His decision stands, no re-baseline. | The flow-ratio branch coefficient must be expressed **twice** — once as a variable L/D, once as a variable K. The "one job or two" problem from §3.3 returns. |
| **C — do the flow-ratio work on the DARCY path only** | Darcy already has the correct exponent, the K basis, the separate `rK` term, and it is the basis Rennels Ch 16 supplies natively. HW stays the simple, conservative, legacy-compatible option. | The accuracy gain applies only when Darcy is selected. No re-baseline, no double implementation, no reversed decision. |

**C looks like the natural fit** and was not considered before today: it needs no
conversion, no re-baseline and no second implementation, and TEE.2 is a Darcy
change already. Its cost is that Hazen-Williams — still the default — keeps both
the flat tee coefficient and the wrong fitting exponent.

**AWAITING MICHAEL. No engine code has been written on this branch.**

---

### Step 1 — the architecture, with today's coefficients

*(Written before the findings above. Read them first — the solver work described
here is already done, and the HW migration is option A of the fork.)*

Move Hazen-Williams fittings out of the pipe length and onto a separate additive
term, the EPANET form that Darcy already half-uses:

```
H_i - H_j  =  r · Q^n  +  m · Q²
```

* Keep every existing coefficient exactly as it is. Change nothing else.
* Add `2·m·Q` to `linkDhdq`.
* Darcy already carries `link.rK` — bring HW onto the same layer rather than
  inventing a second one.

**Then STOP and measure.** Produce a before/after on every frozen fixture:
`datahall-yard`, `tower-five-level`, `highrise-variable-primary`,
`Tutorial 01`, plus the GGA worked example. Report the shift in pump head and
index selection. **This needs Michael's explicit acceptance before step 2** — a
previously issued sheet will not reproduce.

Expect a real shift: HW currently charges fittings at Q^1.852 and this puts them
at Q², which is the correct exponent for a velocity head. It cancels at the
design point and grows away from it.

### Step 2 — the physics

* Branch coefficient `m` becomes a function of Qb/Qc, from **Rennels & Hudson
  Ch 16**. Keep the run flat (Michael's middle path, 2026-08-26).
* Compute at the **combined-leg velocity** — `dH = Kc·Vc²/2g`. Do NOT convert
  into each leg's frame; that is what killed the 1.5× attempt.
* **Freeze `m` for the whole of a pass, re-derive between passes**, exactly as
  the tee TYPE already is. `HANDOVER.md` §18, the frozen-active-set remedy.
* Acceptance test, from `TEE-LOSSES.md` §6B: the fitted curve must approach the
  measured ASHRAE "100 % branch" value as Qb/Qc → 1 and "100 % line" as → 0.

### Known risks

* Rennels' **combining**-tee form is the less exact of the two, and a combining
  tee is the case this engine charges most (two inlets).
* Deltares WANDA reports the coefficient's **sign change at zero flow** as a
  solver discontinuity. Freezing per pass controls it for design; record it in
  `engine.html` §10 before any simulation work leans on it.

### Not part of this branch

**TEE.2** — swapping the Darcy K table from the 1993 values to ASHRAE's measured
ones. Smaller, independent, data-only. Do it separately so its before/after is
not tangled with this.
