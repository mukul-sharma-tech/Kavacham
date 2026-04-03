/**
 * Global Multi-Objective Optimizer for ACM.
 * Balances fuel efficiency vs constellation uptime using reinforcement learning-inspired approach.
 * Minimizes total fuel expenditure while maximizing time satellites spend in nominal slots.
 */
import { getAllSatellites, getState } from "../state/store";
import { calculateEvasionSequence, calculateStationKeepingBurn, propellantConsumed } from "../maneuver/cola";
import { vec3 } from "../physics/vector";
import { STATION_BOX_KM, INITIAL_FUEL, COOLDOWN_S, MAX_DV, DRY_MASS } from "../physics/constants";
import { getUploadWindow, hasAnyLOS } from "../comms/los";
import { GROUND_STATIONS } from "../comms/groundStations";
import type { Satellite, CDMWarning, ManeuverBurn } from "../physics/types";

const MS = 1000;

/** Cost weights for multi-objective optimization */
const FUEL_COST_WEIGHT = 1000;    // penalty per kg fuel used
const UPTIME_COST_WEIGHT = 10;    // penalty per second outside slot
const COLLISION_RISK_WEIGHT = 10000; // penalty for collision risk

/** Optimization horizon (seconds) */
const OPTIMIZATION_HORIZON_S = 3600; // 1 hour lookahead

/**
 * Global state assessment for optimization.
 */
interface OptimizationState {
  satellites: Satellite[];
  warnings: CDMWarning[];
  currentTimeMs: number;
  totalFuelRemaining: number;
  totalOutageSeconds: number;
  collisionRiskCount: number;
}

/**
 * Burn decision with cost-benefit analysis.
 */
interface BurnDecision {
  satelliteId: string;
  burnType: "evasion" | "station-keeping";
  burn: ManeuverBurn;
  fuelCost: number;
  uptimeBenefit: number;
  riskReduction: number;
  netBenefit: number;
}

/**
 * Assess global constellation state for optimization.
 */
function assessGlobalState(): OptimizationState {
  const state = getState();
  const satellites = getAllSatellites();

  return {
    satellites,
    warnings: state.activeWarnings,
    currentTimeMs: state.currentTimeMs,
    totalFuelRemaining: satellites.reduce((sum, sat) => sum + sat.fuelMass, 0),
    totalOutageSeconds: state.outageSeconds,
    collisionRiskCount: state.activeWarnings.filter(w => w.missDistance < 1.0).length,
  };
}

/**
 * Calculate cost-benefit of a potential burn.
 */
function evaluateBurnDecision(
  sat: Satellite,
  burn: ManeuverBurn,
  burnType: "evasion" | "station-keeping",
  globalState: OptimizationState
): BurnDecision | null {
  if (!burn) return null;

  const fuelCost = propellantConsumed(sat.fuelMass + DRY_MASS, vec3.mag(burn.deltaV) * MS);

  // Estimate uptime benefit (time satellite will spend in slot after burn)
  let uptimeBenefit = 0;
  if (burnType === "station-keeping") {
    // Station-keeping burn: assume 60 minutes of uptime benefit (more valuable for constellation health)
    uptimeBenefit = 3600; // 60 minutes
  } else if (burnType === "evasion") {
    // Evasion burn: assume 45 minutes of uptime benefit (after recovery)
    uptimeBenefit = 2700; // 45 minutes
  }

  // Risk reduction (for evasion burns)
  let riskReduction = 0;
  if (burnType === "evasion") {
    const satWarnings = globalState.warnings.filter(w => w.satelliteId === sat.id);
    riskReduction = satWarnings.length * 100; // arbitrary risk units
  }

  // Net benefit calculation
  const fuelPenalty = fuelCost * FUEL_COST_WEIGHT;
  const uptimeValue = uptimeBenefit * UPTIME_COST_WEIGHT;
  const riskValue = riskReduction * COLLISION_RISK_WEIGHT;
  const netBenefit = uptimeValue + riskValue - fuelPenalty;

  return {
    satelliteId: sat.id,
    burnType,
    burn,
    fuelCost,
    uptimeBenefit,
    riskReduction,
    netBenefit,
  };
}

