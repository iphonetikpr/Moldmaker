import { DEFAULTS } from "../constants";
import type { MeshData } from "../types";
import { cleanLoop, ensureCCW, loftMesh, polyArea, type Loop } from "./outline";

/** Flat SVG profiles without data-depth become a plate this thick (the locked wall). */
const SVG_FALLBACK_DEPTH = DEFAULTS.wallThickness;

function num(v: string | null | undefined, fallback = 0): number {
  if (v == null) return fallback;
  const n = Number.parseFloat(v);
  return Number.isFinite(n) ? n : fallback;
}

function pairList(raw: string): Loop {
  const bits = raw
    .trim()
    .replace(/,/g, " ")
    .split(/\s+/)
    .map(Number)
    .filter((n) => Number.isFinite(n));
  const out: Loop = [];
  for (let i = 0; i + 1 < bits.length; i += 2) out.push([bits[i], bits[i + 1]]);
  return out;
}

/** Absolute and relative M/L/H/V/C/Q/Z. Curves are sampled, not fitted. */
function parsePath(d: string): Loop[] {
  const tokens = d.match(/[a-zA-Z]|[-+]?(?:\d*\.\d+|\d+)(?:[eE][-+]?\d+)?/g) ?? [];
  const loops: Loop[] = [];
  let i = 0;
  let cx = 0;
  let cy = 0;
  let sx = 0;
  let sy = 0;
  let cmd = "";
  let cur: Loop = [];
  const read = () => Number(tokens[i++]);
  const close = () => {
    if (cur.length >= 3) loops.push(cur);
    cur = [];
    cx = sx;
    cy = sy;
  };
  while (i < tokens.length) {
    if (/[a-zA-Z]/.test(tokens[i])) cmd = tokens[i++];
    if (!cmd) break;
    const rel = cmd === cmd.toLowerCase();
    const op = cmd.toUpperCase();
    if (op === "Z") {
      close();
      cmd = "";
      continue;
    }
    if (op === "M") {
      if (cur.length >= 3) loops.push(cur);
      cur = [];
      const x = read();
      const y = read();
      cx = rel ? cx + x : x;
      cy = rel ? cy + y : y;
      sx = cx;
      sy = cy;
      cur.push([cx, cy]);
      cmd = rel ? "l" : "L";
      continue;
    }
    if (op === "L") {
      const x = read();
      const y = read();
      cx = rel ? cx + x : x;
      cy = rel ? cy + y : y;
      cur.push([cx, cy]);
      continue;
    }
    if (op === "H") {
      const x = read();
      cx = rel ? cx + x : x;
      cur.push([cx, cy]);
      continue;
    }
    if (op === "V") {
      const y = read();
      cy = rel ? cy + y : y;
      cur.push([cx, cy]);
      continue;
    }
    if (op === "Q") {
      const x1 = read();
      const y1 = read();
      const x = read();
      const y = read();
      const c1x = rel ? cx + x1 : x1;
      const c1y = rel ? cy + y1 : y1;
      const ex = rel ? cx + x : x;
      const ey = rel ? cy + y : y;
      for (let s = 1; s <= 6; s++) {
        const t = s / 6;
        const u = 1 - t;
        cur.push([u * u * cx + 2 * u * t * c1x + t * t * ex, u * u * cy + 2 * u * t * c1y + t * t * ey]);
      }
      cx = ex;
      cy = ey;
      continue;
    }
    if (op === "C") {
      const x1 = read();
      const y1 = read();
      const x2 = read();
      const y2 = read();
      const x = read();
      const y = read();
      const c1x = rel ? cx + x1 : x1;
      const c1y = rel ? cy + y1 : y1;
      const c2x = rel ? cx + x2 : x2;
      const c2y = rel ? cy + y2 : y2;
      const ex = rel ? cx + x : x;
      const ey = rel ? cy + y : y;
      for (let s = 1; s <= 8; s++) {
        const t = s / 8;
        const u = 1 - t;
        cur.push([
          u * u * u * cx + 3 * u * u * t * c1x + 3 * u * t * t * c2x + t * t * t * ex,
          u * u * u * cy + 3 * u * u * t * c1y + 3 * u * t * t * c2y + t * t * t * ey,
        ]);
      }
      cx = ex;
      cy = ey;
      continue;
    }
    break;
  }
  if (cur.length >= 3) loops.push(cur);
  return loops;
}

function flipY(loop: Loop): Loop {
  return ensureCCW(cleanLoop(loop.map(([x, y]) => [x, -y])));
}

