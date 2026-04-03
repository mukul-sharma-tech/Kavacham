/**
 * Autonomous COLA trigger: runs after each telemetry update.
 * Uses global multi-objective optimizer to schedule constellation-wide burns.
 */
import { NextResponse } from "next/server";
import { getState, scheduleBurns } from "@/lib/state/store";
import { optimizeGlobalBurns, optimizeEmergencyBurns, preloadBlackoutSequences } from "@/lib/optimizer/global";
import { vec3 } from "@/lib/physics/vector";
import { CRITICAL_MISS_KM } from "@/lib/physics/constants";

export async function POST() {
  const state = getState();
  const scheduled: string[] = [];
  const skipped: string[] = [];

  // Emergency mode: prioritize collision avoidance
  const criticalWarnings = state.activeWarnings.filter(
    (w) => w.missDistance < CRITICAL_MISS_KM
  );

  if (criticalWarnings.length > 0) {
    // Use emergency optimizer for critical situations
    const emergencyBurns = optimizeEmergencyBurns();

    for (const burn of emergencyBurns) {
      // Find which satellite this burn belongs to
      const satId = burn.burnId.split('_')[1]; // Extract from burnId like "EVASION_SAT-001_..."
      const success = scheduleBurns(satId, [burn]);
      if (success) {
        scheduled.push(`${satId}: ${burn.burnId}`);
      } else {
        skipped.push(`${satId}: failed to schedule ${burn.burnId}`);
      }
    }
  } else {
    // Normal mode: use global optimizer for balanced fuel/uptime decisions
    const optimalBurns = optimizeGlobalBurns();

    for (const burn of optimalBurns) {
      // Extract satellite ID from burn ID
      const satId = burn.burnId.split('_')[1];
      const success = scheduleBurns(satId, [burn]);
      if (success) {
        scheduled.push(`${satId}: ${burn.burnId} (optimized)`);
      } else {
        skipped.push(`${satId}: failed to schedule ${burn.burnId}`);
      }
    }
  }

  // Preload blackout sequences for proactive autonomous execution
  const blackoutBurns = preloadBlackoutSequences();
  for (const burn of blackoutBurns) {
    const parts = burn.burnId.split('_');
    const satId = parts.find(part => part.startsWith('SAT-'));
    if (satId) {
      const success = scheduleBurns(satId, [burn]);
      if (success) {
        scheduled.push(`${satId}: ${burn.burnId} (blackout preload)`);
      } else {
        skipped.push(`${satId}: failed to preload ${burn.burnId}`);
      }
    }
  }

  return NextResponse.json({
    status: "OK",
    critical_warnings: criticalWarnings.length,
    scheduled,
    skipped,
    optimization_mode: criticalWarnings.length > 0 ? "emergency" : "global",
  });
}
