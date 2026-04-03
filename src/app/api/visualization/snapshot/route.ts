import { NextResponse } from "next/server";
import { getState, getAllSatellites, getAllDebris } from "@/lib/state/store";
import { eciToGeodetic, computeGMST, propagateN } from "@/lib/physics/propagator";
import { vec3 } from "@/lib/physics/vector";
import { STATION_BOX_KM } from "@/lib/physics/constants";

// Simple cache: avoid recomputing if sim time hasn't changed
let _cacheTime = -1;
let _cacheBody = "";

export async function GET() {
  const state = getState();

  // Return cached response if sim time unchanged
  if (state.currentTimeMs === _cacheTime && _cacheBody) {
    return new Response(_cacheBody, {
      headers: { "Content-Type": "application/json", "X-Cache": "HIT" },
    });
  }

  const gmst = computeGMST(state.currentTimeMs);

  const satellites = getAllSatellites().map((sat) => {
    const geo = eciToGeodetic(sat.state.r, gmst);
    const distFromSlot = vec3.dist(sat.state.r, sat.nominalSlot.r);

    // Predicted trajectory: next 90 min at 10-min intervals (9 points)
    const predicted: Array<[number, number]> = [];
    let predState = sat.state;
    for (let i = 1; i <= 9; i++) {
      predState = propagateN(predState, 600, 60); // 10 min steps
      const g = eciToGeodetic(predState.r, computeGMST(state.currentTimeMs + i * 600000));
      predicted.push([parseFloat(g.lat.toFixed(3)), parseFloat(g.lon.toFixed(3))]);
    }

    return {
      id: sat.id,
      lat: parseFloat(geo.lat.toFixed(4)),
      lon: parseFloat(geo.lon.toFixed(4)),
      alt: parseFloat(geo.alt.toFixed(2)),
      fuel_kg: parseFloat(sat.fuelMass.toFixed(3)),
      status: sat.status,
      slot_drift_km: parseFloat(distFromSlot.toFixed(3)),
      in_box: distFromSlot <= STATION_BOX_KM,
      predicted_track: predicted,
    };
  });

  // Flattened tuple: [id, lat, lon, alt]
  const debrisCloud = getAllDebris().map((deb) => {
    const geo = eciToGeodetic(deb.state.r, gmst);
    return [deb.id, parseFloat(geo.lat.toFixed(3)), parseFloat(geo.lon.toFixed(3)), parseFloat(geo.alt.toFixed(1))];
  });

  const warnings = state.activeWarnings.slice(0, 50).map((w) => ({
    sat: w.satelliteId,
    deb: w.debrisId,
    tca: new Date(w.tca).toISOString(),
    miss_km: parseFloat(w.missDistance.toFixed(4)),
    rel_v_kms: parseFloat(w.relativeVelocity.toFixed(3)),
  }));

  const body = JSON.stringify({
    timestamp: new Date(state.currentTimeMs).toISOString(),
    satellites,
    debris_cloud: debrisCloud,
    active_warnings: warnings,
    stats: {
      total_satellites: satellites.length,
      total_debris: debrisCloud.length,
      active_cdm_count: state.activeWarnings.length,
      total_collisions: state.collisionCount,
      total_outage_s: state.outageSeconds,
      maneuver_log_count: state.maneuverLog.length,
    },
    maneuver_log: state.maneuverLog.slice(-20).map((m) => ({
      burnId: m.burnId,
      satelliteId: m.satelliteId,
      executedAt: new Date(m.executedAt).toISOString(),
      dvMs: parseFloat(m.dvMs.toFixed(4)),
    })),
  });

  // Cache it
  _cacheTime = state.currentTimeMs;
  _cacheBody = body;

  return new Response(body, {
    headers: { "Content-Type": "application/json", "X-Cache": "MISS" },
  });
}
