import { NextResponse } from "next/server";
import { getState, getAllSatellites, getAllDebris } from "@/lib/state/store";
import { isSnapshotDirty, clearSnapshotDirty } from "@/lib/state/store";
import { eciToGeodetic, computeGMST } from "@/lib/physics/propagator";
import { vec3 } from "@/lib/physics/vector";
import { STATION_BOX_KM, INITIAL_FUEL } from "@/lib/physics/constants";
import { samplePredictedGroundTrack } from "@/lib/telemetry/groundTrack";
import { computeBlackoutAlerts } from "@/lib/comms/blackoutAlerts";
import { GROUND_STATIONS } from "@/lib/comms/groundStations";

const MAX_DEBRIS_SNAPSHOT = 10_000;
const SCHEDULE_HORIZON_MS = 2 * 3600 * 1000;

function inferBurnKind(burnId: string): string {
  if (burnId.includes("EVASION") || burnId.includes("AUTONOMOUS_EVASION")) return "EVASION";
  if (burnId.includes("RECOVERY")) return "RECOVERY";
  if (burnId.includes("STATION_KEEPING") || burnId.includes("AUTONOMOUS_STATION")) return "STATION_KEEPING";
  if (burnId.includes("GRAVEYARD")) return "GRAVEYARD";
  if (burnId.includes("MANUAL")) return "MANUAL";
  return "BURN";
}

function downsampleDebris<T>(arr: T[], max: number): T[] {
  if (arr.length <= max) return arr;
  const step = Math.ceil(arr.length / max);
  const out: T[] = [];
  for (let i = 0; i < arr.length; i += step) out.push(arr[i]);
  return out.slice(0, max);
}

// Cache: invalidate when sim time changes OR after any write operation
let _cacheTime = -1;
let _cacheBody = "";
let _cacheInvalidated = false;

export async function GET() {
  const state = getState();

  // Return cached response if sim time unchanged and not dirty
  if (state.currentTimeMs === _cacheTime && _cacheBody && !isSnapshotDirty()) {
    return new Response(_cacheBody, {
      headers: { "Content-Type": "application/json", "X-Cache": "HIT" },
    });
  }
  clearSnapshotDirty();

  const gmst = computeGMST(state.currentTimeMs);

  const satellites = getAllSatellites().map((sat) => {
    const geo = eciToGeodetic(sat.state.r, gmst);
    const distFromSlot = vec3.dist(sat.state.r, sat.nominalSlot.r);
    const trail =
      sat.groundTrackHistory?.map((p): [number, number] => [
        parseFloat(p.lat.toFixed(4)),
        parseFloat(p.lon.toFixed(4)),
      ]) ?? [];
    const predicted = samplePredictedGroundTrack(sat, state.currentTimeMs).map(
      ([la, lo]): [number, number] => [parseFloat(la.toFixed(4)), parseFloat(lo.toFixed(4))]
    );

    return {
      id: sat.id,
      lat: parseFloat(geo.lat.toFixed(4)),
      lon: parseFloat(geo.lon.toFixed(4)),
      alt: parseFloat(geo.alt.toFixed(2)),
      fuel_kg: parseFloat(sat.fuelMass.toFixed(3)),
      status: sat.status,
      slot_drift_km: parseFloat(distFromSlot.toFixed(3)),
      in_box: distFromSlot <= STATION_BOX_KM,
      trail_history: trail,
      predicted_track: predicted,
      last_burn_iso: sat.lastBurnTime > 0 ? new Date(sat.lastBurnTime).toISOString() : null,
    };
  });

  const stations = state.groundStations.length > 0 ? state.groundStations : GROUND_STATIONS;
  const blackoutAlerts = computeBlackoutAlerts(
    getAllSatellites(),
    state.activeWarnings,
    state.currentTimeMs,
    stations
  );

  const nowMs = state.currentTimeMs;
  const scheduledBurns: Array<{
    satellite_id: string;
    burn_id: string;
    burn_time: string;
    dv_ms: number;
    kind: string;
  }> = [];
  for (const sat of getAllSatellites()) {
    for (const b of sat.scheduledManeuvers) {
      if (b.executed) continue;
      if (b.burnTime > nowMs + SCHEDULE_HORIZON_MS) continue;
      if (b.deltaV?.x === undefined) continue;
      scheduledBurns.push({
        satellite_id: sat.id,
        burn_id: b.burnId,
        burn_time: new Date(b.burnTime).toISOString(),
        dv_ms: parseFloat((vec3.mag(b.deltaV) * 1000).toFixed(4)),
        kind: inferBurnKind(b.burnId),
      });
    }
  }
  scheduledBurns.sort((a, b) => new Date(a.burn_time).getTime() - new Date(b.burn_time).getTime());

  // Flattened tuple: [id, lat, lon, alt] — cap payload for 10k+ debris (spec performance)
  const debrisFull = getAllDebris().map((deb) => {
    const geo = eciToGeodetic(deb.state.r, gmst);
    return [deb.id, parseFloat(geo.lat.toFixed(3)), parseFloat(geo.lon.toFixed(3)), parseFloat(geo.alt.toFixed(1))] as [
      string,
      number,
      number,
      number,
    ];
  });
  const debrisCloud = downsampleDebris(debrisFull, MAX_DEBRIS_SNAPSHOT);

  const maneuverLog = state.maneuverLog;
  const totalDvMs = maneuverLog.reduce((s, m) => s + m.dvMs, 0);
  const evasionBurns = maneuverLog.filter(
    (m) =>
      /EVASION|AUTONOMOUS_EVASION/i.test(m.burnId) ||
      (m.burnId.includes("MANUAL") && m.dvMs > 0)
  ).length;
  const fuelConsumedKg = satellites.reduce((s, sat) => s + (INITIAL_FUEL - sat.fuel_kg), 0);

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
    debris_total: debrisFull.length,
    active_warnings: warnings,
    scheduled_burns: scheduledBurns.slice(0, 80),
    blackout_alerts: blackoutAlerts,
    stats: {
      total_satellites: satellites.length,
      total_debris: debrisFull.length,
      debris_sampled: debrisCloud.length,
      active_cdm_count: state.activeWarnings.length,
      total_collisions: state.collisionCount,
      total_outage_s: state.outageSeconds,
      maneuver_log_count: state.maneuverLog.length,
      total_dv_ms: parseFloat(totalDvMs.toFixed(4)),
      fuel_consumed_kg: parseFloat(fuelConsumedKg.toFixed(4)),
      evasion_maneuvers: evasionBurns,
      collisions_avoided: evasionBurns,
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
