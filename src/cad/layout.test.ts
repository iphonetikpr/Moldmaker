import { describe, expect, it } from "vitest";
import { DEFAULTS, FLANGE_PROTRUSION, FLANGE_SLOT, FLANGE_SLOT_FROM_OUTER, FLANGE_THICKNESS } from "../constants";
import type { MoldParams, Vec3 } from "../types";
import { frustumVolume, planMold, profileLabel, type Feat } from "./layout";
import { isAxisAlignedRect, isConcave, offsetClean, pointInPoly, polyArea, loopBounds, type Loop } from "./outline";
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
    expect(plan.solids.map((s) => s.id)).toEqual(["adapted_box"]);
    expect(plan.clipCount).toBe(3);
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
    expect(plan.profileMode).toBe("silhouette");
  });

  it("falls back to the bounding box when only the naive offset is available", () => {
    const blob = organicLoop();
    expect(offsetClean(blob, 3.5)).toBeNull();
    const plan = planMold("tray", [50, 49, 14], 1000, params({ draftDeg: 0, clampEnabled: false }), blob);
    expect(plan.profileMode).toBe("bbox");
    expect(profileLabel(plan.profileMode)).toBe("Caja envolvente");
    expect(plan.warnings.some((w) => w.includes("caja envolvente"))).toBe(true);
    const shell = plan.solids[0].unions[0];
    expect(shell.kind).toBe("poly");
    if (shell.kind !== "poly") return;
    expect(isAxisAlignedRect(shell.bottom)).toBe(true);
  });

  it("builds a single tray without a second half", () => {
    const plan = planMold("tray", part, 24000, params({ clampEnabled: false }));
    expect(plan.solids).toHaveLength(1);
    expect(plan.solids[0].id).toBe("tray");
    expect(plan.solids[0].unions).toHaveLength(1);
    expect(plan.solids[0].subtracts).toHaveLength(0);
    expect(plan.clipCount).toBe(0);
  });

  it("gives a tray a 10 mm tab on every side when the pour cup is absent", () => {
    const plan = planMold("tray", part, 24000, params({ draftDeg: 0, clampEnabled: true }));
    expect(plan.clipCount).toBe(4);
    expect(plan.flanges.map((f) => f.side).sort()).toEqual(["x+", "x-", "y+", "y-"]);
    const bodies = plan.solids[0].unions.filter((f) => f.kind === "box");
    expect(bodies).toHaveLength(4);
    const z0 = (plan.metrics.outerH - FLANGE_THICKNESS * 2) / 2;
    for (const body of bodies) {
      if (body.kind !== "box") continue;
      expect(body.min[2]).toBeCloseTo(z0);
      expect(body.size[2]).toBeCloseTo(FLANGE_THICKNESS * 2);
    }
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
    expect(plan.clipCount).toBe(3);
  });

  it("stacks 5 mm flanges on a small 2-part box and keeps the pour side clear", () => {
    const plan = planMold("twopart", part, 24000, params({ draftDeg: 0 }));
    expect(plan.metrics.outerW).toBeCloseTo(47);
    expect(plan.metrics.outerD).toBeCloseTo(37);
    expect(plan.clipCount).toBe(3);
    expect(plan.flanges.map((f) => f.side).sort()).toEqual(["x-", "y+", "y-"]);
    const cut = plan.metrics.cutZ;
    const bottom = boxes(plan.solids[0].unions);
    const top = boxes(plan.solids[1].unions);
    expect(bottom).toHaveLength(3);
    expect(top).toHaveLength(3);
    for (let i = 0; i < bottom.length; i++) {
      expect(bottom[i].min[2]).toBeCloseTo(cut - FLANGE_THICKNESS);
      expect(bottom[i].size[2]).toBeCloseTo(FLANGE_THICKNESS);
      expect(top[i].min[2]).toBeCloseTo(cut);
      expect(top[i].size[2]).toBeCloseTo(FLANGE_THICKNESS);
      expect(top[i].min[0]).toBeCloseTo(bottom[i].min[0]);
      expect(top[i].min[1]).toBeCloseTo(bottom[i].min[1]);
      expect(top[i].size[0]).toBeCloseTo(bottom[i].size[0]);
      expect(top[i].size[1]).toBeCloseTo(bottom[i].size[1]);
    }
    const station = plan.flanges.find((f) => f.side === "x-");
    expect(station).toBeTruthy();
    if (!station) return;
    expect(station.wall).toBeCloseTo(-plan.metrics.outerW / 2);
    expect(station.along).toBeCloseTo(0);
    const body = bottom.find((b) => b.min[0] < station.wall);
    expect(body).toBeTruthy();
    if (!body) return;
    expect(body.min[0]).toBeCloseTo(station.wall - FLANGE_PROTRUSION);
    expect(body.size[0]).toBeCloseTo(FLANGE_PROTRUSION + 0.4);
    const slotOuter = FLANGE_PROTRUSION - FLANGE_SLOT_FROM_OUTER;
    const slot = boxes(plan.solids[0].subtracts).find((b) => b.min[0] < station.wall && Math.abs(b.size[0] - FLANGE_SLOT) < 1e-6);
    expect(slot).toBeTruthy();
    if (!slot) return;
    expect(slot.min[0]).toBeCloseTo(station.wall - slotOuter);
    expect(slot.size[0]).toBeCloseTo(FLANGE_SLOT);
    expect(station.wall - FLANGE_PROTRUSION - slot.min[0]).toBeCloseTo(-FLANGE_SLOT_FROM_OUTER);
    const topSlot = boxes(plan.solids[1].subtracts).find((b) => Math.abs(b.min[0] - slot.min[0]) < 1e-6 && Math.abs(b.min[1] - slot.min[1]) < 1e-6);
    expect(topSlot?.min[2]).toBeCloseTo(cut - 0.15);
  });

  it("spaces a large 2-part box at ceil(side / 80), two on X and three on Y", () => {
    const plan = planMold("twopart", [200, 150, 40], 200 * 150 * 40, params({ draftDeg: 0 }));
    expect(plan.metrics.outerW).toBeCloseTo(207);
    expect(plan.metrics.outerD).toBeCloseTo(157);
    expect(plan.clipCount).toBe(10);
    const along = (side: string) =>
      plan.flanges
        .filter((f) => f.side === side)
        .map((f) => f.along)
        .sort((a, b) => a - b);
    expect(along("x+").map((n) => n.toFixed(2))).toEqual(["-26.17", "26.17"]);
    expect(along("x-").map((n) => n.toFixed(2))).toEqual(["-26.17", "26.17"]);
    expect(along("y+").map((n) => n.toFixed(2))).toEqual(["-51.75", "0.00", "51.75"]);
    expect(along("y-").map((n) => n.toFixed(2))).toEqual(["-51.75", "0.00", "51.75"]);
    const cut = plan.metrics.cutZ;
    expect(boxes(plan.solids[0].unions)).toHaveLength(10);
    expect(boxes(plan.solids[1].unions).every((b) => Math.abs(b.min[2] - cut) < 1e-6)).toBe(true);
  });

  it("omits flanges when the toggle is off or a half is shorter than 5 mm", () => {
    const off = planMold("twopart", part, 24000, params({ draftDeg: 0, clampEnabled: false }));
    expect(off.clipCount).toBe(0);
    expect(boxes(off.solids[0].unions)).toHaveLength(0);
    const short = planMold("twopart", [40, 30, 8], 8000, params({ draftDeg: 0, cutRatio: 0.2 }));
    expect(short.clipCount).toBe(0);
    expect(short.warnings.some((w) => w.includes("5 mm"))).toBe(true);
  });
});

function boxes(feats: Feat[]): Array<Extract<Feat, { kind: "box" }>> {
  return feats.filter((f): f is Extract<Feat, { kind: "box" }> => f.kind === "box");
}

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
