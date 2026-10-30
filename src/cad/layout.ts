import {
  BINDER_CORNER_MARGIN,
  BINDER_GROOVE_D,
  BINDER_GROOVE_W,
  BINDER_RIB_W,
  BINDER_ROOT_CHAMFER,
  FLANGE_PITCH,
  FLANGE_PROTRUSION,
  FLANGE_SLOT,
  FLANGE_SLOT_FROM_OUTER,
  FLANGE_THICKNESS,
  KEY_HEIGHT,
  KEY_INSET,
  KEY_SIZE,
  SEAL_H,
  SEAL_W,
  binderSizeById,
  type BinderSize,
} from "../constants";
import { closureOf } from "./params";
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

export interface HullFeat {
  pts: Vec3[];
}

export type Feat =
  | ({ kind: "box" } & BoxFeat)
  | ({ kind: "cyl" } & CylFeat)
  | ({ kind: "frustum" } & FrustumFeat)
  | ({ kind: "poly" } & PolyFeat)
  | ({ kind: "hull" } & HullFeat);

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
  /** Through-slot opening in the flange (mm). Fixed by the wedge clip. */
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
  /** One printed wedge clip per station. A 2-part station is a top/bottom pair. */
  clipCount: number;
  flanges: FlangeStation[];
}

export type FlangeSide = "x+" | "x-" | "y+" | "y-";

export interface FlangeStation {
  side: FlangeSide;
  /** Coordinate along the wall: Y on ±X sides, X on ±Y sides. */
  along: number;
  /** Outer face of the shell at `along`. */
  wall: number;
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

  const closure = closureOf(params);
  const flange =
    closure === "none"
      ? emptyFlange()
      : placeFlanges(
          outer,
          outerH,
          0,
          system === "adapted" ? pourKeepouts(outer, wall, params) : [],
          warnings,
          "single",
          closure === "binder" ? binderSizeById(params.binderSize) : null,
        );
  unions.push(...flange.unions);
  subtracts.push(...flange.slots);

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
      slotWidth: FLANGE_SLOT,
      cutZ: 0,
      masterVolume,
      siliconeMm3,
    },
    solids,
    profileMode: profile.profileMode,
    clipCount: flange.stations.length,
    flanges: flange.stations,
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

/** Tangential width of the printed-clip tab: 4 mm of material on each side of the 8.3 mm slot. */
function flangeWidth(): number {
  return FLANGE_SLOT + 2 * FLANGE_SLOT_FROM_OUTER;
}

interface TabProfile {
  width: number;
  protrusion: number;
  /** Per half. A one-piece shell stacks two of these into one tab. */
  thickness: number;
  slotted: boolean;
  /** Distance from the tab tip to the groove centerline. Binder only. */
  grooveFromTip: number;
  ribs: number;
}

function clipProfile(): TabProfile {
  return {
    width: flangeWidth(),
    protrusion: FLANGE_PROTRUSION,
    thickness: FLANGE_THICKNESS,
    slotted: true,
    grooveFromTip: 0,
    ribs: 0,
  };
}

function binderProfile(row: BinderSize): TabProfile {
  return {
    width: row.width,
    protrusion: row.protrusion,
    thickness: row.thickness,
    slotted: false,
    grooveFromTip: row.grooveFromTip,
    ribs: row.ribs,
  };
}

interface FlangeBuild {
  unions: Feat[];
  slots: Feat[];
  stations: FlangeStation[];
  /** Index 0 is the lower tab, index 1 the upper tab. A one-piece shell uses only index 0. */
  halves: Array<{ unions: Feat[]; slots: Feat[] }>;
}

function emptyFlange(): FlangeBuild {
  return {
    unions: [],
    slots: [],
    stations: [],
    halves: [
      { unions: [], slots: [] },
      { unions: [], slots: [] },
    ],
  };
}

function pourKeepouts(outer: Loop, wall: number, params: MoldParams): Array<{ x: number; y: number; r: number }> {
  const anchor = rightAnchor(outer);
  const outerR = params.funnelDiameter / 2 + wall;
  return [{ x: anchor.x + outerR - 0.6, y: anchor.y, r: outerR + 0.8 }];
}

