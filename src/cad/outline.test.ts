import { describe, expect, it } from "vitest";
import { signedVolume } from "./mesh";
import {
  interiorAndNotch,
  isConcave,
  loftMesh,
  loopBounds,
  offsetClean,
  pointInPoly,
  polyArea,
  rectLoop,
  rightAnchor,
} from "./outline";

const L = [
  [-15, -15],
  [15, -15],
  [15, -3],
  [-3, -3],
  [-3, 15],
  [-15, 15],
] as Array<[number, number]>;

describe("outline", () => {
  it("offsets a centered rectangle by a constant margin", () => {
    const grown = offsetClean(rectLoop(40, 30), 3.5);
    expect(grown).not.toBeNull();
    const b = loopBounds(grown!);
    expect(b.w).toBeCloseTo(47, 3);
    expect(b.h).toBeCloseTo(37, 3);
    expect(b.minX).toBeCloseTo(-23.5, 3);
    expect(b.minY).toBeCloseTo(-18.5, 3);
    expect(rightAnchor(grown!).y).toBeCloseTo(0, 3);
    expect(rightAnchor(grown!).x).toBeCloseTo(23.5, 3);
  });

  it("keeps an L concave and out of its notch", () => {
    const cavity = offsetClean(L, 0.5);
    expect(cavity).not.toBeNull();
    expect(isConcave(cavity!)).toBe(true);
    const b = loopBounds(cavity!);
    expect(Math.abs(polyArea(cavity!)) / (b.w * b.h)).toBeLessThan(0.8);
    expect(pointInPoly([0, -9], cavity!)).toBe(true);
    expect(pointInPoly([6, 6], cavity!)).toBe(false);
    const anchor = rightAnchor(offsetClean(L, 3.5)!);
    expect(anchor.x).toBeGreaterThan(15);
    expect(anchor.y).toBeLessThan(-3);
    const { notch } = interiorAndNotch(L);
    expect(notch).not.toBeNull();
    expect(pointInPoly(notch!, L)).toBe(false);
  });

  it("lofts an L prism with the footprint volume", () => {
    const mesh = loftMesh(L, L, 0, 8);
    expect(signedVolume(mesh)).toBeCloseTo(576 * 8, 1);
  });
});
