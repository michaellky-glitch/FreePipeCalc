# FreePipeCalc — outstanding work

Everything Michael has asked for that is not yet done. Closed items move to
`Human-Test.md` with a verification note.

One feature is IN FLIGHT — the Domestic Water module (DW.MOD), Phase 1 shipped
in v0.16.31, Phase 2 (solver) is next. Everything else he has raised is done;
what is left of the rest is his testing of it, and one thing found in passing
(DX.1).

Updated 2026-08-16, after v0.16.31.

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
| DW.MOD | **Domestic Water module — Phase 2 core done; integration + Phase 3 next** | Michael, 2026-08-12. Approach AGREED — see `docs/DW-MODULE.md`. **Phase 1 DONE (v0.16.31)** + **variations & sizing core DONE (v0.16.32):** full IPC Table E103.3(2) with a per-outflow **Variation** dropdown (occupancy × supply control), and `M.plumbingSizing(m)` — the pure tree-accumulation sizer: per-pipe downstream cold-FU + generic sum → `Generic + fuToFlow(FU)`, with tree/loop/source detection (`DW_LOOP` / `DW_NO_SOURCE` / `DW_MULTI_SOURCE`). Shown read-only in the PIPE panel (Downstream FU, Diversity flow, velocity at design). **Still to do:** (a) fold the diversity flow into the MAIN solve results (`res.flow`) and the CALCULATION SHEET so DW pipes size on it and VELOCITY/PDM warnings fire at the diversity flow; (b) make the continuity/imbalance checks system-type-aware (expected for DW, error for closed-loop/Generic) once DW flows drive the solve; (c) **Phase 3** — forward head-loss pass → residual pressure at each fixture + sheet reporting. **Blocking on Michael before promote:** confirm the `verified:false` IPC transcription and the per-fixture occupancy/control assumptions in `data/plumbing.js` (incl. the WC "Ppublic"→Private typo fix), then set `FD.plumbing.verified = true`. |
| SW.2 | **Finish the sweep → iteration rename (internal)** | Michael, 2026-08-12. The USER-FACING text now says "iteration" (progress bar, the Settling-iterations field, CONTROL_HUNTING / CONTROL_BUDGET messages). The INTERNALS still say sweep: the `sweep`/`MAX_SWEEPS`/`reSweep` variables in `network.js`, `report.sweeps`, and the saved setting key `control.sweeps`. Renaming `control.sweeps` needs a load-time migration so old files keep their value, so it was left for a dedicated pass. Cosmetic, no behaviour change. |
| MSG.2 | **Trim the verbose messages** | `docs/MESSAGES.md` §7 proposes shorter forms for 8 messages; awaiting Michael's yes/no per line, then apply to source. (CONTROL_HUNTING already reworded in v0.16.26.) |
| DX.1 | Does the DXF open in real CAD? | Untested; nothing in this environment can check it. |

---

## Recently closed

Newest first. Detail in `Human-Test.md` §5A–5J.

* **v0.16.32** — Domestic Water: fixture variations + the sizing core. The
  fixture list is now the full IPC 2018 Table E103.3(2), and each outflow has a
  **Variation** dropdown below Fixture (Private / Public × flush tank / flush
  valve etc.), each carrying its own cold FU; `M.outflowFU` reads the variation,
  not the model-wide system. `M.plumbingSizing(m)` is the pure DW sizer: on the
  tree rooted at the source it accumulates downstream cold FU + generic flow per
  pipe and sizes `Generic + fuToFlow(FU)` (sub-additive), rejecting a loop / no
  source / multiple sources (`DW_LOOP`, `DW_NO_SOURCE`, `DW_MULTI_SOURCE`) rather
  than guessing. The PIPE panel shows Downstream FU, Diversity flow and velocity
  at design for a DW branch, or the error. Data still `verified:false`. 15 new
  assertions (suite 2048). Folding the diversity flow into the main solve/sheet
  and the forward pressure pass remain — see DW.MOD. Verified live (logic).
