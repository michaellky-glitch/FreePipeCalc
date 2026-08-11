# Human test log

What has actually been checked by a person, and what has not.

This is deliberately separate from the automated suites. Those cover 1979
assertions of engine behaviour (all passing), but they cannot tell you whether a
button is discoverable, whether a drawing prints legibly, or whether a result
*looks* right to someone who sizes pipes for a living. Only Michael can sign
those off.

**Status key** — ✅ passed · ⚠️ passed with a note · ❌ failed · ⬜ not tested yet

Last updated: 2026-08-10 (v0.16.19)

**THE CURRENT BATCH IS DIRECTLY BELOW**, before anything historical — Michael
2026-08-09, having gone looking for it and found it buried under two years of
closed sections. Everything under `WAITING ON YOU` is from the last three
versions and none of it has been through his eyes. Older sections follow, newest
first. `WORKLIST.md` says what is waiting on me.

---

# WAITING ON YOU — v0.16.4 to v0.16.19

Nothing in this block has been looked at by a person. Each row says what was
driven and how, so you know which part is already pinned and which part is the
bit only you can judge.

> **Settled sections are archived** in [`Human-Test-Archive.md`](Human-Test-Archive.md)
> so this log shows what is still pending. Moved there so far: riser notation
> (5Y), the simulation-runs / static-dynamic / sync rounds (5J, 5I, 5E), and the
> older fully-verified Drawing and v0.6.0-dev sections.

## 5AB. YOUR SECOND LIST — v0.16.20 (2026-08-10)

The three from your second message, plus the archive tidy-up. All driven and
wired in the live app with no console errors; the look is yours to sign off.

| # | What | Status | Notes |
|---|---|---|---|
| CB.1 | **Convert input boxes match the other inputs** | ✅ | You meant the CONVERT tab (screenshot), where the boxes were browser-default white in the dark panel. They now carry the same styling as every `.field input` — dark `--bg-input`, `--text`, `--line` border. Verified live: the computed background is `rgb(17,21,26)`, identical to a panel input. |
| IN.2 | **The insulation table in Thermal is editable** | ✅ | Each nominal size has its own thickness box now, keyed by LABEL so it is the same whatever schedule the pipe is on — on top of the global default and the per-pipe override. Blank in a row takes the default. Verified live: editing DN15 to 37 mm stores it and `thicknessMmForSize` returns 37; the loss column follows. Resolution order is pipe → size-table → global default → 50 mm. |
| DP.1 | **Detail boxes are copy-pasteable** | ✅ | Ctrl+C on a selected note or detail line (or several) takes an annotation-only fragment; Ctrl+V places it following the pointer by its own lowest-leftmost corner (no node to anchor on), Esc cancels, R rotates. It pastes as a DRAWING change — saved, not solved — and is allowed even while a simulation is locked, the same reason annotation is deletable while locked. Annotation also rides along when copied together with pipework, on the same offset. Model layer tested in `model.test.js`; the ghost/rotate/insert exercised live with no error. **The on-screen look of the ghost is unverified — screenshots render nothing here.** |
| RM.1 | **The riser notation box drags in Annotation** (v0.16.22) | ✅ | Grabbing the callout box in the MOVE tool moves it, and the leader is redrawn from the circle on the pipework to the box so it stays attached — the circle itself does not move. The offset is per FLOOR (so each level's callout can dodge that floor's pipework) and in screen pixels, so it keeps its size and place through zoom. Snaps to grid, frees with Shift/Alt, saves without solving, survives save/load. Verified live: grabbing the box set the drag, dragging moved the box and its stored offset while the riser's plan point stayed put, and the offset round-tripped through `toJSON`/`fromJSON`. **The feel and the leader's look are yours to judge.** |
| DM.1 | **Detail lines & their nodes move in Annotation** (v0.16.21) | ✅ | In the MOVE tool: grabbing a VERTEX moves it on its own — together with any vertex exactly coincident with it, so a shared corner or a closed box's doubled first/last point stays joined. Grabbing a LINE moves the whole CONNECTED detail — every line sharing a corner — so the box moves as one, whether you drew it as a single closed polyline or as separate lines meeting at their ends. Notes drag too (the wiring was a dead stub before). All snap to grid, free with Shift/Alt, save without solving. Verified live by dispatching real pointer events: a doubled corner moved both its points and left the far corner alone; a whole polyline shifted +3/+3; two separate lines forming an L moved together at their shared corner. **The feel of it is yours to judge.** |
| AR.1 | Settled sections archived | ✅ | You asked me to archive settled issues. Fully-verified sections (riser notation, sim-runs / static-dynamic / sync, and the old Drawing / v0.6.0-dev rounds) moved to `Human-Test-Archive.md`; this log now shows what is still pending, with a pointer at the top. |

## 5AA. WHILE YOU WERE AWAY — v0.16.16 to v0.16.19 (2026-08-10)

Done from your list and the standing backlog while you slept. The engine
changes are covered by new tests; the two UI/visual ones are driven and wired
but, as always, not looked at.

