import earcut from "earcut";
import { rotatePoint, type BonePose } from "./kinematics";
import type { Point, SkinMesh, VectorPart } from "./model";
import { mapPartPoint, partMatrix } from "./part-transform";

export function worldPoint(local: Point, origin: Point, angle: number): Point {
  const point = rotatePoint(local, angle);
  return { x: origin.x + point.x, y: origin.y + point.y };
}

function curvePoint(a: Point, b: Point, c: Point, d: Point, t: number): Point {
  const u = 1 - t;
  return {
    x: u ** 3 * a.x + 3 * u * u * t * b.x + 3 * u * t * t * c.x + t ** 3 * d.x,
    y: u ** 3 * a.y + 3 * u * u * t * b.y + 3 * u * t * t * c.y + t ** 3 * d.y,
  };
}

export function bindMesh(part: VectorPart, poses: Map<string, BonePose>, boneId: string): SkinMesh {
  if (!part.closed || !poses.has(boneId)) throw new Error("Choose a bone and a closed path.");
  const polygon: Point[] = [];
  for (const [index, knot] of part.knots.entries()) {
    polygon.push(knot.point);
    const next = part.knots[(index + 1) % part.knots.length];
    if (!knot.outgoing && !next.incoming) continue;
    for (let step = 1; step < 5; step++) {
      polygon.push(curvePoint(knot.point, knot.outgoing ?? knot.point, next.incoming ?? next.point, next.point, step / 5));
    }
  }
  const indices = earcut(polygon.flatMap(({x, y}) => [x, y]));
  if (indices.length < 3) throw new Error("The path has no triangulatable area.");
  const triangles: SkinMesh["triangles"] = [];
  const midpoints = new Map<string, number>();
  const midpoint = (left: number, right: number) => {
    const key = left < right ? left + ":" + right : right + ":" + left;
    const stored = midpoints.get(key);
    if (stored !== undefined) return stored;
    const a = polygon[left];
    const b = polygon[right];
    const index = polygon.push({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 }) - 1;
    midpoints.set(key, index);
    return index;
  };
  for (let index = 0; index < indices.length; index += 3) {
    const [a, b, c] = indices.slice(index, index + 3);
    if (indices.length > 1800) {
      triangles.push([a, b, c]);
    } else {
      const ab = midpoint(a, b);
      const bc = midpoint(b, c);
      const ca = midpoint(c, a);
      triangles.push([a, ab, ca], [ab, b, bc], [ca, bc, c], [ab, bc, ca]);
    }
  }
  const parent = part.parentId === null ? undefined : poses.get(part.parentId);
  return {
    origin: worldPoint(part.offset, parent?.origin ?? { x: 0, y: 0 }, parent?.angle ?? 0),
    angle: parent?.angle ?? 0,
    offset: { ...part.offset },
    bindings: [...poses].map(([id, pose]) => ({ id, origin: pose.origin, angle: pose.angle })),
    vertices: polygon.map(point => ({ point, weights: [{ boneId, weight: 1 }] })),
    triangles,
  };
}

export function deformMesh(part: VectorPart, poses: Map<string, BonePose>): Point[] {
  const mesh = part.mesh;
  if (!mesh) return [];
  const matrices = new Map(mesh.bindings.map(binding => [binding.id, binding]));
  const transform = partMatrix(part);
  return mesh.vertices.map(vertex => {
    const local = mapPartPoint(transform,vertex.point);
    const bind = worldPoint({ x:local.x-mesh.offset.x, y:local.y-mesh.offset.y }, mesh.origin, mesh.angle);
    const result = { x: 0, y: 0 };
    for (const { boneId, weight } of vertex.weights) {
      const initial = matrices.get(boneId)!;
      const pose = poses.get(boneId);
      const point = pose ? worldPoint(
        rotatePoint({ x: bind.x - initial.origin.x, y: bind.y - initial.origin.y }, -initial.angle),
        pose.origin, pose.angle,
      ) : bind;
      result.x += point.x * weight;
      result.y += point.y * weight;
    }
    return result;
  });
}

/** Increase the selected bone's influence with radial falloff and renormalize each touched vertex. */
export function paintMesh(part: VectorPart, poses: Map<string, BonePose>, boneId: string,
  center: Point, radius: number, strength: number,
): SkinMesh {
  const mesh = part.mesh;
  if (!mesh || !mesh.bindings.some(binding => binding.id === boneId)) throw new Error("Bind the mesh before painting.");
  if (!(radius > 0) || !(strength > 0)) return mesh;
  const points = deformMesh(part, poses);
  const vertices = mesh.vertices.map((vertex, index) => {
    const point = points[index];
    const falloff = Math.max(0, 1 - Math.hypot(center.x - point.x, center.y - point.y) / radius);
    const delta = Math.min(1, strength * falloff);
    const existing = vertex.weights.find(entry => entry.boneId === boneId)?.weight ?? 0;
    if (delta < 1e-6 || existing >= 1) return vertex;
    const influence = existing + (1 - existing) * delta;
    const weights = vertex.weights.filter(entry => entry.boneId !== boneId)
      .map(entry => ({ ...entry, weight: entry.weight * (1 - delta) }))
      .filter(entry => entry.weight > 1e-6).sort((a, b) => b.weight - a.weight).slice(0, 3);
    weights.push({ boneId, weight: influence });
    const sum = weights.reduce((total, entry) => total + entry.weight, 0);
    return { ...vertex, weights: weights.map(entry => ({ ...entry, weight: entry.weight / sum })) };
  });
  return { ...mesh, vertices };
}
