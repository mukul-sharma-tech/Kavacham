/**
 * Immediately apply a burn to a satellite — no scheduling, instant fuel deduction.
 * Used by the UI for manual evasion burns.
 */
import { NextRequest, NextResponse } from "next/server";
import { getState, updateSatellite, logManeuver, markSnapshotDirty } from "@/lib/state/store";
import { applyBurn } from "@/lib/maneuver/cola";
import { rtnToEci, vec3 } from "@/lib/physics/vector";
import { COOLDOWN_S } from "@/lib/physics/constants";
import { scheduleBurns } from "@/lib/state/store";

export async function POST(req: NextRequest) {
  try {
    const { satelliteId, dvMs, direction } = await req.json() as {
      satelliteId: string;
      dvMs: number;
      direction: "prograde" | "retrograde" | "radial";
    };

    const state = getState();
    const sat = state.satellites.get(satelliteId);
    if (!sat) return NextResponse.json({ error: "Satellite not found" }, { status: 404 });
    if (!sat.state?.r) return NextResponse.json({ error: "Invalid satellite state" }, { status: 400 });

    const clampedDv = Math.min(Math.max(dvMs, 0.1), 15.0);
    const dvKmS = clampedDv / 1000;

    const dvRTN = direction === "prograde"   ? { x: 0, y: dvKmS, z: 0 }
                : direction === "retrograde" ? { x: 0, y: -dvKmS, z: 0 }
                :                              { x: dvKmS, y: 0, z: 0 };

    const dvECI = rtnToEci(dvRTN, sat.state.r, sat.state.v);
    const nowMs = state.currentTimeMs;

    // Apply burn immediately
    const updated = applyBurn(sat, dvECI, nowMs);
    updated.status = "EVADING";
    updateSatellite(updated);

    // Log it
    const burnId = `MANUAL_${satelliteId}_${Date.now()}`;
    logManeuver({ burnId, satelliteId, executedAt: nowMs, dvMs: clampedDv });

    // Schedule recovery burn after cooldown
    const recoveryDvECI = { x: -dvECI.x * 0.97, y: -dvECI.y * 0.97, z: -dvECI.z * 0.97 };
    scheduleBurns(satelliteId, [{
      burnId: `RECOVERY_${satelliteId}_${Date.now()}`,
      burnTime: nowMs + COOLDOWN_S * 1000,
      deltaV: recoveryDvECI,
      executed: false,
    }]);

    markSnapshotDirty();

    return NextResponse.json({
      status: "BURN_APPLIED",
      satelliteId,
      dvMs: clampedDv,
      fuelRemaining: updated.fuelMass,
      fuelConsumed: sat.fuelMass - updated.fuelMass,
      newStatus: updated.status,
    });
  } catch (err) {
    console.error("[burn/now]", err);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}
