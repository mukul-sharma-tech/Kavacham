/**
 * Collision Avoidance (COLA) maneuver calculator.
 * Uses Clohessy-Wiltshire (Hill's) equations for accurate relative motion.
 * Computes evasion burn in RTN frame, converts to ECI.
 */
import { vec3, rtnToEci } from "../physics/vector";
import { propagateN } from "../physics/propagator";
import {
  MAX_DV, ISP, G0, DRY_MASS, MU, RE,
  COOLDOWN_S, CRITICAL_MISS_KM, SIGNAL_LATENCY_S,
  FUEL_CRITICAL_PCT, INITIAL_FUEL, STATION_BOX_KM,
} from "../physics/constants";
import type { Satellite, ManeuverBurn, CDMWarning, Vec3 } from "../physics/types";

const MS = 1000;

/** Tsiolkovsky rocket equation: propellant consumed (kg) for dv in m/s */
export function propellantConsumed(currentMass: number, dvMs: number): number {
  return currentMass * (1 - Math.exp(-dvMs / (ISP * G0)));
}

/** Mean motion n (rad/s) from orbital radius r (km) */
function meanMotion(rKm: number): number {
  return Math.sqrt(MU / (rKm * rKm * rKm));
}

/**
 * Clohessy-Wiltshire: radial displacement after time t (s)
 * for a transverse (along-track) impulse dv_T (km/s).
 * delta_r_radial = (2/n) * dv_T * (1 - cos(n*t))   [CW eq]
 * delta_r_along  = (2/n) * dv_T * sin(n*t) + (3*dv_T*t) [drift term]
 *
 * For miss distance improvement we primarily use the along-track separation.
 * Required dv_T to achieve target separation delta_s at TCA time t:
 *   delta_s ≈ (2/n)*dv_T*sin(n*t) + 3*dv_T*t  (simplified for small n*t)
 *   For large t: delta_s ≈ 3*dv_T*t  => dv_T = delta_s / (3*t)
 */
function cwRequiredDvT(targetSepKm: number, tS: number, rKm: number): number {
  const n = meanMotion(rKm);
  const nt = n * tS;
  // Full CW along-track: (2/n)*sin(nt) + 3*t
  const factor = (2 / n) * Math.sin(nt) + 3 * tS;
  if (factor <= 0) return MAX_DV / MS; // fallback
  return targetSepKm / factor; // km/s
}

/**
 * Calculate evasion + recovery burn sequence.
 * Returns [evasionBurn, recoveryBurn] or null if impossible.
 */
export function calculateEvasionSequence(
  sat: Satellite,
  warning: CDMWarning,
  nowMs: number
): ManeuverBurn[] | null {
  const fuelFraction = sat.fuelMass / INITIAL_FUEL;
  if (fuelFraction < FUEL_CRITICAL_PCT) return null;

  const tcaOffsetS = (warning.tca - nowMs) / MS;
  if (tcaOffsetS < SIGNAL_LATENCY_S + 5) return null;

  const evasionBurnTimeMs = nowMs + SIGNAL_LATENCY_S * MS;
  const timeToTcaS = tcaOffsetS - SIGNAL_LATENCY_S;

  // Target: push miss distance to 200m (2x safety margin above 100m threshold)
  const targetMissKm = 0.20;
  const additionalSepNeeded = Math.max(0, targetMissKm - warning.missDistance);

  if (warning.missDistance > CRITICAL_MISS_KM) return null;

  const rMag = vec3.mag(sat.state.r);

  // Use CW equations for accurate dv calculation
  let dvKmS = cwRequiredDvT(additionalSepNeeded + 0.05, timeToTcaS, rMag);

  // Clamp to hardware limit
  const dvMs = Math.min(dvKmS * MS + 0.3, MAX_DV); // +0.3 m/s safety margin
  dvKmS = dvMs / MS;

  // Determine burn direction: prograde raises orbit (increases along-track separation)
  const dvRTN: Vec3 = { x: 0, y: dvKmS, z: 0 }; // prograde transverse burn
  const dvECI = rtnToEci(dvRTN, sat.state.r, sat.state.v);

  const currentMass = sat.fuelMass + DRY_MASS;
  if (propellantConsumed(currentMass, dvMs) > sat.fuelMass) return null;

  const evasionBurn: ManeuverBurn = {
    burnId: `EVASION_${sat.id}_${Date.now()}`,
    burnTime: evasionBurnTimeMs,
    deltaV: dvECI,
    executed: false,
  };

  // Recovery burn: after cooldown, retrograde to return to nominal slot
  const recoveryBurnTimeMs = evasionBurnTimeMs + COOLDOWN_S * MS;
  const stateAtRecovery = propagateN(sat.state, COOLDOWN_S + SIGNAL_LATENCY_S);

  // Recovery dv: match the evasion magnitude but retrograde, slightly less to account for drift
  const recoveryDvKmS = dvKmS * 0.97;
  const recoveryDvRTN: Vec3 = { x: 0, y: -recoveryDvKmS, z: 0 };
  const recoveryDvECI = rtnToEci(recoveryDvRTN, stateAtRecovery.r, stateAtRecovery.v);

  const recoveryBurn: ManeuverBurn = {
    burnId: `RECOVERY_${sat.id}_${Date.now() + 1}`,
    burnTime: recoveryBurnTimeMs,
    deltaV: recoveryDvECI,
    executed: false,
  };

  return [evasionBurn, recoveryBurn];
}

