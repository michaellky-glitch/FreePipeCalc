# Tee losses — industry methods and how to apply them

**Status: RESEARCH, NOT BUILT.** This document supports the decision in
`TEE-LOSSES.md`. It records how other standards and software calculate tee
losses. It shows how these methods solve the two problems in `TEE-LOSSES.md`
section 3.

Cross-references: `TEE-LOSSES.md`, `Human-Test.md` EQ.3, `WORKLIST.md` TEE.1.

**Language:** This document uses ASD-STE100 Simplified Technical English. One
term has one meaning. Sentences are short. The voice is active.

**Terms:** This document uses *dividing* (one inlet, two outlets) and *combining*
(two inlets, one outlet), the same as `TEE-LOSSES.md`. The data sources call
these two cases *diverging* and *converging*.

---

## 1. Summary

The research gives four results.

1. A flat loss coefficient is the normal industry method, not a poor shortcut.
   Crane TP-410 and EPANET both use a fixed value. Your middle path is more
   accurate than these two, because the branch coefficient changes with the flow
   ratio.

2. The reference-velocity problem in section 3.2 has a standard solution. All
   data sources reference the loss coefficient to the velocity in the combined
   leg. You calculate the head loss directly from that velocity. You do not
   convert the coefficient into the frame of each leg.

3. The architecture problem in section 6 has a known form. EPANET uses the same
   Global Gradient Algorithm as your engine. EPANET carries each fitting loss as
   a separate term at exponent 2. It does not put the fitting loss inside the
   pipe resistance. This form also corrects the exponent problem in section 3.3.

4. A closed-form equation is available. Rennels and Hudson give equations for
   tees as a function of the flow ratio and the area ratio. You can put these
   equations directly into code.

---

## 2. The three method groups

Industry methods for tee losses divide into three groups. The table shows each
group. It shows whether the method changes with the flow ratio.

| Group | Changes with flow ratio? | Data sources and tools |
|---|---|---|
| Fixed loss coefficient or fixed L/D | No | Crane TP-410, EPANET, most water network solvers, your engine today |
| Full table: K as a function of flow ratio and area ratio | Yes | Idelchik, Miller, ASHRAE Duct Fitting Database |
| Closed-form equation | Yes | Rennels and Hudson (Chapter 16), Gardel |

Note: Several commercial tools give the full treatment. They let the user select
the data source. These tools include AFT Fathom, FluidFlow, Deltares WANDA, and
MathWorks Simscape. Each tool also gives a "simple" or "lossless" option for
tees with small losses.

---

## 3. The two data sources

Idelchik and Miller are the two standard data sources. Most tools digitise one
of them.

Both sources give the loss coefficient as a function of three inputs:

* the flow ratio (branch flow / combined flow)
* the area ratio (branch area / combined area)
* the branch angle

Both sources reference the loss coefficient to the velocity in the combined leg.
This point controls the solution in section 5.

Both sources give negative values at a low flow ratio. A negative value is
correct physics. When two streams combine, the fast stream gives kinetic energy
to the slow stream. One leg then shows an energy gain. The other leg shows a
larger loss. The total loss across the tee stays positive.

Note: This result supports the run-flat decision in `TEE-LOSSES.md` section 5. On
a header, the true loss in the run is not only near zero. It can be negative. A
flat 20 L/D therefore over-charges the run more than section 5 states.

The ASHRAE Duct Fitting Database is the air-side equivalent. It holds
loss-coefficient tables for more than 200 fittings. The user enters the flow
rate. The database returns the loss coefficient and the pressure loss. It gives
the full flow-ratio treatment for tees and wyes. This database shows that
building-services practice expects a flow-ratio method when accuracy is
important.

---

## 4. The reference source for equations

Rennels and Hudson, Chapter 16, gives closed-form equations. This source is the
best choice for direct use in code, because it needs no table digitisation.

The equations have two properties to plan for:

* The dividing tee has a clear form. The loss is a sudden-expansion loss in the
  main pipe plus a turning loss at the branch.
* The combining tee has a less exact form. Your engine charges two inlets at a
  combining tee. The rougher fit therefore applies to the case you use most.

Note: MathWorks Simscape uses this source. Its tee block gives three options:
Rennels correlation, Crane correlation, and custom. This block is a good model
for your middle path: a Rennels branch curve with a flat or Crane run.

---

## 5. Solution to the reference-velocity problem (section 3.2)

The standard convention removes the reference-velocity problem. Do not convert
the loss coefficient into the frame of each leg. Calculate the head loss directly
from the velocity in the combined leg.

Use this equation:

```
dH = Kc * Vc^2 / (2 * g)
```

where:

* `Kc` = loss coefficient, referenced to the combined leg
* `Vc` = velocity in the combined leg (the leg with the total flow)
* `g`  = the acceleration from gravity

