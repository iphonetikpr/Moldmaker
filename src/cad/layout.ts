import { KEY_HEIGHT, KEY_INSET, KEY_SIZE, SEAL_H, SEAL_W } from "../constants";
import type { MoldParams, SystemId, Vec3 } from "../types";
import {
  isAxisAlignedRect,
  lerpLoop,
  loftVolume,
  loopBounds,
  maxXAtY,
  offsetClean,
  pointInPoly,
  polyArea,
  rectLoop,
  rightAnchor,
  type Loop,
} from "./outline";

export interface BoxFeat {
  min: Vec3;
  size: Vec3;
}

export interface CylFeat {
  axis: "x" | "y" | "z";
  origin: Vec3;
  height: number;
  radius: number;
  /** Optional Z clip so a cup can be split across a parting plane. */
  zMin?: number;
  zMax?: number;
}

export interface FrustumFeat {
  z0: number;
  z1: number;
  hx0: number;
  hy0: number;
  hx1: number;
  hy1: number;
}

export interface PolyFeat {
  /** CCW loop at z0. Paired by index with `top`. */
  bottom: Loop;
  /** CCW loop at z1. Same length and corner order as `bottom`. */
  top: Loop;
  z0: number;
  z1: number;
  /** Straight hole subtracted from the prism (perimeter seal). */
  holeBottom?: Loop;
  holeTop?: Loop;
}

export type Feat =
  | ({ kind: "box" } & BoxFeat)
  | ({ kind: "cyl" } & CylFeat)
  | ({ kind: "frustum" } & FrustumFeat)
  | ({ kind: "poly" } & PolyFeat);

export interface SolidSpec {
  id: string;
  role: "mold" | "clamp";
  split: boolean;
  /** First union is the base solid. */
  unions: Feat[];
  /** Removed before the extra unions (the open cavity). */
  carve: Feat[];
  subtracts: Feat[];
}

export interface MoldMetrics {
  innerW: number;
  innerD: number;
  innerH: number;
  outerW: number;
  outerD: number;
  outerH: number;
  floor: number;
  /** Extra inner opening per side at the top of the cavity, after clamping draft. */
  extra: number;
  draftClamped: boolean;
  pinDiameter: number;
  holeDiameter: number;
  pinReach: number;
  funnelDiameter: number;
  channelW: number;
  channelH: number;
  clampSlot: number;
  /** Slot opening. Larger than the clamp by clampClearance. */
  slotWidth: number;
  cutZ: number;
  masterVolume: number;
  siliconeMm3: number;
}

/**
 * How the cavity outline was chosen.
 * `silhouette` — the part's XY contour survived the offset.
 * `rect` — that contour is itself an axis-aligned rectangle.
 * `bbox` — the offset failed and the mold fell back to the bounding box.
 */
export type ProfileMode = "silhouette" | "rect" | "bbox";

export function profileLabel(mode: ProfileMode): string {
  if (mode === "bbox") return "Caja envolvente";
  if (mode === "rect") return "Silueta rectangular";
  return "Silueta";
}

export function profileHint(mode: ProfileMode): string {
  if (mode === "bbox") return "La silueta no se pudo expandir; la cavidad es la caja envolvente.";
  if (mode === "rect") return "La proyección en planta de la pieza es rectangular, así que la cavidad también lo es.";
  return "La cavidad sigue la silueta de la pieza, no su caja envolvente.";
}

/** Positive delta grows a CCW loop. Return null when the offset is unusable. */
export type OffsetFn = (loop: Loop, delta: number) => Loop | null;

export interface MoldPlan {
  system: SystemId;
  warnings: string[];
  masterLift: number;
  metrics: MoldMetrics;
  solids: SolidSpec[];
  profileMode: ProfileMode;
}

export function frustumVolume(hx0: number, hy0: number, hx1: number, hy1: number, h: number): number {
  const a1 = hx0 * 2 * (hy0 * 2);
  const a2 = hx1 * 2 * (hy1 * 2);
  return (h / 3) * (a1 + a2 + Math.sqrt(Math.max(0, a1 * a2)));
}

