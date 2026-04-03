# Project AETHER — Pitch
### National Space Hackathon 2026, IIT Delhi

---

Low Earth Orbit is becoming a graveyard. 27,000 tracked debris fragments orbit at 27,000 km/h, and every collision creates thousands more — a cascading chain reaction called Kessler Syndrome that could make LEO permanently unusable. Today's solution is a human operator manually calculating collision avoidance. It takes hours, it doesn't scale, and when a satellite passes over an ocean with no ground contact, the operator is completely helpless. We built AETHER to replace that human entirely.

AETHER is a ground-based Autonomous Constellation Manager. It ingests real-time telemetry, predicts collisions up to 24 hours ahead, fires thruster burns automatically, and returns satellites to their mission slots — all without a single human command.

The physics engine uses Runge-Kutta 4th Order integration with J2 perturbation — the same math used by actual space agencies — to propagate every satellite and debris fragment with exact orbital mechanics. Fuel depletion is tracked using the Tsiolkovsky rocket equation after every burn. To solve the O(N²) bottleneck of checking thousands of objects against each other, we built a 3D KD-Tree spatial index that reduces conjunction screening to O(log N), handling 10,000+ debris objects in real time.

When a threat is detected — miss distance under 100 meters — our COLA engine calculates the minimum Δv using Clohessy-Wiltshire relative motion equations, fires a prograde burn, and automatically schedules a recovery burn 600 seconds later after the mandatory thermal cooldown. For satellites over oceans with no ground contact, the system predicts the blackout window and pre-uploads the full maneuver sequence before LOS is lost. A global optimizer balances two opposing goals simultaneously — maximize constellation uptime while minimizing total fuel expenditure across the fleet.

The Orbital Insight dashboard renders everything in real time using HTML5 Canvas at 60 FPS. You see satellites as green glowing dots moving across a Mercator ground track map, red pulsing debris, the solar terminator line showing day and night, and ground station coverage rings. When a burn fires, orange fire particles burst from the satellite, an orbit shift arrow shows whether the altitude raised or lowered, and a red alert card slides in from the corner showing the exact Δv and fuel consumed. The fuel bars update live. The activity log shows every CDM warning, scheduled burn, and executed maneuver in real time.

The entire system is deployed in Docker on ubuntu:22.04, binding to 0.0.0.0:8000 — exactly as required by the automated grader. The API exposes POST /api/telemetry, POST /api/simulate/step, POST /api/maneuver/schedule, and GET /api/visualization/snapshot with a compressed tuple-based debris cloud for fast transfer.

The satellites keep flying. The debris gets dodged. The constellation stays alive. No human required.

---

*Stack: Next.js · TypeScript · HTML5 Canvas · Docker · ubuntu:22.04 · Port 8000*