/**
 * Calculate graveyard orbit disposal burn.
 * Raises perigee to >300 km above LEO (graveyard at ~2000 km alt).
 * Uses a single prograde burn to raise apogee, then a second to circularize.
 * Simplified: single prograde burn to raise orbit by ~300 km.
 */
export function calculateGraveyardBurn(sat: Satellite, nowMs: number): ManeuverBurn | null {
  if (sat.fuelMass <= 0) return null;

  const rMag = vec3.mag(sat.state.r);
  const currentAlt = rMag - RE;
  const targetAlt = currentAlt + 300; // raise by 300 km

  // Hohmann transfer: dv for raising apogee
  // v_current = sqrt(MU/r), v_transfer_perigee = sqrt(2*MU*r_apo / (r*(r+r_apo)))
  const r1 = rMag;
  const r2 = RE + targetAlt;
  const v1 = Math.sqrt(MU / r1);
  const vTransfer = Math.sqrt(2 * MU * r2 / (r1 * (r1 + r2)));
  const dvKmS = Math.min(vTransfer - v1, MAX_DV / MS);

  const dvRTN: Vec3 = { x: 0, y: dvKmS, z: 0 };
  const dvECI = rtnToEci(dvRTN, sat.state.r, sat.state.v);

  return {
    burnId: `GRAVEYARD_${sat.id}_${Date.now()}`,
    burnTime: nowMs + SIGNAL_LATENCY_S * MS,
    deltaV: dvECI,
    executed: false,
  };
}

/** Apply a burn: update velocity and deduct fuel */
export function applyBurn(sat: Satellite, dvECI: Vec3, currentTimeMs: number): Satellite {
  // Guard against malformed deltaV
  if (!dvECI || dvECI.x === undefined || dvECI.y === undefined || dvECI.z === undefined) return sat;
  if (isNaN(dvECI.x) || isNaN(dvECI.y) || isNaN(dvECI.z)) return sat;

  const dvMs = vec3.mag(dvECI) * MS;
  if (dvMs === 0) return sat;
  const currentMass = sat.fuelMass + DRY_MASS;
  const fuelUsed = propellantConsumed(currentMass, dvMs);
  return {
    ...sat,
    state: { ...sat.state, v: vec3.add(sat.state.v, dvECI) },
    fuelMass: Math.max(0, sat.fuelMass - fuelUsed),
    lastBurnTime: currentTimeMs,
  };
}

/** Check if satellite is within station-keeping box */
export function isInStationBox(sat: Satellite): boolean {
  return vec3.dist(sat.state.r, sat.nominalSlot.r) <= 10.0;
}

/** Check if satellite needs EOL graveyard maneuver */
export function needsEOL(sat: Satellite): boolean {
  return sat.fuelMass / INITIAL_FUEL < FUEL_CRITICAL_PCT;
}

/** Calculate station-keeping burn to return to nominal slot */
export function calculateStationKeepingBurn(sat: Satellite, nowMs: number): ManeuverBurn | null {
  const drift = vec3.dist(sat.state.r, sat.nominalSlot.r);
  if (drift <= STATION_BOX_KM) return null;

  const deltaR = vec3.sub(sat.nominalSlot.r, sat.state.r);
  const direction = vec3.norm(deltaR);
  if (!direction || isNaN(direction.x) || isNaN(direction.y) || isNaN(direction.z)) return null;

  // proportional Δv; max 12 m/s to mitigate drift quickly without overburning
  const dvKmS = Math.min(0.012, Math.max(0.002, drift / 800));
  const dvECI = vec3.scale(direction, dvKmS);

  const currentMass = sat.fuelMass + DRY_MASS;
  const fuelUsed = propellantConsumed(currentMass, dvKmS * MS);
  if (fuelUsed > sat.fuelMass) return null;

  return {
    burnId: `STATION_KEEPING_${sat.id}_${Date.now()}`,
    burnTime: nowMs + SIGNAL_LATENCY_S * MS,
    deltaV: dvECI,
    executed: false,
  };
}
