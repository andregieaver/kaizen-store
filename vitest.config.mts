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
    testTimeout: 20_000,
    hookTimeout: 60_000,
  },
});
