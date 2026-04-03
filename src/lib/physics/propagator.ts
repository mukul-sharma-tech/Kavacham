/**
 * Orbital propagator: Runge-Kutta 4th Order with J2 perturbation.
 */
import { MU, RE, J2 } from "./constants";
import { vec3 } from "./vector";
import type { StateVector, Vec3 } from "./types";

/** J2-perturbed acceleration in ECI frame (km/s^2) */
function acceleration(r: Vec3): Vec3 {
  if (!r || r.x === undefined || r.y === undefined || r.z === undefined) {
    return { x: 0, y: 0, z: 0 };
  }
  const rMag = vec3.mag(r);
  if (!isFinite(rMag) || rMag < 1e-3) {
    return { x: 0, y: 0, z: 0 };
  }
  const rMag3 = rMag * rMag * rMag;
  const rMag5 = rMag3 * rMag * rMag;

  // Two-body gravity
  const grav: Vec3 = vec3.scale(r, -MU / rMag3);

  // J2 perturbation
  const j2c = (3 / 2) * (J2 * MU * RE * RE) / rMag5;
  const zr2 = (r.z * r.z) / (rMag * rMag);
  const aJ2: Vec3 = {
    x: j2c * r.x * (5 * zr2 - 1),
    y: j2c * r.y * (5 * zr2 - 1),
    z: j2c * r.z * (5 * zr2 - 3),
  };

  return vec3.add(grav, aJ2);
}

/** Single RK4 step. dt in seconds. */
export function propagate(state: StateVector, dt: number): StateVector {
  // Guard against undefined/NaN state
  if (!state?.r || !state?.v) return state;
  if (
    isNaN(state.r.x) || isNaN(state.r.y) || isNaN(state.r.z) ||
    isNaN(state.v.x) || isNaN(state.v.y) || isNaN(state.v.z)
  ) {
    return state;
  }

  const d = (s: StateVector) => ({ dr: s.v, dv: acceleration(s.r) });

  const k1 = d(state);
  const k2 = d({
    r: vec3.add(state.r, vec3.scale(k1.dr, dt / 2)),
    v: vec3.add(state.v, vec3.scale(k1.dv, dt / 2)),
  });
  const k3 = d({
    r: vec3.add(state.r, vec3.scale(k2.dr, dt / 2)),
    v: vec3.add(state.v, vec3.scale(k2.dv, dt / 2)),
  });
  const k4 = d({
    r: vec3.add(state.r, vec3.scale(k3.dr, dt)),
    v: vec3.add(state.v, vec3.scale(k3.dv, dt)),
  });

  return {
    r: {
      x: state.r.x + (dt / 6) * (k1.dr.x + 2 * k2.dr.x + 2 * k3.dr.x + k4.dr.x),
      y: state.r.y + (dt / 6) * (k1.dr.y + 2 * k2.dr.y + 2 * k3.dr.y + k4.dr.y),
      z: state.r.z + (dt / 6) * (k1.dr.z + 2 * k2.dr.z + 2 * k3.dr.z + k4.dr.z),
    },
    v: {
      x: state.v.x + (dt / 6) * (k1.dv.x + 2 * k2.dv.x + 2 * k3.dv.x + k4.dv.x),
      y: state.v.y + (dt / 6) * (k1.dv.y + 2 * k2.dv.y + 2 * k3.dv.y + k4.dv.y),
      z: state.v.z + (dt / 6) * (k1.dv.z + 2 * k2.dv.z + 2 * k3.dv.z + k4.dv.z),
    },
  };
}

/** Propagate forward by totalSeconds using fixed sub-steps (default 60s). */
export function propagateN(state: StateVector, totalSeconds: number, stepSize = 60): StateVector {
  let s = state;
  let remaining = totalSeconds;
  while (remaining > 0) {
    const dt = Math.min(stepSize, remaining);
    s = propagate(s, dt);
    remaining -= dt;
  }
  return s;
}

/** ECI position to geodetic lat/lon/alt (deg, deg, km) */
export function eciToGeodetic(r: Vec3, gmst: number): { lat: number; lon: number; alt: number } {
  const rMag = vec3.mag(r);
  const lat = Math.asin(r.z / rMag) * (180 / Math.PI);
  const rawLon = (Math.atan2(r.y, r.x) - gmst) * (180 / Math.PI);
  const lon = ((rawLon % 360) + 360) % 360;
  return { lat, lon: lon > 180 ? lon - 360 : lon, alt: rMag - RE };
}

/** Greenwich Mean Sidereal Time (radians) from Unix timestamp ms */
export function computeGMST(timestampMs: number): number {
  const JD = timestampMs / 86400000 + 2440587.5;
  const gmstDeg = 280.46061837 + 360.98564736629 * (JD - 2451545.0);
  return ((gmstDeg % 360) + 360) % 360 * (Math.PI / 180);
}
