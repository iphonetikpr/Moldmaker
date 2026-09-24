import Module, { type Manifold, type ManifoldToplevel } from "manifold-3d";
import { instantiateManifold, setWasmUrl } from "manifold-3d/lib/wasm.js";
import { CYL_SEGMENTS } from "../constants";
import type { MeshData, Vec3 } from "../types";
import type { Feat } from "./layout";

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
    return this.frustum(f.z0, f.z1, f.hx0, f.hy0, f.hx1, f.hy1);
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
