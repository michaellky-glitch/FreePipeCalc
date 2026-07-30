# Human test log

What has actually been checked by a person, and what has not.

This is deliberately separate from the automated suites. Those cover 651
assertions of engine behaviour (all passing), but they
cannot tell you whether a button is
discoverable, whether a drawing prints legibly, or whether a result *looks*
right to someone who sizes pipes for a living. Only Michael can sign those off.

**Status key** — ✅ passed · ⚠️ passed with a note · ❌ failed · ⬜ not tested yet

Last updated: 2026-07-30 (v0.6.0-dev)

## Awaiting Michael's eye — new in v0.6.0-dev

Built and internally verified (logic node-tested, behaviour driven through the
live DOM), but **nothing below has been looked at by a person**. The preview
browser in the build environment has a 0×0 viewport, so no pixels were ever
rendered — anything about how these LOOK is unverified.

| # | What | Status | Notes |
|---|---|---|---|
| 7.1 | Riser select handle (triangle) + riser size/schedule/C | ⬜ | Click the triangle beside a riser marker. Verified: handle selects the column, panel appears, size change reaches the bore. |
| 7.2 | New riser runs to the View Direction level automatically | ⬜ | Verified both directions materialise a real vertical pipe on the first click, reusing any node already there. |
| 7.3 | "View Direction" rename, Look Up / Look Down | ⬜ | |
| 7.4 | Devices drawn as point symbols on a thin connector | ⬜ | **The one to judge.** Agreed in principle only. At high zoom a 0.7 m pump link is still 0.7 m of drawing with a fixed-size symbol on it. |
| 7.5 | Type a length while drawing + Enter | ⬜ | Verified exact: 12.5 m east, 4 m north, 10 m at 45°. Preview follows the typed number. |
| 7.6 | Multi-select → bulk size / schedule / C | ⬜ | Blank = leave alone. Verified bores follow. |
| 7.7 | VIEW replaces LAYOUT; TRACE inside VIEW; DRAW hidden in VIEW | ⬜ | |
| 7.8 | Ribbon group labels centred | ⬜ | CSS only, never seen. |
| 7.9 | PD/m pipe annotation | ⬜ | Verified to agree with the PDM warning to the rounded digit (699.7 → "700Pa/m"). |
| 7.10 | Reverse-direction button beside a selected device | ⬜ | Only on pumps/equipment/check valves, only while selected. |
| 7.11 | Warnings chip: hover preview, click to highlight | ⬜ | Verified 12 pipes + 3 nodes highlighted, all genuinely warned; toggles off. |
| 7.12 | CLOSED LOOP with an expansion tank and no outflow | ✅ | **Michael reported this.** Now reads CLOSED; all five examples classify correctly. |

---

## 1. Calculations

Nothing here has been signed off yet. The numbers reconcile internally and
against hand calculations, but no independent check against another tool or a
known project has been done.

| # | What | Status | Notes |
|---|---|---|---|
| 1.1 | 3-floor riser + ring main solves sensibly | ⚠️ | Built and reviewed; energy balance closes exactly. Not checked against another tool. |
| 1.2 | Data centre closed circuit, redundant pumps | ⚠️ | Runs; equipment gets exactly its rated flow and ΔP. Numbers not independently verified. |
| 1.11 | `...ring_main.pnet (fixed).json` redrawn example | ⚠️ | **Rebuilt by hand 2026-07-30 and now coherent** — devices are short links (pumps 0.7 m, equip 0.49 m), ~377 m of real pipe carries friction, solves cleanly as a 20 L/s circuit. Numbers not yet independently verified against another tool. |
| 1.3 | Hazen-Williams against a manual calculation | ⬜ | `docs/ENGINE.md` has worked examples set up for exactly this. |
| 1.4 | Fitting equivalent lengths vs. a published table | ⬜ | Flat L/D per spec §3.3. Worth a spot check against ASHRAE. |
| 1.9 | Hazen-Williams, straight pipe | ✅ | **Michael validated this.** Mostly correct. |
| 1.10 | Hazen-Williams, converging/diverging tees | ❌ | **Michael found this wrong.** Two causes, both confirmed in code — see `ENGINE.md`. Blocked on choosing a coefficient source. |
| 1.5 | Loop flow split against hand calculation | ⬜ | Rings balance to ~1e-16 internally; not checked externally. |
| 1.6 | Pump duty vs. a real selection | ⬜ | |
| 1.7 | Darcy-Weisbach | ❌ | **Blocked** — friction-factor correlation not chosen yet. Do not issue calculations from this method. |
| 1.8 | Critical path is the genuinely worst circuit | ⬜ | Picks the smallest-residual terminal. Worth checking against judgement on a real job. |

## 2. Drawing

