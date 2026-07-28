# Piping Friction Loss Calculator — Specification (Draft v0.3)

> **Convention:** <u>Underlined text = Michael's specifications.</u> Plain text = Claude's proposed approach, defaults, and gap-filling. Open questions in §12.
>
> **v0.3 changes:** Q&A round 2 resolved — EN schedule set finalised (PPR & HDPE in, copper out to Custom); custom schedules renamable & persisted in browser data; CSV defaults to comma/`.`; node hover tooltip promoted to v1; gauge-pressure convention confirmed, no Pv column, fire-use gently discouraged but not blocked.
>
> **v0.2 changes:** Q&A round 1 resolved (per-pipe Flow removed; rigid downstream translation; Darcy deferred to v2 via SETTINGS; tee run/branch by flow direction; Open/Closed loop toggle; riser size inheritance). Tab renamed PIPING NETWORK; CALCULATION tab defined (node-to-node sheet); save/load/new/print; file format; dark mode; EN pipe standards; SOURCE redefined as infinite reservoir; freeware distribution notes.
>
> **Reference product:** <u>Canute FHC</u> (fire hydraulic calc software) — take functional inspiration from its node-to-node calculation sheets and network entry workflow, adapted for plumbing/hydronics.

---

## 1. Overview

A single-page HTML application for Building Services Engineers to draw a multi-level water piping network and calculate friction losses, flow distribution (including loops), and pump duty.

