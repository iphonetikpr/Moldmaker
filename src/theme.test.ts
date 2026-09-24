import { describe, expect, it } from "vitest";
import { isTheme, toggleTheme } from "./theme";

describe("theme", () => {
  it("toggles dark and light", () => {
    expect(toggleTheme("dark")).toBe("light");
    expect(toggleTheme("light")).toBe("dark");
  });

  it("accepts only the two themes", () => {
    expect(isTheme("dark")).toBe(true);
    expect(isTheme("light")).toBe(true);
    expect(isTheme("Moldbox")).toBe(false);
  });
});
