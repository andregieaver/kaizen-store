import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) },
  },
  test: {
    include: ["src/**/*.test.ts"],
    // Integration tests need a database: `pnpm test:int`.
    exclude: ["src/**/*.int.test.ts", "node_modules/**"],
    // Parts loaded with next/dynamic are drawn whole in unit tests (D211).
    setupFiles: ["src/test/eager-lazy-views.ts"],
    testTimeout: 20_000,
    hookTimeout: 60_000,
  },
});
