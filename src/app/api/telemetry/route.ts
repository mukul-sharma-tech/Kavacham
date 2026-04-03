import { NextRequest, NextResponse } from "next/server";
import { upsertObject, setWarnings, getState, getAllSatellites, getAllDebris, setGroundStations, markSnapshotDirty } from "@/lib/state/store";
import { assessConjunctions } from "@/lib/spatial/conjunction";
import { GROUND_STATIONS } from "@/lib/comms/groundStations";
import type { SpaceObject } from "@/lib/physics/types";

// Initialize ground stations once
setGroundStations(GROUND_STATIONS);
export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { timestamp, objects } = body as {
      timestamp: string;
      objects: Array<{
        id: string;
        type: "SATELLITE" | "DEBRIS";
        r: { x: number; y: number; z: number };
        v: { x: number; y: number; z: number };
      }>;
    };

    if (!objects || !Array.isArray(objects)) {
      return NextResponse.json({ error: "Invalid payload" }, { status: 400 });
    }

    const ts = new Date(timestamp).getTime();

    // Ingest all objects
    for (const obj of objects) {
      const spaceObj: SpaceObject = {
        id: obj.id,
        type: obj.type,
        state: { r: obj.r, v: obj.v },
        timestamp: ts,
      };
      upsertObject(spaceObj);
    }

    // Run conjunction assessment asynchronously (don't block response)
    const satellites = getAllSatellites();
    const debris = getAllDebris();
    const warnings = assessConjunctions(satellites, debris, ts);
    setWarnings(warnings);
    markSnapshotDirty();

    return NextResponse.json({
      status: "ACK",
      processed_count: objects.length,
      active_cdm_warnings: warnings.length,
    });
  } catch (err) {
    console.error("[telemetry]", err);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}