function draftExtra(wall: number, height: number, draftDeg: number): { extra: number; clamped: boolean } {
  const raw = Math.tan((draftDeg * Math.PI) / 180) * height;
  const maxExtra = Math.max(0, wall - 1);
  const extra = Math.min(Math.max(0, raw), maxExtra);
  return { extra, clamped: extra + 1e-4 < raw };
}

function box(min: Vec3, size: Vec3): Feat {
  return { kind: "box", min, size };
}

function cyl(feat: CylFeat): Feat {
  return { kind: "cyl", ...feat };
}

function poly(
  bottom: Loop,
  top: Loop,
  z0: number,
  z1: number,
  hole?: { bottom: Loop; top: Loop },
): Feat {
  return {
    kind: "poly",
    bottom,
    top,
    z0,
    z1,
    holeBottom: hole?.bottom,
    holeTop: hole?.top,
  };
}

interface Profile {
  outer: Loop;
  cavityBottom: Loop;
  /** Loop at the top of the boolean carve (may overrun the rim so the top stays open). */
  cavityTop: Loop;
  /** Loop at the design rim, used for silicone volume. */
  designTop: Loop;
  innerW: number;
  innerD: number;
  outerW: number;
  outerD: number;
  profileMode: ProfileMode;
  /** Offset of the loop the profile was built from, or of any other loop. */
  offset: OffsetFn;
  /** Offset of the source silhouette (or of the bbox, after a fallback). */
  at: (delta: number) => Loop | null;
}

function buildProfile(
  partSize: Vec3,
  gap: number,
  wall: number,
  extra: number,
  topGrow: number,
  outline: Loop | undefined,
  warnings: string[],
  offset: OffsetFn,
): Profile {
  const rect = rectLoop(partSize[0], partSize[1]);
  const make = (base: Loop) => {
    const outer = offset(base, gap + wall);
    const cavityBottom = offset(base, gap);
    const designTop = offset(base, gap + extra);
    const carveDelta = gap + extra * topGrow;
    const carveTop = Math.abs(carveDelta - (gap + extra)) < 1e-9 ? designTop : offset(base, carveDelta);
    if (!outer || !cavityBottom || !designTop || !carveTop) return null;
    if (polyArea(outer) <= 1e-3 || polyArea(cavityBottom) <= 1e-3) return null;
    return { base, outer, cavityBottom, cavityTop: carveTop, designTop };
  };
  const fromOutline = outline && outline.length >= 3 ? make(outline) : null;
  const used = fromOutline ?? make(rect);
  if (!fromOutline && outline && outline.length >= 3) {
    warnings.push("La silueta no admitió el offset; el molde usa la caja envolvente.");
  }
  if (!used) throw new Error("No se pudo construir la silueta del molde");
  const inner = loopBounds(used.cavityBottom);
  const outerB = loopBounds(used.outer);
  const rectangular = isAxisAlignedRect(used.base);
  return {
    outer: used.outer,
    cavityBottom: used.cavityBottom,
    cavityTop: used.cavityTop,
    designTop: used.designTop,
    innerW: inner.w,
    innerD: inner.h,
    outerW: outerB.w,
    outerD: outerB.h,
    profileMode: fromOutline ? (rectangular ? "rect" : "silhouette") : "bbox",
    offset,
    at: (delta) => offset(used.base, delta),
  };
}

function centerOf(f: Feat): [number, number] | null {
  if (f.kind === "box") return [f.min[0] + f.size[0] / 2, f.min[1] + f.size[1] / 2];
  if (f.kind === "cyl") return [f.origin[0], f.origin[1]];
  return null;
}

function keepInside(feats: Feat[], loop: Loop): Feat[] {
  return feats.filter((f) => {
    const c = centerOf(f);
    return !c || pointInPoly(c, loop);
  });
}

export function planMold(
  system: SystemId,
  partSize: Vec3,
  masterVolume: number,
  params: MoldParams,
  outline?: Loop,
  offset: OffsetFn = offsetClean,
): MoldPlan {
  const [pw, pd, ph] = partSize;
  if (pw < 0.5 || pd < 0.5 || ph < 0.5) throw new Error("La pieza es demasiado pequeña");
  if (system === "twopart") return planTwoPart(partSize, masterVolume, params, outline, offset);
  return planOpenBox(system, partSize, masterVolume, params, outline, offset);
}

