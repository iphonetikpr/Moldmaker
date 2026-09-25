import { describe, expect, it } from "vitest";
import { DEFAULTS } from "../constants";
import type { MoldParams, Vec3 } from "../types";
import { frustumVolume, planMold } from "./layout";
import { isConcave, pointInPoly, polyArea, loopBounds } from "./outline";
import { defaultParams, sanitizeParams } from "./params";
import { planSplits } from "./split";
import { safeName } from "./export";

const part: Vec3 = [40, 30, 28];

function params(over: Partial<MoldParams> = {}): MoldParams {
  return { ...defaultParams(), ...over };
}

describe("locked defaults", () => {
  it("matches the MVP numbers", () => {
    expect(DEFAULTS.wallThickness).toBe(3);
    expect(DEFAULTS.draftDeg).toBe(1.5);
    expect(DEFAULTS.siliconeGap).toBe(0.5);
    expect(DEFAULTS.funnelDiameter).toBe(12);
    expect(DEFAULTS.channelW).toBe(4);
    expect(DEFAULTS.channelH).toBe(4);
    expect(DEFAULTS.pinDiameter).toBe(3);
    expect(DEFAULTS.holeDiameter).toBe(3.25);
    expect(DEFAULTS.pinReach).toBe(5);
    expect(DEFAULTS.splitMax).toBe(250);
    expect(DEFAULTS.splitOverlap).toBe(2.5);
    expect(DEFAULTS.clampSlot).toBe(8);
    expect(DEFAULTS.clampClearance).toBe(0.3);
    expect(DEFAULTS.castShrinkPct).toBe(0);
    expect(DEFAULTS.splitEnabled).toBe(false);
  });

  it("keeps the hole larger than the pin", () => {
    const s = sanitizeParams(params({ pinDiameter: 4, holeDiameter: 3 }));
    expect(s.holeDiameter).toBeGreaterThan(s.pinDiameter);
  });
});

describe("layout", () => {
  it("sizes an adapted box from wall, gap and a flat draft", () => {
    const plan = planMold("adapted", part, 24000, params({ draftDeg: 0 }));
    const m = plan.metrics;
    expect(m.innerW).toBeCloseTo(40 + 1);
    expect(m.innerD).toBeCloseTo(30 + 1);
    expect(m.innerH).toBeCloseTo(28 + 0.5);
    expect(m.outerW).toBeCloseTo(m.innerW + 6);
    expect(m.outerD).toBeCloseTo(m.innerD + 6);
    expect(m.outerH).toBeCloseTo(3 + m.innerH);
    expect(m.floor).toBe(3);
    expect(m.extra).toBeCloseTo(0);
    expect(m.slotWidth).toBeCloseTo(8.3);
    expect(m.pinDiameter).toBe(3);
    expect(m.pinReach).toBe(5);
    expect(m.funnelDiameter).toBe(12);
    expect(plan.solids.map((s) => s.id)).toEqual(["adapted_box", "adapted_clamps"]);
    expect(plan.masterLift).toBe(3);
    const cav = frustumVolume(m.innerW / 2, m.innerD / 2, m.innerW / 2, m.innerD / 2, m.innerH);
    expect(m.siliconeMm3).toBeGreaterThan(0);
    expect(m.siliconeMm3).toBeLessThan(cav);
  });

  it("opens the top of a drafted cavity", () => {
    const plan = planMold("adapted", part, 24000, params());
    const h = plan.metrics.innerH;
    const expected = Math.tan((1.5 * Math.PI) / 180) * h;
    expect(plan.metrics.extra).toBeCloseTo(expected, 5);
  });

  it("follows an L silhouette instead of its bounding box", () => {
    const L: Array<[number, number]> = [
      [-15, -15],
      [15, -15],
      [15, -3],
      [-3, -3],
      [-3, 15],
      [-15, 15],
    ];
    const plan = planMold("tray", [30, 30, 8], 576 * 8, params({ draftDeg: 0, clampEnabled: false }), L);
    const shell = plan.solids[0].unions[0];
    const carve = plan.solids[0].carve[0];
    expect(shell.kind).toBe("poly");
    expect(carve.kind).toBe("poly");
    if (shell.kind !== "poly" || carve.kind !== "poly") return;
    const shellBox = loopBounds(shell.bottom);
    const carveBox = loopBounds(carve.bottom);
    expect(Math.abs(polyArea(carve.bottom)) / (carveBox.w * carveBox.h)).toBeLessThan(0.8);
    expect(isConcave(carve.bottom)).toBe(true);
    expect(isConcave(shell.bottom)).toBe(true);
    expect(pointInPoly([0, -9], carve.bottom)).toBe(true);
    expect(pointInPoly([6, 6], carve.bottom)).toBe(false);
    expect(pointInPoly([6, 6], shell.bottom)).toBe(false);
    expect(Math.abs(polyArea(shell.bottom))).toBeLessThan(shellBox.w * shellBox.h * 0.85);
  });

  it("builds a single tray without a second half", () => {
    const plan = planMold("tray", part, 24000, params({ clampEnabled: false }));
    expect(plan.solids).toHaveLength(1);
    expect(plan.solids[0].id).toBe("tray");
    expect(plan.solids[0].unions).toHaveLength(1);
    expect(plan.solids[0].subtracts).toHaveLength(0);
  });

  it("splits a 2-part mold at Z mid with pins and a wider hole", () => {
    const plan = planMold("twopart", part, 24000, params({ draftDeg: 0 }));
    expect(plan.metrics.cutZ).toBeCloseTo(3 + 0.5 + 14);
    expect(plan.metrics.outerH).toBeCloseTo(3 + 28 + 1 + 3);
    expect(plan.masterLift).toBeCloseTo(3.5);
    expect(plan.solids.map((s) => s.id)).toEqual(["2part_bottom", "2part_top"]);
    const pins = plan.solids[0].unions.filter((f) => f.kind === "cyl" && f.radius === 1.5);
    const holes = plan.solids[1].subtracts.filter((f) => f.kind === "cyl" && Math.abs(f.radius - 3.25 / 2) < 1e-9);
    expect(pins.length).toBe(4);
    expect(holes.length).toBe(4);
    expect(pins[0].kind === "cyl" && pins[0].height).toBeCloseTo(5.3);
  });
});

describe("split plan", () => {
  it("fits 250 mm beds and leaves a single piece when it already fits", () => {
    expect(planSplits(300, 250)).toEqual([0, 150, 300]);
    expect(planSplits(100, 250)).toEqual([0, 100]);
    expect(planSplits(500, 250)).toEqual([0, 250, 500]);
    expect(planSplits(501, 250)).toHaveLength(4);
  });
});

describe("names", () => {
  it("never emits the old product name", () => {
    expect(safeName("Mi Pieza.stl")).toBe("Mi_Pieza");
    expect(safeName("")).toBe("pieza");
  });
});
