import Module, { type Manifold, type ManifoldToplevel } from "manifold-3d";
import { instantiateManifold, setWasmUrl } from "manifold-3d/lib/wasm.js";
import { CYL_SEGMENTS } from "../constants";
import type { MeshData, Vec3 } from "../types";
import { bboxOf } from "./mesh";
import type { Feat } from "./layout";
import { ensureCCW, loftMesh, loftVolume, mergeCollinear, polyArea, rectLoop, stripClose, type Loop } from "./outline";

let pending: Promise<Kernel> | null = null;

export function initKernel(): Promise<Kernel> {
  if (!pending) pending = createKernel();
  return pending;
}

async function createKernel(): Promise<Kernel> {
  if (typeof window !== "undefined") {
    const url = (await import("manifold-3d/manifold.wasm?url")).default;
    setWasmUrl(url);
    const wasm = await instantiateManifold();
    wasm.setCircularSegments(CYL_SEGMENTS);
    return new Kernel(wasm);
  }
  const wasm = await Module();
  wasm.setup();
  wasm.setCircularSegments(CYL_SEGMENTS);
  return new Kernel(wasm);
}

export class Kernel {
  private bin: Manifold[] = [];

  constructor(private readonly wasm: ManifoldToplevel) {}

  private track(m: Manifold): Manifold {
    this.bin.push(m);
    return m;
  }

  end(): void {
    for (const m of this.bin) {
      try {
        m.delete();
      } catch {
        /* already released */
      }
    }
    this.bin = [];
  }

  box(min: Vec3, size: Vec3): Manifold {
    const cube = this.track(this.wasm.Manifold.cube([size[0], size[1], size[2]], false));
    return this.track(cube.translate(min));
  }

  cyl(axis: "x" | "y" | "z", origin: Vec3, height: number, radius: number, zMin?: number, zMax?: number): Manifold {
    let c = this.track(this.wasm.Manifold.cylinder(height, radius, radius, CYL_SEGMENTS, false));
    if (axis === "x") c = this.track(c.rotate([0, 90, 0]));
    else if (axis === "y") c = this.track(c.rotate([-90, 0, 0]));
    c = this.track(c.translate(origin));
    if (zMin != null && zMax != null && zMax > zMin) {
      const slab = this.box([-1e4, -1e4, zMin], [2e4, 2e4, zMax - zMin]);
      c = this.track(c.intersect(slab));
    }
    return c;
  }

  frustum(z0: number, z1: number, hx0: number, hy0: number, hx1: number, hy1: number): Manifold {
    const pts: Vec3[] = [
      [-hx0, -hy0, z0],
      [hx0, -hy0, z0],
      [hx0, hy0, z0],
      [-hx0, hy0, z0],
      [-hx1, -hy1, z1],
      [hx1, -hy1, z1],
      [hx1, hy1, z1],
      [-hx1, hy1, z1],
    ];
    return this.track(this.wasm.Manifold.hull(pts));
  }

  feat(f: Feat): Manifold {
    if (f.kind === "box") {
      if (f.size[0] <= 0 || f.size[1] <= 0 || f.size[2] <= 0) return this.track(this.wasm.Manifold.cube([0, 0, 0], false));
      return this.box(f.min, f.size);
    }
    if (f.kind === "cyl") {
      if (f.radius <= 0 || f.height <= 0) return this.track(this.wasm.Manifold.cube([0, 0, 0], false));
      return this.cyl(f.axis, f.origin, f.height, f.radius, f.zMin, f.zMax);
    }
    if (f.kind === "poly") return this.poly(f.bottom, f.top, f.z0, f.z1, f.holeBottom, f.holeTop);
    return this.frustum(f.z0, f.z1, f.hx0, f.hy0, f.hx1, f.hy1);
  }