function planOpenBox(
  system: "adapted" | "tray",
  partSize: Vec3,
  masterVolume: number,
  params: MoldParams,
  outline: Loop | undefined,
  offset: OffsetFn,
): MoldPlan {
  const ph = partSize[2];
  const wall = params.wallThickness;
  const gap = params.siliconeGap;
  const innerH = ph + gap;
  const floor = wall;
  const outerH = floor + innerH;
  const { extra, clamped } = draftExtra(wall, innerH, params.draftDeg);
  const open = 0.08;
  const grow = innerH > 1e-9 ? (innerH + open) / innerH : 1;
  const warnings: string[] = [];
  if (clamped) warnings.push("El ángulo de salida se limitó para dejar al menos 1 mm de pared arriba.");
  const profile = buildProfile(partSize, gap, wall, extra, grow, outline, warnings, offset);
  const { innerW, innerD, outerW, outerD, outer, cavityBottom, cavityTop, designTop } = profile;

  const unions: Feat[] = [poly(outer, outer, 0, outerH)];
  const carve: Feat[] = [poly(cavityBottom, cavityTop, floor, outerH + open)];
  const subtracts: Feat[] = [];

  let displaced = 0;
  if (system === "adapted") {
    const rawKeys = placeKeys(innerW, innerD, innerH, floor);
    const keys = keepInside(rawKeys, cavityBottom);
    if (keys.length) {
      unions.push(...keys);
      displaced += keys.length * KEY_SIZE * KEY_SIZE * KEY_HEIGHT;
    } else if (rawKeys.length) warnings.push("Las llaves del fondo caen fuera de la silueta; se omitieron.");
    else warnings.push("La cavidad es pequeña: se omitieron las llaves del fondo.");

    const rawPins = placeFloorPins(innerW, innerD, innerH, floor, params.pinDiameter, params.pinReach);
    const pins = keepInside(rawPins, cavityBottom);
    if (pins.length) {
      unions.push(...pins);
      const r = params.pinDiameter / 2;
      displaced += pins.length * Math.PI * r * r * params.pinReach;
    } else if (rawPins.length) warnings.push("Los pines de registro caen fuera de la silueta; se omitieron.");
    else warnings.push("La cavidad es pequeña: se omitieron los pines de registro.");

    const channelZ = channelCenter(floor, innerH, params.channelH);
    const t = Math.min(1, Math.max(0, (channelZ - floor) / innerH));
    const cavityAtChannel = profile.at(gap + extra * grow * t) ?? cavityBottom;
    const cup = placeSideFunnel(outer, cavityAtChannel, wall, params, channelZ);
    unions.push(cup.outer);
    subtracts.push(cup.channel, cup.inner);
  }

  const slotWidth = params.clampSlot + params.clampClearance;
  const wantClamp = system === "adapted" || params.clampEnabled;
  const clamps: Feat[] = [];
  if (wantClamp) {
    const slots = placeSlots(outerW, outerD, outerH, wall, slotWidth);
    if (slots.length) {
      subtracts.push(...slots);
      clamps.push(...placeClampPads(params.clampSlot));
    } else warnings.push("La pared es demasiado fina para las ranuras de abrazadera.");
  }

  const funnelVol =
    system === "adapted"
      ? Math.PI * (params.funnelDiameter / 2) ** 2 * Math.max(0, params.funnelDiameter - wall) +
        params.channelW * params.channelH * wall
      : 0;
  const cav = loftVolume(cavityBottom, designTop, innerH);
  const siliconeMm3 = Math.max(0, cav - masterVolume - displaced + funnelVol);

  const solids: SolidSpec[] = [
    {
      id: system === "adapted" ? "adapted_box" : "tray",
      role: "mold",
      split: true,
      unions,
      carve,
      subtracts,
    },
  ];
  if (clamps.length) {
    solids.push({
      id: system === "adapted" ? "adapted_clamps" : "tray_clamp",
      role: "clamp",
      split: false,
      unions: clamps,
      carve: [],
      subtracts: [],
    });
  }

  return {
    system,
    warnings,
    masterLift: floor,
    metrics: {
      innerW,
      innerD,
      innerH,
      outerW,
      outerD,
      outerH,
      floor,
      extra,
      draftClamped: clamped,
      pinDiameter: params.pinDiameter,
      holeDiameter: params.holeDiameter,
      pinReach: params.pinReach,
      funnelDiameter: params.funnelDiameter,
      channelW: params.channelW,
      channelH: params.channelH,
      clampSlot: params.clampSlot,
      slotWidth,
      cutZ: 0,
      masterVolume,
      siliconeMm3,
    },
    solids,
    profileMode: profile.profileMode,
  };
}