- <u>Locally hosted. No external links or CDN dependencies</u> — all JS/CSS/fonts/data tables inlined or in local files. Must work opened from disk (file://) with zero network access.
- <u>Calculations per ASHRAE: Hazen-Williams formula, fitting data from ASHRAE</u> (Fundamentals, Pipe Sizing chapter — equivalent length method).
- <u>All internal calculations in SI (Metric); IP is a display-layer conversion only.</u>
- <u>Distribution intent: freeware for building services engineers, who apply their own cover sheets; no liability</u> → see §11 (licensing, disclaimer, print-friendliness).

### 1.1 Engineering context (design basis)

How Building Services Engineers size piping (informs validation warnings and defaults):

1. Establish demand flows at terminals (fixtures, coils, equipment).
2. Size each pipe within **velocity limits** (typically 1.2–2.4 m/s occupied areas; up to ~3 m/s plant rooms/risers) and **friction rate limits** (commonly 100–400 Pa/m; ~400 Pa/m usual ceiling).
3. Identify the **index circuit** (hydraulically most remote / highest-resistance path) — sets pump head.
4. Pump head = static lift (open systems) + friction along index circuit + equipment PD + terminal pressure requirement + safety factor.
5. Non-index branches have surplus pressure (balanced by valves — out of scope v1; app reports surplus per demand node).

Warnings surface when a pipe exceeds velocity or Pa/m thresholds (editable in SETTINGS); index circuit highlighted in CALCULATION.

---

## 2. Architecture

- **Stack:** `index.html` + `app.js` + `styles.css` + `data/` (pipe schedules, fitting tables as JS objects). Vanilla JS, Canvas 2D drawing surface, HTML overlay for buttons/panels. No framework, no build step, file://-safe.
- **Persistence:** <u>Model auto-saved in browser data</u> (`localStorage`, debounced) **and** <u>explicit [SAVE MODEL]/[LOAD MODEL] as a downloadable file</u> — format in §2.1.
- **Precision:** All model state SI: m, m³/s (displayed L/s default), Pa/kPa. Unit conversion only in formatters/parsers.

### 2.1 Model file format — proposal

<u>Michael asked for an open-source-friendly format (non-programmer; wants portability).</u> Findings & proposal:

- The only widely-adopted open hydraulic network format is **EPANET `.inp`** (US EPA, public domain). It's ideal for hydraulic interop but **cannot store** levels, level offsets, riser columns, drawing coordinates per floor, or UI/display state — so it can't be the native format without losing the drawing.
- **Native format: JSON**, extension **`.pnet.json`** — a plain-text, human-readable, universally-parseable open format. The schema is documented in an appendix (`FORMAT.md`) shipped with the app, includes a `formatVersion` field for forward compatibility, and embeds everything: settings, custom schedules, levels (+offsets), nodes, pipes, riser columns, devices. Any programmer (or Claude) can read/write it; Excel can import it via Power Query if anyone ever needs to.
- `[v2]` **Export to EPANET `.inp`** for interop with EPANET/WNTR and other engines (drawing metadata carried in `;comments` where possible).
- Saving uses the browser download mechanism (Blob → `<a download>`); loading via `<input type="file">`. Both work offline on file://.

---

## 3. Calculation Engine

### 3.1 Friction method

- v1: **Hazen-Williams** (below).
- <u>SETTINGS exposes a "Friction method" selector: Hazen-Williams / Darcy-Weisbach, with Darcy greyed out "(v2)"</u> — the engine's pipe-loss function is a swappable module so Darcy drops in later without touching the solver.

### 3.2 Hazen-Williams (ASHRAE form, SI)

```
hf = 10.67 · L · Q^1.852 / (C^1.852 · d^4.8704)     [m of water]
```

- `L` = pipe length + Σ equivalent lengths of fittings [m]; `Q` [m³/s]; `d` = inner diameter [m]; `C` per-pipe (default from SETTINGS).
- `ΔP = ρ·g·hf`, ρ = 998 kg/m³, g = 9.81 m/s². **PD/m** (Pa/m, on actual length excl. fitting EL — the value compared against the 400 Pa/m rule) and **PD** (total incl. fittings).
- `V = Q/(π·d²/4)` for warnings.
- Tooltip note: HW valid for water ~15–25 °C, turbulent flow; not glycol (→ Darcy, v2).

### 3.3 Fittings (ASHRAE equivalent length method)

Auto-detected from drawn geometry — user never places fittings manually:

| Node situation | Fitting |
|---|---|
| 2 pipes at ~90° | 90° elbow |
| 2 pipes at 15–75° | 45° elbow (nearest of 45/90 by angle) |
| 3 pipes | Tee — see below |
| Riser meets horizontal | 90° elbow (tee if horizontal continues) |
| 4 pipes | Cross → two tee-branches (warn) |

- <u>Tee losses use **straight-through (run)** vs **tee-off (branch)** equivalent lengths, assigned by the direction the fluid approaches/leaves the tee</u>: after solving, the leg pair carrying through-flow gets run EL, the diverging/converging leg gets branch EL. Since direction is only known post-solve, the engine does: solve with geometric guess → reassign run/branch from solved directions → re-solve (converges in 1–2 passes).
- Equivalent lengths from ASHRAE Fundamentals tables keyed by nominal size, local data file. L/D basis for generation: 90° elbow ≈ 30·D, 45° ≈ 16·D, tee-run ≈ 20·D, tee-branch ≈ 60·D.
- Fitting EL charged to the **downstream** pipe. Property panel shows `L (drawn) + EL (fittings) = L (effective)`.

### 3.4 Network solver — <u>must handle loops (multiple flow paths)</u>

**Nodal Newton-Raphson (Global Gradient Algorithm, Todini–Pilati — the EPANET method).** Handles branched + looped topologies, multiple sources, pumps, fixed-flow demands in one framework; no manual loop identification.

- Unknowns: head `H` per junction; flow `Q` per link.
- Links: pipes (HW resistance, linearized per iteration; linear cutoff below 1e-6 m³/s to avoid the zero-flow singularity), equipment (quadratic resistance from rated PD/flow), pumps (head gain).
- Boundary conditions:
  - **Source = fixed-head reservoir** (§8.1) — supplies/absorbs whatever the network requires.
  - **Demand** (if included, §8.2): fixed outflow; solver returns available pressure vs required.
- Convergence: max head change < 1 mm and node imbalance < 0.01 L/s; cap 100 iterations; on failure, report offending nodes.
- Graceful degenerates: disconnected islands solved independently (island with demand but no source → error badge); closed loops with no demand → Q=0, valid.
- **Elevation:** node `z` from pipe altitude (level altitude ± per-pipe offset; risers interpolate). Node pressure = `ρ·g·(H − z)` — static head handled naturally.
- <u>System type (SETTINGS): **Open Loop / Closed Loop**</u> — affects pump auto-sizing only: Open includes static lift to the index demand; Closed cancels static (return leg recovers it), pump covers friction + equipment + terminal ΔP only.

### 3.5 Per-pipe properties

- Inputs: <u>Length, Diameter, C, Altitude</u>. <u>(Per-pipe optional Flow **removed** — v0.1 item retired. Reduced flow at specific points is modelled by adding a Demand instead.)</u>
- Calculated: <u>Actual Flow, PD/m, PD, Pressure</u> (at downstream node) + Velocity + flow-direction arrow.

---

## 4. UI Shell

- Tabs: <u>**PIPING NETWORK**</u> (renamed from DRAW NETWORK) · <u>**CALCULATION**</u> · **SETTINGS**.
- <u>Canvas zoom (scroll, cursor-centred) & pan (middle-mouse drag); buttons/panels static.</u>
- <u>**Dark/light mode**, toggle in SETTINGS, **defaults to dark**. High-contrast font</u> (system UI stack at ≥ 14 px, WCAG AA against both themes). <u>Pipes: **blue** when carrying flow, **grey** when zero-flow</u> (post-solve; before first solve all pipes grey). Selection = amber outline; warnings = red badge. Canvas colors theme-aware — except print/export rendering (§10), which is always black-on-white regardless of theme.
- Grid background (0.5 m minor / 5 m major), scale indicator, snap-to-grid toggle.
- **PIPING NETWORK toolbar:** <u>[DRAW PIPE] [ADD RISER] [ADD SOURCE] [ADD DEMAND] [EQUIP] [PUMP] · [CALCULATE] · [NEW] [SAVE MODEL] [LOAD MODEL]</u> [PRINT] + Undo/Redo + solve-status chip. `Esc` exits any tool → EDIT mode.
  - <u>**[CALCULATE]**: runs the solver and switches to the CALCULATION tab.</u> (Background auto-solve still runs debounced for live pipe coloring; [CALCULATE] is the explicit "produce the sheet" action.)
  - <u>**[NEW]**: blanks the project, with a confirmation dialog</u> ("Discard current model? Unsaved changes will be lost. [Save first] [Discard] [Cancel]").
  - <u>**[SAVE MODEL] / [LOAD MODEL]**: file download/upload per §2.1. [SAVE MODEL] appears in both PIPING NETWORK and CALCULATION tabs.</u>

## 5. DRAW Mode — <u>[DRAW PIPE]</u>

- <u>Single-line pipes, click-to-click</u>; each click places a vertex; `Esc`/right-click/double-click ends the run.
- <u>Angle snap 15°</u> (`Shift` disables — proposed).
- <u>Nodes auto-created at start, end, tees, elbows, supply & demand.</u> Collinear segments merge; direction changes create elbow nodes.
- <u>Typed length after first click sets segment length</u> (unit per SETTINGS); inline input near cursor, `Enter` commits along current (snapped) bearing. <u>Otherwise length from clicked distance.</u>
- <u>Scroll wheel during draw steps pipe size</u> through the active schedule's sizes; floating size badge at cursor; `Ctrl+scroll` still zooms (proposed).
- <u>Snap-to-pipe: near an existing pipe → dotted preview; click inserts a **Tee** (splits target). Near an endpoint → snaps and creates an **Elbow**.</u> Snap radius ~10 px screen; endpoint zone wins within ~15 px.
- New segments inherit size (last used), C and altitude (level), schedule (SETTINGS default).

## 6. EDIT Mode

- <u>Exiting DRAW enters EDIT (same tab). Click selects; right-click → Change Length, Change Size, Copy Up, Copy Down, Delete</u> + property fields (C, altitude offset).
- **Length edits — resolved:** <u>when a pipe's length changes, everything downstream of the moved end **translates rigidly** — connected pipe lengths never change.</u> Implementation: from the moved node, collect the connected component on the far side (excluding the edited pipe) and translate it whole. Edge cases:
  - Component loops back to the fixed side (a hydraulic loop in-plane) → rigid translation impossible; refuse with toast "Length locked by loop — break the loop or move the whole group."
  - Component includes a riser-column attachment → riser XY is level-locked; refuse similarly ("anchored by riser") unless the riser itself is in the moved set (then its column moves, with the §7.2 locking rules re-checked).
- <u>Copy Up/Down duplicates selection to level above/below</u> at same XY (respecting level offsets), adopting target level altitude; disabled if no such level.
- <u>Left-click drag rubber-band multi-select</u> (partial inclusion). Bulk right-click: size/C/delete/copy.
- Node drag moves the node with the same rigid-translation rule applied to the smaller attached side (proposed, consistent with the above). `Delete` deletes selection; deleting a 2-pipe collinear tee merges pipes.

## 7. Levels

- <u>Left panel: level list; Add/Remove buttons; drag to reorder; right-click → rename, set Altitude (shifts all pipes on level), **Look Up/Down** toggle.</u>
- Default <u>Level 0</u>, altitude 0 m; new levels ±3.5 m (editable default).
- <u>Selected level shows its layout; adjacent level (per toggle) renders faded ~30%, non-interactive except riser snapping.</u>
- Per-pipe altitude offset from level altitude allowed (high/low-level runs).

### 7.1 Level offsets

Each level stores a 2D offset `(dx,dy)` applied at render/hit-test time; pipe coords are level-local. **Aligning floors = changing offsets; geometry and lengths never change.**

### 7.2 <u>[ADD RISER]</u>

**Riser Column** = fixed world-XY anchor + (level, node) attachments over a contiguous altitude range; contributes vertical pipe links between consecutive levels (length = Δaltitude; size defaults to the larger connected horizontal pipe — <u>confirmed</u>; C/size editable).

Placement (active level A, background B):

1. Click point on A (snaps to A's nodes/pipes: mid-pipe → tee, endpoint → elbow, empty → free-standing riser node — supports both riser-first and backwards workflows).
2. Against B at that world-XY:
   - Near an existing **Riser Column** → <u>snap to it</u>, extend column to A. No popup.
   - Near a node/pipe on B → <u>popup: **Align A to B** / **Align B to A**</u> / "Connect without aligning" (only within ~50 mm world tolerance). Align = translate that level's offset.
   - Nothing nearby → column attaches to A only; renders as a hollow "riser stub" on other levels as a snap target to complete later.
3. **Offset locking:** a level in ≥2 riser columns has a locked offset; align options for locked levels grey out. Both locked & non-coincident → error toast ("move a pipe end to the riser or delete a riser"). Deterministic, no silent geometry edits.
4. Multi-storey stacking automatic.

`[v2]` dog-leg risers; flow/return riser pairs.

---

## 8. Device Nodes

Placed by click (snap rules §5); distinct glyphs + mini-labels.

### 8.1 <u>[ADD SOURCE]</u> — revised
- <u>**Infinite water source at 0 gauge pressure** at its own altitude</u> — i.e., a free-surface reservoir: fixed head `H = z_source`. <u>Placed at the top of a building it behaves as a gravity tank; placed at the bottom, downstream demands fail unless a pump is added</u> — exactly the fixed-head reservoir semantics of the GGA solver, so no special-casing. No user parameters in v1 (altitude comes from level/pipe altitude). Multiple sources allowed; flows split hydraulically. `[v2]` optional surface pressure / pressurized source, capped sources, PRVs.

### 8.2 <u>[ADD DEMAND]</u>
- <u>Flow (draw-off) + required Pressure.</u>
- <u>**"Include in Calculation" checkbox per demand** (default on). Unchecked demands are omitted from the solve and from the calculation sheet</u>; rendered hollow/dimmed on canvas so they're visibly inactive. (This replaces the removed per-pipe Flow as the way to study reduced/alternative flow scenarios.)
- Solver reports available vs required pressure; red badge on shortfall; shortfall feeds pump auto-sizing.

### 8.3 <u>[EQUIP]</u>
- <u>Demand Flow (inlet), outlet Flow (default = inlet), PD.</u> In-line 2-port link, `ΔP = ΔP_rated·(Q/Q_rated)²`; inlet−outlet difference lumped as a demand at the node.

### 8.4 <u>[PUMP]</u>
- <u>Flow: Auto (= downstream demand) or specified. Head: calculated (index PD downstream + terminal requirement + SETTINGS safety %) or user-fixed.</u> Auto-sizing loop: solve → required head → set pump → re-solve to stability. Duty point (Q, H) reported prominently.
- <u>Pump curve input `[v2]`</u>; planned as ≥3 (Q,H) points fitted to `H = H0 − a·Q²` — v1 fixed-head is the degenerate case, solver interface unchanged. <u>`[v2]` pump curve × system curve intersection plot.</u>

---

## 9. SETTINGS Tab

- <u>Units Metric/IP; computation always SI.</u> Display units per quantity: flow L/s | m³/h | GPM; pressure kPa | m | psi | ft; PD/m Pa/m | ft/100ft; length m | ft; size DN mm | NPS in.
- <u>Friction method: Hazen-Williams / Darcy-Weisbach (v2, greyed).</u>
- <u>System type: Open Loop / Closed Loop.</u>
- <u>Pipe standards, built-in:</u>
  - <u>ASME/imperial: **Schedule 10, 40, 80**</u> steel (DN15–DN300 nominal → ID).
  - <u>EN standards (finalised set)</u>: **EN 10255 Medium** and **EN 10255 Heavy** (welded steel tube — the standard BS/EN galvanized/black steel in Commonwealth/Malaysian building services), <u>**PPR**</u> (EN ISO 15874, OD-series 20–110 mm; PN16 & PN20 wall series) and <u>**HDPE**</u> (EN 12201 PE100, OD-series 20–315 mm; SDR11/PN16 & SDR17/PN10). PPR/HDPE IDs derived from OD − 2×wall and stored as ID tables like the rest. <u>Copper dropped from defaults (rare in this market) — available via Custom.</u>
  - <u>Custom user schedules: list of (Nominal label, Inner Diameter mm) — the two governing fields. Schedules are **renamable** and **persist in browser data** (localStorage, independent of any one project)</u>; they are additionally embedded in each saved `.pnet.json` so a model file remains portable to a browser that has never seen that custom schedule (on load, offer to import it into browser data if absent).
- <u>Default C factor per schedule, user-settable</u> (steel 120, copper 140, PVC 150), overridable per pipe.
- <u>Pump safety factor %</u> (default 10%).
- <u>Dark/light theme toggle (default dark).</u>
- Warning thresholds (velocity 2.4 m/s, 400 Pa/m), floor-to-floor default, grid/snap, project metadata (§11).

---

## 10. CALCULATION Tab

Layout modelled on the industry-standard node-to-node hydraulic calculation sheet (NFPA-13-style sheets as produced by Canute FHC / HydraCALC — sections between node pairs, friction and elevation tallied per section, cumulative pressure carried along the path).

- <u>**Node-to-node table**, one row per pipe section:</u>

| Col | Content |
|---|---|
| <u>Section</u> | <u>Start node № → End node №</u> (auto-numbered; stable IDs shown on canvas when tab active) |
| <u>Pipe size</u> | Nominal + ID (mm) |
| L / EL / L_eff | Drawn length, fitting equivalent length (with fitting codes, e.g. `2×E90, T-br`), effective length |
| <u>Flow rate</u> | Actual solved flow |
| Velocity | m/s (warn-highlighted) |
| <u>PD/m</u> | Friction rate |
| <u>Section PD</u> | Friction loss incl. fittings |
| <u>Static change</u> | ρ·g·Δz across the section (±) |
| <u>Pressure</u> | Cumulative pressure at end node |

- Row ordering: **index circuit first** (source/pump → most remote demand, highlighted), then remaining branches grouped by branch point, each traversal starting from its tee. Loops: each loop member listed once with its solved flow and direction; a loop-closure check row shows the residual (should be ≈0 — good engineering evidence the loop balanced).
- Header block above the table: project metadata, system type, fluid, method (Hazen-Williams per ASHRAE), date, app version. Footer: pump duty point(s), source summary, warnings list, liability disclaimer line (§11).
- Buttons: <u>**[SAVE CALCULATION]**, **[SAVE MODEL]**</u>, <u>[PRINT]</u>.
  - <u>**[SAVE CALCULATION]**: exports the table as **CSV** — just the table and numbers</u> (header comment rows with metadata prefixed `#`), **and** <u>the black-on-white network images, one per level (§10.1)</u>. <u>Delimiter: **comma** with `.` decimals by default</u>; `;` + `,` EU-locale option in SETTINGS.
  - **Node hover tooltip — v1 (confirmed):** hovering a node in the CALCULATION tab (and in EDIT mode post-solve) shows a minimal tooltip: node №, elevation, gauge pressure, and each connected pipe's flow with in/out direction — <u>useful at tees</u>. `[v2]` richer popup (mass-balance table, per-leg PD contributions).
- **Pressure convention:** all reported pressures are **gauge pressure at the node** (`ρ·g·(H − z)`). **Velocity pressure (Pv) is neglected** — appropriate for plumbing/hydronic work. A one-line note in the sheet footer states this, alongside: *"Not intended for fire protection design (velocity pressure neglected; software not listed for AHJ acceptance)."* — <u>gently discourages fire use without locking it out</u>; a knowledgeable engineer can still run preliminary numbers at their own judgment.

### 10.1 <u>[PRINT] & image export</u>

- <u>[PRINT] and [SAVE CALCULATION] generate a **black-on-white image of the network, one per level**, for later printing.</u>
- Format proposal: **SVG** primary (vector — crisp at any print size, tiny files, opens in browsers/Word/CAD viewers) + **PNG at 2× resolution** as a compatibility alternative (toggle in SETTINGS). Rendering: white background, black lines/text regardless of theme; pipe sizes and node numbers labelled; level name + altitude + project name + scale bar in a title strip.
- [PRINT] additionally opens the browser print dialog with a print stylesheet: calculation sheet (paginated) followed by one level plan per page. This gives PDF output for free via "Print to PDF" today; <u>`[v2]` dedicated customizable PDF export (cover-sheet-friendly: margins reserved for letterhead, column toggles, logo slot)</u>.

---

## 11. Freeware Distribution (new)

- **License:** MIT recommended — permissive, universally understood, and its warranty clause delivers the <u>"no liability"</u> requirement legally ("THE SOFTWARE IS PROVIDED 'AS IS', WITHOUT WARRANTY OF ANY KIND…"). Ship `LICENSE.txt` alongside `index.html`.
- **In-app disclaimer:** first-run dialog + a footer line printed on every calculation sheet, CSV and level plan: *"For preliminary design assistance only. Results must be verified by a qualified engineer. No warranty; no liability."* (Wording for Michael to adjust.)
- **Cover-sheet friendliness:** SETTINGS project-metadata fields (Project, System, Engineer, Company, Date, Revision) printed in the sheet header — engineers slap their letterhead over the reserved top margin.
- **Versioning:** app version + `formatVersion` stamped in every save and printout, so old files remain loadable and printouts are traceable.
- Distribution as a ZIP of the folder (works from file://) — no installer, no server, aligned with the offline requirement.

## 12. Open Questions

None outstanding from v0.1/v0.2 (see changelog). New questions arising during implementation are appended below by Claude Code rather than answered by assumption.

### Q12.1 — Fitting L/D: flat, or size-corrected? **[RESOLVED: flat, as specified]**

§3.3 gives flat L/D values (90° ≈ 30·D, 45° ≈ 16·D, tee-run ≈ 20·D, tee-branch ≈ 60·D). The published ASHRAE tables are *not* flat — small bores run a higher L/D than large ones.

I implemented a size correction `(52/d_mm)^0.12`, clamped to [0.88, 1.40] and normalised to 1.0 at DN50, so DN15 gets ~1.35× and DN300 ~0.9× the flat value. **The shape of that curve is my invention, not sourced from ASHRAE** — plausible, but not authoritative, and it moves reported fitting losses by up to ±35% at the extremes of the size range.

**Michael's decision: use the flat L/D the spec specifies.** The correction has been removed; `EL = (L/D) × d` exactly, asserted in the test suite. If the real ASHRAE table becomes available it reintroduces as a single factor inside `el()` in `data/fittings.js`.

### Q12.2 — Third convergence criterion added to §3.4 *(resolved in code, FYI)*

§3.4 gives two convergence criteria: max head change < 1 mm, nodal imbalance < 0.01 L/s. **These two are insufficient.** A flow circulating around a closed loop satisfies continuity exactly at every node and perturbs no head, so both criteria pass while the loop flow is still numerical residue from the initial guess — a no-demand ring reported a phantom circulation of ~0.046 L/s.

Added a third criterion (flow change settled: `max|ΔQ| < 1e-8 m³/s`, or < 1e-4 of the largest flow). Costs nothing on real networks — the 3×3 test grid still converges in 4 iterations. No decision needed; recorded as a deviation from the written spec. See `docs/ENGINE.md` §3.

### Q12.4 — Tee run/branch is undefined for a symmetric split *(resolved in code, FYI)*

§3.3 assigns tee run/branch by flow: "the leg pair carrying through-flow gets run EL, the diverging/converging leg gets branch EL." **That rule has no answer when two legs carry the same flow** — which is not a corner case but the most ordinary situation in a building: a riser feeding identical floors splits exactly 50/50 at every branch.

Picking by magnitude alone then became a coin flip between two equal numbers, and it self-oscillated: the pick set the equivalent length, the equivalent length nudged the flows, and the nudge flipped the pick back. The 3-floor test model sat in a stable 2-cycle and never converged, reporting a spurious "assignment did not settle" warning. It was also platform-dependent — Chrome and Node landed on different sides of the tie.

Near-ties (within 2%) are now broken on **geometry**, which does not depend on flow and therefore cannot oscillate: among the tied candidates the straightest in→out pair wins. At a riser tee this correctly makes the vertical run the "run" and the floor take-off the "branch", which is also what the physical fitting looks like. Ordering is further tie-broken on node id so the result cannot depend on array order or floating-point noise.

No decision needed unless you want the priority reversed (geometry first, flow only as tie-break) — arguable, since a tee's run and branch are physically fixed by how it is installed and do not change with flow direction. Say the word and I will swap the priority.

### Q12.5 — Velocity / friction-rate warnings moved into the engine *(resolved in code, FYI)*

These were detected only while rendering the calculation sheet, so `solveModel()` reported "no warnings" for a network running at 12 m/s. Correct on screen, silently wrong for any other consumer of a solve. Detection now lives with the physics and emits structured warnings (code, section, value, limit); the UI only reformats them into display units.

### Q12.6 — Pressure-driven delivery for under-supplied systems *(resolved in code, FYI)*

§8.2 reports available vs required pressure at each demand, which assumes every demand draws its full stated flow. That is the right number for **sizing** — the negative pressure is exactly how much head is missing — but it is not what physically happens: water cannot be drawn from a node that has no pressure to give.

A second pressure-driven pass now runs whenever any demand is short. Each unsatisfiable demand is converted from a fixed FLOW to a fixed HEAD at its required pressure and the network re-solved; the flow that then arrives is what the system can really supply. Demands that turn out to be satisfiable are handed back, and the two sets iterate until stable. Back-flow is clamped: a terminal that would have to push water into the network delivers nothing.

Both numbers are reported — the demand-driven pressure in the table, the achievable flow in brackets — because they answer different questions. Costs nothing when the system is adequate (the pass does not run).

### Q12.7 — Auto pumps re-size on every solve *(resolved in code, FYI)*

Previously a pump in 'auto' mode only sized when placed or when the user pressed a button, so its duty went stale the moment anything upstream changed. It now re-sizes on every solve. Measured cost is 1.3–2.6 ms per solve on the 3-floor test model, i.e. negligible.

Two safeguards: pumps carrying no flow are skipped entirely (a disconnected pump cannot affect any pressure, and winding one up stamps a fictitious duty on the saved model — it reached 65 m before this was fixed), and if a round of added head fails to improve the worst shortfall, the useless head is rolled back off and sizing stops.

Sized head includes the §8.4 safety factor: on the 3-floor model, 41.76 m index duty × 1.10 = 45.93 m.

### Q12.12 — Safety factor defaults to 0 *(Michael's decision)*

The default was 10%. Michael: *"set the default safety factor to 0, as most Engineers including myself would usually set it manually after the calculation"* — and a built-in default silently compounds with the margin the engineer adds afterwards, on top of the margins already sitting in the C factor, fitting allowances and equipment ratings.

Default is now 0. The factor applies to the **pump head only**, as a reported selection duty; it never enters the solve, so it cannot inflate flow or friction. Asserted in `supply.test.js`: flows and pressures are bit-identical at 0%, 10% and 50%.

### Q12.11 — The safety factor must not change the answer *(resolved in code, FYI)*

§8.4 lists the safety factor as part of the calculated pump head, and it was applied inside the solve. In a demand-driven (open) system that is harmless — demands are fixed flows, so the margin shows up as surplus pressure. **In a closed circuit it is not**, because the equipment is a resistance, not a fixed flow: a 10% head margin pushed **21 L/s through equipment rated for 20 L/s @ 200 kPa**, and the reported ΔP rose to 220 kPa purely from the square law on the excess flow.

The solve now runs at **design conditions** and the margin is reported separately as a selection duty. On the data-centre model that gives exactly 20.000 L/s @ 200.0 kPa, head required 259.6 kPa, select against 285.6 kPa. On the 3-floor model the index demand residual becomes 0, which is the definition of the index circuit.

Extra head on a fixed-speed pump raises flow rather than sitting spare; real systems are brought back to design flow with regulating valves. Reporting the margin instead of simulating it keeps the calculation at the design point where it belongs.

### Q12.8 — Closed circuits need a pressure datum *(resolved in code, FYI)*

A data-centre chilled-water loop is sealed: pumps, ring main, equipment, back to the pumps, with **no reservoir anywhere**. The solver had no fixed head in that component, so the island rule ("no fixed head and no demand → Q = 0, valid") quietly returned **zero flow for a pumped circuit** — a live system reported as dead.

A component that contains a pump but no fixed head now gets one node pinned as the pressure datum at its own elevation, preferring a pump suction (where a real expansion vessel connects). Continuity forces zero net flow through a single pinned node in a closed loop, so this fixes the datum without injecting or removing water. Reported as the `NO_SOURCE` **hydraulic error** (Michael's wording: a source may be a tank, city mains, or the top-up/expansion tank for closed loops), with a detail line noting that a temporary datum was pinned so the calculation could still proceed. Flows and pressure *differences* are correct; absolute pressures are relative to that point. Verified: adding a real source 1 m before the pump clears the error, passes exactly 0.00 L/s through the source connection, and leaves the hydraulics unchanged.

### Q12.9 — Closed circuits size the pump on FLOW, not pressure *(resolved in code, FYI)*

Pump auto-sizing aimed at demand-node shortfall, and a closed circuit has no demand nodes — so nothing was ever sized. In a closed circuit the **equipment's rated flow is the design flow**. When there are no demands but equipment is present, sizing switches to a flow target, iterating `H ← H × (q_target/q_actual)^1.9` (the circuit is near-quadratic) from a seed of the equipment's own rated ΔP. The §8.4 safety factor is applied once at the end, which lands the delivered flow at about `rated × √1.10`.

Related fix: the "skip pumps carrying no flow" guard from Q12.7 was **flow-based**, which meant a pump starting at zero head could never bootstrap itself. It is now **topological** — a pump is skipped only if it is dead-ended, which no amount of head can overcome.

### Q12.10 — An OFF pump must be isolated, not an open pipe *(resolved in code, FYI)*

There was no way to express "pump off". Modelled as zero head, an idle pump is a **frictionless bypass**: in a parallel pump set the running pump short-circuits backwards through its neighbours. The data-centre test pushed **392 L/s** round the pump hall to deliver 21 L/s to the load, with the three standby pumps each running at −125 L/s.

Pumps now have a third mode, `off`, modelled as blocked — which is what a standby pump behind a closed isolating or check valve actually is. With it, the running pump carries 21 L/s and the idle ones carry nothing. Off pumps are excluded from auto-sizing and from the "pump is doing nothing" warning.

### Q12.3 — Fixed-head pump regularisation *(resolved in code, FYI)*

A pump with fixed head and no curve has `dh/dQ = 0`, which is singular in the GGA matrix. Floored the derivative at 1.0 m/(m³/s), making it a stiff but finite constraint — droop at 5 L/s is 0.005 m, five times below the 1 mm head tolerance. This disappears naturally when pump curves land in v2 (`H = H₀ − a·Q²` has a real derivative).

## 13. Deferred `[v2]` (consolidated wishlist)

<u>Darcy-Weisbach option · better saving & printing · PDF export · customizable print · pump curve input & pump/system curve intersection</u> · rich node mouse-over (minimal tooltip shipped in v1, §10) · EPANET `.inp` export · dog-leg risers · flow/return pairs · balancing valve sizing · PRVs & capped/pressurized sources · demo/sample project button.
