# Human test log

What has actually been checked by a person, and what has not.

This is deliberately separate from the automated suites. Those cover ~490
assertions of engine behaviour, but they cannot tell you whether a button is
discoverable, whether a drawing prints legibly, or whether a result *looks*
right to someone who sizes pipes for a living. Only Michael can sign those off.

**Status key** — ✅ passed · ⚠️ passed with a note · ❌ failed · ⬜ not tested yet

Last updated: 2026-07-29 (v0.5.0-dev)

---

## 1. Calculations

Nothing here has been signed off yet. The numbers reconcile internally and
against hand calculations, but no independent check against another tool or a
known project has been done.

| # | What | Status | Notes |
|---|---|---|---|
| 1.1 | 3-floor riser + ring main solves sensibly | ⚠️ | Built and reviewed; energy balance closes exactly. Not checked against another tool. |
| 1.2 | Data centre closed circuit, redundant pumps | ⚠️ | Runs; equipment gets exactly its rated flow and ΔP. Numbers not independently verified. |
| 1.3 | Hazen-Williams against a manual calculation | ⬜ | `docs/ENGINE.md` has worked examples set up for exactly this. |
| 1.4 | Fitting equivalent lengths vs. a published table | ⬜ | Flat L/D per spec §3.3. Worth a spot check against ASHRAE. |
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
| 3.3 | Valve insert, gate/check, 0–100% | ⬜ | |
| 3.4 | Equipment insert, rated flow and ΔP | ⬜ | |
| 3.5 | Equipment tags on drawing and sheet | ⬜ | |

## 4. Interface

| # | What | Status | Notes |
|---|---|---|---|
| 4.1 | Toolbar grouping and mode hints | ⬜ | Reorganised in v0.4.0. |
| 4.2 | LAYOUT: drag labels | ⬜ | |
| 4.3 | LAYOUT: "Show on drawing" checkboxes | ❌ | **Michael could not find these.** They appear only in LAYOUT mode, in the properties panel, under a *Show on drawing* heading, after selecting a device. If they are still not findable, the placement is wrong — treat this as a UI defect, not user error. |
| 4.4 | Vertical pipe label drag box | ⚠️ | Was a horizontal box on a vertical pipe (Michael's screenshot). Fixed; needs confirming. |
| 4.5 | Open/closed loop indicator on the ribbon | ⬜ | **New.** Should read OPEN LOOP with a source, CLOSED LOOP with a pump and no source, NO SUPPLY with neither — and change as you draw. |
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

## How to log a result

Set the status, add a note if it is anything other than a clean pass, and update
the date at the top. If something fails, a line about *what you did* and *what
you expected* is worth more than the failure itself.
