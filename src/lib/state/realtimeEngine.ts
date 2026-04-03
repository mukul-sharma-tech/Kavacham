/**
 * Realtime autonomous engine.
 * Runs on the server — ticks every TICK_MS, propagates all objects,
 * fires COLA automatically, no human needed.
 */
import { getState, getAllSatellites, getAllDebris, updateSatellite, advanceTime, logManeuver, incrementCollisions, addOutageSeconds, setWarnings, scheduleBurns, resetState } from "./store";
import { propagate } from "../physics/propagator";
import { applyBurn, isInStationBox, needsEOL, calculateGraveyardBurn, calculateEvasionSequence, calculateStationKeepingBurn } from "../maneuver/cola";
import { assessConjunctions } from "../spatial/conjunction";
import { vec3 } from "../physics/vector";
import { CRITICAL_MISS_KM, COOLDOWN_S } from "../physics/constants";
import { getUploadWindow, hasAnyLOS } from "../comms/los";
import { GROUND_STATIONS } from "../comms/groundStations";
import { optimizeGlobalBurns, optimizeEmergencyBurns, preloadBlackoutSequences } from "../optimizer/global";
import { parseSatelliteIdFromBurnId } from "../maneuver/burnId";
import { trimAppendGroundTrack } from "../telemetry/groundTrack";

const TICK_MS = 1000;          // wall-clock tick interval
let SIM_STEP_S = 60;         // sim seconds per tick (60x speed) - now configurable
const COLA_INTERVAL_TICKS = 5; // run COLA every 5 ticks

let _running = false;
let _tickCount = 0;
let _intervalId: ReturnType<typeof setInterval> | null = null;

export function isRunning() { return _running; }

export function getSpeedMultiplier() { return SIM_STEP_S; }

export function setSpeedMultiplier(secondsPerTick: number) {
  if (secondsPerTick < 1 || secondsPerTick > 3600) return false; // reasonable bounds
  SIM_STEP_S = secondsPerTick;
  return true;
}

export function startRealtime() {
  if (_running) return;
  _running = true;
  _tickCount = 0;
  // Do not clear state here; startup logic (API route) decides when to reset/seed
  _intervalId = setInterval(tick, TICK_MS);
  console.log("[realtime] started");
}

export function stopRealtime() {
  _running = false;
  if (_intervalId) { clearInterval(_intervalId); _intervalId = null; }
  console.log("[realtime] stopped");
}

function tick() {
  if (!_running) return;
  _tickCount++;

  try {
    const state = getState();
  const nowMs = state.currentTimeMs;
  const dtS = SIM_STEP_S;
  const nextMs = nowMs + dtS * 1000;

  // 1. Propagate debris
  for (const [id, deb] of state.debris) {
    if (!deb.state?.r) continue; // guard against malformed objects
    state.debris.set(id, { ...deb, state: propagate(deb.state, dtS), timestamp: nextMs });
  }

  // 2. Propagate satellites + execute burns
  for (const [id, sat] of state.satellites) {
    if (!sat.state?.r) continue; // guard against malformed objects
    let s = { ...sat };

    const pending = s.scheduledManeuvers.filter(
      (b) => !b.executed && b.burnTime >= nowMs && b.burnTime < nextMs
    );

    for (const burn of pending) {
      const dtToBurn = (burn.burnTime - nowMs) / 1000;
      if (dtToBurn > 0) s = { ...s, state: propagate(s.state, dtToBurn) };
      // Guard: only apply burn if deltaV is valid
      if (burn.deltaV?.x !== undefined && burn.deltaV?.y !== undefined && burn.deltaV?.z !== undefined) {
        s = applyBurn(s, burn.deltaV, burn.burnTime);
        s.status = "EVADING";
        logManeuver({ burnId: burn.burnId, satelliteId: id, executedAt: burn.burnTime, dvMs: vec3.mag(burn.deltaV) * 1000 });
      }
      burn.executed = true;
    }

    const dtRem = dtS - pending.reduce((acc, b) => Math.max(acc, Math.max(0, (b.burnTime - nowMs) / 1000)), 0);
    if (dtRem > 0 && s.state?.r && s.state?.v) s = { ...s, state: propagate(s.state, dtRem) };

    // Propagate nominal slot — keep it on the reference orbit
    if (s.nominalSlot?.r && s.nominalSlot?.v) {
      s.nominalSlot = propagate(s.nominalSlot, dtS);
    }

    // Station-keeping
    if (!isInStationBox(s)) {
      addOutageSeconds(dtS);
      if (s.status === "NOMINAL") s = { ...s, status: "RECOVERING" };
    } else if (s.status === "RECOVERING") {
      s = { ...s, status: "NOMINAL" };
    }

    // EOL
    if (needsEOL(s) && s.status !== "EOL") {
      const gb = calculateGraveyardBurn(s, nextMs);
      if (gb) { s = { ...s, status: "EOL" }; scheduleBurns(id, [gb]); }
    }

    s.timestamp = nextMs;
    updateSatellite(trimAppendGroundTrack(s, nextMs));
  }

  // 3. Collision detection
  const sats = getAllSatellites();
  const debris = getAllDebris();
  for (const sat of sats) {
    if (!sat.state?.r) continue;
    for (const deb of debris) {
      if (!deb.state?.r) continue;
      if (vec3.dist(sat.state.r, deb.state.r) < CRITICAL_MISS_KM) incrementCollisions();
    }
  }

  advanceTime(nextMs);

  // 4. Conjunction assessment + autonomous COLA every N ticks
  if (_tickCount % COLA_INTERVAL_TICKS === 0) {
    const warnings = assessConjunctions(sats, debris, nextMs);
    setWarnings(warnings);

    // Use global optimizer for constellation-wide burn decisions
    let optimalBurns: ReturnType<typeof optimizeGlobalBurns> = [];

    // Emergency mode for critical conjunctions
    const criticalWarnings = warnings.filter(w => w.missDistance < CRITICAL_MISS_KM);
    if (criticalWarnings.length > 0) {
      optimalBurns = optimizeEmergencyBurns();
    } else {
      // Normal optimization balancing fuel vs uptime
      optimalBurns = optimizeGlobalBurns();
    }

    // Schedule the optimized burns
    for (const burn of optimalBurns) {
      const satId = parseSatelliteIdFromBurnId(burn.burnId);
      if (satId) scheduleBurns(satId, [burn]);
    }

    const blackoutBurns = preloadBlackoutSequences();
    for (const burn of blackoutBurns) {
      const satId = parseSatelliteIdFromBurnId(burn.burnId);
      if (satId) scheduleBurns(satId, [burn]);
    }
  }
  } catch (err) {
    console.error("[realtime] tick error — stopping engine:", err);
    stopRealtime();
  }
}
