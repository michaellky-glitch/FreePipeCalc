# FreePipeCalc — outstanding work

Everything Michael has asked for that is not yet done, in the order it will be
tackled. Closed items move out to `Human-Test.md` with a verification note.

Updated 2026-08-08, after v0.15.5.

---

## Done in v0.15.6

C8 · E1 · E2 · E3 · C5 · C6 · C2 — see `Human-Test.md` §5C.

**C3 did not reproduce.** Every sensor button places its own kind in this build
(`dP` → `dP`), verified by driving all five. What I *did* find at the same spot
is C1: a click near a node hit-tests onto the wrong pipe — a 25 m run reported a
1 m device pipe under the cursor. That is very likely what you were seeing, and
it is the same fault as "difficulty selecting CHWP-1". Moved up.

## Next

| # | Item | Notes |
|---|---|---|
| C1 | **Hit-testing picks the wrong pipe near a node** | Confirmed: clicking the middle of a 25 m pipe returned an adjacent 1 m device pipe at `t = 0`. Explains both the CHWP-1 selection trouble and probably C3. |
| C4 | **Sync links** — pump↔pump VFD %, CV↔CV opening % | What C8's message tells the user to do, so it has to exist. |
| C7 | Manual VFD slider when a pump has no control link | |
| A1 | Zero flow should draw no arrow | |
| A2 | **Text box does not appear** | Dialog opens, nothing lands on the drawing. |
| A4 | Details not selectable or editable | |
| A5 | Detail tool active → palette + thickness in Properties | |
| A3 | Detail needs angle and grid snapping | |
| A6 | Rename `Link Node` → `Add Link Node`; click any point on a link to add one | |
| A7 | Link nodes hard to grab over pipes | Bigger target, or make pipes unpickable in Annotation. |
| Q4 | Drag-snap to grid intersections along the pipe (0.1 m) | Presentation only; the pipe stays straight. |

## Superseded

(nothing yet)

## Then

| # | Item | Notes |
|---|---|---|
| S4 | **Static / Dynamic** in the Simulate ribbon | Static is default and blocks edits that change the answer. |
| S3 | Simulation progress bar | |
| S2 | Simulate lag; selection freeze | ~30 s on the DC model. S4 and S3 make it bearable; this makes it faster. |
| S1 | Riser should show pipe properties | |
| Q1 | TOOLS becomes a moveable in-UI window | Button in Design, Control and Simulate. |
| Q2 | Tools tabs: pump curve · critical radius · pipe velocity & friction · heat transfer | |
| Q3 | Velocity/friction fields update each other | Enter any two, get the third. |

## Open questions for Michael

* **UI.6** — Temperature limit Max/Min is an indicator that follows the load
  direction, not a second input. Say if you want it settable.
* **UI.15** — blank capacity means unlimited; there is no auto-balance mode.
* **DB.5** — is 0.2% the right flow deadband?
* **DX.1** — does the DXF open in real CAD?
