export interface Vec3 {
  x: number;
  y: number;
  z: number;
}

export interface StateVector {
  r: Vec3; // position km
  v: Vec3; // velocity km/s
}

export type ObjectType = "SATELLITE" | "DEBRIS";

export interface SpaceObject {
  id: string;
  type: ObjectType;
  state: StateVector;
  timestamp: number; // Unix ms
}

export interface Satellite extends SpaceObject {
  type: "SATELLITE";
  fuelMass: number;       // kg remaining
  dryMass: number;        // kg
  nominalSlot: StateVector; // reference orbit slot
  lastBurnTime: number;   // Unix ms, 0 if never
  status: "NOMINAL" | "EVADING" | "RECOVERING" | "EOL";
  scheduledManeuvers: ManeuverBurn[];
}

export interface ManeuverBurn {
  burnId: string;
  burnTime: number; // Unix ms
  deltaV: Vec3;     // km/s in ECI frame
  executed: boolean;
}

export interface CDMWarning {
  satelliteId: string;
  debrisId: string;
  tca: number;       // Unix ms - Time of Closest Approach
  missDistance: number; // km
  relativeVelocity: number; // km/s
}

export interface GroundStation {
  id: string;
  name: string;
  lat: number;
  lon: number;
  elevationM: number;
  minElevAngleDeg: number;
}