function depthOf(svg: string): number {
  const m = svg.match(/data-depth\s*=\s*["']([0-9.]+)["']/i);
  if (m) {
    const n = Number(m[1]);
    if (Number.isFinite(n) && n > 0) return n;
  }
  return SVG_FALLBACK_DEPTH;
}

/** Read polygon / rect / circle / path geometry. Y flips to CAD +Y. Units are millimeters. */
export function svgLoops(text: string): { loops: Loop[]; depth: number } {
  const depth = depthOf(text);
  const loops: Loop[] = [];
  const poly = text.matchAll(/<(polygon|polyline)\b([^>]*)\/?>/gi);
  for (const m of poly) {
    const pts = /points\s*=\s*["']([^"']+)["']/i.exec(m[2]);
    if (!pts) continue;
    const loop = pairList(pts[1]);
    if (loop.length >= 3) loops.push(flipY(loop));
  }
  const rects = text.matchAll(/<rect\b([^>]*)\/?>/gi);
  for (const m of rects) {
    const a = m[1];
    const x = num(/[\s]x\s*=\s*["']([^"']+)["']/i.exec(` ${a}`)?.[1]);
    const y = num(/[\s]y\s*=\s*["']([^"']+)["']/i.exec(` ${a}`)?.[1]);
    const w = num(/width\s*=\s*["']([^"']+)["']/i.exec(a)?.[1]);
    const h = num(/height\s*=\s*["']([^"']+)["']/i.exec(a)?.[1]);
    if (w > 0 && h > 0) loops.push(flipY([[x, y], [x + w, y], [x + w, y + h], [x, y + h]]));
  }
  const circles = text.matchAll(/<(circle|ellipse)\b([^>]*)\/?>/gi);
  for (const m of circles) {
    const a = m[2];
    const cx = num(/cx\s*=\s*["']([^"']+)["']/i.exec(a)?.[1]);
    const cy = num(/cy\s*=\s*["']([^"']+)["']/i.exec(a)?.[1]);
    const rx = num(/r\s*=\s*["']([^"']+)["']/i.exec(a)?.[1] ?? /rx\s*=\s*["']([^"']+)["']/i.exec(a)?.[1]);
    const ry = num(/ry\s*=\s*["']([^"']+)["']/i.exec(a)?.[1], rx);
    if (rx > 0 && ry > 0) {
      const loop: Loop = [];
      for (let i = 0; i < 32; i++) {
        const t = (i / 32) * Math.PI * 2;
        loop.push([cx + rx * Math.cos(t), cy + ry * Math.sin(t)]);
      }
      loops.push(flipY(loop));
    }
  }
  const paths = text.matchAll(/<path\b([^>]*)\/?>/gi);
  for (const m of paths) {
    const d = /(?:\sd|^d)\s*=\s*["']([^"']+)["']/i.exec(` ${m[1]}`);
    if (!d) continue;
    for (const loop of parsePath(d[1])) {
      if (Math.abs(polyArea(loop)) > 1e-3) loops.push(flipY(loop));
    }
  }
  if (!loops.length) throw new Error("El SVG no tiene un contorno cerrado");
  return { loops, depth };
}

function concat(meshes: MeshData[]): MeshData {
  let vCount = 0;
  let iCount = 0;
  for (const m of meshes) {
    vCount += m.positions.length;
    iCount += m.indices.length;
  }
  const positions = new Float32Array(vCount);
  const indices = new Uint32Array(iCount);
  let vo = 0;
  let io = 0;
  let base = 0;
  for (const m of meshes) {
    positions.set(m.positions, vo);
    for (let k = 0; k < m.indices.length; k++) indices[io + k] = m.indices[k] + base;
    base += m.positions.length / 3;
    vo += m.positions.length;
    io += m.indices.length;
  }
  return { positions, indices };
}

/** Extrude the SVG silhouette into a master mesh. Depth is data-depth, or the wall default. */
export function parseSVG(text: string): MeshData {
  const { loops, depth } = svgLoops(text);
  const meshes: MeshData[] = [];
  for (const loop of loops) {
    if (loop.length < 3) continue;
    try {
      meshes.push(loftMesh(loop, loop, 0, depth));
    } catch {
      /* skip a degenerate ring */
    }
  }
  if (!meshes.length) throw new Error("El SVG no tiene un contorno cerrado");
  return meshes.length === 1 ? meshes[0] : concat(meshes);
}
