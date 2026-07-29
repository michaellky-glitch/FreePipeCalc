# DESIGN and SIMULATION modes — design

Agreed plan, not yet built.

**The problem.** Until now the pump has been auto-sized: you state the flows you
need and the app works out the duty. The real workflow is the other way round —
the engineer picks a pump, and then wants to see what the system actually does
with it. Where does flow really go? Which branches run hot? Where does a
balancing valve have to go?

---

## 1. What the prototype settled

Before designing anything, a pump curve was patched into the existing solver in
memory and tested against cases with an analytic answer.

| Case | Solver Q | Analytic Q | Error | Iterations | Time |
|---|---|---|---|---|---|
| Hd=30 m, Qd=20 L/s, r=20000, lift 10 m | 25.8199 | 25.8199 | 9e-16 | 12 | 0.62 ms |
| …r=60000 | 18.7867 | 18.7867 | 1e-11 | 11 | 0.08 ms |
| Hd=45 m, Qd=50 L/s, lift 25 m | 59.1608 | 59.1608 | 1e-13 | 13 | 0.08 ms |

Three conclusions, all of which reduce the work:

**There is no separate system-curve calculation to write.** The Global Gradient
Algorithm already solves the pump and the network simultaneously; the operating
point *is* its solution. Writing a system curve and intersecting it would be
re-deriving, by hand and less generally, something the solver does implicitly.
It also would not survive contact with reality: with several pumps, rings and
loops there is no single scalar system curve to intersect.

**Equipment pressure drop needs no new work.** It is already `r·Q²` in the
matrix. `Q = K·√ΔP` is the same relation rearranged, not a different model.

**Compute is a non-issue.** Iterations rise from ~4 to ~12 because the pump is
now a curve rather than a constant, and a solve stays under a millisecond.

The suspicion that commercial software iterates in the background is right. It
is Newton-Raphson over the whole network, and this app has been running it since
the first version.

## 2. The real problem is semantic

If terminals keep a fixed flow, a pump curve changes nothing — the flow is
already pinned and the curve only alters what pressure comes out the far end.

For the curve to determine flow, **every terminal has to become a resistance**.
That is the whole content of the mode split, and why it is a genuine split
rather than a checkbox.

| | DESIGN | SIMULATION |
|---|---|---|
| Terminal | required flow (an **input**) | resistance (derived) |
| Terminal flow | as stated | **output** |
| Pump | duty calculated (an **output**) | curve (an **input**) |
| Question answered | "what pump do I need?" | "what will this pump do?" |

## 3. Decisions

### 3.1 Two modes, with the calculated side locked

A DESIGN / SIMULATION switch on the PIPING NETWORK ribbon, beside the
open/closed indicator, because it changes what every number on screen means.

**Whichever side is calculated is greyed and locked.** In DESIGN the pump head
field is an output and cannot be typed into; in SIMULATION the terminal flow
field is an output and cannot be typed into. A field that looks editable but is
about to be overwritten by the solver is a trap, and the user should be able to
tell inputs from outputs at a glance without remembering which mode they are in.

### 3.2 DEMAND becomes OUTFLOW

"Demand" carries the meaning *required flow*, which is only true in DESIGN. In
SIMULATION the same node takes whatever the system gives it. **Outflow** is
neutral — it describes what the node does, not what it insists on.

Rename scope: the toolbar button, the `D` node code, the property panel, the
calculation sheet's *Demands* table, every warning message that mentions
demand, `docs/` throughout. The internal `device.kind === 'demand'` may stay for
file compatibility — a `formatVersion` bump is not worth it for a word — but the
UI says OUTFLOW everywhere.

### 3.3 Terminal characteristic derived from the design point

A terminal designed for `Q_d` at `ΔP_d` already has a characteristic:

```
K = Q_d / √ΔP_d          →       Q = K·√ΔP
```

which as a solver resistance is `r = ΔP_d / (ρ·g·Q_d²)`, i.e. exactly the form
equipment already uses.

