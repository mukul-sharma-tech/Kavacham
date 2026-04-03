/**
 * Orbital mechanics helpers for generating constellation configurations.
 */

export interface StateVec {
  r: { x: number; y: number; z: number };
  v: { x: number; y: number; z: number };
}

const RE = 6378.137;
const MU = 398600.4418;

/** Generate a circular orbit state vector */
export function circularOrbit(altKm: number, incDeg: number, raanDeg: number, nuDeg: number): StateVec {
  const r = RE + altKm;
  const v = Math.sqrt(MU / r);
  const inc = incDeg * Math.PI / 180;
  const raan = raanDeg * Math.PI / 180;
  const nu = nuDeg * Math.PI / 180;

  const rx = r * Math.cos(nu);
  const ry = r * Math.sin(nu);
  const cosR = Math.cos(raan), sinR = Math.sin(raan);
  const cosI = Math.cos(inc), sinI = Math.sin(inc);

  return {
    r: {
      x: rx * cosR - ry * cosI * sinR,
      y: rx * sinR + ry * cosI * cosR,
      z: ry * sinI,
    },
    v: {
      x: (-v * Math.sin(nu)) * cosR - (v * Math.cos(nu)) * cosI * sinR,
      y: (-v * Math.sin(nu)) * sinR + (v * Math.cos(nu)) * cosI * cosR,
      z: (v * Math.cos(nu)) * sinI,
    },
  };
}

/** Generate N satellites spread across orbital planes */
export function generateConstellation(count: number, altKm = 550): Array<{ id: string; type: "SATELLITE"; state: StateVec }> {
  const sats = [];
  // Distribute across planes with different inclinations
  const planeConfigs = [
    { inc: 0,  raan: 0   },  // equatorial
    { inc: 28, raan: 0   },  // low inclination
    { inc: 45, raan: 60  },  // mid inclination
    { inc: 53, raan: 120 },  // ISS-like
    { inc: 53, raan: 180 },
    { inc: 53, raan: 240 },
    { inc: 70, raan: 0   },  // high inclination
    { inc: 70, raan: 90  },
    { inc: 86, raan: 45  },  // near-polar
    { inc: 86, raan: 135 },  // near-polar
    { inc: 97, raan: 0   },  // sun-synchronous
    { inc: 97, raan: 180 },
  ];

  const planesNeeded = Math.min(planeConfigs.length, Math.ceil(count / 3));
  const satsPerPlane = Math.ceil(count / planesNeeded);

  let idx = 0;
  for (let p = 0; p < planesNeeded && idx < count; p++) {
    const plane = planeConfigs[p % planeConfigs.length];
    const inThisPlane = Math.min(satsPerPlane, count - idx);
    for (let s = 0; s < inThisPlane; s++) {
      const nu = (s / inThisPlane) * 360;
      const alt = altKm + (idx % 4) * 15; // slight altitude variation
      sats.push({
        id: `SAT-${String(idx + 1).padStart(3, "0")}`,
        type: "SATELLITE" as const,
        state: circularOrbit(alt, plane.inc, plane.raan, nu),
      });
      idx++;
    }
  }
  return sats;
}

/** Generate debris objects near satellite orbits */
export function generateDebris(count: number, satellites: Array<{ state: StateVec }>): Array<{ id: string; type: "DEBRIS"; state: StateVec }> {
  const debris = [];
  const rng = (min: number, max: number) => min + Math.random() * (max - min);

  // First 30% are close-approach debris — same direction, slightly different speed
  // This creates a genuine future conjunction, not an immediate pass
  const closeCount = Math.min(Math.floor(count * 0.3), satellites.length);
  for (let i = 0; i < closeCount; i++) {
    const sat = satellites[i % satellites.length];
    // Place debris very close (0.05-0.25 km) ahead in orbit with a stronger speed bias,
    // so one of the nearest objects quickly becomes a conjunction alert.
    const speedFactor = 1.0 + rng(0.0015, 0.0035); // 0.15-0.35% faster = catches up faster
    debris.push({
      id: `DEB-CLOSE-${String(i + 1).padStart(3, "0")}`,
      type: "DEBRIS" as const,
      state: {
        r: {
          x: sat.state.r.x + sat.state.v.x * rng(3, 12), // 3-12s ahead in orbit
          y: sat.state.r.y + sat.state.v.y * rng(3, 12),
          z: sat.state.r.z + sat.state.v.z * rng(3, 12),
        },
        v: {
          x: sat.state.v.x * speedFactor,
          y: sat.state.v.y * speedFactor,
          z: sat.state.v.z * speedFactor,
        },
      },
    });
  }

  // Rest are random debris at LEO altitudes
  for (let i = closeCount; i < count; i++) {
    const alt = rng(400, 800);
    const inc = rng(0, 100);
    const raan = rng(0, 360);
    const nu = rng(0, 360);
    const sv = circularOrbit(alt, inc, raan, nu);
    sv.v.x += rng(-0.08, 0.08);
    sv.v.y += rng(-0.08, 0.08);
    sv.v.z += rng(-0.04, 0.04);
    debris.push({
      id: `DEB-${String(i + 1).padStart(4, "0")}`,
      type: "DEBRIS" as const,
      state: sv,
    });
  }

  return debris;
}
