import { NextRequest, NextResponse } from "next/server";
import {
  getSatellite, scheduleBurns, getState,
  updateSatellite, logManeuver, markSnapshotDirty,
} from "@/lib/state/store";
import { hasAnyLOS } from "@/lib/comms/los";
import { GROUND_STATIONS } from "@/lib/comms/groundStations";
import { vec3, rtnToEci } from "@/lib/physics/vector";
import { propellantConsumed, applyBurn } from "@/lib/maneuver/cola";
import { DRY_MASS, MAX_DV, COOLDOWN_S, SIGNAL_LATENCY_S } from "@/lib/physics/constants";
import type { ManeuverBurn } from "@/lib/physics/types";

export async function POST(req: NextRequest) {
  try {
    const body = await req.json() as Record<string, unknown>;

    // ── INSTANT BURN: { instant: true, satelliteId, dvMs, direction } ──────
    if (body.instant === true) {
      const satelliteId = String(body.satelliteId ?? "");
      const dvMs = Math.min(Math.max(Number(body.dvMs ?? 5), 0.1), 15.0);
      const direction = String(body.direction ?? "prograde");

      const sat = getSatellite(satelliteId);
      if (!sat) return NextResponse.json({ error: "Satellite not found" }, { status: 404 });
      if (!sat.state?.r) return NextResponse.json({ error: "Invalid satellite state" }, { status: 400 });

      const dvKmS = dvMs / 1000;
      const dvRTN = direction === "retrograde" ? { x: 0, y: -dvKmS, z: 0 }
                  : direction === "radial"     ? { x: dvKmS, y: 0, z: 0 }
                  :                              { x: 0, y: dvKmS, z: 0 };

      const dvECI = rtnToEci(dvRTN, sat.state.r, sat.state.v);
      const nowMs = getState().currentTimeMs;
      const fuelBefore = sat.fuelMass;

      const updated = applyBurn(sat, dvECI, nowMs);
      updated.status = "EVADING";
      updateSatellite(updated);

      const burnId = `INSTANT_${satelliteId}_${Date.now()}`;
      logManeuver({ burnId, satelliteId, executedAt: nowMs, dvMs });

      scheduleBurns(satelliteId, [{
        burnId: `RECOVERY_${satelliteId}_${Date.now()}`,
        burnTime: nowMs + COOLDOWN_S * 1000,
        deltaV: { x: -dvECI.x * 0.97, y: -dvECI.y * 0.97, z: -dvECI.z * 0.97 },
        executed: false,
      }]);

      markSnapshotDirty();

      return NextResponse.json({
        status: "BURN_APPLIED",
        satelliteId,
        dvMs,
        fuelBefore: parseFloat(fuelBefore.toFixed(4)),
        fuelAfter: parseFloat(updated.fuelMass.toFixed(4)),
        fuelConsumed: parseFloat((fuelBefore - updated.fuelMass).toFixed(4)),
        newStatus: updated.status,
      });
    }

    // ── SCHEDULED BURN: { satelliteId, maneuver_sequence } ───────────────
    const { satelliteId, maneuver_sequence } = body as {
      satelliteId: string;
      maneuver_sequence: Array<{
        burn_id: string;
        burnTime: string;
        deltaV_vector: { x: number; y: number; z: number };
      }>;
    };

    const sat = getSatellite(satelliteId);
    if (!sat) return NextResponse.json({ error: "Satellite not found" }, { status: 404 });

    const nowMs = getState().currentTimeMs;
    const losOk = hasAnyLOS(sat.state.r, GROUND_STATIONS);
    let fuelRemaining = sat.fuelMass;
    const burns: ManeuverBurn[] = [];

    for (let i = 0; i < maneuver_sequence.length; i++) {
      const b = maneuver_sequence[i];
      const burnTimeMs = new Date(b.burnTime).getTime();

      if (burnTimeMs < nowMs + SIGNAL_LATENCY_S * 1000) {
        return NextResponse.json({ error: `Burn ${b.burn_id} too soon (< ${SIGNAL_LATENCY_S}s latency)` }, { status: 400 });
      }
      const dvMs = vec3.mag(b.deltaV_vector) * 1000;
      if (dvMs > MAX_DV) {
        return NextResponse.json({ error: `Burn ${b.burn_id} exceeds ${MAX_DV} m/s` }, { status: 400 });
      }
      if (i > 0) {
        const prevMs = new Date(maneuver_sequence[i - 1].burnTime).getTime();
        if (burnTimeMs - prevMs < COOLDOWN_S * 1000) {
          return NextResponse.json({ error: `Need ${COOLDOWN_S}s cooldown between burns` }, { status: 400 });
        }
      }
      const fuelUsed = propellantConsumed(fuelRemaining + DRY_MASS, dvMs);
      if (fuelUsed > fuelRemaining) {
        return NextResponse.json({ error: `Insufficient fuel for ${b.burn_id}` }, { status: 400 });
      }
      fuelRemaining -= fuelUsed;
      burns.push({ burnId: b.burn_id, burnTime: burnTimeMs, deltaV: b.deltaV_vector, executed: false });
    }

    scheduleBurns(satelliteId, burns);

    return NextResponse.json({
      status: "SCHEDULED",
      validation: {
        ground_station_los: losOk,
        sufficient_fuel: true,
        projected_mass_remaining_kg: fuelRemaining + DRY_MASS,
      },
    }, { status: 202 });

  } catch (err) {
    console.error("[maneuver/schedule]", err);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}
