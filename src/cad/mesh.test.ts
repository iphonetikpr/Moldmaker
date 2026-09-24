import { describe, expect, it } from "vitest";
import { bboxSize, bboxOf, boxMesh, openEdgeCount, sampleMaster, signedVolume, weldMesh } from "./mesh";
import { orientMesh } from "./orient";
import { parseOBJ } from "./obj";
import { repairMesh } from "./repair";
import { parseSTL, writeSTL } from "./stl";

describe("mesh", () => {
  it("builds the sample at 24000 mm³ and closed", () => {
    const mesh = sampleMaster();
    expect(signedVolume(mesh)).toBeCloseTo(24000, 1);
    expect(openEdgeCount(mesh)).toBe(0);
    expect(bboxSize(bboxOf(mesh))).toEqual([40, 30, 28]);
  });

  it("welds a duplicated soup and flips inward windings", () => {
    const box = boxMesh([10, 4, 2]);
    const dup = {
      positions: new Float32Array([...box.positions, ...box.positions]),
      indices: Uint32Array.from([...box.indices, ...box.indices.map((i) => i + 8)]),
    };
    const welded = weldMesh(dup);
    expect(welded.positions.length / 3).toBe(8);
    const flipped = repairMesh({
      positions: box.positions,
      indices: Uint32Array.from(box.indices).reverse(),
    });
    expect(flipped.flipped).toBe(true);
    expect(signedVolume(flipped.mesh)).toBeGreaterThan(0);
  });

  it("round-trips binary STL", () => {
    const box = boxMesh([8, 5, 3]);
    const back = parseSTL(writeSTL(box));
    expect(signedVolume(back)).toBeCloseTo(8 * 5 * 3, 2);
    expect(openEdgeCount(back)).toBe(0);
  });

  it("parses an OBJ quad", () => {
    const obj = parseOBJ(`
      v 0 0 0
      v 2 0 0
      v 2 3 0
      v 0 3 0
      f 1 2 3 4
    `);
    expect(obj.indices.length / 3).toBe(2);
    expect(bboxSize(bboxOf(obj))[0]).toBeCloseTo(2);
  });

  it("seats Y-up parts on Z and applies cast shrink", () => {
    const tall = boxMesh([10, 30, 4]);
    const stood = orientMesh(tall, "y+", 0, 1);
    const size = bboxSize(bboxOf(stood));
    expect(size[2]).toBeCloseTo(30, 4);
    expect(bboxOf(stood).min[2]).toBeCloseTo(0, 4);
    expect(Math.abs(bboxOf(stood).min[0] + bboxOf(stood).max[0])).toBeLessThan(1e-4);
    const grown = orientMesh(tall, "z+", 0, 1.02);
    expect(bboxSize(bboxOf(grown))[2]).toBeCloseTo(4 * 1.02, 3);
  });
});
