import type { BBox, MeshData, Vec3 } from "../types";

export function triangleCount(mesh: MeshData): number {
  return mesh.indices.length / 3;
}

export function bboxOf(mesh: MeshData): BBox {
  const p = mesh.positions;
  let minX = Infinity, minY = Infinity, minZ = Infinity;
  let maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity;
  for (let i = 0; i < p.length; i += 3) {
    const x = p[i], y = p[i + 1], z = p[i + 2];
    if (x < minX) minX = x;
    if (y < minY) minY = y;
    if (z < minZ) minZ = z;
    if (x > maxX) maxX = x;
    if (y > maxY) maxY = y;
    if (z > maxZ) maxZ = z;
  }
  if (!Number.isFinite(minX)) {
    return { min: [0, 0, 0], max: [0, 0, 0] };
  }
  return { min: [minX, minY, minZ], max: [maxX, maxY, maxZ] };
}

export function bboxSize(b: BBox): Vec3 {
  return [b.max[0] - b.min[0], b.max[1] - b.min[1], b.max[2] - b.min[2]];
}

/** Signed volume, mm³. Positive when windings face outward. */
export function signedVolume(mesh: MeshData): number {
  const p = mesh.positions;
  const idx = mesh.indices;
  let v = 0;
  for (let i = 0; i < idx.length; i += 3) {
    const a = idx[i] * 3, b = idx[i + 1] * 3, c = idx[i + 2] * 3;
    const ax = p[a], ay = p[a + 1], az = p[a + 2];
    const bx = p[b], by = p[b + 1], bz = p[b + 2];
    const cx = p[c], cy = p[c + 1], cz = p[c + 2];
    v += ax * (by * cz - bz * cy) - ay * (bx * cz - bz * cx) + az * (bx * cy - by * cx);
  }
  return v / 6;
}

export function flipMesh(mesh: MeshData): MeshData {
  const indices = new Uint32Array(mesh.indices);
  for (let i = 0; i < indices.length; i += 3) {
    const t = indices[i + 1];
    indices[i + 1] = indices[i + 2];
    indices[i + 2] = t;
  }
  return { positions: mesh.positions, indices };
}

/** Edges used once. A closed manifold has zero. */
export function openEdgeCount(mesh: MeshData): number {
  const idx = mesh.indices;
  const map = new Map<string, number>();
  const add = (a: number, b: number) => {
    const k = a < b ? `${a}:${b}` : `${b}:${a}`;
    map.set(k, (map.get(k) || 0) + 1);
  };
  for (let i = 0; i < idx.length; i += 3) {
    add(idx[i], idx[i + 1]);
    add(idx[i + 1], idx[i + 2]);
    add(idx[i + 2], idx[i]);
  }
  let open = 0;
  for (const n of map.values()) if (n !== 2) open++;
  return open;
}

export function boxMesh(size: Vec3, origin: Vec3 = [0, 0, 0]): MeshData {
  const [sx, sy, sz] = size;
  const [ox, oy, oz] = origin;
  const x1 = ox + sx, y1 = oy + sy, z1 = oz + sz;
  const positions = new Float32Array([
    ox, oy, oz, x1, oy, oz, x1, y1, oz, ox, y1, oz,
    ox, oy, z1, x1, oy, z1, x1, y1, z1, ox, y1, z1,
  ]);
  const indices = new Uint32Array([
    0, 2, 1, 0, 3, 2,
    4, 5, 6, 4, 6, 7,
    0, 1, 5, 0, 5, 4,
    1, 2, 6, 1, 6, 5,
    2, 3, 7, 2, 7, 6,
    3, 0, 4, 3, 4, 7,
  ]);
  return { positions, indices };
}

/**
 * Watertight sample: 40×30×16 block with a 12 mm pyramid roof.
 * Volume = 40*30*16 + (40*30*12)/3 = 24000 mm³.
 */
export function sampleMaster(): MeshData {
  const w = 40, d = 30, h = 16, roof = 12;
  const x0 = -w / 2, x1 = w / 2, y0 = -d / 2, y1 = d / 2;
  const positions = new Float32Array([
    x0, y0, 0, x1, y0, 0, x1, y1, 0, x0, y1, 0,
    x0, y0, h, x1, y0, h, x1, y1, h, x0, y1, h,
    0, 0, h + roof,
  ]);
  const indices = new Uint32Array([
    0, 2, 1, 0, 3, 2,
    0, 1, 5, 0, 5, 4,
    1, 2, 6, 1, 6, 5,
    2, 3, 7, 2, 7, 6,
    3, 0, 4, 3, 4, 7,
    4, 5, 8,
    5, 6, 8,
    6, 7, 8,
    7, 4, 8,
  ]);
  const mesh = { positions, indices };
  return signedVolume(mesh) < 0 ? flipMesh(mesh) : mesh;
}

export function transformMesh(mesh: MeshData, map: (x: number, y: number, z: number) => Vec3): MeshData {
  const src = mesh.positions;
  const positions = new Float32Array(src.length);
  for (let i = 0; i < src.length; i += 3) {
    const [x, y, z] = map(src[i], src[i + 1], src[i + 2]);
    positions[i] = x;
    positions[i + 1] = y;
    positions[i + 2] = z;
  }
  return { positions, indices: mesh.indices };
}

/** Weld vertices onto a grid and drop degenerate triangles. */
export function weldMesh(mesh: MeshData, eps = 1e-3): MeshData {
  const src = mesh.positions;
  const idx = mesh.indices;
  const map = new Map<string, number>();
  const out: number[] = [];
  const remap = new Uint32Array(src.length / 3);
  const inv = 1 / eps;
  for (let i = 0; i < src.length; i += 3) {
    const key = `${Math.round(src[i] * inv)}:${Math.round(src[i + 1] * inv)}:${Math.round(src[i + 2] * inv)}`;
    let id = map.get(key);
    if (id == null) {
      id = out.length / 3;
      map.set(key, id);
      out.push(src[i], src[i + 1], src[i + 2]);
    }
    remap[i / 3] = id;
  }
  const indices: number[] = [];
  for (let i = 0; i < idx.length; i += 3) {
    const a = remap[idx[i]], b = remap[idx[i + 1]], c = remap[idx[i + 2]];
    if (a === b || b === c || c === a) continue;
    const ax = out[a * 3], ay = out[a * 3 + 1], az = out[a * 3 + 2];
    const bx = out[b * 3], by = out[b * 3 + 1], bz = out[b * 3 + 2];
    const cx = out[c * 3], cy = out[c * 3 + 1], cz = out[c * 3 + 2];
    const ux = bx - ax, uy = by - ay, uz = bz - az;
    const vx = cx - ax, vy = cy - ay, vz = cz - az;
    const area = Math.hypot(uy * vz - uz * vy, uz * vx - ux * vz, ux * vy - uy * vx);
    if (area < 1e-8) continue;
    indices.push(a, b, c);
  }
  return { positions: Float32Array.from(out), indices: Uint32Array.from(indices) };
}
