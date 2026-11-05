// Runs the comparison pages' generator (docs/comparison-pages.md): `pnpm exec vitest run --config docs/comparison-evidence/pages/vitest.config.mts`.
import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: { alias: { "@": fileURLToPath(new URL("../../../src", import.meta.url)) } },
  test: { include: ["docs/comparison-evidence/pages/*.test.ts"], testTimeout: 60_000 },
});
