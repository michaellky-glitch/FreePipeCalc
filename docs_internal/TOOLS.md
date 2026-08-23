# Tools

The TOOLS window holds standalone calculators. Each calculator takes numbers in and gives numbers out. None of them writes to the network unless you copy a result and paste it yourself. This means you can check a tool with a hand calculation, and a bug in a tool cannot silently corrupt a model.

Open the window with the **TOOLS** button in Design, Control or Simulate. The window is movable. Its position and open state are saved in `localStorage`; they are a UI preference, not model data, so a `.pnet.json` file never carries someone else's window position.

---

## 1. Pump curve

### What it does

Build a pump curve through three stated points. The tool draws the curve and copies the points so you can paste them into a pump.

### Why it replaced the old generator

Earlier versions guessed a curve from the design duty with the EPANET single-point rule: shutoff head at 133% of design head, runout at 200% of design flow. That guess was one manufacturer-agnostic shape presented as the answer. It cannot match real specifications. For example, NFPA 20 allows shutoff head up to 140% of rated head and requires at least 65% of rated head at 150% of rated flow. The single-point rule cannot reach either limit.

So the tool asks for the three points instead of inventing them.

### Inputs

| Input | Meaning |
|---|---|
| Design point | Flow and pressure, in your display units |
| Fit point 1 | Flow and pressure as a percentage of the design point |
| Fit point 2 | Flow and pressure as a percentage of the design point |

Fit point 1 is normally shutoff (0% flow). Fit point 2 is normally runout (150% flow). Any three distinct flows work.

Press **NFPA 20** to fill the fit points with 0% / 140% and 150% / 65%.

### Method

The tool fits an exact quadratic through the three points:

```
h(q) = a + b·q + c·q²
```

It uses Newton's divided differences:

```
m01 = (h1 − h0) / (q1 − q0)
m12 = (h2 − h1) / (q2 − q1)

c = (m12 − m01) / (q2 − q0)
b = m01 − c·(q0 + q1)
a = h0 − b·q0 − c·q0²
```

This is interpolation, not a fit. The curve passes through all three stated points exactly.

### Worked example

Rated duty: 1000 L/s at 100 kPa. NFPA 20 envelope:

| Point | Flow (L/s) | Head (kPa) |
|---|---|---|
| Fit point 1 — shutoff | 0 | 140 |
| Design | 1000 | 100 |
| Fit point 2 — runout | 1500 | 65 |

```
m01 = (100 − 140) / (1000 − 0)   = −0.04
m12 = (65 − 100) / (1500 − 1000) = −0.07

c   = (−0.07 + 0.04) / 1500      = −2 × 10⁻⁵
b   = −0.04 − (−2 × 10⁻⁵)(1000)  = −0.02
a   = 140

h(q) = 140 − 0.02·q − 2 × 10⁻⁵·q²
```

At 50% flow: `140 − 10 − 5 = 125 kPa`.

### Sanity checks

The tool refuses or warns if the result is not a usable pump curve:

- Two fit points at the same flow — one flow cannot have two heads.
- Head that rises with flow anywhere in the working range.
- A concave-up curve, which most real pumps are not.
- The table stops at the flow where head reaches zero. Negative head is not tabulated.

### Copying the curve into the model

The solver stores a curve as `H₀ − a·Q^b`. That form has no linear term, so it cannot hold a quadratic exactly. The paste is therefore lossy. The tool offers two copy modes:

| Mode | The three stated duties | Shape between the points |
|---|---|---|
| Copy the three defining points (default) | Exact (~10⁻⁶ kPa) | Up to ~1.3% off |
| Copy the full table (0–150% in 10% steps) | All three shift ~1% | r² ≈ 0.9997 |

Copy the three points unless you have a reason to prefer the shape. The stated duties are the contractual values. The interpolation between them is only an interpolation.

To paste: select a pump in the network, then choose **Paste curve data**. Columns are flow and head in the same units the tool displayed.

### Known limitation

The round trip through `H₀ − a·Q^b` is the weak link. It exists only because the solver's curve form predates this tool. Storing the quadratic directly (`a + b·q + c·q²`) would remove the loss, and the derivative (`dh/dq = b + 2c·q`) is no harder than the power-law derivative the solver already handles. This change has not been made because it changes the stored model format.

---

## 2. Critical radius

### What it does

Find the insulation critical radius for a pipe and show the heat loss and surface temperature at a chosen thickness.

### The important fact

The critical radius does **not** depend on temperature.

```
r_cr = k / h
```

The critical radius comes only from the insulation conductivity `k` and the outside surface coefficient `h`. It is the radius at which adding insulation stops increasing the surface area faster than it adds resistance. Ambient and fluid temperature do not appear in the formula, and they cannot: doubling the temperature difference doubles the heat flow at every radius but does not move the turning point.

The practical answer is almost always the same. With polyurethane at `k = 0.02 W/m·K` and still air at `h = 8 W/m²·K`, `r_cr = 2.5 mm`. Every pipe in the app's schedules is larger than that, so insulation always reduces the loss. The critical radius binds only for thin wires and small tubes.

### Inputs