* **v0.16.31** — Domestic Water module, Phase 1 (data + model + UI; no solver
  yet). A Plumbing outflow type sits inside the outflow DESIGN panel: choose a
  fixture (10 from IPC 2018 Table E103.3(2), cold column) and a count, or Custom
  with a typed FU, and the panel reads back the cold fixture units. A "Plumbing
  supply" selector on the HYDRAULIC tab picks the demand curve (flush tank /
  flushometer valve, Table E103.3(3)). New `data/plumbing.js` carries the
  transcribed tables **`verified: false`** (glycol treatment) pending Michael's
  sign-off — the FU→demand diversity curve, sub-additive, is why a DW branch
  legitimately does not balance. New `model.outflowFU()` and `plumbing.test.js`
  (39 assertions). The tree accumulation + diversity SOLVER is Phase 2. Verified
  live. See `docs/DW-MODULE.md`.
* **v0.16.30** — context-aware paste for devices (CP.CTX). Ctrl+V of a single
  copied device, with a device of the SAME kind selected, stamps its properties
  onto that device (never its tag); nothing selected — or a different-kind
  target, or the copied device itself — places a new object as before. Verified
  live.
* **v0.16.29** — Source/Outflow panel presented like a pump or exchanger
  (SO.PANEL): Details / Design / Actual / Display sections, and a new "Actual
  flow" display tag (Qa) on the node. Verified live.
* **v0.16.28** — a batch of contained UI items (Michael, 2026-08-12). The TOOLS
  and MESSAGES windows are now RESIZABLE (drag the corner) and RECOVER when
  off-screen: shrinking the browser used to strand them past the edge with no
  way back; now reopening drops the window on the right side if its last spot is
  off-screen. LEVELS is collapsible (click the header; state kept in
  localStorage; adding a level re-expands). TRACE cleanup: "Set scale from a
  known distance" → "Set Scale", the Drawing-width box and all the explanatory
  hints removed, and Set-Scale's second point now snaps to 15° (Shift/Alt frees,
  with a live preview). Verified live. Deferred to the week: context-aware
  copy/paste (CP.CTX), the Source/Outflow panel rework (SO.PANEL), and the DW
  module (DW.MOD, approach under discussion).
* **v0.16.27** — status-chip follow-ups (Michael, 2026-08-12). Dismissed
  warnings no longer count on the chip (dismissing one updates the count live).
  The warnings chip is now GREY rather than orange — warnings are soft and
  dismissable; errors (red) and defects (amber) still catch the eye. Clicking
  the chip now toggles the MESSAGES window open/closed, like the TOOLS button.
  Verified live: 2 warnings → dismiss → 1; grey colour; toggle.
* **v0.16.26** — three from Michael, 2026-08-12. (1) Turning info-panel / "Show
  on drawing" tags on or off no longer re-solves — it saves and redraws like the
  Tag-visible switch beside it (presentation, not geometry). (2) User-facing
  "sweep" is now "iteration" (progress bar, Settling-iterations field, control
  messages); the internal rename is logged as SW.2. (3) CONTROL_HUNTING now
  reports a metric — "N of M controlled devices holding setpoint (X%)" — so an
  engineer can accept, say, 90% while the design is in flux and raise Settling
  iterations to finish it later, rather than a flat "still moving". Carries
  `holding`/`total`/`pct` fields. Verified live.
* **v0.16.25** — the status chip opens a MESSAGES window (Michael, 2026-08-12).
  A moveable window like TOOLS with two lists, **Active** and **Dismissed**,
  showing every error, defect, warning and notice ordered by severity. Clicking
  a message goes to the pipe/node it names (switches floor, centres, selects) —
  the old "highlight every affected pipe at once" is deprecated. Each warning and
  notice carries a **Dismiss** button that moves it to Dismissed; errors and
  defects cannot be dismissed (they read "must fix"). Dismissal is by signature
  (code + where), so it survives a re-solve; session-only. Verified live:
  dismiss/restore, per-item navigation, errors locked, persistence across
  re-solve, chip opens/closes it. **Still open from this round: the MESSAGES.md
  reference reformat (Code/Message/Issue) and trimming verbose messages.**
