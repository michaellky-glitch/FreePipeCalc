# FreePipeCalc — outstanding work

Everything Michael has asked for that is not yet done. Closed items move to
`Human-Test.md` with a verification note.

**Every item he has raised so far is done.** What is left is his testing of it,
and one thing found in passing (DX.1).

Updated 2026-08-10, after v0.16.17.

---

## THE ONE THING OUTSTANDING: MICHAEL HAS NOT SEEN ANY OF IT

Nine versions were built in one session (v0.16.4 → v0.16.15) and **none of the
UI has been through his eyes.** Everything was driven through the DOM and the
numbers were checked, but the preview browser renders nothing to pixels, so no
question of the form "does that LOOK right" has been answered.

`Human-Test.md` opens with a `WAITING ON YOU` block holding **§5K–§5Y**. That is
the backlog. Expect a long list back; work down it and say plainly what was not
done.

The likeliest things to come back:

* the **riser notation** box size and where its leader points (§5Y)
* the **TOOLS window** at 400 px — the Convert rows, the tab strip (§5S)
* the **paste preview** and its rotation on screen (§5W, §5X)
* the **greyed tags** and the grid-sized annotation handles (§5T)

---

## Still open

| # | Item | Notes |
|---|---|---|
| DX.1 | Does the DXF open in real CAD? | Untested; nothing in this environment can check it. |

---

## Recently closed

Newest first. Detail in `Human-Test.md` §5A–5J.

* **v0.16.18** — the number of settling sweeps is now the user's to set
  (`control.sweeps`, a field in Thermal ▸ Setpoint control, default 6). A first
  pass keeps the six it always did; a final answer can ask for 10+ and wait. The
  auto solve budget scales with the sweep count so the extra sweeps are actually
  taken, not capped out by a ceiling meant for six; an explicit Max control
  solves still overrides. Default behaviour is unchanged (6 sweeps, identical
  solves). New `thermal.test.js` section.
* **v0.16.17** — the network solve is now cross-checked against an INDEPENDENT
  algorithm (`test/crosscheck.test.js`, a ninth suite). Hardy Cross — loop-flow
  corrections, no shared code with the GGA below the pipe law — re-solves looped
  networks and agrees with FreePipeCalc's flows to 1e-10 across a two-loop grid,
  a three-loop ladder and a rewired grid (Hazen-Williams). It isolates the flow
  DISTRIBUTION, which was never independently checked, from the single-pipe law,
  which Michael validated. First real dent in the biggest gap (HANDOVER §7);
  what remains external-unchecked is thermal, control, the single-pipe law vs a
  published table, and a real job with known answers.
* **v0.16.16** — S4 closed: the survivors re-settle behind a device parked at
  full. Parking a lost device at full moves the plant, and the other
  controllers had settled against the plant *before* that move — so their final
  positions described a plant that no longer existed (on `economizer-trim` with
  ACCH-1 undersized, the coils sat 14% over their rated flow and PMP-01 ended
  30 kPa off its differential). The control loop now settles the survivors again
  against the plant the parked devices hold, re-parking anything that itself
  finishes lost, bounded and terminating because the lost set only grows.
  Parking is still judged only between converged sweep-sets, never mid-sweep.
  New `thermal.test.js` section; the fix is provably inert when nothing is lost.
* **v0.16.15** — riser notation to Michael's own drawing convention: a circle,
  a leader and a box carrying a chevron for the flow direction and a bar across
  whichever end the column terminates at.
* **v0.16.14** — Michael's testing round: half-grid device snapping, sensor
  tags by mode, Part Load and its sync, a Hydraulic tool that sizes on a
  friction gradient, Enter to calculate, tee-on-drop, paste Tab/R, Alt as the
  one "let me" modifier, and the cross-floor link-node bug (mine). S1 closed:
  risers report per segment.
* **v0.16.13** — copy and paste (Ctrl+C / Ctrl+V) built on two pure-model
  functions; a Find tab; copy-level offers a new floor above and follows the
  floor numbering. Fixed on the way: a floor copy was silently losing every
  sensor and every control link, and nothing reported duplicate tags.
