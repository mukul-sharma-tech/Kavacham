/**
 * Predictive Conjunction Assessment (CA) engine.
 * Uses KD-Tree + RK4 propagation to find Time of Closest Approach (TCA).
 */
import { KDTree, type KDPoint } from "./kdtree";
import { propagate } from "../physics/propagator";
import { vec3 } from "../physics/vector";
import { CRITICAL_MISS_KM, WARN_MISS_KM, LOOKAHEAD_S } from "../physics/constants";
import type { SpaceObject, CDMWarning, StateVector } from "../physics/types";

const SCAN_STEP_S = 30;    // coarse scan step
const REFINE_STEP_S = 1;   // fine refinement step

/**
 * Find TCA between two objects using bisection refinement.
 * Returns miss distance (km) and TCA offset (seconds from now).
 */
function findTCA(
  s1: StateVector,
  s2: StateVector,
  windowS: number
): { missKm: number; tcaOffsetS: number } {
  let best = { missKm: vec3.dist(s1.r, s2.r), tcaOffsetS: 0 };
  let cur1 = s1, cur2 = s2;

  // Coarse scan
  for (let t = 0; t <= windowS; t += SCAN_STEP_S) {
    const d = vec3.dist(cur1.r, cur2.r);
    if (d < best.missKm) best = { missKm: d, tcaOffsetS: t };
    cur1 = propagate(cur1, SCAN_STEP_S);
    cur2 = propagate(cur2, SCAN_STEP_S);
  }

  // Fine refinement around best coarse estimate
  const refineStart = Math.max(0, best.tcaOffsetS - SCAN_STEP_S);
  const refineEnd = Math.min(windowS, best.tcaOffsetS + SCAN_STEP_S);
  let r1 = propagateToOffset(s1, refineStart);
  let r2 = propagateToOffset(s2, refineStart);

  for (let t = refineStart; t <= refineEnd; t += REFINE_STEP_S) {
    const d = vec3.dist(r1.r, r2.r);
    if (d < best.missKm) best = { missKm: d, tcaOffsetS: t };
    r1 = propagate(r1, REFINE_STEP_S);
    r2 = propagate(r2, REFINE_STEP_S);
  }

  return best;
}

function propagateToOffset(state: StateVector, offsetS: number): StateVector {
  let s = state;
  let rem = offsetS;
  while (rem > 0) {
    const dt = Math.min(60, rem);
    s = propagate(s, dt);
    rem -= dt;
  }
  return s;
}

/**
 * Run conjunction assessment for all satellites vs debris field.
 * Uses KD-Tree to prune candidates before expensive TCA calculation.
 */
export function assessConjunctions(
  satellites: SpaceObject[],
  debris: SpaceObject[],
  nowMs: number,
  lookaheadS = LOOKAHEAD_S
): CDMWarning[] {
  const warnings: CDMWarning[] = [];

  // Build KD-Tree from debris positions
  const tree = new KDTree();
  const debrisPoints: KDPoint[] = debris.map((d) => ({ id: d.id, pos: d.state.r }));
  tree.build(debrisPoints);

  // Pre-index debris by id for constant-time lookup
  const debrisById = new Map(debris.map((d) => [d.id, d] as const));

  // Screening radius: horizon derived from max plausible relative speed
  // LEO ∼7.5 km/s orbital velocity, relative geometry adds margin.
  const maxRelSpeedKmS = 10; // conservative upper bound
  const SCREEN_KM = Math.min(80000, maxRelSpeedKmS * lookaheadS + 1000);

  for (const sat of satellites) {
    const candidates = tree.queryRadius(sat.state.r, SCREEN_KM);

    for (const cand of candidates) {
      const deb = debrisById.get(cand.id);
      if (!deb) continue;

      // Quick distance filter before expensive time-of-closest-approach
      const initialDist = vec3.dist(sat.state.r, deb.state.r);
      if (initialDist > SCREEN_KM) continue;

      const { missKm, tcaOffsetS } = findTCA(sat.state, deb.state, lookaheadS);

      if (missKm < WARN_MISS_KM) {
        const relV = vec3.dist(sat.state.v, deb.state.v);
        warnings.push({
          satelliteId: sat.id,
          debrisId: deb.id,
          tca: nowMs + tcaOffsetS * 1000,
          missDistance: missKm,
          relativeVelocity: relV,
        });
      }
    }
  }

  // Sort by miss distance ascending (most critical first)
  return warnings.sort((a, b) => a.missDistance - b.missDistance);
}