function crossCoord(loop: Loop, alongY: boolean, at: number): number[] {
  const hits: number[] = [];
  const n = loop.length;
  for (let i = 0; i < n; i++) {
    const a = loop[i];
    const b = loop[(i + 1) % n];
    const aAlong = alongY ? a[1] : a[0];
    const bAlong = alongY ? b[1] : b[0];
    const aCross = alongY ? a[0] : a[1];
    const bCross = alongY ? b[0] : b[1];
    if (Math.abs(aAlong - bAlong) < 1e-9) {
      if (Math.abs(at - aAlong) <= 1e-4) hits.push(aCross, bCross);
      continue;
    }
    const t = (at - aAlong) / (bAlong - aAlong);
    if (t < -1e-6 || t > 1 + 1e-6) continue;
    hits.push(aCross + t * (bCross - aCross));
  }
  return hits;
}

function spreadAlong(min: number, max: number, tabWidth: number, blocked: (at: number) => boolean): number[] {
  const length = max - min;
  const n = Math.max(1, Math.ceil(length / FLANGE_PITCH));
  const half = tabWidth / 2;
  const edge = half + FLANGE_SLOT_FROM_OUTER;
  const lo = min + edge;
  const hi = max - edge;
  const room = hi >= lo;
  const ideal = room
    ? Array.from({ length: n }, (_, i) => min + ((i + 1) / (n + 1)) * length)
    : length >= tabWidth
      ? [(min + max) / 2]
      : [];
  const placed: number[] = [];
  const limit = (at: number) => (room ? Math.min(hi, Math.max(lo, at)) : at);
  const free = (at: number) =>
    !blocked(at) && placed.every((p) => Math.abs(p - at) >= tabWidth + 1);
  for (const target of ideal) {
    const start = limit(target);
    if (free(start)) {
      placed.push(start);
      continue;
    }
    let found: number | null = null;
    const span = Math.ceil(length);
    for (let step = 1; step <= span && found == null; step++) {
      for (const sign of [1, -1] as const) {
        const at = limit(target + sign * step);
        if (Math.abs(at - target) > step + 1e-6) continue;
        if (free(at)) {
          found = at;
          break;
        }
      }
    }
    if (found != null) placed.push(found);
  }
  return placed;
}

/**
 * Binder stations. Count is max(minCount, ceil(side / pitch)).
 * If that count cannot keep the tab width plus 10 mm clear of each corner, one centered tab is used.
 */
function spreadBinder(min: number, max: number, row: BinderSize, blocked: (at: number) => boolean): number[] {
  const length = max - min;
  const width = row.width;
  const n = Math.max(row.minCount, Math.ceil(length / row.pitch));
  const half = width / 2;
  const lo = min + half + BINDER_CORNER_MARGIN;
  const hi = max - half - BINDER_CORNER_MARGIN;
  const idealOf = (count: number) => Array.from({ length: count }, (_, i) => min + ((i + 1) / (count + 1)) * length);
  const fits = (pts: number[]) =>
    pts.length > 0 &&
    pts.every((at, i) => at >= lo - 1e-6 && at <= hi + 1e-6 && (i === 0 || at - pts[i - 1] >= width - 1e-6));
  const wanted = idealOf(Math.max(1, n));
  const targets = fits(wanted) ? wanted : [(min + max) / 2];
  const placed: number[] = [];
  const free = (at: number) => !blocked(at) && placed.every((p) => Math.abs(p - at) >= width + 1);
  for (const target of targets) {
    if (free(target)) {
      placed.push(target);
      continue;
    }
    let found: number | null = null;
    const span = Math.ceil(Math.max(length, 1));
    for (let step = 1; step <= span && found == null; step++) {
      for (const sign of [1, -1] as const) {
        const at = target + sign * step;
        if (at < min + half || at > max - half) continue;
        if (free(at)) {
          found = at;
          break;
        }
      }
    }
    if (found != null) placed.push(found);
  }
  return placed;
}

function rectHitsCircle(
  minX: number,
  minY: number,
  maxX: number,
  maxY: number,
  cx: number,
  cy: number,
  r: number,
): boolean {
  const x = Math.max(minX, Math.min(cx, maxX));
  const y = Math.max(minY, Math.min(cy, maxY));
  return (x - cx) ** 2 + (y - cy) ** 2 <= r * r;
}

