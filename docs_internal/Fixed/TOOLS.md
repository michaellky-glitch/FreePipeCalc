# Tools

Standalone calculators that produce something you paste back into the model.

A tool deliberately does **not** reach into the network. It takes numbers in and
gives numbers out, so it can be checked against a hand calculation with no model
open at all — and so a mistake in a tool cannot quietly corrupt a model.

---

## 1. Generic Pump Curve

### The problem it replaces

Earlier versions generated a pump curve for you from the calculated duty, using
the EPANET single-point assumption: shutoff at 133% of design head, runout at
200% of design flow.

That was removed. The arithmetic was right and the feature was wrong. It is one
manufacturer-agnostic guess presented as though it were the answer, and it
cannot produce the curve shapes that are actually specified. NFPA 20, for
example, allows shutoff up to **140%** of rated head and requires at least
**65%** of rated head at **150%** of rated flow — an envelope the single-point
form cannot reach at either end.

So the tool asks for the three points that define the curve instead of inventing
them.

### Inputs

| | |
|---|---|
| **Design point** | Flow and pressure, in your display units |
| **Fit point 1** | Flow and pressure, each as a **% of the design point** |
| **Fit point 2** | Flow and pressure, each as a **% of the design point** |

Fit point 1 is normally shutoff (0% flow) and fit point 2 normally runout
(150% flow), but neither is forced — any three distinct flows work.

The **NFPA 20 fire pump** button fills in 0% / 140% and 150% / 65%.

### The method

An exact quadratic through the three points, `h(q) = a + b·q + c·q²`, by
Newton's divided differences:

```
m01 = (h1 − h0) / (q1 − q0)
m12 = (h2 − h1) / (q2 − q1)

c = (m12 − m01) / (q2 − q0)
b = m01 − c·(q0 + q1)
a = h0 − b·q0 − c·q0²
```

Same answer as a 3×3 solve, but with no matrix and no pivoting to get wrong.

This is an **interpolation, not a fit**: it passes through all three points
exactly. There is nothing to average — the three duties are stated, not
measured.

### Worked example (the one in the tests)

Rated 1000 L/s at 100 kPa, NFPA 20 envelope:

| Point | Flow (L/s) | Head (kPa) |
|---|---|---|
| Fit 1 — shutoff | 0 | 140 |
| Design | 1000 | 100 |
| Fit 2 — runout | 1500 | 65 |

```
m01 = (100 − 140)/(1000 − 0)   = −0.04
m12 = (65 − 100)/(1500 − 1000) = −0.07
c   = (−0.07 + 0.04)/1500      = −2×10⁻⁵
b   = −0.04 − (−2×10⁻⁵)(1000)  = −0.02
a   = 140

h(q) = 140 − 0.02·q − 2×10⁻⁵·q²
```

Check by hand at 50% flow: `140 − 10 − 5 = 125 kPa`.

### Sanity checks

The tool refuses or warns rather than emitting a curve that is not a pump:

* two fit points at the same flow — there is no single head there, so no curve
* head that **rises** with flow anywhere in the working range
* a concave-up curve, which most real pumps are not
* the table stops at the flow where head reaches zero, rather than tabulating
  negative head that someone could paste into the solver

### Getting the curve into the model

The solver stores a curve as `H₀ − a·Q^b`, which has **no linear term** and so
cannot hold a quadratic exactly. That makes the paste lossy, and it matters
which rows you paste. The tool offers both and says which is which:

| | Reproduces the 3 stated duties | Tracks the quadratic between them |
|---|---|---|
| **Copy the 3 defining points** *(default)* | **exactly** (~10⁻⁶ kPa) | up to ~1.3% off |
| **Copy full table** (0–150% in 10% steps) | all three shift, ~1% | r² ≈ 0.9997 |

Three parameters fitted to three points is exact, which is why the short paste
wins on the points. The full table least-squares the difference across sixteen
rows, which spreads the error evenly — and therefore moves the very points the
engineer specified.

**Paste the three points unless you have a reason to prefer the shape.** The
stated duties are the contractual ones: an NFPA envelope, or a manufacturer's
guaranteed points. The shape between them is an interpolation nobody promised.

Then: PIPING NETWORK ▸ select the pump ▸ **Paste curve data**. Columns are flow
then head, in the same units the tool displayed, so nothing needs converting.

### Known limitation

The round trip through `H₀ − a·Q^b` is the weak link, and it exists only because
the solver's curve form predates this tool. Teaching the solver to carry
`a + b·q + c·q²` directly would remove the loss entirely — the form is no harder
to differentiate (`dh/dq = b + 2c·q`) than the power law it already handles.
Not done, because it changes the stored model format.

---

## 3. Pipe velocity & friction

**Enter any two of flow, bore and velocity — the third is calculated.** There is
only one relation in it:

```
Q = v · A,   A = π·d²/4
```

so the tool is hand-checkable in a line. Which two are yours is chosen from a
dropdown rather than guessed from what you typed last: guessing means the box
you are about to correct is the one that gets overwritten as you type into it.
The derived box is read-only and says so.

### What comes out with it

| | |
|---|---|
| **Friction gradient** | Through `FD.hydraulics`, assembled exactly as `network.build` assembles a pipe — same method, same context, same C. A tool that re-derives friction is a second implementation, and the two disagree the day one of them is edited. |
| **Reynolds and regime** | Laminar / transitional / turbulent, from the model's fluid. A laminar answer says so, because Hazen-Williams is not valid there. |
| **Velocity head** | v²/2g |
| **Over 100 m** | The gradient in the pressure unit you work in |
| **Nearest size up** | Through `FD.schedules.sizeForFlow`, the schedule's own rule — so the tool cannot recommend a size the sizer would not have chosen. Always the next size **up**: rounding down puts the velocity above what you asked for. |

**Sizing falls out of it.** Give a flow and the velocity you are prepared to run
at, and the bore you get back is the bore you need.

---

## 4. Heat transfer

`Q = ṁ·Cp·ΔT` — the most-used line in building services, in the same "any two
give the third" shape, and the same relation the equipment panel keeps between
capacity, design flow and design ΔT.

Density and specific heat come from the model's fluid through
`FD.fluids.resolve`, so glycol gives a glycol answer. If that fluid is one whose
properties are **not verified against a printed table** — currently propylene
glycol — the tool says so on screen, because specific heat scales every answer
here linearly.

Reported: duty, volume flow, **mass flow**, ΔT, and the capacity rate `ρ·q·Cp`
in W/K, which is the figure the control loop works in.

---

## The window

All four tools live in a **moveable window** (v0.16.10), opened from a TOOLS
button in Design, Control and Simulate. It used to be a whole tab, and a tab
takes the drawing off the screen in order to answer a question you are asking
*about* the drawing. Position and open state are remembered in `localStorage` —
a UI preference, not model data, so a `.pnet.json` never carries someone else's
window position.
