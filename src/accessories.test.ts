import { describe, expect, it } from "vitest";
import { CLIP_PRINT_NOTE } from "./constants";
import { clipPrintNotes, clipZipPaths, groupAccessories, type AccessoryFile } from "./accessories";

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
});
