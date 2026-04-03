// Physical constants for orbital mechanics
export const MU = 398600.4418; // Earth gravitational parameter km^3/s^2
export const RE = 6378.137;    // Earth equatorial radius km
export const J2 = 1.08263e-3;  // J2 perturbation coefficient
export const G0 = 9.80665;     // Standard gravity m/s^2

// Spacecraft constants
export const DRY_MASS = 500.0;       // kg
export const INITIAL_FUEL = 50.0;    // kg
export const WET_MASS = 550.0;       // kg
export const ISP = 300.0;            // s
export const MAX_DV = 15.0;          // m/s per burn
export const COOLDOWN_S = 600;       // seconds between burns

// Conjunction thresholds (problem statement: critical < 100 m)
export const CRITICAL_MISS_KM = 0.1;   // 100 m — physical collision / mandatory evasion
export const WARN_MISS_KM = 5.0;       // 5 km warning
export const STATION_BOX_KM = 10.0;   // 10 km station-keeping radius
export const FUEL_CRITICAL_PCT = 0.05; // 5% fuel threshold for EOL

// Communication
export const SIGNAL_LATENCY_S = 10;   // seconds
export const LOOKAHEAD_S = 86400;     // 24 hours prediction window
