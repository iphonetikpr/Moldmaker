import { describe, expect, it } from "vitest";
import { clampNumber, parseNumberDraft, stepNumber } from "./numberField";

describe("number field", () => {
  it("parses comma decimals and rejects blanks", () => {
    expect(parseNumberDraft("1,5")).toBe(1.5);
    expect(parseNumberDraft(" 3 ")).toBe(3);
    expect(parseNumberDraft("")).toBeNull();
    expect(parseNumberDraft("-")).toBeNull();
    expect(parseNumberDraft("abc")).toBeNull();
  });

  it("clamps and steps", () => {
    expect(clampNumber(12, 0, 10)).toBe(10);
    expect(stepNumber(3, 1, 0.5, 0, 5)).toBe(3.5);
    expect(stepNumber(0.2, -1, 0.5, 0, 5)).toBe(0);
  });
});
