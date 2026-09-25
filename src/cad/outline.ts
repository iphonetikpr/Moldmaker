import type { MeshData } from "../types";

/** Closed XY loop, millimeters. CCW is the solid exterior. */
export type Loop = Array<[number, number]>;

export function polyArea(loop: Loop): number {
  let a = 0;
  for (let i = 0; i < loop.length; i++) {
    const j = (i + 1) % loop.length;
    a += loop[i][0] * loop[j][1] - loop[j][0] * loop[i][1];
  }
  return a / 2;
}

export function ensureCCW(loop: Loop): Loop {
  return polyArea(loop) < 0 ? loop.slice().reverse() : loop.slice();
}

export function cleanLoop(loop: Loop, min = 0.02): Loop {
  const out: Loop = [];
  for (const p of loop) {
    if (!Number.isFinite(p[0]) || !Number.isFinite(p[1])) continue;
    const last = out[out.length - 1];
    if (!last || Math.hypot(p[0] - last[0], p[1] - last[1]) >= min) out.push([p[0], p[1]]);
  }
  if (out.length > 2) {
    const a = out[0];
    const b = out[out.length - 1];
    if (Math.hypot(a[0] - b[0], a[1] - b[1]) < min) out.pop();
  }
  return out;
}

/** Drop the repeated closing vertex Clipper-style dumps. */
export function stripClose(loop: Loop, eps = 1e-6): Loop {
  if (loop.length < 2) return loop.slice();
  const a = loop[0];
  const b = loop[loop.length - 1];
  if (Math.hypot(a[0] - b[0], a[1] - b[1]) <= eps) return loop.slice(0, -1);
  return loop.slice();
}

export function mergeCollinear(loop: Loop, eps = 1e-4): Loop {
  if (loop.length < 3) return loop.slice();
  const pts = loop.slice();
  let changed = true;
  while (changed && pts.length >= 3) {
    changed = false;
    for (let i = 0; i < pts.length; ) {
      const a = pts[(i + pts.length - 1) % pts.length];
      const b = pts[i];
      const c = pts[(i + 1) % pts.length];
      const ab = Math.hypot(b[0] - a[0], b[1] - a[1]);
      if (ab < 1e-8) {
        pts.splice(i, 1);
        changed = true;
        continue;
      }
      const cross = (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);
      const dot = (b[0] - a[0]) * (c[0] - b[0]) + (b[1] - a[1]) * (c[1] - b[1]);
      if (Math.abs(cross) <= eps * ab && dot >= 0) {
        pts.splice(i, 1);
        changed = true;
        continue;
      }
      i++;
    }
  }
  return pts;
}

export function rectLoop(w: number, d: number): Loop {
  const x = w / 2;
  const y = d / 2;
  return [
    [-x, -y],
    [x, -y],
    [x, y],
    [-x, y],
  ];
}

export function loopBounds(loop: Loop): { minX: number; minY: number; maxX: number; maxY: number; w: number; h: number } {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const [x, y] of loop) {
    if (x < minX) minX = x;
    if (y < minY) minY = y;
    if (x > maxX) maxX = x;
    if (y > maxY) maxY = y;
  }
  if (!Number.isFinite(minX)) return { minX: 0, minY: 0, maxX: 0, maxY: 0, w: 0, h: 0 };
  return { minX, minY, maxX, maxY, w: maxX - minX, h: maxY - minY };
}

export function isAxisAlignedRect(loop: Loop, eps = 0.05): boolean {
  if (loop.length !== 4) return false;
  for (let i = 0; i < 4; i++) {
    const a = loop[i];
    const b = loop[(i + 1) % 4];
    const dx = Math.abs(a[0] - b[0]);
    const dy = Math.abs(a[1] - b[1]);
    if (dx > eps && dy > eps) return false;
    if (dx <= eps && dy <= eps) return false;
  }
  return true;
}

