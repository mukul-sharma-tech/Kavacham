import type { Vec3 } from "./types";

export const vec3 = {
  add: (a: Vec3, b: Vec3): Vec3 => ({ x: a.x + b.x, y: a.y + b.y, z: a.z + b.z }),
  sub: (a: Vec3, b: Vec3): Vec3 => ({ x: a.x - b.x, y: a.y - b.y, z: a.z - b.z }),
  scale: (a: Vec3, s: number): Vec3 => ({ x: a.x * s, y: a.y * s, z: a.z * s }),
  dot: (a: Vec3, b: Vec3): number => a.x * b.x + a.y * b.y + a.z * b.z,
  cross: (a: Vec3, b: Vec3): Vec3 => ({
    x: a.y * b.z - a.z * b.y,
    y: a.z * b.x - a.x * b.z,
    z: a.x * b.y - a.y * b.x,
  }),
  mag: (a: Vec3): number => Math.sqrt(a.x * a.x + a.y * a.y + a.z * a.z),
  norm: (a: Vec3): Vec3 => {
    const m = vec3.mag(a);
    return m > 0 ? vec3.scale(a, 1 / m) : { x: 0, y: 0, z: 0 };
  },
  dist: (a: Vec3, b: Vec3): number => vec3.mag(vec3.sub(a, b)),
  zero: (): Vec3 => ({ x: 0, y: 0, z: 0 }),
};

/**
 * Build RTN rotation matrix columns from satellite state.
 * Returns [R_hat, T_hat, N_hat] as Vec3 arrays.
 */
export function rtnFrame(r: Vec3, v: Vec3): [Vec3, Vec3, Vec3] {
  const R = vec3.norm(r);
  const N = vec3.norm(vec3.cross(r, v));
  const T = vec3.cross(N, R);
  return [R, T, N];
}

/**
 * Convert a delta-v vector from RTN frame to ECI frame.
 * dvRTN: { x: radial, y: transverse, z: normal } in km/s
 */
export function rtnToEci(dvRTN: Vec3, r: Vec3, v: Vec3): Vec3 {
  const [R, T, N] = rtnFrame(r, v);
  return {
    x: R.x * dvRTN.x + T.x * dvRTN.y + N.x * dvRTN.z,
    y: R.y * dvRTN.x + T.y * dvRTN.y + N.y * dvRTN.z,
    z: R.z * dvRTN.x + T.z * dvRTN.y + N.z * dvRTN.z,
  };
}