/** Stations around the outer shell. The pour cup is kept clear. */
export function planFlangeStations(
  outer: Loop,
  avoid: Array<{ x: number; y: number; r: number }>,
  tabWidth = flangeWidth(),
  protrusion = FLANGE_PROTRUSION,
  binder: BinderSize | null = null,
): FlangeStation[] {
  const bounds = loopBounds(outer);
  const half = tabWidth / 2;
  const sides: Array<{ side: FlangeSide; min: number; max: number; face: number }> = [
    { side: "x+", min: bounds.minY, max: bounds.maxY, face: bounds.maxX },
    { side: "x-", min: bounds.minY, max: bounds.maxY, face: bounds.minX },
    { side: "y+", min: bounds.minX, max: bounds.maxX, face: bounds.maxY },
    { side: "y-", min: bounds.minX, max: bounds.maxX, face: bounds.minY },
  ];
  const stations: FlangeStation[] = [];
  for (const side of sides) {
    const alongY = side.side === "x+" || side.side === "x-";
    const wantMax = side.side === "x+" || side.side === "y+";
    const blocked = (at: number) => {
      const hits = crossCoord(outer, alongY, at);
      if (!hits.length) return true;
      const wall = wantMax ? Math.max(...hits) : Math.min(...hits);
      if (Math.abs(wall - side.face) > 1.5) return true;
      const sign = side.side === "x+" || side.side === "y+" ? 1 : -1;
      let minX: number;
      let maxX: number;
      let minY: number;
      let maxY: number;
      if (alongY) {
        const x0 = wall;
        const x1 = wall + sign * protrusion;
        minX = Math.min(x0, x1);
        maxX = Math.max(x0, x1);
        minY = at - half;
        maxY = at + half;
      } else {
        const y0 = wall;
        const y1 = wall + sign * protrusion;
        minY = Math.min(y0, y1);
        maxY = Math.max(y0, y1);
        minX = at - half;
        maxX = at + half;
      }
      return avoid.some((c) => rectHitsCircle(minX, minY, maxX, maxY, c.x, c.y, c.r));
    };
    const spots = binder
      ? spreadBinder(side.min, side.max, binder, blocked)
      : spreadAlong(side.min, side.max, tabWidth, blocked);
    for (const along of spots) {
      const hits = crossCoord(outer, alongY, along);
      if (!hits.length) continue;
      const wall = wantMax ? Math.max(...hits) : Math.min(...hits);
      if (Math.abs(wall - side.face) > 1.5) continue;
      stations.push({ side: side.side, along, wall });
    }
  }
  return stations;
}

function sideSign(side: FlangeSide): 1 | -1 {
  return side === "x+" || side === "y+" ? 1 : -1;
}

function flangePair(station: FlangeStation, z0: number, z1: number, profile: TabProfile): { body: Feat; slot: Feat | null } {
  const width = profile.width;
  const bite = 0.4;
  const sign = sideSign(station.side);
  const bleed = 0.15;
  if (station.side === "x+" || station.side === "x-") {
    const xBite = station.wall - sign * bite;
    const xTip = station.wall + sign * profile.protrusion;
    const y0 = station.along - width / 2;
    const body = box([Math.min(xBite, xTip), y0, z0], [Math.abs(xTip - xBite), width, z1 - z0]);
    if (!profile.slotted) return { body, slot: null };
    const slotInner = profile.protrusion - FLANGE_SLOT_FROM_OUTER - FLANGE_SLOT;
    const slotOuter = profile.protrusion - FLANGE_SLOT_FROM_OUTER;
    const s0 = station.wall + sign * slotInner;
    const s1 = station.wall + sign * slotOuter;
    const slot = box(
      [Math.min(s0, s1), station.along - FLANGE_SLOT / 2, z0 - bleed],
      [Math.abs(s1 - s0), FLANGE_SLOT, z1 - z0 + bleed * 2],
    );
    return { body, slot };
  }
  const yBite = station.wall - sign * bite;
  const yTip = station.wall + sign * profile.protrusion;
  const x0 = station.along - width / 2;
  const body = box([x0, Math.min(yBite, yTip), z0], [width, Math.abs(yTip - yBite), z1 - z0]);
  if (!profile.slotted) return { body, slot: null };
  const slotInner = profile.protrusion - FLANGE_SLOT_FROM_OUTER - FLANGE_SLOT;
  const slotOuter = profile.protrusion - FLANGE_SLOT_FROM_OUTER;
  const s0 = station.wall + sign * slotInner;
  const s1 = station.wall + sign * slotOuter;
  const slot = box(
    [station.along - FLANGE_SLOT / 2, Math.min(s0, s1), z0 - bleed],
    [FLANGE_SLOT, Math.abs(s1 - s0), z1 - z0 + bleed * 2],
  );
  return { body, slot };
}

