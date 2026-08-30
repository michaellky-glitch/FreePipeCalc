# Session prompt — FreePipeCalc, from 2026-08-31

Paste the block below to start the next session.

---

FreePipeCalc — picking up 2026-08-31. Offline single-page building-services
piping calculator; no build step, must run from `file://`; classic `<script>`
tags on a global `FD`. `cd /home/michael/Documents/FreePipeCalc`.

**Read first:** `docs_internal/HANDOVER.md` §0 — it is written as a
"where everything stands" block, and the traps in it are ones that already cost
time. Then `WORKLIST.md` for the backlog, and `docs_internal/TEE-LOSSES.md` if
the tee work is the target.

**State: NOTHING IS PUSHED.**

| | version | state |
|---|---|---|
| `master` | v0.18.30 | 1 ahead, unpushed |
| `tee-fittings` | v0.18.31-tee | 17 ahead, unpushed — TEE.1 built |
| GitHub Pages | v0.18.29 | what I actually see |

Eleven suites, 2487 assertions, all green
(`for f in test/*.test.js; do node $f; done`).

**Working rules.** Bump the `?v=` token in `index.html` and `FD.VERSION`
together after editing any file, including `styles.css`. **Ask before pushing** —
I have asked for "bump, don't push" repeatedly, and I test off GitHub Pages so a
push is what puts a change in front of me. CI gates the Pages deploy on the test
suite. End commit messages with
`Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>`.
Verify live by serving the folder on loopback and driving the DOM — screenshots
render nothing, so appearance is mine to judge; log visual items in
`Human-Test.md`. When writing documents use ASD-STE100 plain English, no
headline sentences, and the callout tags `.note.rule` → **NOTE:**,
`.note.limit` → **IMPORTANT:**, `.note.check` → **SUGGESTION:**.

**Do not re-derive these — they are decided:**

* `test/fixtures/highrise-variable-primary.pnet.json` is VARIABLE PRIMARY —
  PMP-1 and PMP-2 duty, PMP-3 standby. Misreading it cost most of a session.
* The 44-second data-hall solve is real compute and is **not to be optimised**
  (WORKLIST PERF.1).
* Tee losses: **option C** — the flow-ratio branch coefficient goes on the
  DARCY path only, Hazen-Williams keeps its flat equivalent lengths and warns.
* A DESIGN calculation charges a controlled valve at full travel (DS.1, built).
* Kinematic viscosity stays constant per fluid at 20 °C. May change later.
* `docs/Tutorial 2 Docs/`, `docs_internal/Draft/` and `Fixed/` are my own
  untracked work. Ask before committing them.

**Where to start, in the order I would raise it:**

1. **TEE.1 in SIMULATION.** It is measured in design only. The control loop
   re-derives fittings every pass, so the zero-flow clamp matters more there.
   Do this before proposing a merge to master.
2. **TH.1** — plant-level shortfall (option 1, decided), then a graceful chiller
   overload to ~110% instead of the thermal runaway. Ask me about the overload
   margin and whether power draw should be modelled.
3. **DP.1** — at a 200 kPa setpoint the pump sits at 86%, not at its ceiling,
   reports state `on`, and `SETPOINT_LOST` fires anyway. That contradiction is
   the thread. It is also step 7 of Tutorial 02.
4. Tutorial 02's energy story is undersold; MSG.2; DS.2; the `user-manual.html`
   overlap with my own tutorials.

I will tell you which of these I want. Do not start the big ones without asking.