* **v0.16.24** — two UI items (Michael, 2026-08-10). (1) The CALCULATION sheet
  now REMEMBERS which sections you collapsed: it was rebuilt on every switch to
  the tab, resetting every section, so collapsing All Pipes to read Critical
  Path only lasted until you looked away. `app.calcCollapsed` keeps the
  open/closed state by section title for the session; Thermal and the Appendix
  still start collapsed until you change them. (2) The tool INSTRUCTION under the
  ribbon now always sits on its own line below the buttons — it used to trail to
  the right when short and wrap below when long, so the same prompt appeared in
  two places. New wording for the two equipment prompts, per Michael. Verified
  live.
* **v0.16.23** — coil part-load sync discoverability (Michael reported TR.5 as
  "no option to sync coil part loads"). Could not reproduce a real fault: on
  `20260809-DC.json` a coil's Control section shows **Sync part load % with**
  offering the 13 other AHUs, in DESIGN and SIMULATION alike (verified live).
  The field only vanished when a coil was the ONLY heat exchanger in the model —
  nothing to sync to. That case now shows the row DISABLED with "Place a second
  heat exchanger to sync this one to it", so the option is no longer invisible.
  (If it persists with two or more coils it is a stale cache — hard-refresh.)
* **v0.16.22** — the riser notation box is draggable in Annotation (Michael,
  2026-08-10). Grabbing the callout box in the MOVE tool moves it; the leader is
  redrawn from the circle on the pipework to the box every frame, so it stays
  attached, and the circle itself does not move. The offset is per level (each
  floor places its own callout clear of that floor's pipework) and in screen
  pixels, so it holds through zoom; it snaps to the grid, frees with Shift/Alt,
  saves without solving, and persists through save/load. Verified live by
  dispatching pointer events. **The look is Michael's to judge.**
* **v0.16.21** — detail lines and their nodes are moveable in Annotation
  (Michael, 2026-08-10). In the MOVE tool: grabbing a detail VERTEX moves it on
  its own — with any vertex exactly coincident, so a shared corner or a closed
  box's doubled point stays joined; grabbing a detail LINE moves the whole
  CONNECTED detail (every line sharing a corner), so a box moves as one whether
  drawn as one closed polyline or as separate lines meeting at their ends. Notes
  became draggable at the same time (the `dragNote` stub was never wired). All
  snap to the grid, free with Shift/Alt, and save without solving (`arranged`).
  Verified live by driving real pointer events: node-drag, whole-polyline drag,
  and a two-line L moving together, no console errors. **The on-screen feel is
  still Michael's to judge.**
* **v0.16.20** — Michael's second list of 2026-08-10. (1) The CONVERT tool's
  input boxes were browser-default white in the dark panel — now styled to match
  `.field input` (UI.1, his clarified item). (2) The Thermal insulation TABLE is
  now EDITABLE per nominal size (`thermal.insulation`, keyed by size so it is
  schedule-independent), on top of the global default and the per-pipe override.
  (3) DETAIL boxes (notes and detail lines) are now copy-pasteable — Ctrl+C/V
  carries an annotation-only fragment that follows the pointer by its own corner
  and pastes as a drawing change (no solve). Verified live: Convert boxes dark,
  table edits persist, annotation copy/paste extracts-renders-rotates-inserts
  with no error. New model.test.js and thermal.test.js coverage. Human-Test
  settled sections archived to `Human-Test-Archive.md`.
* **v0.16.19** — two from Michael's list of 2026-08-10. (1) The CHECK VALVE is
  now an arrowhead pointing the way flow is allowed with a seat bar across its
  tip — the standard non-return symbol, replacing the swing flapper. (2)
  INSULATION is decoupled from the pipe schedule: thickness is a single global
  default in Thermal (50 mm, `thermal.insulation_mm`), overridden per pipe
  (including 0 for bare). The old "25 mm below DN50, 50 mm above" schedule rule
  and its per-size editor are gone; a schedule is now its published dimensions
  only. Old files re-solve on the 50 mm default (sub-DN50 pipes shift 25→50);
  the two known-good files still converge. Both are visual/behavioural and
  await Michael's eye. **The check-valve appearance cannot be verified here —
  screenshots render nothing to pixels.**
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
