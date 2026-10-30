/** Locked CAD defaults (mm / degrees). Editable in the UI; these are the starting values. */

export const DEFAULTS = {
  wallThickness: 3.0,
  draftDeg: 1.5,
  siliconeGap: 0.5,
  funnelDiameter: 12,
  channelW: 4,
  channelH: 4,
  pinDiameter: 3.0,
  holeDiameter: 3.25,
  pinReach: 5,
  splitMax: 250,
  splitOverlap: 2.5,
  splitEnabled: false,
  clampSlot: 8,
  clampClearance: 0.3,
  clampEnabled: true,
  /** Printed wedge clips. Binder tabs and "none" are the other closure choices. */
  closure: "clips",
  /** Nominal binder-clip size (mm). One of BINDER_SIZES. */
  binderSize: 32,
  castShrinkPct: 0,
  /** Fraction of master height for the 2-part cut. 0.5 = Z mid. */
  cutRatio: 0.5,
} as const;

/** Floor keys on Adapted Box (not a user-facing locked default). */
export const KEY_SIZE = 6;
export const KEY_HEIGHT = 2;
export const KEY_INSET = 4;

/** Perimeter tongue on 2-part molds. Groove grows by clampClearance. */
export const SEAL_W = 1.6;
export const SEAL_H = 1.2;

/**
 * Universal wedge-clip flange. Same on every mold, so one printed clip fits all.
 * Thickness is per half: a 2-part mold stacks 5 + 5 = 10 mm, which is what the clip grips.
 * The slot is a through window. Its outer edge sits 4 mm in from the flange tip,
 * then the opening runs 8.3 mm back toward the wall (4 mm of tab remains against the wall).
 */
export const FLANGE_THICKNESS = 5;
export const FLANGE_PROTRUSION = 16.3;
export const FLANGE_SLOT = 8.3;
export const FLANGE_SLOT_FROM_OUTER = 4;
/** Stations per side = ceil(outer side length / this). */
export const FLANGE_PITCH = 80;

export const CLIP_PRINT_NOTE =
  "PETG acostado, 5–6 paredes, 40–50 % relleno; tuerca M6 encajada (hueco hex 10.2–10.3 mm)";

/**
 * Binder-clip tabs. The selector and the solids both read BINDER_SIZES.
 * Groove position is measured from the tab tip, not from the wall.
 * Count per side is max(minCount, ceil(side / pitch)).
 * 19 mm and 25 mm are not offered.
 */
export const BINDER_TAB_W = 36;
export const BINDER_GROOVE_W = 3;
export const BINDER_GROOVE_D = 0.8;
export const BINDER_ROOT_CHAMFER = 45;
/** Clearance from each corner to the tab edge. If the computed count does not fit, one centered tab is used. */
export const BINDER_CORNER_MARGIN = 10;
export const BINDER_RIB_W = 3;
export const BINDER_DEFAULT_SIZE = 32;

export interface BinderSize {
  /** Nominal clip size, mm. Also the row id. */
  size: number;
  /** Thickness of one half, mm. A 2-part stack is twice this; a one-piece shell uses the total. */
  thickness: number;
  /** Tab width along the wall, mm. */
  width: number;
  /** How far the tab stands out from the outer wall, mm. */
  protrusion: number;
  /** Distance from the tab tip to the groove centerline, mm. */
  grooveFromTip: number;
  /** Station pitch. Count = max(minCount, ceil(side / pitch)). */
  pitch: number;
  /** Floor on the station count. Jumbo is at least one per side before the corner rule. */
  minCount: number;
  /** Narrow 45° ribs under the tab, along the protrusion. */
  ribs: number;
  /** Jaw opening is assumed, not measured. */
  provisional?: boolean;
}

export const BINDER_SIZES: readonly BinderSize[] = [
  { size: 32, thickness: 5, width: BINDER_TAB_W, protrusion: 16.3, grooveFromTip: 7, pitch: 80, minCount: 1, ribs: 0 },
  { size: 41, thickness: 7, width: 45, protrusion: 20, grooveFromTip: 9, pitch: 80, minCount: 1, ribs: 0 },
  { size: 51, thickness: 10, width: 55, protrusion: 24, grooveFromTip: 11, pitch: 100, minCount: 1, ribs: 0 },
  { size: 75, thickness: 8, width: 80, protrusion: 40, grooveFromTip: 34, pitch: 150, minCount: 1, ribs: 2, provisional: true },
];

export function binderSizeById(size: number): BinderSize {
  return BINDER_SIZES.find((row) => row.size === size) ?? BINDER_SIZES.find((row) => row.size === BINDER_DEFAULT_SIZE)!;
}

/** Tooltip and print note for the jumbo row. Jaw opening is assumed 20 mm. */
export function binderProvisionalNote(row: BinderSize): string {
  return `Provisional: abertura de mordaza supuesta 20 mm en el clip de ${row.size} mm. Mide la abertura máxima. Si abre 23 mm o más, el espesor puede subir a 10 mm por mitad.`;
}

export function binderPrintNotes(row: BinderSize, count: number): string {
  const heavy = row.size >= 51;
  const lines = [
    `Binder clips: ${count}`,
    `Tamaño seleccionado: ${row.size} mm — ${row.thickness} mm por mitad, ${row.thickness * 2} mm en total, pestaña ${row.width} × ${row.protrusion} mm, ranura a ${row.grooveFromTip} mm de la punta.`,
    heavy
      ? "Pestañas acostadas en la cama, 6 paredes, 50 % relleno."
      : "Pestañas acostadas en la cama, 5 paredes, 40 % relleno.",
  ];
  if (row.provisional) lines.push(binderProvisionalNote(row));
  lines.push("");
  return lines.join("\n");
}

export const THEME_KEY = "moldmaker.theme";

export const CYL_SEGMENTS = 48;