| # | What | Status | Notes |
|---|---|---|---|
| S4.7 | **Survivors re-settle behind a device parked at full** (v0.16.16) | ⬜ | The recorded S4. Parking a lost device at full moves the plant, and the others had settled against the plant BEFORE that move — so their positions no longer described the answer. Now the loop settles the survivors again against the parked plant, re-parking anything that itself finishes lost, bounded. On `economizer-trim` with ACCH-1 undersized to 145 kW: coils went from ~14% over rated → within 0.3%, PMP-01 from 30.8 kPa off its differential → 147 Pa, five drifted devices → none. Provably inert when nothing is lost — `20260809-DC` solves identically (675 solves, no drift). Genuine limit cycles (two non-ganged pumps fighting) are still, correctly, flagged CONTROL_HUNTING. New `thermal.test.js` section, red-before/green-after. |
| XC.1 | **The network solve is cross-checked against an INDEPENDENT algorithm** (v0.16.17) | ✅ | Your biggest gap (§7), first dent. `test/crosscheck.test.js` re-solves looped networks by HARDY CROSS — loop-flow corrections, no shared code with the GGA below the pipe law — and the two agree on every flow to 1e-10 across a two-loop grid, a three-loop ladder and a rewired grid (Hazen-Williams). Handed each pipe's own r and n, so it checks the DISTRIBUTION, which was never independently checked, not the single-pipe law, which you validated. Darcy is out of scope on purpose (its friction factor moves with the flow). Nothing user-facing — this is validation only. |
| SW.1 | **Settling sweeps is configurable** (v0.16.18) | ✅ | THERMAL ▸ Setpoint control ▸ **Settling sweeps** (default 6). Your ask: a first pass keeps six, a final answer can have 10+ and wait. The auto solve budget scales with it so the extra sweeps are actually taken. Default behaviour identical (unset = 6 sweeps, same solve count). Verified in the live app: the field is present; 12 → 12 sweeps, 20 → 20, a converging model still stops early. |
| CV.7 | **Check valve is now an arrowhead + seat bar** (v0.16.19) | ✅ | Your sketch of 2026-08-10, read as the standard non-return symbol: a triangle pointing the way flow is ALLOWED (a→b, confirmed against the solver's reverse-flow rule) with a seat bar across its tip, replacing the swing flapper. Drawn larger than the bowtie valves so the direction reads. **Driven in the live app — placed and rendered with no error — but the APPEARANCE is unverified: screenshots render nothing to pixels here. This one needs your eye.** If the arrow points the wrong way or the seat sits wrong, say so. |
| INS.1 | **Insulation decoupled from the schedule** (v0.16.19) | ✅ | Your ask. Thickness is now one global default in THERMAL (50 mm, `thermal.insulation_mm`), overridden per pipe (including 0 for bare) — the "25 mm below DN50, 50 mm above" schedule rule and its per-size editor are gone; a schedule is its published dimensions only. Verified in the live app: THERMAL shows a **Thickness** field, the schedule table lost its Insulation column, and the per-pipe override still wins. **Your two known-good files re-solve on the 50 mm default** — sub-DN50 pipes shift 25→50 mm, so their pipe heat-loss changes slightly; both still converge (DC 20.0–45.1 °C, HighRise 6.0–16.1 °C). You chose "let them re-solve". |
| UI.1 | Calculate input boxes black | ✅ | **Logged in WORKLIST, not yet done.** From the code the tool INPUT boxes already use the standard near-black colour; the muted-grey ones are the read-only CALCULATED-RESULT boxes. Needs your eye to confirm exactly which boxes you mean before I touch shared styling. |

## 5X. YOUR TESTING ROUND OF 2026-08-09 (v0.16.14)

| # | What | Status | Notes |
|---|---|---|---|
| TR.1 | **A device snaps to half a grid, not to travel** | ✅ | I had it wrong: quantising the DISTANCE MOVED means where a device ends up depends on where it started, so two valves nudged along the same main never line up. The POSITION is snapped now, to half a minor grid. Verified: dragged towards 21.37 m it lands on **12.750** — on the 0.25 lattice — and the y never moves. |
| TR.2 | **Display > Design Load works on plant** | ✅ | It was drawn only for an EXCHANGER, whose design figure is `duty`; a source/sink keeps its on `qMax`, so on a chiller or tower the switch did nothing at all. |
| TR.3 | **Sensor tags say what they measure** | ✅ | `TS / PS / FS / DPS / DTS`. Verified all five on the real button path: temperature=TS-1, pressure=PS-1, flow=FS-1, dP=**DPS-1**, dT=**DTS-1**. The mangled-tag detector was taught the new prefixes at the same time, so `DPS-1` does not read as corruption. |
| TR.4 | Capacity override → **Part load**, no explanation | ✅ | It never was an override of the capacity: the design figure is untouched and this asks what the machine is doing today. |
| TR.5 | **Coils sync their part load** | ❌ | Coil to coil only — a percentage of duty and a percentage of travel are not the same quantity, so a pump is not offered. Verified: leader at 40%, follower reads 40 after a solve. Fourteen AHUs on a floor is the case. |
| TR.6 | **Enter calculates** | ✅ | Bound to the tools body, so a tool that grows a field cannot forget, and only where there is a button to press — which is why CONVERT (live as you type) ignores it. |
| TR.7 | Velocity & friction → **Hydraulic** | ✅ | |
| TR.8 | **Solve for Friction drop** — and for a bore FROM one | ✅ | Five modes now. Sizing on a gradient is how a main is actually picked, so that direction is there too: 10 L/s at 400 Pa/m gives 88.1 mm → DN100. **Bisected, not inverted** — a closed form written for Hazen-Williams would not serve Darcy, whose friction factor depends on the bore it is solving for. Round-trips exactly: 4 L/s in 58.269 mm reads 550 Pa/m, and 550.465 Pa/m gives 58.269 mm back. |
| TR.9 | **A link node on the upper floor stays on the upper floor** | ⬜ | Real bug, mine. A cross-floor link has TWO legs that route independently — the near one on `control`, the far one on `control.far` — and every edit wrote to the near leg whatever floor you were on. That is also the "dragging nodes on the wrong level". Verified: adding on the upper floor puts 3 points on the far leg and **0** on the near one. |
| TR.10 | Risers show what they are doing | ✅ | Per SEGMENT — flow, velocity, ΔP between each pair of floors — because a column is not one pipe: on a stack serving four floors the bottom segment carries far more than the top, and one averaged number would hide exactly that. Plus the tag switch. |
| TR.11 | **Paste: Tab picks the end, R turns it** | ✅ | Tab cycles the joining node round the boundary; R turns the fragment 90° clockwise about it. Verified both. Only the geometry turns — label offsets are stored in screen pixels and route bends in world coordinates, so those are dropped rather than left pointing the wrong way. |
| TR.12 | **A pipe end dropped on a pipe makes a tee** | ✅ | It used to mean nothing, so the node sat on top of the run touching nothing — the silent break `disconnections()` exists to report, made by hand. Verified: the main is replaced by two halves that keep its size, schedule and C, and three pipes meet at the drop. |
| TR.13 | **Convert keeps the caret** | ✅ | Every keystroke rebuilt the tab, which destroys the input you are typing in — the same trap `renderProperties` has. The opposite box is written in place now. Verified: typing 3 then 5 leaves the SAME input element focused and gives 35 °C → 95.00 °F. |

### Interface

| # | What | Status | Notes |
|---|---|---|---|
| TR.14 | "COMMAND" gone from the ribbon | ✅ | It was also being re-applied in JavaScript on every mode change, which is why taking it out of the markup was not enough on its own. |
| TR.15 | **COPY / PASTE on Design > Edit** | ✅ | They do what Ctrl+C / Ctrl+V do. The two that used to sit there copied PROPERTIES — a different verb — and have moved to the bottom of the properties panel's DESIGN section, as **Copy properties / Paste properties**. Two buttons a foot apart both saying COPY is a trap. |
| TR.16 | Valves duplicated into CONTROL | ✅ | Beside the sensors, since a control valve is placed while you are wiring controls. |
| TR.17 | **ADD CONTROL works in either direction** | ✅ | Sensor first or pump first. A pump can only ever be the follower and a sensor only ever the target, so there is nothing ambiguous and no reason to make the hand remember an order. |
| TR.18 | REPAIR hides itself | ✅ | Shown only when something in the model actually looks mangled, re-checked on every solve. Not deleted — the corruption was real and this is the only way back from it. |
| TR.19 | **Alt frees any constraint** | ✅ | Pipe angles, the grid, detail lines, device sliding. Shift still frees the 15° snap because the fingers know it, but Alt is the one that means it everywhere — on a device drag Shift was already taken (it selects the run between), so a single rule was only ever going to be Alt. |

## 5W. COPY AND PASTE, FIND, AND THE FLOOR ABOVE (v0.16.13)

**A backup of v0.16.12 is in `Previous Version/v0.16.12`,** taken before any of
this and diffed against the working tree to confirm it is identical.

### Copy and paste

| # | What | Status | Notes |
|---|---|---|---|
| CP.1 | **Ctrl+C takes the selection, Ctrl+V places it** | ✅ | Shift-click still selects the run, exactly as you expected. On `economizer-trim`: PMP-02 → ACCH-1 gives 3 pipes; Ctrl+C reports "3 pipes and 4 nodes copied — 1 link to items outside the selection will be dropped". The fragment follows the pointer and the next click drops it; Esc cancels. |
| CP.2 | The anchor is where it met the loop | ✅ | A boundary node — one that a copied pipe and an uncopied pipe both touch. That is where the copy will want to join, which is what you predicted. If there is no boundary it falls back to the lowest-then-leftmost node, so the answer is stable rather than dependent on selection order. |
| CP.3 | **Dropping onto a node JOINS it** | ✅ | The anchor ring fills green when it is over an existing node. Verified: dropping onto one creates 3 nodes instead of 4 — the anchor is reused rather than duplicated — and a copied pipe lands on it. Dropping in free space is allowed too, and `disconnections()` flags the loose end, which is the existing safety net. |
| CP.4 | **A copied pump follows the COPIED sensor** | ✅ | Not the original's. Pointing at the original is two pumps on one measurement, which is the degenerate case `CONTROL_GANGED` exists to complain about. |
| CP.5 | ...and a link out of the selection is DROPPED and said so | ⬜ | On `economizer-trim` the copied PMP-02 came out with no control link, because TS-2 was not in the selection — and the toast said so at copy time, not after. |
| CP.6 | **Tags are made unique** | ✅ | ACCH-1 → ACCH-2, PMP-02 → PMP-03, keeping the printed width (CHWP-01 → CHWP-02, not CHWP-2). Zero duplicate tags in the model afterwards. |
| CP.7 | A settled VFD position does not travel | ⬜ | The copy starts at full travel; it came out of a solve of different plant, and the control loop resets to full anyway. |
| CP.8 | The copy is left selected | ✅ | So it can be moved or deleted straight away. |
| CP.9 | **Duplicate tags are now reported** | ✅ | `TAG_DUPLICATE`. Nothing detected this before — every table on the CALCULATION sheet is keyed on the tag, so two rows called CHWP-01 could not be told apart. A warning, not a defect: it is a real state mid-edit. |

### What this fixed on the way

| # | What | Status | Notes |
|---|---|---|---|
| CP.10 | **Copying a FLOOR was losing every sensor and every control link** | ⬜ | `copyLevel` enumerated the fields to carry — kind, schedule, size, C, tag, equip, pump, valve — and silently dropped `sensor`, `control` and `sync`. The same bug `addPipe` had, from the same cause. It goes through the same two functions as copy-paste now, which clone wholesale. Verified: a dP sensor and its control link both survive a floor copy and the link points at the copy. |
| CP.11 | The copy dialog was lying about sources | ⬜ | It said "A SOURCE is deliberately not copied"; the code has always copied them, and your own test records that suppressing them was tried and rejected. The sentence is gone. |

### Find, and the floor above

| # | What | Status | Notes |
|---|---|---|---|
| F.1 | **A Find tab in TOOLS** | ✅  | Matches tag *and* internal id, case-insensitive substring — both are things you have in your hand. "ACCH" finds all three; "P70" finds TS-2. Tag matches sort above id matches. |
| F.2 | Clicking a result goes to it | ✅  | Switches floor if it has to, centres it **without changing the zoom**, and selects it. It is the one tool that reads the model, and it only ever reads. |
| F.3 | **Copy level offers a new floor first** | ✅  | "New floor above — Level 11", selected by default, and offered even when there is nowhere else to copy to so the button never dead-ends. |
| F.4 | ...following the old floor's numbering | ✅  | Level 10 → Level 11. Width kept, so Level 09 → Level 10, not Level 9. `L2` → `L3`, `B1` → `B2`, `Level 3 (Plant)` → `Level 4 (Plant)`. A name with no number gets " 2" — Roof, Roof 2. Anything already taken steps again. |

## 5V. THE SMALL-THINGS ROUND (v0.16.12)

Your list of 2026-08-09, in the order you gave it. Everything was driven through
the DOM; none of it has been LOOKED at.

| # | What | Status | Notes |
|---|---|---|---|
| SM.1 | Sync VFD with: "None" | ✅  | Was "— not synced —". Verified with two pumps: the list reads `None | PMP-02`. |
| SM.2 | Tag Visible moved to DISPLAY | ✅  | First in the section, above the value-box switches — it governs them, since with the tag off there is nothing for them to sit under. |
| SM.3 | Its explanation is gone | ✅  | |
| SM.4 | The value-box line is now "Tag (Info Panel)" | ✅  | The two were both called "Tag" once they shared a section. |
| SM.5 | **Pipes and fittings have it too** | ⬜  | A plain pipe had no Tag field at all — it has one now, drawn first in the pipe label, and a Display section carrying the switch. A plain node (a fitting) gets the switch as well: its label always exists, whether or not anyone has named it. |
| SM.6 | A hidden tag's box is GREY, not orange | ✅ | Grey box + grey text = hidden. Orange box = something on that you can grab. The orange had it reading as "selected". |
| SM.7 | **The DETAIL tool's first click snaps** | ✅ | Off-grid (3.17, 2.23) lands on (3.00, 2.00); with Shift it stays put. The cause was `shiftDown` being read only on pointermove — an opening vertex is placed by a pointerdown with no move of its own, so it used whatever the last move had seen. |
| SM.8 | Delete removes details and text boxes | ✅ | Both fell through to `removeNode`, which quietly did nothing because no node has their id. |
| SM.9 | The DETAIL blurb is one line, behind a 🛈 | ✅ | Your wording: "Draws annotation lines. Holding shift removes grid snaps. Escape to exit." |
| SM.10 | "Remove line" → "Delete" | ✅ | |
| SM.11 | **Link nodes are their own ribbon group** | ✅ | `Link nodes: ADD | REMOVE`. |
| SM.12 | REMOVE takes one out | ⬜ | Verified: 3 → 2 → … → and with the last one gone the route falls back to its plain Z. |
| SM.13 | **They are easier to place** | ⬜ | The target was a flat 12 px; it is the same grid-sized handle as everything else now (36 px by default). And the cause of "especially between PWP-01 and DP-02" was **mine**: `routePointAt` asked for the route without naming a floor, which v0.16.9 made return null for a link that changes floor — so a cross-floor link had nothing to click on at all. |
| SM.14 | A preview shows where it will land | ⬜ | A green ⊕ at the exact point for ADD, a red ⊗ over the node that would go for REMOVE, following the pointer. |
| SM.15 | **Neither triggers a simulation** | ⬜ | Measured: 0 solves across an add and four removes. It was calling `changed()`; it calls `arranged()` now — save and redraw, no solve. |
| SM.16 | Prompts and the progress bar sit top-centre of the WORK area | ⬜ | Both, at the same anchor. The bar was pinned 96 px from the top of the window and the ribbon is taller than that — and it WRAPS, so its height depends on the window width and on which mode is showing. The canvas now publishes its own position as `--work-top`. Toasts moved up from the bottom to join it. |
| SM.17 | TOOLS moved to MISC | ⬜ | Beside RENUMBER and ⤢, once, instead of three copies in the mode palettes. |
| SM.18 | Explanations gone from the tools | ⬜ | All of them. |
| SM.19 | **"Solve for", and the answer at the bottom** | ⬜ | Velocity: `Solve for` names the output, `bore` is `Pipe diameter`, and the solved box is last — flow/velocity/**diameter**, or diameter/velocity/**flow**, and so on. Heat transfer the same. |
| SM.20 | The pump curve is drawn, above Result | ⬜ | The three stated duties marked on it, so what the interpolation did between them is visible rather than described. |
| SM.21 | Critical radius marked (BETA) | ⬜ | |
| SM.22 | **A CONVERT tab** | ⬜ | Two-way and live — type in either box and the other follows, no direction to choose and no button. Verified both directions: 100 °C → 212.0 °F, and 9 °F of ΔT → 5.00 K typed from the right. Rows: **absolute temperature**, **ΔT**, pressure (kPa · bar · psi · m H2O · mm Hg · ft wg), flow (L/s · L/min · m³/h · US gpm), each end picking its own unit. |
| SM.23 | The two temperature rows are separate on purpose | ⬜ | An absolute temperature carries the 32° offset; a difference does not. One shared row is how a ΔT of 5 K becomes 41 °F on a schedule. There is a test that says so. |

## 5T. YOUR ANNOTATION BATCH, AND THE TAGS (v0.16.11)

| # | What | Status | Notes |
|---|---|---|---|
| AN.1 | **Pipes are not selectable in Annotation** | ⬜ | Clicking the pipe LINE or a node in MOVE now selects nothing; in SELECT both still work. What stays selectable there: notes, detail lines, control-link bends, the cross-floor riser, and **labels and tags** — including a pipe's own size annotation, which you need to grab in order to drag it. Devices stay selectable too, because MOVE is where the "Show on drawing" checkboxes live. |
| AN.2 | **Bigger handles, adjustable** | ⬜ | Measured in GRID SQUARES rather than pixels, so the target holds its size relative to the drawing instead of shrinking with the zoom. SETTINGS → Drawing → **Annotation handle size (grids)**, default 0.5, ceiling 2. At your grid and zoom: **0.5 → 36 px across, 1 → 72, 2 → 144** (it was a flat 22). The floor scales with the setting as well as the grid term — without that, at 8 px/m half of 0.5 grid is under two pixels and the setting would have appeared to do nothing. |
| AN.3 | **Annotation → SELECT renamed MOVE** | ⬜ | And the tooltip with it: "Move labels, tags, notes, detail lines and control-link nodes into place for printing." |
| AN.4 | **Tags have their own Visible switch** | ⬜ | On any tagged pipe, device or node: **Tag visible: ON/OFF**, beside the Tag field. Separate from the "Show on drawing" checkboxes, which control the value BOX. Verified: OFF hides it in SELECT and on prints, keeps it in MOVE, and it is still selectable there. Stored as `tagOff`, so every existing model keeps its tags. |
| AN.5 | ...greyed, not gone, in Annotation | ⬜ | Drawn in the muted colour at 55% opacity. Hiding it there too would leave nothing to click on to turn it back on. |
| AN.6 | **Control links only appear on their own floor** | ⬜ | **This was my regression, from v0.16.9.** The "both ends on the level being drawn" test used to be written out at both call sites; moving it into `controlRoute` dropped it for the ordinary same-floor case, because a link that does not span has no span to check itself against. An L0 link is now absent on L1 and L2, and there is a test. |
| AN.7 | The riser is easier to grab | ⬜ | Same handle sizing as AN.2 — 36 px across by default rather than 22. |

## 5U. TAG REPAIR, IN THE BACKEND (v0.16.11)

You left this with me. It turned out to be two faults, and the repair was giving
a wrong answer as well as missing one.

| # | What | Status | Notes |
|---|---|---|---|
| T1.1 | **The mangling INSERTS, it does not append** | ⬜ | `CHWP-0AHU-15AHU-152` is `CHWP-02` with `AHU-15` inserted twice at a caret — the real tag's trailing "2" is stranded after it. The old rule stripped the trailing run and gave **`CHWP-0`**: plausible, wrong, and silent. Removing the repeated token from wherever it sits gives **`CHWP-02`**, which is the answer. |
| T1.2 | ...and the inserted text can be truncated | ⬜ | `PWP-04MP-4MP-4…×7` appends `MP-4`, which is `PMP-4` with its first character absorbed, so matching whole generated tags missed it entirely. A hyphenated group repeated at the end catches it. |
| T1.3 | **And it no longer renames good tags** | ⬜ | Found by writing the false-positive half of the test: **`B2-AHU-7` was being stripped to `B2-`**, and had been since the rule existed. A real mangling leaves a complete tag behind it (`CHWP-04`); a hierarchical name leaves a dangling separator (`B2-`). The head must now end in a letter or digit. `AHU-1212`, `SUB-AHU-12-A`, `VAV-1-2` are all left alone. |
| T1.4 | It is still a best guess | ⬜ | The mangling is lossy — `CHWP-02` came back only because the stranded "2" survived, and a mangling that ate it would be unrecoverable. Worth a glance at what REPAIR TAGS reports rather than trusting it. |

## 5S. Q1–Q3 — THE TOOLS WINDOW (v0.16.10)

| # | What | Status | Notes |
|---|---|---|---|
| Q1.1 | **A moveable window, not a tab** | ⬜ | Opened from a TOOLS button in Design, Control and Simulate — three buttons, all wired. A tab took the drawing off the screen in order to answer a question you were asking about the drawing. Verified: opens, closes with ✕ or Esc, drags by its title bar (200,150 after a drag), and both position and open state come back after a reload. |
| Q1.2 | It stays on screen | ⬜ | Dragging clamps to the viewport. A window dropped off the edge and then reopened where it was left is a window you cannot get back. |
| Q2.1 | **Four tabs** | ⬜ | Pump curve · Critical radius · Velocity & friction · Heat transfer. One at a time — stacked worked with two and would not with four in a 400 px window. All four render. |
| Q3.1 | **Velocity & friction: any two give the third** | ⬜ | Flow + velocity → bore, flow + bore → velocity, bore + velocity → flow. All three round-trip exactly: 4 L/s at 1.5 m/s gives 58.269 mm, and putting that back gives 1.5 m/s and 4 L/s. Which two are yours is a dropdown, not a guess from what you typed last — guessing overwrites the box you are correcting as you type into it. |
| Q3.2 | ...and the friction is the MODEL's | ⬜ | Assembled exactly as `network.build` assembles a pipe. 4 L/s in 58.27 mm at C=120 reads **550 Pa/m**, hand-checked against Hazen-Williams to 1e-6. Re 87,056, turbulent, 55.0 kPa per 100 m. A tool with its own friction formula is a second implementation waiting to disagree. |
| Q3.3 | It answers "what size do I buy?" | ⬜ | 58.27 mm is not a pipe. **DN65 (62.7 mm)**, through the schedule's own `sizeForFlow` — the same rule the sizer uses — so the tool cannot recommend a size the model would not have picked. |
| Q3.4 | **Heat transfer: any two give the third** | ⬜ | Q = ṁ·Cp·ΔT. 50 kW across 5 K → **2.39 L/s**, 2.388 kg/s, capacity rate 10 000 W/K; putting the flow and ΔT back gives 50.00 kW. Uses the model's fluid, so glycol gives a glycol answer — and says on screen when those properties are the unverified ones. |
| Q3.5 | The arithmetic is tested without a DOM | ⬜ | New eighth suite, `test/tools.test.js`, 36 assertions — the calculators are separated from their forms precisely so they can be hand-checked with no model open, which is the rule the tools page has always stated. |
| Q3.6 | **Looks** | ⬜ | Everything above was driven through the DOM. **Nothing about how the window LOOKS has been seen** — not the tab strip, not the drag bar, not how the fields sit at 400 px wide. That is the part only you can judge. |

## 5R. Q4 — A DEVICE SLIDES ALONG ITS RUN (v0.16.9)

"Drag-snap to grid intersections along the pipe (0.1 m) — presentation only;
the pipe stays straight."

| # | What | Status | Notes |
|---|---|---|---|
| Q4.1 | **It slides along the run, and the run stays straight** | ✅ | A device is two nodes spliced into a run, so dragging it anywhere but along that run put a dog-leg in the pipework either side. Verified on a straight 20 m main with a gate valve at 8 m: dragged 3.37 m along and **4 m sideways**, it moved 3.40 m along and **zero** sideways, and every node stayed on y = 0. |
| Q4.2 | 0.1 m steps | ✅ | 3.37 m of travel lands on 3.40. Finer than the drawing grid on purpose — this is positioning a valve in a run, not laying out pipework, and the device is only 0.5 m long. |
| Q4.3 | The neighbours absorb it | ✅ | 7.75 + 0.50 + 11.75 became 11.15 + 0.50 + 8.35. The run is still 20 m and still one straight line. **It is an EDIT, not presentation** — those two pipe lengths really changed, so it solves and saves like any other geometry change. |
| Q4.4 | It cannot be driven off the end |✅ | Dragged to x = 60 it stops at 19.00…19.50, leaving a device length of margin before the outflow. Without the clamp the neighbour pipe turns inside out and reports a negative length. |
| Q4.5 | **Alt frees it** — and NOT Shift | ✅ | Alt gives back the old unconstrained move. Shift would have matched the convention everywhere else, and it cannot be used: on a device Shift already means "select the run between", and it suppresses the drag from starting at all, so a Shift-freed move could never have worked. The mode hint now says so. |

## 5Q. A CONTROL LINK THAT CHANGES FLOOR (v0.16.9)

Your new item. A pump on the plant floor following a sensor two storeys up used
to be drawn as **nothing at all** — the renderer refused any link whose two ends
were not both on the level being drawn, because a straight dashed line between
them cuts across a floor it has no business on.

| # | What | Status | Notes |
|---|---|---|---|
| CF.1 | **Half the link on each floor** | ✅ | On the device's floor, a dashed line from the device out to a riser node. On the sensor's floor, a dashed line from the same node to the sensor. Verified by capturing what the renderer paints: ground floor draws `PMP-01` and `↑ TS-1  (Level 1)`; Level 1 draws `TS-1` and `↑ PMP-01  (Level 0)`. |
| CF.2 | The node says where it goes | ✅ | A ring in the control colour — same shape as a pipework riser, so it reads as "this goes up" — labelled with the far end's tag and the floor it is on. "Up to what?" is the question the marker raises, so it answers it. |
| CF.3 | **Draggable in ANNOTATION** | ✅ | ANNOTATION selects the `view` tool, which is where the control-link bend handles already live, so it is the same gesture. Verified: drag moves it and it snaps to the grid. Not draggable with SELECT — the handle is not even registered there. |
| CF.4 | One riser, moved from either floor | ✅ | There is only one of it: a control cable rising through a shaft is in one place. Dragged from the ground floor to (4, −6), then from Level 1 to (13, 2) — the same point moved both times, and both halves of the link still meet at it exactly. |
| CF.5 | It is annotation, so it saves without re-solving | ✅ | Released through `arranged()`, the verb added in v0.16.7 — the drawing changed, the answer cannot have. It survives a save and reload. |
| CF.6 | The two halves route independently | ✅ | Each leg keeps its own axis and mid, or they would share one degree of freedom between two lines and fight over it. |
| CF.7 | Same-floor links are untouched | ✅ | The case every existing model is. Checked on `economizer-trim`: 6 controlled devices, 0 spans, all 6 routes drawn, 16 bend handles, no riser handles, and the sample route is the same four points as before. |
| CF.8 | It prints | ✅ | The printed plan follows the same rule per sheet, riser and label included. **Not verified — printing has never been checked on real paper.** |

## 5P. YOUR DATA CENTRE, ON THE REPAIRED FILE (`debug/20260809-DC`)

Not a change — a **result**. This is the first run of your data centre on a
clean file with the v0.16.4 physics, and it is the confirmation the ΔT ruling
was waiting for. Nothing here was edited by me; it is what your model now does.

**Tags are clean.** `CHWP-0AHU-15AHU-152` → `CHWP-02` and
`CHWP-04PMP-1PMP-1PMP-1PMP-1PMP-1` → `CHWP-04`. All 36 tags read properly. The
ΔP sensor was replaced too — `DP-01` on P458 is now `DP-02` on P482, a real
`mode: 'dP'` sensor holding 250 kPa.

| # | What | Status | Notes |
|---|---|---|---|
| DC.1 | **It converges, with no errors** | ✅ | `converged: true`, no `SETPOINT_LOST`. `20260808-DC-broken` did not converge and had 14 devices parked at full. 594 solves over 6 sweeps, 43 s. |
| DC.2 | **Every machine holds its setpoint, and none is "limited by" anything** | ✅ | ACCH-01/02/03 hold **20.00 °C**, CT-01/02/03 hold **35.00 °C**, and the `limit` column is empty on all six. This is the sentence that used to read "limited by Design ΔT" on 26–50% of your machines. |
| DC.3 | ...at genuine part load, which is the point | ✅ | The chillers do **310 kW of 800 kW (39%)** and the towers **622 kW of 836 kW (74%)**. Same low percentages as before — but now they are what the load actually is, with nothing capping them, rather than a clamp refusing to let them work harder. The difference is DC.2. |
| DC.4 | The coils are no longer starving |✅ | All 14 AHUs hold their Design ΔT with their valves at **69–71%** — real modulating positions with authority in hand — and errors of 0.02 K. PWP-01 holds the differential to **993 Pa of 250 kPa** (0.4%). CHWP-01/02/03 sit at 51% holding 30 °C to within 0.01 K. |
| DC.5 | **The fourth lineup is carrying nothing — is that deliberate?** | ✅ | CHWP-04 reports `no-flow`, ACCH-04 does 0.0 kW, and CT-04 has no thermal link at all. `CONTROL_NO_FLOW` is raised. If that set is N+1 standby then this is correct and the warning is just telling you so. If it is meant to be running, something upstream of it is not connected. **Your call — I have not touched it.** |
| DC.6 | `CONTROL_HUNTING` after six sweeps | ✅ | The loop was still moving when it ran out of sweeps, so the answer reported is the last one rather than a settled one. The numbers look settled — 0.02 K on the coils, 0.4% on the differential — so this is a "could not prove it had stopped" rather than a "wrong". 19 interacting devices is the most this model has ever had to settle at once. Tell me if you want the sweep ceiling raised. |

## 5O. THE PAGE NO LONGER FREEZES WHILE IT SOLVES (S3, v0.16.8)

The solve still TAKES 30–40 s on your data centre. What changed is that the
browser stays alive for all of it.

Everything below was measured in a real browser on `20260808-DC-broken.json`
(278 pipes, 19 controlled devices) with a 50 ms heartbeat: if the thread is
blocked, the ticks stop.

| # | What | Status | Notes |
|---|---|---|---|
| S3.1 | **The page answers while it solves** | ⬜ | **459 heartbeats during a 29.5 s solve.** 591 is the ceiling if the thread were completely idle, so the page was live for about four fifths of the wall clock. Median gap 62 ms, 95th 74 ms, worst 207 ms, and **nothing over 300 ms**. Before this, the whole 29.5 s was one uninterruptible block and the heartbeat fired **once**. |
| S3.2 | The answer did not change | ⬜ | This is the assertion that matters most and it is why the sync driver was kept: `solveModel` drains the same generator, so all 1762 test assertions run through the new code unchanged. Checked directly on three models — economizer-trim, and both DC files — comparing every flow to 12 significant figures, every device state and position, every warning and error code. **Identical.** |
| S3.3 | The progress bar means something | ⬜ | Reads e.g. `29%  Simulating… sweep 2 of 6 · CHWP-01`. The fraction is *devices settled out of the worst case* — every device on all six sweeps — so it never overstates, and a model that settles in two sweeps **finishes with the bar at a third**. That is why the sweep count is spelled out beside it. A bar that stops early beats one that goes backwards, but tell me if you would rather have an indeterminate stripe. |
| S3.4 | **An edit during a solve abandons it** | ⬜ | New hazard, and it arrived WITH the fix: while the page froze, nothing could be edited underneath a running solve. Now it can be, and the loop writes actuator positions into the live model as it searches — so a solve that started before an edit is answering about a model that has moved. Verified: edit mid-solve, the first run is dropped, exactly one continues, the latch releases and the bar clears. |
| S3.5 | Nothing else changed shape | ⬜ | `solveNow`, the printer, the calculation sheet and the DXF path all still call the plain synchronous `solveModel`. Only the app's debounced background solve steps the generator, and only for models over 60 pipes in SIMULATION — a small model still solves in one go, as before. |
| S3.6 | Web Workers — asked and answered | ⬜ | No, and for two reasons rather than one. `file://` is a null origin so `new Worker('src/network.js')` is a SecurityError; and even past that a worker cannot `importScripts` or fetch the engine from a null origin, so the source would have to be inlined as a string — a build step. The second blocker is architectural, not a browser quirk that ages out. Written up in `HANDOVER.md` §5. |

## 5N. YOUR FOUR REPORTS OF 2026-08-09 (v0.16.7)

All four reproduced first, measured, then fixed. The recalculate ones were
counted by wrapping `solveModel` and driving the real gestures, so "no solve" is
a measurement rather than an opinion.

| # | What | Status | Notes |
|---|---|---|---|
| R.1 | **Clicking in static mode no longer re-solves** | ⬜ | Clicking a PIPE was already fine (v0.16.0). Clicking **empty space** was not: that is the marquee path, and it ended with `changed()` — a solve and a save — for a gesture that only ever writes `selection`. Every click that missed a pipe cost you a recalculate. Measured before: 1 solve. After: none. |
| R.2 | **Picking up the PROBE no longer re-solves** | ⬜ | `setTool` ended with `onChange()`, which schedules a solve and a save. Every tool change did it. It refreshes the panel now and nothing else — the panel still has to be rebuilt because TRACE, DETAIL and the annotation modes each put their own controls in it. |
| R.3 | **CONTROL and ANNOTATION no longer re-solve on the way in** | ⬜ | Same cause as R.2: `setUIMode` selects a tool on entry, so every mode button inherited the solve. Measured: CONTROL, ANNOTATION and SIMULATE all now cost nothing, and a real edit still solves exactly once. |
| R.3b | And four drags that were also solving | ⬜ | Found while in there. Dragging a **label**, a **note**, the **TRACE image**, a **control-link bend**, or the whole model with **ALIGN** each scheduled a full solve. None can move a number — ALIGN is documented as unable to change a length, it moves every level by the same offset. They are saved now and not solved. There is a third verb for it: `changed` (edit → solve + save), `arranged` (drawing → save only), `selectionChanged` (neither). |
| R.4 | **The dP button makes a dP sensor** | ⬜ | `sensorClick` always picked the right default; `M.addPipe` copied `equip`, `pump` and `valve` and **silently dropped `sensor`**. The pipe arrived as `kind: 'sensor'` with no sensor object, and the panel then filled in its temperature default. Verified all five buttons on the real ribbon path: TEMPERATURE / FLOW / PRESSURE / DIFF. PRESSURE / DIFF. TEMPERATURE now produce `temperature` / `flow` / `pressure` / `dP` / `dT`. |
| R.5 | **A sensor's Display list offers what it measures** | ⬜ | Was a fixed list — Tag, Flow, Temperature, Setpoint — whatever the instrument was. Now: a ΔP sensor offers **Differential pressure**, a ΔT sensor **Differential temperature**, a pressure sensor **Pressure**. Flow stays on every mode, because a sensor is a piece of pipe and the flow through it is always real. |
| R.5b | ...and the toggle actually draws it | ⬜ | A checkbox that draws nothing is the failure this project keeps catching, so the drawing was done too. Verified by capturing what the renderer paints: `374.6 kPa` on the pressure sensor, `ΔP 9.2 kPa` on the differential, `ΔT 0.0 K` on the ΔT — each matching `FD.network.sensorReading`, which is now the ONE definition of what a sensor reads, shared with the control loop so the drawing and the controller cannot disagree. |

## 5M. THE TEXT BOX, AND DETAILS YOU CAN SELECT (v0.16.6)

A2 and A4. They turned out to be one bug and a half, and both were found by
driving the real app in a browser — served on `127.0.0.1`, clicks dispatched at
real canvas coordinates, the result read back out of the model and out of the
pixels.

| # | What | Status | Notes |
|---|---|---|---|
| A2 | **The text box appears** | ⬜ | It was always being drawn. The palette's default colour is named `line` and the theme's neutral is called `text`, so `detailColour('line')` returned `undefined` — and an invalid canvas colour is **silently ignored**, leaving the fill at `theme.bg`, which had been set two lines earlier for the note's own backing panel. Background text on a background panel. Proved by reading the pixels inside the note's box: **0 foreground pixels before, 97 after**. |
| A2b | Detail lines were the same bug, wearing a disguise | ⬜ | A default-coloured detail line took whatever colour the previous draw call happened to leave. They were visible, so nobody looked — but the colour was an accident. Both now use the theme's neutral. |
| A4 | **Details and notes are selectable with SELECT** | ⬜ | Not the erase behaviour after all, though that is real too — with the DETAIL tool active a click does erase. `pickAnnotation` says in its own comment that it is tried "before the model's own hit tests in VIEW, and after them in EDIT", and the EDIT half was never wired: the helper was called from exactly one place. Verified: clicking a detail line in SELECT now selects it and its panel renders; clicking a note selects it; VIEW still works; clicking empty space still clears and starts a marquee; clicking a pipe still selects the pipe. |
| A4b | Ctrl and Shift still assemble a set | ⬜ | The annotation pick is only tried on a PLAIN click. With a modifier held you are building a selection by hand, and a stray detail line under the pointer must not replace it. |

## 5L. "SIZE IT FOR ME" — THE EARLY-DESIGN SIZING AID (v0.16.5)

The other half of your ΔT ruling. Blank capacity now means the machine holds
its setpoint whatever that takes, so the duty it lands on is the answer to what
to buy.

**These were driven in a real browser** — the app served over `127.0.0.1:8787`,
the model loaded, the panel and the sheet read back out of the DOM, no console
errors. That verifies the wiring and the numbers. It does not verify how any of
it LOOKS, which still needs your eyes.

| # | What | Status | Notes |
|---|---|---|---|
| SZ.1 | **Required capacity**, in the equipment Actual section | ⬜ | `C·(setpoint − entering)` at the flow the machine actually has. On `economizer-trim`, ACCH-1 reads **134.09 kW** required against 134.09 kW done — unlimited, the two are the same number by definition. |
| SZ.2 | **Margin on selection** beside it | ⬜ | `+86.4% (250.00 kW selected)` on ACCH-1: 250/134.09 − 1. Red when negative. When a capacity BINDS this is the only place the shortfall is stated, because the reported duty is then the nameplate rather than the demand. |
| SZ.3 | **Sizing: Auto / Manual** on equipment | ⬜ | Mirrors the pump panel. Verified round trip on ACCH-1: Manual −250 kW / 15 K / 3.9886 L/s → **Auto** clears the capacity and touches neither the flow nor the ΔT → **Manual** writes back the **134.09 kW it actually needs**, holds the 3.9886 L/s design flow, and moves the design ΔT to **8.05 K** = 134090.6/(998 × 0.0039886 × 4187). The design flow is held deliberately: it is a number you chose, and a sizing decision must not quietly rewrite it. |
| SZ.4 | On Auto, the panel says what to do with the number | ⬜ | "% Load" reads `—` (there is no nameplate to be a percentage of) and a hint says *"Sizing is Auto, so this is the capacity to select. Switch Sizing to Manual to lock it in as the nameplate."* |
| SZ.5 | **Plant schedule** on the CALCULATION sheet | ⬜ | In the Thermal section, sources and sinks only. On `economizer-trim` with CT-01 left on Auto: <br>`ACCH-1  3.99  1.43  15.00  22.50  134.09  250.00  +86.4%` <br>`CT-01   4.00  3.20   5.98   4.92   65.77  Auto    —` <br>Worth looking at the two ΔT columns together: ACCH-1 is working across **22.50 K against a 15 K design figure**, and CT-01 across **4.92 K against 5.98 K**. That is the whole of the ΔT change in two rows — ΔT is an output of the flow, above or below the schedule as the system dictates. |
| SZ.6 | It is not a duplicate of Equipment duty | ⬜ | That table reports what every device DID; this one answers what to buy. Both are in the Thermal section; both print when it is open. |

## 5K. DESIGN ΔT, AND THE SEARCH THAT COULD NOT SEE PAST ITS OWN PROBE (v0.16.4)

Your ruling on LS.5, and the two control-loop defects that removing the clamp
uncovered. All of it is covered by tests; none of it has been through your eyes
yet.

| # | What | Status | Notes |
|---|---|---|---|
| LS.5 | **Design ΔT stops clamping the duty** — your ruling, option 1 | ⬜ | Your part-load table is now a test: at design, 27.65 L/s across 12 K sits exactly on the 1380 kW nameplate; at 30% load, 9.464 L/s across **10.5 K** leaving at 20.00 °C is 415 kW against 30% of 1380 = 414 kW. And the row your data centre lives in: the same machine at that floored flow with a **35 °C return** now holds 20 °C across 15 K doing 593 kW, where it used to stop at 12 K, leave the water at 23 °C, and report "limited by Design ΔT" at 43% of nameplate. |
| LS.7 | Models without a capacity must gain one | ⬜ | `economizer-trim` gained ACCH-1's own design point, 250.00 kW = ρ·q_rated·cp·ΔT on the fixture's own numbers. **Your other files will need the same** — blank now means unlimited, which is the sizing question, not a ceiling. |
| LS.8 | `20260805-4`'s lost setpoint has gone, and it was never real | ⬜ | ACCH-1 is scheduled 7.977 L/s across 15 K = a 500 kW design point, carrying 200 kW. It was never short of anything; the clamp bit at the flow the balanced branches deliver, so it could not reach 7.5 °C and the pump was told it had lost a setpoint no speed could recover. It now holds 7.5 °C with nothing limiting it. |
| CS.1 | **A device on its floor could not climb back** | ⬜ | The mirror of the v0.15.9 restart-from-full, and it had been there all along. On `economizer-trim`, sweep 1 puts PMP-02 on its 25% floor *honestly*; by sweep 2 the valves have throttled and the answer is at 32.9% — but with nothing below to probe, the search returned `at-min` without solving anything and the pump was parked at 100%. Now it restarts from full. |
| CS.2 | **The response of a mixing circuit is not monotonic** | ⬜ | Two sources, a bypass, a check valve, a mixing sensor — your economizer in miniature. While the check valve holds the bypass shut the trim pump sets the *whole* loop flow, so slowing it makes the supply **colder**; once the bypass opens, mixing makes it **warmer**. The rig crosses a 20 °C setpoint twice, at 45% and 30%. One probe at the stop saw a smaller error of the same sign and gave up. The travel is scanned now — downward, so it stops at the higher root, which is where a controller ramping down from full stops. |
| CS.3 | `economizer-trim` converges, and the split moved | ⬜ | ACCH-1 reaches 7.5 °C rather than being pinned at 15 °C, so the mix needs **four ninths** through the chiller rather than two thirds: 30x + 7.5(1−x) = 20 → x = 5/9 bypassed. PMP-02 at 32.9%, TS-2 at 19.96 °C, CT-01 66 kW + ACCH-1 134 kW = the 200 kW the four coils put in. |
| CS.4 | It got faster, not slower | ⬜ | `20260807-DC-broken.json`: was 232 solves over 6 sweeps and **did not converge**; now 55 solves over 2 and converges with all eight devices holding setpoint — 23.5 s → 5.4 s. `20260808-DC-broken.json`: 41.5 s → 40.0 s. |

---

## Awaiting Michael's eye — new in v0.7.0-dev

Same caveat as below: built and internally verified, but the build
environment's browser has a 0×0 viewport, so **no pixels were ever rendered**
and nothing here has been looked at.

| # | What | Status | Notes |
|---|---|---|---|
| 8.1 | Undo removes a pump/equipment in ONE press | ❌ | Intermetent bug. Sometimes works. Log as unsolved but low priority. |
| 8.9 | Globe valve: symbol, and Kv about 6× lower than a gate | ⬜ | Filled disc at the throat. 7 assertions. |
| 8.10 | Check valve flapper symbol | ⬜ | Per Michael's screen snip; was a bowtie. |
| 8.13 | Dragging a node onto another joins them; straight run goes continuous | ⬜ | Refuses to dissolve a size change, a corner, or a node with a device. |
| 8.16 | Check valve symbol is larger and its direction readable | ⬜ | **Michael reported this.** 1.6× the bowtie valves. |
| 8.18 | Pipe properties show Pressure drop and PD/m | ⬜ | Verified against the engine (5.69 kPa, 699.8 Pa/m). Note they are on different lengths and say so. |
| 8.19 | ANNOTATIONS: "Node" group, with a Pressure toggle | ✅ | Show -ve pressure in red. |
| 8.20 | Visualisers: FLOW, VELOCITY, PRESSURE | ✅ | Gradient pressure between 2 nodes on pipe. |
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
| 1.3 | Hazen-Williams against a manual calculation | ✅ | **Constants independently confirmed 2026-07-31**: ASHRAE Eq (6), Δh = 6.819·L·(V/C)^1.852·(1/D)^1.167, reduces algebraically to the app's A = 10.67 and e = 4.8704 (agreement 0.035% and 0.012%). ASHRAE Example 1 also reproduces exactly (750.0 Pa). A full worked pipe run by hand is still outstanding. |
| 1.10 | Hazen-Williams, converging/diverging tees | ❌ | **Michael found this wrong.** Two causes, both confirmed in code — see `ENGINE.md`. Blocked on choosing a coefficient source. |
| 1.5 | Loop flow split against hand calculation | ⚠️ | A SYMMETRIC ring now splits exactly in half (asserted to 1e-8, and independent of drawing order) — that much is proven. Michael's `20260802-2.json` was splitting 51/49 until v0.7.10-dev; the cause was the bullhead tee, not the solver. An ASYMMETRIC split against a hand calculation is still unchecked. |
| 1.12 | Bullhead tee coefficient | ⬜ | **New in v0.7.10-dev, and the one to rule on.** Where two ring legs leave a tee in line with each other, both are now charged as a BRANCH (K = 1.1) rather than one as a run (K = 0.9). No number was invented — it is a choice of which tabulated coefficient applies — but you hold ASHRAE Tables 3/4 and this case (inlet through the branch, dividing into both run legs) is arguably its own fitting. Worth confirming. It raises pump duties slightly: +0.20 m on the 3-floor model, +2.6 kPa on the data centre. |
| 1.6 | Pump duty vs. a real selection | ✅ | |
| 1.7 | Darcy-Weisbach | ⚠️ | **Unblocked, BETA (v0.8.0).** Swamee-Jain, at your selection. Validated against a Colebrook iteration written independently in the test suite: 0.9% over the practical envelope, 2.8% at the corner of its published validity (Re 5000, ε/d 1e-2). End to end on 100 m of DN50 at 5 L/s the app gives 11.126 m against 11.046 m hand-iterated. **Never checked against another tool or a real job** — that is what the BETA line on the sheet is for. |
| 1.16 | Equivalent length: three tables | ⬜ | **v0.8.2–0.8.4.** Carrier Table 11 is the default; NFPA 13 and Custom are the alternatives. All 104 published cells asserted against your two pages from a second independent transcription. **The agreement across sources is the reassuring part**: L/D ratios, NFPA and Carrier land within 1% of each other on both fixtures (3-floor duty 41.95 → 41.96 m), and Carrier's tee-run is within 0.25% of the old L/D value at DN100. None was fitted to any other. |
| 1.22 | Two calculation methods | ⬜ | **New in v0.9.0.** `Hazen-Williams (ASHRAE with Equivalent Lengths)` and `Darcy-Weisbach (BETA)`. Numbers moved by **0.08%** on the 3-floor duty (41.96 → 41.99 m) because the survivor derives its constants from the printed 6.819 rather than carrying the rounded 10.67 — that gap IS the rounding in 10.67. An older model saved as ASHRAE migrates to HW on load and changes fitting basis from K to equivalent length, which is a real change to its numbers. |
| 1.23 | K source citation | ⬜ | **Please check this one.** The line now reads "ASHRAE Handbook — Fundamentals, Pipe Sizing, Table 1 (threaded) and Table 2", as you asked. The values are transcribed from the page you sent, which is headed **Ch 22 Tables 3 and 4** (p.22.6), and every cell is asserted against it. The citation and the data's provenance disagree about the table numbers. |
| 1.20 | Carrier feet → metric conversion | ⬜ | Carrier is stored in FEET (the table is printed that way) and converted at ft × 0.3048 to 2 dp. That reproduces **your** metric conversion of the same table cell for cell — app, test arithmetic and your spreadsheet all agree. Worth confirming the rounding convention is the one you want. |
| 1.21 | Published tables are read-only; Custom unlocks | ⬜ | **New in v0.8.4.** You cannot type over a cell while the line beneath says "Source: NFPA 13" — pick Custom, which seeds from whatever was showing. Switching back to a published set drops the custom values rather than applying them under someone else's name. Verified in the DOM. |
| 1.19 | The Carrier row is visibly not NFPA | ⬜ | **New in v0.8.3.** Asterisk on the row, your note above the source line, and a line in the calculation-sheet appendix. Worth checking it reads clearly on a printed sheet, since that is where it matters. |
| 1.17 | Sizes below DN25 | ⬜ | **Please rule on this.** The table starts at DN25 as you asked, so a DN15 pipe is charged the DN25 figure — 0.6 m for a 90° elbow where NFPA prints 0.3 m. The printed table does have ½ in and ¾ in columns and the steel schedules go down to DN15. Two more columns would fix it. |
| 1.18 | Equivalent length shown in feet | ⬜ | The stored value is the printed METRIC column, so a model set to feet shows 1.969 ft where the page prints 2. The two columns are NFPA's own independent roundings of each other (13 ft is printed as 4 m), so no conversion reproduces both. Correct by the metric-first rule — worth knowing if you check against the page in feet. |
| 1.14 | Darcy-Weisbach fittings by K | ⬜ | **New in v0.8.1.** Fittings now charge K·V²/2g from ASHRAE Tables 3/4 under Darcy, as under ASHRAE; only Hazen-Williams uses equivalent length. Verified end to end against a hand calculation (a DN100 threaded elbow at the solved flow costs exactly 0.70·V²/2g). **Numbers on an existing Darcy model will change** — they were on an L/D basis before. |
| 1.15 | K tables against your printed page | ✅ | All 144 tabulated values in both Table 3 and Table 4 now match, asserted in `engine.test.js` from a second independent transcription. The threaded 45° elbow question is closed: the column really is flat (0.38 → 0.28). |
| 1.13 | Swamee-Jain accuracy claim | ⬜ | **Worth your eye.** The literature's "within 1% of Colebrook" is what the code used to say and it is NOT true at the corners — measured 2.8% at Re 5000 with ε/d 1e-2. The app now states 0.9% / 2.8% instead. Confirm that is the right thing to print on a sheet. |
| 1.8 | Critical path is the genuinely worst circuit | ⬜ | Picks the smallest-residual terminal. Worth checking against judgement on a real job. |

## 3. Devices

| # | What | Status | Notes |
|---|---|---|---|
| 3.2 | Pump insert, auto / fixed / off | ✅ | Auto-sizing reworked twice. Re-check duty figures. |
| 3.6 | Pump curve: from duty, paste, table | ⬜ | **New.** Driven in-browser during the redundancy battery; not used by hand. |

## 4. Interface

| # | What | Status | Notes |
|---|---|---|---|
| 4.4 | Vertical pipe label drag box | ⚠️ | Was a horizontal box on a vertical pipe (Michael's screenshot). Fixed; needs confirming. |
| 4.7 | Custom pipe schedule: paste from a spreadsheet | ⬜ | **New.** Three columns, all in mm. |
| 4.9 | Dark and light themes | ⚠️ | Light theme outside drawing area can be a bit grey. |
| 4.10 | Every checkbox is now a switch | ⬜ | **New in v0.7.7-dev.** Panels, the annotations list, and HYDRAULIC. Verified in the DOM (no `input[type=checkbox]` left in any panel) and each one toggles the model. Two things to look at: does a column of switches read better than tick boxes at this density, and is the muted-vs-accent off/on state clear enough? It is deliberately NOT red/green — red is a fault everywhere else in this app. |
| 4.11 | PRESSURE visualiser gradients along a pipe | ⬜ | **New in v0.7.7-dev.** Verified through the real render path: a plain pipe ramps between its two node colours, a pump/valve/equipment link gets a hard step at the symbol. Never seen as pixels — the legend, the disc-over-gradient contrast and whether the ramp is legible at working zoom are all yours. |
| 4.12 | K factor on outflows, pumps and equipment | ⬜ | **New in v0.7.7-dev.** From the design values, in the model's display units, unit spelled out (`0.316 L/s/√kPa`). Hover gives the arithmetic and warns it is neither the sprinkler K nor a Kv. |
| 4.20 | HYDRAULIC equivalent-length table | ⬜ | **New in v0.8.2.** Thirteen size columns, every cell editable, edited cells tinted, Reset button below, "Source: NFPA 13 (2019) Table 27.2.3.1.1" underneath. Verified in the DOM: it renders the printed values, an edit reaches the engine and interpolates with its neighbours, blanking a cell restores the printed figure, and Reset clears the lot. Whether thirteen columns are readable at your panel width is yours to judge. |
| 4.18 | HYDRAULIC method dropdown | ⬜ | **Bug found and fixed in v0.8.1.** It listed HW and DW only, while the default is ASHRAE — a new model showed "Hazen-Williams" in a box that was set to ASHRAE, and choosing either was a one-way door. It is built from the engine's method list now. Worth a look at whether all three read clearly. |
| 4.19 | Fitting PD annotation | ⬜ | **Bug fixed in v0.8.1**, and it affected the DEFAULT method, not just Darcy. Verified against a hand calculation (517.84 Pa both ways). Switch on ANNOTATIONS ▸ Fitting PD to see it. |
| 4.15 | HYDRAULIC formula renders with real superscripts | ⬜ | **Fixed in v0.8.0** — it was a flex-layout bug, so exponents sat on the baseline and read as separate factors. Verified in the DOM (the exponent boxes now sit 8.7 px above the baseline of the term they belong to, on both methods); never seen as pixels. |
| 4.16 | TOOLS: NFPA 20 / Generic / Copy / ⓘ on one row | ⬜ | **New in v0.8.0.** Verified all four share a line and Copy sits above the result table. |
| 4.17 | SIMULATE: pump head on the DRAWING matches the panel | ⬜ | **Bug you reported, fixed in v0.8.0.** Verified: with a deliberately weak curve, the drawing and the panel both read 109.1 kPa where the design duty is 131.7 kPa. Previously the drawing showed 131.7. |
| 4.14 | "Show on drawing" box drags independently of the tag | ⬜ | **New in v0.7.10-dev.** Verified through real pointer events on both a device and a node: dragging the tag leaves `boxOffset` alone and vice versa, and grabbing the box selects its entity. **Existing models will move**: a box that was dragged with its tag before now starts back at its default position, once. |
| 4.13 | PROBE under VIEW | ⬜ | **New in v0.7.8-dev.** Verified through real pointer events: hover follows the pipe, click pins, Esc clears the pin (a second Esc leaves the tool). The readout box, the crosshair marker and whether a 24 px catch radius feels right are all yours. Trimmed in v0.7.9-dev — no panel copy, no "(whole pipe)" note; the properties panel now shows whatever is selected. |

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
| 4B.1 | DESIGN/SIMULATION chip toggles and locks the calculated side | ⚠️ | Reworked in v0.7.6-dev — see 4B.6–4B.11. Nothing is a disabled input any more; both sides are read-only boxes. Needs a human eye on discoverability. |
| 4B.3 | Parallel pumps and N+1 failure | ⚠️ | Battery above. Not checked against another tool. |
| 4B.4 | Balancing Kv figures | ⬜ | Computed but never checked against a valve schedule. |
| 4B.5 | Fitted curve from a real manufacturer datasheet | ⬜ | **Most important item here.** Only synthetic curves so far. |
| 4B.6 | Pump panel: order reads Pump ID / Tag / Direction / Status / DESIGN / ACTUAL | ⬜ | **New in v0.7.6-dev.** Verified in the DOM; never rendered to pixels. |
| 4B.7 | The 🛈 marker beside the pump heading | ⬜ | **New.** Hover text confirmed present. Two things to look at: does the glyph render on your machine (it may fall back to a box), and is a hover tooltip discoverable enough for what it says? |
| 4B.8 | "New curve…" jumps to TOOLS with the duty pre-filled | ⬜ | **New.** Verified in the DOM: the tab switches and the generator opens carrying the pump's design flow and pressure. |
| 4B.9 | DESIGN vs ACTUAL boxes are visually distinguishable | ⬜ | **New.** Two `.readout` boxes with small caps titles. Purely a look question. |
| 4B.10 | Outflow in SIMULATE: design box editable, actual box beside it | ⬜ | **New in v0.7.6-dev.** The design flow is now EDITABLE in SIMULATE (it is the input the terminal's characteristic comes from, not a result). Worth confirming that reads right. |
| 4B.11 | Head is no longer a settable pump parameter | ⬜ | **New.** The box was permanently disabled and is gone. Confirm nothing is missed by its absence. |

## 4C. TOOLS tab

| # | What | Status | Notes |
|---|---|---|---|
| 4C.2 | Copy 3 points → paste into a pump | ⚠️ | Verified in-browser; the three stated duties come back exact. Not yet done by hand through the clipboard. |
| 4C.3 | Copy full table → paste into a pump | ⚠️ | Works, but shifts all three stated duties ~1%. The tool says so. |
| 4C.4 | Clipboard copy over `file://` | ⬜ | Uses the `execCommand` fallback, same as the rest of the app. Proven over HTTP only. |
| 4C.5 | Rising / concave-up curve warnings | ⬜ | Unit-tested; not seen by a human. |

## MICHAEL'S TO-DO

Things only Michael can settle, pulled out of the tables below so they are not
buried in them. Nothing here is a defect — each is a number or a judgement the
app cannot source for itself.

| # | To do | Why it matters |
|---|---|---|
| **TD.1** | **Check the propylene glycol properties** (`data/fluids.js`) | Asked for at his instruction and written from recollection of ASHRAE Ch 31, flagged `verified: false` throughout. **Cp first**: it scales every thermal duty *linearly*, and unlike a friction factor nothing downstream absorbs an error. Water is untouched at 998 / 4187. The flag shows beside the selector, on THERMAL, and on the calculation sheet. |
| **TD.2** | Set the outside surface coefficient | 8 W/m²·K is a default, not sourced. On an insulated pipe it is a small part of the resistance; on a **bare** pipe it is the whole of it. |
| **TD.3** | Set the plausibility band per service | Defaults to ±50 °C, which suits chilled water and **trips on any LTHW system** — the test suite demonstrates this at 80 °C flow. Adjustable on THERMAL. |
| **TD.4** | Confirm the insulation rule | 25 mm below DN50, 50 mm from DN50 up, per size on the schedule. His rule, so not flagged — but worth confirming it is the one he meant, including that DN50 itself takes 50. |
| **TD.9** | **Confirm the pump-curve cut-off at 200% of duty flow** | Done as asked. Note it changes what you see on a FITTED curve: yours reached zero head at 224% of duty, so the last 24% is now off the chart. |
| **TD.8** | **Put a minus sign in front of any cooling capacity in older files** | Capacity is now signed (− removes heat), so a chiller saved with a positive Q max will refuse to cool and say `Capacity (wrong direction)`. Not migrated automatically because the direction cannot be known before a solve — see KNOWN-ISSUES. Your `20260803-1.json` already uses −51 kW, so it is unaffected. |
| **TD.6** | **Set the VSD minimum speed** (THERMAL ▸ Setpoint control) | Defaults to 25%. Real drives vary — 25–30% is the usual range, but it is a plant decision and the app cannot source it. Sitting on the floor is reported rather than hidden. Minimum valve opening (10%) and the deadband (0.05 K) are on the same panel. |
| **TD.7** | **Judge whether a controlled pump should also be allowed in DESIGN** | It is SIMULATION-only today, because in DESIGN the demands impose the flows and a controller cannot move them. That reasoning is in `ARCHITECTURE.md` §17C — worth confirming it matches how he would expect to use it. |
| **TD.5** | Rule on the Critical Radius tool's temperature inputs | It takes ambient and fluid temperature as asked, but **r_cr = k/h contains no temperature**. They are used for heat loss and surface temperature instead. See 4E.1. |

## 4B-EQ. EQUIPMENT PANELS reworked (v0.11.2)

All of this was driven through the live DOM against `debug/20260803-1.json` and
read back, so the wiring and the text are known good. **Appearance is not** —
the preview browser renders no pixels.

| # | What | Status | Notes |
|---|---|---|---|
| EQ.1 | Heat Exchanger: `Heating/Cooling Load (kW)` with the sign tooltip | ⬜ | Read back live. Tooltip: "Positive value indicates heat entering fluid. Negative value indicates heat removed from fluid." |
| EQ.2 | Source/Sink: `Heating/Cooling Capacity (kW)`, sign tooltip + "Blank = Unlimited" | ⬜ | Read back live on ACCH-01 (−51 kW). |
| EQ.3 | Source/Sink field order: Type, Capacity, % Load, Setpoint, ΔT Max, Temperature Limit | ⬜ | Confirmed in that order on ACCH-01. |
| EQ.4 | `% Load` reads actual duty ÷ capacity | ⬜ | ACCH-01 showed **98.8%** (−50.39 / −51 kW). Shows `—` when the capacity is blank. |
| EQ.5 | ΔT max and T limit tooltips both read "Optional — leave blank for unlimited." | ⬜ | **Wording changed from yours** — you wrote "Option"; I read that as a typo for "Optional". Say if you meant it literally. |
| EQ.6 | The explanation on the Thermal heading is gone | ⬜ | Removed on both types. The sign convention moved onto the two fields it governs. |
| EQ.7 | Design flow / Load / ΔT interrelation | ⬜ | **The one to judge.** Your sequence, driven live: flow 20 L/s → load 50 kW (ΔT auto 0.598 K) → ΔT 15 K → **flow auto-recalculated to 0.7977 L/s**. Marker on all three fields explains it. |
| EQ.8 | Blank capacity / ΔT max / T limit really are unlimited | ✅ | Engine-tested both directions, 9 assertions. |

## 5H. THE LOST SETPOINTS, AND ANNOTATION (v0.16.1)

### The lost setpoints — you were right, and there were two separate things

| # | What | Status | Notes |
|---|---|---|---|
| LS.1 | **The reported error was stale** | ✅ | CHWP-01 reported `err −0.086 K` on a 30 °C setpoint while its sensor read **32.76 °C**. `error` was carried over from the last probe of that device's search; the sweep then settles *other* devices and moves the plant out from under it. It is now re-derived as `measured − target` from the same state the rest of the row is read from, so the three numbers can no longer contradict each other. |
| LS.2 | ...and so was the state | ✅ | It said `on` — holding — while 2.8 K out. If the final measurement is outside the deadband the device is not holding, whatever the search concluded. Now reported `unsettled`, with `driftedAfterSearch` set so the cause is distinguishable from a device that never settled at all. |
| LS.3 | **Why the plant will not ramp up — your point, confirmed** | ⬜ | **Every chiller and tower says `limit: Design ΔT`, and none is near its capacity.** CT-01: 421 kW of 836 (50%), inlet 49.2 → outlet 39.2, i.e. exactly its 10 K Design ΔT. ACCH-01: 269 kW of 800 (34%), 39.2 → 24.2, exactly 15 K. The machines are not out of capacity — they are refusing to work harder because ΔT is treated as a hard clamp on the temperature change **at any flow**. |
| LS.4 | So the AHUs starve | ⬜ | All 14 at 89–91% of rated flow, EWT 31–32.6 °C, ICVs wide open. The loop cannot get cold because the plant will not take more than its design ΔT out of it. |
| LS.5 | **This is a modelling decision I want your ruling on** | ✅ **RULED, done in v0.16.4 — see 5K** | Design ΔT is the ΔT **at design flow**. At part flow the same machine moving the same duty produces a *larger* ΔT — Q = ṁ·Cp·ΔT. Clamping ΔT at any flow therefore caps the duty at `ṁ·Cp·ΔT_design`, which *falls as flow falls*: the model says reducing flow through a chiller reduces its capacity, which is backwards. **My recommendation:** `qMax` should be the capacity limit, and Design ΔT should be a design-point statement used to derive it — not a runtime clamp. That is a change to the physics of every existing model, so I have not made it. Say the word. |

### Annotation batch

| # | What | Status | Notes |
|---|---|---|---|
| A3 | Detail lines snap | ✅ | 15° bearing **and** grid, using the pipe tool's rule: the grid constrains the LENGTH ALONG the bearing, not the position. Snapping position instead pulled a 15° aim to 14.04°, because the nearest grid intersection is almost never on the ray. Verified: four aims at 14.6/46.1/73.1/170.1° land on exactly 15/45/75/165°, each at a 0.5 m multiple of length. Shift frees both. |
| A5 | DETAIL tool shows its settings | ✅ | Palette and line width for the *next* line, since with the tool active there is nothing selected to describe. Changing the tool's colour pushes no undo — undo should take back the line you drew, not the colour you were about to draw in. |
| A6 | `ADD LINK NODE`, and click-to-place | ✅ | Renamed. With nothing selected the button now ARMS: the next click on any control link or ΔP route puts a bend exactly where you point, snapped, then disarms. Selecting the device first still adds one at the longest segment's midpoint. Verified: a 4-point route became 5 with the new bend at the clicked position. |
| A7 | Route handles are easier to grab | ✅ | 14 px → 22 px. They often sit on a pipe that is also asking for the click. |
| A1 | No arrow at zero flow | ✅ | (v0.15.7) |
| A2 | Text box | ⬜ | Still open. The note IS created on the active level with the right text — so this is a drawing or hit-test problem, not a model one. Next. |
| A4 | Details selectable | ⬜ | Wired in the SELECT (arrange) tool; while the DETAIL tool is active a click erases instead, which may be what you hit. Worth retesting now A5 makes the tool's state visible. |

## 5G. PERFORMANCE, AND STATIC SIMULATION (v0.16.0)

| # | What | Status | Notes |
|---|---|---|---|
| S2a | **Selecting no longer re-solves** | ✅ | This was the big one and it was one line of wiring. *Every* selection went through `changed()`, which schedules a solve AND a save — so clicking a pipe on your DC model queued a forty-second solve for an answer that cannot have changed. Selection now has its own path: panel, levels, redraw, stop. |
| S4 | **STATIC / DYNAMIC** | ⬜ | In the Simulate ribbon, Static default. Locks anything that would change the answer — drawing, dragging pipes/devices/nodes, isolating, reversing, deleting. Still free: every property readout, selection, control-link routes, DETAIL and TEXT annotation, and moving labels. Refusals say so rather than silently ignoring the gesture. The panel greys its editable fields to match. |
| S2b | **The hydraulic solve is ~1.5× faster** | ✅ | 57 s → 39 s on the DC model, *identical answers* (all 1681 assertions pass). Every GGA iteration was building a dense 250×250 matrix and running O(n³) Gaussian elimination — but that matrix is a graph Laplacian: symmetric, positive-definite, ~4 non-zeros per row. It now factorises as a skyline LDLᵀ and falls back to the general solve if a pivot says it is not SPD after all. |
| S3 | Progress bar | ⚠️ | **Partial, and I want to be straight about it.** The bar appears before the solve starts, so a long wait is explained rather than looking like a hung page — but the solve itself is still one uninterruptible block, so the page is still unresponsive while it runs. See below. |
| S3b | Why not fully non-blocking | ⬜ | A Web Worker is the obvious answer and is unavailable: the app must run from `file://` and Chrome refuses to construct a Worker from a null origin. Slicing at the device boundary was tried and backed out — one device's search is ~15 full solves, so it still blocked for seconds and each slice re-ran the non-control work. The atom that works is one `evaluate()`, which needs the control loop turned into a generator. That is next, and I would rather do it with you able to test. |
| S3c | A trap worth knowing | ✅ | The first driver gated its slices on `requestAnimationFrame`, which **does not fire in a hidden or backgrounded tab** — a solve started and then never continued. Everything now runs off `setTimeout`. |

## 5F. THE CHWPs, AND A TAG REPAIR (v0.15.9)

| # | What | Status | Notes |
|---|---|---|---|
| CH.1 | **CHWP-01..04 now hold 30 °C** | ✅ | You were right that they should not be fighting — they were not. Sweeps 1–5 settled all four to within 0.02 K. **Sweep 6 ran out of the solve budget**, and a truncated search left each one sitting at the probe position, which is the actuator's FLOOR — a chiller at quarter flow does not hold its leaving temperature, so the errors came back as 669, 1317 and 1629 K, all four were judged unsettled, and then parked at 100%. A search that cannot finish is now a **no-op**: the device keeps the position its last complete sweep gave it. |
| CH.2 | The budget scales with the work | ✅ | Was capped at 400 — chosen when a big model had three controllers. Now 120 per controller. `CONTROL_BUDGET` says so if it still bites. |
| CH.3 | What is left is real | ⬜ | `SETPOINT_LOST` on all 14 AHUs: their **integrated valves** are at full travel and still off setpoint, with TS-1/2/4 reading ~32.8 °C against 30. That is a heat-balance statement, not a control failure — the lineups cannot deliver what the hall is rejecting at these speeds. Worth checking against your intent. |
| TG.1 | **Tag corruption — still not reproduced** | ⚠️ | **Read this one.** I have not found the route. The v0.15.8 guards demonstrably work (I drove the detached-input path and the write was refused), yet `20260808-DC-broken` was saved by v0.15.8 with `CHWP-04PMP-1PMP-1PMP-1PMP-1PMP-1`. Every corrupted value is `<a real tag><one or more freshly generated ones>`. |
| TG.2 | So it is attacked from the other end | ✅ | A tag box now **refuses** to commit a value of that shape; a second lock means it can only write to something still selected; `TAG_MANGLED` reports any it finds on every solve; and **REPAIR** on the FILE group strips the suffix. Verified on your file: `CHWP-04PMP-1PMP-1PMP-1PMP-1PMP-1` → `CHWP-04`. |
| TG.3 | One it cannot fully repair | ⬜ | `CHWP-0AHU-15AHU-152` → `CHWP-0`. The head really is `CHWP-0` — the repair can only strip what was appended, it cannot know you meant `CHWP-02`. Please rename that one by hand. |
| SY.1 | **Sync drawn on selection** | ⬜ | Select a master and a dash-dot line goes out to each follower; select a follower and one goes back to the master, with an open arrowhead at the follower so the direction is on the drawing. Straight, and only while selected — a sync is a relationship you check and move on from, and eight pumps' worth of permanent leaders would bury the pipework. |

## 5D. SELECTION, PICKING AND TWO SLIDERS (v0.15.7)

| # | What | Status | Notes |
|---|---|---|---|
| Q5 | **Shift-click to build a selection** | ✅ | Adds, and shift-clicking something already in the set removes it. Verified 1 → 2 → back to 1, with the bulk panel appearing. A shift-click never starts a DRAG — moving geometry during what reads as a selection would be its own bug. |
| C1 | **CHWP-1 unpickable for a control link** | ✅ | Picking a controller took `deviceAt \|\| pipeAt`, and a pump sits IN a pipe with more pipe running away either side — so a click a few pixels off the symbol found the plain pipe, `canControl` said no, and you were told to "click a pump" while pointing at one. `controllableAt` searches devices first at a generous radius and **can only ever return something linkable** — verified over 45 probes across the model, zero unlinkable results. |
| C7 | **Manual VFD slider** | ✅ | Appears as its own Speed section only when the pump has no control link — with a link the position is an output and a slider would be a lie. Verified: absent when linked, present the moment the link is cleared. |
| A1 | No arrow at zero flow | ⬜ | The old threshold was 1e-9 m³/s — a numerical zero, not a hydraulic one, so a shut branch settling at 1e-7 still drew an arrow. Now `Q_MIN`, the same threshold the solver uses to decide a link carries water, so the drawing and the calculation agree about what "no flow" means. |
| E4 | Grey `Auto` in an unlimited capacity box | ✅ | Your ruling. An empty box read as a field nobody had filled in rather than as a decision. |
| UI.6 · DB.5 | Closed on your ruling | ✅ | Max/Min indicator as-is; 0.2% deadband confirmed. |

## 5C. EQUIPMENT CONTROLS, AND FOUR SMALL ONES (v0.15.6)

| # | What | Status | Notes |
|---|---|---|---|
| EQ.1 | **Integrated control valve** | ✅ | A globe valve built into the machine, holding that machine's own Design ΔT — no valve, sensor or link to draw. It is a real resistance in series with the coil (verified: 12 Kv wide open drops the branch flow; at 10% travel its resistance is 9.2e9 against the coil's 5.1e5 and the branch all but closes) and a real actuator (appears in the control report holding its own equipment on a ΔT). |
| EQ.2 | **Capacity override** | ✅ | 0–100% on the stated duty. Verified: 40% gives 20 kW from a 50 kW coil, 0% gives nothing, and **the design figure is untouched** — the machine is still on the schedule at full duty. Remove the override and it is back to 50 kW. |
| EQ.3 | Temperature limit reads from the left | ✅ | |
| C8 | **Multiple devices on one sensor** | ✅ | Your wording, verbatim, as a DEFECT. The gang stays underneath it so the answer is never arbitrary — `detail` says so — but the message tells you to link one and sync the rest. |
| C5 | dP setpoint tag said Temperature | ✅ | The drawing's `SP` label fell through to °C for both differential modes. Same fall-through that put "200000.0 °C" on a pump switch in v0.15.1; this was the other place it hid. |
| C6 | Sensor showed its temperature twice | ✅ | "35.4 → 35.4 °C" is one number written twice. An instrument now shows one value; anything that actually does something thermal still shows both, because there they differ. |
| C2 | `Control Link` → `Add Control` | ✅ | |
| C3 | dP button places a temperature sensor | ⬜ | **Could not reproduce** — all five buttons place their own kind in this build. But see C1: clicking the middle of a 25 m pipe hit-tested onto an adjacent **1 m device pipe**, which would place a sensor somewhere you did not mean. I think that is what you saw, and it is next. |

## 5B. PUMPS IN PARALLEL (v0.15.5)

| # | What | Status | Notes |
|---|---|---|---|
| PP.1 | **Four PWPs settle together** | ✅ | On `-DC-broken` they now all run **67.5%, ~8.9 L/s each**, holding the 250 kPa differential to within 225 Pa. Before: 100 / 85.8 / 25 / 25, with the last two on their floor carrying **no flow** — back-pressured shut by the first two. `SETPOINT_LOST` is gone. |
| PP.2 | Why grouping, not self-modulation | ⬜ | **Worth your view.** N loops on one sensor is degenerate — any split that gives the right reading satisfies all of them, so "self-modulating" can only ever land somewhere arbitrary. Real plant doesn't do it either: parallel pumps on a common header take ONE speed command. Your own description — fluctuates for hours, then settles at roughly equal % — is independent loops fighting, then being commanded equal. This goes straight to that answer. |
| PP.3 | Staging | ⬜ | Grouping is on *same target + same setpoint*. To stage a lag set, give it its own setpoint — that is the natural way to say it and it needs no new concept. |
| PP.4 | It says so | ⬜ | `CONTROL_GANGED` names every member, and the pump panel gains a "Modulating with" row. A behaviour this consequential should never have to be inferred. |
| PP.5 | **Dangling control links** | ✅ | Found while tracing: in `20260807-DC.json` all four PWPs point at `P455`, which is **not in the model** — the sensor was deleted and the links stayed. They were silently uncontrolled at 100%, with nothing said. `CONTROL_TARGET_GONE` now reports it. Part of your "controls get dropped". |
| PP.6 | Solve time | ⬜ | ~30 s on the DC model. Ganging cut 4 searches to 1, but this model is 275 pipes with 5 independent loops. The loading bar and Static mode you asked for are the right answers and are still on the list. |

## 5A. THE TWO CRITICAL BUGS (v0.15.4)

| # | What | Status | Notes |
|---|---|---|---|
| CR.1 | **Controls section disappearing** | ✅ | A readout helper in the pump's Actual section did not `return` its row, so hanging an info marker off it threw — from inside `renderProperties`, HALF WAY THROUGH. Details and Design were already appended; Control and Display never were. The model never lost anything; the panel stopped drawing. It fires when a pump carries a speed below 1 and the mode is DESIGN — i.e. on every modulating pump the moment you leave SIMULATE, which is exactly when you saw it. |
| CR.2 | ...and it took the rest of `changed()` with it | ✅ | The exception escaped into `changed()`, so the autosave, the clean-snapshot bookkeeping and the solve schedule were all skipped whenever it fired. That is the other half of "intermittently dropped or reset". |
| CR.3 | The panel now fails safe | ✅ | Wrapped in a guard: on any future render error it says so and says the model is untouched, instead of silently truncating. The shape of that failure was worse than the failure — it accuses the model of losing data it still holds. |
| CR.4 | **Silent tag corruption** | ✅ | Two causes, both fixed. (a) A focused input is detached when the panel rebuilds, and the browser fires its `change` afterwards — the closure then wrote to the device that was no longer selected, from a box already replaced on screen. Verified: an edit begun on P350 was landing on P350 *after* the selection had moved to P379. Every field handler is now stamped with its render and no-ops if that render is gone. (b) A nameless text input joins the browser's autofill pool, and every tag box in this app looks identical to it — which is where `CHWP-04PMP-1` and `PWP-04MP-4MP-4…` came from. The app was never concatenating anything; the browser was filling a box it had no business in. |
| CR.5 | Check your two saved files | ⬜ | `20260807-DC.json` and `-DC-broken.json` BOTH already carry the mangled tags — the corruption predates them, so the fix cannot repair them. Three to correct by hand: `P298` → PWP-04, `P379` → CHWP-02, `P413` → CHWP-04. |

## 4Z. ANNOTATION, ROUTES AND PRINTING (v0.15.3)

| # | What | Status | Notes |
|---|---|---|---|
| AN.1 | Globe valves read CV | ✅ | The FITTINGS table keeps `GLV` — there it really is "globe valve, open" as a K factor, which is a different statement. |
| AN.2 | **Temperature discontinuities** | ✅ | Your fix, implemented as described. On `20260807-1` the bypass is now a uniform 30 °C, the chiller leg a uniform 15 °C and the run below the mix a uniform 20.08 °C — three flat colours meeting at the tee instead of three ramps into it. |
| AN.3 | Control link nodes drag freely | ⬜ | Grab any bend. The first drag converts the Z into waypoints, starting from exactly what is on screen so it does not jump. Grid-snapped; Shift for free placement. |
| AN.4 | LINK NODE adds a bend | ⬜ | Select the pump, valve or sensor first, then press it. It goes in the middle of the longest segment — the one with room. |
| AN.5 | **DETAIL** | ⬜ | Click to place vertices, Esc finishes, click an existing line to erase it. Colour and width in Properties. Nothing in the calculation ever reads them — pinned by a test that solves before and after adding a 100 m line across the model. |
| AN.6 | **TEXT BOX** | ⬜ | Click to place, click again to edit, drag to move. Multi-line. |
| AN.7 | Printing as-shown | ✅ | Device tags, value boxes, control links, ΔP routes, detail lines and notes all reach the page now. Verified: 6 dashed links + 1 ΔP route + the note + PMP-01's tag and flow; turn LINKS off on the ribbon and both link kinds leave the page while the annotation stays. |
| AN.8 | Old files still take annotations | ✅ | A file written before details existed had no id counter for them, so every one came out `DNaN` — same id, undeletable. Worth a spot-check on one of your older saves. |

## 4Y. THE ECONOMIZER MODEL, AND FIVE UI ITEMS (v0.15.2)

| # | What | Status | Notes |
|---|---|---|---|
| EC.1 | **`20260807-1` converges** | ✅ | One cause behind all three symptoms. The control search is a DESCENT from full travel; a later sweep starts where the last finished, so a device that needs to OPEN had nowhere to look, reported `at-max` mid-travel, and got parked at 100%. Sweep 1 had already found a good answer and sweep 2 threw it away. |
| EC.2 | The plant now does what you described | ✅ | CT-01 35.04 → 30.00 · ACCH-1 30.00 → 15.00 (ΔT-limited) · TS-2 20.08 · PMP-01 91.9% holding 200.8 kPa against 200 · PMP-02 48.8% · all four coils within 0.6% of rated flow · a third of the flow bypassing, which is exactly what 30/15 → 20 mixing requires. Frozen as `test/fixtures/economizer-trim.pnet.json`. |
| EC.3 | The one remaining warning | ⬜ | `EQUIP_LIMITED` on ACCH-1: it is on its 15 K design ΔT, so from 30 °C it can only reach 15 °C. That is your design, not a fault — but check the ΔT is what you meant. |
| UI.11 | Heating/Cooling toggles on an empty box | ✅ | Your bug. A signed number cannot express "cooling, magnitude not yet decided", so the switch had nothing to write. The direction is now held as a UI intent until a number exists, then the stored sign takes over. |
| UI.12 | Red heating, blue cooling | ✅ | The one place in this app where red is not a fault. |
| UI.13 | Units in the label, box left-aligned | ✅ | "Capacity (kW)", and the entry reads from the left like every other field. |
| UI.14 | Clicking the status chip highlights | ✅ | It set `chip.onclick` to open CALCULATION in the DEFECTS branch and never cleared it, so once a model had raised a defect ONCE the chip jumped to the sheet for the rest of the session. Removed — it highlights at every severity now. |
| UI.15 | **Blank capacity = unlimited, not "auto"** | ⬜ | **Your question.** There is no auto-balance mode. For a SOURCE/SINK, blank capacity already gives you most of what you asked for: it modulates freely to hold its leaving temperature, so it absorbs whatever the loop throws at it. What blank does NOT do is size itself against the load and report a duty you could put on a schedule. Say if you want that. |

## 4X. UI PASS, PANELS AND THE RIBBON (v0.15.1)

| # | What | Status | Notes |
|---|---|---|---|
| UX.1 | The ribbon is two rows | ✅ | **My bug, and an instructive one:** `display:flex` on `.tool-set` beats the UA's `[hidden] { display:none }`, so all four modes' tools rendered at once — what you photographed. Fixed, and split into chrome-on-top / tools-underneath, since DESIGN's tools alone are 1374 px and one row wrapped anyway. Verified single-line at 1440 and 1920. |
| UX.2 | `res.actual` gone from DESIGN | ✅ | Your call. It turned out DESIGN was the only place it was ever *read* — SIMULATION always preferred the simulation report — so it is gone entirely rather than moved. The error box now says a negative pressure is the head that is MISSING, and points at SIMULATE for what would really be delivered. |
| UX.3 | Equipment panel | ⬜ | Details · Design · Actual · Display, your list. Heat source/sink and heat exchanger get their own Design fields; "Other" (adiabatic) drops to Flow / Pressure drop / K factor. |
| UX.4 | **Heating/Cooling switch** | ✅ | Replaces the typed minus sign. Verified: toggling 50 kW heating gives −50 kW stored and reads "Cooling"; typing `-12` moves the switch by itself. A typed sign always wins. |
| UX.5 | Cooling loads read positive | ✅ | "Cooling load 50.00 kW" in the panel, "Cool 50.0 kW" on the drawing. Display only — stored, calculated and exported values keep the sign. |
| UX.6 | Temperature limit Max/Min | ⬜ | Shown beside the value, following the load direction: a heating coil is limited by a maximum, a cooling coil by a minimum. It is an indicator, not a second input — the engine already works out which side binds, and two ways of saying it could disagree. **Tell me if you wanted it settable.** |
| UX.7 | Control valve vs isolation valve | ⬜ | Two panels now. Isolation gets Open/Closed as its Status and no position slider — a gate valve is not a regulating device. **One judgement call:** an existing gate valve left part-open keeps its slider, so nothing drawn before this loses a setting silently. |
| UX.8 | Check valve | ⬜ | Third shape: Direction, Kv, no status and no position. |
| UX.9 | % Load and Position % on the drawing | ⬜ | Both were offered as toggles and neither was drawn. On a balanced circuit the valve positions are the answer, so they are the thing you want on a plot. |

## 4W. UI PASS, FIRST STAGE (v0.15.0)

| # | What | Status | Notes |
|---|---|---|---|
| UI.1 | Four modes | ✅ | DESIGN / CONTROL / SIMULATE / ANNOTATION, each with its own tools. Verified: each shows only its own set, and picking a tool from anywhere pulls the ribbon to that tool's mode. |
| UI.2 | Only DESIGN and SIMULATE touch the calculation | ✅ | **Deliberate, and worth checking you agree.** CONTROL and ANNOTATION leave `calcMode` alone, so you can go SIMULATE → CONTROL and tune a link with the valve positions still on screen. Coupling them would blank every position at the moment you went to look. |
| UI.3 | Tools grouped by what the thing IS | ⬜ | Edit · Pipe · Hydraulic · Thermal · Valves, named on the ribbon. |
| UI.4 | One button per device type | ⬜ | The valve dropdown is gone and equipment type is choosable at placement: HEAT SOURCE/SINK and HEAT EXCHANGER get the right defaults, OTHER places an adiabatic item tagged STR-n. |
| UI.5 | CONTROL LINK is a tool | ⬜ | Click the pump or control valve, then its target. The panel button still works and is now "Link sensor". |
| UI.6 | Copy/Paste moved out of FILE | ⬜ | Into DESIGN ▸ Edit, beside the selection they act on. |
| UI.7 | Property sections collapse and stay collapsed | ✅ | Verified across a re-render and a re-selection; stored in localStorage per section NAME, so closing Display closes it for every device. |
| UI.8 | The pump panel in the new structure | ✅ | Details · Design · Actual · Control · Display, exactly your list. Renames done: Online/Offline, Input/Show/Clear, Link sensor, Remove control, Reset link. |
| UI.9 | Design duty shown but not editable on Auto/Curve | ⬜ | Dashed, greyed, unfocusable. Your instruction — and it stops the panel changing height when the dropdown moves. |
| DP.4 | The second dP/dT tapping drags along its pipe | ✅ | Your note. Clamped to the run: verified at t=0, t=1, and dragged well off the pipe. It moves the DRAWING only — the reading is still taken at the pipe's inlet node, since a pipe has one pressure at each end and no profile along it to read from. |
| UI.10 | Overlapping drag handles pick the nearest | ✅ | Found while testing DP.4: a tapping under a control-link bend resolved by draw order, which is not something you can see. Nearest centre now. |

**NOT in this stage, and staged next:** the Equipment, Adiabatic, Isolation
Valve and Control Valve panels (the framework is in — they are mechanical now),
and the two new drawing tools, Detail and Text Box. See the reply for why those
two are their own piece of work.

## 4V. THE ΔP ROUTE, REBUILT (v0.14.9)

| # | What | Status | Notes |
|---|---|---|---|
| DR.1 | One C/Z between the two tappings | ⬜ | Your design. On `20260805-5` it comes out as the C you drew: out 1 m, along 4.44 m, back 1 m, with ΔP at the geometric centre of the middle segment. An open square at **each** tapping — both ends are measurement points, unlike the control link's one-ended ring. |
| DR.2 | Every vertex drags | ⬜ | The bubble and both bends are handles. They all move the same thing, because a three-segment orthogonal path between two **fixed** points has exactly one degree of freedom — move one bend and the other has to follow. Verified: bubble → mid 65.59, then a bend → mid 57.04. |
| DR.3 | It cannot be flipped onto itself | ⬜ | Two tappings on the same riser have no horizontal middle segment to offer, so a hard sideways drag used to collapse the route onto the pipe and straight back. It now just keeps sliding along the axis it has. |
| DR.4 | **Reset route** | ⬜ | Your request. On both the sensor panel and any pump/valve with a control link. Verified: slid the route 30 m off, reset put it back to 1 m. |
| DR.5 | A ΔP whose reference is on another level | ⬜ | Falls back to the plain bubble-and-stem, since a route to another floor would cut across pipework it has nothing to do with. Worth a look — it is the one path the new code does not take. |
| DR.6 | Setpoint switches show the right units | ✅ | Found while checking DR.4: a pump holding 200 kPa had its own switch reading **"Differential pressure 200000.0 °C"**. The formatter only knew flow, ΔT and °C, and the three modes the sensor added all fell through to °C. Now 200.0 kPa. |

## 4U. ANGLE SNAP AND THE ΔP LEADERS (v0.14.8)

| # | What | Status | Notes |
|---|---|---|---|
| AS.1 | 15° snapping works again | ✅ | Nothing was wrong with `angleSnap` — untouched since v0.4.0. `shiftDown` was set on keydown and cleared on keyup, and **a keyup that arrives somewhere else never clears it**. Hold Shift, Alt+Tab away (Shift+Alt+Tab *is* the reverse app switch), and it stays suppressed for the rest of the session. Now read off the pointer event, so one mouse movement fixes it. Verified: forced the stuck state, drew three pipes, got exact 15° multiples. |
| AS.2 | Shift still disables it while genuinely held | ✅ | Verified in the same run — held reads true, released reads false. |
| AS.3 | Connecting still beats the bearing | ⬜ | Unchanged and deliberate: a node or pipe within the snap radius wins over the 15° constraint, so a run can still land exactly on existing work. One of the three test pipes came out at −30.18° for that reason. |
| DP.1 | The ΔP stem is orthogonal | ⬜ | It was still a diagonal — I made the *reference* line orthogonal in v0.14.6 and left the leader from the pipe to the bubble alone, which only shows once the bubble is dragged. Both are Z routes now. |
| DP.2 | The reference line no longer retraces the stem | ⬜ | On `20260805-5` it left the bubble going back over its own stem and then ran parallel to the sensor's pipe 9 px off it — the mess in your screenshot. It now leaves perpendicular when the far tapping is behind the bubble. Verified over five drag positions: no diagonals, no retracing, no zero-length segments. |
| DP.3 | Drag the bubble to the far side of the pipe | ⬜ | The case that broke the first fix: the nominal normal points one way and the dragged leader arrives from the other. Worth a look in all four quadrants. |

## 4T. PUMP SIZING AND SOURCE MIXING (v0.14.7)

| # | What | Status | Notes |
|---|---|---|---|
| PS.1 | An auto-sized pump goes straight to SIMULATE | ✅ | Draw a pump, leave it alone, switch mode. The SIZER generates the curve now, so the panel no longer has to be visited. Verified with a pump created exactly as the canvas creates it: generated curve after one DESIGN solve, gate passes. |
| PS.2 | Manual values survive | ✅ | Typed 9.0 L/s / 31 m, solved, isolated the pump, put it back, solved again — unchanged throughout, and it returned as `fixed` rather than `auto`. |
| PS.3 | A pasted manufacturer curve is untouched | ⬜ | Neither the sizer nor the panel regenerates a curve marked `fitted`. |
| PS.4 | **A pump the sizer puts at ZERO head** | ⬜ | **Known gap, your call.** If the source alone satisfies every outflow, auto sizing lands on 0 m; there is no duty to build a curve from, and SIMULATE still says "Pump curve required" — which is not a useful way to say "this pump has nothing to do". Say the word and it gets its own message. |
| SM.1 | A source on a main MIXES | ⬜ | Your report. 1.76 L/s of 60 °C meeting 6.24 L/s of 10 °C make-up gives 20.99 °C; it used to read a flat 10 °C. |
| SM.2 | A source on a branch is unchanged | ⬜ | Your workaround has to keep working: every drop leaving the node came from the source, so the node sits at the source temperature exactly. |
| SM.3 | **A fill absorbs nothing, wherever it is drawn** | ⬜ | **This is the answer to TH.8.** A dead-leg fill and an in-line one on the same sealed circuit now report the SAME 20 kW shortfall, against a pinned datum rather than against the fill. Your expansion-tank objection was right — the tank was never absorbing anything, the pin was. |
| SM.4 | THERMAL_DATUM may appear where it did not before | ⬜ | It is now raised when the solve genuinely cannot pick a temperature level, and NOT raised when a chiller setpoint already sets one. On one test model the old pin was overriding a chiller holding 6 °C and booking the 83.6 kW difference as absorbed heat. Worth watching for on a model that used to be quiet. |

## 4S. DEADBAND, ROUTES AND ΔP SYMBOLS (v0.14.5)

| # | What | Status | Notes |
|---|---|---|---|
| DB.1 | Valves land between 59% and 100% | ✅ | `20260805-5`: 59 / 67 / 100 / 100%, no errors. The two at 100% are the furthest branches and are genuinely within tolerance wide open — which is what your dP-controlled pump is for. |
| DB.2 | ΔP / ΔT bubble says so | ⬜ | Was showing `T`. Two-character labels use a smaller font to fit the bubble. |
| DB.3 | The second probed pipe is drawn | ⬜ | Dotted line from the bubble to the reference pipe with an open square at the far tapping — a different mark from the control link's ring, because it means a different thing. Only when both are on the level being shown. |
| DB.4 | Control links drag in all four directions | ⬜ | Pull across the current segment and the route flips axis (1.6× hysteresis so it does not chatter). Verified live: axis h → v, mid 44.88 → 8.53. |
| DB.5 | **Is 0.2% the right flow deadband?** | ⬜ | **Your call.** Tighter than any flow meter and comfortably inside what 1% of valve travel resolves — but it is what decides whether a nearly-right branch gets throttled at all. |
| DB.6 | The reference line is orthogonal | ⬜ | Right-angle Z like the control link, not the diagonal you photographed. Leaves along the stem so it cannot double back across the sensor's own pipe. Verified: H → V → H, ending on the square. |
| DB.7 | DXF: ΔP/ΔT bubble and its reference line | ⬜ | Same defect was in the export — it said `T` too, and drew no reference line. Now `dP`/`dT` and the same orthogonal route, solid rather than dotted (R12 has no dotted linetype without an LTYPE table). Still unopened in real CAD — see DX.1. |

## 4R. PARALLEL BRANCH BALANCING (v0.14.4)

| # | What | Status | Notes |
|---|---|---|---|
| BAL.1 | Four valves balance four branches | ✅ | `20260805-4`: all four AHUs within 1% of rated flow, valves at 36–37%. Was three valves stuck at 100% with branches 17% over. |
| BAL.2 | The pump's SETPOINT_LOST is correct and now says why | ⬜ | "…PMP-1 → ACCH-1, **limited by Design ΔT** — at full travel and still off setpoint." The chiller's 15 K Design ΔT stops it reaching 7.5 °C; no pump speed fixes that. Toggle Design ΔT as a fallback on the pump if you want it to chase that instead. |
| BAL.3 | `Max control solves` on THERMAL | ⬜ | 0 = auto (40 + 30 per controlled device, capped 400). One solve is ~3.5 ms on a 36-pipe model; the whole controlled solve took ~200 ms over 50 solves. Raise it for an awkward model, lower it if a big model feels sluggish while drawing. |
| BAL.4 | **Does 36–37% look right for those valves?** | ⬜ | **The engineering judgement.** Equal-percentage characteristic, four equal branches off a common header. |

## 4Q. THERMAL section on the CALCULATION sheet (v0.14.1)

| # | What | Status | Notes |
|---|---|---|---|
| TH.1 | Heat balance, leading on the residual | ⬜ | Verified live on the stacked-riser example: residual −0.000 kW, "balanced". |
| TH.2 | **The source/fill term**, now with a warning | ⬜ | **Worth your eye.** A source holds its temperature whatever arrives, so it is a duty. On the example it reads "Absorbed at the source −6.30 kW — the plant is short by this much". That is a real finding about the example, not a rounding error. |
| TH.3 | Equipment duty table | ⬜ | Tag, type, flow, in/out, ΔT, Q, and what limited it. |
| TH.4 | Pipework heat gain / loss | ⬜ | Every pipe: length, insulation, U′, in/out, Q in watts. Totals for gain, loss, net, and **net as a % of equipment duty** — the number you actually use it for. On the example: +0.178 kW, 2.9%. |
| TH.5 | Every pipe is listed, including zero rows | ⬜ | Deliberate: a zero row on a well-insulated main is a result, and leaving it out makes the total impossible to check by adding up. Say if you'd rather they were suppressed. |
| TH.6 | The section is collapsed by default | ⬜ | So it does not print unless you open it, per the existing convention. |
| **TH.8** | **⚑ HEAT ABSORPTION AT A SOURCE — RESOLVED in v0.14.7, see SM.3** | ✅ | **FLAGGED FOR HIS EYE, 2026-08-05. Do not treat as settled.** His objection: an expansion tank tees off the return with NO FLOW through it, can only lose a trickle by conduction at the tee, and that is normally disregarded. So absent a runaway there should be little or no absorption. See the note below. **The verdict, 2026-08-06: he was right and the app was not.** A source no longer absorbs anything at all — it mixes its own make-up into whatever is flowing past — so a fill absorbs nothing wherever it is drawn, and the shortfall shows against a pinned datum instead. The dead-leg-versus-in-line distinction this row was written around has gone: it was never physics, it was where the pin happened to land. |
| TH.7 | `HEAT_IMBALANCE` warning (v0.14.2) | ⬜ | Fires above 2% of circulating duty (adjustable, HYDRAULIC ▸ Heat balance tolerance). On the stacked-riser example: "6.3 kW is being removed at the source to hold its stated temperature… the cooling plant is short by that much, or the stated temperature is wrong." |

### TH.8 — what the experiment showed

Michael's objection is correct, and it turned out to be about WHERE the fill is
drawn rather than about the thermal model.

The same sealed circuit — 60 kW coil, 40 kW chiller, adiabatic pipework — run
twice, differing only in where the fill connects:

| Fill connection | Absorbed at source | Circuit temperatures | Reported |
|---|---|---|---|
| **In the return line** (every drop passes through it) | −20.0 kW | 11.0 – 14.6 °C | `HEAT_IMBALANCE` |
| **On a dead-leg tee** (no flow through it) | **0.0 kW** | flat 11 °C | `THERMAL_SINGULAR` |

So:

* **A properly drawn expansion/fill connection absorbs nothing**, exactly as he
  says. A source only imposes its temperature on water that flows THROUGH it,
  and no water flows through a dead leg.
* **The 6.3 kW in `examples/stacked-riser.pnet.json` was my example's fault.** I
  drew the fill in the return line, where every drop passes through it — which
  is a mains connection with full flow, not an expansion tank. The example has
  been corrected.
* **`HEAT_IMBALANCE` is therefore as much a DRAWING warning as a plant one.**
  "Your fill is in the flow path" is the commonest way to trigger it.

**And it exposed a real defect, now fixed.** With the fill on a dead leg and the
plant short, the circuit is genuinely indeterminate — 20 kW into a sealed
adiabatic loop with nothing to absorb it has no steady state. The solve was
correctly detecting that (`THERMAL_SINGULAR`) but reporting a **flat 11 °C**,
which is just the seed, while `converged` stayed **true**. Meaningless numbers
presented as an answer: the exact silent failure this project keeps having to
stamp out. `THERMAL_SINGULAR` now clears `converged` like every other
"these numbers describe nothing" condition.

**Still for Michael:** whether `HEAT_IMBALANCE`'s threshold and wording are
right once he has seen it on a job, and whether a source in a flow path should
be called out on its own rather than only through its thermal consequence.

## 4P. DXF EXPORT and the message UX pass (v0.14.0)

| # | What | Status | Notes |
|---|---|---|---|
| DX.1 | **Does the DXF open in your CAD?** | ⬜ | **The one that matters, and I cannot check it.** R12 ASCII, model space in metres at true size, real Z. Try `examples/stacked-riser.pnet.json` → DXF: risers should come out as vertical lines, and the 14→7 m one skips Level 3. |
| DX.2 | Layers | ⬜ | One per level and per kind — `FPC-Level_1-PIPE`, `FPC-RISERS-RISER`, `…-SYMBOL`, `…-TAG`, `…-NODE`. Freeze what you don't want. |
| DX.3 | Symbol and text sizes | ⬜ | Text 0.25 m, symbols 0.25 m radius, both in model space. Guessed for 1:50 — tell me what they should be. |
| DX.4 | Non-ASCII in tags | ⬜ | Δ → `d`, ° → `deg`, → → `-`. R12 has no UTF-8 guarantee. |
| UX.1 | `VALVE_OVERSIZED` replaces `VALVE_AUTHORITY` | ⬜ | The two "authority" messages meant unrelated things. |
| UX.2 | `CONTROL_HUNTING` split out | ⬜ | "These devices are fighting" is not "this device cannot get there". |
| UX.3 | **DEFECT severity** | ⬜ | **Worth your eye.** The chip now reads e.g. "1 model defect, 2 warnings" and the sheet groups them. Verified live. Membership is `DEFECT_CODES` in network.js — say if anything is in the wrong bucket. |
| UX.4 | Tags instead of ids | ⬜ | e.g. "Node ORPH-1 has no pipe connected to it. Draw a pipe to it, or delete it." |
| UX.5 | Eight more messages say what to do | ⬜ | Velocity, friction rate, zero length, orphan, island, coincident nodes, riser open end, control unsettled. |

## 4N. v0.13.0 — the rest of the list

| # | What | Status | Notes |
|---|---|---|---|
| N.1 | Dead legs hold the water's temperature | ✅ | Engine-tested. Also answers your Simulate-mode item. `Source Water Temperature` no longer leaks into dead ends. |
| N.2 | Risers stack, and skip floors | ⬜ | New `examples/stacked-riser.pnet.json`: four storeys, coils on L1/L2/L4, **Level 3 skipped** — the top riser span is 7.00 m against 3.50 m for the others. Solves clean. |
| N.3 | `RISER_OPEN_END` | ⬜ | Dashed amber ring and "top/bottom open" on the level it happens on, plus a warning. |
| N.4 | Pump Sizing: Auto / Manual / Curve | ⬜ | **The one to judge.** Verified live: switching to Manual exposed Design flow/pressure and generated a curve (6.89 L/s @ 17.49 m, `source: 'generated'`). Shape is shutoff 140%, duty, 65% at 150% flow — the same shape the TOOLS generator uses. Say if you want a different one. |
| N.5 | TOOLS link removed from the pump panel | ⬜ | Generator still on the TOOLS tab. |
| N.6 | Pressure sensor | ⬜ | Reads its own inlet. Glyph letter `P`. |
| N.7 | dP / dT sensors | ⬜ | **Differs from what you described.** You asked for a floating box probing two pipes; I built it as a *reference pipe* on the ordinary sensor — pick the second pipe on the drawing. Same measurement, reuses the sensor's drawing, panel and control wiring. Overrule me if you want the free-standing box. |
| N.8 | Setpoint deficit in red on a Source/Sink | ⬜ | Shows the gap and what limited it, only when it misses by more than 0.05 K. |
| N.9 | Copy/paste properties in FILE | ⬜ | ⧉ and ⎀ buttons. Verified live. Geometry, id, tag and control links never travel; device properties only land on the same kind of device. |
| N.10 | Heating/Cooling Load on the drawing | ⬜ | New "Heating/Cooling Load" toggle in Show on drawing. |
| N.11 | Sensor Setpoint toggle | ⬜ | Was source/sink only, so it did nothing on a sensor. |
| N.12 | Control link steps 1 m off the pipe | ⬜ | Only the DEFAULT route, and only when the two ends are level — a dragged bend stays put. |

**Your three models, rechecked** — `20260805-3` now solves clean: all four AHUs at 0.80 L/s and 15 K, chiller at 200 kW, valves modulating 61/100/100/100%. `-1` still reports `NO_CONVERGE` (logged in KNOWN-ISSUES — two pumps an order of magnitude apart, imbalance 8.5e-6, essentially converged but not certified). `-2` has a pump curve of 0.5 m, which is why nothing flows; the new sizing modes prevent that being generated.

## 4M. THE BLOCKER and the follow-ups (v0.12.5 / v0.12.6)

| # | What | Status | Notes |
|---|---|---|---|
| BK.1 | A cooling load is typeable | ✅ | The sign is now TYPED when you type it and CARRIED when it is recomputed. Both your models were bad only because their chillers had positive capacities. |
| BK.2 | Blank = unlimited on a Source/Sink | ✅ | Was writing the wrong field entirely. |
| BK.3 | Control valve is equal percentage | ⬜ | Your table. On the mixing rig the valve now controls at 69% of travel instead of 33% — say whether that reads better on a real job. |
| BK.4 | "Source Water Temperature" | ⬜ | Renamed on THERMAL. It is what a SOURCE holds when it states no temperature of its own, plus the pin for a fully adiabatic circuit — not a setpoint. |
| BK.5 | Adiabatic equipment type | ⬜ | Filter/strainer: keeps its ΔP, no thermal side, no control options. Verified: 687 kPa drop retained, ΔT exactly 0, `canBeControlled` false. |
| BK.6 | "Show curve" draws the curve above the table | ⬜ | With the operating point on it. Same builder as the calculation sheet, so they cannot drift. No system curve in the quick look — say if you want it. |

## 4L. OVERLOAD BEHAVIOUR and setpoint priority (v0.12.4)

Driven live on `20260804-3.json`.

| # | What | Status | Notes |
|---|---|---|---|
| OV.1 | The pump no longer throttles into an overload | ✅ | Was 25% (its floor); now 100%. The runaway falls from ~3000 °C to 420 °C — still a runaway, still flagged, but no longer made worse by the control. |
| OV.2 | `SETPOINT_LOST`, your wording | ⬜ | "System is unable to maintain setpoint. Check heat balance." An ERROR — it clears `converged`. |
| OV.3 | **The trade-off, and it needs your ruling** | ⬜ | **The one to judge.** For a machine holding a LEAVING temperature, minimum speed was *closer to setpoint*; full speed moves the most water. The rule now picks delivered capacity. It changed the v0.11.1 economizer case, which parks at full instead of on its floor. Overrule me if that reads wrong on a real job. |
| OV.4 | Setpoint priority is a drag list | ⬜ | Same grip and gesture as LEVELS, labelled primary / secondary. Verified live: dragging ΔT above LWT stored `order:['dt','lwt']` and the engine followed. |
| OV.5 | Your third question — "once it hits the design ΔT limit the pump stops trying" | ✅ | That was it, and two things caused it. The v0.12.3 authority probe stopped the pump chasing a setpoint it could not move; this one stops it *throttling* when no setpoint is reachable. Both were needed. |

## 4K. CONTROL AUTHORITY and valve UX (v0.12.3)

Driven live on `20260804-2.json`.

| # | What | Status | Notes |
|---|---|---|---|
| CA.1 | The VFD no longer pins at 100% | ✅ | Your file: PMP-1 falls through to Design ΔT, settles at **57%**, chiller at exactly **15.00 K**, GLV-01 back to **100% open**. Flow 0.800 L/s = the coil's design flow. |
| CA.2 | `CONTROL_NO_AUTHORITY` when nothing else is toggled | ⬜ | "PMP-1 has no authority over ACCH-01's Design LWT: it is held at 20.0 °C whatever PMP-1 does… Hold a setpoint the pump can actually move — Design ΔT or design flow." |
| CA.3 | **Is falling through the right behaviour?** | ⬜ | **Your call.** With both toggled it silently moves to the second. The alternative is to refuse and make you pick. I chose silent-with-a-`(fallback)`-label in the panel. |
| CA.4 | Isolation valve / Control valve names | ⬜ | Dropdown reads Isolation valve / Control valve / Check valve. Keys in saved files unchanged. |
| CA.5 | Opening controls greyed out when controlled | ⬜ | Slider and box `disabled`, row at 50% opacity. Verified live. |
| CA.6 | `VALVE_OVERSIZED` below 10% open | ⬜ | Your wording exactly. Control valves only; a shut valve and an isolation valve are exempt. Threshold on HYDRAULIC ▸ Warning thresholds. |
| CA.7 | Valve tag, flow and PD now draw | ⬜ | **Was a real bug** — `drawValveGlyph` never called `drawTag`, so a valve showed neither its tag nor its value box while every other in-line device did. The %-open label moved below the glyph to make room. |

## 4J. THE HIGH-ΔP FIX and the panel rework (v0.12.1 / v0.12.2)

Driven through the live app on `20260804-1.json` and read back.

| # | What | Status | Notes |
|---|---|---|---|
| HP.1 | Your model sizes to **25.53 m**, was 102.68 m | ✅ | Your diagnosis was right. Chiller now drops 49.7 kPa = 200 × (0.798/1.6)², the square law at part load. No EQUIP_OFF_RATING. |
| HP.2 | Source/Sink: LWT Setpoint, Design ΔT, no Temperature Limit | ⬜ | Read back live: Capacity −100 kW, % Load 50.0%, LWT Setpoint 20 °C, Design ΔT 15 K. |
| HP.3 | Source/Sink trio interrelates | ⬜ | Your sequence, live: flow 1.2 L/s → ΔT 19.94 K; capacity −60 kW → ΔT 11.97 K; ΔT 20 K → **flow 0.7179 L/s**. Sign preserved (chiller stays a chiller). |
| HP.4 | Control section: Monitoring, then setpoint switches | ⬜ | Live on PMP-1: `Monitoring ACCH-01`, `[x] Design LWT 20.0 °C`, `[ ] Design ΔT 15.0 K`. Toggling ΔT on stored `use:{lwt:true,dt:true}`. |
| HP.5 | Priority is a **fallback**, not a blend | ⬜ | **Worth your eye.** One actuator cannot hold two setpoints at once, so the second is chased only when the first proves unreachable. Say if you meant something closer to a cascade. |
| HP.6 | Valve slider fixed | ⬜ | Range now 102 px of a 170 px row, number box 56 px. Cause: `.cell-input` overriding `.tiny-num` — same specificity, later in the file. |
| HP.7 | Sensor bubble perpendicular, draggable in VIEW | ⬜ | On your vertical run it is offset 18 px sideways and 0 px along — measured, not eyeballed. Drag key `sensorOffset`, cleared by "Reset label positions". |
| HP.8 | Sensor panel says "Linked to" | ⬜ | Was "Controlled by". |
| HP.9 | "Limited by" now reads **Design ΔT** | ⬜ | Was "ΔT max", to match the renamed field. |

## 4H. PIPE SENSOR — thermostatic mixing (v0.12.0)

Your request. Engine side is 34 new assertions including the mixing hand
calculation. Driven through the live app on a hot/cold blend and read back.
**Appearance is unsigned** — no pixels rendered.

| # | What | Status | Notes |
|---|---|---|---|
| PS.1 | SENSOR button in the COMMAND group | ⬜ | Placing one splits a pipe like PUMP/VALVE/EQUIP do. Tags auto-increment TS-1, TS-2. |
| PS.2 | Sensor symbol | ⬜ | **The one to judge.** An instrument bubble — hollow circle on a stem, `T` or `F` inside — in amber. Deliberately not the filled green/red ring a pump and chiller share, because it is not plant and has no in-service state. |
| PS.3 | Panel: Measures (Temperature / Flow), one setpoint, and who is following it | ⬜ | On the live rig it read `Temperature 45.11 °C` and `TMV-1  31% open`. Says "Controlled by: nothing" when no link exists. |
| PS.4 | Thermostatic mixing works | ⬜ | 60 °C and 10 °C blended, sensor at 45 °C, valve on the cold leg closed to 31% and held it. Hand check: 70% of the mass must arrive hot, and it does. |
| PS.5 | The residual is one percent of valve travel | ⬜ | 33% open gives 45.106 °C, 34% gives 44.845 °C — 45.000 falls between. The search keeps the closer. **Say if you want finer valve steps**; the 1% grid was your call in v0.10.3. |
| PS.6 | Flow setpoint, for constant-flow control on a branch | ⬜ | Throttles to the flow asked for within one percent of travel. An unreachable setpoint is reported rather than hunted for. |
| PS.7 | Does "Pipe Sensor" earn its place as an Equipment vs a Valve? | ⬜ | **Your call.** I made it a device kind of its own rather than an equipment subtype — it has no design point, no duty and no service state, and as equipment it would have leaked into the off-rating check, the terminal list and the duty columns. |

## 4I. PRESSURE PLAUSIBILITY GUARD (v0.12.0)

| # | What | Status | Notes |
|---|---|---|---|
| PG.1 | `debug/20260803-1.json` now refuses to report | ⬜ | "PMP-1 duty is at 125237 kPa (1252.4 bar), past the 2000 kPa plausibility limit. The arithmetic is right — something in the model is not." Clears `converged` and takes the status chip. |
| PG.2 | **Is 2000 kPa the right default?** | ⬜ | **Your call.** My reasoning: PN16 pipework, PN25 on tall risers, so a single component past 20 bar is not building services. A fire main may want it raised. Field is on HYDRAULIC ▸ Warning thresholds; 0 disables. |
| PG.3 | Equipment flow ratio is now editable too | ⬜ | Default 2×. Same panel. |

## 4G. PUMP CURVE chart on the CALCULATION sheet (v0.11.4)

Your request. Structure and content were driven through the live DOM on a
two-pump model with 12 m of static lift and one pump at 75% speed, and read
back. **Everything about how it LOOKS is unsigned** — no pixels were rendered.

| # | What | Status | Notes |
|---|---|---|---|
| PC.1 | One chart per pump, no more "first pump only" | ⬜ | Confirmed 2 charts, captioned `PMP-01` and `PMP-02 — 75% speed`. The WIP note is gone. |
| PC.2 | 90/80/70/60/50% curves, dotted | ⬜ | 5 dotted polylines per chart, each labelled at its own shutoff head where nothing else is drawn. |
| PC.3 | System curve in red | ⬜ | Uses `var(--error)`, so it is red in both themes. Labelled "system" at its top end. |
| PC.4 | The simulated operating point, marked and labelled | ⬜ | e.g. `27.41 L/s @ 277.1 kPa`. |
| PC.5 | A pump running at a speed outside the family gets its own dashed curve | ⬜ | PMP-02 at 75% drew an 8th polyline, dashed `6 3`. Say if that is clutter. |
| PC.6 | **Is the red line dense enough to read?** | ⬜ | **The one to judge.** 6–9 solved points per curve. Against static lift most of a speed sweep passes no flow, so the working range is swept again — but the line is still a polyline through solved points, not a smooth fit. |
| PC.7 | In DESIGN there is no red line, and a 🛈 says why | ⬜ | Confirmed: 0 red polylines, family and rated curve still drawn, marker reads "…the demands impose the flow, so there is nothing to trace." |
| PC.8 | Does the system curve look right for a job you know? | ⬜ | **The engineering judgement.** It is solved rather than assumed — each point is a real solve — so it should show static lift as a non-zero intercept. Worth checking against something you have sized by hand. |

## 4F. PART LOAD / VFD reporting (v0.11.3)

Your catch. The engine was already solving the intersection correctly — what
was wrong was what got reported. Swept in the live app on your own model.

| # | What | Status | Notes |
|---|---|---|---|
| PL.1 | Panel "Actual pressure" falls at part load | ⬜ | Read back live across 100→50% on your fitted curve: 439.1 → 356.0 → 281.4 → 215.5 → 158.4 → 110.1 kPa. H/H1 matched n² to four decimals. |
| PL.2 | Panel, drawing plate and calculation sheet all agree | ⬜ | All three now call `M.pumpHead()`. They disagreed before: the plate was right, the panel and sheet read the curve in DESIGN. |
| PL.3 | A typed VFD % in DESIGN no longer inflates the sized duty | ⬜ | Was 44.8 m at 100% → 179.4 m at 50%, flow pinned at 20.00 L/s. Now unchanged at 44.8 m. |
| PL.4 | 🛈 appears on VFD speed when a stored speed is being ignored | ⬜ | Only in DESIGN, and only when a speed below 100% is actually stored. Reads: "Speed applies in SIMULATION only…". |
| PL.5 | Stale "Design pressure" after a bad DESIGN solve | ⬜ | **Noticed, not fixed.** Your model still showed `Design pressure 12791.88 m` in SIMULATION — that is `hDesign` recorded by the last DESIGN solve, before the AHU was corrected. It refreshes on the next DESIGN solve. Say if you want it blanked instead when it is stale. |
| PL.6 | Does the part-load picture look right on a job? | ⬜ | **The engineering judgement.** The numbers are hand-checkable (H ∝ n², and correctly NOT n² once there is static lift) but whether the whole reading is what you expect is your call. |

## 4C. SETPOINT CONTROL — variable-speed pumps (v0.11.1)

The engine side is covered by 47 new assertions, including Michael's economizer
against a closed-form flow. **Nothing below has been rendered to pixels** — the
preview browser has a 0×0 viewport, so every item here is about appearance and
is unsigned. The DOM was driven and read back, so the wiring is known good; how
it *looks* is not.

| # | What | Status | Notes |
|---|---|---|---|
| 4C.1 | Pump info plate shows `N 54%` when modulating | ⬜ | Only when off full speed — "100%" on every pump is clutter. Line added below `H`. |
| 4C.2 | Pump panel Actual box: `Speed  54% — holding ECO-01` | ⬜ | Read back from the live DOM, so the text is right; the layout is not checked. Says `(at minimum)` when on the floor. |
| 4C.3 | Device Flow row reads `PMP-01 (54% speed)` | ⬜ | Read back live. |
| 4C.4 | Pump-curve chart: scaled curve solid, rated curve dashed behind it | ⬜ | **The one to judge.** Two polylines confirmed present; whether the dashed rated curve reads clearly at 45% opacity is a visual call. Caption says "54% speed (rated curve dashed)". |
| 4C.5 | Controlled globe valve: "Set by the control link" beside the slider | ⬜ | The position is now an OUTPUT — without this line, setting it by hand looks like a bug when the next solve moves it. Not exercised in the browser; logic is a one-line `M.controlOf` guard. |
| 4C.6 | THERMAL ▸ Setpoint control: three fields | ⬜ | Minimum pump speed (%), minimum valve opening (%), deadband (K). Values read back as 25 / 10 / 0.05. |
| 4C.7 | `CONTROL_AT_LIMIT` wording on the sheet | ⬜ | "PMP-01 is at its minimum speed (25% speed) and ECO-01 is still 2.5 K above its 25.0 °C setpoint." Engine-tested; not seen in the warnings panel. |
| 4C.9 | Pump panel now reads `VFD speed 100%` on every running pump | ⬜ | You asked for it shown; it was hidden at 100% before. There is also a **VFD %** toggle in the pump's "Show on drawing" list, off by default, which puts `VFD 54%` on the info plate. Say if you want that on by default. |
| 4C.8 | Does 54% look right for that economizer? | ⬜ | **The engineering judgement.** The flow it settles at is hand-checkable (11.97 L/s for a 250 kW machine across 5 K) but whether the whole picture is what he would expect on a job is his call. |

## 4D. THERMAL module (v0.10.0)

Built and engine-tested; nothing here has been rendered to pixels, and two data
sets need Michael's eye before anything is issued.

| # | What | Status | Notes |
|---|---|---|---|
| 4D.1 | **Propylene glycol properties** | ⬜ | **Check these first.** Written from recollection of ASHRAE Ch 31, flagged `verified: false` throughout, and the flag appears on the calculation sheet. **Cp scales every duty linearly** — 5% out on Cp is 5% out on every kW. Water is untouched (998 / 4187, the app's own values). |
| 4D.2 | **Insulation thicknesses** | ⬜ | A placeholder, and flagged as one. No single standard exists to read off — thickness follows service, ambient and jurisdiction. Set them from your standard; a pipe's own value wins, including 0. |
| 4D.3 | Outside surface coefficient | ⬜ | 8 W/m²·K, a default. On a bare pipe it is the ENTIRE resistance, so a bare-pipe answer is only as good as this. |
| 4D.4 | THERMAL tab layout | ⬜ | Sign convention, fluid readout, conditions, insulation table, last-solve summary. Never seen as pixels. |
| 4D.5 | Equipment ΔT / Q toggle | ⬜ | One toggle serves DESIGN and SIMULATION. Verified in the DOM: ΔT 6 K and a duty of −125.359 kW give exactly ∓6 K and ±125.36 kW on the same model. |
| 4D.6 | Temperature on the drawing, probe, visualiser | ⬜ | ANNOTATIONS ▸ Temperature, the PROBE readout, and a TEMPERATURE visualiser beside PRESSURE. Verified through the render path; the probe re-solves the exponential rather than interpolating between the ends. |
| 4D.7 | Fluid selector locks unless Custom | ⬜ | A named fluid's properties are read-only, for the same reason the published equivalent-length tables are. Verified in the DOM. |
| 4D.8 | **Does the whole thing agree with a job you know?** | ⬜ | **The one that matters.** Pipe heat gain, coil duties and mixed temperatures against something with known answers. Nothing here has been checked against another tool. |

## 4E. Thermal, second round (v0.10.1)

| # | What | Status | Notes |
|---|---|---|---|
| 4E.1 | **Insulation Critical Radius tool** | ⬜ | **Please rule on this one.** It takes ambient and fluid temperature as you asked, but the critical radius is `r_cr = k/h` and contains **no temperature at all** — doubling the temperature difference doubles the heat flow at every radius and moves the turning point not at all. Rather than ignore the inputs, they drive the heat loss and the **surface temperature**, which is the number to compare against dew point. With PU at k = 0.02 and h = 8, r_cr = **2.5 mm**, so it never binds on any pipe in any schedule here. If what you actually want is the condensation-control thickness, that is a different calculation and needs the room's humidity. |
| 4E.2 | Insulation moved onto the pipe schedule | ⬜ | The schedule table now shows nominal / bore / OD / wall / insulation, with only insulation editable. 25 mm below DN50, 50 mm from DN50 up. A pipe still overrides it individually, including 0. |
| 4E.3 | Current schedule + Add / Copy buttons | ⬜ | "Copy Current Schedule" seeds a new custom one from the active schedule's sizes. Custom schedules now take an **outside diameter** as their third column instead of insulation — the thermal module needs it, and without it a custom schedule falls back to the bore and understates heat loss. |
| 4E.4 | Equipment: Hydraulics header, thermal dropdown | ⬜ | "Solve Q from ΔT" / "Solve ΔT from Q". |
| 4E.5 | **A 100 kW load with no heat rejection** | ⬜ | **Your test case, and it found a real design fault.** The datum pinning would have held the loop at the flow temperature and reported a system that never warms. Ambient is a reference, so a pin is now only used when there is no source *and* no ambient coupling. The loop settles where the pipes shed exactly what the load puts in — 63–64 °C for 100 kW into 800 m of bare DN100, energy balance closing to 0 W. |
| 4E.6 | Runaway guard | ⬜ | Your alternative, kept alongside the equilibrium rather than instead of it. Outside the band it is an **error**, clears `converged`, and takes the status chip — but the temperatures are still reported, because the answer is not wrong, it is implausible, and hiding it leaves nothing to diagnose from. |

## 4F. Equipment types (v0.10.3)

| # | What | Status | Notes |
|---|---|---|---|
| 4F.1 | Source / Sink and Heat Exchanger | ⬜ | Setpoint-led and load-led. Verified against hand calculations: a 100 kW chiller asked for 6 °C from an 18 °C inlet leaves at 13.21 °C and reports "Limited by Capacity". |
| 4F.2 | Capacity vs ΔT max | ⬜ | Both are needed and bind in different places — the same machine swaps from capacity-limited to ΔT-limited at a quarter of the flow. Worth confirming that matches your plant data. |
| 4F.3 | T limit | ⬜ | Your economizer case: setpoint 25 °C, limit 18 °C. Holds 25; asked for 12 it reaches 18 and stops, reporting "T limit". |
| 4F.4 | Load ↔ ΔT are locked | ⬜ | Both boxes offered on an exchanger; each rewrites the other at the rated flow. The model stores duty. |
| 4F.5 | Valve opening 0–100%, 1% steps | ⬜ | Slider plus a typed box. The Kv curve is still tabulated at the quarter points and interpolated between them — **that interpolation is a shape, not measured data**, same caveat as the Kv values themselves. |
| 4F.6 | **Variable-speed pumps** | ⬜ | **NOT BUILT.** Your realisation that setpoints need pump modulation is right, and it is the next significant piece — see HANDOVER §9. |

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
| 6.5 | Laminar flow warning | ⬜ | |
| 6.6 | Shut valve starving a demand | ⬜ | |

## 6A. Source pressure and pipe length (v0.7.7-dev)

Both of these came from `debug/20260802-1.json` and are reproduced in the
automated suites, but the *reading* is the part only you can sign off.

| # | What | Status | Notes |
|---|---|---|---|
| 6A.1 | A source node reads its stated pressure | ⬜ | Was 0 kPa gauge, which read as a jump at the next node. Now `H = z + P/(ρg)`, so the node reads exactly what is typed into it. **Every downstream number is unchanged** — check that against a model you already know. |
| 6A.2 | Setting a source pressure no longer moves the node | ⬜ | It was stored as an elevation. `20260802-1.json` now loads with its pipe at exactly 50 m, not 54.01 m. |
| 6A.3 | Pipe length is editable on a sloped pipe | ⬜ | `changeLength` was comparing a 3D length to a plan length. It now solves `plan = √(L² − rise²)` and refuses a length below the rise. |
| 6A.4 | The migration dialog on loading an older file | ⬜ | **Please read it and say whether it explains itself.** It fires once per file and it is telling you pipe lengths have changed. |
| 6A.5 | Sloped layout pipes are refused | ⬜ | **New in v0.7.8-dev.** A pipe whose ends differ in elevation is a `SLOPED_PIPE` error and takes the status chip red. Verified in-browser on the old `20260802-1.json` geometry. Worth checking against any model of yours that predates the rule — if one lights up, the pipe was being measured along its slope and its friction was overstated. |
| 6A.6 | Pipe lengths after the rule change | ⬜ | **Please spot-check a model you know.** Any pipe whose ends were at the same elevation is unchanged to the last decimal. Only a pipe that was silently sloped moves — and that one was wrong before. |

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
* **Simulated outflow flow is now proven, in algebra.** `Q = Q_d·√(P_node/ΔP_d)`
  holds to 1e-9 in `simulation.test.js` and was re-confirmed live in the browser
  (18.78 L/s at 176.4 kPa against a hand answer of 18.78 L/s). That verifies the
  *relationship*; it does not verify that the absolute numbers match another
  tool, which remains the gap above.
* **No pump curve has ever been fitted from a real datasheet.** The fitter is
  exercised only against curves generated from its own form, which it recovers
  exactly — that proves the algebra, not that manufacturer curves take this
  shape. The fit quality is displayed for precisely this reason.

## How to log a result

Set the status, add a note if it is anything other than a clean pass, and update
the date at the top. If something fails, a line about *what you did* and *what
you expected* is worth more than the failure itself.
