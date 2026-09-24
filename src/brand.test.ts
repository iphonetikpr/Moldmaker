import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const files = ["README.md", "package.json", "index.html", "docker-compose.yml", "Dockerfile"];

describe("product name", () => {
  it("says Moldmaker and not the previous name", () => {
    for (const file of files) {
      const text = readFileSync(file, "utf8");
      expect(text.toLowerCase(), file).not.toContain("moldbox");
      expect(text, file).toContain("Moldmaker");
    }
  });
});
