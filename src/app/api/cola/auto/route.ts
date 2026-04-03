/**
 * Autonomous COLA trigger: runs after each telemetry update.
 * Uses global multi-objective optimizer to schedule constellation-wide burns.
 */
import { NextResponse } from "next/server";
import { getState, scheduleBurns } from "@/lib/state/store";
import { optimizeGlobalBurns, optimizeEmergencyBurns, preloadBlackoutSequences } from "@/lib/optimizer/global";
import { CRITICAL_MISS_KM } from "@/lib/physics/constants";
import { parseSatelliteIdFromBurnId } from "@/lib/maneuver/burnId";

export async function POST() {
  const state = getState();
  const scheduled: string[] = [];
  const skipped: string[] = [];

  const criticalWarnings = state.activeWarnings.filter(
    (w) => w.missDistance < CRITICAL_MISS_KM
  );

  if (criticalWarnings.length > 0) {
    const emergencyBurns = optimizeEmergencyBurns();

    for (const burn of emergencyBurns) {
      const satId = parseSatelliteIdFromBurnId(burn.burnId);
      if (!satId) {
        skipped.push(`unparseable burnId: ${burn.burnId}`);
        continue;
      }
      const success = scheduleBurns(satId, [burn]);
      if (success) scheduled.push(`${satId}: ${burn.burnId}`);
      else skipped.push(`${satId}: failed to schedule ${burn.burnId}`);
    }
  } else {
    const optimalBurns = optimizeGlobalBurns();

    for (const burn of optimalBurns) {
      const satId = parseSatelliteIdFromBurnId(burn.burnId);
      if (!satId) {
        skipped.push(`unparseable burnId: ${burn.burnId}`);
        continue;
      }
      const success = scheduleBurns(satId, [burn]);
      if (success) scheduled.push(`${satId}: ${burn.burnId} (optimized)`);
      else skipped.push(`${satId}: failed to schedule ${burn.burnId}`);
    }
  }

  const blackoutBurns = preloadBlackoutSequences();
  for (const burn of blackoutBurns) {
    const satId = parseSatelliteIdFromBurnId(burn.burnId);
    if (!satId) {
      skipped.push(`blackout: unparseable burnId ${burn.burnId}`);
      continue;
    }
    const success = scheduleBurns(satId, [burn]);
    if (success) scheduled.push(`${satId}: ${burn.burnId} (blackout preload)`);
    else skipped.push(`${satId}: failed to preload ${burn.burnId}`);
  }

  return NextResponse.json({
    status: "OK",
    critical_warnings: criticalWarnings.length,
    scheduled,
    skipped,
    optimization_mode: criticalWarnings.length > 0 ? "emergency" : "global",
  });
}
