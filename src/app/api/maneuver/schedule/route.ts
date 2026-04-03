import { NextRequest, NextResponse } from "next/server";
import { getSatellite, scheduleBurns, getState } from "@/lib/state/store";
import { hasAnyLOS } from "@/lib/comms/los";
import { GROUND_STATIONS } from "@/lib/comms/groundStations";
import { vec3 } from "@/lib/physics/vector";
import { propellantConsumed } from "@/lib/maneuver/cola";
import { DRY_MASS, MAX_DV, COOLDOWN_S, SIGNAL_LATENCY_S } from "@/lib/physics/constants";
import type { ManeuverBurn } from "@/lib/physics/types";

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { satelliteId, maneuver_sequence } = body as {
      satelliteId: string;
      maneuver_sequence: Array<{
        burn_id: string;
        burnTime: string;
        deltaV_vector: { x: number; y: number; z: number };
      }>;
    };

    const sat = getSatellite(satelliteId);
    if (!sat) {
      return NextResponse.json({ error: "Satellite not found" }, { status: 404 });
    }

    const state = getState();
    const nowMs = state.currentTimeMs;

    // Validate LOS for first burn
    const losOk = hasAnyLOS(sat.state.r, GROUND_STATIONS);

    // Validate burns
    let fuelRemaining = sat.fuelMass;
    const burns: ManeuverBurn[] = [];

    for (let i = 0; i < maneuver_sequence.length; i++) {
      const b = maneuver_sequence[i];
      const burnTimeMs = new Date(b.burnTime).getTime();

      // Signal latency check
      if (burnTimeMs < nowMs + SIGNAL_LATENCY_S * 1000) {
        return NextResponse.json(
          { error: `Burn ${b.burn_id} scheduled too soon (< ${SIGNAL_LATENCY_S}s latency)` },
          { status: 400 }
        );
      }

      // Max dv check (convert km/s to m/s)
      const dvKmS = vec3.mag(b.deltaV_vector);
      const dvMs = dvKmS * 1000;
      if (dvMs > MAX_DV) {
        return NextResponse.json(
          { error: `Burn ${b.burn_id} exceeds max dv of ${MAX_DV} m/s` },
          { status: 400 }
        );
      }

      // Cooldown check between consecutive burns
      if (i > 0) {
        const prevBurnMs = new Date(maneuver_sequence[i - 1].burnTime).getTime();
        if (burnTimeMs - prevBurnMs < COOLDOWN_S * 1000) {
          return NextResponse.json(
            { error: `Insufficient cooldown between burns (need ${COOLDOWN_S}s)` },
            { status: 400 }
          );
        }
      }

      // Fuel check
      const currentMass = fuelRemaining + DRY_MASS;
      const fuelUsed = propellantConsumed(currentMass, dvMs);
      if (fuelUsed > fuelRemaining) {
        return NextResponse.json({ error: `Insufficient fuel for burn ${b.burn_id}` }, { status: 400 });
      }
      fuelRemaining -= fuelUsed;

      burns.push({
        burnId: b.burn_id,
        burnTime: burnTimeMs,
        deltaV: b.deltaV_vector,
        executed: false,
      });
    }

    scheduleBurns(satelliteId, burns);

    return NextResponse.json(
      {
        status: "SCHEDULED",
        validation: {
          ground_station_los: losOk,
          sufficient_fuel: true,
          projected_mass_remaining_kg: fuelRemaining + DRY_MASS,
        },
      },
      { status: 202 }
    );
  } catch (err) {
    console.error("[maneuver/schedule]", err);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}