/** 45° gusset on the outer face, added outside the grip thickness so the jaw still closes on a flat tab. */
function binderGusset(station: FlangeStation, profile: TabProfile, zFace: number, below: boolean, outerH: number): Feat | null {
  const legRoom = below ? zFace : outerH - zFace;
  const leg = Math.min(profile.thickness, Math.max(0, legRoom));
  if (leg < 0.4) return null;
  const run = leg / Math.tan((BINDER_ROOT_CHAMFER * Math.PI) / 180);
  const sign = sideSign(station.side);
  const zWall = below ? zFace - leg : zFace + leg;
  const along0 = station.along - profile.width / 2;
  const along1 = station.along + profile.width / 2;
  const corner = (along: number, radial: number, z: number): Vec3 =>
    station.side === "x+" || station.side === "x-"
      ? [station.wall + sign * radial, along, z]
      : [along, station.wall + sign * radial, z];
  return {
    kind: "hull",
    pts: [
      corner(along0, 0, zFace),
      corner(along0, run, zFace),
      corner(along0, 0, zWall),
      corner(along1, 0, zFace),
      corner(along1, run, zFace),
      corner(along1, 0, zWall),
    ],
  };
}

/** Anti-slip groove on the outer face. `grooveFromTip` is the centerline measured from the tab tip. */
function binderGroove(station: FlangeStation, profile: TabProfile, zFace: number, below: boolean): Feat {
  const sign = sideSign(station.side);
  const fromWall = profile.protrusion - profile.grooveFromTip;
  const inner = fromWall - BINDER_GROOVE_W / 2;
  const bleed = 0.05;
  const zMin = below ? zFace - bleed : zFace - BINDER_GROOVE_D;
  const depth = BINDER_GROOVE_D + bleed;
  const along0 = station.along - profile.width / 2;
  if (station.side === "x+" || station.side === "x-") {
    const x0 = station.wall + sign * inner;
    const x1 = station.wall + sign * (inner + BINDER_GROOVE_W);
    return box([Math.min(x0, x1), along0, zMin], [BINDER_GROOVE_W, profile.width, depth]);
  }
  const y0 = station.wall + sign * inner;
  const y1 = station.wall + sign * (inner + BINDER_GROOVE_W);
  return box([along0, Math.min(y0, y1), zMin], [profile.width, BINDER_GROOVE_W, depth]);
}

/** Two narrow 45° ribs under a jumbo tab, running the full protrusion. */
function binderRibs(station: FlangeStation, profile: TabProfile, zFace: number, below: boolean, outerH: number): Feat[] {
  if (profile.ribs < 1) return [];
  const room = below ? zFace : outerH - zFace;
  const rise = Math.min(BINDER_RIB_W, Math.max(0, room));
  if (rise < 0.4) return [];
  const sign = sideSign(station.side);
  const zApex = below ? zFace - rise : zFace + rise;
  const out: Feat[] = [];
  for (let i = 0; i < profile.ribs; i++) {
    const along = station.along - profile.width / 2 + ((i + 1) / (profile.ribs + 1)) * profile.width;
    const a0 = along - BINDER_RIB_W / 2;
    const a1 = along + BINDER_RIB_W / 2;
    const corner = (alongPos: number, radial: number, z: number): Vec3 =>
      station.side === "x+" || station.side === "x-"
        ? [station.wall + sign * radial, alongPos, z]
        : [alongPos, station.wall + sign * radial, z];
    out.push({
      kind: "hull",
      pts: [
        corner(a0, 0, zFace),
        corner(a1, 0, zFace),
        corner(a0, 0, zApex),
        corner(a0, profile.protrusion, zFace),
        corner(a1, profile.protrusion, zFace),
        corner(a0, profile.protrusion, zApex),
      ],
    });
  }
  return out;
}