function placeKeys(innerW: number, innerD: number, innerH: number, floor: number): Feat[] {
  const need = KEY_INSET * 2 + KEY_SIZE * 2 + 8;
  if (innerW < need || innerD < need || innerH < KEY_HEIGHT + 1) return [];
  const xs = [-innerW / 2 + KEY_INSET, innerW / 2 - KEY_INSET - KEY_SIZE];
  const ys = [-innerD / 2 + KEY_INSET, innerD / 2 - KEY_INSET - KEY_SIZE];
  const out: Feat[] = [];
  for (const x of xs) {
    for (const y of ys) {
      out.push(box([x, y, floor - 0.25], [KEY_SIZE, KEY_SIZE, KEY_HEIGHT + 0.25]));
    }
  }
  return out;
}

function placeFloorPins(
  innerW: number,
  innerD: number,
  innerH: number,
  floor: number,
  diameter: number,
  reach: number,
): Feat[] {
  const r = diameter / 2;
  const inset = r + 2;
  if (innerH < reach + 0.5 || innerW < inset * 2 + 4 || innerD < inset * 2 + 4) return [];
  const spots: Array<[number, number]> = [
    [0, -innerD / 2 + inset],
    [0, innerD / 2 - inset],
    [-innerW / 2 + inset, 0],
    [innerW / 2 - inset, 0],
  ];
  return spots.map(([x, y]) =>
    cyl({ axis: "z", origin: [x, y, floor - 0.25], height: reach + 0.25, radius: r }),
  );
}

function channelCenter(floor: number, innerH: number, chH: number): number {
  const minZ = floor + chH / 2 + 0.8;
  const maxZ = floor + innerH - chH / 2 - 0.8;
  if (maxZ <= minZ) return floor + innerH / 2;
  return Math.min(maxZ, Math.max(minZ, floor + innerH * 0.68));
}

function placeSideFunnel(
  outerLoop: Loop,
  cavityLoop: Loop,
  wall: number,
  params: MoldParams,
  channelZ: number,
): { outer: Feat; inner: Feat; channel: Feat } {
  const anchor = rightAnchor(outerLoop);
  const innerR = params.funnelDiameter / 2;
  const outerR = innerR + wall;
  const cupBottom = Math.max(0, channelZ - params.channelH / 2 - wall - 0.4);
  const cupTop = Math.max(cupBottom + params.funnelDiameter, channelZ + params.channelH / 2 + wall + 1);
  const centerX = anchor.x + outerR - 0.6;
  const cavX = maxXAtY(cavityLoop, anchor.y) ?? anchor.x - wall;
  const channel: Feat = box(
    [cavX - 0.4, anchor.y - params.channelW / 2, channelZ - params.channelH / 2],
    [Math.max(0.2, centerX - (cavX - 0.4)), params.channelW, params.channelH],
  );
  return {
    outer: cyl({ axis: "z", origin: [centerX, anchor.y, cupBottom], height: cupTop - cupBottom, radius: outerR }),
    inner: cyl({
      axis: "z",
      origin: [centerX, anchor.y, cupBottom + wall],
      height: cupTop - cupBottom - wall + 0.4,
      radius: innerR,
    }),
    channel,
  };
}

function placeSlots(outerW: number, outerD: number, outerH: number, wall: number, slotWidth: number): Feat[] {
  const depth = Math.min(wall * 0.55, wall - 0.9);
  if (depth < 0.45 || outerH < slotWidth + 2 || outerW < slotWidth + 2) return [];
  const z = Math.min(outerH * 0.62, outerH - slotWidth / 2 - 1);
  const z0 = z - slotWidth / 2;
  const half = outerD / 2;
  return [
    box([-slotWidth / 2, half - depth, z0], [slotWidth, depth + 0.04, slotWidth]),
    box([-slotWidth / 2, -half - 0.04, z0], [slotWidth, depth + 0.04, slotWidth]),
  ];
}

