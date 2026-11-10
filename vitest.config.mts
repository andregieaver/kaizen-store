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
    // The migrations are applied once, to a database every test file then copies (`src/db/testing.ts`).
    globalSetup: ["src/test/test-db-template.ts"],
    setupFiles: ["src/test/eager-lazy-views.ts", "src/test/admin-english.ts"],
    testTimeout: 20_000,
    hookTimeout: 60_000,
  },
});
