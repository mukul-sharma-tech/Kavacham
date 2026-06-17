# Project Kavacham

## 🌟 Overview

The Kavacham : AETHER Autonomous Constellation Manager (ACM) is a high-performance, predictive backend and 2D operational dashboard built for the National Space Hackathon 2026. It acts as a centralized  brain to autonomously navigate a fleet of 50+ satellites through a heavily congested Low Earth Orbit (LEO) populated by tens of thousands of tracked debris fragments.

Our solution replaces legacy human-in-the-loop manual collision avoidance with a rigorous physics simulation, spatial indexing, and optimization engine for predictive conjunction assessment, maneuver execution, and station-keeping.

---

## 🧠 Logic and Algorithmic Approach

The ACM core relies on deterministic physics and advanced data structures rather than reactive scripting or basic if/then rules.

### 1. Physics Engine & Orbital Propagation
- Numerical Integration: Runge-Kutta 4th Order (RK4) integrator in Earth-Centered Inertial (ECI) coordinates.
- J2 Perturbation: Explicit J2 acceleration computation to model nodal regression and apsidal precession.
- Fuel Depletion Tracking: Tsiolkovsky rocket equation with an initial 50.0 kg propellant budget and dynamic mass reduction.
- Δv Vector: Local RTN (Radial-Transverse-Normal) Δv is computed then converted to ECI for application.
- Burn Preference: Priority for transverse (prograde/retrograde) burns for optimal efficiency.

### 2. Solving the O(N²) Bottleneck (Predictive CA)
- Spatial Indexing: 3D spatial tree (Octree/KD-Tree style) groups objects into hierarchical cells.
- Search Pruning: Only evaluate TCA for objects in same/adjacent buckets, not fully O(N²).
- 24-hour lookahead window with selective refinement.

### 3. Autonomous Collision Avoidance (COLA) & Station-Keeping
- Evasion Burn: If miss distance < 100 m, compute optimized RTN Δv and convert to ECI.
- Recovery Burn: Schedule follow-on burn to return to 10 km nominal slot ASAP while minimizing penalties.
- Uptime Penalty: Time outside slot is tracked; fast re-entry is priority.

### 4. Global Multi-Objective Optimization & Propellant Budgeting
- Fuel Tracking: Calculate mass and fuel consumption continuously using Tsiolkovsky equation.
- Minimum Δv: Burn magnitude chosen to barely clear critical threshold.
- Hardware Limits: Enforce 15.0 m/s max per burn, 600 s cooldown between burns.
- EOL Handling: If fuel <5%, schedule final graveyard maneuver.- **Global Optimizer**: Multi-objective algorithm balancing fuel efficiency vs constellation uptime using cost-benefit analysis with weights (fuel penalty: 1000, uptime value: 10, collision risk: 10000).
### 5. Communication Latency & Blackout Management
- LOS Requirement: Maneuvers only upload if satellite has line-of-sight to ground station (with elevation constraints).
- Predictive Scheduling: Preload full maneuver sequence when entering blackout zone with 10-second latency buffer.
- Ground Stations: Uses ground_stations.csv network and coverage modeling.

---

## 💻 Tech Stack & API Architecture

### Backend (Node.js + Next.js API on port 8000)
- POST /api/telemetry: ingest massive telemetry batches asynchronously.
- POST /api/simulate/step: immmediate simulation tick (fast-forward integrator).
- POST /api/maneuver/schedule: register optimized Δv maneuver sequences.
- GET /api/visualization/snapshot: compressed tuple-based state snapshot.

### Frontend (Next.js + WebGL/Canvas)
- Orbital Insight visualizer renders 10,000+ objects at ~60 FPS.
- Ground Track Map, Bullseye Plot, Telemetry/Maneuver timeline and fuel heatmap.

---

## 🛰️ Visualizer Modules

- **Ground Track Map**: 2D Mercator projection, predicted trajectory, terminator line.
- **Bullseye Plot**: Polar risk plot of TCA/debris approach vectors.
- **Telemetry + Maneuver Gantt**: Fuel gauges, burn blocks, 600 s cooldown indicator.

---

## 📦 Deployment Instructions

Critical: Docker-based evaluation (ubuntu:22.04 base, port 8000 binding 0.0.0.0).

### Build Docker image
`ash
docker build -t aether-acm .
`

### Run container
`ash
docker run -p 8000:8000 aether-acm
`

### Verify
Visit http://0.0.0.0:8000 and check /api/realtime or /api/visualization/snapshot.

---

## 🧩 Project Structure

`
src/
├── app/
│   ├── api/
│   │   ├── realtime/
│   │   ├── simulate/step/
│   │   ├── cola/auto/
│   │   ├── maneuver/schedule/
│   │   └── visualization/snapshot/
│   ├── page.tsx
│   └── globals.css
├── components/
├── lib/
│   ├── physics/
│   ├── maneuver/
│   ├── spatial/
│   ├── state/
│   └── comms/
`

---

## ✅ Additional Notes
- Uses deterministic simulation and modular event scheduling.
- Designed to meet hackathon automatic grading constraints.
- Includes full data and event pipeline from ingest to 3D rendering.
- **Global Multi-Objective Optimizer**: Implements reinforcement learning-inspired cost-benefit analysis balancing fuel efficiency vs constellation uptime with configurable weights.

---

## 📝 Acknowledgments
- Inspired by production FDO systems and SSA frameworks
- Includes open-source dependencies, modern React + Three.js integration
