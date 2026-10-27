import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

// Integration tests run server modules against a real Postgres
// (DATABASE_URL, set up with scripts/db-setup.mjs --seed).
export default defineConfig({
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
      "server-only": fileURLToPath(new URL("./test/server-only.ts", import.meta.url)),
    },
  },
  test: {
    include: ["src/**/*.int.test.ts"],
    testTimeout: 20_000,
    fileParallelism: false,
    // The test database's stores start public (D339): the tests model open stores.
    globalSetup: ["./test/integration-setup.ts"],
  },
});
