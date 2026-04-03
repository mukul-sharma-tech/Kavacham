import { NextRequest, NextResponse } from "next/server";
import {
  getState, getAllSatellites, getAllDebris,
  updateSatellite, advanceTime, logManeuver,
  incrementCollisions, addOutageSeconds, setWarnings, scheduleBurns,
  markSnapshotDirty,
} from "@/lib/state/store";
import { propagate } from "@/lib/physics/propagator";
import { applyBurn, isInStationBox, needsEOL, calculateGraveyardBurn } from "@/lib/maneuver/cola";
import { assessConjunctions } from "@/lib/spatial/conjunction";
import { vec3 } from "@/lib/physics/vector";
import { CRITICAL_MISS_KM, LOOKAHEAD_S } from "@/lib/physics/constants";
import { optimizeGlobalBurns, optimizeEmergencyBurns, preloadBlackoutSequences } from "@/lib/optimizer/global";
import { parseSatelliteIdFromBurnId } from "@/lib/maneuver/burnId";
import { trimAppendGroundTrack } from "@/lib/telemetry/groundTrack";

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
    let burnsScheduled = 0;

    let currentMs = startMs;
    const subStepMs = SUB_STEP_S * 1000;

    while (currentMs < endMs) {
      const nextMs = Math.min(currentMs + subStepMs, endMs);
      const dtS = (nextMs - currentMs) / 1000;

      // 1. Propagate debris
      for (const [id, deb] of state.debris) {
        if (!deb.state?.r) continue;
        state.debris.set(id, { ...deb, state: propagate(deb.state, dtS), timestamp: nextMs });
      }

      // 2. Propagate satellites + execute scheduled burns
      for (const [id, sat] of state.satellites) {
        if (!sat.state?.r) continue;
        let s = { ...sat };

        const pending = s.scheduledManeuvers.filter(
          (b) => !b.executed && b.burnTime >= currentMs && b.burnTime < nextMs
        );

        for (const burn of pending) {
          const dtToBurn = (burn.burnTime - currentMs) / 1000;
          if (dtToBurn > 0) s = { ...s, state: propagate(s.state, dtToBurn) };
          if (
            burn.deltaV?.x === undefined ||
            burn.deltaV?.y === undefined ||
            burn.deltaV?.z === undefined
          ) {
            burn.executed = true;
            continue;
          }
          s = applyBurn(s, burn.deltaV, burn.burnTime);
          burn.executed = true;
          maneuversExecuted++;
          logManeuver({ burnId: burn.burnId, satelliteId: id, executedAt: burn.burnTime, dvMs: vec3.mag(burn.deltaV) * 1000 });
        }

        const dtRem = dtS - pending.reduce((acc, b) => Math.max(acc, Math.max(0, (b.burnTime - currentMs) / 1000)), 0);
        if (dtRem > 0 && s.state?.r) s = { ...s, state: propagate(s.state, dtRem) };

        // Propagate nominal slot with satellite
        if (s.nominalSlot?.r) s.nominalSlot = propagate(s.nominalSlot, dtS);

        // Station-keeping status
        if (!isInStationBox(s)) {
          addOutageSeconds(dtS);
          if (s.status === "NOMINAL") s = { ...s, status: "RECOVERING" };
        } else if (s.status === "RECOVERING") {
          s = { ...s, status: "NOMINAL" };
        }

        // EOL graveyard burn
        if (needsEOL(s) && s.status !== "EOL") {
          const gb = calculateGraveyardBurn(s, nextMs);
          if (gb) { s = { ...s, status: "EOL" }; scheduleBurns(id, [gb]); }
        }

        s.timestamp = nextMs;
        updateSatellite(trimAppendGroundTrack(s, nextMs));
      }

      // 3. Collision detection
      const sats = getAllSatellites();
      const debris = getAllDebris();
      for (const sat of sats) {
        if (!sat.state?.r) continue;
        for (const deb of debris) {
          if (!deb.state?.r) continue;
          if (vec3.dist(sat.state.r, deb.state.r) < CRITICAL_MISS_KM) {
            collisionsDetected++;
            incrementCollisions();
          }
        }
      }

      currentMs = nextMs;

      // Keep sim clock aligned so COLA / cooldown logic see the correct "now"
      advanceTime(nextMs);

      // Autonomous COLA + station-keeping (same pipeline as realtimeEngine)
      const satsNow = getAllSatellites();
      const debrisNow = getAllDebris();
      const warnings = assessConjunctions(satsNow, debrisNow, nextMs, LOOKAHEAD_S);
      setWarnings(warnings);

      const critical = warnings.filter((w) => w.missDistance < CRITICAL_MISS_KM);
      const optimalBurns =
        critical.length > 0 ? optimizeEmergencyBurns() : optimizeGlobalBurns();

      for (const burn of optimalBurns) {
        const satId = parseSatelliteIdFromBurnId(burn.burnId);
        if (satId && scheduleBurns(satId, [burn])) burnsScheduled++;
      }

      for (const burn of preloadBlackoutSequences()) {
        const satId = parseSatelliteIdFromBurnId(burn.burnId);
        if (satId && scheduleBurns(satId, [burn])) burnsScheduled++;
      }
    }

    const finalWarnings = getState().activeWarnings;
    markSnapshotDirty();

    return NextResponse.json({
      status: "STEP_COMPLETE",
      new_timestamp: new Date(endMs).toISOString(),
      collisions_detected: collisionsDetected,
      maneuvers_executed: maneuversExecuted,
      burns_scheduled: burnsScheduled,
      active_warnings: finalWarnings.length,
    });
  } catch (err) {
    console.error("[simulate/step]", err);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}
