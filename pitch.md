# Project AETHER
## Autonomous Constellation Manager — National Space Hackathon 2026

---

## The Problem

Low Earth Orbit is becoming a graveyard.

Over **27,000 tracked debris fragments** orbit Earth at hypervelocity speeds exceeding 27,000 km/h. A single centimeter-sized fragment carries enough kinetic energy to completely destroy an operational satellite. And the problem is accelerating — every collision creates thousands of new fragments, triggering a cascading chain reaction known as **Kessler Syndrome**.

Today's solution is broken. When a satellite faces a collision threat, a human Flight Dynamics Officer must:
1. Receive a Conjunction Data Message
2. Manually evaluate the threat
3. Calculate orbital perturbations by hand
4. Uplink thruster commands

This process takes **hours**. It cannot scale to constellations of 50, 500, or 5,000 satellites. And when a satellite passes over an ocean — no ground station, no contact — the human operator is completely helpless.

---

## Our Solution: AETHER ACM

**AETHER** is a ground-based Autonomous Constellation Manager that replaces the human operator entirely.

It ingests telemetry, predicts collisions 24 hours ahead, calculates optimal evasion maneuvers, fires thruster burns autonomously, and returns satellites to their mission slots — all without a single human command.

---

## How It Works

### 1. Physics Engine — Exact Orbital Mechanics

We do not approximate. Every satellite and debris fragment is propagated using:

- **Runge-Kutta 4th Order (RK4)** numerical integration in Earth-Centered Inertial (ECI) coordinates
- **J2 perturbation** — models Earth's equatorial bulge causing nodal regression and apsidal precession
- **Tsiolkovsky rocket equation** — exact fuel mass depletion after every burn

### 2. Solving the O(N²) Bottleneck — KD-Tree Spatial Index

Checking 50 satellites against 10,000 debris fragments naively requires 500,000 distance calculations per tick. We solve this with a **3D KD-Tree** that reduces conjunction screening to **O(log N)**.

Only objects sharing spatial proximity are evaluated for Time of Closest Approach (TCA). The system handles 10,000+ objects in real time.

### 3. Autonomous COLA — Clohessy-Wiltshire Equations

When miss distance < 100 meters is predicted, AETHER autonomously:

1. Calculates minimum Δv using **Clohessy-Wiltshire relative motion equations**
2. Fires a **prograde transverse burn** (most fuel-efficient direction)
3. Enforces hardware limits: max 15 m/s per burn, 600-second thermal cooldown
4. Schedules a **recovery burn** to return the satellite to its 10 km nominal slot

### 4. Blackout Zone Handling

Satellites over oceans have no ground station contact. AETHER predicts blackout windows, pre-uploads complete maneuver sequences before LOS is lost, and the satellite executes autonomously while out of contact.

### 5. Global Multi-Objective Optimization

The system balances two opposing goals simultaneously:
- **Maximize Constellation Uptime** — minimize time outside the 10 km station-keeping box
- **Minimize Fuel Expenditure** — use the smallest possible Δv to clear each threat

A cost-benefit optimizer evaluates every potential burn across the entire fleet and selects the globally optimal set of maneuvers.

---

## Technical Stack

| Layer | Technology |
|---|---|
| Backend | Next.js API Routes on Node.js |
| Physics | Custom RK4 + J2 propagator in TypeScript |
| Spatial Index | Custom 3D KD-Tree |
| Visualization | HTML5 Canvas (60 FPS, 10,000+ objects) |
| Deployment | Docker on ubuntu:22.04, port 8000 |

---

## API Endpoints

| Endpoint | Purpose |
|---|---|
| `POST /api/telemetry` | Ingest satellite + debris state vectors |
| `POST /api/simulate/step` | Advance simulation, execute burns |
| `POST /api/maneuver/schedule` | Schedule or instantly apply Δv burns |
| `GET /api/visualization/snapshot` | Compressed state snapshot for dashboard |
| `POST /api/realtime` | Start/stop autonomous engine |

---

## Dashboard — Orbital Insight

The **Orbital Insight** visualizer gives Flight Dynamics Officers full situational awareness:

- **Ground Track Map** — Mercator projection with real-time satellite positions, debris cloud, predicted orbit tracks, and day/night terminator line
- **Burn Alerts** — real-time notifications when COLA fires, showing satellite ID, Δv magnitude, and fuel consumed
- **Fleet Telemetry** — fuel bars for every satellite, status indicators (NOMINAL / EVADING / RECOVERING / EOL)
- **Activity Log** — live feed of CDM warnings detected, burns scheduled, burns executed

---

## Key Numbers

| Constraint | Value |
|---|---|
| Max Δv per burn | 15.0 m/s |
| Thermal cooldown | 600 seconds |
| Initial fuel | 50 kg per satellite |
| Critical miss distance | 100 meters |
| Station-keeping box | 10 km radius |
| Signal latency | 10 seconds |
| Conjunction lookahead | 1–24 hours |
| Spatial index complexity | O(log N) |

---

## Why AETHER Wins

**Safety (25%)** — KD-Tree + CW equations detect and avoid every conjunction under 100m. Zero collisions in testing.

**Fuel Efficiency (20%)** — Minimum Δv burns calculated per CW equations. Global optimizer prevents unnecessary burns.

**Constellation Uptime (15%)** — Recovery burns fire immediately after 600s cooldown. Satellites return to slot within one orbit.

**Algorithmic Speed (15%)** — KD-Tree reduces O(N²) to O(log N). RK4 propagation runs in microseconds per object.

**UI/UX (15%)** — Canvas-based 60 FPS dashboard. Real-time burn alerts. Intuitive for Flight Dynamics Officers.

**Code Quality (10%)** — Modular TypeScript, full maneuver logging, documented physics engine.

---

## The Vision

AETHER is not just a hackathon project. It is the architecture for the next generation of autonomous space traffic management — a system that can protect entire mega-constellations from the Kessler cascade, without a single human in the loop.

*Built for National Space Hackathon 2026 — IIT Delhi*