export function pointInPoly(pt: [number, number], loop: Loop): boolean {
  const [x, y] = pt;
  let inside = false;
  for (let i = 0, j = loop.length - 1; i < loop.length; j = i++) {
    const xi = loop[i][0];
    const yi = loop[i][1];
    const xj = loop[j][0];
    const yj = loop[j][1];
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

export function isConcave(loop: Loop): boolean {
  const n = loop.length;
  if (n < 4) return false;
  let pos = 0;
  let neg = 0;
  for (let i = 0; i < n; i++) {
    const a = loop[(i + n - 1) % n];
    const b = loop[i];
    const c = loop[(i + 1) % n];
    const cr = (b[0] - a[0]) * (c[1] - b[1]) - (b[1] - a[1]) * (c[0] - b[0]);
    if (cr > 1e-6) pos++;
    else if (cr < -1e-6) neg++;
  }
  return pos > 0 && neg > 0;
}

/**
 * Outward miter offset. One vertex in, one vertex out, so a drafted loft
 * can pair the same corners. CCW loops grow when delta is positive.
 */
export function offsetLoop(loop: Loop, delta: number): Loop {
  const src = ensureCCW(loop);
  const n = src.length;
  if (n < 3 || Math.abs(delta) < 1e-9) return src.map((p) => [p[0], p[1]] as [number, number]);
  const out: Loop = [];
  const miterLimit = 2.5;
  for (let i = 0; i < n; i++) {
    const prev = src[(i - 1 + n) % n];
    const curr = src[i];
    const next = src[(i + 1) % n];
    const e1x = curr[0] - prev[0];
    const e1y = curr[1] - prev[1];
    const e2x = next[0] - curr[0];
    const e2y = next[1] - curr[1];
    const l1 = Math.hypot(e1x, e1y) || 1;
    const l2 = Math.hypot(e2x, e2y) || 1;
    const n1x = e1y / l1;
    const n1y = -e1x / l1;
    const n2x = e2y / l2;
    const n2y = -e2x / l2;
    let bx = n1x + n2x;
    let by = n1y + n2y;
    const bl = Math.hypot(bx, by);
    if (bl < 1e-8) {
      out.push([curr[0] + n1x * delta, curr[1] + n1y * delta]);
      continue;
    }
    bx /= bl;
    by /= bl;
    let denom = bx * n1x + by * n1y;
    if (denom < 0) {
      bx = -bx;
      by = -by;
      denom = -denom;
    }
    let scale = delta / Math.max(denom, 1e-6);
    const cap = Math.abs(delta) * miterLimit;
    if (Math.abs(scale) > cap) scale = Math.sign(scale || 1) * cap;
    out.push([curr[0] + bx * scale, curr[1] + by * scale]);
  }
  return out;
}

function orient(a: [number, number], b: [number, number], c: [number, number]): number {
  return (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);
}

function segmentsIntersect(a: [number, number], b: [number, number], c: [number, number], d: [number, number]): boolean {
  const o1 = orient(a, b, c);
  const o2 = orient(a, b, d);
  const o3 = orient(c, d, a);
  const o4 = orient(c, d, b);
  if (Math.abs(o1) < 1e-9 || Math.abs(o2) < 1e-9 || Math.abs(o3) < 1e-9 || Math.abs(o4) < 1e-9) return false;
  return o1 > 0 !== o2 > 0 && o3 > 0 !== o4 > 0;
}

export function loopSelfIntersects(loop: Loop): boolean {
  const n = loop.length;
  if (n < 4) return false;
  for (let i = 0; i < n; i++) {
    const a = loop[i];
    const b = loop[(i + 1) % n];
    for (let j = i + 1; j < n; j++) {
      const gap = Math.min(Math.abs(i - j), n - Math.abs(i - j));
      if (gap <= 1) continue;
      const c = loop[j];
      const d = loop[(j + 1) % n];
      if (segmentsIntersect(a, b, c, d)) return true;
    }
  }
  return false;
}

/** Positive-area offset that keeps a 1:1 corner map with `offsetLoop`. */
export function offsetClean(loop: Loop, delta: number): Loop | null {
  const shifted = offsetLoop(loop, delta);
  if (shifted.length < 3) return null;
  if (loopSelfIntersects(shifted)) return null;
  if (polyArea(shifted) <= 1e-3) return null;
  return shifted;
}

export function lerpLoop(a: Loop, b: Loop, t: number): Loop {
  const n = Math.min(a.length, b.length);
  const out: Loop = [];
  for (let i = 0; i < n; i++) {
    out.push([a[i][0] + (b[i][0] - a[i][0]) * t, a[i][1] + (b[i][1] - a[i][1]) * t]);
  }
  return out;
}

/** Volume of a linear loft between two loops of equal length. */
export function loftVolume(bottom: Loop, top: Loop, h: number): number {
  const a1 = Math.abs(polyArea(bottom));
  const a2 = Math.abs(polyArea(top));
  return (h / 3) * (a1 + a2 + Math.sqrt(Math.max(0, a1 * a2)));
}

function pointInTri(p: [number, number], a: [number, number], b: [number, number], c: [number, number]): boolean {
  const c1 = (b[0] - a[0]) * (p[1] - a[1]) - (b[1] - a[1]) * (p[0] - a[0]);
  const c2 = (c[0] - b[0]) * (p[1] - b[1]) - (c[1] - b[1]) * (p[0] - b[0]);
  const c3 = (a[0] - c[0]) * (p[1] - c[1]) - (a[1] - c[1]) * (p[0] - c[0]);
  const eps = 1e-9;
  if (Math.abs(c1) <= eps || Math.abs(c2) <= eps || Math.abs(c3) <= eps) return false;
  return (c1 > 0 && c2 > 0 && c3 > 0) || (c1 < 0 && c2 < 0 && c3 < 0);
}

/** Ear-clip a simple polygon. Returns CCW triangles when the loop is CCW. */
export function triangulate(loop: Loop): Array<[number, number, number]> {
  const n = loop.length;
  if (n < 3) return [];
  if (n === 3) return [[0, 1, 2]];
  const ccw = polyArea(loop) >= 0;
  const V: number[] = loop.map((_, i) => i);
  const tris: Array<[number, number, number]> = [];
  let guard = 0;
  while (V.length > 3 && guard++ < n * n) {
    let clipped = false;
    for (let i = 0; i < V.length; i++) {
      const ia = V[(i + V.length - 1) % V.length];
      const ib = V[i];
      const ic = V[(i + 1) % V.length];
      const a = loop[ia];
      const b = loop[ib];
      const c = loop[ic];
      const cr = (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);
      if (Math.abs(cr) <= 1e-8) {
        const dot = (b[0] - a[0]) * (c[0] - b[0]) + (b[1] - a[1]) * (c[1] - b[1]);
        if (dot >= -1e-8) {
          V.splice(i, 1);
          clipped = true;
          break;
        }
        continue;
      }
      const convex = ccw ? cr > 0 : cr < 0;
      if (!convex) continue;
      let contains = false;
      for (const j of V) {
        if (j === ia || j === ib || j === ic) continue;
        if (pointInTri(loop[j], a, b, c)) {
          contains = true;
          break;
        }
      }
      if (contains) continue;
      tris.push([ia, ib, ic]);
      V.splice(i, 1);
      clipped = true;
      break;
    }
    if (!clipped) break;
  }
  if (V.length === 3) tris.push([V[0], V[1], V[2]]);
  if (!ccw) {
    for (const t of tris) {
      const s = t[1];
      t[1] = t[2];
      t[2] = s;
    }
  }
  return tris;
}

/** Closed prism or drafted loft. Bottom and top loops must share vertex order. */
export function loftMesh(bottomIn: Loop, topIn: Loop, z0: number, z1: number): MeshData {
  const n = Math.min(bottomIn.length, topIn.length);
  if (n < 3 || z1 <= z0) throw new Error("Loft inválido");
  const bottom = bottomIn.slice(0, n);
  const top = topIn.slice(0, n);
  const positions = new Float32Array(n * 2 * 3);
  for (let i = 0; i < n; i++) {
    positions[i * 3] = bottom[i][0];
    positions[i * 3 + 1] = bottom[i][1];
    positions[i * 3 + 2] = z0;
    const j = n + i;
    positions[j * 3] = top[i][0];
    positions[j * 3 + 1] = top[i][1];
    positions[j * 3 + 2] = z1;
  }
  const idx: number[] = [];
  for (let i = 0; i < n; i++) {
    const i2 = (i + 1) % n;
    const b0 = i;
    const b1 = i2;
    const t0 = n + i;
    const t1 = n + i2;
    idx.push(b0, b1, t0, t0, b1, t1);
  }
  for (const [i, j, k] of triangulate(bottom)) {
    idx.push(n + i, n + j, n + k);
    idx.push(i, k, j);
  }
  return { positions, indices: Uint32Array.from(idx) };
}

/**
 * Midpoint of the longest vertical run sitting on the polygon's max-X side.
 * A centered rectangle returns y = 0. An L returns the middle of the arm that
 * actually reaches the right.
 */
export function rightAnchor(loop: Loop): { x: number; y: number } {
  let maxX = -Infinity;
  for (const p of loop) if (p[0] > maxX) maxX = p[0];
  const intervals: Array<[number, number]> = [];
  const n = loop.length;
  for (let i = 0; i < n; i++) {
    const a = loop[i];
    const b = loop[(i + 1) % n];
    if (Math.max(a[0], b[0]) < maxX - 0.05) continue;
    if (Math.min(a[0], b[0]) < maxX - 0.2 && Math.abs(a[0] - b[0]) > 0.2) continue;
    intervals.push([Math.min(a[1], b[1]), Math.max(a[1], b[1])]);
  }
  if (!intervals.length) return { x: maxX, y: 0 };
  intervals.sort((p, q) => p[0] - q[0]);
  const merged: Array<[number, number]> = [];
  for (const iv of intervals) {
    const last = merged[merged.length - 1];
    if (!last || iv[0] > last[1] + 0.05) merged.push([iv[0], iv[1]]);
    else last[1] = Math.max(last[1], iv[1]);
  }
  merged.sort((p, q) => q[1] - q[0] - (p[1] - p[0]));
  const best = merged[0];
  return { x: maxX, y: (best[0] + best[1]) / 2 };
}

/** Largest X where the horizontal line y crosses the loop. */
export function maxXAtY(loop: Loop, y: number): number | null {
  const xs: number[] = [];
  const n = loop.length;
  for (let i = 0; i < n; i++) {
    const a = loop[i];
    const b = loop[(i + 1) % n];
    if (Math.abs(a[1] - b[1]) < 1e-9) {
      if (Math.abs(y - a[1]) <= 1e-4) xs.push(a[0], b[0]);
      continue;
    }
    const minY = Math.min(a[1], b[1]);
    const maxY = Math.max(a[1], b[1]);
    if (y < minY - 1e-9 || y > maxY + 1e-9) continue;
    const t = (y - a[1]) / (b[1] - a[1]);
    if (t < -1e-6 || t > 1 + 1e-6) continue;
    xs.push(a[0] + t * (b[0] - a[0]));
  }
  if (!xs.length) return null;
  return Math.max(...xs);
}

/** A bbox sample that sits in the silhouette, and one that sits in a notch. */
export function interiorAndNotch(loop: Loop): { inside: [number, number] | null; notch: [number, number] | null } {
  const b = loopBounds(loop);
  let inside: [number, number] | null = null;
  const corners: Array<[number, number]> = [
    [b.minX + b.w * 0.08, b.minY + b.h * 0.08],
    [b.maxX - b.w * 0.08, b.minY + b.h * 0.08],
    [b.maxX - b.w * 0.08, b.maxY - b.h * 0.08],
    [b.minX + b.w * 0.08, b.maxY - b.h * 0.08],
  ];
  let notch: [number, number] | null = null;
  for (const c of corners) {
    if (!pointInPoly(c, loop)) notch = c;
  }
  for (let iy = 1; iy < 8 && !inside; iy++) {
    for (let ix = 1; ix < 8; ix++) {
      const p: [number, number] = [b.minX + (b.w * ix) / 8, b.minY + (b.h * iy) / 8];
      if (pointInPoly(p, loop)) {
        inside = p;
        break;
      }
    }
  }
  return { inside, notch };
}