If you must express the loss in the frame of one leg, the conversion is exact:

```
Ki = Kc * (Vc / Vi)^2 = Kc * (Qc / Qi)^2 * (Ai / Ac)^2
```

This conversion depends on the flow ratio and the area ratio, as section 3.2
states. The conversion is a standard step, not a barrier. AFT Fathom does this
step: when the areas differ, it corrects the coefficient with the velocity
ratio.

Note: The previous 1.5x attempt failed because it put a combined-velocity value
into an equivalent-length slot in each leg. The fix is to stop that method. Use
the combined velocity directly.

---

## 6. Solution to the architecture problem (section 6)

EPANET gives the architecture you need. EPANET uses the same solver as your
engine. EPANET writes each link as:

```
Hi - Hj = r * Q^n + m * Q^2
```

where:

* `r` = pipe friction resistance
* `n` = friction exponent (1.852 for Hazen-Williams)
* `m` = minor loss coefficient
* `Q` = flow

The fitting loss is the separate term `m * Q^2`. It is not inside `r`. This form
gives three results at the same time.

1. It corrects the exponent problem in section 3.3. The fitting term stays at
   exponent 2, even when the friction term uses 1.852. The two are different
   terms.

2. It makes the Newton derivative simple. The derivative of `m * Q^2` is
   `2 * m * Q`. You add this value to the friction derivative in `linkDhdq`.

3. It matches your Darcy path. Your Darcy path already carries a separate
   resistance `rK`. Both friction methods can therefore share one fitting layer.

Result for TEE.1: express the flow-ratio branch coefficient one time, as `m` as a
function of the flow ratio. Carry it as the additive term `m * Q^2`. Do not carry
it as equivalent length in feet. This choice makes the fix one task, not two.

Freeze `m` for the whole of one pass. Re-derive `m` between passes, the same as
the tee TYPE today. This method follows the section 18 frozen-active-set remedy
in `HANDOVER.md`.

---

## 7. Instability warning for future simulation

Caution: The loss coefficient changes sign when the flow in a leg passes through
zero. Deltares WANDA reports that this change causes a discontinuity. The
discontinuity can make the solve unstable. This event is the flow-direction
change at the tee.

The freeze-per-pass method in section 6 controls this event for design mode.
Record the risk in `engine.html` section 10 for any future simulation work. AFT
reports a related problem: general software does not always know the flow
direction before the solve.

---

## 8. Recommendation

The research supports the middle-path decision. Three points confirm it.

1. The middle path is more accurate than the Crane and EPANET norm.
2. The run-flat bias is conservative. Section 5 understates it, because the true
   run loss can be negative.
3. The two problems in sections 3.2 and 6 are one problem. Carry each fitting as
   an additive `m * Q^2` term, based on the velocity in the combined leg. Do not
   use equivalent length.

Method to build TEE.1:

1. Select Rennels and Hudson, Chapter 16, for the branch curve. This choice
   keeps one data source and one form.
2. Keep the run flat, or use a Crane value for the run.
3. Add the branch loss as `m * Q^2`, with `m` as a function of the flow ratio.
4. Freeze `m` per pass. Re-derive `m` between passes.
5. Add `2 * m * Q` to `linkDhdq`.
6. Document the method in `engine.html` section 10.

---

## 9. Sources

* Crane. Technical Paper 410 (TP-410). *Flow of Fluids Through Valves, Fittings,
  and Pipe.* Fixed K method. Most software uses this method as the base.
* EPANET 2.2 documentation (US EPA). Minor loss form `h = r*Q^n + m*Q^2`. Global
  Gradient Algorithm.
* I.E. Idelchik. *Handbook of Hydraulic Resistance.* Tabulated K as a function of
  flow ratio, area ratio, and angle. Reference velocity is the combined leg.
* D.S. Miller. *Internal Flow Systems.* Charts of K against flow ratio and area
  ratio. Reference velocity is the combined leg.
* ASHRAE Duct Fitting Database. Air-side loss coefficients for more than 200
  fittings. Full flow-ratio treatment for tees and wyes.
* D. Rennels and H. Hudson. *Pipe Flow: A Practical and Comprehensive Guide,*
  Chapter 16 (Tees). Closed-form equations for dividing and combining tees.
* AFT Fathom documentation. Tee/Wye loss model. Idelchik and Miller data.
  Combined-leg reference. Basis-area correction with velocity ratios. Negative
  coefficients.
* Deltares WANDA documentation. T-junction and Y-junction. Idelchik formulas.
  Zero-flow discontinuity warning.
* MathWorks Simscape documentation. T-Junction block. Rennels, Crane, and custom
  loss models.
* FluidFlow documentation. Selectable Crane, Idelchik, Miller, and SAE
  relationships for junctions.
