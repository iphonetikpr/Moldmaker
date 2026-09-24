import { KEY_HEIGHT, KEY_INSET, KEY_SIZE, SEAL_H, SEAL_W } from "../constants";
import type { MoldParams, SystemId, Vec3 } from "../types";

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

export type Feat =
  | ({ kind: "box" } & BoxFeat)
  | ({ kind: "cyl" } & CylFeat)
  | ({ kind: "frustum" } & FrustumFeat);

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

export interface MoldPlan {
  system: SystemId;
  warnings: string[];
  masterLift: number;
  metrics: MoldMetrics;
  solids: SolidSpec[];
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

function frustum(f: FrustumFeat): Feat {
  return { kind: "frustum", ...f };
}

function hxAt(z: number, z0: number, h: number, hx0: number, hx1: number): number {
  const t = h <= 1e-9 ? 0 : (z - z0) / h;
  return hx0 + (hx1 - hx0) * t;
}

export function planMold(
  system: SystemId,
  partSize: Vec3,
  masterVolume: number,
  params: MoldParams,
): MoldPlan {
  const [pw, pd, ph] = partSize;
  if (pw < 0.5 || pd < 0.5 || ph < 0.5) throw new Error("La pieza es demasiado pequeña");
  if (system === "twopart") return planTwoPart(partSize, masterVolume, params);
  return planOpenBox(system, partSize, masterVolume, params);
}

function planOpenBox(
  system: "adapted" | "tray",
  partSize: Vec3,
  masterVolume: number,
  params: MoldParams,
): MoldPlan {
  const [pw, pd, ph] = partSize;
  const wall = params.wallThickness;
  const gap = params.siliconeGap;
  const innerW = pw + 2 * gap;
  const innerD = pd + 2 * gap;
  const innerH = ph + gap;
  const floor = wall;
  const outerW = innerW + 2 * wall;
  const outerD = innerD + 2 * wall;
  const outerH = floor + innerH;
  const { extra, clamped } = draftExtra(wall, innerH, params.draftDeg);
  const open = 0.08;
  const hx0 = innerW / 2;
  const hy0 = innerD / 2;
  const hx1 = innerW / 2 + extra;
  const hy1 = innerD / 2 + extra;
  const grow = innerH > 1e-9 ? (innerH + open) / innerH : 1;
  const warnings: string[] = [];
  if (clamped) warnings.push("El ángulo de salida se limitó para dejar al menos 1 mm de pared arriba.");

  const unions: Feat[] = [box([-outerW / 2, -outerD / 2, 0], [outerW, outerD, outerH])];
  const carve: Feat[] = [
    frustum({
      z0: floor,
      z1: outerH + open,
      hx0,
      hy0,
      hx1: hx0 + (hx1 - hx0) * grow,
      hy1: hy0 + (hy1 - hy0) * grow,
    }),
  ];
  const subtracts: Feat[] = [];

  let displaced = 0;
  if (system === "adapted") {
    const keys = placeKeys(innerW, innerD, innerH, floor);
    if (keys.length) {
      unions.push(...keys);
      displaced += keys.length * KEY_SIZE * KEY_SIZE * KEY_HEIGHT;
    } else warnings.push("La cavidad es pequeña: se omitieron las llaves del fondo.");

    const pins = placeFloorPins(innerW, innerD, innerH, floor, params.pinDiameter, params.pinReach);
    if (pins.length) {
      unions.push(...pins);
      const r = params.pinDiameter / 2;
      displaced += pins.length * Math.PI * r * r * params.pinReach;
    } else warnings.push("La cavidad es pequeña: se omitieron los pines de registro.");

    const channelZ = channelCenter(floor, innerH, params.channelH);
    const cup = placeSideFunnel(outerW, wall, params, channelZ);
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
  const cav = frustumVolume(hx0, hy0, hx1, hy1, innerH);
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
  outerW: number,
  wall: number,
  params: MoldParams,
  channelZ: number,
): { outer: Feat; inner: Feat; channel: Feat } {
  const innerR = params.funnelDiameter / 2;
  const outerR = innerR + wall;
  const cupBottom = Math.max(0, channelZ - params.channelH / 2 - wall - 0.4);
  const cupTop = Math.max(cupBottom + params.funnelDiameter, channelZ + params.channelH / 2 + wall + 1);
  const centerX = outerW / 2 + outerR - 0.6;
  const channel: Feat = box(
    [outerW / 2 - wall - 0.4, -params.channelW / 2, channelZ - params.channelH / 2],
    [centerX - (outerW / 2 - wall - 0.4), params.channelW, params.channelH],
  );
  return {
    outer: cyl({ axis: "z", origin: [centerX, 0, cupBottom], height: cupTop - cupBottom, radius: outerR }),
    inner: cyl({
      axis: "z",
      origin: [centerX, 0, cupBottom + wall],
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

function planTwoPart(partSize: Vec3, masterVolume: number, params: MoldParams): MoldPlan {
  const [pw, pd, ph] = partSize;
  const wall = params.wallThickness;
  const gap = params.siliconeGap;
  const innerW = pw + 2 * gap;
  const innerD = pd + 2 * gap;
  const innerH = ph + 2 * gap;
  const floor = wall;
  const outerW = innerW + 2 * wall;
  const outerD = innerD + 2 * wall;
  const outerH = floor + innerH + wall;
  const cutZ = floor + gap + ph * params.cutRatio;
  const { extra, clamped } = draftExtra(wall, innerH, params.draftDeg);
  const cavZ0 = floor;
  const cavZ1 = floor + innerH;
  const hx0 = innerW / 2;
  const hy0 = innerD / 2;
  const hx1 = innerW / 2 + extra;
  const hy1 = innerD / 2 + extra;
  const warnings: string[] = [];
  if (clamped) warnings.push("El ángulo de salida se limitó para dejar al menos 1 mm de pared.");

  const hxCut = hxAt(cutZ, cavZ0, innerH, hx0, hx1);
  const hyCut = hxAt(cutZ, cavZ0, innerH, hy0, hy1);
  const wallX = outerW / 2 - hxCut;
  const wallY = outerD / 2 - hyCut;
  const tongueW = Math.min(SEAL_W, wallX - 0.5, wallY - 0.5);
  const corner = Math.max(params.holeDiameter + 2.5, 7);
  const tongues =
    tongueW >= 0.8 ? rimBars(outerW, outerD, hxCut, hyCut, tongueW, cutZ - 0.2, SEAL_H + 0.2, corner) : [];
  const grooves =
    tongueW >= 0.8
      ? rimBars(
          outerW,
          outerD,
          hxCut,
          hyCut,
          tongueW + params.clampClearance,
          cutZ,
          SEAL_H + params.clampClearance,
          corner - params.clampClearance,
        )
      : [];
  if (!tongues.length) warnings.push("El borde es estrecho: se omitió el sello perimetral.");

  const px = (hxCut + outerW / 2) / 2;
  const py = (hyCut + outerD / 2) / 2;
  const pinsOk = wallX > params.pinDiameter * 0.45 && wallY > params.pinDiameter * 0.45;
  const pinSpots: Array<[number, number]> = pinsOk
    ? [
        [px, py],
        [px, -py],
        [-px, py],
        [-px, -py],
      ]
    : [];
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

  const cup = placePartingFunnel(outerW, wall, cutZ, params, hxCut);

  const bottomCarve = frustum({
    z0: cavZ0,
    z1: cutZ + 0.08,
    hx0,
    hy0,
    hx1: hxAt(cutZ + 0.08, cavZ0, innerH, hx0, hx1),
    hy1: hxAt(cutZ + 0.08, cavZ0, innerH, hy0, hy1),
  });
  const topCarve = frustum({
    z0: cutZ - 0.08,
    z1: cavZ1,
    hx0: hxAt(cutZ - 0.08, cavZ0, innerH, hx0, hx1),
    hy0: hxAt(cutZ - 0.08, cavZ0, innerH, hy0, hy1),
    hx1,
    hy1,
  });

  const bottom: SolidSpec = {
    id: "2part_bottom",
    role: "mold",
    split: true,
    unions: [
      box([-outerW / 2, -outerD / 2, 0], [outerW, outerD, cutZ]),
      ...tongues,
      ...pins,
      cup.outerBottom,
    ],
    carve: [bottomCarve],
    subtracts: [cup.channel, cup.innerBottom],
  };
  const top: SolidSpec = {
    id: "2part_top",
    role: "mold",
    split: true,
    unions: [
      box([-outerW / 2, -outerD / 2, cutZ], [outerW, outerD, outerH - cutZ]),
      ...bosses,
      cup.outerTop,
    ],
    carve: [topCarve],
    subtracts: [...grooves, ...holes, cup.channel, cup.innerTop],
  };

  const cav = frustumVolume(hx0, hy0, hx1, hy1, innerH);
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
  };
}

function rimBars(
  outerW: number,
  outerD: number,
  hx: number,
  hy: number,
  width: number,
  z: number,
  height: number,
  corner: number,
): Feat[] {
  const xMid = (hx + outerW / 2) / 2;
  const yMid = (hy + outerD / 2) / 2;
  const y0 = -outerD / 2 + corner;
  const y1 = outerD / 2 - corner;
  const x0 = -outerW / 2 + corner;
  const x1 = outerW / 2 - corner;
  if (y1 - y0 < 4 || x1 - x0 < 4 || width < 0.4) return [];
  return [
    box([xMid - width / 2, y0, z], [width, y1 - y0, height]),
    box([-xMid - width / 2, y0, z], [width, y1 - y0, height]),
    box([x0, yMid - width / 2, z], [x1 - x0, width, height]),
    box([x0, -yMid - width / 2, z], [x1 - x0, width, height]),
  ];
}

function placePartingFunnel(outerW: number, wall: number, cutZ: number, params: MoldParams, hxCut: number) {
  const innerR = params.funnelDiameter / 2;
  const outerR = innerR + wall;
  const cupH = params.funnelDiameter;
  const cupBottom = cutZ - cupH / 2;
  const centerX = outerW / 2 + outerR - 0.6;
  const channel = box(
    [hxCut - 0.3, -params.channelW / 2, cutZ - params.channelH / 2],
    [centerX - (hxCut - 0.3), params.channelW, params.channelH],
  );
  const outerCyl = (zMin: number, zMax: number): Feat =>
    cyl({
      axis: "z",
      origin: [centerX, 0, cupBottom],
      height: cupH,
      radius: outerR,
      zMin,
      zMax,
    });
  const innerCyl = (zMin: number, zMax: number): Feat =>
    cyl({
      axis: "z",
      origin: [centerX, 0, cupBottom + wall],
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
