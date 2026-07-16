/// <reference types="vitest/config" />
import { defineConfig } from "vite";

// base: "./" keeps every emitted asset path relative, so the built site
// works whether it's served from "/" or a subpath like
// apps.charliekrug.com/sheet-delta/.
export default defineConfig({
  base: "./",
  build: {
    outDir: "dist",
  },
  test: {
    environment: "jsdom",
  },
});
