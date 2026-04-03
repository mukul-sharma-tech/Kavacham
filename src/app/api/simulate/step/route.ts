import { NextRequest, NextResponse } from "next/server";
import {
  getState, getAllSatellites, getAllDebris,
  updateSatellite, advanceTime, logManeuver,
  incrementCollisions, addOutageSeconds, setWarnings, scheduleBurns,
} from "@/lib/state/store";
import { propagate } from "@/lib/physics/propagator";
import { applyBurn, isInStationBox, needsEOL, calculateGraveyardBurn, calculateStationKeepingBurn } from "@/lib/maneuver/cola";
import { assessConjunctions } from "@/lib/spatial/conjunction";
import { vec3 } from "@/lib/physics/vector";
import { CRITICAL_MISS_KM, COOLDOWN_S } from "@/lib/physics/constants";
import { getUploadWindow } from "@/lib/comms/los";
import { GROUND_STATIONS } from "@/lib/comms/groundStations";
import { optimizeGlobalBurns, optimizeEmergencyBurns } from "@/lib/optimizer/global";

const SUB_STEP_S = 60;

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { step_seconds } = body as { step_seconds: number };

    if (!step_seconds || step_seconds <= 0) {
      return NextResponse.json({ error: "Invalid step_seconds" }, { status: 400 });
    }

    const state = getState();
    const startMs = state.currentTimeMs;
    const endMs = startMs + step_seconds * 1000;

    let maneuversExecuted = 0;
    let collisionsDetected = 0;

    let currentMs = startMs;
    const subStepMs = SUB_STEP_S * 1000;

    while (currentMs < endMs) {
      const nextMs = Math.min(currentMs + subStepMs, endMs);
      const dtS = (nextMs - currentMs) / 1000;

      // 1. Propagate all debris
      for (const [id, deb] of state.debris) {
        if (!deb.state?.r) continue;
        state.debris.set(id, {
          ...deb,
          state: propagate(deb.state, dtS),
          timestamp: nextMs,
        });
      }

      // 2. Propagate satellites + execute burns
      for (const [id, sat] of state.satellites) {
        let updatedSat = { ...sat };

        const pendingBurns = updatedSat.scheduledManeuvers.filter(
          (b) => !b.executed && b.burnTime >= currentMs && b.burnTime < nextMs
        );

        for (const burn of pendingBurns) {
          const dtToBurn = (burn.burnTime - currentMs) / 1000;
          if (dtToBurn > 0) {
            updatedSat = { ...updatedSat, state: propagate(updatedSat.state, dtToBurn) };
          }
          updatedSat = applyBurn(updatedSat, burn.deltaV, burn.burnTime);
          burn.executed = true;
          maneuversExecuted++;
          logManeuver({
            burnId: burn.burnId,
            satelliteId: id,
            executedAt: burn.burnTime,
            dvMs: vec3.mag(burn.deltaV) * 1000,
          });
        }

        const dtRemaining = dtS - pendingBurns.reduce((acc, b) => {
          const dt = (b.burnTime - currentMs) / 1000;
          return Math.max(acc, dt > 0 ? dt : 0);
        }, 0);

        if (dtRemaining > 0) {
          updatedSat = { ...updatedSat, state: propagate(updatedSat.state, dtRemaining) };
        }

        // Propagate nominal slot
        updatedSat.nominalSlot = propagate(updatedSat.nominalSlot, dtS);

        // Station-keeping outage tracking
        if (!isInStationBox(updatedSat)) {
          addOutageSeconds(dtS);
          if (updatedSat.status === "NOMINAL") {
            updatedSat = { ...updatedSat, status: "RECOVERING" };
          }
        } else if (updatedSat.status === "RECOVERING") {
          updatedSat = { ...updatedSat, status: "NOMINAL" };
        }

        // EOL check: schedule graveyard burn if fuel critical
        if (needsEOL(updatedSat) && updatedSat.status !== "EOL") {
          const gravBurn = calculateGraveyardBurn(updatedSat, nextMs);
          if (gravBurn) {
            updatedSat = { ...updatedSat, status: "EOL" };
            updateSatellite(updatedSat);
            scheduleBurns(id, [gravBurn]);
          }
        }

        updatedSat.timestamp = nextMs;
        updateSatellite(updatedSat);
      }

      // 3. Collision detection
      const sats = getAllSatellites();
      const debris = getAllDebris();
      for (const sat of sats) {
        for (const deb of debris) {
          if (vec3.dist(sat.state.r, deb.state.r) < CRITICAL_MISS_KM) {
            collisionsDetected++;
            incrementCollisions();
          }
        }
      }

      currentMs = nextMs;
    }

    advanceTime(endMs);

    // Re-run conjunction assessment
    const sats = getAllSatellites();
    const debris = getAllDebris();
    const warnings = assessConjunctions(sats, debris, endMs);
    setWarnings(warnings);

    // Use global optimizer for constellation-wide burn decisions
    let optimalBurns: ReturnType<typeof optimizeGlobalBurns> = [];

    // Emergency mode for critical conjunctions
    const criticalWarnings = warnings.filter(w => w.missDistance < CRITICAL_MISS_KM);
    if (criticalWarnings.length > 0) {
      optimalBurns = optimizeEmergencyBurns();
    } else {
      // Normal optimization balancing fuel vs uptime
      optimalBurns = optimizeGlobalBurns();
    }

    // Schedule the optimized burns
    for (const burn of optimalBurns) {
      const satId = burn.burnId.split('_')[1]; // Extract satellite ID from burn ID
      scheduleBurns(satId, [burn]);
    }

    return NextResponse.json({
      status: "STEP_COMPLETE",
      new_timestamp: new Date(endMs).toISOString(),
      collisions_detected: collisionsDetected,
      maneuvers_executed: maneuversExecuted,
      burns_scheduled: optimalBurns.length,
      optimization_mode: criticalWarnings.length > 0 ? "emergency" : "global",
    });
  } catch (err) {
    console.error("[simulate/step]", err);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}
