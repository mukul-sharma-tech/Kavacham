import { eciToGeodetic, computeGMST, propagateN } from "../physics/propagator";
import type { Satellite } from "../physics/types";

const TRAIL_MS = 90 * 60 * 1000;

/** Append current sub-satellite point and trim to ~90 min of sim time. */
export function trimAppendGroundTrack(sat: Satellite, nextMs: number): Satellite {
  const gmst = computeGMST(nextMs);
  const geo = eciToGeodetic(sat.state.r, gmst);
  const prev = sat.groundTrackHistory ?? [];
  const next = [...prev, { lat: geo.lat, lon: geo.lon, t: nextMs }].filter(
    (p) => p.t >= nextMs - TRAIL_MS
  );
  return { ...sat, groundTrackHistory: next.slice(-512) };
}

/** Forward-propagate ~90 min for dashed predicted trajectory on the map. */
export function samplePredictedGroundTrack(sat: Satellite, nowMs: number): Array<[number, number]> {
  const pts: Array<[number, number]> = [];
  const stepS = 300;
  let sv = sat.state;
  const g0 = eciToGeodetic(sv.r, computeGMST(nowMs));
  pts.push([g0.lat, g0.lon]);
  for (let t = 0; t < 90 * 60; t += stepS) {
    const chunk = Math.min(stepS, 90 * 60 - t);
    if (chunk <= 0) break;
    sv = propagateN(sv, chunk, 60);
    const g = eciToGeodetic(sv.r, computeGMST(nowMs + (t + chunk) * 1000));
    pts.push([g.lat, g.lon]);
  }
  return pts;
}