| # | What | Status | Notes |
|---|---|---|---|
| 2.1 | Draw a multi-vertex run | ✅ | |
| 2.2 | 15° angle snapping | ✅ | |
| 2.3 | Tee insertion by clicking an existing pipe | ✅ | |
| 2.4 | Snap priority node > pipe > grid | ⬜ | Rewritten so the grid constrains length along the ray. Needs a human eye. |
| 2.5 | Riser placement and cross-level connection | ⚠️ | Michael reported it was still being checked. Alignment logic reworked since. |
| 2.6 | Levels: add, remove, reorder by drag, `[E]` editor | ⬜ | |
| 2.7 | Copy level layout `[C]` | ⬜ | New. Copies everything including sources. |
| 2.8 | Geometry conflict → Cancel / Delete / Repair | ⬜ | Repair is a heuristic; the change log is the thing to check. |
| 2.9 | Undo / redo across all of the above | ⬜ | |

## 3. Devices

| # | What | Status | Notes |
|---|---|---|---|
| 3.1 | Source, demand placement | ✅ | |
| 3.2 | Pump insert, auto / fixed / off | ⚠️ | Auto-sizing reworked twice. Re-check duty figures. |
| 3.6 | Pump curve: from duty, paste, table | ⬜ | **New.** Driven in-browser during the redundancy battery; not used by hand. |
| 3.3 | Valve insert, gate/check, 0–100% | ⬜ | |
| 3.4 | Equipment insert, rated flow and ΔP | ⬜ | |
| 3.5 | Equipment tags on drawing and sheet | ⬜ | |

## 4. Interface

