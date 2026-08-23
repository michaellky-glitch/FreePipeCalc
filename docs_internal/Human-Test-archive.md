# Human test log — archive (signed off)

Items Michael has tested and passed. Moved out of `Human-Test.md` on
2026-07-31 so that file shows only what is still outstanding. Kept rather
than deleted: what has been checked, and when, is part of the record.

| # | What | Status | Notes |
|---|---|---|---|
| 8.2 | Equipment drawn as a node (ring), green in service / red isolated | ✅ | **Michael reported it was not shown as a node.** |
| 8.3 | Stopped pump is red with a bar, not a chevron | ✅ | |
| 8.4 | On/off button on the drawing, pumps and equipment | ✅ | Beside the flip button, only while selected. |
| 8.5 | Status as a red/green switch in properties | ✅ | Pumps and equipment. |
| 8.6 | Ribbon: DRAW section becomes VIEW section | ✅ | Corrected from last time — one section that swaps label and contents. |
| 8.7 | ANNOTATIONS moved from SETTINGS to VIEW | ✅ | SETTINGS now points at the new home. |
| 8.8 | ALIGN: drag a node, whole model follows, snaps to grid | ✅ | Verified lengths and shape unchanged (level offsets only). |
| 8.11 | Valve opening slider (0/25/50/75/100) and % shown on the drawing | ✅ | |
| 8.12 | Only Kv **or** Cv shown, switchable in Display units | ✅ | Default Kv. |
| 8.14 | "4 pipes meet at one node" warning gone | ✅ | **Michael asked for this.** Node is still fitted. |
| 8.15 | Pump/equipment stop bar is perpendicular to the pipe | ✅ | **Michael reported this.** |
| 8.17 | ANNOTATIONS closes when leaving VIEW | ✅ | **Michael reported this.** Verified the panel and the flag both clear. |
| 8.21 | Side panel resizable by dragging the divider | ✅ | Double-click resets to 210 px; width kept in localStorage, not in the model file. |
| 7.3 | "View Direction" rename, Look Up / Look Down | ✅ | |
| 7.5 | Type a length while drawing + Enter | ✅ | Verified exact: 12.5 m east, 4 m north, 10 m at 45°. Preview follows the typed number. |
| 7.7 | VIEW replaces LAYOUT; TRACE inside VIEW; DRAW hidden in VIEW | ✅ | |
| 7.8 | Ribbon group labels centred | ✅ | CSS only, never seen. |
| 7.9 | PD/m pipe annotation | ✅ | Verified to agree with the PDM warning to the rounded digit (699.7 → "700Pa/m"). |
| 7.10 | Reverse-direction button beside a selected device | ✅ | Only on pumps/equipment/check valves, only while selected. |
| 7.11 | Warnings chip: hover preview, click to highlight | ✅ | Verified 12 pipes + 3 nodes highlighted, all genuinely warned; toggles off. |
| 7.12 | CLOSED LOOP with an expansion tank and no outflow | ✅ | **Michael reported this.** Now reads CLOSED; all five examples classify correctly. |
| 1.4 | Fitting K values vs. the published table | ✅ | **Checked against Michael's 2021 ASHRAE Fundamentals Ch 22, Tables 3 & 4 (2026-07-31).** 133/144 matched; two real errors found and fixed (threaded 45° ell was invented and up to 250% out; flanged gate valve column was shifted a row). The Hazen-Williams *equivalent-length* table is still unchecked — needs ASHRAE Table 8. |
| 1.9 | Hazen-Williams, straight pipe | ✅ | **Michael validated this.** Mostly correct. |
| 2.1 | Draw a multi-vertex run | ✅ | |
| 2.2 | 15° angle snapping | ✅ | |
| 2.3 | Tee insertion by clicking an existing pipe | ✅ | |
| 2.7 | Copy level layout `[C]` | ✅ | New. Copies everything including sources. |
| 2.8 | Geometry conflict → Cancel / Delete / Repair | ✅ | Repair is a heuristic; the change log is the thing to check. |
| 2.9 | Undo / redo across all of the above | ✅ | |
| 3.1 | Source, demand placement | ✅ | |
| 3.3 | Valve insert, gate/check, 0–100% | ✅ | |
| 3.4 | Equipment insert, rated flow and ΔP | ✅ | |
| 3.5 | Equipment tags on drawing and sheet | ✅ | |
| 4.1 | Toolbar grouping and mode hints | ✅ | Reorganised in v0.4.0. |
| 4.2 | VIEW: drag labels | ✅ | |
| 4.3 | VIEW: "Show on drawing" checkboxes | ✅ | **Michael could not find these.** They appear only in VIEW mode, in the properties panel, under a *Show on drawing* heading, after selecting a DEVICE or a source/outflow node — a plain pipe has none at all, which is likely why they seemed absent. If they are still not findable, the placement is wrong — treat this as a UI defect, not user error. |
| 4.5 | Open/closed loop indicator on the ribbon | ✅ | **New.** Should read OPEN LOOP when an outflow draws water off, CLOSED LOOP for a sealed pumped circuit (even with an expansion tank), NO SUPPLY with neither — and change as you draw. |
| 4.6 | HYDRAULIC tab: editable coefficients inside the formula | ✅ | |
| 4.8 | UI font / label size / arrow size | ✅ | |
| 4.10 | DOCUMENTATION tab | ✅ | **New.** Will not render over `file://` — see the note it shows. |
| 4B.2 | Zero-pressure outflow is refused | ✅ | Both on the field and on entering SIMULATION. |
| 4B.6 | SIMULATION without a curve is refused | ✅ | Error on the mode switch and on every solve. |
| 4C.1 | Generic Pump Curve: NFPA 20 worked example | ✅ | Reproduces the hand calculation exactly — `h(q) = 140 − 0.02q − 2e-5q²`, 125 kPa at 50% flow. |
| 6.4 | Velocity / friction-rate warnings | ✅ | Seen throughout testing. |
