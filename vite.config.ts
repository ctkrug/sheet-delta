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
    setupFiles: ["./src/test-setup.ts"],
    coverage: {
      provider: "v8",
      include: ["src/**"],
      // The test files themselves, the shared fixtures, and the entry point,
      // which is a mount call with nothing to assert about it.
      exclude: ["src/**/*.test.ts", "src/test-setup.ts", "src/main.ts"],
      reporter: ["text", "html"],
    },
  },
});
