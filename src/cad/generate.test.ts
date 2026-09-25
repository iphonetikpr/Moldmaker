import { describe, expect, it } from "vitest";
import { bboxOf, bboxSize, boxMesh } from "./mesh";
import { parseSTL, writeSTL } from "./stl";
import { defaultParams } from "./params";
import { initKernel } from "./kernel";
import { generateMold } from "./generate";
import { sampleMaster } from "./mesh";
import { loftMesh, offsetClean, polyArea, type Loop } from "./outline";
import { profileLabel } from "./layout";
import { parseSVG } from "./svg";

describe("generate", () => {
  it("exports adapted, tray and 2-part STLs from the sample", async () => {
    const kernel = await initKernel();
    const mesh = sampleMaster();
    const base = { mesh, name: "ejemplo", params: defaultParams(), up: "z+" as const, rotDeg: 0 };

    const adapted = generateMold(kernel, { ...base, system: "adapted" });
    expect(adapted.parts.map((p) => p.filename)).toEqual([
      "ejemplo_adapted_box.stl",
      "ejemplo_adapted_clamps.stl",
    ]);
    expect(adapted.siliconeMm3).toBeGreaterThan(100);
    const box = bboxSize(bboxOf(adapted.parts[0].mesh));
    expect(box[0]).toBeGreaterThan(47);
    expect(box[1]).toBeGreaterThan(36);
    expect(box[2]).toBeGreaterThan(30);
    expect(bboxOf(adapted.parts[0].mesh).min[2]).toBeCloseTo(0, 1);
    const clamps = bboxSize(bboxOf(adapted.parts[1].mesh));
    expect(clamps[0]).toBeCloseTo(8, 1);
    expect(clamps[2]).toBeCloseTo(8, 1);
    const reread = parseSTL(adapted.parts[0].bytes);
    expect(reread.indices.length).toBeGreaterThan(30);

    const tray = generateMold(kernel, { ...base, system: "tray", params: { ...defaultParams(), clampEnabled: false } });
    expect(tray.parts.map((p) => p.filename)).toEqual(["ejemplo_tray.stl"]);
    const traySize = bboxSize(bboxOf(tray.parts[0].mesh));
    expect(traySize[0]).toBeLessThan(box[0] - 5);

    const two = generateMold(kernel, { ...base, system: "twopart" });
    expect(two.parts.map((p) => p.filename)).toEqual(["ejemplo_2part_bottom.stl", "ejemplo_2part_top.stl"]);
    const bottom = bboxOf(two.parts[0].mesh);
    const top = bboxOf(two.parts[1].mesh);
    expect(bottom.max[2]).toBeCloseTo(3 + 0.5 + 14 + 5, 0);
    expect(top.min[2]).toBeCloseTo(3 + 0.5 + 14, 0);
    expect(two.masterLift).toBeCloseTo(3.5);
  });

  it("grows the shell when the wall gets thicker", async () => {
    const kernel = await initKernel();
    const mesh = boxMesh([20, 12, 8]);
    const thin = generateMold(kernel, {
      mesh,
      name: "caja",
      system: "tray",
      params: { ...defaultParams(), wallThickness: 3, draftDeg: 0, clampEnabled: false },
      up: "z+",
      rotDeg: 0,
    });
    const thick = generateMold(kernel, {
      mesh,
      name: "caja",
      system: "tray",
      params: { ...defaultParams(), wallThickness: 6, draftDeg: 0, clampEnabled: false },
      up: "z+",
      rotDeg: 0,
    });
    const a = bboxSize(bboxOf(thin.parts[0].mesh));
    const b = bboxSize(bboxOf(thick.parts[0].mesh));
    expect(b[0] - a[0]).toBeCloseTo(6, 1);
    expect(b[2] - a[2]).toBeCloseTo(3, 1);
  });

  it("splits a long mold into bed-sized pieces with Ø3 / Ø3.25 dowels", async () => {
    const kernel = await initKernel();
    const mesh = boxMesh([180, 16, 10]);
    const splitOff = generateMold(kernel, {
      mesh,
      name: "largo",
      system: "tray",
      params: { ...defaultParams(), clampEnabled: false, draftDeg: 0, splitEnabled: false, splitMax: 80 },
      up: "z+",
      rotDeg: 0,
    });
    expect(splitOff.parts).toHaveLength(1);
    expect(splitOff.warnings.some((w) => w.includes("80"))).toBe(true);

    const thinPin = generateMold(kernel, {
      mesh,
      name: "largo",
      system: "tray",
      params: {
        ...defaultParams(),
        clampEnabled: false,
        draftDeg: 0,
        splitEnabled: true,
        splitMax: 80,
        splitOverlap: 2.5,
        pinDiameter: 3,
        holeDiameter: 3.25,
      },
      up: "z+",
      rotDeg: 0,
    });
    const fatPin = generateMold(kernel, {
      mesh,
      name: "largo",
      system: "tray",
      params: {
        ...defaultParams(),
        clampEnabled: false,
        draftDeg: 0,
        splitEnabled: true,
        splitMax: 80,
        splitOverlap: 2.5,
        pinDiameter: 5,
        holeDiameter: 5.4,
      },
      up: "z+",
      rotDeg: 0,
    });
    expect(thinPin.parts.length).toBeGreaterThan(1);
    expect(thinPin.parts.every((p) => Math.max(...bboxSize(bboxOf(p.mesh))) <= 80 + 2.5 + 1)).toBe(true);
    const thinVol = thinPin.parts.reduce((s, p) => s + p.mesh.positions.length, 0);
    const fatVol = fatPin.parts.reduce((s, p) => s + p.mesh.positions.length, 0);
    expect(fatVol).toBeGreaterThan(thinVol);
    expect(thinPin.parts[0].filename).toMatch(/_s1\.stl$/);
  });

  it("cuts a non-rectangular cavity from an L silhouette", async () => {
    const kernel = await initKernel();
    const foot: Array<[number, number]> = [
      [-15, -15],
      [15, -15],
      [15, -3],
      [-3, -3],
      [-3, 15],
      [-15, 15],
    ];
    const mesh = loftMesh(foot, foot, 0, 8);
    const outline = kernel.projectOutline(mesh).loop;
    expect(Math.abs(polyArea(outline))).toBeCloseTo(576, 0);
    expect(Math.abs(polyArea(outline))).toBeLessThan(30 * 30 * 0.8);

    const tray = generateMold(kernel, {
      mesh,
      name: "ele",
      system: "tray",
      params: { ...defaultParams(), draftDeg: 0, clampEnabled: false },
      up: "z+",
      rotDeg: 0,
    });
    const mold = kernel.fromMesh(tray.parts[0].mesh);
    const notch = mold.rayCast([6, 6, 5], [80, 6, 5]);
    const arm = mold.rayCast([0, -9, 5], [40, -9, 5]);
    expect(notch).toHaveLength(0);
    expect(arm.length).toBeGreaterThan(0);

    const probe = (x: number, y: number, z: number) => {
      const bit = kernel.box([x - 0.3, y - 0.3, z - 0.3], [0.6, 0.6, 0.6]);
      return kernel.intersect(kernel.fromMesh(tray.parts[0].mesh), bit).volume();
    };
    expect(probe(0, -17, 5)).toBeGreaterThan(0.05);
    expect(probe(0, -9, 5)).toBeLessThan(1e-4);
    expect(probe(6, 6, 5)).toBeLessThan(1e-4);
    expect(probe(0, -9, 1)).toBeGreaterThan(0.05);
  });

  it("molds an uploaded SVG silhouette instead of its bounding square", async () => {
    const kernel = await initKernel();
    const svg = `<?xml version="1.0"?>
      <svg xmlns="http://www.w3.org/2000/svg" viewBox="-15 -15 30 30" data-depth="8">
        <polygon points="-15,-15 15,-15 15,-3 -3,-3 -3,15 -15,15"/>
      </svg>`;
    const mesh = parseSVG(svg);
    expect(bboxSize(bboxOf(mesh))[2]).toBeCloseTo(8, 3);
    const tray = generateMold(kernel, {
      mesh,
      name: "ele.svg",
      system: "adapted",
      params: { ...defaultParams(), draftDeg: 0, clampEnabled: false, splitEnabled: false },
      up: "z+",
      rotDeg: 0,
    });
    expect(tray.parts[0].filename).toBe("ele_adapted_box.stl");
    const mold = kernel.fromMesh(tray.parts[0].mesh);
    const outside = mold.rayCast([6, -6, 5], [80, -6, 5]);
    const inside = mold.rayCast([0, 9, 5], [-40, 9, 5]);
    expect(outside).toHaveLength(0);
    expect(inside.length).toBeGreaterThan(0);
  });

  it("labels the sample part as a rectangular silhouette", async () => {
    const kernel = await initKernel();
    const tray = generateMold(kernel, {
      mesh: sampleMaster(),
      name: "ejemplo",
      system: "tray",
      params: { ...defaultParams(), clampEnabled: false },
      up: "z+",
      rotDeg: 0,
    });
    expect(tray.profileMode).toBe("rect");
    expect(profileLabel(tray.profileMode)).toBe("Silueta rectangular");
  });

  it("keeps a concave STL silhouette that the naive offset would reject", async () => {
    const kernel = await initKernel();
    const foot = organicLoop();
    expect(offsetClean(foot, 3.5)).toBeNull();
    const mesh = parseSTL(writeSTL(loftMesh(foot, foot, 0, 14), "organo"));
    const hit = kernel.projectOutline(mesh);
    expect(hit.exact).toBe(true);
    expect(Math.abs(polyArea(hit.loop))).toBeGreaterThan(Math.abs(polyArea(foot)) * 0.9);
    expect(Math.abs(polyArea(hit.loop))).toBeLessThan(bboxArea(hit.loop) * 0.7);

    // (0,-16) sits in the part's bounding box and in a bay. A bbox cavity is empty
    // there; the silhouette wall is not. (0,-22) is in the bbox wall margin and
    // outside the offset shell.
    const z = 8;
    const probe = (mesh: ReturnType<typeof loftMesh>, x: number, y: number) => {
      const bit = kernel.box([x - 0.35, y - 0.35, z - 0.35], [0.7, 0.7, 0.7]);
      return kernel.intersect(kernel.fromMesh(mesh), bit).volume();
    };
    for (const system of ["tray", "adapted", "twopart"] as const) {
      const built = generateMold(kernel, {
        mesh,
        name: "organo.stl",
        system,
        params: { ...defaultParams(), draftDeg: 0, clampEnabled: false, splitEnabled: false },
        up: "z+",
        rotDeg: 0,
      });
      expect(built.profileMode).toBe("silhouette");
      expect(profileLabel(built.profileMode)).toBe("Silueta");
      expect(built.warnings.some((w) => w.toLowerCase().includes("caja envolvente"))).toBe(false);
      const molds = built.parts.filter((p) => p.role === "mold");
      expect(molds.length).toBeGreaterThan(0);
      const bayWall = molds.reduce((s, p) => s + probe(p.mesh, 0, -16), 0);
      const outside = molds.reduce((s, p) => s + probe(p.mesh, 0, -22), 0);
      const cavity = molds.reduce((s, p) => s + probe(p.mesh, 0, 18), 0);
      expect(bayWall).toBeGreaterThan(0.05);
      expect(outside).toBeLessThan(1e-4);
      expect(cavity).toBeLessThan(1e-4);
    }
  });
});

/** Five-lobe outline. A 3.5 mm miter offset self-intersects; Clipper must not. */
function organicLoop(): Loop {
  const pts: Loop = [];
  const n = 64;
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2;
    const r = 18 + 7 * Math.sin(5 * a) + 2.5 * Math.sin(13 * a);
    pts.push([Math.cos(a) * r, Math.sin(a) * r]);
  }
  return pts;
}

function bboxArea(loop: Loop): number {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const [x, y] of loop) {
    minX = Math.min(minX, x);
    minY = Math.min(minY, y);
    maxX = Math.max(maxX, x);
    maxY = Math.max(maxY, y);
  }
  return (maxX - minX) * (maxY - minY);
}
