# Security review — 2026-08-23 (v0.18.8)

Requested by Michael: "ensure the program is safe to use and does not expose the
end user to any risks." This is the record of what was examined, what was found,
and what was changed.

Reviewed at v0.18.7. Fixes shipped in v0.18.8. Every finding below was
REPRODUCED in the running app before it was fixed, and the fix was re-tested
against the same attack.

---

## 1. The threat model

FreePipeCalc has no server, no accounts and no network access, so the usual web
attack surface does not apply. What it does have is a FILE FORMAT that engineers
send each other. The realistic attack is therefore:

> An engineer receives a `.pnet.json` from a colleague, a contractor or a
> supplier, and opens it.

Everything in `m.settings`, `m.customSchedules`, every tag and every project
field comes out of that file. The question the review asks is: what can a
crafted file make the program do?

A second, quieter risk matters as much for an engineering tool: whether the
program can silently CHANGE A NUMBER a checking engineer would rely on.

---

## 2. Findings

### 2.1 Stored cross-site scripting through a pipe-schedule name — HIGH, FIXED

`m.customSchedules` is read straight from the file (`model.js`, `fromJSON`).
The THERMAL tab built its insulation table with

    tbl.innerHTML = '<thead><tr><th class="txt">' + curS.name + '</th>' + ...

so a schedule NAME containing markup ran as script the moment the user opened
the THERMAL tab.

**Reproduced.** A file carrying

    "customSchedules": { "evil": { "name": "Sch40<img src=x onerror=...>", ... } }

executed its payload on the first render of the tab. An injected element was
present in the DOM.

**Why it matters here.** Script running in the page can read and rewrite the
model, so it can alter pipe sizes, duties or the calculation sheet silently — a
correctness and liability problem before it is a browser one. It can also reach
the network (outbound requests work from `file://`), so the model can be
exfiltrated.

**It persisted.** Custom schedules are written to `localStorage` on the next
save (`app.js`), so once the user made ANY edit the payload survived the file
being closed and ran again on every later launch. Confirmed, and the test
storage was cleaned up afterwards.

**Fix.** The header is built with `theadRow()`, which goes through `el()` and
therefore `textContent`. Markup in a name is now shown as the characters it is.
Re-tested with the same file: nothing executes, no element is injected, the name
renders as inert text.

### 2.2 Stored cross-site scripting through a display unit — HIGH, FIXED

The same class, a different door. `m.settings.display.flow` / `.pressure` come
from the file, and the TOOLS window built a table header with

    t.innerHTML = '... <th>Flow (' + fu + ')</th> ...'

**Fix.** Same treatment — `theadRow()` in `tools.js`.

### 2.3 CSV formula injection — MEDIUM, FIXED

Tags and project fields are written into the CSV export. A spreadsheet treats a
cell beginning `=`, `+`, `-` or `@` as a FORMULA, so a tag of
`=cmd|'/c ...'!A1` in a shared model becomes an executable cell in the exported
sheet — the classic path from "I exported a calculation" to code running on the
checker's machine. The existing quoting was correct CSV quoting and does not
prevent this.

**Fix.** `csvSafe()` prefixes an apostrophe to any cell that starts with one of
those characters. **A number is deliberately left alone**: `-5.2` legitimately
starts with a minus, and quoting it would turn a figure into a string in every
spreadsheet that opened it. The guard applies only where the cell is not a plain
number (integer, decimal or scientific). Verified against both.

---

## 3. Examined and found sound

| Area | Result |
| --- | --- |
| **Network egress** | **None.** No `fetch` to a remote host, no `XMLHttpRequest`, no `WebSocket`, no `sendBeacon`, no CDN, no fonts, no analytics. The only external URL in the program is the GitHub link in the masthead, and it carries `rel="noopener noreferrer"`. The app cannot phone home, and there is no telemetry to switch off. |
| **Code execution** | No `eval`, no `new Function`, no `document.write`, no `insertAdjacentHTML`, no string-form `setTimeout`/`setInterval`, anywhere in `src/` or `data/`. |
| **Prototype pollution** | Tested with `__proto__` payloads at both the document and the `settings` level. `Object.prototype` was not touched. |
| **Remaining `innerHTML`** | 24 sites remain; every one is either a clearing `= ''` or a fixed literal string. None takes model data. Re-scanned after the fixes. |
| **Printed plans (SVG)** | `printer.js` builds every node with `createElementNS` and writes every label with `textContent`. Tags cannot inject. SVG is the one export format that CAN carry script, so this was checked specifically. |
| **DXF export** | `dxf.js` forces text through `ascii()`, and layer names further through `[^A-Za-z0-9_-] -> _`. DXF is not executable in any case. |
| **Dialogs, canvas** | `dialog.js` and `canvas.js` contain no HTML sink at all. |
| **Data files** | `data/*.js` are literal tables. No executable content. |
| **Documentation frame** | The iframe `src` comes from the hard-coded registry in `docs.js`, not from anything a user supplies. |

---

## 4. What is NOT protected, by design

* **The program does not verify that a model file is trustworthy**, and cannot.
  It has no signature and no origin. The fixes above mean a hostile file cannot
  RUN anything; they do not mean the ENGINEERING in a received file is right.
  A file from someone else is an untrusted drawing and still needs checking.
* **`file://` gives no sandbox.** Anyone who can write to the program folder can
  change the program. Keep the folder where the user controls it.
* **Nothing is encrypted.** The model in `localStorage` and on disk is plain
  text, which is the correct trade for a tool with no accounts, but it is worth
  knowing if a model is commercially sensitive.

---

## 5. How to re-run this

The checks that are cheap to repeat:

    grep -rn "innerHTML" src/*.js | grep -vE "innerHTML\s*=\s*''"
    grep -rnE "eval\(|new Function|document\.write|insertAdjacentHTML" src/*.js
    grep -rnE "fetch\(|XMLHttpRequest|WebSocket|sendBeacon" src/*.js

The rule the first one is protecting: **anything that comes out of a model file
is DATA. It goes into the DOM as text, never as markup.** If a table header ever
needs a value from the model again, use `theadRow()`.