  /**
   * Exact XY silhouette: union of every projected triangle.
   * The largest positive contour is the outside of the part.
   * `exact` is false when that union is empty and the loop is only the bounding rectangle.
   */
  projectOutline(mesh: MeshData): { loop: Loop; exact: boolean } {
    const p = mesh.positions;
    const idx = mesh.indices;
    const contours: Loop[] = [];
    for (let i = 0; i < idx.length; i += 3) {
      const tri: Loop = [];
      for (let k = 0; k < 3; k++) {
        const o = idx[i + k] * 3;
        tri.push([p[o], p[o + 1]]);
      }
      const area = (tri[1][0] - tri[0][0]) * (tri[2][1] - tri[0][1]) - (tri[1][1] - tri[0][1]) * (tri[2][0] - tri[0][0]);
      if (Math.abs(area) < 1e-8) continue;
      contours.push(area < 0 ? [tri[0], tri[2], tri[1]] : tri);
    }
    const bb = bboxOf(mesh);
    const cx = (bb.min[0] + bb.max[0]) / 2;
    const cy = (bb.min[1] + bb.max[1]) / 2;
    const fallback = rectLoop(bb.max[0] - bb.min[0], bb.max[1] - bb.min[1]).map(
      ([x, y]) => [x + cx, y + cy] as [number, number],
    );
    if (!contours.length) return { loop: fallback, exact: false };
    const cs = new this.wasm.CrossSection(contours, "Positive");
    let simple: typeof cs | null = null;
    try {
      simple = cs.simplify(0.02);
      const polys = simple.toPolygons();
      let best: Loop | null = null;
      let bestA = 0;
      for (const poly of polys) {
        const loop = mergeCollinear(stripClose(poly.map((v) => [v[0], v[1]] as [number, number])));
        const area = polyArea(loop);
        if (area > bestA && loop.length >= 3) {
          bestA = area;
          best = loop;
        }
      }
      return best ? { loop: best, exact: true } : { loop: fallback, exact: false };
    } finally {
      if (simple && simple !== cs) simple.delete();
      cs.delete();
    }
  }

  /**
   * Clipper offset. Resolves the self-intersections that a 1:1 miter offset
   * leaves on a concave silhouette, so the mold does not have to fall back
   * to the bounding rectangle.
   */
  offsetOutline(loop: Loop, delta: number): Loop | null {
    if (loop.length < 3) return null;
    const src = ensureCCW(loop);
    if (src.length < 3) return null;
    if (Math.abs(delta) < 1e-9) return mergeCollinear(src);
    const once = (join: "Miter" | "Round"): Loop | null => {
      const cs = new this.wasm.CrossSection([src], "Positive");
      let grown: typeof cs | null = null;
      let simple: typeof cs | null = null;
      try {
        grown = join === "Round" ? cs.offset(delta, "Round", 2, 8) : cs.offset(delta, "Miter", 2);
        if (grown.isEmpty()) return null;
        simple = grown.simplify(0.05);
        const polys = simple.toPolygons();
        let best: Loop | null = null;
        let bestA = 0;
        for (const poly of polys) {
          const ring = mergeCollinear(stripClose(poly.map((v) => [v[0], v[1]] as [number, number])), 0.05);
          const area = polyArea(ring);
          if (area > bestA && ring.length >= 3) {
            bestA = area;
            best = ring;
          }
        }
        return best && bestA > 1e-3 ? best : null;
      } catch {
        return null;
      } finally {
        if (simple && simple !== grown) simple.delete();
        if (grown && grown !== cs) grown.delete();
        cs.delete();
      }
    };
    return once("Miter") ?? once("Round");
  }

  private empty(): Manifold {
    return this.track(this.wasm.Manifold.cube([0, 0, 0], false));
  }

  private fromRaw(positions: Float32Array, indices: Uint32Array): Manifold {
    const build = (tris: Uint32Array) => {
      const raw = new this.wasm.Mesh({ numProp: 3, vertProperties: positions, triVerts: tris });
      raw.merge();
      return this.track(new this.wasm.Manifold(raw));
    };
    try {
      return build(indices);
    } catch {
      const flipped = indices.slice();
      for (let i = 0; i < flipped.length; i += 3) {
        const t = flipped[i + 1];
        flipped[i + 1] = flipped[i + 2];
        flipped[i + 2] = t;
      }
      return build(flipped);
    }
  }

  private extrudeLoop(loop: Loop, z0: number, z1: number, scaleX = 1, scaleY = 1): Manifold {
    const cs = new this.wasm.CrossSection([loop], "Positive");
    try {
      let m = cs.extrude(Math.max(1e-4, z1 - z0), 0, 0, [scaleX, scaleY], false);
      if (Math.abs(z0) > 1e-9) m = m.translate([0, 0, z0]);
      return this.track(m);
    } finally {
      cs.delete();
    }
  }

