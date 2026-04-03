/**
 * 3D KD-Tree for O(N log N) spatial indexing of orbital objects.
 * Eliminates the O(N^2) conjunction bottleneck.
 */
import type { Vec3 } from "../physics/types";

export interface KDPoint {
  id: string;
  pos: Vec3;
}

interface KDNode {
  point: KDPoint;
  left: KDNode | null;
  right: KDNode | null;
  axis: number;
}

function buildKDTree(points: KDPoint[], depth = 0): KDNode | null {
  if (points.length === 0) return null;

  const axis = depth % 3;
  const axisKey = axis === 0 ? "x" : axis === 1 ? "y" : "z";

  const sorted = [...points].sort((a, b) => a.pos[axisKey] - b.pos[axisKey]);
  const median = Math.floor(sorted.length / 2);

  return {
    point: sorted[median],
    axis,
    left: buildKDTree(sorted.slice(0, median), depth + 1),
    right: buildKDTree(sorted.slice(median + 1), depth + 1),
  };
}

function sqDist(a: Vec3, b: Vec3): number {
  const dx = a.x - b.x, dy = a.y - b.y, dz = a.z - b.z;
  return dx * dx + dy * dy + dz * dz;
}

function searchKNN(
  node: KDNode | null,
  target: Vec3,
  radius: number,
  results: KDPoint[]
): void {
  if (!node) return;

  const d2 = sqDist(node.point.pos, target);
  if (d2 <= radius * radius) {
    results.push(node.point);
  }

  const axisKey = node.axis === 0 ? "x" : node.axis === 1 ? "y" : "z";
  const diff = target[axisKey] - node.point.pos[axisKey];

  const near = diff <= 0 ? node.left : node.right;
  const far = diff <= 0 ? node.right : node.left;

  searchKNN(near, target, radius, results);

  // Only search far side if the splitting plane is within radius
  if (Math.abs(diff) <= radius) {
    searchKNN(far, target, radius, results);
  }
}

export class KDTree {
  private root: KDNode | null = null;
  private points: KDPoint[] = [];

  build(points: KDPoint[]): void {
    this.points = points;
    this.root = buildKDTree(points);
  }

  /** Find all points within radius km of target */
  queryRadius(target: Vec3, radius: number): KDPoint[] {
    const results: KDPoint[] = [];
    searchKNN(this.root, target, radius, results);
    return results;
  }

  /** Find nearest neighbor */
  nearest(target: Vec3): KDPoint | null {
    if (!this.root) return null;
    let bestPoint: KDPoint | null = null;
    let bestDist2 = Infinity;

    function search(node: KDNode | null): void {
      if (!node) return;
      const d2 = sqDist(node.point.pos, target);
      if (d2 < bestDist2) { bestDist2 = d2; bestPoint = node.point; }

      const axisKey = node.axis === 0 ? "x" : node.axis === 1 ? "y" : "z";
      const diff = target[axisKey] - node.point.pos[axisKey];
      const near = diff <= 0 ? node.left : node.right;
      const far = diff <= 0 ? node.right : node.left;

      search(near);
      if (diff * diff < bestDist2) search(far);
    }

    search(this.root);
    return bestPoint;
  }

  size(): number {
    return this.points.length;
  }
}
