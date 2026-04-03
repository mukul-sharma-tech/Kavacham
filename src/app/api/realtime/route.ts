import { NextRequest, NextResponse } from "next/server";
import { startRealtime, stopRealtime, isRunning, getSpeedMultiplier, setSpeedMultiplier } from "@/lib/state/realtimeEngine";
import { upsertObject, getState, resetState } from "@/lib/state/store";
import { generateConstellation, generateDebris } from "@/lib/physics/orbits";
import type { SpaceObject } from "@/lib/physics/types";

function seedConstellation(satCount = 50, debrisCount = 200) {
  const now = Date.now();
  const sats = generateConstellation(satCount);
  const debris = generateDebris(debrisCount, sats);
  const allObjects = [...sats, ...debris];
  for (const obj of allObjects) {
    upsertObject({ ...obj, timestamp: now } as SpaceObject);
  }
  return { satellites: sats.length, debris: debris.length };
}

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({}));
  const action = (body as { action?: string }).action;

  if (action === "start") {
    // Reset and seed before starting the realtime engine (avoid wiping seeded satellites in startRealtime())
    resetState();
    const satCount = (body as { satCount?: number }).satCount ?? 50;
    const debrisCount = (body as { debrisCount?: number }).debrisCount ?? 200;
    const counts = seedConstellation(satCount, debrisCount);
    startRealtime();
    return NextResponse.json({ status: "STARTED", ...counts, sim_time: new Date(getState().currentTimeMs).toISOString() });
  }

  if (action === "stop") {
    stopRealtime();
    return NextResponse.json({ status: "STOPPED" });
  }

  if (action === "speed") {
    const speed = (body as { speed?: number }).speed;
    if (typeof speed === "number") {
      const success = setSpeedMultiplier(speed);
      if (success) {
        return NextResponse.json({ status: "SPEED_SET", speed_multiplier: speed });
      } else {
        return NextResponse.json({ error: "Invalid speed value" }, { status: 400 });
      }
    }
  }

  return NextResponse.json({ running: isRunning(), sim_time: new Date(getState().currentTimeMs).toISOString() });
}

export async function GET() {
  return NextResponse.json({
    running: isRunning(),
    sim_time: new Date(getState().currentTimeMs).toISOString(),
    speed_multiplier: getSpeedMultiplier()
  });
}
