import { DEFAULTS } from "../constants";
import type { MoldParams } from "../types";

export function defaultParams(): MoldParams {
  return { ...DEFAULTS };
}

function num(v: number, min: number, max: number, fallback: number): number {
  if (!Number.isFinite(v)) return fallback;
  return Math.min(max, Math.max(min, v));
}

/** Keep typed values inside ranges the solids can actually build. */
export function sanitizeParams(p: MoldParams): MoldParams {
  const wallThickness = num(p.wallThickness, 0.8, 20, DEFAULTS.wallThickness);
  const draftDeg = num(p.draftDeg, 0, 8, DEFAULTS.draftDeg);
  const siliconeGap = num(p.siliconeGap, 0, 30, DEFAULTS.siliconeGap);
  const funnelDiameter = num(p.funnelDiameter, 4, 40, DEFAULTS.funnelDiameter);
  const channelW = num(p.channelW, 1, 20, DEFAULTS.channelW);
  const channelH = num(p.channelH, 1, 20, DEFAULTS.channelH);
  const pinDiameter = num(p.pinDiameter, 0.6, 12, DEFAULTS.pinDiameter);
  let holeDiameter = num(p.holeDiameter, 0.8, 14, DEFAULTS.holeDiameter);
  if (holeDiameter < pinDiameter + 0.05) holeDiameter = pinDiameter + 0.05;
  const pinReach = num(p.pinReach, 1, 20, DEFAULTS.pinReach);
  const splitMax = num(p.splitMax, 40, 500, DEFAULTS.splitMax);
  let splitOverlap = num(p.splitOverlap, 0.4, 20, DEFAULTS.splitOverlap);
  if (splitOverlap >= splitMax / 2) splitOverlap = Math.min(DEFAULTS.splitOverlap, splitMax / 4);
  const clampSlot = num(p.clampSlot, 3, 30, DEFAULTS.clampSlot);
  const clampClearance = num(p.clampClearance, 0, 2, DEFAULTS.clampClearance);
  const castShrinkPct = num(p.castShrinkPct, 0, 15, DEFAULTS.castShrinkPct);
  const cutRatio = num(p.cutRatio, 0.2, 0.8, DEFAULTS.cutRatio);
  return {
    wallThickness,
    draftDeg,
    siliconeGap,
    funnelDiameter,
    channelW,
    channelH,
    pinDiameter,
    holeDiameter,
    pinReach,
    splitMax,
    splitOverlap,
    splitEnabled: Boolean(p.splitEnabled),
    clampSlot,
    clampClearance,
    clampEnabled: Boolean(p.clampEnabled),
    castShrinkPct,
    cutRatio,
  };
}
