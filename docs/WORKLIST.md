# FreePipeCalc — outstanding work

Everything Michael has asked for that is not yet done, in the order it will be
tackled. Closed items move out to `Human-Test.md` with a verification note.

Updated 2026-08-08, after v0.15.5.

---

## Done in v0.15.9

CH (chilled-water pumps) · SY (sync drawn) · tag guard + REPAIR — `Human-Test.md` §5F.

**The annotation batch is untouched this turn** — A2, A4, A5, A3, A6, A7, then Q4.
Next.

## Done in v0.15.8

C4 · Q5 (reworked to Ctrl) · Q6 (shift = select the run) — see `Human-Test.md` §5E.

## Done in v0.15.7

C1 · C7 · A1 · E4 · Q5 — see `Human-Test.md` §5D.

**C1 was not what I said it was.** My reproduction was faulty: the pipe I
"clicked the middle of" was on a different LEVEL, so ignoring it was correct,
and the 14 m radius I complained about is 28 screen pixels behaving exactly as
designed. The real fault was narrower and is fixed: picking a controller took
`deviceAt || pipeAt` and a pump sits IN a pipe, so a click a few pixels off the
symbol found the plain pipe, `canControl` said no, and you were told to click a
pump while pointing at one.

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

* **DX.1** — does the DXF open in real CAD? *Untested; left open.*

### Ruled on 2026-08-08

* **UI.6** — Max/Min indicator: current implementation is correct. Closed.
* **UI.15** — blank = unlimited is correct, but the box shows a grey `Auto`
  placeholder: unlimited and auto are the same thing to the user. → **E4**.
* **DB.5** — 0.2% flow deadband confirmed. Closed.
