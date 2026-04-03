/**
 * Line-of-Sight (LOS) calculator for ground station coverage.
 * Determines if a satellite is visible from a ground station.
 */
import { RE } from "../physics/constants";
import { vec3 } from "../physics/vector";
import type { GroundStation, Vec3 } from "../physics/types";

/** Convert geodetic lat/lon/alt to ECI (ECEF approximation, ignoring Earth rotation for simplicity) */
export function geodeticToECEF(lat: number, lon: number, altKm: number): Vec3 {
  const latR = lat * (Math.PI / 180);
  const lonR = lon * (Math.PI / 180);
  const r = RE + altKm;
  return {
    x: r * Math.cos(latR) * Math.cos(lonR),
    y: r * Math.cos(latR) * Math.sin(lonR),
    z: r * Math.sin(latR),
  };
}

/**
 * Check if satellite has LOS to a ground station.
 * Uses elevation angle check accounting for Earth's curvature.
 */
export function hasLOS(satPos: Vec3, gs: GroundStation): boolean {
  const gsPos = geodeticToECEF(gs.lat, gs.lon, gs.elevationM / 1000);

  // Vector from ground station to satellite
  const toSat = vec3.sub(satPos, gsPos);
  const toSatMag = vec3.mag(toSat);

  // Up vector at ground station (radial from Earth center)
  const up = vec3.norm(gsPos);

  // Elevation angle = angle between toSat and the local horizontal plane
  const sinElev = vec3.dot(vec3.norm(toSat), up);
  const elevDeg = Math.asin(sinElev) * (180 / Math.PI);

  return elevDeg >= gs.minElevAngleDeg;
}

/**
 * Check if satellite has LOS to ANY ground station in the network.
 */
export function hasAnyLOS(satPos: Vec3, stations: GroundStation[]): boolean {
  return stations.some((gs) => hasLOS(satPos, gs));
}

/**
 * Find the next LOS window for a satellite.
 * Propagates satellite forward and checks LOS at each step.
 * Returns offset in seconds from now, or null if no window found in lookahead.
 */
export function findNextLOSWindow(
  satPos: Vec3,
  satVel: Vec3,
  stations: GroundStation[],
  lookaheadS: number,
  stepS = 30
): { startS: number; endS: number } | null {
  // Simple forward scan
  let inLOS = false;
  let windowStart = -1;

  // We need to import propagate here - use inline approximation for speed
  // (circular orbit approximation for LOS window finding)
  let pos = { ...satPos };
  let vel = { ...satVel };

  for (let t = 0; t <= lookaheadS; t += stepS) {
    const los = hasAnyLOS(pos, stations);

    if (los && !inLOS) {
      windowStart = t;
      inLOS = true;
    } else if (!los && inLOS) {
      return { startS: windowStart, endS: t };
    }

    // Simple linear propagation for window finding (fast approximation)
    pos = {
      x: pos.x + vel.x * stepS,
      y: pos.y + vel.y * stepS,
      z: pos.z + vel.z * stepS,
    };
    // Rotate velocity for circular orbit (simplified)
    const rMag = vec3.mag(pos);
    const omega = Math.sqrt(398600.4418 / (rMag * rMag * rMag));
    const newVx = vel.x - omega * vel.y * stepS;
    const newVy = vel.y + omega * vel.x * stepS;
    vel = { x: newVx, y: newVy, z: vel.z };
  }

  if (inLOS) return { startS: windowStart, endS: lookaheadS };
  return null;
}

/**
 * Determine if a conjunction at tcaMs will occur in a blackout zone.
 * If so, returns the last available upload window before blackout.
 */
export function getUploadWindow(
  satPos: Vec3,
  satVel: Vec3,
  stations: GroundStation[],
  tcaMs: number,
  nowMs: number
): { canUpload: boolean; latestUploadMs: number } {
  const tcaOffsetS = (tcaMs - nowMs) / 1000;

  // Check if satellite currently has LOS
  if (hasAnyLOS(satPos, stations)) {
    return { canUpload: true, latestUploadMs: nowMs };
  }

  // Find next LOS window before TCA
  const window = findNextLOSWindow(satPos, satVel, stations, tcaOffsetS);
  if (window) {
    return {
      canUpload: true,
      latestUploadMs: nowMs + window.endS * 1000 - 10000, // 10s before window ends
    };
  }

  return { canUpload: false, latestUploadMs: 0 };
}
