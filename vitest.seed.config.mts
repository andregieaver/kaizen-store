import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

// Seeds for the end-to-end build (bloat review step 1.6): server modules run against DATABASE_URL before `pnpm build`, as the
// integration tests run them, so a store is made by the platform's own functions rather than by hand-written SQL.
export default defineConfig({
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
      "server-only": fileURLToPath(new URL("./test/server-only.ts", import.meta.url)),
    },
  },
  test: {
    include: ["e2e/seed/*.seed.ts"],
    testTimeout: 120_000,
    fileParallelism: false,
  },
});
