/**
 * Blackout / communication-dead-zone risk for conjunctions (spec §5.4).
 * Flags critical approaches when upload may be impossible at TCA or while out of LOS.
 */
import type { Satellite, CDMWarning, GroundStation, Vec3 } from "../physics/types";
import { hasAnyLOS } from "./los";
import { propagate } from "../physics/propagator";
import { CRITICAL_MISS_KM, WARN_MISS_KM } from "../physics/constants";

export interface BlackoutAlert {
  satellite_id: string;
  debris_id: string;
  tca: string;
  severity: "critical" | "warning";
  message: string;
}

/** Approximate satellite position at TCA for LOS check at event time. */
function positionAtTca(sat: Satellite, tcaMs: number, nowMs: number): Vec3 {
  let s = sat.state;
  let rem = Math.max(0, (tcaMs - nowMs) / 1000);
  while (rem > 0) {
    const dt = Math.min(60, rem);
    s = propagate(s, dt);
    rem -= dt;
  }
  return s.r;
}

export function computeBlackoutAlerts(
  satellites: Satellite[],
  warnings: CDMWarning[],
  nowMs: number,
  stations: GroundStation[]
): BlackoutAlert[] {
  const alerts: BlackoutAlert[] = [];
  const seen = new Set<string>();

  for (const w of warnings) {
    if (w.missDistance >= WARN_MISS_KM) continue;
    const sat = satellites.find((s) => s.id === w.satelliteId);
    if (!sat) continue;

    const key = `${w.satelliteId}_${w.debrisId}`;
    if (seen.has(key)) continue;

    const noLosNow = !hasAnyLOS(sat.state.r, stations);
    const rTca = positionAtTca(sat, w.tca, nowMs);
    const noLosAtTca = !hasAnyLOS(rTca, stations);

    if (w.missDistance < CRITICAL_MISS_KM && (noLosAtTca || noLosNow)) {
      seen.add(key);
      alerts.push({
        satellite_id: w.satelliteId,
        debris_id: w.debrisId,
        tca: new Date(w.tca).toISOString(),
        severity: "critical",
        message: noLosAtTca
          ? "Critical miss: no ground station LOS at predicted TCA — upload evasion before blackout"
          : "Critical miss: satellite currently out of LOS — schedule upload on next pass",
      });
    } else if (w.missDistance < 1.0 && noLosNow && w.tca < nowMs + 6 * 3600 * 1000) {
      seen.add(key);
      alerts.push({
        satellite_id: w.satelliteId,
        debris_id: w.debrisId,
        tca: new Date(w.tca).toISOString(),
        severity: "warning",
        message: "Conjunction warning while out of ground contact — monitor blackout window",
      });
    }
  }

  return alerts.slice(0, 30);
}