So nothing extra is entered. DESIGN establishes the characteristic; SIMULATION
uses it. A terminal with no required pressure has no characteristic and must be
flagged rather than guessed at — see §6.

### 3.4 Pump curves

**Default: the EPANET single-point assumption**, from the design duty:

```
H = (4/3)·H_d − (1/3)·H_d·(Q/Q_d)²
```

giving shutoff at 133% of design head and maximum flow at 200% of design flow.
Verified: at `Q = Q_d` it returns `H_d` exactly, at `Q = 0` it returns
`(4/3)H_d`, and `H = 0` at `Q = 2Q_d`.

Internally that is `H = H₀ − a·Q²` with `H₀ = (4/3)H_d` and
`a = (1/3)·H_d/Q_d²`.

**Pasted data**: Q,H pairs, tab/comma/space separated, header row skipped — the
same parser approach as custom pipe schedules, and the same insistence on stated
units.

**Fitting**: least squares to `H = H₀ − a·Q^b` over all pasted points, with the
**fit quality shown**. A smooth curve keeps the Newton solve fast and stable;
piecewise-linear interpolation would honour the points exactly but its
derivative jumps at every knot. Showing the residual means a bad fit is visible
rather than silently wrong — if a manufacturer curve does not fit the form, the
engineer should know that rather than discover it in the answers.

**Display**: the curve table runs 0–150% of design flow in 10% steps, sixteen
rows. That is what gets shown and what seeds a paste.

## 4. What actually changes in the engine

Small, which is the point:

* `pump.curve = { H0, a, b }` alongside the existing `head`.
* `linkLoss` for a pump with a curve returns `−(H₀ − a·Q^b)`.
* `linkDhdq` returns `b·a·Q^(b−1)`, floored (see §6).
* In SIMULATION, outflow nodes are built as resistance links to a fixed-head
  node rather than as fixed demands.
* Auto-sizing is skipped entirely in SIMULATION — the duty is an input.

The solver itself is untouched.

## 5. What SIMULATION is for

The output that justifies the feature: **natural flow versus design flow, per
terminal.**

A terminal taking more than its design flow is stealing from the rest of the
system and is where a balancing valve goes. The required throttling follows
directly — the additional resistance that brings natural flow back to design is
computable, and can be quoted as a Kv so it can be selected against.

The engineer can then apply their own margins and rounding to flow, pressure or
both, and watch the system respond. That is the workflow the whole feature
exists to support, and it is only possible once flow is an output.

## 6. Traps to handle

**The derivative vanishes at shutoff.** `dH/dQ = −2aQ → 0` at `Q = 0`, the same
singularity that had to be regularised for fixed-head pumps. Needs a floor on
`dhdq`; the prototype already carries one.

**Operating past maximum flow.** Beyond `2·Q_d` the single-point curve goes
negative, and a real pump cannot produce negative head. Clamp and warn rather
than report a nonsense operating point.

**Terminals with no required pressure.** `K = Q_d/√ΔP_d` is undefined when
`ΔP_d = 0`, and every test model built so far has terminals at 0 kPa required.
SIMULATION must refuse to guess — flag those terminals and ask for a design
pressure, rather than inventing a characteristic.

**"Residual" changes meaning.** In DESIGN it is spare pressure at a terminal
that is getting its design flow. In SIMULATION the terminal is getting whatever
it gets, so the interesting number is the flow error, not the pressure residual.
The critical path still exists but is reported against a different quantity.

## 7. Open questions

* **Pump speed / trimming.** Real selection involves impeller trim or variable
  speed. Affinity laws would scale a curve cheaply (`H ∝ N²`, `Q ∝ N`). Worth
  adding once basic curves work; not in the first pass.
* **Parallel pumps on one curve.** Two identical pumps in parallel is the common
  data-centre case, and it works naturally — each is its own link with its own
  curve. Worth a test, not a design decision.
* **Does DESIGN keep auto-sizing at all?** If SIMULATION is where the real work
  happens, DESIGN's job may reduce to establishing terminal characteristics and
  a first-pass duty. Likely to become clearer with use.
