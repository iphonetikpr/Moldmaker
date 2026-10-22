import { CLIP_PRINT_NOTE } from "./constants";

export { CLIP_PRINT_NOTE };

export interface AccessoryFile {
  /** Repo-relative path, used to hide `accessories/legacy/`. */
  path: string;
  name: string;
  url: string;
}

export interface AccessoryGroup {
  id: string;
  title: string;
  files: AccessoryFile[];
  thumbnail?: string;
}

export interface ClipZipPath {
  name: string;
  zipPath: string;
}

const stlUrls = import.meta.glob("../accessories/**/*.stl", {
  query: "?url",
  import: "default",
  eager: true,
}) as Record<string, string>;

const pngUrls = import.meta.glob("../accessories/**/*.png", {
  query: "?url",
  import: "default",
  eager: true,
}) as Record<string, string>;

function basename(path: string): string {
  const cut = path.split("/").pop() || path;
  return cut.split("?")[0];
}

function isLegacy(path: string): boolean {
  return path.includes("/legacy/");
}

/** STL, drawing and source files shipped under `accessories/`, excluding the old 8 mm clip. */
export function catalogEntries(): AccessoryFile[] {
  const urls = { ...stlUrls, ...pngUrls };
  return Object.entries(urls)
    .filter(([path]) => !isLegacy(path))
    .map(([path, url]) => ({ path, name: basename(path), url }))
    .sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
}

function kindOf(name: string): "stl" | "png" | "other" {
  const lower = name.toLowerCase();
  if (lower.endsWith(".stl")) return "stl";
  if (lower.endsWith(".png")) return "png";
  return "other";
}

/**
 * Match a prensa part. Size-specific names (`cclamp80_knob`) stay on that prensa.
 * Shared `cclamp_knob` / `cclamp_pad` are listed on both.
 */
export function matchesPrensa(name: string, size: "80" | "150"): boolean {
  const n = name.toLowerCase();
  if (n.startsWith(`cclamp${size}_`)) return true;
  return /^cclamp_(knob|pad)\./.test(n);
}

export function matchesClip(name: string): boolean {
  return /clip_flange_(frame|wedge)\./i.test(name);
}

function groupOf(title: string, id: string, files: AccessoryFile[]): AccessoryGroup {
  const sorted = [...files].sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
  const thumb = sorted.find((f) => kindOf(f.name) === "png");
  return { id, title, files: sorted, thumbnail: thumb?.url };
}

/** The three cards in Accesorios. Legacy `clip8_*` never appears here. */
export function groupAccessories(entries: AccessoryFile[]): AccessoryGroup[] {
  const live = entries.filter((e) => !isLegacy(e.path));
  return [
    groupOf(
      "Clip de cuña",
      "clip",
      live.filter((e) => matchesClip(e.name)),
    ),
    groupOf(
      "Prensa M6 80 mm",
      "cclamp80",
      live.filter((e) => matchesPrensa(e.name, "80")),
    ),
    groupOf(
      "Prensa M6 150 mm",
      "cclamp150",
      live.filter((e) => matchesPrensa(e.name, "150")),
    ),
  ];
}

export const ACCESSORY_GROUPS: AccessoryGroup[] = groupAccessories(catalogEntries());

/** One frame + wedge per clip, numbered so the ZIP paths stay unique. */
export function clipZipPaths(names: string[], count: number): ClipZipPath[] {
  const clips = names
    .filter((name) => !isLegacy(name) && /clip_flange_(frame|wedge)\.stl$/i.test(basename(name)))
    .map(basename)
    .sort();
  const out: ClipZipPath[] = [];
  const n = Math.max(0, Math.floor(count));
  for (let i = 1; i <= n; i++) {
    const dir = String(i).padStart(2, "0");
    for (const name of clips) out.push({ name, zipPath: `clips/${dir}/${name}` });
  }
  return out;
}

export function clipPrintNotes(count: number): string {
  return `Clips a imprimir: ${count}\n${CLIP_PRINT_NOTE}\n`;
}

export function clipStlFiles(): AccessoryFile[] {
  return catalogEntries().filter((f) => matchesClip(f.name) && f.name.toLowerCase().endsWith(".stl"));
}

export async function loadClipZipEntries(count: number): Promise<Array<{ path: string; data: ArrayBuffer }>> {
  const files = clipStlFiles();
  const planned = clipZipPaths(
    files.map((f) => f.name),
    count,
  );
  const byName = new Map(files.map((f) => [f.name, f.url]));
  const out: Array<{ path: string; data: ArrayBuffer }> = [];
  for (const item of planned) {
    const url = byName.get(item.name);
    if (!url) continue;
    const res = await fetch(url);
    if (!res.ok) throw new Error(`No se pudo leer ${item.name}`);
    out.push({ path: item.zipPath, data: await res.arrayBuffer() });
  }
  return out;
}
