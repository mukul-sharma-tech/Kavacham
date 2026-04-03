import type { GroundStation } from "../physics/types";

// Hardcoded from ground_stations.csv (loaded at startup)
export const GROUND_STATIONS: GroundStation[] = [
  { id: "GS-001", name: "ISTRAC_Bengaluru",       lat: 13.0333,  lon: 77.5167,   elevationM: 820,  minElevAngleDeg: 5.0  },
  { id: "GS-002", name: "Svalbard_Sat_Station",   lat: 78.2297,  lon: 15.4077,   elevationM: 400,  minElevAngleDeg: 5.0  },
  { id: "GS-003", name: "Goldstone_Tracking",     lat: 35.4266,  lon: -116.8900, elevationM: 1000, minElevAngleDeg: 10.0 },
  { id: "GS-004", name: "Punta_Arenas",           lat: -53.1500, lon: -70.9167,  elevationM: 30,   minElevAngleDeg: 5.0  },
  { id: "GS-005", name: "IIT_Delhi_Ground_Node",  lat: 28.5450,  lon: 77.1926,   elevationM: 225,  minElevAngleDeg: 15.0 },
  { id: "GS-006", name: "McMurdo_Station",        lat: -77.8463, lon: 166.6682,  elevationM: 10,   minElevAngleDeg: 5.0  },
];
