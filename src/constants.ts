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
 * Binder-clip tabs. Same station pitch as the printed clip.
 * Groove and root angle are shared. Thickness, width and protrusion come from the row.
 * Append a 75 mm jumbo row to BINDER_SIZES later; the selector and the solids both read the list.
 * 19 mm is intentionally absent (the jaw is too small for these tabs).
 */
export const BINDER_TAB_W = 36;
export const BINDER_GROOVE_W = 3;
export const BINDER_GROOVE_D = 0.8;
export const BINDER_GROOVE_FROM_WALL = 9;
export const BINDER_ROOT_CHAMFER = 45;
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
  /** Short label, shown next to the size. */
  note?: string;
}

export const BINDER_SIZES: readonly BinderSize[] = [
  { size: 25, thickness: 4, width: 29, protrusion: 16.3, note: "solo PLA" },
  { size: 32, thickness: 5, width: BINDER_TAB_W, protrusion: 16.3 },
  { size: 41, thickness: 6.5, width: 45, protrusion: 16.3 },
  { size: 51, thickness: 9, width: 55, protrusion: 20 },
];

export function binderSizeById(size: number): BinderSize {
  return BINDER_SIZES.find((row) => row.size === size) ?? BINDER_SIZES.find((row) => row.size === BINDER_DEFAULT_SIZE)!;
}

export function binderPrintNotes(row: BinderSize, count: number): string {
  const tag = row.note ? ` (${row.note})` : "";
  return [
    `Binder clips: ${count}`,
    `Tamaño seleccionado: ${row.size} mm${tag} — ${row.thickness} mm por mitad, ${row.thickness * 2} mm en total, pestaña ${row.width} × ${row.protrusion} mm.`,
    "Tamaño recomendado 32 mm (abre unos 13 mm; 41 mm también sirve; 19 mm queda corto).",
    "Pestañas: acostadas en la cama, 5 paredes, 40 % relleno. PLA mínimo 4 mm por mitad.",
    "Prueba de fluencia 24 h: volver a medir si se doblaron más de 0.3 mm.",
    "",
  ].join("\n");
}

export const THEME_KEY = "moldmaker.theme";

export const CYL_SEGMENTS = 48;