* **v0.16.12** — Michael's small-things round: panel wording, Tag Visible into
  DISPLAY and onto pipes and fittings, the DETAIL tool's snap and Delete, a
  Link nodes ribbon group with ADD/REMOVE and a preview, prompts moved to the
  top of the work area, and the TOOLS window gains a two-way CONVERT tab.
* **v0.16.11** — Michael's Annotation batch: pipes unselectable in MOVE,
  grid-sized handles, SELECT renamed MOVE, a per-tag Visible switch, and a
  control link no longer showing on floors it does not belong to (my regression
  from v0.16.9). Plus T1, tag repair, which was recovering the wrong tag AND
  renaming good ones.
* **v0.16.10** — Q1-Q3: the tools move out of a tab and into a moveable window
  with four tabs, opened from Design, Control and Simulate; two new ones —
  pipe velocity & friction, and heat transfer — both "enter any two, get the
  third". An eighth test suite with them.
* **v0.16.9** — Q4: an in-line device slides ALONG its run in 0.1 m steps
  instead of being dragged off it and kinking the pipework (Alt frees it); and
  a control link whose two ends are on different floors is drawn
  at last: half on each floor, meeting at a riser node you can drag in
  ANNOTATION. It used to be drawn as nothing at all.
* **v0.16.8** — S3: the solve is a generator and the page no longer freezes.
  459 heartbeats during a 29.5 s solve where there used to be one; an edit
  mid-solve abandons the run rather than overwriting with a stale answer.
* **v0.16.7** — four reports from Michael: static-mode clicks and tool changes
  were still re-solving (the marquee path and `setTool`); ALIGN, label, note,
  TRACE and control-leader drags now save without solving; `addPipe` was
  dropping the `sensor` it was handed, so every sensor came out a temperature
  sensor; and a sensor's Display list now offers what it measures and draws it.
* **v0.16.6** — A2 and A4, and they were one bug and a half. A missing theme
  key made every text box paint itself in the background colour (an invalid
  canvas colour is silently ignored, so it kept the last one); and
  `pickAnnotation` was documented as being tried in EDIT and never called there.
* **v0.16.5** — the early-design sizing aid: `qNeed` on the engine, a Required
  capacity row and a margin, Auto/Manual sizing on equipment, and a plant
  schedule on the CALCULATION sheet.
* **v0.16.4** — Design ΔT stops clamping the duty at part flow (LS.5, Michael's
  manufacturer table); and the two control-search defects that change exposed —
  a device on its floor could not climb back, and a single probe at the stop
  could not see a response that turns.

* **v0.16.3** — a stranded `app.solving` latch stopped the simulation running at
  all; released on every path now.
* **v0.16.2** — Static/Dynamic had no JavaScript behind it (lost in an edit);
  restored, plus RUN SIMULATION and a clear active highlight.
* **v0.16.1** — the "lost setpoints" were a stale reported error and a stale
  state; both now derived from the final measurement. Annotation: A3, A5, A6,
  A7.
* **v0.16.0** — selection no longer re-solves; STATIC/DYNAMIC; skyline LDLᵀ for
  the GGA matrix (57 s → 39 s, identical answers).
* **v0.15.9** — a truncated control search left every pump on its floor; a
  search that cannot finish is now a no-op. Tag REPAIR and `TAG_MANGLED`.
* **v0.15.8** — sync links; Ctrl adds to the selection, Shift selects the run
  between (which doubles as a connectivity test).
* **v0.15.7** — Ctrl/Shift selection, `controllableAt`, manual VFD slider, no
  arrow at zero flow.
* **v0.15.6** — integrated control valve, capacity override, `Auto` placeholder.
* **v0.15.5** — devices sharing a setpoint are ganged; dangling control links
  reported.
* **v0.15.4** — the two critical corruption bugs: a crash mid-render eating the
  Control section, and a stale field writing to the wrong device.
