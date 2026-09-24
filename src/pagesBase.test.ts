import { describe, expect, it } from "vitest";
import { publicBase } from "./pagesBase";

describe("publicBase", () => {
  it("serves Docker and local Vite at /", () => {
    expect(publicBase({})).toBe("/");
    expect(publicBase({ GITHUB_PAGES: "false" })).toBe("/");
  });

  it("prefixes the GitHub Pages project site", () => {
    expect(publicBase({ GITHUB_PAGES: "true", GITHUB_REPOSITORY: "iphonetikpr/Moldmaker" })).toBe(
      "/Moldmaker/",
    );
    expect(publicBase({ GITHUB_PAGES: "true" })).toBe("/Moldmaker/");
  });
});
