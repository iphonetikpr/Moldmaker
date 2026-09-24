/// <reference types="vitest/config" />
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { publicBase } from "./src/pagesBase";

export default defineConfig({
  base: publicBase(process.env),
  plugins: [react()],
  optimizeDeps: {
    exclude: ["manifold-3d"],
  },
  test: {
    environment: "node",
    include: ["src/**/*.test.ts"],
    testTimeout: 30000,
  },
});
