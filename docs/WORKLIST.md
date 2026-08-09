# FreePipeCalc — outstanding work

Everything Michael has asked for that is not yet done, in the order it will be
tackled. Closed items move out to `Human-Test.md` with a verification note.

Updated 2026-08-08, after v0.15.5.

---

## DECISION NEEDED — Design ΔT (LS.5), with the evidence in

Michael's manufacturer part-load table (2026-08-09) proves the current model
wrong, and I have **built the fix, tested it against all nine rows, and then
reverted it** — because it breaks one of his own models and the migration is his
call, not mine.

**What the table shows.** LFT is held at **20.00 °C in every row**, and the duty
is exactly `ṁ·Cp·(EFT − LFT)` throughout — reproducing all nine rows to within
0.7%. 12 K at design because that is design flow at design return; at 30% load
the flow floors at its minimum 9.464 L/s and the **ΔT collapses to 10.5 K**.
Nothing in the table is limited by ΔT.

**What the model does now.** `dTMax` clamps the temperature change at any flow,
which caps duty at `C·ΔT_max` — and C falls with flow, so the model says
throttling a chiller reduces its capacity. On the DC model every machine sits at
26–50% of nameplate reporting "limited by Design ΔT" while its coils starve.

**The fix**, which worked and passed the table: stop clamping ΔT; when no `qMax`
is stated, derive the capacity from the design point (`ρ·q_rated·cp·ΔT_design`,
flow-independent). On his chiller that gives 27.65 L/s × 12 K = 1389 kW against
a 1380 kW nameplate.

**Why it is reverted.** `test/fixtures/economizer-trim` has no `qMax` on ACCH-1
and was relying on the clamp to hold exactly 15 K. With a fixed derived capacity
it over-cools at reduced flow (16.5 K), the mix lands at 13.5 °C instead of 20,
PMP-02 saturates and **the model stops converging**. That is not a test to
renumber quietly — it is a real change to how an existing drawing behaves.

**What I need from you:** either
1. accept that models without an explicit capacity must gain one (I will add
   `qMax` to the fixture and re-derive its expectations), or
2. keep ΔT as a clamp for machines with no stated capacity and drop it only when
   `qMax` is given — a compatibility rule, and uglier.

I would take (1). Say which and it lands in one pass.

## Now — the next thing to do

**Make the control loop yield.** The only remaining cause of the freeze is that
`runControls` is one uninterruptible block. The atom that would work is a single
`evaluate()` (~100 ms); reaching it means turning the loop into a generator so
`seek` can yield mid-search — every `evaluate()` becoming a `yield*` through
`seek` and the sweep loop, with two drivers (a synchronous one for
`solveModel`/tests, an async one for the app).

It is mechanical but it is the most delicate code in the project, and it wants
Michael present to test. Slicing at the DEVICE boundary was tried in v0.16.0 and
backed out: one device's search is ~15 solves, so it still blocked for seconds,
and each resumed slice re-ran all the non-control work.

## Done in v0.16.1

LS.1 · LS.2 (stale control error and state) · A3 · A5 · A6 · A7 — `Human-Test.md` §5H.

**Waiting on Michael: LS.5** — whether Design ΔT should stop clamping the duty
at part flow. It is why the chillers sit at 26–50% of capacity and the AHUs
starve, and fixing it changes the physics of every existing model.

Still open in the batch: **A2** (text box does not appear) and **A4** (details
selectable).

## Done in v0.16.0

Selection no longer solves · STATIC/DYNAMIC · skyline SPD solve · progress bar
— see `Human-Test.md` §5G.

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