  private poly(bottom: Loop, top: Loop, z0: number, z1: number, holeBottom?: Loop, holeTop?: Loop): Manifold {
    if (bottom.length < 3 || z1 - z0 <= 1e-6) return this.empty();
    const topLoop = top.length >= 3 ? top : bottom;
    const solid = this.prism(bottom, topLoop, z0, z1);
    if (holeBottom && holeBottom.length >= 3 && holeTop && holeTop.length >= 3) {
      const pad = 0.05;
      const hole = this.prism(holeBottom, holeTop.length >= 3 ? holeTop : holeBottom, z0 - pad, z1 + pad);
      return this.subtract(solid, hole);
    }
    return solid;
  }

  /** Loft only when corners still correspond. Otherwise scale-extrude so unequal Clipper offsets cannot twist. */
  private prism(bottom: Loop, top: Loop, z0: number, z1: number): Manifold {
    if (pairedLoops(bottom, top)) {
      try {
        const mesh = loftMesh(bottom, top, z0, z1);
        const solid = this.fromRaw(mesh.positions, mesh.indices);
        const expectVol = Math.abs(loftVolume(bottom, top, z1 - z0));
        if (solid.isEmpty() || solid.numTri() < 4) throw new Error("loft vacío");
        if (expectVol > 1 && solid.volume() < expectVol * 0.5) throw new Error("loft torcido");
        return solid;
      } catch {
        /* scale about the origin instead */
      }
    }
    return this.scaleExtrude(bottom, top, z0, z1);
  }

  private scaleExtrude(bottom: Loop, top: Loop, z0: number, z1: number): Manifold {
    const bb0 = loopHalf(bottom);
    const bb1 = loopHalf(top.length ? top : bottom);
    const sx = bb0.hx > 1e-6 ? bb1.hx / bb0.hx : 1;
    const sy = bb0.hy > 1e-6 ? bb1.hy / bb0.hy : 1;
    return this.extrudeLoop(bottom, z0, z1, sx, sy);
  }

  union(a: Manifold, b: Manifold): Manifold {
    return this.track(a.add(b));
  }

  subtract(a: Manifold, b: Manifold): Manifold {
    return this.track(a.subtract(b));
  }

  intersect(a: Manifold, b: Manifold): Manifold {
    return this.track(a.intersect(b));
  }

  fromMesh(mesh: MeshData): Manifold {
    const raw = new this.wasm.Mesh({
      numProp: 3,
      vertProperties: mesh.positions,
      triVerts: mesh.indices,
    });
    raw.merge();
    return this.track(new this.wasm.Manifold(raw));
  }

  toMesh(manifold: Manifold): MeshData {
    const raw = manifold.getMesh();
    const numProp = raw.numProp;
    const src = raw.vertProperties;
    const n = src.length / numProp;
    const positions = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) {
      const o = i * numProp;
      positions[i * 3] = src[o];
      positions[i * 3 + 1] = src[o + 1];
      positions[i * 3 + 2] = src[o + 2];
    }
    return { positions, indices: new Uint32Array(raw.triVerts) };
  }
}

function pairedLoops(bottom: Loop, top: Loop): boolean {
  if (bottom.length !== top.length || bottom.length < 3) return false;
  const n = bottom.length;
  for (let i = 0; i < n; i++) {
    const d = Math.hypot(bottom[i][0] - top[i][0], bottom[i][1] - top[i][1]);
    for (let j = 0; j < n; j++) {
      if (j === i) continue;
      const dj = Math.hypot(bottom[i][0] - top[j][0], bottom[i][1] - top[j][1]);
      if (dj + 1e-4 < d) return false;
    }
  }
  return true;
}

function loopHalf(loop: Loop): { hx: number; hy: number } {
  let hx = 0;
  let hy = 0;
  for (const [x, y] of loop) {
    hx = Math.max(hx, Math.abs(x));
    hy = Math.max(hy, Math.abs(y));
  }
  return { hx, hy };
}
