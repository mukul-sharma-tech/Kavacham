/**
 * Demo Mode — guaranteed visible action for hackathon presentation.
 * Every tick: satellites move, burns fire, fuel drops, alerts show.
 */
import { NextRequest, NextResponse } from "next/server";
import {
  upsertObject, getState, getAllSatellites,
  scheduleBurns, resetState, markSnapshotDirty,
  setGroundStations, updateSatellite,
} from "@/lib/state/store";
import { GROUND_STATIONS } from "@/lib/comms/groundStations";
import { circularOrbit } from "@/lib/physics/orbits";
import { rtnToEci } from "@/lib/physics/vector";
import { applyBurn } from "@/lib/maneuver/cola";
import { COOLDOWN_S } from "@/lib/physics/constants";
import type { SpaceObject } from "@/lib/physics/types";
import { startRealtime, stopRealtime, isRunning, setSpeedMultiplier } from "@/lib/state/realtimeEngine";

let _demoInterval: ReturnType<typeof setInterval> | null = null;
let _demoRunning = false;
let _demoPhase = 0;

function seedDemoScenario() {
  resetState();
  setGroundStations(GROUND_STATIONS);
  const now = Date.now();

  const satConfigs = [
    { id: "SAT-ALPHA", inc: 0,  raan: 0,   nu: 0,   alt: 550 },
    { id: "SAT-BETA",  inc: 53, raan: 60,  nu: 72,  alt: 560 },
    { id: "SAT-GAMMA", inc: 86, raan: 0,   nu: 144, alt: 540 },
    { id: "SAT-DELTA", inc: 45, raan: 120, nu: 216, alt: 555 },
    { id: "SAT-ECHO",  inc: 97, raan: 180, nu: 288, alt: 545 },
  ];

  const sats: SpaceObject[] = satConfigs.map((c) => ({
    id: c.id, type: "SATELLITE" as const,
    state: circularOrbit(c.alt, c.inc, c.raan, c.nu),
    timestamp: now,
  }));

  // Background debris
  const debrisConfigs = [
    { inc: 30, raan: 30,  nu: 45,  alt: 520 }, { inc: 60, raan: 90,  nu: 90,  alt: 580 },
    { inc: 75, raan: 150, nu: 135, alt: 510 }, { inc: 20, raan: 200, nu: 180, alt: 600 },
    { inc: 45, raan: 270, nu: 225, alt: 530 }, { inc: 85, raan: 320, nu: 270, alt: 570 },
    { inc: 10, raan: 45,  nu: 315, alt: 545 }, { inc: 55, raan: 135, nu: 0,   alt: 560 },
    { inc: 70, raan: 225, nu: 45,  alt: 525 }, { inc: 35, raan: 315, nu: 90,  alt: 590 },
  ];
  const debris: SpaceObject[] = debrisConfigs.map((c, i) => {
    const sv = circularOrbit(c.alt, c.inc, c.raan, c.nu);
    sv.v.x += (Math.random() - 0.5) * 0.1;
    sv.v.y += (Math.random() - 0.5) * 0.1;
    return { id: `DEB-${String(i + 1).padStart(2, "0")}`, type: "DEBRIS" as const, state: sv, timestamp: now };
  });

  // Threat debris — ahead in orbit, slightly faster
  [sats[0], sats[1], sats[2]].forEach((sat, i) => {
    const boost = 1.0015 + i * 0.0005;
    const ahead = 180 + i * 60;
    debris.push({
      id: `DEB-THREAT-${i + 1}`, type: "DEBRIS" as const,
      state: {
        r: { x: sat.state.r.x + sat.state.v.x * ahead, y: sat.state.r.y + sat.state.v.y * ahead, z: sat.state.r.z + sat.state.v.z * ahead },
        v: { x: sat.state.v.x * boost, y: sat.state.v.y * boost, z: sat.state.v.z * boost },
      },
      timestamp: now,
    });
  });

  for (const obj of [...sats, ...debris]) upsertObject(obj);
  markSnapshotDirty();
  return { satellites: sats.length, debris: debris.length };
}

/** Directly apply a burn to a satellite NOW — bypasses scheduling for instant demo effect */
function applyImmediateBurn(satId: string, dvMs: number) {
  const state = getState();
  const sat = state.satellites.get(satId);
  if (!sat || sat.fuelMass <= 0) return false;

  const dvKmS = dvMs / 1000;
  const dvRTN = { x: 0, y: dvKmS, z: 0 };
  const dvECI = rtnToEci(dvRTN, sat.state.r, sat.state.v);
  const nowMs = state.currentTimeMs;

  const updated = applyBurn(sat, dvECI, nowMs);
  updated.status = "EVADING";
  updateSatellite(updated);

  // Schedule recovery burn after cooldown
  const recoveryDvECI = { x: -dvECI.x * 0.97, y: -dvECI.y * 0.97, z: -dvECI.z * 0.97 };
  scheduleBurns(satId, [{
    burnId: `DEMO_RECOVERY_${satId}_${Date.now()}`,
    burnTime: nowMs + COOLDOWN_S * 1000,
    deltaV: recoveryDvECI,
    executed: false,
  }]);

  markSnapshotDirty();
  return true;
}

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({}));
  const action = (body as { action?: string }).action;

  if (action === "start") {
    if (isRunning()) stopRealtime();
    if (_demoInterval) { clearInterval(_demoInterval); _demoInterval = null; }

    const counts = seedDemoScenario();

    // Apply immediate burns to first 2 satellites — fuel drops instantly
    const sats = getAllSatellites();
    if (sats[0]) applyImmediateBurn(sats[0].id, 3.0);  // 3 m/s
    if (sats[1]) applyImmediateBurn(sats[1].id, 2.0);  // 2 m/s

    // Start engine at 120x speed
    setSpeedMultiplier(120);
    startRealtime();
    _demoRunning = true;
    _demoPhase = 0;

    // Every 25 seconds: apply a new burn to a different satellite
    _demoInterval = setInterval(() => {
      _demoPhase++;
      const allSats = getAllSatellites();
      if (allSats.length === 0) return;

      const target = allSats[_demoPhase % allSats.length];
      if (!target || target.status === "EOL" || target.fuelMass < 1) return;

      const dvMs = 1.5 + (_demoPhase % 4) * 0.5; // 1.5 - 3.5 m/s varying
      applyImmediateBurn(target.id, dvMs);
    }, 25000);

    return NextResponse.json({
      status: "DEMO_STARTED",
      ...counts,
      message: "Demo active — burns fire every 25s, fuel decreasing, 120x speed",
    });
  }

  if (action === "stop") {
    if (_demoInterval) { clearInterval(_demoInterval); _demoInterval = null; }
    stopRealtime();
    _demoRunning = false;
    setSpeedMultiplier(60);
    return NextResponse.json({ status: "DEMO_STOPPED" });
  }

  return NextResponse.json({ running: _demoRunning, phase: _demoPhase });
}

export async function GET() {
  return NextResponse.json({ running: _demoRunning, phase: _demoPhase });
}