function placeClampPads(slot: number): Feat[] {
  const depth = 4;
  const gap = 6;
  return [
    box([0, 0, 0], [slot, depth, slot]),
    box([0, depth + gap, 0], [slot, depth, slot]),
  ];
}

function planTwoPart(
  partSize: Vec3,
  masterVolume: number,
  params: MoldParams,
  outline: Loop | undefined,
  offset: OffsetFn,
): MoldPlan {
  const ph = partSize[2];
  const wall = params.wallThickness;
  const gap = params.siliconeGap;
  const innerH = ph + 2 * gap;
  const floor = wall;
  const outerH = floor + innerH + wall;
  const cutZ = floor + gap + ph * params.cutRatio;
  const { extra, clamped } = draftExtra(wall, innerH, params.draftDeg);
  const cavZ0 = floor;
  const cavZ1 = floor + innerH;
  const warnings: string[] = [];
  if (clamped) warnings.push("El ángulo de salida se limitó para dejar al menos 1 mm de pared.");
  const profile = buildProfile(partSize, gap, wall, extra, 1, outline, warnings, offset);
  const { innerW, innerD, outerW, outerD, outer, cavityBottom, cavityTop, designTop } = profile;
  const tCut = innerH > 1e-9 ? (cutZ - cavZ0) / innerH : 0;
  const cavCut = profile.at(gap + extra * tCut) ?? lerpLoop(cavityBottom, cavityTop, tCut);

  const margin = 0.55;
  const room = wall - margin * 2;
  const tongues: Feat[] = [];
  const grooves: Feat[] = [];
  if (room >= 0.8) {
    const tongueW = Math.min(SEAL_W, room);
    const tongueInner = profile.offset(cavCut, margin);
    const tongueOuter = profile.offset(cavCut, margin + tongueW);
    if (tongueInner && tongueOuter) {
      tongues.push(
        poly(tongueOuter, tongueOuter, cutZ - 0.2, cutZ - 0.2 + SEAL_H + 0.2, {
          bottom: tongueInner,
          top: tongueInner,
        }),
      );
    }
    const clearance = params.clampClearance;
    const grooveInner = profile.offset(cavCut, Math.max(0.05, margin - clearance / 2));
    const grooveOuter = profile.offset(cavCut, margin + tongueW + clearance / 2);
    if (grooveInner && grooveOuter) {
      grooves.push(
        poly(grooveOuter, grooveOuter, cutZ, cutZ + SEAL_H + clearance, {
          bottom: grooveInner,
          top: grooveInner,
        }),
      );
    }
  }
  if (!tongues.length) warnings.push("El borde es estrecho: se omitió el sello perimetral.");

  const hxCut = loopBounds(cavCut).maxX;
  const hyCut = loopBounds(cavCut).maxY;
  const wallX = outerW / 2 - hxCut;
  const wallY = outerD / 2 - hyCut;
  const px = (hxCut + outerW / 2) / 2;
  const py = (hyCut + outerD / 2) / 2;
  const pinsOk = wallX > params.pinDiameter * 0.45 && wallY > params.pinDiameter * 0.45;
  const pinCandidates: Array<[number, number]> = pinsOk
    ? [
        [px, py],
        [px, -py],
        [-px, py],
        [-px, -py],
      ]
    : [];
  const pinSpots = pinCandidates.filter(([x, y]) => pointInPoly([x, y], outer) && !pointInPoly([x, y], cavCut));
  if (!pinSpots.length) warnings.push("El borde es estrecho: se omitieron los pines.");

  const pins: Feat[] = pinSpots.map(([x, y]) =>
    cyl({
      axis: "z",
      origin: [x, y, cutZ - 0.3],
      height: params.pinReach + 0.3,
      radius: params.pinDiameter / 2,
    }),
  );
  const bosses: Feat[] = pinSpots.map(([x, y]) =>
    cyl({
      axis: "z",
      origin: [x, y, cutZ],
      height: params.pinReach,
      radius: params.holeDiameter / 2 + 1.2,
    }),
  );
  const holes: Feat[] = pinSpots.map(([x, y]) =>
    cyl({
      axis: "z",
      origin: [x, y, cutZ - 0.04],
      height: params.pinReach + 0.5,
      radius: params.holeDiameter / 2,
    }),
  );

  const cup = placePartingFunnel(outer, cavCut, wall, cutZ, params);

  const tBottom = innerH > 1e-9 ? (cutZ + 0.08 - cavZ0) / innerH : 0;
  const tTop = innerH > 1e-9 ? (cutZ - 0.08 - cavZ0) / innerH : 0;
  const bottomLip = profile.at(gap + extra * tBottom) ?? cavityBottom;
  const topLip = profile.at(gap + extra * tTop) ?? cavityTop;
  const bottomCarve = poly(cavityBottom, bottomLip, cavZ0, cutZ + 0.08);
  const topCarve = poly(topLip, cavityTop, cutZ - 0.08, cavZ1);

  const bottom: SolidSpec = {
    id: "2part_bottom",
    role: "mold",
    split: true,
    unions: [poly(outer, outer, 0, cutZ), ...tongues, ...pins, cup.outerBottom],
    carve: [bottomCarve],
    subtracts: [cup.channel, cup.innerBottom],
  };
  const top: SolidSpec = {
    id: "2part_top",
    role: "mold",
    split: true,
    unions: [poly(outer, outer, cutZ, outerH), ...bosses, cup.outerTop],
    carve: [topCarve],
    subtracts: [...grooves, ...holes, cup.channel, cup.innerTop],
  };

  const cav = loftVolume(cavityBottom, designTop, innerH);
  const funnelVol =
    Math.PI * (params.funnelDiameter / 2) ** 2 * Math.max(0, params.funnelDiameter - wall) +
    params.channelW * params.channelH * wall;
  const siliconeMm3 = Math.max(0, cav - masterVolume + funnelVol);

  return {
    system: "twopart",
    warnings,
    masterLift: floor + gap,
    metrics: {
      innerW,
      innerD,
      innerH,
      outerW,
      outerD,
      outerH,
      floor,
      extra,
      draftClamped: clamped,
      pinDiameter: params.pinDiameter,
      holeDiameter: params.holeDiameter,
      pinReach: params.pinReach,
      funnelDiameter: params.funnelDiameter,
      channelW: params.channelW,
      channelH: params.channelH,
      clampSlot: params.clampSlot,
      slotWidth: params.clampSlot + params.clampClearance,
      cutZ,
      masterVolume,
      siliconeMm3,
    },
    solids: [bottom, top],
    profileMode: profile.profileMode,
  };
}