| # | What | Status | Notes |
|---|---|---|---|
| 4.1 | Toolbar grouping and mode hints | ⬜ | Reorganised in v0.4.0. |
| 4.2 | VIEW: drag labels | ⬜ | |
| 4.3 | VIEW: "Show on drawing" checkboxes | ❌ | **Michael could not find these.** They appear only in VIEW mode, in the properties panel, under a *Show on drawing* heading, after selecting a DEVICE or a source/outflow node — a plain pipe has none at all, which is likely why they seemed absent. If they are still not findable, the placement is wrong — treat this as a UI defect, not user error. |
| 4.4 | Vertical pipe label drag box | ⚠️ | Was a horizontal box on a vertical pipe (Michael's screenshot). Fixed; needs confirming. |
| 4.5 | Open/closed loop indicator on the ribbon | ⬜ | **New.** Should read OPEN LOOP when an outflow draws water off, CLOSED LOOP for a sealed pumped circuit (even with an expansion tank), NO SUPPLY with neither — and change as you draw. |
| 4.6 | HYDRAULIC tab: editable coefficients inside the formula | ⬜ | |
| 4.7 | Custom pipe schedule: paste from a spreadsheet | ⬜ | **New.** Three columns, all in mm. |
| 4.8 | UI font / label size / arrow size | ⬜ | |
| 4.9 | Dark and light themes | ⬜ | Light theme has had very little use. |
| 4.10 | DOCUMENTATION tab | ⬜ | **New.** Will not render over `file://` — see the note it shows. |

## 4A. TRACE mode

New in v0.5.0. Internally tested (paste, render, calibration, drag, scale, lock,
grid suppression, save/load and the autosave fallback all verified in-browser),
but nothing here has been used against a real drawing yet.

| # | What | Status | Notes |
|---|---|---|---|
| 4A.1 | Ctrl+V a real screen snip from a PDF | ⬜ | Synthetic images only so far. |
| 4A.2 | Drag-and-drop an image file | ⬜ | |
| 4A.3 | Paste works from `file://` | ⬜ | **Most important item here.** The paste event should not be blocked from disk, but it has only been proven over HTTP. |
| 4A.4 | Two-point scale calibration on a real drawing | ⬜ | Verified numerically; needs a drawing with a known dimension. |
| 4A.5 | Legibility over a white PDF background | ⬜ | Invert + 0.6 opacity is the default on the dark theme. Judgement call. |
| 4A.6 | Trace, then check lengths against the real drawing | ⬜ | The whole point of workflow 1. |
| 4A.7 | Multi-level: a different drawing per floor | ⬜ | |
| 4A.8 | Model file size with 3+ traces | ⬜ | ~50 KB each in testing. |

## 4B. DESIGN / SIMULATION modes

New in v0.5.0. The redundancy battery below was run in Node and reproduced
in-browser; the numbers were checked against hand calculations of the parallel
pump curves, not read back out of the code.

**Battery: `datacentre-ring`, pump selected at +10% on both flow and head.**

| Step | Result | Sensible? |
|---|---|---|
| 1 pump, curve at 22.0 L/s @ 285.6 kPa | 21.25 L/s @ 292.1 kPa; CRAH-01 takes 21.24 L/s (106% of design) | Yes — an oversized pump rides out along its curve until the system absorbs it |
| 4 pumps, each 5.5 L/s @ 285.6 kPa | 21.66 L/s total, 5.40–5.43 L/s each @ ~288.5 kPa | Yes — matches `H₀ − a(Q/4)²` by hand to 0.1%; identical pumps share within 0.6% |
| 1 of 4 fails | 19.82 L/s total, 6.60 L/s each @ 243.5 kPa, survivors at 120% of design | Yes — losing 25% of the pumps loses only 8.5% of the flow, and the survivors ride out |

The last row is the point of the feature: flow barely moves, but each surviving
pump is pushed to 120% of its selection, which is where motor loading and NPSH
need checking. That now raises a `PUMP_RUNOUT` warning against an editable
threshold (`settings.warn.pumpRunout`, default 120%).

| # | What | Status | Notes |
|---|---|---|---|
| 4B.1 | DESIGN/SIMULATION chip toggles and locks the calculated side | ⚠️ | Verified in-browser: pump head and outflow flow both disable with a tooltip. Needs a human eye on discoverability. |
| 4B.2 | Zero-pressure outflow is refused | ✅ | Both on the field and on entering SIMULATION. |
| 4B.3 | Parallel pumps and N+1 failure | ⚠️ | Battery above. Not checked against another tool. |
| 4B.4 | Balancing Kv figures | ⬜ | Computed but never checked against a valve schedule. |
| 4B.5 | Fitted curve from a real manufacturer datasheet | ⬜ | **Most important item here.** Only synthetic curves so far. |
| 4B.6 | SIMULATION without a curve is refused | ✅ | Error on the mode switch and on every solve. |

## 4C. TOOLS tab

| # | What | Status | Notes |
|---|---|---|---|
| 4C.1 | Generic Pump Curve: NFPA 20 worked example | ✅ | Reproduces the hand calculation exactly — `h(q) = 140 − 0.02q − 2e-5q²`, 125 kPa at 50% flow. |
| 4C.2 | Copy 3 points → paste into a pump | ⚠️ | Verified in-browser; the three stated duties come back exact. Not yet done by hand through the clipboard. |
| 4C.3 | Copy full table → paste into a pump | ⚠️ | Works, but shifts all three stated duties ~1%. The tool says so. |
| 4C.4 | Clipboard copy over `file://` | ⬜ | Uses the `execCommand` fallback, same as the rest of the app. Proven over HTTP only. |
| 4C.5 | Rising / concave-up curve warnings | ⬜ | Unit-tested; not seen by a human. |

## 5. Output

| # | What | Status | Notes |
|---|---|---|---|
| 5.1 | Calculation sheet readability | ⬜ | |
| 5.2 | Critical path listed first and highlighted | ⬜ | **New.** |
| 5.3 | CSV export opens cleanly in Excel | ⬜ | Check the delimiter/decimal option for your locale. |
| 5.4 | Print calculation sheet | ⬜ | Letterhead margin reserved at the top. |
| 5.5 | Print level plans — one page per level, shared scale | ⬜ | Sheets should physically overlay. |
| 5.6 | Save and reload a model | ⚠️ | Exercised constantly in testing; not deliberately stress-tested. |

## 6. Error handling

| # | What | Status | Notes |
|---|---|---|---|
| 6.1 | No source → "Water source is required" | ⬜ | |
| 6.2 | Supply insufficient → red source, actual flows in brackets | ⬜ | |
| 6.3 | Dead-ended pump | ⬜ | |
| 6.4 | Velocity / friction-rate warnings | ✅ | Seen throughout testing. |
| 6.5 | Laminar flow warning | ⬜ | |
| 6.6 | Shut valve starving a demand | ⬜ | |

---

## Known gaps

* **Darcy-Weisbach is unusable** until the friction-factor correlation is
  chosen. Four are implemented; the spread is ≤1.4%, so it is a judgement call
  about auditability rather than accuracy.
* **No independent verification of any result.** Everything so far is internal
  consistency plus hand calculations by the author of the code, which is the
  weakest form of check. A comparison against another tool, or against a job
  with known answers, is the single most valuable thing left to do.
* **Light theme** has barely been looked at — including how a trace looks on it,
  where invert defaults to off.
* **TRACE has never seen a real drawing.** Everything so far is synthetic line
  art generated in the test itself.
* **Printing** has not been done on real paper.
* **No pump curve has ever been fitted from a real datasheet.** The fitter is
  exercised only against curves generated from its own form, which it recovers
  exactly — that proves the algebra, not that manufacturer curves take this
  shape. The fit quality is displayed for precisely this reason.

## How to log a result

Set the status, add a note if it is anything other than a clean pass, and update
the date at the top. If something fails, a line about *what you did* and *what
you expected* is worth more than the failure itself.
