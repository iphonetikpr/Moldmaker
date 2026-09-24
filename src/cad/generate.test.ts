import { describe, expect, it } from "vitest";
import { bboxOf, bboxSize, boxMesh } from "./mesh";
import { parseSTL } from "./stl";
import { defaultParams } from "./params";
import { initKernel } from "./kernel";
import { generateMold } from "./generate";
import { sampleMaster } from "./mesh";

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
});