| Group | Input |
|---|---|
| Pipe | Outside diameter (mm), insulation `k` (W/m·K), surface coefficient `h` (W/m²·K) |
| Temperatures | Ambient (°C), fluid (°C) |

Ambient and fluid temperature are used for the surface temperature and the heat loss at the chosen thickness. They do **not** change the critical radius.

### Outputs

- Pipe radius, critical radius and critical thickness.
- Rounded thickness, rounded up to the next 25 mm. A rounded-down thickness could sit below the critical radius, so the tool always rounds up. The minimum is 25 mm.
- Heat loss, surface temperature and loss per metre for the bare pipe and for the rounded thickness.

The surface temperature is the value to compare against the dew point on a chilled-water system. Condensation-control thickness is a different calculation and needs the room humidity, which the app does not hold.

---

## 3. Hydraulic

### What it does

Enter any two of flow, bore and velocity; the tool calculates the third. It also gives the friction gradient, Reynolds number, flow regime, velocity head and the nearest schedule size up.

### The core relation

```
Q = v · A,   A = π·d²/4
```

You choose what to solve for from a drop-down. The tool does not guess from the last box you typed in, because guessing would overwrite the box you are about to correct. The derived box is read-only.

### Solve modes

| Mode | Inputs | Output |
|---|---|---|
| Pipe diameter (from velocity) | Flow, velocity | Bore |
| Pipe diameter (from friction drop) | Flow, friction gradient | Bore |
| Velocity | Flow, bore | Velocity |
| Flow | Bore, velocity | Flow |
| Friction drop | Flow, bore | Friction gradient |

### What comes out with it

| Output | How it is calculated |
|---|---|
| Friction gradient | Through `FD.hydraulics`, exactly as `network.build` assembles a pipe. Same method, same context, same C factor. |
| Reynolds number and regime | Laminar, transitional or turbulent, from the model fluid. A laminar answer is flagged because Hazen-Williams is not valid there. |
| Velocity head | `v²/2g` |
| Over 100 m | The gradient in your pressure unit |
| Nearest size up | Through `FD.schedules.sizeForFlow`, the schedule's own sizing rule. The tool always rounds up so the velocity does not exceed what you asked for. |

Sizing falls out of the tool naturally. Give a flow and the velocity you are prepared to run at, and the bore you get back is the bore you need.

---

## 4. Heat transfer

### What it does

Use `Q = ṁ·Cp·ΔT` to find any one of duty, flow or temperature difference from the other two. This is the same relation the equipment panel keeps between capacity, design flow and design ΔT.

### Inputs

| Mode | Inputs | Output |
|---|---|---|
| Flow | Duty, ΔT | Flow |
| ΔT | Duty, flow | ΔT |
| Duty | Flow, ΔT | Duty |

Density and specific heat come from the model fluid through `FD.fluids.resolve`. A glycol model gives a glycol answer.

If the fluid properties are not verified against a printed table — propylene glycol is currently unverified — the tool says so on screen. Specific heat scales every answer here linearly.

### Outputs

- Duty (kW)
- Volume flow
- Mass flow (kg/s)
- ΔT (K)
- Capacity rate `ρ·q·Cp` (W/K), the figure the control loop works in

---

## 5. Convert

### What it does

Two-way unit conversions for temperature, temperature difference, pressure and flow. Type in either box and the other follows. There is no direction to choose and no calculate button.

### Rows

| Row | Converts |
|---|---|
| Temperature (absolute) | °C ↔ °F, with the 32° offset |
| Temperature difference (ΔT) | K / °C difference ↔ °F difference, with no offset (`1 K = 1.8 °F` of difference) |
| Pressure | kPa, bar, psi, m H₂O, mm Hg, ft wg |
| Flow | L/s, L/min, m³/h, gpm (US) |

The pressure and flow factors come from `FD.units`, so the tool cannot drift from the rest of the app.

---

## 6. Find

### What it does

Search the model for a pipe or node by tag or internal ID, then jump to it on the drawing.

### How it searches

- Case-insensitive substring match.
- Matches both the tag and the internal ID.
- Tag matches sort above ID matches.

This is the one tool that reads the model, but it only reads and navigates. It changes nothing.

### Using a result

Click a result to switch to its floor, centre it and select it.

---

## 7. Monitor

### What it does

Pin the properties of one or more devices so they stay visible while you work elsewhere. The properties panel shows one selected device, and the canvas shows one level. Tuning a valve on one floor against a fixture on another used to mean switching floors and losing the selection. Monitor keeps the devices side by side.

### How it works

- Select a device on the drawing — an outflow, pump, valve, piece of equipment or pipe.
- Press **+** to add it to the monitor.
- Press **−** to remove the last device, or press **×** on a card to remove one device.
- Click the device tag on a card to jump to it on the drawing.

The cards use the same renderers as the left-hand properties panel. A monitor that disagrees with the panel would be worse than no monitor, so the panels are not re-implemented.

The monitor list is saved with the model.

---

## About the window

All seven tools live in one moveable window. They are shown one at a time, chosen from a tab strip, because the window is narrow and stacking every tool would put the one you want several screens down.

Press **Enter** in any calculator to press its primary button. Convert has no button because it updates live.