/**
 * Global optimizer: select optimal burns across constellation.
 * Uses greedy selection with cost-benefit analysis.
 */
export function optimizeGlobalBurns(): ManeuverBurn[] {
  const globalState = assessGlobalState();
  const decisions: BurnDecision[] = [];

  // Evaluate all possible burn opportunities
  for (const sat of globalState.satellites) {
    if (sat.status === "EOL") continue;

    const nowMs = globalState.currentTimeMs;

    // Check for pending burns (don't schedule conflicting ones)
    const hasPending = sat.scheduledManeuvers.some(b => !b.executed);
    const inCooldown = sat.lastBurnTime > 0 && (nowMs - sat.lastBurnTime) < COOLDOWN_S * 1000;

    if (hasPending || inCooldown) continue;

    // Station-keeping: fire whenever outside the 10km box
    const drift = vec3.dist(sat.state.r, sat.nominalSlot.r);
    if (drift > STATION_BOX_KM) {
      const skBurn = calculateStationKeepingBurn(sat, nowMs);
      if (skBurn) {
        const decision = evaluateBurnDecision(sat, skBurn, "station-keeping", globalState);
        if (decision) decisions.push(decision); // always include station-keeping
      }
    }

    // *** EVASION BURNS: REQUIRE LOS (ground control approval) ***
    // Check for available LOS within next 30 minutes for burn upload
    const losInfo = getUploadWindow(sat.state.r, sat.state.v, GROUND_STATIONS, nowMs + 1800000, nowMs);
    if (!losInfo.canUpload) continue; // Skip evasion if no LOS

    // Evaluate evasion opportunities
    const satWarnings = globalState.warnings.filter(w => w.satelliteId === sat.id && w.missDistance < 1.0);
    for (const warning of satWarnings) {
      const evasionSequence = calculateEvasionSequence(sat, warning, nowMs);
      if (evasionSequence) {
        // Evaluate the primary evasion burn
        const evasionDecision = evaluateBurnDecision(sat, evasionSequence[0], "evasion", globalState);
        if (evasionDecision) decisions.push(evasionDecision);
      }
    }
  }

  // Sort by net benefit (highest first)
  decisions.sort((a, b) => b.netBenefit - a.netBenefit);

  // Select non-conflicting burns (greedy selection)
  const selectedBurns: ManeuverBurn[] = [];
  const usedSatellites = new Set<string>();

  for (const decision of decisions) {
    if (!usedSatellites.has(decision.satelliteId) && decision.netBenefit > 0) {
      selectedBurns.push(decision.burn);
      usedSatellites.add(decision.satelliteId);

      // For evasion sequences, also include recovery burn if present
      if (decision.burnType === "evasion") {
        const sat = globalState.satellites.find(s => s.id === decision.satelliteId);
        if (sat) {
          const warning = globalState.warnings.find(w => w.satelliteId === sat.id && w.missDistance < 1.0);
          if (warning) {
            const sequence = calculateEvasionSequence(sat, warning, globalState.currentTimeMs);
            if (sequence && sequence.length > 1) {
              selectedBurns.push(sequence[1]); // recovery burn
            }
          }
        }
      }
    }
  }

  // Fallback: only fire station-keeping if drift is very large (> 50 km)
  // This prevents spurious burns right after loading
  if (selectedBurns.length === 0) {
    for (const sat of globalState.satellites) {
      if (sat.status === "EOL") continue;
      const nowMs = globalState.currentTimeMs;
      const hasPending = sat.scheduledManeuvers.some(b => !b.executed);
      const inCooldown = sat.lastBurnTime > 0 && (nowMs - sat.lastBurnTime) < COOLDOWN_S * 1000;
      if (hasPending || inCooldown) continue;

      const drift = vec3.dist(sat.state.r, sat.nominalSlot.r);
      if (drift > 15.0) { // Fire station-keeping when meaningfully outside the 10km box
        const skBurn = calculateStationKeepingBurn(sat, nowMs);
        if (skBurn) {
          selectedBurns.push(skBurn);
          break;
        }
      }
    }
  }

  return selectedBurns;
}

