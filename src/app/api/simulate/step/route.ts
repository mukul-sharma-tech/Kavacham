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
import { vec3, rtnToEci } from "@/lib/physics/vector";
import { CRITICAL_MISS_KM, COOLDOWN_S, SIGNAL_LATENCY_S } from "@/lib/physics/constants";

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
          if (!burn.deltaV || burn.deltaV.x === undefined) { burn.executed = true; continue; }
          s = applyBurn(s, burn.deltaV, burn.burnTime);
          burn.executed = true;
          maneuversExecuted++;
          logManeuver({ burnId: burn.burnId, satelliteId: id, executedAt: burn.burnTime, dvMs: vec3.mag(burn.deltaV) * 1000 });
        }

        const dtRem = dtS - pending.reduce((acc, b) => Math.max(acc, Math.max(0, (b.burnTime - currentMs) / 1000)), 0);
        if (dtRem > 0 && s.state?.r) s = { ...s, state: propagate(s.state, dtRem) };

        // Propagate nominal slot
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
        updateSatellite(s);
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
    }

    advanceTime(endMs);

    // Conjunction assessment — 1 hour lookahead for performance
    const sats = getAllSatellites();
    const debris = getAllDebris();
    const warnings = assessConjunctions(sats, debris, endMs, 3600);
    setWarnings(warnings);

    // Auto-schedule evasion for critical conjunctions (< 100m)
    let burnsScheduled = 0;
    for (const w of warnings.filter(w => w.missDistance < CRITICAL_MISS_KM)) {
      const sat = sats.find(s => s.id === w.satelliteId);
      if (!sat || sat.status === "EOL" || !sat.state?.r) continue;
      const hasPending = sat.scheduledManeuvers.some(b => !b.executed);
      const inCooldown = sat.lastBurnTime > 0 && (endMs - sat.lastBurnTime) < COOLDOWN_S * 1000;
      if (hasPending || inCooldown) continue;

      const tcaS = (w.tca - endMs) / 1000;
      if (tcaS < SIGNAL_LATENCY_S + 5) continue;

      // CW minimum Δv calculation
      const rMag = vec3.mag(sat.state.r);
      const n = Math.sqrt(398600.4418 / (rMag ** 3));
      const tToTca = tcaS - SIGNAL_LATENCY_S;
      const cwFactor = (2 / n) * Math.sin(n * tToTca) + 3 * tToTca;
      const targetSep = Math.max(0, 0.20 - w.missDistance) + 0.05;
      const dvKmS = cwFactor > 0 ? Math.min(targetSep / cwFactor, 0.015) : 0.005;

      const dvECI = rtnToEci({ x: 0, y: dvKmS, z: 0 }, sat.state.r, sat.state.v);
      const burnTime = endMs + SIGNAL_LATENCY_S * 1000;

      scheduleBurns(sat.id, [
        { burnId: `AUTO_EVASION_${sat.id}_${Date.now()}`, burnTime, deltaV: dvECI, executed: false },
        {
          burnId: `AUTO_RECOVERY_${sat.id}_${Date.now() + 1}`,
          burnTime: burnTime + COOLDOWN_S * 1000,
          deltaV: { x: -dvECI.x * 0.97, y: -dvECI.y * 0.97, z: -dvECI.z * 0.97 },
          executed: false,
        },
      ]);
      burnsScheduled++;
    }

    markSnapshotDirty();

    return NextResponse.json({
      status: "STEP_COMPLETE",
      new_timestamp: new Date(endMs).toISOString(),
      collisions_detected: collisionsDetected,
      maneuvers_executed: maneuversExecuted,
      burns_scheduled: burnsScheduled,
      active_warnings: warnings.length,
    });
  } catch (err) {
    console.error("[simulate/step]", err);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}