function placeFlanges(
  outer: Loop,
  outerH: number,
  cutZ: number,
  avoid: Array<{ x: number; y: number; r: number }>,
  warnings: string[],
  kind: "single" | "pair",
  binder: BinderSize | null,
): FlangeBuild {
  const profile = binder ? binderProfile(binder) : clipProfile();
  const none = emptyFlange();
  const stations = planFlangeStations(outer, avoid, profile.width, profile.protrusion, binder);
  if (!stations.length) {
    warnings.push("No cupo ninguna pestaña de cierre junto al borde.");
    return none;
  }
  const perHalf = profile.thickness;
  const ranges: Array<{ z0: number; z1: number; faces: Array<"below" | "above"> }> = [];
  if (kind === "single") {
    const thick = perHalf * 2;
    if (outerH < thick + 0.4) {
      warnings.push(`La pared es baja para la pestaña de ${thick} mm que agarra el clip.`);
      return none;
    }
    const z0 = (outerH - thick) / 2;
    ranges.push({ z0, z1: z0 + thick, faces: binder ? ["below", "above"] : [] });
  } else {
    if (cutZ < perHalf + 0.2 || outerH - cutZ < perHalf + 0.2) {
      warnings.push(`El plano de corte no deja ${perHalf} mm de pestaña en cada mitad.`);
      return none;
    }
    ranges.push(
      { z0: cutZ - perHalf, z1: cutZ, faces: binder ? ["below"] : [] },
      { z0: cutZ, z1: cutZ + perHalf, faces: binder ? ["above"] : [] },
    );
  }
  const halves: FlangeBuild["halves"] = [
    { unions: [], slots: [] },
    { unions: [], slots: [] },
  ];
  stations.forEach((station) => {
    ranges.forEach((range, index) => {
      const pair = flangePair(station, range.z0, range.z1, profile);
      const pack = halves[kind === "single" ? 0 : index];
      pack.unions.push(pair.body);
      if (pair.slot) pack.slots.push(pair.slot);
      for (const face of range.faces) {
        const zFace = face === "below" ? range.z0 : range.z1;
        const gusset = binderGusset(station, profile, zFace, face === "below", outerH);
        if (gusset) pack.unions.push(gusset);
        pack.unions.push(...binderRibs(station, profile, zFace, face === "below", outerH));
        pack.slots.push(binderGroove(station, profile, zFace, face === "below"));
      }
    });
  });
  return {
    unions: halves[0].unions,
    slots: halves[0].slots,
    stations,
    halves,
  };
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
  const closure = closureOf(params);
  const flange =
    closure === "none"
      ? emptyFlange()
      : placeFlanges(
          outer,
          outerH,
          cutZ,
          pourKeepouts(outer, wall, params),
          warnings,
          "pair",
          closure === "binder" ? binderSizeById(params.binderSize) : null,
        );

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
    unions: [poly(outer, outer, 0, cutZ), ...tongues, ...pins, cup.outerBottom, ...flange.halves[0].unions],
    carve: [bottomCarve],
    subtracts: [cup.channel, cup.innerBottom, ...flange.halves[0].slots],
  };
  const top: SolidSpec = {
    id: "2part_top",
    role: "mold",
    split: true,
    unions: [poly(outer, outer, cutZ, outerH), ...bosses, cup.outerTop, ...flange.halves[1].unions],
    carve: [topCarve],
    subtracts: [...grooves, ...holes, cup.channel, cup.innerTop, ...flange.halves[1].slots],
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
      slotWidth: FLANGE_SLOT,
      cutZ,
      masterVolume,
      siliconeMm3,
    },
    solids: [bottom, top],
    profileMode: profile.profileMode,
    clipCount: flange.stations.length,
    flanges: flange.stations,
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