function placePartingFunnel(outerLoop: Loop, cavityLoop: Loop, wall: number, cutZ: number, params: MoldParams) {
  const anchor = rightAnchor(outerLoop);
  const innerR = params.funnelDiameter / 2;
  const outerR = innerR + wall;
  const cupH = params.funnelDiameter;
  const cupBottom = cutZ - cupH / 2;
  const centerX = anchor.x + outerR - 0.6;
  const cavX = maxXAtY(cavityLoop, anchor.y) ?? anchor.x - wall;
  const channel = box(
    [cavX - 0.3, anchor.y - params.channelW / 2, cutZ - params.channelH / 2],
    [Math.max(0.2, centerX - (cavX - 0.3)), params.channelW, params.channelH],
  );
  const outerCyl = (zMin: number, zMax: number): Feat =>
    cyl({
      axis: "z",
      origin: [centerX, anchor.y, cupBottom],
      height: cupH,
      radius: outerR,
      zMin,
      zMax,
    });
  const innerCyl = (zMin: number, zMax: number): Feat =>
    cyl({
      axis: "z",
      origin: [centerX, anchor.y, cupBottom + wall],
      height: cupH - wall + 0.4,
      radius: innerR,
      zMin,
      zMax,
    });
  return {
    outerBottom: outerCyl(-1e4, cutZ),
    innerBottom: innerCyl(-1e4, cutZ + 0.02),
    outerTop: outerCyl(cutZ, 1e4),
    innerTop: innerCyl(cutZ - 0.02, 1e4),
    channel,
  };
}