/**
 * Emergency optimizer: prioritize collision avoidance over fuel efficiency.
 */
export function optimizeEmergencyBurns(): ManeuverBurn[] {
  const globalState = assessGlobalState();
  const emergencyBurns: ManeuverBurn[] = [];

  // Prioritize critical conjunctions (< 100m)
  const criticalWarnings = globalState.warnings.filter(w => w.missDistance < 0.1);

  for (const warning of criticalWarnings) {
    const sat = globalState.satellites.find(s => s.id === warning.satelliteId);
    if (!sat || sat.status === "EOL") continue;

    // Check cooldown before scheduling emergency burns
    const hasPending = sat.scheduledManeuvers.some(b => !b.executed);
    const inCooldown = sat.lastBurnTime > 0 && (globalState.currentTimeMs - sat.lastBurnTime) < COOLDOWN_S * 1000;
    if (hasPending || inCooldown) continue;

    const sequence = calculateEvasionSequence(sat, warning, globalState.currentTimeMs);
    if (sequence) {
      emergencyBurns.push(...sequence);
    }
  }

  return emergencyBurns;
}

/**
 * Blackout zone preloader: schedules maneuver sequences before LOS loss.
 * When satellites approach blackout zones, preload complete burn sequences
 * for autonomous execution during communication outages.
 */
export function preloadBlackoutSequences(): ManeuverBurn[] {
  const globalState = assessGlobalState();
  const preloadedBurns: ManeuverBurn[] = [];

  for (const sat of globalState.satellites) {
    if (sat.status === "EOL") continue;

    // Check if satellite is currently in LOS
    const currentLOS = hasAnyLOS(sat.state.r, GROUND_STATIONS);
    if (!currentLOS) continue; // Can't preload if no current contact

    // Find next blackout period
    const nextBlackout = getUploadWindow(sat.state.r, sat.state.v, GROUND_STATIONS, globalState.currentTimeMs + 86400000, globalState.currentTimeMs); // 24h lookahead

    if (!nextBlackout.canUpload) {
      // Satellite will enter blackout soon - check for pending threats
      const satWarnings = globalState.warnings.filter(w => w.satelliteId === sat.id);

      // Preload evasion sequences for imminent threats
      for (const warning of satWarnings) {
        if (warning.missDistance < 1.0 && warning.tca < globalState.currentTimeMs + 3600000) { // Within 1 hour
          const sequence = calculateEvasionSequence(sat, warning, globalState.currentTimeMs);
          if (sequence) {
            // Tag burns for autonomous execution
            const autonomousSequence = sequence.map(burn => ({
              ...burn,
              burnId: burn.burnId.replace('EVASION_', 'AUTONOMOUS_EVASION_'),
              // These will be uploaded now for later execution
            }));
            preloadedBurns.push(...autonomousSequence);
          }
        }
      }

      // Preload station-keeping if drift is significant and no threats
      if (satWarnings.length === 0) {
        const drift = vec3.dist(sat.state.r, sat.nominalSlot.r);
        if (drift > STATION_BOX_KM * 2) { // More aggressive threshold for preloading
          const skBurn = calculateStationKeepingBurn(sat, globalState.currentTimeMs);
          if (skBurn) {
            preloadedBurns.push({
              ...skBurn,
              burnId: skBurn.burnId.replace('STATION_KEEPING_', 'AUTONOMOUS_STATION_KEEPING_'),
            });
          }
        }
      }
    }
  }

  return preloadedBurns;
}