import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import JSZip from "jszip";
import { CLIP_PRINT_NOTE } from "./constants";
import {
  ACCESSORY_GROUPS,
  catalogEntries,
  clipPrintNotes,
  clipStlFiles,
  clipZipPaths,
  groupAccessories,
  type AccessoryFile,
} from "./accessories";

function file(path: string): AccessoryFile {
  return { path, name: path.split("/").pop() || path, url: path };
}

describe("accessories", () => {
  const entries = [
    file("accessories/clip_flange_frame.stl"),
    file("accessories/clip_flange_wedge.stl"),
    file("accessories/clip_flange_frame.png"),
    file("accessories/cclamp80_frame.stl"),
    file("accessories/cclamp_knob.stl"),
    file("accessories/cclamp_pad.stl"),
    file("accessories/cclamp150_frame.stl"),
    file("accessories/cclamp150_knob.stl"),
    file("accessories/legacy/clip8_frame.stl"),
    file("accessories/legacy/clip8_wedge.stl"),
    file("accessories/legacy/clip8_frame.png"),
  ];

  it("groups the wedge clip and both prensas, and hides the legacy 8 mm clip", () => {
    const groups = groupAccessories(entries);
    expect(groups.map((g) => g.title)).toEqual(["Clip de cuña", "Prensa M6 80 mm", "Prensa M6 150 mm"]);
    const names = groups.map((g) => g.files.map((f) => f.name));
    expect(names[0]).toEqual(["clip_flange_frame.png", "clip_flange_frame.stl", "clip_flange_wedge.stl"]);
    expect(names[1]).toEqual(["cclamp80_frame.stl", "cclamp_knob.stl", "cclamp_pad.stl"]);
    expect(names[2]).toEqual(["cclamp150_frame.stl", "cclamp150_knob.stl", "cclamp_knob.stl", "cclamp_pad.stl"]);
    expect(groups[0].thumbnail).toBe("accessories/clip_flange_frame.png");
    expect(JSON.stringify(groups)).not.toContain("clip8_");
  });

  it("repeats each clip STL once per station with a unique zip path", () => {
    const paths = clipZipPaths(
      ["accessories/clip_flange_wedge.stl", "accessories/legacy/clip8_frame.stl", "clip_flange_frame.stl"],
      3,
    );
    expect(paths.map((p) => p.zipPath)).toEqual([
      "clips/01/clip_flange_frame.stl",
      "clips/01/clip_flange_wedge.stl",
      "clips/02/clip_flange_frame.stl",
      "clips/02/clip_flange_wedge.stl",
      "clips/03/clip_flange_frame.stl",
      "clips/03/clip_flange_wedge.stl",
    ]);
  });

  it("puts the print line in print_notes", () => {
    expect(CLIP_PRINT_NOTE).toBe(
      "PETG acostado, 5–6 paredes, 40–50 % relleno; tuerca M6 encajada (hueco hex 10.2–10.3 mm)",
    );
    expect(clipPrintNotes(10)).toContain(CLIP_PRINT_NOTE);
    expect(clipPrintNotes(10)).toContain("10");
  });

  it("loads the shipped clip STLs and drawings, and leaves clip8 out of the cards", () => {
    const clip = ACCESSORY_GROUPS[0];
    const prensa80 = ACCESSORY_GROUPS[1];
    const prensa150 = ACCESSORY_GROUPS[2];
    expect(clip.files.filter((f) => f.name.endsWith(".stl")).map((f) => f.name)).toEqual([
      "clip_flange_frame.stl",
      "clip_flange_wedge.stl",
    ]);
    expect(clip.thumbnail).toMatch(/clip_flange_assembly\.png/);
    expect(prensa80.files.map((f) => f.name)).toEqual(
      expect.arrayContaining(["cclamp80_frame.stl", "cclamp_knob.stl", "cclamp_pad.stl"]),
    );
    expect(prensa80.thumbnail).toMatch(/cclamp80_assembly\.png/);
    expect(prensa150.files.map((f) => f.name)).toEqual(
      expect.arrayContaining(["cclamp150_frame.stl", "cclamp_knob.stl", "cclamp_pad.stl"]),
    );
    expect(prensa150.thumbnail).toMatch(/cclamp150_assembly\.png/);
    const shown = JSON.stringify(ACCESSORY_GROUPS);
    expect(shown).not.toContain("clip8_");
    expect(shown).not.toContain("clip_parts");
    expect(shown).not.toContain("clip_assembly.png");
    expect(catalogEntries().some((f) => f.name === "clip_flange_side_labeled.png")).toBe(true);
  });

  it("puts a byte-for-byte copy of each clip STL in the zip for every station", async () => {
    const files = clipStlFiles();
    expect(files.map((f) => f.name).sort()).toEqual(["clip_flange_frame.stl", "clip_flange_wedge.stl"]);
    const planned = clipZipPaths(
      files.map((f) => f.name),
      3,
    );
    const zip = new JSZip();
    const source = new Map<string, string>();
    for (const item of planned) {
      const src = files.find((f) => f.name === item.name);
      expect(src?.url).toMatch(/^\/accessories\/stl\/clip_flange_(frame|wedge)\.stl$/);
      const text = readFileSync(join(process.cwd(), src!.url.slice(1)), "utf8");
      expect(text.startsWith("solid ")).toBe(true);
      source.set(item.name, text);
      zip.file(item.zipPath, text);
    }
    zip.file("print_notes.txt", clipPrintNotes(3));
    const back = await JSZip.loadAsync(await zip.generateAsync({ type: "uint8array" }));
    for (const item of planned) {
      expect(await back.file(item.zipPath)!.async("string")).toBe(source.get(item.name));
    }
    expect(await back.file("print_notes.txt")!.async("string")).toContain("Clips a imprimir: 3");
    expect(await back.file("print_notes.txt")!.async("string")).toContain(CLIP_PRINT_NOTE);
  });
});
