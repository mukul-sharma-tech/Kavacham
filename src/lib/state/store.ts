/**
 * In-memory simulation state store (singleton for Next.js API routes).
 * Holds all satellites, debris, ground stations, and CDM warnings.
 */
import type { Satellite, SpaceObject, CDMWarning, GroundStation, ManeuverBurn } from "../physics/types";
import { DRY_MASS, INITIAL_FUEL } from "../physics/constants";

interface SimState {
  currentTimeMs: number;
  satellites: Map<string, Satellite>;
  debris: Map<string, SpaceObject>;
  activeWarnings: CDMWarning[];
  groundStations: GroundStation[];
  maneuverLog: Array<{ burnId: string; satelliteId: string; executedAt: number; dvMs: number }>;
  collisionCount: number;
  outageSeconds: number; // total seconds outside station box
}

// Global singleton (persists across API route calls in same process)
const state: SimState = {
  currentTimeMs: Date.now(),
  satellites: new Map(),
  debris: new Map(),
  activeWarnings: [],
  groundStations: [],
  maneuverLog: [],
  collisionCount: 0,
  outageSeconds: 0,
};

export function getState(): SimState {
  return state;
}

export function upsertObject(obj: SpaceObject): void {
  if (obj.type === "SATELLITE") {
    const existing = state.satellites.get(obj.id);
    if (existing) {
      state.satellites.set(obj.id, { ...existing, state: obj.state, timestamp: obj.timestamp });
    } else {
      // New satellite - initialize with defaults
      state.satellites.set(obj.id, {
        ...obj,
        type: "SATELLITE",
        fuelMass: INITIAL_FUEL,
        dryMass: DRY_MASS,
        nominalSlot: obj.state, // initial position is nominal slot
        lastBurnTime: 0,
        status: "NOMINAL",
        scheduledManeuvers: [],
      } as Satellite);
    }
  } else {
    state.debris.set(obj.id, obj);
  }
}

export function getSatellite(id: string): Satellite | undefined {
  return state.satellites.get(id);
}

export function updateSatellite(sat: Satellite): void {
  state.satellites.set(sat.id, sat);
}

export function scheduleBurns(satelliteId: string, burns: ManeuverBurn[]): boolean {
  const sat = state.satellites.get(satelliteId);
  if (!sat) return false;
  sat.scheduledManeuvers.push(...burns);
  sat.scheduledManeuvers.sort((a, b) => a.burnTime - b.burnTime);
  return true;
}

export function setWarnings(warnings: CDMWarning[]): void {
  state.activeWarnings = warnings;
}

export function setGroundStations(stations: GroundStation[]): void {
  state.groundStations = stations;
}

export function advanceTime(newTimeMs: number): void {
  state.currentTimeMs = newTimeMs;
}

export function logManeuver(entry: { burnId: string; satelliteId: string; executedAt: number; dvMs: number }): void {
  state.maneuverLog.push(entry);
}

export function incrementCollisions(): void {
  state.collisionCount++;
}

export function addOutageSeconds(s: number): void {
  state.outageSeconds += s;
}

export function getAllDebris(): SpaceObject[] {
  return Array.from(state.debris.values());
}

export function resetState(): void {
  state.satellites.clear();
  state.debris.clear();
  state.activeWarnings = [];
  state.maneuverLog = [];
  state.collisionCount = 0;
  state.outageSeconds = 0;
}

export function getAllSatellites(): Satellite[] {
  return Array.from(state.satellites.values());
}

// Snapshot cache invalidation flag — set by write operations, read by snapshot route
let _snapshotDirty = false;
export function markSnapshotDirty() { _snapshotDirty = true; }
export function isSnapshotDirty() { return _snapshotDirty; }
export function clearSnapshotDirty() { _snapshotDirty = false; }
